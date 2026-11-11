// The projected ranking and field: where each team is expected to stand on selection day, over the simulated
// seasons (national.ts plays out every game a pick doesn't settle and ranks each season from the committee's
// latest ranking, live.ts). The team view's race card and the Season Lab's seeds, bracket and top 25 all come from
// here, so they agree.
import type { NationalResult } from "./national";
import { powerConferences } from "./committee";
import { fieldPicker } from "./playoff";
import type { Season } from "./season";

export type Projected = {
  /** Every FBS team by projected final rank (median place over the seasons, then mean), best first. */
  order: number[];
  /** Projected final rank by team id, 1 is best. */
  place: Map<number, number>;
  /** Each simulated power conference's likeliest champion (its picked one, when picked): team id -> conference. */
  champions: Map<number, string>;
  /** The field the format picks from `order` and `champions`, seed 1 first (the announced field once there is one). Empty with no playoff. */
  field: number[];
};

/** Not part of the public API. */
export function projectedField(season: Season, national: NationalResult): Projected {
  const fbs = national.teams.map((t) => t.teamId);
  const F = fbs.length, n = national.iterations;
  const at = new Map(fbs.map((id, i) => [id, i]));
  const hist = new Uint32Array(F * F);
  const powers = powerConferences(season.year).filter((c) => national.conferences.includes(c));
  const counts = new Map(powers.map((c) => [c, new Map<number, number>()]));
  national.forEachIteration((_, s) => {
    s.ranking.forEach((id, k) => { const i = at.get(id); if (i !== undefined) hist[i * F + k]++; });
    for (const [c, m] of counts) { const w = s.champion(c); m.set(w, (m.get(w) ?? 0) + 1); }
  });
  const median = (i: number) => {
    let seen = 0;
    for (let k = 0; k < F; k++) { seen += hist[i * F + k]; if (seen * 2 >= n) return k; }
    return F;
  };
  const mean = new Map(national.teams.map((t) => [t.teamId, t.meanRank]));
  const order = fbs.map((id, i) => ({ id, m: median(i) })).sort((a, b) => a.m - b.m || mean.get(a.id)! - mean.get(b.id)! || a.id - b.id).map((x) => x.id);
  const champions = new Map<number, string>();
  for (const [c, m] of counts) {
    const best = [...m].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    if (best) champions.set(best[0], c);
  }
  const field = !national.playoff ? [] : national.announced?.seeds ?? fieldPicker(season)(order, (id) => champions.has(id));
  return { order, place: new Map(order.map((id, k) => [id, k + 1])), champions, field };
}
