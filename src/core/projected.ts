// The projected field: the committee's latest ranking moved by the results since and the picks (live.ts), with each
// power conference's champion its picked one, else the likelier winner of its two likeliest title-game teams, and the field the format picks from
// them. With no picks it is the current playoff picture. The team view's race card and the Season Lab's seeds,
// bracket and top 25 all come from here, so they agree. The chance each team gets in stays the simulation's.
import type { NationalResult } from "./national";
import { powerConferences } from "./committee";
import { liveRanking } from "./live";
import { fieldPicker } from "./playoff";
import type { Season } from "./season";

export type Projected = {
  /** Every FBS team, best first. */
  order: number[];
  /** Rank by team id, 1 is best. */
  place: Map<number, number>;
  /** Each simulated power conference's champion (picked, else the likelier winner of its two likeliest title-game teams): team id -> conference. */
  champions: Map<number, string>;
  /** The field the format picks, seed 1 first (the announced field once there is one). Empty with no playoff. */
  field: number[];
};

/**
 * Not part of the public API. `locks`: the game picks `national` was run with. Its title picks are read from it: a
 * conference whose title game no simulated season decides differently, against the opponent it meets most.
 */
export function projectedField(season: Season, national: NationalResult, locks: Record<number, number> = {}): Projected {
  const counts = new Map(national.conferences.map((c) => [c, new Map<number, Map<number, number>>()]));
  national.forEachIteration((_, s) => {
    for (const [c, byWinner] of counts) {
      const w = s.champion(c);
      const [a, b] = s.titleGame(c);
      const opp = byWinner.get(w) ?? byWinner.set(w, new Map()).get(w)!;
      const l = w === a ? b : a;
      opp.set(l, (opp.get(l) ?? 0) + 1);
    }
  });
  const titles = [...counts.values()].flatMap((byWinner) => {
    if (byWinner.size !== 1) return [];
    const [winner, opp] = [...byWinner][0];
    const loser = [...opp].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]?.[0] ?? null;
    return [{ winner, loser }];
  });
  const order = liveRanking(season, { locks, titles }).teams.map((t) => t.teamId);
  const conferenceOf = new Map(season.teams.map((t) => [t.id, t.conference]));
  const picked = new Map(titles.map((t) => [conferenceOf.get(t.winner), t.winner]));
  const rankOf = new Map(order.map((id, k) => [id, k]));
  const place = (id: number) => rankOf.get(id) ?? Infinity;
  const champions = new Map<number, string>();
  for (const c of powerConferences(season.year).filter((x) => national.conferences.includes(x))) {
    // Unpicked: of the two teams likeliest to play the title game, the one that wins it more often.
    const pair = national.teams.filter((t) => t.conference === c && (t.titleGame ?? 0) > 0)
      .sort((a, b) => b.titleGame! - a.titleGame! || b.champion! - a.champion! || a.teamId - b.teamId).slice(0, 2)
      .sort((a, b) => b.champion! - a.champion! || place(a.teamId) - place(b.teamId));
    const id = picked.get(c) ?? pair[0]?.teamId ?? order.find((t) => conferenceOf.get(t) === c);
    if (id !== undefined) champions.set(id, c);
  }
  const field = !national.playoff ? [] : national.announced?.seeds ?? fieldPicker(season)(order, (id) => champions.has(id));
  return { order, place: new Map(order.map((id, k) => [id, k + 1])), champions, field };
}
