// Exact checks, not Monte Carlo: can a team still miss (or still make) the
// conference title game under some combination of remaining results? Rating and
// coin-flip tiebreak steps count as "could go either way". Searches remaining
// conference games depth-first with pruning; gives up after a node budget and
// then reports "open" (never a false clinch or elimination).
import type { Game, Season } from "./season";
import { championshipFromData, conferenceData, type ConferenceData } from "./tiebreak";

export type ProvenStatus = "clinched" | "eliminated" | "open";

const BUDGET = 200_000;

export function provenStatus(season: Season, conference: string, teamId: number, locks: Record<number, number> = {}): ProvenStatus {
  const data = conferenceData(season, conference);
  if (canFinish(data, conference, teamId, locks, false)) return canFinish(data, conference, teamId, locks, true) ? "open" : "clinched";
  return "eliminated";
}

/** wantOut=false: is there any result set that puts the team in? wantOut=true: any that leaves it out? Unknown (budget) counts as yes. */
function canFinish(data: ConferenceData, conference: string, teamId: number, locks: Record<number, number>, wantOut: boolean): boolean {
  const fixed = new Map<number, number>();
  const open: Game[] = [];
  const wins = new Map<number, number>();
  const games = new Map<number, number>();
  for (const id of data.ids) { wins.set(id, 0); games.set(id, 0); }
  const add = (g: Game, w: number) => { wins.set(w, wins.get(w)! + 1); };
  for (const g of data.games) {
    games.set(g.homeId, games.get(g.homeId)! + 1);
    games.set(g.awayId, games.get(g.awayId)! + 1);
    let w: number | undefined;
    if (g.completed) w = g.homePoints! > g.awayPoints! ? g.homeId : g.awayId;
    else if (g.id in locks) w = locks[g.id];
    else if (g.homeId === teamId || g.awayId === teamId) w = wantOut ? (g.homeId === teamId ? g.awayId : g.homeId) : teamId;
    if (w === undefined) open.push(g);
    else { fixed.set(g.id, w); add(g, w); }
  }
  const left = new Map<number, number>();
  for (const id of data.ids) left.set(id, 0);
  for (const g of open) { left.set(g.homeId, left.get(g.homeId)! + 1); left.set(g.awayId, left.get(g.awayId)! + 1); }
  const pct = (id: number, w: number) => (games.get(id)! === 0 ? 0 : w / games.get(id)!);
  const mine = pct(teamId, wins.get(teamId)!);
  // The team gets every rating/draw step when looking for a way in, and loses every one when looking for a way out.
  const rank = (id: number) => (id === teamId ? (wantOut ? -Infinity : Infinity) : 0);
  let budget = BUDGET;
  let gaveUp = false;

  const dfs = (k: number): boolean => {
    if (--budget < 0) { gaveUp = true; return true; }
    let surelyAhead = 0;
    let maybeAhead = 0;
    for (const id of data.ids) {
      if (id === teamId) continue;
      if (pct(id, wins.get(id)!) > mine) surelyAhead++;
      if (pct(id, wins.get(id)! + left.get(id)!) >= mine) maybeAhead++;
    }
    if (!wantOut && surelyAhead >= 2) return false;
    if (wantOut && maybeAhead < 2) return false;
    if (k === open.length) {
      const [a, b] = championshipFromData(data, conference, (g) => fixed.get(g.id)!, { draw: () => 0, rank });
      return (a === teamId || b === teamId) !== wantOut;
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
  const r = dfs(0);
  return r || gaveUp;
}
