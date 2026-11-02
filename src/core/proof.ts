// Exact checks, not Monte Carlo: can a team still miss (or still make) the
// conference title game under some combination of remaining results, its own
// included? Rating and coin-flip tiebreak steps count as "could go either way".
// Searches remaining conference games depth-first, cutting a branch early once a
// matching argument shows its answer; gives up after a node budget and then
// reports "open" (never a false clinch or elimination).
import type { Game, Season } from "./season";
import { mulberry32 } from "./sim";
import { championshipFromData, conferenceData, type ConferenceData } from "./tiebreak";

export type ProvenStatus = "clinched" | "eliminated" | "open";

const BUDGET = 30_000;

/** `budget`: search nodes per check; a smaller one answers faster but says "open" more often. */
export function provenStatus(season: Season, conference: string, teamId: number, locks: Record<number, number> = {}, budget = BUDGET): ProvenStatus {
  const data = conferenceData(season, conference);
  if (!canGetIn(data, conference, teamId, locks, true, budget)) return "eliminated";
  if (!canFinish(data, conference, teamId, locks, true, false, { left: budget })) return "clinched";
  return oneRivalLeft(data, conference, teamId, locks, budget) ? "clinched" : "open";
}

/**
 * Two teams play for the title, so when at most one other team can still get in, the team is in. Catches
 * clinches the search above runs out of budget on: each other team's elimination is a smaller search.
 */
function oneRivalLeft(data: ConferenceData, conference: string, teamId: number, locks: Record<number, number>, budget: number): boolean {
  let rivals = 0;
  for (const id of data.ids) {
    if (id === teamId) continue;
    // Out of budget counts as "can get in", so the answer stays a proof.
    if (canGetIn(data, conference, id, locks, true, budget) && ++rivals > 1) return false;
  }
  return true;
}

/**
 * True when the team makes the title game whatever happens in the games not locked (its own
 * unlocked games included). `luck`: the team wins every ranking and draw step; otherwise it loses every one.
 */
export function guaranteed(
  data: ConferenceData,
  conference: string,
  teamId: number,
  locks: Record<number, number>,
  luck: boolean,
  pool: { left: number } = { left: BUDGET },
): boolean {
  return !canFinish(data, conference, teamId, locks, true, luck, pool);
}

/**
 * One full set of conference results (game id -> winner) that puts the team in under the first draw order,
 * or null if none was found. A search for an example, not a proof: other draw orders aren't tried.
 */
export function wayIn(data: ConferenceData, conference: string, teamId: number, locks: Record<number, number>, luck: boolean, budget = BUDGET): Map<number, number> | null {
  const found = new Map<number, number>();
  return canFinish(data, conference, teamId, locks, false, luck, { left: budget }, found, false) && found.size > 0 ? found : null;
}

/**
 * Could a and b end up "tied" through the alternate-game-count rule: different numbers of conference
 * games but the same wins or the same losses? Each side gives its scheduled games and final-win range.
 */
export function couldTieByCount(gA: number, minA: number, maxA: number, gB: number, minB: number, maxB: number): boolean {
  if (gA === gB) return false;
  const winsOverlap = minA <= maxB && minB <= maxA;
  const lossesOverlap = gA - maxA <= gB - minB && gB - maxB <= gA - minA;
  return winsOverlap || lossesOverlap;
}

function canGetIn(data: ConferenceData, conference: string, teamId: number, locks: Record<number, number>, luck: boolean, budget = BUDGET): boolean {
  return canFinish(data, conference, teamId, locks, false, luck, { left: budget });
}

// Before searching for a way in, try this many random result sets that mostly let the team with
// fewer wins win each game. A narrow way in turns up there far sooner than in a depth-first search.
const PROBES = 300;

// Leaves with more draw outcomes than this count as "could go either way" (yes), never a false answer.
const MAX_DRAWS = 2_000;

/**
 * Is there some way the draws go (each pick among tied teams, the team aside, either way) that puts
 * the team in, or with `out`, leaves it out? The team wins its ranking and draw steps with `luck`,
 * loses them without. Too many draw outcomes to try counts as yes.
 */
function someDraw(data: ConferenceData, conference: string, teamId: number, winnerOf: (g: Game) => number, luck: boolean, out: boolean): boolean {
  if (surelyOut(data, teamId, winnerOf)) return out;
  const rank = (id: number) => (id === teamId ? (luck ? Infinity : -Infinity) : 0);
  const choice: number[] = [];
  for (let tries = 0; tries < MAX_DRAWS; tries++) {
    const counts: number[] = [];
    const draw = (count: number) => {
      const j = counts.length;
      counts.push(count);
      choice[j] ??= 0;
      return (choice[j] + 0.5) / count;
    };
    const [a, b] = championshipFromData(data, conference, winnerOf, { draw, rank });
    if ((a === teamId || b === teamId) !== out) return true;
    // Next draw outcome: like an odometer over this run's draws, later ones starting over.
    choice.length = counts.length;
    let i = counts.length - 1;
    while (i >= 0 && choice[i] + 1 >= counts[i]) { choice.pop(); i--; }
    if (i < 0) return false;
    choice[i]++;
  }
  return true;
}

/**
 * With every game decided: two teams with a better win percentage leave the team out whatever the
 * tiebreakers do, unless the game-count rule puts it with the top team (that team alone at the top,
 * a different number of games, the same wins or losses).
 */
function surelyOut(data: ConferenceData, teamId: number, winnerOf: (g: Game) => number): boolean {
  const wins = new Map<number, number>();
  const games = new Map<number, number>();
  for (const id of data.ids) { wins.set(id, 0); games.set(id, 0); }
  for (const g of data.games) {
    games.set(g.homeId, games.get(g.homeId)! + 1);
    games.set(g.awayId, games.get(g.awayId)! + 1);
    const w = winnerOf(g);
    wins.set(w, wins.get(w)! + 1);
  }
  const pct = (id: number) => (games.get(id)! === 0 ? 0 : wins.get(id)! / games.get(id)!);
  const mine = pct(teamId);
  let above = 0;
  let top = -1;
  let topP = -Infinity;
  let topTied = false;
  for (const id of data.ids) {
    if (id === teamId) continue;
    const p = pct(id);
    if (p > mine) above++;
    if (p > topP) { topP = p; top = id; topTied = false; }
    else if (p === topP) topTied = true;
  }
  if (above < 2) return false;
  if (topTied || games.get(top) === games.get(teamId)) return true;
  const sameWins = wins.get(top) === wins.get(teamId);
  const sameLosses = games.get(top)! - wins.get(top)! === games.get(teamId)! - wins.get(teamId)!;
  return !sameWins && !sameLosses;
}

/** Is the team in under the first draw order (each pick among tied teams goes to the first of them)? */
function firstDraw(data: ConferenceData, conference: string, teamId: number, winnerOf: (g: Game) => number, luck: boolean): boolean {
  const [a, b] = championshipFromData(data, conference, winnerOf, { draw: () => 0, rank: (id) => (id === teamId ? (luck ? Infinity : -Infinity) : 0) });
  return a === teamId || b === teamId;
}

/** Is the team in whatever way the draws go, given every game's winner? `luck` as for someDraw. */
export function inEveryDraw(data: ConferenceData, conference: string, teamId: number, winnerOf: (g: Game) => number, luck: boolean): boolean {
  return !someDraw(data, conference, teamId, winnerOf, luck, true);
}

/**
 * True when two teams are surely ahead of the team and it can't be pulled up into a tied group either.
 * Two teams already have a better win percentage than the team's best. The only way past them is the
 * alternate-game-count rule: a team X with a different number of games and the same wins or losses
 * makes the team one of X's "Tied Teams". Extras like that are only ever placed when the whole tied
 * group fits the open spots, so the group must be exactly {X, team}: X alone at the top, above every
 * other team that's ahead.
 */
export function twoAhead(
  ids: Iterable<number>,
  teamId: number,
  myGames: number,
  myMin: number,
  myMax: number,
  games: Map<number, number>,
  wins: Map<number, number>,
  left: Map<number, number>,
): boolean {
  const pct = (id: number, w: number) => (games.get(id)! === 0 ? 0 : w / games.get(id)!);
  const best = pct(teamId, myMax);
  // The two best percentages among teams ahead, and who holds the best.
  let count = 0;
  let first = -1;
  let firstP = -Infinity;
  let secondP = -Infinity;
  for (const id of ids) {
    if (id === teamId) continue;
    const p = pct(id, wins.get(id)!);
    if (p <= best) continue;
    count++;
    if (p > firstP) { secondP = firstP; firstP = p; first = id; }
    else if (p > secondP) secondP = p;
  }
  if (count < 2) return false;
  for (const id of ids) {
    if (id === teamId) continue;
    const w = wins.get(id)!;
    if (tieRouteOpen(myGames, myMin, myMax, games.get(id)!, w, w + left.get(id)!, id === first ? secondP : firstP)) return false;
  }
  return true;
}

// The early stops below assume conference schedules differ by at most one game (the ACC: 8 or 9).
// With a wider spread, a lower-ranked team could be placed through another team's "Tied Teams" group,
// so the stop that proves a team in is switched off.
export const MAX_SPREAD = 1;

/**
 * True when the team can't make the top two whatever happens in `open` (its own games there are
 * assumed won, its best case): every way the other games go leaves two teams with a better win
 * percentage. Max flow: each game hands its win to one of its teams; a team takes at most the wins
 * that keep it at or below the team's best, except one team allowed past it, tried in turn. Skipped
 * (false) when the alternate-game-count rule could still pull the team into the top group.
 */
function cannotGetIn(
  ids: number[],
  teamId: number,
  myGames: number,
  myMin: number,
  myMax: number,
  games: Map<number, number>,
  wins: Map<number, number>,
  left: Map<number, number>,
  open: Game[],
  from: number,
): boolean {
  const pct = (id: number, w: number) => (games.get(id)! === 0 ? 0 : w / games.get(id)!);
  const best = pct(teamId, myMax);
  const others = ids.filter((id) => id !== teamId);
  // The {X, team} route: X alone at the top, the team tied with X by game count.
  for (const x of others) {
    let top = -Infinity;
    for (const y of others) if (y !== x) top = Math.max(top, pct(y, wins.get(y)!));
    if (tieRouteOpen(myGames, myMin, myMax, games.get(x)!, wins.get(x)!, wins.get(x)! + left.get(x)!, top)) return false;
  }
  const index = new Map(others.map((id, i) => [id, i]));
  const cap = Int32Array.from(others, (id) => Math.floor(best * games.get(id)! + 1e-9) - wins.get(id)!);
  const over = others.flatMap((_, i) => (cap[i] < 0 ? [i] : []));
  if (over.length >= 2) return true;
  const pairs: [number, number][] = [];
  for (let k = from; k < open.length; k++) {
    const g = open[k];
    if (g.homeId !== teamId && g.awayId !== teamId) pairs.push([index.get(g.homeId)!, index.get(g.awayId)!]);
  }
  const candidates = over.length === 1 ? over : [-1, ...others.map((_, i) => i)];
  return !candidates.some((free) => placeAll(pairs, cap, free));
}

/**
 * Could X finish with one record that both puts it above `top` (every other team's lowest possible
 * percentage) and ties the team by game count (same wins or same losses, different number of games)?
 */
function tieRouteOpen(myGames: number, myMin: number, myMax: number, xGames: number, xMin: number, xMax: number, top: number): boolean {
  if (xGames === myGames || xGames === 0) return false;
  for (let w = xMin; w <= xMax; w++) {
    if (w / xGames <= top) continue;
    const losses = xGames - w;
    if ((w >= myMin && w <= myMax) || (losses >= myGames - myMax && losses <= myGames - myMin)) return true;
  }
  return false;
}

/** Can every game's win go to one of its two teams without any team passing its cap? `free` has no cap. */
function placeAll(pairs: [number, number][], cap: Int32Array, free: number): boolean {
  const owner = new Int32Array(pairs.length).fill(-1);
  const load = new Int32Array(cap.length);
  const held: number[][] = Array.from(cap, () => []);
  const give = (gi: number, t: number) => {
    const was = owner[gi];
    if (was >= 0) {
      load[was]--;
      held[was].splice(held[was].indexOf(gi), 1);
    }
    owner[gi] = t;
    load[t]++;
    held[t].push(gi);
  };
  const place = (gi: number, seen: Uint8Array): boolean => {
    for (const t of pairs[gi]) {
      if (seen[t]) continue;
      seen[t] = 1;
      if (t === free || load[t] < cap[t]) { give(gi, t); return true; }
      // t is full: move one of its games to that game's other team, then take the freed spot.
      for (const gj of [...held[t]]) {
        if (place(gj, seen)) { give(gi, t); return true; }
      }
    }
    return false;
  };
  for (let gi = 0; gi < pairs.length; gi++) if (!place(gi, new Uint8Array(cap.length))) return false;
  return true;
}

/**
 * True when the team is in whatever happens in `open` (its own games there assumed lost, its worst case):
 * no two other teams can both finish at or above its win percentage, or tie it through the game-count
 * rule. Exact for a pair: each needs some more wins from its own games, and the games between them
 * can only go to one.
 */
function cannotMissOut(
  ids: number[],
  teamId: number,
  myGames: number,
  myMin: number,
  games: Map<number, number>,
  wins: Map<number, number>,
  left: Map<number, number>,
  open: Game[],
  from: number,
): boolean {
  const mine = games.get(teamId)! === 0 ? 0 : myMin / games.get(teamId)!;
  const need = new Map<number, number>();
  for (const id of ids) {
    if (id === teamId) continue;
    const w = wins.get(id)!;
    const l = left.get(id)!;
    const n = couldTieByCount(myGames, myMin, myMin, games.get(id)!, w, w + l) ? 0 : Math.max(0, Math.ceil(mine * games.get(id)! - 1e-9) - w);
    if (n <= l) need.set(id, n);
  }
  if (need.size < 2) return true;
  const shared = new Map<string, number>();
  for (let k = from; k < open.length; k++) {
    const g = open[k];
    if (need.has(g.homeId) && need.has(g.awayId)) {
      const key = g.homeId < g.awayId ? `${g.homeId}:${g.awayId}` : `${g.awayId}:${g.homeId}`;
      shared.set(key, (shared.get(key) ?? 0) + 1);
    }
  }
  const cands = [...need.keys()];
  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const [a, b] = [cands[i], cands[j]];
      const both = shared.get(a < b ? `${a}:${b}` : `${b}:${a}`) ?? 0;
      if (need.get(a)! + need.get(b)! <= left.get(a)! + left.get(b)! - both) return false;
    }
  }
  return true;
}

/**
 * wantOut=false: is there any result set that puts the team in? wantOut=true: any that leaves it out?
 * Every unlocked game is searched, the team's own included (its own go its way first when looking for a
 * way in, against it first when looking for a way out). `luck`: the team wins every ranking and draw
 * step, else loses every one. Draws search nodes from `pool` and leaves the rest there. Unknown (out of
 * budget) counts as yes.
 */
function canFinish(
  data: ConferenceData,
  conference: string,
  teamId: number,
  locks: Record<number, number>,
  wantOut: boolean,
  luck: boolean,
  pool: { left: number } = { left: BUDGET },
  witness?: Map<number, number>,
  everyDraw = true,
): boolean {
  const ids = [...data.ids];
  const fixed = new Map<number, number>();
  const open: Game[] = [];
  const wins = new Map<number, number>();
  const games = new Map<number, number>();
  for (const id of ids) { wins.set(id, 0); games.set(id, 0); }
  for (const g of data.games) {
    games.set(g.homeId, games.get(g.homeId)! + 1);
    games.set(g.awayId, games.get(g.awayId)! + 1);
    let w: number | undefined;
    if (g.completed) w = g.homePoints! > g.awayPoints! ? g.homeId : g.awayId;
    else if (g.id in locks) w = locks[g.id];
    if (w === undefined) open.push(g);
    else { fixed.set(g.id, w); wins.set(w, wins.get(w)! + 1); }
  }
  const counts = [...games.values()];
  const spreadOk = Math.max(...counts) - Math.min(...counts) <= MAX_SPREAD;
  // The team's own games first, then games between the teams with the most wins: those decide soonest.
  const isOwn = (g: Game) => g.homeId === teamId || g.awayId === teamId;
  const top = (g: Game) => Math.max(wins.get(g.homeId)!, wins.get(g.awayId)!);
  open.sort((x, y) => Number(isOwn(y)) - Number(isOwn(x)) || top(y) - top(x) || wins.get(y.homeId)! + wins.get(y.awayId)! - wins.get(x.homeId)! - wins.get(x.awayId)!);
  const left = new Map<number, number>();
  for (const id of ids) left.set(id, 0);
  for (const g of open) { left.set(g.homeId, left.get(g.homeId)! + 1); left.set(g.awayId, left.get(g.awayId)! + 1); }
  const myGames = games.get(teamId)!;
  let budget = pool.left;
  let gaveUp = false;

  const dfs = (k: number): boolean => {
    if (--budget < 0) { gaveUp = true; return true; }
    const myMin = wins.get(teamId)!;
    const myMax = myMin + left.get(teamId)!;
    if (!wantOut && cannotGetIn(ids, teamId, myGames, myMin, myMax, games, wins, left, open, k)) return false;
    if (wantOut && spreadOk && cannotMissOut(ids, teamId, myGames, myMin, games, wins, left, open, k)) return false;
    if (k === open.length) {
      const ok = everyDraw
        ? someDraw(data, conference, teamId, (g) => fixed.get(g.id)!, luck, wantOut)
        : firstDraw(data, conference, teamId, (g) => fixed.get(g.id)!, luck) !== wantOut;
      if (ok && witness) for (const [id, w] of fixed) witness.set(id, w);
      return ok;
    }
    const g = open[k];
    left.set(g.homeId, left.get(g.homeId)! - 1);
    left.set(g.awayId, left.get(g.awayId)! - 1);
    // The team's own game: its win first when looking for a way in, its loss first when looking for a way out.
    // Elsewhere: the winner with fewer wins first for a way in (keeps rivals down), more for a way out.
    const order = isOwn(g)
      ? (g.homeId === teamId) !== wantOut ? [g.homeId, g.awayId] : [g.awayId, g.homeId]
      : (wins.get(g.homeId)! <= wins.get(g.awayId)!) !== wantOut ? [g.homeId, g.awayId] : [g.awayId, g.homeId];
    let found = false;
    for (const w of order) {
      fixed.set(g.id, w);
      wins.set(w, wins.get(w)! + 1);
      found = dfs(k + 1);
      wins.set(w, wins.get(w)! - 1);
      if (found) break;
    }
    fixed.delete(g.id);
    left.set(g.homeId, left.get(g.homeId)! + 1);
    left.set(g.awayId, left.get(g.awayId)! + 1);
    return found;
  };
  if (!wantOut) {
    // The team wins its own games; elsewhere the team with fewer wins mostly wins.
    const rand = mulberry32(1);
    for (let r = 0; r < PROBES; r++) {
      const w2 = new Map(wins);
      const f2 = new Map(fixed);
      for (const g of open) {
        const fewer = w2.get(g.homeId)! <= w2.get(g.awayId)! ? g.homeId : g.awayId;
        const w = isOwn(g) ? teamId : rand() < 0.8 ? fewer : fewer === g.homeId ? g.awayId : g.homeId;
        f2.set(g.id, w);
        w2.set(w, w2.get(w)! + 1);
      }
      // One draw order is enough here: a probe only has to find some way in, never rule one out.
      if (firstDraw(data, conference, teamId, (g) => f2.get(g.id)!, luck)) {
        if (witness) for (const [id, w] of f2) witness.set(id, w);
        return true;
      }
    }
  }
  const r = dfs(0);
  pool.left = Math.max(0, budget);
  return r || gaveUp;
}
