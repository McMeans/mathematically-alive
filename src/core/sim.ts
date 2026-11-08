// Monte Carlo season simulator. Plays out every unplayed game many times and
// records the outcomes compactly so standings/tiebreaker code can replay them.
import { MARGIN_SD, normalCdf, winProbability } from "./odds";
import { isArmyNavy, isFlexGame, type Game, type Season, type Team } from "./season";

export const HOME_FIELD = 2.5;
const MISSING_RATING_OTHER = -10;
// Ratings are estimates. Each simulated season shifts every team's rating by a
// normal draw with this SD (points), shared by all its games, so a team that is
// better than its rating tends to win more of them. The per-game SD shrinks to
// match, so a single game's odds stay what the spread or ratings say.
const SHOCK_SD = 4;
const GAME_SD = Math.sqrt(MARGIN_SD * MARGIN_SD - 2 * SHOCK_SD * SHOCK_SD);
// Stand-in for the SportSource Team Success Ranking at season's end: a body-of-work
// measure, so it rises with the simulated record, plus noise for how it's computed.
const RANK_PER_NET_WIN = 2;
const RANK_SD = 3;

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
  return winProbability(homeSpread(byId, game), sd);
}

function ratingOf(byId: Map<number, Team>, id: number): number {
  const t = byId.get(id);
  if (t?.rating != null) return t.rating;
  return t?.classification === "fbs" ? 0 : MISSING_RATING_OTHER;
}

/** A team's strength for game odds: its rating plus what its betting lines say SP+ is missing. */
function strengthOf(byId: Map<number, Team>, id: number): number {
  return ratingOf(byId, id) + (byId.get(id)?.marketShift ?? 0);
}

/** The game's spread when it has one, else one derived from strengths and home field. */
function homeSpread(byId: Map<number, Team>, game: Game): number {
  if (game.spread !== null) return game.spread;
  const home = game.neutralSite ? 0 : HOME_FIELD;
  return -(strengthOf(byId, game.homeId) - strengthOf(byId, game.awayId)) - home;
}

/**
 * Chance team a beats team b in one simulated season, given each team's rating shift: on a neutral field, or with
 * `edgeA` points for a (HOME_FIELD when a is at home).
 */
export function neutralOdds(season: Season): (a: number, b: number, shiftA: number, shiftB: number, edgeA?: number) => number {
  const byId = new Map<number, Team>(season.teams.map((t) => [t.id, t]));
  return (a, b, shiftA, shiftB, edgeA = 0) => normalCdf((strengthOf(byId, a) + shiftA - strengthOf(byId, b) - shiftB + edgeA) / GAME_SD);
}

// Lookup tables, since the inner loop needs millions of normal draws and CDF values.
// CDF: x from -CDF_SPAN to CDF_SPAN in CDF_STEPS steps. Quantile: p from 0 to 1 in Q_STEPS steps.
const CDF_SPAN = 8;
const CDF_STEPS = 4096;
const CDF_TABLE = Float64Array.from({ length: CDF_STEPS + 1 }, (_, k) => normalCdf(-CDF_SPAN + (2 * CDF_SPAN * k) / CDF_STEPS));
const Q_STEPS = 4096;
const Q_TABLE = Float64Array.from({ length: Q_STEPS + 1 }, (_, k) => {
  const p = Math.min(Math.max(k / Q_STEPS, 1e-6), 1 - 1e-6);
  let lo = -CDF_SPAN;
  let hi = CDF_SPAN;
  for (let n = 0; n < 60; n++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
});

function fastCdf(x: number): number {
  const f = ((x + CDF_SPAN) * CDF_STEPS) / (2 * CDF_SPAN);
  if (f <= 0) return 0;
  if (f >= CDF_STEPS) return 1;
  const k = f | 0;
  return CDF_TABLE[k] + (CDF_TABLE[k + 1] - CDF_TABLE[k]) * (f - k);
}

/** A standard normal draw for (seed, iteration, salt), by table lookup of a hashed uniform. */
function normalAt(seed: number, iteration: number, salt: number): number {
  const f = (mix(seed, iteration, salt) / 4294967296) * Q_STEPS;
  const k = f | 0;
  return Q_TABLE[k] + (Q_TABLE[k + 1] - Q_TABLE[k]) * (f - k);
}
// Salts for each team's rating shift and ranking noise: SHIFT_SALT + team index, RANK_SALT + team index; the
// committee stand-in's noise (national.ts): COMMITTEE_SALT + FBS team index; each playoff game's roll:
// PLAYOFF_SALT + its place in the bracket. Each conference's tiebreak draw and
// title-game roll use salts hashed from its name (conferenceSalt), above all of these.
const SHIFT_SALT = 1 << 20;
const RANK_SALT = 1 << 21;
export const COMMITTEE_SALT = 1 << 22;
export const PLAYOFF_SALT = 1 << 23;

const salts = new Map<string, number>();
/** An even salt in [2^30, 2^31) from the conference's name (FNV-1a), so each conference has its own streams. */
function conferenceSalt(conference: string): number {
  let s = salts.get(conference);
  if (s === undefined) {
    let h = 0x811c9dc5;
    for (let i = 0; i < conference.length; i++) h = Math.imul(h ^ conference.charCodeAt(i), 0x01000193);
    s = 0x40000000 | (h & 0x3ffffffe);
    salts.set(conference, s);
  }
  return s;
}

/** The conference's tiebreak draw stream for one simulated season. Every caller uses this, so their draws agree. */
export const tiebreakDraw = (seed: number, iteration: number, conference: string): (() => number) =>
  mulberry32(mix(seed, iteration, conferenceSalt(conference)));

/** The uniform draw that settles the conference's title game in one simulated season. */
export const titleRoll = (seed: number, iteration: number, conference: string): number =>
  mulberry32(mix(seed, iteration, conferenceSalt(conference) + 1))();

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
  forEachIteration(cb: (iteration: number, winnerOf: (gameIndex: number) => number, season: IterationTeams) => void): void;
};

/** Per-team values of one simulated season. Valid only during the forEachIteration callback. */
export type IterationTeams = {
  /** Points added to the team's rating in this season. */
  shift(teamId: number): number;
  /** Season-end ranking stand-in for the tiebreaker's ranking step; higher is better. */
  rank(teamId: number): number;
  /** `rank` as if the game at index `flip` into `season.games` had gone the other way. */
  rankIf(teamId: number, flip: number): number;
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
  const spread = new Float64Array(G);
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
      spread[i] = homeSpread(byId, g);
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
  const shift = new Float64Array(T);
  // A team's shift is one hashed draw per (seed, iteration, team): the same value `IterationTeams.shift`
  // and `rank` return later. Teams with no game left to simulate have nothing to use it for here, so their
  // slots aren't filled; they still get that same shift for ranking and the title game.
  const active = Int32Array.from(new Set(Array.from({ length: G }, (_, i) => i).filter((i) => fixed[i] < 0).flatMap((i) => [homeIdx[i], awayIdx[i]])));

  for (let it = 0; it < iterations; it++) {
    wins.fill(0);
    cwins.fill(0);
    const base = it * stride;
    // Rating shifts are hashed from (seed, iteration, team), so locks never change them.
    for (let j = 0; j < active.length; j++) shift[active[j]] = SHOCK_SD * normalAt(seed, it, SHIFT_SALT + active[j]);
    for (let i = 0; i < G; i++) {
      const f = fixed[i];
      // Draw for every game, fixed or not, so a lock changes only its own game
      // and what-if runs at the same seed stay paired.
      const r = rand();
      const homeWon = f >= 0 ? f === 1 : r < fastCdf((shift[homeIdx[i]] - shift[awayIdx[i]] - spread[i]) / GAME_SD);
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
  const homeWonAt = (i: number): boolean => ((bits[current * stride + (i >> 3)] >> (i & 7)) & 1) === 1;
  const winnerOf = (i: number): number => (homeWonAt(i) ? games[i].homeId : games[i].awayId);
  // Shifts and ranks are worked out per team, only when asked for.
  const rating = Float64Array.from(teamIds, (id) => ratingOf(byId, id));
  const gamesOf: number[][] = teamIds.map(() => []);
  // Army-Navy and the Pac-12's flex week come after their conference's tiebreak, so they are left out of the ranking stand-in.
  for (let i = 0; i < G; i++) {
    const h = byId.get(games[i].homeId);
    const a = byId.get(games[i].awayId);
    if (isArmyNavy(h?.name, a?.name) || isFlexGame(season.year, games[i].week, h?.conference, a?.conference)) continue;
    gamesOf[homeIdx[i]].push(i);
    gamesOf[awayIdx[i]].push(i);
  }
  const indexOf = (id: number): number => {
    const t = teamIndex.get(id);
    if (t === undefined) throw new Error(`unknown team ${id}`);
    return t;
  };
  const shiftAt = (t: number): number => SHOCK_SD * normalAt(seed, current, SHIFT_SALT + t);
  const rankAt = (id: number, flip: number): number => {
    const t = indexOf(id);
    let net = 0;
    for (const i of gamesOf[t]) net += ((homeWonAt(i) !== (i === flip)) === (homeIdx[i] === t)) ? 1 : -1;
    return rating[t] + shiftAt(t) + RANK_PER_NET_WIN * net + RANK_SD * normalAt(seed, current, RANK_SALT + t);
  };
  const teamsNow: IterationTeams = {
    shift: (id) => shiftAt(indexOf(id)),
    rank: (id) => rankAt(id, -1),
    rankIf: rankAt,
  };
  return {
    iterations,
    teams,
    forEachIteration(cb) {
      for (current = 0; current < iterations; current++) cb(current, winnerOf, teamsNow);
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
