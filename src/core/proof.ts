// Exact checks, not Monte Carlo: can a team still miss (or still make) the
// conference title game under some combination of remaining results? Rating and
// coin-flip tiebreak steps count as "could go either way". Searches remaining
// conference games depth-first with pruning; gives up after a node budget and
// then reports "open" (never a false clinch or elimination).
import type { Game, Season } from "./season";
import { mulberry32 } from "./sim";
import { championshipFromData, conferenceData, type ConferenceData } from "./tiebreak";

export type ProvenStatus = "clinched" | "eliminated" | "open";

const BUDGET = 30_000;

/** `budget`: search nodes per check; a smaller one answers faster but says "open" more often. */
export function provenStatus(season: Season, conference: string, teamId: number, locks: Record<number, number> = {}, budget = BUDGET): ProvenStatus {
  const data = conferenceData(season, conference);
  if (canGetIn(data, conference, teamId, locks, true, budget)) return canFinish(data, conference, teamId, locks, true, false, { left: budget }) ? "open" : "clinched";
  return "eliminated";
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

/** One full set of conference results (game id -> winner) that puts the team in, or null if none was found. */
export function wayIn(data: ConferenceData, conference: string, teamId: number, locks: Record<number, number>, luck: boolean, budget = BUDGET): Map<number, number> | null {
  const found = new Map<number, number>();
  return canGetIn(data, conference, teamId, locks, luck, budget, found) && found.size > 0 ? found : null;
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

function canGetIn(data: ConferenceData, conference: string, teamId: number, locks: Record<number, number>, luck: boolean, budget = BUDGET, found?: Map<number, number>): boolean {
  return canFinish(data, conference, teamId, locks, false, luck, { left: budget }, found);
}

// Before searching for a way in, try this many random result sets that mostly let the team with
// fewer wins win each game. A narrow way in turns up there far sooner than in a depth-first search.
const PROBES = 300;

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
    const most = w + left.get(id)!;
    if (pct(id, most) > (id === first ? secondP : firstP) && couldTieByCount(myGames, myMin, myMax, games.get(id)!, w, most)) return false;
  }
  return true;
}

/**
 * wantOut=false: is there any result set that puts the team in? wantOut=true: any that leaves it out?
 * The team's own unlocked games go its way when looking for a way in and against it when looking for a
 * way out. `luck`: the team wins every ranking and draw step, else loses every one. Draws search nodes from
 * `pool` and leaves the rest there. Unknown (out of budget) counts as yes.
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
): boolean {
  const fixed = new Map<number, number>();
  const open: Game[] = [];
  const wins = new Map<number, number>();
  const games = new Map<number, number>();
  for (const id of data.ids) { wins.set(id, 0); games.set(id, 0); }
  for (const g of data.games) {
    games.set(g.homeId, games.get(g.homeId)! + 1);
    games.set(g.awayId, games.get(g.awayId)! + 1);
    let w: number | undefined;
    if (g.completed) w = g.homePoints! > g.awayPoints! ? g.homeId : g.awayId;
    else if (g.id in locks) w = locks[g.id];
    else if (g.homeId === teamId || g.awayId === teamId) w = wantOut ? (g.homeId === teamId ? g.awayId : g.homeId) : teamId;
    if (w === undefined) open.push(g);
    else { fixed.set(g.id, w); wins.set(w, wins.get(w)! + 1); }
  }
  // Games between the teams with the most wins first: they decide soonest whether two teams pass the team.
  const top = (g: Game) => Math.max(wins.get(g.homeId)!, wins.get(g.awayId)!);
  open.sort((x, y) => top(y) - top(x) || wins.get(y.homeId)! + wins.get(y.awayId)! - wins.get(x.homeId)! - wins.get(x.awayId)!);
  const left = new Map<number, number>();
  for (const id of data.ids) left.set(id, 0);
  for (const g of open) { left.set(g.homeId, left.get(g.homeId)! + 1); left.set(g.awayId, left.get(g.awayId)! + 1); }
  const pct = (id: number, w: number) => (games.get(id)! === 0 ? 0 : w / games.get(id)!);
  const myGames = games.get(teamId)!;
  const myWins = wins.get(teamId)!;
  const mine = pct(teamId, myWins);
  const rank = (id: number) => (id === teamId ? (luck ? Infinity : -Infinity) : 0);
  let budget = pool.left;
  let gaveUp = false;

  const dfs = (k: number): boolean => {
    if (--budget < 0) { gaveUp = true; return true; }
    let maybeAhead = 0;
    for (const id of data.ids) {
      if (id === teamId) continue;
      const w = wins.get(id)!;
      if (pct(id, w + left.get(id)!) >= mine || couldTieByCount(myGames, myWins, myWins, games.get(id)!, w, w + left.get(id)!)) maybeAhead++;
    }
    if (!wantOut && twoAhead(data.ids, teamId, myGames, myWins, myWins, games, wins, left)) return false;
    if (wantOut && maybeAhead < 2) return false;
    if (k === open.length) {
      const [a, b] = championshipFromData(data, conference, (g) => fixed.get(g.id)!, { draw: () => 0, rank });
      const ok = (a === teamId || b === teamId) !== wantOut;
      if (ok && witness) for (const [id, w] of fixed) witness.set(id, w);
      return ok;
    }
    const g = open[k];
    left.set(g.homeId, left.get(g.homeId)! - 1);
    left.set(g.awayId, left.get(g.awayId)! - 1);
    // Try first the winner with fewer wins when looking for a way in (keeps rivals down), more when looking for a way out.
    const order = (wins.get(g.homeId)! <= wins.get(g.awayId)!) !== wantOut ? [g.homeId, g.awayId] : [g.awayId, g.homeId];
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
    const rand = mulberry32(1);
    for (let r = 0; r < PROBES; r++) {
      const w2 = new Map(wins);
      const f2 = new Map(fixed);
      for (const g of open) {
        const fewer = w2.get(g.homeId)! <= w2.get(g.awayId)! ? g.homeId : g.awayId;
        const w = rand() < 0.8 ? fewer : fewer === g.homeId ? g.awayId : g.homeId;
        f2.set(g.id, w);
        w2.set(w, w2.get(w)! + 1);
      }
      const [a, b] = championshipFromData(data, conference, (g) => f2.get(g.id)!, { draw: () => 0, rank });
      if (a === teamId || b === teamId) {
        if (witness) for (const [id, w] of f2) witness.set(id, w);
        return true;
      }
    }
  }
  const r = dfs(0);
  pool.left = Math.max(0, budget);
  return r || gaveUp;
}
