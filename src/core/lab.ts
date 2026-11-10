// Season Lab (docs/plan-season-lab.md): play out the rest of the season with picks for any regular-season game,
// conference title game or playoff game, and see every conference's title race, the stand-in ranking, the field and
// the bracket. Picks travel in a URL, so the codec lives here too. All wording comes from here.
import { simulateNational, titleRace, type NationalResult } from "./national";
import { COMMITTEE_WEIGHTS as W } from "./committee-weights";
import { conferenceName, conferenceShort, formatFine, formatOdds, formatSideOdds } from "./paths";
import { announcedField, bracketGames, findFormat } from "./playoff";
import type { Game, Season } from "./season";
import { gameWinProbability, mix, mulberry32 } from "./sim";
import { pairKey } from "./steps";
import { conferenceData, decidedTitleGame } from "./tiebreak";
import { nationalView, type NationalView } from "./view";

/** Every pick in the Lab. */
export type LabLocks = {
  /** Regular-season game id -> the team that wins it. */
  games: Record<number, number>;
  /** Conference -> the team that wins its title game, in the seasons that team plays in it. */
  titles: Record<string, number>;
  /** Bracket game index (`NationalView.bracket`) -> the team that wins it, in the seasons that team plays in it. */
  bracket: Record<number, number>;
};

export type LabOptions = {
  iterations: number;
  seed: number;
  /** Conferences whose title games are simulated. Each needs tiebreak rules for the season. */
  conferences: readonly string[];
  /**
   * The picks. Ones the simulation would ignore are left out and not counted: a pick on a game already final, a title
   * pick for a team outside its conference's exact title game (`LabConference.matchup`), a title pick for a conference not in
   * `conferences` or whose title game is final, and a playoff pick on a game already final.
   */
  locks?: Partial<LabLocks>;
  /** The no-picks run (or any earlier run of the same season, seed and iterations), to reuse what it can. */
  reuse?: NationalResult;
  /** How many teams the ranking lists (default 25). */
  top?: number;
};

export type LabTitleTeam = {
  teamId: number;
  /** Shares of seasons it plays in, and wins, its conference's title game. */
  titleGame: number;
  champion: number;
  /** "Title game 64% · champion 41%". */
  text: string;
};

export type LabStanding = {
  teamId: number;
  /** Conference record from final and picked games. */
  wins: number;
  losses: number;
  /** Conference games neither final nor picked. */
  open: number;
  /** "6-2", or "5-2 · 1 open". */
  text: string;
};

export type LabTitleMatchup = {
  /** [seed 1, seed 2]. */
  teams: [number, number];
  /**
   * True when the results alone settle it. False when a step the picks can't settle decides it (the ranking
   * stand-in, a coin toss, scoring margin): the teams shown are this run's guess, and the odds stay simulated.
   */
  exact: boolean;
  /** The tiebreak steps that told tied teams apart; empty when records alone decided. */
  steps: string[];
  /** "Duke vs. Virginia, decided by tiebreak: head-to-head." */
  text: string;
};

/**
 * A conference's title game as it stands: the exact matchup once the picks settle it, else its two likeliest teams.
 * For picking a title-game winner before the matchup is settled: a pick stands while these two stay the same two.
 */
export type LabFinal = {
  /** Likelier to play in it first (seed order once exact). */
  teams: [number, number];
  /** Both ids sorted: the same two in either order are the same matchup. */
  key: string;
  /** Each side's chance to win it if they meet: its title share over its title-game share, the two scaled to add to 1. */
  chances: [number, number];
  /** "64%". */
  texts: [string, string];
  /** The picks settle it (`LabConference.matchup.exact`). */
  exact: boolean;
};

export type LabConference = {
  conference: string;
  /** Display name: "MAC", "SEC". */
  name: string;
  /** The team picked to win its title game, or null. */
  picked: number | null;
  /** Members with any chance of playing in the title game, likeliest first. */
  teams: LabTitleTeam[];
  /** Every member, best record with picks first (ties by fewer losses, then team id; not the tiebreak). */
  standings: LabStanding[];
  /** The title game once every game its rules count is final or picked; null before. */
  matchup: LabTitleMatchup | null;
  /** The matchup to pick a winner in; null with fewer than two teams in the race. */
  final: LabFinal | null;
};

export type LabRanked = {
  /** Place by average rank, 1 is best. */
  rank: number;
  teamId: number;
  meanRank: number;
  /** "Average rank 7.4 · top 12 in 63%". */
  text: string;
  /**
   * Why the stand-in ranks it there: its average record, then the one or two features that lift its score most
   * above the listed teams' average. "About 11-1 · SEC title in 64%, tough schedule".
   */
  reason: string;
};

export type LabBigGame = {
  gameId: number;
  /** Places in the field that differ on average between its two results (`NationalResult.swings`). */
  spots: number;
  /** "Swings about 1.2 spots in the field". */
  text: string;
};

export type SeasonLab = {
  national: NationalResult;
  /** How many picks are in effect. */
  picks: number;
  /** Regular-season games neither final nor picked. 0: every game is set ("Every game picked" in the summary). */
  open: number;
  /** "3 picks · 20,000 simulated seasons", or "No picks yet · 20,000 simulated seasons". */
  summary: string;
  /** The field and bracket; null when the season's playoff isn't simulated. */
  playoff: NationalView | null;
  /** Each simulated conference's title race, in the order given. */
  conferences: LabConference[];
  /** The committee stand-in's ranking by average place, best first. Modelled, not the committee. */
  ranking: LabRanked[];
  /**
   * The open games that move the field most, biggest first: up to 15, each swinging at least 0.1 spots, among games
   * neither side wins more than 90% of the time (a long shot's swing is mostly noise). Empty with no playoff.
   */
  bigGames: LabBigGame[];
};

const empty = (): LabLocks => ({ games: {}, titles: {}, bracket: {} });
/** Picks with every kind present, even when the caller passed one as undefined. */
const filled = (l: Partial<LabLocks> | undefined): LabLocks => ({ games: l?.games ?? {}, titles: l?.titles ?? {}, bracket: l?.bracket ?? {} });

/** Run the Lab: the national simulation with every pick, and what the page shows. */
export function seasonLab(season: Season, opts: LabOptions): SeasonLab {
  // Picks the simulation would ignore don't count: a title pick for a conference not simulated or whose title game
  // is final, and a playoff pick on a game already final.
  const given = filled(opts.locks);
  const finals = finalBracketGames(season);
  const unplayed = new Set(season.games.filter((g) => !g.completed).map((g) => g.id));
  const locks: LabLocks = {
    // A pick on a game already final is ignored by the simulation, so it counts nowhere.
    games: Object.fromEntries(Object.entries(given.games).filter(([id]) => unplayed.has(Number(id)))),
    titles: Object.fromEntries(Object.entries(given.titles).filter(([c]) => opts.conferences.includes(c) && !titleFinal(season, c))),
    bracket: Object.fromEntries(Object.entries(given.bracket).filter(([k]) => !finals.has(Number(k)))),
  };
  const names = new Map(season.teams.map((t) => [t.id, t.name]));
  const set = (g: Game) => locks.games[g.id] !== undefined;
  const winnerOf = (g: Game): number => locks.games[g.id] ?? (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId);
  const open = season.games.filter((g) => !g.completed && !g.titleGame && !set(g)).length;
  const tables = new Map(opts.conferences.map((c) => [c, standingsWithPicks(season, c, set, winnerOf, names)]));
  // A title pick for a team the picks have already put out of an exact title game never plays, so it counts nowhere.
  for (const [c, id] of Object.entries(locks.titles)) {
    const m = tables.get(c)?.matchup;
    if (m?.exact && !m.teams.includes(id)) delete locks.titles[c];
  }
  const national = simulateNational(season, {
    iterations: opts.iterations, seed: opts.seed, conferences: opts.conferences,
    locks: locks.games, titleLocks: locks.titles, bracketLocks: locks.bracket, reuse: opts.reuse,
  });
  const picks = Object.keys(locks.games).length + Object.keys(locks.titles).length + Object.keys(locks.bracket).length;
  const seasons = `${national.iterations.toLocaleString("en-US")} simulated seasons`;
  const conferences = national.conferences.map((conference): LabConference => ({
    conference,
    name: conferenceName(conference),
    picked: locks.titles[conference] ?? null,
    teams: national.teams
      .filter((t) => t.conference === conference && (t.titleGame ?? 0) > 0)
      .sort((a, b) => b.titleGame! - a.titleGame! || b.champion! - a.champion! || a.teamId - b.teamId)
      .map((t) => ({
        teamId: t.teamId, titleGame: t.titleGame!, champion: t.champion!,
        text: `Title game ${formatSideOdds(t.titleGame!, "alive")} · champion ${formatSideOdds(t.champion!, "alive")}`,
      })),
    ...tables.get(conference)!,
    final: null,
  })).map((c) => ({ ...c, final: labFinal(c, national) }));
  const listed = national.teams.slice(0, opts.top ?? 25);
  const ranking = listed.map((t, k) => ({
    rank: k + 1, teamId: t.teamId, meanRank: t.meanRank,
    text: `Average rank ${t.meanRank.toFixed(1)} · top 12 in ${formatFine(t.top12)}`,
    reason: rankReason(t, listed),
  }));
  const bigGames = national.swings
    .filter((g) => g.home >= 0.1 && g.home <= 0.9 && g.spots >= 0.1)
    .sort((a, b) => b.spots - a.spots || a.gameId - b.gameId)
    .slice(0, 15)
    .map((g) => ({ gameId: g.gameId, spots: g.spots, text: `Swings about ${g.spots.toFixed(1)} ${g.spots.toFixed(1) === "1.0" ? "spot" : "spots"} in the field` }));
  return {
    national,
    picks,
    open,
    summary: `${picks === 0 ? "No picks yet" : picks === 1 ? "1 pick" : `${picks} picks`}${open === 0 && picks > 0 ? " · every game picked" : ""} · ${seasons}`,
    playoff: nationalView(national, { season }),
    conferences,
    ranking,
    bigGames,
  };
}

/** The matchup to pick a title-game winner in: the exact one, or the two likeliest teams. */
function labFinal(c: LabConference, national: NationalResult): LabFinal | null {
  const pair: [number, number] | null = c.matchup?.exact ? c.matchup.teams : c.teams.length >= 2 ? [c.teams[0].teamId, c.teams[1].teamId] : null;
  if (!pair) return null;
  const odds = (id: number) => national.teams.find((t) => t.teamId === id);
  const cond = pair.map((id) => {
    const t = odds(id);
    return t && t.titleGame ? (t.champion ?? 0) / t.titleGame : 0.5;
  });
  const total = cond[0] + cond[1];
  const a = total > 0 ? cond[0] / total : 0.5;
  const chances: [number, number] = [a, 1 - a];
  return { teams: pair, key: [...pair].sort((x, y) => x - y).join("|"), chances, texts: [formatOdds(chances[0]), formatOdds(chances[1])], exact: c.matchup?.exact ?? false };
}

type Ranked = SeasonLab["national"]["teams"][number];

/** The two features that lift a team's stand-in score most above the listed teams' average, as words. */
function rankReason(t: Ranked, listed: readonly Ranked[]): string {
  const p = t.profile;
  const avg = (f: (x: Ranked) => number) => listed.reduce((s, x) => s + f(x), 0) / listed.length;
  const record = (x: Ranked) => W.wins * x.profile.wins + W.losses * x.profile.losses;
  const parts = [
    { lift: record(t) - avg(record), words: "strong record" },
    { lift: W.rating * (p.rating - avg((x) => x.profile.rating)), words: "strong team rating" },
    { lift: W.strength * (p.strength - avg((x) => x.profile.strength)), words: "tough schedule" },
    { lift: W.champion * (p.champion - avg((x) => x.profile.champion)), words: `${t.conference ? conferenceShort(t.conference) : "conference"} title in ${formatOdds(p.champion)}` },
  ].filter((x) => x.lift > 0).sort((a, b) => b.lift - a.lift).slice(0, 2);
  // Round the wins, then take the losses from the games played, so the record adds up to a real season.
  const wins = Math.round(p.wins);
  const head = `About ${wins}-${Math.max(0, Math.round(p.wins + p.losses) - wins)}`;
  return parts.length === 0 ? head : `${head} · ${parts.map((x) => x.words).join(", ")}`;
}

export type LabMover = {
  teamId: number;
  /** What moved: playoff field odds, or (with no playoff, or a bigger move) title-game odds. */
  what: "field" | "title game";
  before: number;
  after: number;
  /** "Miami: playoff 34% → 61%", "Duke: title game 40% → 100%". */
  text: string;
};

export type LabChanges = {
  /** "Miami into the field as the 11 seed; SMU out.", "Oregon up to the 2 seed.", or "No change to the projected field." Empty with no playoff. */
  headline: string;
  /** The biggest moves of at least 2 points, biggest first, up to 5. */
  movers: LabMover[];
};

const MOVE = 0.02;

/**
 * What changed between two Lab runs of the same season (say, before and after a pick): the projected field's
 * entries, exits and seed moves, and the teams whose field or title-game odds moved most. Compare runs of the same
 * seed and size, so the simulated seasons line up and unrelated teams barely move.
 */
export function labChanges(season: Season, before: SeasonLab, after: SeasonLab): LabChanges {
  const name = (id: number) => season.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;
  let headline = "";
  if (before.playoff && after.playoff) {
    const was = new Map(before.playoff.field.map((s) => [s.teamId, s.seed]));
    const now = new Map(after.playoff.field.map((s) => [s.teamId, s.seed]));
    const ins = after.playoff.field.filter((s) => !was.has(s.teamId)).map((s) => `${name(s.teamId)} into the field as the ${s.seed} seed`);
    const outs = before.playoff.field.filter((s) => !now.has(s.teamId)).map((s) => `${name(s.teamId)} out`);
    const moved = after.playoff.field
      .filter((s) => was.has(s.teamId) && was.get(s.teamId) !== s.seed)
      .sort((a, b) => Math.abs(was.get(b.teamId)! - b.seed) - Math.abs(was.get(a.teamId)! - a.seed) || a.seed - b.seed)
      .slice(0, 2)
      .map((s) => `${name(s.teamId)} ${s.seed < was.get(s.teamId)! ? "up" : "down"} to the ${s.seed} seed`);
    const parts = ins.length + outs.length > 0 ? [...ins, ...outs] : moved;
    headline = parts.length === 0 ? "No change to the projected field." : `${parts.join("; ")}.`;
  }
  const old = new Map(before.national.teams.map((t) => [t.teamId, t]));
  const movers: LabMover[] = [];
  for (const t of after.national.teams) {
    const o = old.get(t.teamId);
    if (!o) continue;
    const field = t.playoff && o.playoff ? { what: "field" as const, before: o.playoff.field, after: t.playoff.field } : null;
    const title = t.titleGame !== null && o.titleGame !== null ? { what: "title game" as const, before: o.titleGame, after: t.titleGame } : null;
    const best = [field, title].filter((m) => m !== null).sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))[0];
    if (!best || Math.abs(best.after - best.before) < MOVE) continue;
    const label = best.what === "field" ? "playoff" : "title game";
    movers.push({ teamId: t.teamId, ...best, text: `${name(t.teamId)}: ${label} ${formatOdds(best.before)} → ${formatOdds(best.after)}` });
  }
  movers.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before) || a.teamId - b.teamId);
  return { headline, movers: movers.slice(0, 5) };
}

/** One seed on the share card. `color`: the team's colour from the data ("#ba0c2f"), or null. */
export type LabCardSeed = { seed: number; teamId: number; name: string; color: string | null };

/** What a Lab link's share image shows: the projected field and who is favoured to win it all. */
export type LabCard = {
  /** "Projected playoff field", or "Playoff field" once announced. */
  heading: string;
  /** "No picks", "3 picks", or "Every game picked" once no regular-season game is open. */
  picks: string;
  field: LabCardSeed[];
  /** "Title favorite: Indiana, 24%", or "National champion: Indiana" once the final is picked. */
  champion: string;
  /** The link preview's title: "Playoff picks · Season Lab", or the projection's with no picks. */
  title: string;
  /** The link preview's text: "3 picks. Title favorite: Indiana, 24%." */
  description: string;
};

/**
 * The share card for a Lab run: its field by seed and the likeliest champion. Null when the season's playoff isn't
 * simulated (or has no field).
 */
export function labCard(season: Season, lab: SeasonLab): LabCard | null {
  const p = lab.playoff;
  if (!p || p.field.length === 0) return null;
  const team = new Map(season.teams.map((t) => [t.id, t]));
  const name = (id: number) => team.get(id)?.name ?? `Team ${id}`;
  const field = p.field.map((s) => ({ seed: s.seed, teamId: s.teamId, name: name(s.teamId), color: team.get(s.teamId)?.color ?? null }));
  const picks = lab.open === 0 ? "Every game picked" : lab.picks === 0 ? "No picks" : `${lab.picks} pick${lab.picks === 1 ? "" : "s"}`;
  const best = [...p.field].sort((a, b) => b.champion - a.champion || a.seed - b.seed)[0];
  const champion = best.champion >= 1 ? `National champion: ${name(best.teamId)}` : `Title favorite: ${name(best.teamId)}, ${formatOdds(best.champion)}`;
  const title = lab.picks === 0 ? "Projected playoff field · Season Lab" : "Playoff picks · Season Lab";
  return { heading: p.heading, picks, field, champion, title, description: `${picks}. ${champion}.` };
}

/** Steps whose answer picks can't settle: the ranking stand-in, a coin toss, and scoring margin (picks have no score). */
const UNSETTLED = new Set(["ranking", "draw", "scoring margin"]);

function standingsWithPicks(
  season: Season, conference: string, set: (g: Game) => boolean, winnerOf: (g: Game) => number, names: Map<number, string>,
): Pick<LabConference, "standings" | "matchup"> {
  const data = conferenceData(season, conference);
  const rows = new Map([...data.ids].map((id) => [id, { teamId: id, wins: 0, losses: 0, open: 0, text: "" }]));
  for (const g of data.games) {
    if (!g.completed && !set(g)) { rows.get(g.homeId)!.open++; rows.get(g.awayId)!.open++; continue; }
    const w = winnerOf(g);
    rows.get(w)!.wins++;
    rows.get(w === g.homeId ? g.awayId : g.homeId)!.losses++;
  }
  const standings = [...rows.values()]
    .map((r) => ({ ...r, text: `${r.wins}-${r.losses}${r.open > 0 ? ` · ${r.open} open` : ""}` }))
    .sort((a, b) => b.wins * (a.wins + a.losses) - a.wins * (b.wins + b.losses) || b.wins - a.wins || a.losses - b.losses || a.teamId - b.teamId);
  // The draw is never used for an exact matchup (it marks the matchup inexact), so any fixed stream will do.
  const decided = decidedTitleGame(data, set, winnerOf, { draw: () => 0 });
  if (!decided) return { standings, matchup: null };
  const exact = !decided.steps.some((s) => UNSETTLED.has(s));
  const vs = `${names.get(decided.teams[0])} vs. ${names.get(decided.teams[1])}`;
  const how = decided.steps.length === 0 ? "decided by record" : `decided by tiebreak: ${decided.steps.join(", then ")}`;
  const text = exact
    ? `${vs}, ${how}.`
    : `Comes down to the ${decided.steps.filter((s) => UNSETTLED.has(s)).join(" and ")} tiebreak, which picks can't settle. The odds below are simulated.`;
  return { standings, matchup: { teams: decided.teams, exact, steps: decided.steps, text } };
}

/** One team's odds in a Lab run, for following a pinned team. Null odds: not simulated (no playoff, or no title race). */
export type LabTeamOdds = {
  teamId: number;
  playoff: number | null;
  titleGame: number | null;
  champion: number | null;
  /** For display: "9%", "<0.1%", "—" when not simulated. */
  playoffText: string;
  titleGameText: string;
  championText: string;
};

/** A team's odds in a Lab run (`SeasonLab.national`), null when the run doesn't have the team. */
export function labTeamOdds(national: NationalResult, teamId: number): LabTeamOdds | null {
  const t = national.teams.find((x) => x.teamId === teamId);
  if (!t) return null;
  const show = (p: number | null) => (p === null ? "—" : formatSideOdds(p, "alive"));
  const playoff = t.playoff?.field ?? null;
  return { teamId, playoff, titleGame: t.titleGame, champion: t.champion, playoffText: show(playoff), titleGameText: show(t.titleGame), championText: show(t.champion) };
}

/**
 * How a pinned team's odds moved, in points of the odds as shown ("+4 pts", "−2 pts"), so 5% to 9% reads +4; null when
 * the shown odds didn't change or either side isn't simulated.
 */
export function labOddsChange(before: number | null, after: number | null): string | null {
  if (before === null || after === null) return null;
  const shown = (p: number) => Number.parseFloat(formatSideOdds(p, "alive").replace(/[<>%]/g, "")) || 0;
  const d = Math.round((shown(after) - shown(before)) * 10) / 10;
  if (d === 0) return null;
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} pts`;
}

/** How `fillLabLocks` picks the open games: the favourite always wins, or one season drawn from a seed. */
export type LabFill = "favorites" | { seed: number };

const FILL_SALT = 1 << 24;

/**
 * The picks (less any on a game since gone final) plus a pick for every regular-season game neither final nor picked, title games aside (the standings
 * decide those). Existing picks stay. A seeded fill draws each game at its model odds; the same seed and picks give
 * the same season.
 */
export function fillLabLocks(season: Season, locks: Partial<LabLocks>, how: LabFill): LabLocks {
  const out = filled(locks);
  // Picks on games since gone final are dropped, as seasonLab drops them.
  const games: Record<number, number> = {};
  for (const g of season.games) {
    if (g.completed || g.titleGame) continue;
    if (out.games[g.id] !== undefined) { games[g.id] = out.games[g.id]; continue; }
    const p = gameWinProbability(season, g);
    const homeWins = how === "favorites" ? p >= 0.5 : mulberry32(mix(how.seed, 0, FILL_SALT + g.id))() < p;
    games[g.id] = homeWins ? g.homeId : g.awayId;
  }
  return { ...out, games };
}

// --- Lock codec: picks as a short URL-safe string. ---------------------------------------------------------------
// Bytes, as unsigned LEB128 varints: a version (2); the game picks, sorted by id, each (gap * 2 + 1 if the away team
// wins), where the first gap is from 0 and zigzagged (projected games have negative ids), the rest plain; the title
// picks, each (conference's place in the season's sorted conference list, team id); the bracket picks, each (game
// index, team id). Each list starts with its length. Then base64url without padding. Version 1 had no zigzag (and
// broke on negative ids); its links still read.

const VERSION = 2;
/** -1 → 1, 1 → 2, -2 → 3: a signed gap as an unsigned one. */
const zig = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n);
const unzig = (n: number) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

const conferencesOf = (season: Season): string[] =>
  [...new Set(season.teams.flatMap((t) => (t.conference ? [t.conference] : [])))].sort();

/**
 * Picks as a short URL-safe string. Throws for a pick that can't be one: a game the season doesn't have or a team not
 * in it, a title pick for a team outside its conference, a bracket game that doesn't exist or a team the season doesn't have.
 */
export function encodeLabLocks(season: Season, locks: Partial<LabLocks>): string {
  const { games, titles, bracket } = filled(locks);
  const out: number[] = [];
  const put = (v: number) => {
    let x = v;
    while (x >= 0x80) { out.push((x % 128) | 0x80); x = Math.floor(x / 128); }
    out.push(x);
  };
  put(VERSION);
  const byId = new Map(season.games.map((g) => [g.id, g]));
  const ids = Object.keys(games).map(Number).sort((a, b) => a - b);
  put(ids.length);
  let prev = 0;
  for (const [k, id] of ids.entries()) {
    const g = byId.get(id);
    if (!g) throw new Error(`pick for unknown game ${id}`);
    if (games[id] !== g.homeId && games[id] !== g.awayId) throw new Error(`team ${games[id]} is not in game ${id}`);
    put((k === 0 ? zig(id) : id - prev) * 2 + (games[id] === g.awayId ? 1 : 0));
    prev = id;
  }
  const confs = conferencesOf(season);
  const cs = Object.keys(titles).sort();
  put(cs.length);
  for (const c of cs) {
    const at = confs.indexOf(c);
    if (at < 0) throw new Error(`${c} isn't a conference in ${season.year}`);
    if (season.teams.find((t) => t.id === titles[c])?.conference !== c) throw new Error(`team ${titles[c]} is not in ${c}`);
    put(at);
    put(titles[c]);
  }
  const ks = Object.keys(bracket).map(Number).sort((a, b) => a - b);
  put(ks.length);
  const size = bracketGames(findFormat(season.year)?.teams ?? 12).length;
  for (const k of ks) {
    if (!Number.isInteger(k) || k < 0 || k >= size) throw new Error(`bracket game ${k} doesn't exist`);
    if (!season.teams.some((t) => t.id === bracket[k])) throw new Error(`team ${bracket[k]} isn't in the season`);
    put(k);
    put(bracket[k]);
  }
  return toBase64Url(out);
}

/** Whether a title pick still fits: its team is in the conference, which has a title game not yet played. */
function titleFit(season: Season, conference: string | undefined, team: number): "keep" | "settled" | "drop" {
  if (conference === undefined || season.teams.find((x) => x.id === team)?.conference !== conference) return "drop";
  try { return titleFinal(season, conference) ? "settled" : "keep"; } catch { return "drop"; } // no title-game rules
}

/**
 * A team page's title-game pick in a Lab link, `<conference>~<team id>` (`?title=SEC~61`), as Lab title picks. A
 * link can be stale or hand-edited, so the pick is kept only when the team is in that conference and its title game
 * is still to play; anything else gives no pick. Never throws.
 */
export function decodeTitlePick(season: Season, text: string | null | undefined): LabLocks["titles"] {
  const m = /^([^~]+)~([1-9]\d{0,14})$/.exec(text ?? "");
  if (!m) return {};
  const team = Number(m[2]);
  return titleFit(season, m[1], team) === "keep" ? { [m[1]]: team } : {};
}

export type DecodedLabLocks = {
  locks: LabLocks;
  /** Picks dropped because the real game has since gone final. */
  settled: number;
  /** Picks dropped because they no longer fit the season (unknown game, team or bracket game), or a malformed string. */
  dropped: number;
  /** "2 picks were settled by real results." and the like; empty when nothing was dropped. */
  note: string;
};

/** Read picks back from `encodeLabLocks`. Never throws: anything that no longer fits the season is dropped and counted. */
export function decodeLabLocks(season: Season, text: string): DecodedLabLocks {
  const locks = empty();
  let settled = 0;
  let dropped = 0;
  const done = (): DecodedLabLocks => ({ locks, settled, dropped, note: dropNote(settled, dropped) });
  const bytes = fromBase64Url(text);
  if (bytes === null) return (dropped = text === "" ? 0 : 1), done();
  let p = 0;
  const get = (): number => {
    let v = 0;
    let scale = 1;
    for (;;) {
      if (p >= bytes.length) throw new RangeError("truncated");
      const b = bytes[p++];
      v += (b & 0x7f) * scale;
      if (b < 0x80) return v;
      scale *= 128;
      if (scale > 2 ** 49) throw new RangeError("too long");
    }
  };
  try {
    const version = get();
    if (version !== VERSION && version !== 1) return (dropped = 1), done();
    const byId = new Map(season.games.map((g) => [g.id, g]));
    let id = 0;
    for (let n = get(), first = true; n > 0; n--, first = false) {
      const v = get();
      const gap = Math.floor(v / 2);
      id += first && version === VERSION ? unzig(gap) : gap;
      const g = byId.get(id);
      if (!g) dropped++;
      else if (g.completed) settled++;
      else locks.games[id] = v % 2 === 1 ? g.awayId : g.homeId;
    }
    const confs = conferencesOf(season);
    for (let n = get(); n > 0; n--) {
      const c = confs[get()];
      const team = get();
      const fit = titleFit(season, c, team);
      if (fit === "drop") dropped++;
      else if (fit === "settled") settled++;
      else locks.titles[c] = team;
    }
    const size = bracketGames(findFormat(season.year)?.teams ?? 12).length;
    const finals = finalBracketGames(season);
    for (let n = get(); n > 0; n--) {
      const k = get();
      const team = get();
      if (k >= size || !season.teams.some((x) => x.id === team)) dropped++;
      else if (finals.has(k)) settled++;
      else locks.bracket[k] = team;
    }
    if (p !== bytes.length) dropped++;
  } catch {
    // A cut-off string keeps the picks read so far.
    dropped++;
  }
  return done();
}

/** Whether the conference's title game is final in the data. Throws for a conference with no title-game rules. */
const titleFinal = (season: Season, conference: string): boolean => titleRace(season, conference).game?.completed === true;

/** Bracket game indexes already final: the announced field's games, walked as the real results fill the bracket. */
function finalBracketGames(season: Season): Set<number> {
  const out = new Set<number>();
  const field = announcedField(season);
  const format = findFormat(season.year);
  if (!field || !format) return out;
  const finals = new Map((season.playoffGames ?? []).filter((g) => g.completed).map((g) => [pairKey(g.homeId, g.awayId), g]));
  const winners: (number | null)[] = [];
  bracketGames(format.teams).forEach(([x, y], k) => {
    const a = x >= 0 ? field.seeds[x] : winners[~x];
    const b = y >= 0 ? field.seeds[y] : winners[~y];
    const real = a != null && b != null ? finals.get(pairKey(a, b)) : undefined;
    winners.push(real ? (real.homePoints! > real.awayPoints! ? real.homeId : real.awayId) : null);
    if (real) out.add(k);
  });
  return out;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const dropNote = (settled: number, dropped: number): string =>
  [
    settled > 0 ? `${settled} ${plural(settled, "pick was", "picks were")} settled by real results.` : "",
    dropped > 0 ? `${dropped} ${plural(dropped, "pick", "picks")} no longer ${plural(dropped, "fits", "fit")} the season and ${plural(dropped, "was", "were")} left out.` : "",
  ].filter(Boolean).join(" ");

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function toBase64Url(bytes: readonly number[]): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) s += ALPHABET[(n >> (18 - 6 * j)) & 63];
  }
  return s;
}

function fromBase64Url(s: string): number[] | null {
  if (s === "" || s.length % 4 === 1) return null;
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 4) {
    const chunk = s.slice(i, i + 4);
    let n = 0;
    for (let j = 0; j < 4; j++) {
      const v = j < chunk.length ? ALPHABET.indexOf(chunk[j]) : 0;
      if (v < 0) return null;
      n = (n << 6) | v;
    }
    const bytes = Math.floor((chunk.length * 6) / 8);
    for (let j = 0; j < bytes; j++) out.push((n >> (16 - 8 * j)) & 255);
  }
  return out;
}
