// Monte Carlo season simulator. Plays out every unplayed game many times and
// records the outcomes compactly so standings/tiebreaker code can replay them.
import { winProbability } from "./odds";
import type { Game, Season, Team } from "./season";

const HOME_FIELD = 2.5;
const MISSING_RATING_OTHER = -10;

export type OddsOptions = { sd?: number };

/**
 * Chance the home team wins. Uses the game's spread when it has one; otherwise
 * derives a spread from SP+ ratings with 2.5 points of home field (none at a
 * neutral site). A missing rating counts as 0 for FBS teams and -10 for others.
 */
export function gameWinProbability(season: Season, game: Game, opts: OddsOptions = {}): number {
  const byId = new Map<number, Team>(season.teams.map((t) => [t.id, t]));
  return probability(byId, game, opts.sd);
}

function probability(byId: Map<number, Team>, game: Game, sd?: number): number {
  if (game.spread !== null) return winProbability(game.spread, sd);
  const rating = (id: number): number => {
    const t = byId.get(id);
    if (t?.rating != null) return t.rating;
    return t?.classification === "fbs" ? 0 : MISSING_RATING_OTHER;
  };
  const home = game.neutralSite ? 0 : HOME_FIELD;
  return winProbability(-(rating(game.homeId) - rating(game.awayId)) - home, sd);
}

export type SimOptions = {
  iterations: number;
  seed: number;
  /** Forced results: game id -> id of the team that wins it. */
  locks?: Record<number, number>;
};

export type TeamSimStats = {
  expectedWins: number;
  expectedConferenceWins: number;
  /** winDistribution[w] = number of iterations in which the team finished with w wins. */
  winDistribution: number[];
};

export type SimResult = {
  iterations: number;
  /** Per-team results keyed by team id. */
  teams: Record<number, TeamSimStats>;
  /**
   * Replay every simulated season. The callback gets the iteration number and
   * a function mapping an index into `season.games` to the winning team id.
   * The function is only valid during the callback.
   */
  forEachIteration(cb: (iteration: number, winnerOf: (gameIndex: number) => number) => void): void;
};

/** Simulate the season `iterations` times. Deterministic for a given seed. */
export function simulateSeason(season: Season, opts: SimOptions): SimResult {
  const { iterations, seed } = opts;
  if (!Number.isInteger(iterations) || iterations < 1) throw new RangeError("iterations must be a positive integer");

  const games = season.games;
  const G = games.length;
  const byId = new Map<number, Team>(season.teams.map((t) => [t.id, t]));
  const teamIds = [...byId.keys()];
  const teamIndex = new Map<number, number>(teamIds.map((id, i) => [id, i]));
  const T = teamIds.length;

  const gameById = new Map<number, number>(games.map((g, i) => [g.id, i]));
  const locked = new Int8Array(G).fill(-1); // -1 free, 1 home wins, 0 away wins
  for (const [gid, winner] of Object.entries(opts.locks ?? {})) {
    const gi = gameById.get(Number(gid));
    if (gi === undefined) throw new Error(`lock for unknown game ${gid}`);
    const g = games[gi];
    if (winner !== g.homeId && winner !== g.awayId) throw new Error(`team ${winner} is not in game ${gid}`);
    if (g.completed) throw new Error(`game ${gid} is already final and can't be locked`);
    locked[gi] = winner === g.homeId ? 1 : 0;
  }

  // Fixed outcome (or -1) and home win probability per game.
  const fixed = new Int8Array(G);
  const prob = new Float64Array(G);
  const homeIdx = new Int32Array(G);
  const awayIdx = new Int32Array(G);
  const conf = new Uint8Array(G);
  let maxGames = 0;
  const gamesPer = new Int32Array(T);
  for (let i = 0; i < G; i++) {
    const g = games[i];
    homeIdx[i] = teamIndex.get(g.homeId) ?? -1;
    awayIdx[i] = teamIndex.get(g.awayId) ?? -1;
    if (homeIdx[i] < 0 || awayIdx[i] < 0) throw new Error(`game ${g.id} references an unknown team`);
    gamesPer[homeIdx[i]]++;
    gamesPer[awayIdx[i]]++;
    conf[i] = g.conferenceGame ? 1 : 0;
    if (g.completed) {
      if (g.homePoints === null || g.awayPoints === null) throw new Error(`completed game ${g.id} has no final score`);
      if (g.homePoints === g.awayPoints) throw new Error(`completed game ${g.id} ended in a tie`);
      fixed[i] = g.homePoints > g.awayPoints ? 1 : 0;
    }
    else if (locked[i] >= 0) fixed[i] = locked[i];
    else {
      fixed[i] = -1;
      prob[i] = probability(byId, g);
    }
  }
  for (let t = 0; t < T; t++) maxGames = Math.max(maxGames, gamesPer[t]);

  const stride = (G + 7) >> 3;
  const bits = new Uint8Array(stride * iterations);
  const dist = new Uint32Array(T * (maxGames + 1));
  const winSum = new Float64Array(T);
  const confSum = new Float64Array(T);
  const wins = new Int32Array(T);
  const cwins = new Int32Array(T);
  const rand = mulberry32(seed);

  for (let it = 0; it < iterations; it++) {
    wins.fill(0);
    cwins.fill(0);
    const base = it * stride;
    for (let i = 0; i < G; i++) {
      const f = fixed[i];
      // Draw for every game, fixed or not, so a lock changes only its own game
      // and what-if runs at the same seed stay paired.
      const r = rand();
      const homeWon = f >= 0 ? f === 1 : r < prob[i];
      const w = homeWon ? homeIdx[i] : awayIdx[i];
      if (homeWon) bits[base + (i >> 3)] |= 1 << (i & 7);
      wins[w]++;
      if (conf[i]) cwins[w]++;
    }
    for (let t = 0; t < T; t++) {
      dist[t * (maxGames + 1) + wins[t]]++;
      winSum[t] += wins[t];
      confSum[t] += cwins[t];
    }
  }

  const teams: Record<number, TeamSimStats> = {};
  for (let t = 0; t < T; t++) {
    teams[teamIds[t]] = {
      expectedWins: winSum[t] / iterations,
      expectedConferenceWins: confSum[t] / iterations,
      winDistribution: Array.from(dist.subarray(t * (maxGames + 1), (t + 1) * (maxGames + 1))),
    };
  }

  let current = 0;
  const winnerOf = (i: number): number => {
    const homeWon = (bits[current * stride + (i >> 3)] >> (i & 7)) & 1;
    return homeWon ? games[i].homeId : games[i].awayId;
  };
  return {
    iterations,
    teams,
    forEachIteration(cb) {
      for (current = 0; current < iterations; current++) cb(current, winnerOf);
    },
  };
}

// mulberry32: small, fast, seedable PRNG.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash (seed, iteration, salt) to a well-mixed 32-bit stream seed. */
export function mix(seed: number, iteration: number, salt: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(iteration + 1, 0xc2b2ae35) ^ Math.imul(salt, 0x27d4eb2f);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
