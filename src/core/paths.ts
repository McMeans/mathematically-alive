// What has to happen for one team to reach its conference championship game.
// Everything is Monte Carlo based: odds are counts over simulated seasons, so
// "clinched" and "eliminated" mean the title-game odds came out as exactly 1 or
// 0 in the sample, not that they are mathematically proven.
import { mix, mulberry32, simulateSeason } from "./sim";
import type { Game, Season } from "./season";
import { championshipFromData, conferenceData } from "./tiebreak";

export type PathOptions = {
  conference: string;
  teamId: number;
  iterations: number;
  seed: number;
  /** Forced results: game id -> id of the team that wins it. */
  locks?: Record<number, number>;
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
  /** Monte Carlo based: "clinched" means the team made the title game in every simulated season, "eliminated" in none; neither is a proof. */
  status: PathStatus;
  /** Fraction of iterations the team plays in the title game. */
  titleGame: number;
  /** Title-game odds given the team wins all its remaining games; null if that never happened or none remain. */
  ifWinOut: number | null;
  /** Up to 5 remaining games that move the odds most (swing of at least 1 point), biggest first. */
  keyGames: KeyGame[];
  summary: string;
  steps: string[];
};

const MAX_KEY_GAMES = 5;
const MIN_SWING = 0.01;
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

/** Whole-percent odds. "<1%" and ">99%" stand in for 0 or 100 when the true value isn't exact. */
export function formatOdds(p: number): string {
  const r = Math.round(p * 100);
  if (p > 0 && r === 0) return "<1%";
  if (p < 1 && r === 100) return ">99%";
  return `${r}%`;
}

export function teamPath(season: Season, opts: PathOptions): TeamPath {
  const { conference, teamId, iterations, seed } = opts;
  const data = conferenceData(season, conference);
  if (data.ids.size < 2) throw new Error(`${conference} has fewer than two teams`);
  if (!data.ids.has(teamId)) throw new Error(`team ${teamId} is not in ${conference}`);

  const sim = simulateSeason(season, { iterations, seed, locks: opts.locks });
  const gameIndex = new Map<number, number>(season.games.map((g, i) => [g.id, i]));
  const name = (id: number): string => season.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;

  // Remaining games that can matter: conference games and the team's own.
  const remaining = season.games
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => !g.completed && !(opts.locks && g.id in opts.locks));
  const candidates = remaining.filter(
    ({ g }) => data.games.includes(g) || g.homeId === teamId || g.awayId === teamId,
  );
  const own = season.games
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => !g.completed && (g.homeId === teamId || g.awayId === teamId));

  const homeN = new Float64Array(candidates.length);
  const homeIn = new Float64Array(candidates.length);
  const awayIn = new Float64Array(candidates.length);
  let inTitle = 0;
  let outN = 0;
  let outIn = 0;

  sim.forEachIteration((iteration, winnerAt) => {
    const rand = mulberry32(mix(seed, iteration, 1));
    const [a, b] = championshipFromData(data, conference, (g: Game) => winnerAt(gameIndex.get(g.id)!), { draw: rand });
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
  const ifWinOut = own.length > 0 && outN > 0 ? outIn / outN : null;
  const status: PathStatus = titleGame === 1 ? "clinched" : titleGame === 0 ? "eliminated" : "alive";

  // Each outcome needs enough iterations for its conditional odds to mean anything.
  const minSample = Math.max(30, Math.ceil(n * 0.01));
  const keyGames: KeyGame[] = [];
  candidates.forEach(({ g }, k) => {
    const awayN = n - homeN[k];
    if (homeN[k] < minSample || awayN < minSample) return;
    const oddsIfHomeWins = homeIn[k] / homeN[k];
    const oddsIfAwayWins = awayIn[k] / awayN;
    const swing = Math.abs(oddsIfHomeWins - oddsIfAwayWins);
    if (swing < MIN_SWING) return;
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
  if (status === "clinched") summary = `Made the ${conference} title game in every simulated season.`;
  else if (status === "eliminated") summary = `Missed the ${conference} title game in every simulated season.`;
  else if (ifWinOut !== null) summary = `Win out and ${team} makes the ${conference} title game ${formatOdds(ifWinOut)} of the time.`;
  else if (keyGames.length > 0) summary = rootLine(keyGames[0]);
  else summary = `${team} has a ${formatOdds(titleGame)} chance of making the ${conference} title game.`;

  if (status === "alive") {
    steps.push(`Right now ${team} makes the ${conference} title game ${formatOdds(titleGame)} of the time.`);
    if (ifWinOut !== null) steps.push(`If ${team} wins out: ${formatOdds(ifWinOut)}.`);
    for (const k of keyGames) steps.push(rootLine(k));
  }
  return { status, titleGame, ifWinOut, keyGames, summary, steps };
}
