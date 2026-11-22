// Season Lab (docs/plan-season-lab.md): play out the rest of the season with picks for any regular-season game,
// conference title game or playoff game, and see every conference's title race, the stand-in ranking, the field and
// the bracket. Picks travel in a URL, so the codec lives here too. All wording comes from here.
import { liveRanking, type LiveRanked } from "./live";
import { projectedField } from "./projected";
import { simulateNational, titleRace, type NationalResult } from "./national";
import { COMMITTEE_WEIGHTS as W } from "./committee-weights";
import { powerConferences } from "./committee";
import { conferenceName, conferenceShort, formatFine, formatOdds, formatSideOdds, shownChange } from "./paths";
import { announcedField, bracketGames, findFormat } from "./playoff";
import { INDEPENDENTS, teamRecord, type Game, type Season } from "./season";
import { gameWinProbability, mix, mulberry32, neutralOdds } from "./sim";
import { provenStatus, type ProvenStatus } from "./proof";
import { pairKey } from "./steps";
import { conferenceData, decidedTitleGame } from "./tiebreak";
import { nationalView, type NationalView } from "./view";

// The proof budget for each race row the sample puts in every season: enough for a settled race, small enough that a
// pick in the Lab stays quick.
const RACE_PROOF_BUDGET = 20_000;

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
  /**
   * With `reuse`: simulate nothing, and show the odds over its seasons these picks don't change (`NationalOptions.estimate`).
   * The summary counts those seasons.
   */
  estimate?: boolean;
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
  /** Each share for display: never a flat 0% or 100% for a team still alive ("<0.1%", ">99%"). */
  titleGameText: string;
  championText: string;
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
  /** The picks in effect: those given, less any the simulation ignores (see `LabOptions.locks`). */
  locks: LabLocks;
  /** Each FBS team's record, picks counted as played, a picked title game among them: "11-2". */
  records: Record<number, string>;
  /** How many picks are in effect. */
  picks: number;
  /** Regular-season games neither final nor picked. 0: every game is set ("Every game picked" in the summary). */
  open: number;
  /** Each team's playoff chance for display, by team: "72%", ">99%", "<0.1%" (a live team is never a flat 0% or 100%). */
  fieldTexts: Record<number, string>;
  /** What to say when the Lab opens from a link with picks and no field change is known: "5 picks loaded." */
  loaded: string;
  /** "3 picks · 20,000 simulated seasons", or "No picks yet · 20,000 simulated seasons". */
  summary: string;
  /** The field and bracket; null when the season's playoff isn't simulated. */
  playoff: NationalView | null;
  /** The projected conference champions the field was seeded with: team id to its conference. */
  champions: Record<number, string>;
  /** Each simulated conference's title race, in the order given. */
  conferences: LabConference[];
  /** The committee stand-in's ranking by average place, best first. Modelled, not the committee. */
  ranking: LabRanked[];
  /**
   * The projected ranking (projected.ts): the committee's latest, moved by results since and the picks (a pick
   * counts as if it had been played). Its top 25 (or `top`), best first; `change` is the move from the current ranking.
   */
  live: LiveRanked[];
  /** The whole projected ranking, every FBS team, best first. Places past the committee's 25 are our estimate. */
  liveAll: LiveRanked[];
  /** The control that opens the whole ranking: "All 138 (projection)". Places past the committee's 25 are ours. */
  allLabel: string;
  /** The control that folds it back to the top list: "Top 25" (or `top`). */
  topLabel: string;
  /** What the fold-back control at the foot of the whole ranking is called for screen readers: "Back to top 25". */
  backLabel: string;
  /**
   * The open games that move the field most, biggest first: up to 15, each swinging at least 0.1 spots, among games
   * neither side wins more than 90% of the time (a long shot's swing is mostly noise). Empty with no playoff.
   */
  bigGames: LabBigGame[];
};

const empty = (): LabLocks => ({ games: {}, titles: {}, bracket: {} });

// Proofs read only the season and the picks, never the simulated seasons, so each run after a pick reuses them.
const proofs = new WeakMap<Season, Map<string, ProvenStatus>>();
function provenOnce(season: Season, conference: string, teamId: number, locks: Record<number, number>, budget?: number): ProvenStatus {
  let cache = proofs.get(season);
  if (!cache) proofs.set(season, (cache = new Map()));
  const key = `${conference}|${teamId}|${budget ?? ""}|${Object.keys(locks).sort().map((id) => `${id}-${locks[Number(id)]}`).join(".")}`;
  let status = cache.get(key);
  if (status === undefined) {
    status = provenStatus(season, conference, teamId, locks, budget);
    // A long session's picks: start over rather than grow without end.
    if (cache.size >= 5000) cache.clear();
    cache.set(key, status);
  }
  return status;
}
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
    locks: locks.games, titleLocks: locks.titles, bracketLocks: locks.bracket, reuse: opts.reuse, estimate: opts.estimate,
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
      .map((t) => {
        // A team the picks settle into the title game plays in it for sure: "100%", not ">99%".
        const m = tables.get(conference)!.matchup;
        // Or one every sampled season puts in that the proof confirms (a small budget keeps picks quick; a proof that
        // runs out leaves ">99%").
        const settled = (m?.exact === true && m.teams.includes(t.teamId))
          || (t.titleGame === 1 && provenOnce(season, conference, t.teamId, locks.games, RACE_PROOF_BUDGET) === "clinched");
        const game = formatSideOdds(t.titleGame!, settled ? "clinched" : "alive");
        // With the settled game's winner picked, the title is settled too.
        const pick = locks.titles[conference];
        const title = formatSideOdds(t.champion!, settled && pick !== undefined ? (pick === t.teamId ? "clinched" : "eliminated") : "alive");
        return {
          teamId: t.teamId, titleGame: t.titleGame!, champion: t.champion!,
          text: `Title game ${game} · champion ${title}`,
          titleGameText: game, championText: title,
        };
      }),
    ...tables.get(conference)!,
    final: null,
  })).map((c) => ({ ...c, final: labFinal(c, season) }));
  const listed = national.teams.slice(0, opts.top ?? 25);
  const ranking = listed.map((t, k) => ({
    rank: k + 1, teamId: t.teamId, meanRank: t.meanRank,
    text: `Average rank ${t.meanRank.toFixed(1)} · top 12 in ${formatFine(t.top12)}`,
    reason: rankReason(t, listed),
  }));
  // Worked out when first read: the page builds its list from the no-picks run, so a run after a pick rarely needs it.
  let bigGames: LabBigGame[] | undefined;
  const bigGamesOf = (): LabBigGame[] => national.swings
    .filter((g) => g.home >= 0.1 && g.home <= 0.9 && g.spots >= 0.1)
    .sort((a, b) => b.spots - a.spots || a.gameId - b.gameId)
    .slice(0, 15)
    .map((g) => ({ gameId: g.gameId, spots: g.spots, text: `Swings about ${g.spots.toFixed(1)} ${g.spots.toFixed(1) === "1.0" ? "spot" : "spots"} in the field` }));
  // The projected ranking and field (projected.ts): the current picture moved by the picks, the same the team
  // view's race card shows. The top 25's moves are against where each team stands now (real results only).
  const projected = projectedField(season, national, locks.games);
  const now = liveRanking(season).teams;
  const nowPlace = new Map(now.map((t) => [t.teamId, t]));
  const liveAll: LiveRanked[] = projected.order.map((teamId, k) => {
    const cur = nowPlace.get(teamId)!;
    return { teamId, rank: k + 1, committeeRank: cur.committeeRank, change: cur.rank - (k + 1) };
  });
  const live = liveAll.slice(0, opts.top ?? 25);
  const order = projected.order;
  const champions = [...projected.champions.keys()];
  return {
    national,
    locks,
    live,
    liveAll,
    allLabel: `All ${liveAll.length} (projection)`,
    topLabel: `Top ${live.length}`,
    backLabel: `Back to top ${live.length}`,
    picks,
    open,
    fieldTexts: Object.fromEntries(national.teams.flatMap((t) => (t.playoff ? [[t.teamId, formatSideOdds(t.playoff.field, "alive")]] : []))),
    loaded: `${picks} ${picks === 1 ? "pick" : "picks"} loaded.`,
    summary: `${picks === 0 ? "No picks yet" : picks === 1 ? "1 pick" : `${picks} picks`}${open === 0 && picks > 0 ? " · every game picked" : ""} · ${seasons}`,
    playoff: nationalView(national, { season, ranking: { order, champions, tags: projected.tags } }),
    champions: Object.fromEntries(projected.champions),
    conferences,
    ranking,
    get bigGames() {
      bigGames ??= bigGamesOf();
      return bigGames;
    },
    records: Object.fromEntries(season.teams.filter((t) => t.classification === "fbs").map((t) => {
      const r = teamRecord(season, t.id, locks.games);
      // A picked title game counts: a win for the winner, a loss for the team it beat.
      const title = conferences.find((c) => c.picked !== null && c.final?.teams.includes(t.id) && c.final.teams.includes(c.picked));
      const won = title ? (title.picked === t.id ? 1 : 0) : 0;
      const lost = title ? 1 - won : 0;
      return [t.id, `${r.wins + won}-${r.losses + lost}`];
    })),
  };
}

/** The matchup to pick a title-game winner in: the exact one, or the two likeliest teams. Its odds are the game's, at a
 * neutral site, so picking a winner doesn't move them. */
function labFinal(c: LabConference, season: Season): LabFinal | null {
  const pair: [number, number] | null = c.matchup?.exact ? c.matchup.teams : c.teams.length >= 2 ? [c.teams[0].teamId, c.teams[1].teamId] : null;
  if (!pair) return null;
  const a = neutralOdds(season)(pair[0], pair[1], 0, 0);
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

/** One line of a field change: "In" with "9 Texas Tech · 10 Wake Forest", "Out" with "Oregon · UCLA". */
export type LabChangeLine = {
  label: "In" | "Out" | "Up" | "Down";
  text: string;
  /** The teams named, up to four: the new seed (null on the Out line) and the name. */
  teams: { seed: number | null; name: string }[];
  /** Teams past the four named ("+2"). */
  more: number;
};

export type LabChanges = {
  /** The lines as one sentence: "In: 9 Texas Tech · 10 Wake Forest. Out: Oregon", or "No change to the field." Empty with no playoff. */
  headline: string;
  /** Teams into and out of the field, new seeds first, best seed first; or, with the same twelve, the seed moves up and down. Up to four teams a line, then "+2". Empty when nothing changed. */
  lines: LabChangeLine[];
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
  const lines: LabChangeLine[] = [];
  if (before.playoff && after.playoff) {
    const was = new Map(before.playoff.field.map((s) => [s.teamId, s.seed]));
    const now = new Map(after.playoff.field.map((s) => [s.teamId, s.seed]));
    // Up to four teams a line, then "+2", so a fill's batch fits the header.
    const line = (label: LabChangeLine["label"], all: { seed: number | null; name: string }[]): LabChangeLine => {
      const teams = all.slice(0, 4);
      const more = all.length - teams.length;
      return { label, teams, more, text: `${teams.map((t) => (t.seed === null ? t.name : `${t.seed} ${t.name}`)).join(" · ")}${more > 0 ? ` +${more}` : ""}` };
    };
    const ins = after.playoff.field.filter((s) => !was.has(s.teamId)).sort((x, y) => x.seed - y.seed).map((s) => ({ seed: s.seed, name: name(s.teamId) }));
    const outs = before.playoff.field.filter((s) => !now.has(s.teamId)).sort((x, y) => x.seed - y.seed).map((s) => ({ seed: null, name: name(s.teamId) }));
    const moved = after.playoff.field.filter((s) => was.has(s.teamId) && was.get(s.teamId) !== s.seed);
    const up = moved.filter((s) => s.seed < was.get(s.teamId)!).map((s) => ({ seed: s.seed, name: name(s.teamId) }));
    const down = moved.filter((s) => s.seed > was.get(s.teamId)!).map((s) => ({ seed: s.seed, name: name(s.teamId) }));
    if (ins.length + outs.length > 0) {
      if (ins.length) lines.push(line("In", ins));
      if (outs.length) lines.push(line("Out", outs));
    } else {
      if (up.length) lines.push(line("Up", up));
      if (down.length) lines.push(line("Down", down));
    }
    headline = lines.length === 0 ? "No change to the field." : lines.map((l) => `${l.label}: ${l.text}`).join(". ");
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
  return { headline, lines, movers: movers.slice(0, 5) };
}

/** One seed on the share card. `color`: the team's colour from the data ("#ba0c2f"), or null. */
export type LabCardSeed = {
  seed: number; teamId: number; name: string; color: string | null;
  /** "SEC champ" when the seed is its conference's projected champion, else null. */
  tag: string | null;
};

/** One team in a bracket on the share card. */
export type LabCardSlot = { seed: number; teamId: number; name: string; abbr: string };

/** One game of the visitor's bracket on the share card: its two teams as far as the picks say, and the pick. */
export type LabCardGame = {
  index: number;
  round: "First round" | "Quarterfinal" | "Semifinal" | "Final";
  /** Null while the game feeding that side isn't picked. */
  a: LabCardSlot | null;
  b: LabCardSlot | null;
  /** The picked winner's team id, or null. */
  winner: number | null;
  /** The games whose winners fill its sides, in side order (none for a first-round game). */
  feeders: number[];
};

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
  /**
   * The visitor's own filled-in bracket, when the link carries one with at least one pick: every game with its picked
   * winner, the champion once the final is picked, and how much is picked ("7 of 11 playoff games picked", "Every
   * playoff game picked"). Null otherwise.
   */
  bracket: { games: LabCardGame[]; champion: LabCardSlot | null; picked: string } | null;
};

/**
 * The share card for a Lab run: its field by seed and the likeliest champion. Null when the season's playoff isn't
 * simulated (or has no field).
 */
export function labCard(season: Season, lab: SeasonLab, bracket?: LabBracketPicks | null): LabCard | null {
  const p = lab.playoff;
  if (!p || p.field.length === 0) return null;
  const team = new Map(season.teams.map((t) => [t.id, t]));
  const name = (id: number) => team.get(id)?.name ?? `Team ${id}`;
  const field = p.field.map((s) => ({ seed: s.seed, teamId: s.teamId, name: name(s.teamId), color: team.get(s.teamId)?.color ?? null,
    tag: lab.champions[s.teamId] ? `${conferenceShort(lab.champions[s.teamId])} champ` : null as string | null }));
  // The Group of Six bid: the best-seeded team from outside the power conferences (independents aside) not already tagged.
  if (findFormat(season.year)?.autoBids === "power4G6") {
    const power = new Set(powerConferences(season.year));
    const g6 = field.find((s) => {
      const c = team.get(s.teamId)?.conference ?? null;
      return s.tag === null && c !== null && c !== INDEPENDENTS && !power.has(c);
    });
    if (g6) g6.tag = "G6 bid";
  }
  const picks = lab.open === 0 ? "Every game picked" : lab.picks === 0 ? "No picks" : `${lab.picks} pick${lab.picks === 1 ? "" : "s"}`;
  const best = [...p.field].sort((a, b) => b.champion - a.champion || a.seed - b.seed)[0];
  const champion = best.champion >= 1 ? `National champion: ${name(best.teamId)}` : `Title favorite: ${name(best.teamId)}, ${formatOdds(best.champion)}`;
  const title = lab.picks === 0 ? "Projected playoff field · Season Lab" : "Playoff picks · Season Lab";
  const mine = bracket && Object.keys(bracket.picks).length > 0 ? bracketCard(season, bracket) : null;
  if (mine) {
    const said = mine.champion ? `My champion: ${mine.champion.name}` : champion;
    return { heading: "My playoff bracket", picks, field, champion: said, title: "My playoff bracket · Season Lab", description: `${mine.picked}. ${said}.`, bracket: mine };
  }
  return { heading: p.heading, picks, field, champion, title, description: `${picks}. ${champion}.`, bracket: null };
}

/** A filled-in bracket as the share card draws it. `b` is already checked (`decodeLabBracket`) or from the Lab itself. */
function bracketCard(season: Season, b: LabBracketPicks): NonNullable<LabCard["bracket"]> {
  const team = new Map(season.teams.map((t) => [t.id, t]));
  const games = bracketGames(b.seeds.length as 4 | 12);
  const slot = (id: number): LabCardSlot => {
    const t = team.get(id);
    return { seed: b.seeds.indexOf(id) + 1, teamId: id, name: t?.name ?? `Team ${id}`, abbr: t?.abbreviation ?? t?.name ?? `Team ${id}` };
  };
  const side = (x: number) => (x >= 0 ? slot(b.seeds[x]) : b.picks[~x] !== undefined ? slot(b.picks[~x]) : null);
  const last = games.length - 1;
  const out: LabCardGame[] = games.map(([x, y], index) => ({
    index, round: index === last ? "Final" : b.seeds.length === 4 ? "Semifinal" : index < 4 ? "First round" : index < 8 ? "Quarterfinal" : "Semifinal",
    a: side(x), b: side(y), winner: b.picks[index] ?? null, feeders: [x, y].filter((v) => v < 0).map((v) => ~v),
  }));
  const n = Object.keys(b.picks).length;
  const champion = b.picks[last] !== undefined ? slot(b.picks[last]) : null;
  return { games: out, champion, picked: n === games.length ? "Every playoff game picked" : `${n} of ${games.length} playoff games picked` };
}

// --- Bracket codec: the visitor's own fill-in of the projected bracket. ------------------------------------------
// Shown only, never run: the bracket picks don't change any odds. They travel beside the picks code (`?bracket=` in
// the Lab, `<picks>~<bracket>` in a shared link). Bytes, as unsigned LEB128 varints: a version (1); the seeds' team
// ids, seed 1 first, with their count; the picks, with their count, each (game index, winner's seed index). Then
// base64url without padding.

/** The visitor's own fill-in of a bracket: shown, never run, so no odds move. */
export type LabBracketPicks = {
  /** The bracket it was picked on: team ids, seed 1 first. */
  seeds: number[];
  /** Bracket game index (`bracketGames` order) -> the team picked to win it. */
  picks: Record<number, number>;
};

const BRACKET_VERSION = 1;

/** A filled-in bracket as a short URL-safe string. Throws for a pick whose winner isn't one of the seeds. */
export function encodeLabBracket(b: LabBracketPicks): string {
  const out: number[] = [];
  const put = (v: number) => {
    let x = v;
    while (x >= 0x80) { out.push((x % 128) | 0x80); x = Math.floor(x / 128); }
    out.push(x);
  };
  put(BRACKET_VERSION);
  put(b.seeds.length);
  for (const id of b.seeds) put(id);
  const ks = Object.keys(b.picks).map(Number).sort((x, y) => x - y);
  put(ks.length);
  for (const k of ks) {
    const at = b.seeds.indexOf(b.picks[k]);
    if (at < 0) throw new Error(`team ${b.picks[k]} isn't in the bracket`);
    put(k);
    put(at);
  }
  return toBase64Url(out);
}

/**
 * Read a bracket back from `encodeLabBracket`. A link can be old or hand-edited, so the whole bracket is dropped (null)
 * unless it fits the season: as many distinct seeds as its playoff format takes, all teams in the season, and each pick
 * a team that can be in that game (a seed placed there, or the pick of the game feeding that side). Never throws.
 */
export function decodeLabBracket(season: Season, text: string | null | undefined): LabBracketPicks | null {
  if (!text) return null;
  const bytes = fromBase64Url(text);
  const format = findFormat(season.year);
  if (bytes === null || !format) return null;
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
    if (get() !== BRACKET_VERSION) return null;
    const n = get();
    if (n !== format.teams) return null;
    const ids = new Set(season.teams.map((t) => t.id));
    const seeds: number[] = [];
    for (let k = 0; k < n; k++) seeds.push(get());
    if (new Set(seeds).size !== n || seeds.some((id) => !ids.has(id))) return null;
    const games = bracketGames(format.teams);
    const picks: Record<number, number> = {};
    for (let m = get(), prev = -1; m > 0; m--) {
      const k = get();
      const at = get();
      if (k <= prev || k >= games.length || at >= n) return null;
      prev = k;
      const [x, y] = games[k];
      const side = (s: number) => (s >= 0 ? seeds[s] : picks[~s]);
      if (seeds[at] !== side(x) && seeds[at] !== side(y)) return null;
      picks[k] = seeds[at];
    }
    if (p !== bytes.length) return null;
    return { seeds, picks };
  } catch {
    return null;
  }
}

/** A shared Lab link's code: the picks code, then `~` and the bracket code when there is one. Either may be empty. */
export function labShareCode(picks: string | null | undefined, bracket: string | null | undefined): string {
  return `${picks ?? ""}${bracket ? `~${bracket}` : ""}`;
}

/** Split a shared Lab link's code (`labShareCode`) into its picks code and bracket code (null when it has none). */
export function readLabShareCode(code: string): { picks: string; bracket: string | null } {
  const at = code.indexOf("~");
  return at < 0 ? { picks: code, bracket: null } : { picks: code.slice(0, at), bracket: code.slice(at + 1) || null };
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

/**
 * A team's odds in a Lab run, null when the run doesn't have the team. A title-game share the sample puts at 0% or
 * 100% is checked exactly against the run's picks: a team no remaining result can send to its title game reads "0%"
 * (its title too), one every result sends there "100%" (and, with that game's winner picked, "100%" or "0%" for the
 * title); otherwise "<0.1%" or ">99%". Its playoff odds never read a flat 0%: out of the title game is not proven out
 * of the playoff (`formatPlayoff`).
 */
export function labTeamOdds(season: Season, lab: SeasonLab, teamId: number): LabTeamOdds | null {
  const t = lab.national.teams.find((x) => x.teamId === teamId);
  if (!t) return null;
  const titled = t.titleGame !== null && t.conference !== null && t.conference !== INDEPENDENTS;
  const proven = titled && (t.titleGame === 0 || t.titleGame === 1) ? provenOnce(season, t.conference!, teamId, lab.locks.games) : "open";
  const status = proven === "open" ? "alive" : proven;
  // A picked winner of a title game the team is sure to play in settles the title: won by the pick, lost by the other.
  const picked = titled ? lab.locks.titles[t.conference!] : undefined;
  const title = status === "eliminated" ? "eliminated" : status === "clinched" && picked !== undefined ? (picked === teamId ? "clinched" : "eliminated") : "alive";
  const show = (p: number | null, s: "alive" | "clinched" | "eliminated" = "alive") => (p === null ? "—" : formatSideOdds(p, s));
  const playoff = t.playoff?.field ?? null;
  return {
    teamId, playoff, titleGame: t.titleGame, champion: t.champion,
    playoffText: show(playoff), titleGameText: show(t.titleGame, status), championText: show(t.champion, title),
  };
}

/**
 * How a pinned team's odds moved, in points of the odds as shown ("+4 pts", "−2 pts"), so 5% to 9% reads +4; null when
 * the shown odds didn't change or either side isn't simulated.
 */
export function labOddsChange(before: number | null, after: number | null): string | null {
  if (before === null || after === null) return null;
  const d = shownChange(before, after);
  return d === null ? null : `${d} ${d.slice(1) === "1" ? "pt" : "pts"}`;
}

/** Places of average rank a team can move between two runs and still count as held (`labHeld`). */
const HELD_RANK = 0.5;

/**
 * Teams whose odds a change of picks barely moved, by what the Lab shows: `field`, its playoff odds (in the field, and
 * the national title); `titleGame` and `champion`, its conference's title game and title; `ranks`, its average rank
 * (less than half a place) and top-12 share. A share counts as held when it moved less than 2 points.
 */
export type LabHeld = { field: number[]; titleGame: number[]; champion: number[]; ranks: number[] };

/**
 * What a change of picks barely moved (`LabHeld`), between `before` and `after`: runs of the same seed whose simulated
 * seasons line up (the same size, or `after` an estimate from `before`), so the difference is mostly the picks'.
 */
export function labHeld(before: SeasonLab, after: SeasonLab): LabHeld {
  const was = new Map(before.national.teams.map((t) => [t.teamId, t]));
  const near = (a: number | null, b: number | null) => (a === null ? b === null : b !== null && Math.abs(a - b) < MOVE);
  const held: LabHeld = { field: [], titleGame: [], champion: [], ranks: [] };
  for (const t of after.national.teams) {
    const w = was.get(t.teamId);
    if (!w) continue;
    const p = w.playoff, q = t.playoff;
    if (p && q ? near(p.field, q.field) && near(p.champion, q.champion) : p === q) held.field.push(t.teamId);
    if (near(w.titleGame, t.titleGame)) held.titleGame.push(t.teamId);
    if (near(w.champion, t.champion)) held.champion.push(t.teamId);
    if (Math.abs(w.meanRank - t.meanRank) < HELD_RANK && near(w.top12, t.top12)) held.ranks.push(t.teamId);
  }
  return held;
}

/** What `steadyLab` merges: the parts of a Lab run the page shows per team, and a pinned team's odds. */
export type LabShown = Pick<SeasonLab, "fieldTexts" | "conferences" | "playoff" | "ranking"> & { focus?: LabTeamOdds | null };

/**
 * A quick run or an estimate as the page should show it over `shown` (what the page shows now, from a full run): each
 * odds a change held (`labHeld`) keeps its shown value, so sampling noise in the smaller sample doesn't move a number
 * the full run would only move back; the rest take `quick`'s. Lists with held entries are re-sorted by the odds shown,
 * and a title game not yet settled keeps its shown matchup while those two still lead the race. Anything else (the
 * picks, records, settled matchups) is `quick`'s.
 */
export function steadyLab<T extends LabShown>(shown: LabShown, quick: T, held: LabHeld): T {
  const field = new Set(held.field), titleGame = new Set(held.titleGame), champion = new Set(held.champion), ranks = new Set(held.ranks);
  const keep = <X extends { teamId: number }>(now: X[], was: X[] | undefined, set: Set<number>): X[] => {
    const prior = new Map((was ?? []).map((x) => [x.teamId, x]));
    return now.map((x) => (set.has(x.teamId) && prior.has(x.teamId) ? prior.get(x.teamId)! : x));
  };
  const fieldTexts = Object.fromEntries(Object.entries(quick.fieldTexts).map(([id, text]) => [id, field.has(Number(id)) && shown.fieldTexts[Number(id)] !== undefined ? shown.fieldTexts[Number(id)] : text]));
  const conferences = quick.conferences.map((c) => {
    const was = shown.conferences.find((x) => x.conference === c.conference);
    const prior = new Map((was?.teams ?? []).map((x) => [x.teamId, x]));
    // Each race row's two odds held or not on their own.
    const teams = c.teams.map((t) => {
      const p = prior.get(t.teamId);
      if (!p) return t;
      const game = titleGame.has(t.teamId) ? p : t;
      const title = champion.has(t.teamId) ? p : t;
      return { ...t, titleGame: game.titleGame, titleGameText: game.titleGameText, champion: title.champion, championText: title.championText,
        text: `Title game ${game.titleGameText} · champion ${title.championText}` };
    }).sort((a, b) => b.titleGame - a.titleGame || b.champion - a.champion || a.teamId - b.teamId);
    const lead = teams.slice(0, 2).map((t) => t.teamId).sort((x, y) => x - y).join("|");
    const final = c.final && !c.final.exact && was?.final && !was.final.exact && was.final.key === lead ? was.final : c.final;
    return { ...c, teams, final };
  });
  const ranking = keep(quick.ranking, shown.ranking, ranks)
    .sort((a, b) => a.meanRank - b.meanRank || a.teamId - b.teamId)
    .map((r, k) => ({ ...r, rank: k + 1 }));
  let playoff = quick.playoff;
  if (playoff && shown.playoff) {
    const was = shown.playoff;
    // A spot keeps its shown odds only with the same team at the same seed: a reseeded field is a real change.
    const spots = playoff.field.map((s, k) => (field.has(s.teamId) && was.field[k]?.teamId === s.teamId && was.field[k].seed === s.seed ? was.field[k] : s));
    playoff = { ...playoff, field: spots, bubble: keep(playoff.bubble, was.bubble, field), g6: playoff.g6 && { ...playoff.g6, teams: keep(playoff.g6.teams, was.g6?.teams, field) } };
  }
  if (quick.focus === undefined) return { ...quick, fieldTexts, conferences, ranking, playoff };
  // A pinned team's odds: each held or not on its own.
  const f = quick.focus, w = shown.focus;
  const focus = f && w && f.teamId === w.teamId
    ? { ...f, ...(field.has(f.teamId) ? { playoff: w.playoff, playoffText: w.playoffText } : {}),
      ...(titleGame.has(f.teamId) ? { titleGame: w.titleGame, titleGameText: w.titleGameText } : {}),
      ...(champion.has(f.teamId) ? { champion: w.champion, championText: w.championText } : {}) }
    : f;
  return { ...quick, fieldTexts, conferences, ranking, playoff, focus };
}

/** How `fillLabLocks` picks the open games: the favourite always wins, or one season drawn from a seed. */
export type LabFill = "favorites" | { seed: number };

const FILL_SALT = 1 << 24;

/**
 * The picks (less any on a game since gone final) plus a pick for every regular-season game neither final nor picked,
 * title games aside (the standings decide who plays in those). Then, for each of `conferences` with no title pick and
 * its title game not final, a pick of the title-game winner between the two teams those standings send (the favourite
 * at neutral-site odds, or drawn at them). Existing picks stay. A seeded fill draws each game at its model odds; the
 * same seed and picks give the same season.
 */
export function fillLabLocks(season: Season, locks: Partial<LabLocks>, how: LabFill, conferences: readonly string[] = []): LabLocks {
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
  const titles = { ...out.titles };
  const names = new Map(season.teams.map((t) => [t.id, t.name]));
  const winnerOf = (g: Game): number => games[g.id] ?? (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId);
  const odds = neutralOdds(season);
  conferences.forEach((c, k) => {
    if (titleFinal(season, c)) return;
    const m = standingsWithPicks(season, c, (g) => games[g.id] !== undefined, winnerOf, names).matchup;
    if (!m) return;
    // A title pick stands while its team still plays in the title game; one the filled games put out is picked again.
    if (titles[c] !== undefined && (!m.exact || m.teams.includes(titles[c]))) return;
    const [a, b] = m.teams;
    const p = odds(a, b, 0, 0);
    titles[c] = (how === "favorites" ? p >= 0.5 : mulberry32(mix(how.seed, 1, FILL_SALT + k))() < p) ? a : b;
  });
  return { ...out, games, titles };
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
