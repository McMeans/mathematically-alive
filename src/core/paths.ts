// What has to happen for one team to reach its conference championship game.
// Odds are Monte Carlo counts over simulated seasons. "clinched" and "eliminated"
// are mathematically proven (provenStatus checks every remaining combination);
// odds of exactly 1 or 0 without a proof stay "open".
import type { NationalPlayoff, NationalResult } from "./national";
import type { TeamOutlook } from "./outlook";
import { simulateSeason, tiebreakDraw, type SimResult } from "./sim";
import { provenStatus } from "./proof";
import { INDEPENDENTS, type Game, type Season, type TeamRecord } from "./season";
import { OVERALL, isClear } from "./signal";
import { championshipFromData, conferenceData } from "./tiebreak";

export type PathOptions = {
  conference: string;
  teamId: number;
  iterations: number;
  seed: number;
  /** Forced results: game id -> id of the team that wins it. */
  locks?: Record<number, number>;
  /** An earlier national run to copy untouched title races from (`NationalOptions.reuse`). */
  reuse?: NationalResult;
  /** Forced title-game winners: conference -> the team that wins it, in the seasons it plays in it (`NationalOptions.titleLocks`). */
  titleLocks?: Record<string, number>;
};

export type PathStatus = "clinched" | "alive" | "eliminated";

export type KeyGame = {
  gameId: number;
  homeId: number;
  awayId: number;
  /** The team's title-game odds if the home team wins this game. */
  oddsIfHomeWins: number;
  oddsIfAwayWins: number;
  /** Absolute difference between the two conditional odds. */
  swing: number;
  /** Team id to root for: the winner that gives the better odds. */
  rooting: number;
};

export type TeamPath = {
  /** "clinched" / "eliminated" are proven over every combination of remaining results (rating and coin-flip tiebreak steps count either way). */
  status: PathStatus;
  /** Fraction of iterations the team plays in the title game. */
  titleGame: number;
  /** Title-game odds given the team wins all its remaining games; null if that never happened or none remain. */
  ifWinOut: number | null;
  /** Up to 5 remaining conference games that move the odds most (at least 1 point and clear of sampling noise), biggest first. */
  keyGames: KeyGame[];
  summary: string;
  steps: string[];
};

const MAX_KEY_GAMES = 5;
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

/** Odds as shown: "In" / "Out" only when proven, otherwise whole percent, never 0% or 100% for a sample. */
export function formatChance(p: number, status: PathStatus): string {
  if (status === "clinched") return "In";
  if (status === "eliminated") return "Out";
  if (p <= 0) return "<1%";
  if (p >= 1) return ">99%";
  return formatOdds(p);
}

/** Title-game odds for display: In or Out when proven; otherwise never a flat 0% or 100% (under 0.1%, over 99%). */
export function formatTitleOdds(p: number, status: PathStatus): string {
  if (status === "clinched") return "In";
  if (status === "eliminated") return "Out";
  return formatSideOdds(p, status);
}

/**
 * Any other odds of a team (winning the conference, the playoff), given its title-game status: a live team's
 * 0% in the sample shows as under 0.1%, and 100% only once it's in. A team that's out can show 0%.
 */
export function formatSideOdds(p: number, status: PathStatus): string {
  return shown(sideOdds(p, status));
}

/** Odds with one decimal under 1%, so long shots can be told apart: "0.4%", "<0.1%"; whole percents otherwise. */
export function formatFine(p: number): string {
  return shown(fineOdds(p));
}

/** Odds as shown, as a number: the percent and the mark before it ("<0.1%" is 0.1 with "<"). */
type Shown = { pct: number; mark: "<" | ">" | "" };
const shown = ({ pct, mark }: Shown) => `${mark}${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;

function fineOdds(p: number): Shown {
  if (p > 0 && p < 0.001) return { pct: 0.1, mark: "<" };
  if (p >= 0.001 && p < 0.0095) return { pct: Math.round(p * 1000) / 10, mark: "" };
  const r = Math.round(p * 100);
  if (p > 0 && r === 0) return { pct: 1, mark: "<" };
  if (p < 1 && r === 100) return { pct: 99, mark: ">" };
  return { pct: r, mark: "" };
}

function sideOdds(p: number, status: PathStatus): Shown {
  if (p === 0 && status !== "eliminated") return { pct: 0.1, mark: "<" };
  if (p === 1 && status !== "clinched") return { pct: 99, mark: ">" };
  return fineOdds(p);
}

/** The percent `formatSideOdds` shows, as a number (">99%" is 99), for differences between shown odds. */
export function shownSideOdds(p: number, status: PathStatus): number {
  return sideOdds(p, status).pct;
}

/** A team's record for display: "4-5 (2-4 ACC)", or just "4-5" for an independent or without a conference. */
export function formatRecord(record: TeamRecord, conference: string | null): string {
  const overall = `${record.wins}-${record.losses}`;
  return conference && conference !== INDEPENDENTS ? `${overall} (${record.conferenceWins}-${record.conferenceLosses} ${conferenceShort(conference)})` : overall;
}

/** How the site names each conference (CFBD's name -> display name, and the short form where space is tight). */
const CONFERENCE_NAMES: Record<string, { name: string; short: string }> = {
  "Mid-American": { name: "MAC", short: "MAC" },
  "Pac-12": { name: "Pac 12", short: "Pac 12" },
  "Sun Belt": { name: "Sun Belt", short: "SBC" },
  "American Athletic": { name: "American", short: "American" },
  "Conference USA": { name: "CUSA", short: "CUSA" },
  "Mountain West": { name: "Mountain West", short: "MW" },
  "FBS Independents": { name: "Independents", short: "Independents" },
};

/** The conference's name as the site shows it ("MAC" for CFBD's "Mid-American"); unlisted names show as they are. */
export const conferenceName = (conference: string): string => CONFERENCE_NAMES[conference]?.name ?? conference;

/** The short form, where space is tight ("MW", "SBC"); otherwise the display name. */
export const conferenceShort = (conference: string): string => CONFERENCE_NAMES[conference]?.short ?? conference;

/** What each odds tile is called. */
export type OddsLabels = {
  titleGame: string; champion: string; playoff: string; winOut: string; beta: string; conferenceRecord: string; mustWin: string; nonConference: string;
  conference: string; cfp: string;
  /** The tag on a projected matchup, and what it means. */
  projected: string; projectedNote: string;
};

/** What a projected matchup (`Game.projected`) is, in a sentence without its period. */
export const PROJECTED_NOTE = "A projected matchup, not yet confirmed";

/** Labels for the odds tiles, so every view names each number the same way. */
export function oddsLabels(key: string): OddsLabels {
  const conference = conferenceName(key);
  return {
    titleGame: "Title game",
    champion: `Win ${conference}`,
    playoff: "Playoff",
    winOut: "Win out",
    beta: "Beta",
    conferenceRecord: `${conference} record, counting your picks`,
    mustWin: `Must win ${conference}`,
    nonConference: "Non-con",
    projected: "Projected",
    projectedNote: `${PROJECTED_NOTE}.`,
    conference: conferenceShort(key),
    cfp: "CFP",
  };
}

/**
 * The team makes the playoff only as conference champion (never at large), so its playoff odds are its title odds.
 * Never for a Group of Six team: its conference title is no automatic bid (see `playoffRoute`).
 */
export function mustWinConference(o: TeamOutlook): boolean {
  return !o.groupOfSix && o.playoff > 0 && o.atLarge === 0 && !o.cfp?.run;
}

/** Why a team barred from the postseason (`Team.postseasonBan`) shows Out everywhere. Not part of the public API. */
export const BARRED = "Barred from the postseason this season: no title game, no playoff";

/** One goal's status in the header: "Playoff · Needs a miracle". `live` while the goal is still possible. */
export type StatusTag = { label: string; live: boolean };

/**
 * How alive a team is for one goal, from its odds and what's proven: "Clinched", "In control" (50% or better), "In
 * the hunt" (10%+), "Long shot" (1%+), "Needs a miracle" (under 1%, not out), "Out".
 */
export function goalStatus(p: number, proven: PathStatus): string {
  if (proven === "clinched") return "Clinched";
  if (proven === "eliminated") return "Out";
  if (p >= 0.5) return "In control";
  if (p >= 0.1) return "In the hunt";
  if (p >= 0.01) return "Long shot";
  return "Needs a miracle";
}

/**
 * The header's tags, one per goal: the playoff, then the conference title game (`titleGame` names it, "ACC title
 * game"; null for an independent). The playoff is only proven once the field is announced, or barred.
 */
export function statusTags(
  o: { playoff: number; cfp: NationalPlayoff | null; postseasonBan: boolean; status?: PathStatus; titleGame?: number },
  titleGame: string | null,
): StatusTag[] {
  const playoff = o.postseasonBan ? "Barred" : goalStatus(o.playoff, o.cfp?.run ? (o.cfp.run.seed === null ? "eliminated" : "clinched") : "alive");
  const tags: StatusTag[] = [{ label: `Playoff · ${playoff}`, live: playoff !== "Out" && playoff !== "Barred" }];
  if (titleGame !== null && o.status !== undefined) {
    const t = goalStatus(o.titleGame ?? 0, o.status);
    tags.push({ label: `${titleGame} · ${t}`, live: t !== "Out" });
  }
  return tags;
}

/**
 * How the team's playoff odds come about, when that needs saying: a team barred from the postseason can't get in;
 * once the committee has announced the field, its seed and its playoff so far (`PlayoffRun.text`); before that, a
 * Group of Six team's way in is ranking above every other Group of Six team, whether or not it wins its conference.
 * Null otherwise.
 */
export function playoffRoute(o: TeamOutlook): string | null {
  if (o.postseasonBan) return BARRED;
  if (o.cfp?.run) return o.cfp.run.text;
  return o.groupOfSix ? "Gets in as the highest-ranked Group of Six team, conference champion or not" : null;
}

/**
 * The playoff odds past getting in, from the national simulation (EXPERIMENTAL): a first-round bye and the national
 * title, as label and display value. Once the field is announced: its seed, and the national title as "Won", "Out"
 * (not selected, or beaten) or its odds. Empty when the odds are the estimate (no national run) or the team never
 * makes the field.
 */
export function playoffDetail(o: { cfp: NationalPlayoff | null }): { label: string; value: string }[] {
  const run = o.cfp?.run;
  if (run) {
    if (run.seed === null) return [];
    const title = run.state === "champion" ? "Won" : run.state === "out" ? "Out" : formatSideOdds(o.cfp!.champion, "alive");
    return [{ label: "Seed", value: String(run.seed) }, { label: "National title", value: title }];
  }
  if (!o.cfp || o.cfp.field === 0) return [];
  const rows = [{ label: "National title", value: formatSideOdds(o.cfp.champion, "alive") }];
  // A four-team field has no byes.
  if (o.cfp.quarterfinal !== null) rows.unshift({ label: "First-round bye", value: formatSideOdds(o.cfp.bye, "alive") });
  return rows;
}

/**
 * Playoff odds as shown: "In" or "Out" once the committee has announced the field; before, the odds, given the
 * team's title-game status (`formatSideOdds`).
 */
export function formatPlayoff(p: number, cfp: NationalPlayoff | null, status: PathStatus): string {
  if (cfp?.run) return cfp.run.seed === null ? "Out" : "In";
  return formatSideOdds(p, status);
}

/** "27-20": a final score, the winner's points first. Not part of the public API. */
export const finalScore = (g: Game): string => `${Math.max(g.homePoints!, g.awayPoints!)}-${Math.min(g.homePoints!, g.awayPoints!)}`;

/** The winner of a final game. Not part of the public API. */
export const winnerOfFinal = (g: Game): number => (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId);

/**
 * A team's result in its conference's title game once it is final: "Beat Virginia 27-20 in the ACC title game" or
 * "Lost to Duke 27-20 in the ACC title game". Null until then, and for a team that didn't play in it. Not part of the
 * public API: `TeamOutlook.titleResult` carries it.
 */
export function titleResult(season: Season, conference: string, game: Game | null, teamId: number): { won: boolean; text: string } | null {
  if (!game || !game.completed || (game.homeId !== teamId && game.awayId !== teamId)) return null;
  const other = game.homeId === teamId ? game.awayId : game.homeId;
  const name = season.teams.find((t) => t.id === other)?.name ?? `Team ${other}`;
  const won = winnerOfFinal(game) === teamId;
  return { won, text: `${won ? "Beat" : "Lost to"} ${name} ${finalScore(game)} in the ${conferenceName(conference)} title game` };
}

/**
 * Its chance to win the conference, as shown: "Won" or "Lost" once it has played the title game, otherwise the odds
 * (`formatSideOdds`).
 */
export function formatChampion(o: Pick<TeamOutlook, "champion" | "status" | "titleResult">): string {
  if (o.titleResult) return o.titleResult.won ? "Won" : "Lost";
  return formatSideOdds(o.champion, o.status);
}

/** Whole-percent odds. "<1%" and ">99%" stand in for 0 or 100 when the true value isn't exact. */
export function formatOdds(p: number): string {
  const r = Math.round(p * 100);
  if (p > 0 && r === 0) return "<1%";
  if (p < 1 && r === 100) return ">99%";
  return `${r}%`;
}

/** `shared`: a simulation of the same season, iterations, seed and locks to reuse. */
export function teamPath(season: Season, opts: PathOptions, shared?: SimResult): TeamPath {
  const { conference, teamId, iterations, seed } = opts;
  const data = conferenceData(season, conference);
  if (data.ids.size < 2) throw new Error(`${conference} has fewer than two teams`);
  if (!data.ids.has(teamId)) throw new Error(`team ${teamId} is not in ${conference}`);

  const sim = shared ?? simulateSeason(season, { iterations, seed, locks: opts.locks });
  const gameIndex = new Map<number, number>(season.games.map((g, i) => [g.id, i]));
  const name = (id: number): string => season.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;

  // Remaining games that can matter: the conference's own games. The title game is
  // decided by conference results alone, so a non-conference game can't move it.
  const confGames = new Set(data.games);
  const candidates = season.games
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => !g.completed && !(opts.locks && g.id in opts.locks) && confGames.has(g));
  const own = season.games
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => !g.completed && (g.homeId === teamId || g.awayId === teamId));

  const homeN = new Float64Array(candidates.length);
  const homeIn = new Float64Array(candidates.length);
  const awayIn = new Float64Array(candidates.length);
  let inTitle = 0;
  let outN = 0;
  let outIn = 0;

  sim.forEachIteration((iteration, winnerAt, teams) => {
    const rand = tiebreakDraw(seed, iteration, conference);
    const [a, b] = championshipFromData(data, (g: Game) => winnerAt(gameIndex.get(g.id)!), { draw: rand, rank: teams.rank });
    const reached = a === teamId || b === teamId;
    if (reached) inTitle++;
    if (own.length > 0 && own.every(({ i }) => winnerAt(i) === teamId)) {
      outN++;
      if (reached) outIn++;
    }
    for (let k = 0; k < candidates.length; k++) {
      const { g, i } = candidates[k];
      if (winnerAt(i) === g.homeId) {
        homeN[k]++;
        if (reached) homeIn[k]++;
      } else if (reached) awayIn[k]++;
    }
  });

  const n = sim.iterations;
  const titleGame = inTitle / n;
  // Clinched / eliminated only when proven over every combination of remaining results, not just the sample.
  const proven = titleGame === 1 || titleGame === 0 ? provenStatus(season, conference, teamId, opts.locks) : "open";
  const status: PathStatus = proven === "clinched" ? "clinched" : proven === "eliminated" ? "eliminated" : "alive";

  // Each outcome needs enough iterations for its conditional odds to mean anything.
  const minSample = Math.max(30, Math.ceil(n * 0.01));
  const ifWinOut = own.length > 0 && outN >= minSample ? outIn / outN : null;
  const keyGames: KeyGame[] = [];
  candidates.forEach(({ g }, k) => {
    const awayN = n - homeN[k];
    if (homeN[k] < minSample || awayN < minSample) return;
    const oddsIfHomeWins = homeIn[k] / homeN[k];
    const oddsIfAwayWins = awayIn[k] / awayN;
    const swing = Math.abs(oddsIfHomeWins - oddsIfAwayWins);
    if (!isClear(homeN[k], homeIn[k], awayN, awayIn[k], OVERALL)) return;
    keyGames.push({
      gameId: g.id, homeId: g.homeId, awayId: g.awayId, oddsIfHomeWins, oddsIfAwayWins, swing,
      rooting: oddsIfHomeWins >= oddsIfAwayWins ? g.homeId : g.awayId,
    });
  });
  keyGames.sort((x, y) => y.swing - x.swing || x.gameId - y.gameId);
  keyGames.length = Math.min(keyGames.length, MAX_KEY_GAMES);

  const team = name(teamId);
  const when = (g: Game): string => {
    const d = new Date(g.start);
    return Number.isNaN(d.getTime()) ? `week ${g.week}` : DATE_FORMAT.format(d);
  };
  const rootLine = (k: KeyGame): string => {
    const g = season.games[gameIndex.get(k.gameId)!];
    const other = k.rooting === k.homeId ? k.awayId : k.homeId;
    const [from, to] = k.rooting === k.homeId ? [k.oddsIfAwayWins, k.oddsIfHomeWins] : [k.oddsIfHomeWins, k.oddsIfAwayWins];
    return k.rooting === teamId
      ? `Win ${when(g)} vs ${name(other)}: it moves ${team}'s odds from ${formatOdds(from)} to ${formatOdds(to)}.`
      : `Root for ${name(k.rooting)} over ${name(other)} (${when(g)}): it moves ${team}'s odds from ${formatOdds(from)} to ${formatOdds(to)}.`;
  };

  let summary: string;
  const steps: string[] = [];
  const barred = season.teams.find((t) => t.id === teamId)?.postseasonBan === true;
  const decided = data.decided;
  const title = `${conferenceName(conference)} title game`;
  if (decided) {
    const [home, away] = [name(decided.homeId), name(decided.awayId)];
    const plays = decided.homeId === teamId || decided.awayId === teamId;
    const other = name(decided.homeId === teamId ? decided.awayId : decided.homeId);
    if (decided.completed) {
      const [w, l] = winnerOfFinal(decided) === decided.homeId ? [home, away] : [away, home];
      summary = !plays ? `${team} didn't make the ${title}: ${w} beat ${l} ${finalScore(decided)}.`
        : w === team ? `${team} won the ${title}, ${finalScore(decided)} over ${other}.`
        : `${team} lost the ${title} to ${other}, ${finalScore(decided)}.`;
    } else summary = plays ? `${team} plays ${other} in the ${title}, ${when(decided)}.` : `${team} didn't make the ${title}: ${home} and ${away} play for it.`;
  } else if (barred) summary = `${team} is barred from the postseason this season, so it can't play in the ${conferenceName(conference)} title game.`;
  else if (status === "clinched") summary = `${team} is in the ${conferenceName(conference)} title game whatever happens.`;
  else if (status === "eliminated") summary = `${team} can't make the ${conferenceName(conference)} title game: no combination of remaining results gets it there.`;
  else if (ifWinOut !== null) summary = `Win out and ${team} makes the ${conferenceName(conference)} title game ${formatOdds(ifWinOut)} of the time.`;
  else if (keyGames.length > 0) summary = rootLine(keyGames[0]);
  else summary = `${team} has a ${formatOdds(titleGame)} chance of making the ${conferenceName(conference)} title game.`;

  if (status === "alive") {
    steps.push(`Right now ${team} makes the ${conferenceName(conference)} title game ${formatOdds(titleGame)} of the time.`);
    if (ifWinOut !== null) steps.push(`If ${team} wins out: ${formatOdds(ifWinOut)}.`);
    for (const k of keyGames) steps.push(rootLine(k));
  }
  return { status, titleGame, ifWinOut, keyGames, summary, steps };
}
