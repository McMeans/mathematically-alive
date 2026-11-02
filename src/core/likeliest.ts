// Likeliest way in, found by search rather than sampled: the most probable combination of
// remaining conference results that puts the team in the title game (game odds multiplied).
// Starts from any way in the proof finds, flips results toward the likelier side while the team
// stays in, then improves it by branch and bound within a node budget.
//
// The way is then trimmed to the results the team's spot depends on. Each result left is needed:
// drop it and some combination of the rest keeps the team out.
import { couldTieByCount, guaranteed, inEveryDraw, twoAhead, wayIn } from "./proof";
import type { Game } from "./season";
import type { ConferenceData } from "./tiebreak";

const BUDGET = 4_000;
const WITNESS_BUDGET = 50_000;
// Trimming: each check gets CHECK_BUDGET nodes, all of them TRIM_BUDGET. A check that runs out
// keeps its result, so the list still gets the team in; it may name a result it doesn't need.
const CHECK_BUDGET = 30_000;
const TRIM_BUDGET = 150_000;

export type WayIn = {
  picks: { gameId: number; winner: number }[];
  /**
   * Chance that every picked result happens: their game odds multiplied, as if independent. The simulation
   * links one team's games through its season rating shift, so a way that needs several results from the
   * same team can be a little likelier (all its wins, say) or less likely than this says.
   */
  chance: number;
  /** Picked results that go against the likelier side. */
  upsets: number;
  /** True when the picks get the team in only if it also wins its ranking and draw tiebreak steps. */
  needsTiebreak: boolean;
};

export type Choice = { g: Game; pHome: number };

/**
 * `games`: the unplayed, unlocked conference games to pick results for, in search order (the most
 * important first), each with its home win probability. `starts`: candidate ways in to begin from
 * (winners in `games` order), such as simulated seasons the team got in; the better the start, the
 * more of the search the bound cuts off. `luck`: the team wins every ranking and draw step; otherwise
 * the picks must get it in however those go. Null when no way in exists. When the search runs out of
 * budget it returns the likeliest way found so far. The way picks every game; `trimWay` cuts it down.
 */
export function likeliestWayIn(
  data: ConferenceData,
  conference: string,
  teamId: number,
  locks: Record<number, number>,
  games: Choice[],
  luck: boolean,
  starts: number[][] = [],
): WayIn | null {
  const best = search(data, conference, teamId, locks, games, luck, starts);
  return best && summary(games, best, () => true, luck);
}

/**
 * The way cut down to the results the team's spot depends on (each one left is needed). `quick`: a
 * tenth of the budget, for comparing ways; it may keep results that aren't needed.
 */
export function trimWay(data: ConferenceData, conference: string, teamId: number, locks: Record<number, number>, games: Choice[], way: WayIn, quick = false): WayIn {
  const winner = new Map(way.picks.map((p) => [p.gameId, p.winner]));
  return trim(data, conference, teamId, locks, games, games.map(({ g }) => winner.get(g.id)!), way.needsTiebreak, quick ? TRIM_BUDGET / 10 : TRIM_BUDGET);
}

/** The picks in `games` that `keep` keeps, with the chance they all happen. */
function summary(games: Choice[], winners: number[], keep: (gameId: number) => boolean, luck: boolean): WayIn {
  let chance = 1;
  let upsets = 0;
  const picks: WayIn["picks"] = [];
  games.forEach(({ g, pHome }, k) => {
    if (!keep(g.id)) return;
    const p = winners[k] === g.homeId ? pHome : 1 - pHome;
    picks.push({ gameId: g.id, winner: winners[k] });
    chance *= p;
    if (p < 0.5 - 1e-9) upsets++;
  });
  return { picks, chance, upsets, needsTiebreak: luck };
}

/** Cost of a result: how much less likely it is than the likelier side (0 for the likelier side). */
const cost = (p: number, other: number): number => Math.log(Math.max(p, other)) - Math.log(Math.max(p, 1e-12));

function search(data: ConferenceData, conference: string, teamId: number, locks: Record<number, number>, games: Choice[], luck: boolean, starts: number[][]): number[] | null {
  const ids = [...data.ids];
  const wins = new Map<number, number>(ids.map((id) => [id, 0]));
  const scheduled = new Map<number, number>(ids.map((id) => [id, 0]));
  const left = new Map<number, number>(ids.map((id) => [id, 0]));
  const fixed = new Map<number, number>();
  for (const g of data.games) {
    scheduled.set(g.homeId, scheduled.get(g.homeId)! + 1);
    scheduled.set(g.awayId, scheduled.get(g.awayId)! + 1);
    const w = g.completed ? (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId) : locks[g.id];
    if (w !== undefined) { fixed.set(g.id, w); wins.set(w, wins.get(w)! + 1); }
  }
  for (const { g } of games) { left.set(g.homeId, left.get(g.homeId)! + 1); left.set(g.awayId, left.get(g.awayId)! + 1); }
  const pct = (id: number, w: number) => (scheduled.get(id)! === 0 ? 0 : w / scheduled.get(id)!);
  const myGames = scheduled.get(teamId)!;
  const likely = games.map(({ g, pHome }) => (pHome >= 0.5 ? g.homeId : g.awayId));
  const choice = new Array<number>(games.length);
  const witness = wayIn(data, conference, teamId, locks, luck, WITNESS_BUDGET);
  if (!witness) return null;
  const costs = games.map(({ g, pHome }) => (w: number) => (w === g.homeId ? cost(pHome, 1 - pHome) : cost(1 - pHome, pHome)));
  const total = (ws: number[]) => ws.reduce((sum, w, k) => sum + costs[k](w), 0);
  const isIn = (ws: number[]): boolean => {
    const all = new Map(fixed);
    games.forEach(({ g }, k) => all.set(g.id, ws[k]));
    return inEveryDraw(data, conference, teamId, (g) => all.get(g.id)!, luck);
  };
  // Flip results to the likelier side, costliest first, as long as the team stays in.
  const climb = (start: number[]): number[] => {
    let cur = start;
    for (let improved = true; improved; ) {
      improved = false;
      const order = games.map((_, k) => k).sort((x, y) => costs[y](cur[y]) - costs[x](cur[x]));
      for (const k of order) {
        if (cur[k] === likely[k]) continue;
        const next = cur.slice();
        next[k] = likely[k];
        if (isIn(next)) { cur = next; improved = true; }
      }
    }
    return cur;
  };
  // The proof's way in holds for some draw; the search wants one that holds for every draw. Climb from
  // it and from each start that holds, and keep the likeliest: the bound for the search below.
  let best: number[] | null = null;
  let bestCost = Infinity;
  const seen = new Set<string>();
  for (const start of [games.map(({ g }) => witness.get(g.id)!), ...starts]) {
    const key = start.join();
    if (seen.has(key) || !isIn(start)) continue;
    seen.add(key);
    const way = climb(start);
    const c = total(way);
    if (c < bestCost) { best = way; bestCost = c; }
  }
  let budget = BUDGET;

  const dfs = (k: number, spent: number): void => {
    if (--budget < 0 || spent >= bestCost) return;
    const myMin = wins.get(teamId)!;
    const myMax = myMin + left.get(teamId)!;
    let maybeAhead = 0;
    for (const id of ids) {
      if (id === teamId) continue;
      const w = wins.get(id)!;
      const most = w + left.get(id)!;
      if (pct(id, most) >= pct(teamId, myMin) || couldTieByCount(myGames, myMin, myMax, scheduled.get(id)!, w, most)) maybeAhead++;
    }
    if (twoAhead(ids, teamId, myGames, myMin, myMax, scheduled, wins, left)) return;
    // In whatever happens from here: the rest go the likelier way, at no extra cost.
    if (maybeAhead < 2 || k === games.length) {
      if (k === games.length) {
        if (!inEveryDraw(data, conference, teamId, (g) => fixed.get(g.id)!, luck)) return;
      }
      best = [...choice.slice(0, k), ...likely.slice(k)];
      bestCost = spent;
      return;
    }
    const { g, pHome } = games[k];
    left.set(g.homeId, left.get(g.homeId)! - 1);
    left.set(g.awayId, left.get(g.awayId)! - 1);
    const sides = likely[k] === g.homeId ? [g.homeId, g.awayId] : [g.awayId, g.homeId];
    for (const w of sides) {
      const p = w === g.homeId ? pHome : 1 - pHome;
      choice[k] = w;
      fixed.set(g.id, w);
      wins.set(w, wins.get(w)! + 1);
      dfs(k + 1, spent + cost(p, 1 - p));
      wins.set(w, wins.get(w)! - 1);
    }
    fixed.delete(g.id);
    left.set(g.homeId, left.get(g.homeId)! + 1);
    left.set(g.awayId, left.get(g.awayId)! + 1);
  };
  dfs(0, 0);
  return best as number[] | null;
}

/** Drop each picked result the spot doesn't depend on, trying the least likely ones first. */
function trim(
  data: ConferenceData,
  conference: string,
  teamId: number,
  locks: Record<number, number>,
  games: Choice[],
  winners: number[],
  luck: boolean,
  budget: number,
): WayIn {
  const prob = games.map(({ g, pHome }, k) => (winners[k] === g.homeId ? pHome : 1 - pHome));
  const kept = new Map<number, number>(games.map(({ g }, k) => [g.id, winners[k]]));
  const order = games.map((_, k) => k).sort((x, y) => prob[x] - prob[y] || x - y);
  const pool = { left: budget };
  for (const k of order) {
    if (pool.left === 0) break;
    const id = games[k].g.id;
    const w = kept.get(id)!;
    kept.delete(id);
    const check = { left: Math.min(CHECK_BUDGET, pool.left) };
    pool.left -= check.left;
    // The kept results already get the team in, so dropping this one is safe exactly when the other
    // result gets it in too. Proving that one result leaves one game fewer to search than leaving it open.
    const g = games[k].g;
    const ok = guaranteed(data, conference, teamId, { ...locks, ...Object.fromEntries(kept), [id]: w === g.homeId ? g.awayId : g.homeId }, luck, check);
    pool.left += check.left;
    if (!ok) kept.set(id, w);
  }
  return summary(games, winners, (id) => kept.has(id), luck);
}
