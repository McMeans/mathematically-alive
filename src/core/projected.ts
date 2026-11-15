// The projected field: the committee's latest ranking moved by the results since and the picks (live.ts), with each
// power conference's champion its picked one, else the likelier winner of its two likeliest title-game teams, and the field the format picks from
// them. With no picks it is the current playoff picture. The team view's race card and the Season Lab's seeds,
// bracket and top 25 all come from here, so they agree. The chance each team gets in stays the simulation's.
import type { NationalResult } from "./national";
import { powerConferences } from "./committee";
import { liveRanking } from "./live";
import { fieldPicker, playoffFormat } from "./playoff";
import { INDEPENDENTS, type Season } from "./season";

export type Projected = {
  /** Every FBS team, best first. */
  order: number[];
  /** Rank by team id, 1 is best. */
  place: Map<number, number>;
  /** Each simulated power conference's champion (picked, else the likelier winner of its two likeliest title-game teams): team id -> conference. */
  champions: Map<number, string>;
  /** The field the format picks, seed 1 first (the announced field once there is one). Empty with no playoff. */
  field: number[];
  /**
   * The automatic bid each field team holds, as the race card and the Lab's seeds mark it: a power champion's
   * conference ("SEC", "B1G", "B12", "ACC"), "G6" for the Group of Six bid, "ND" when the top-12 rule is what puts
   * Notre Dame in. Empty in a format without those bids.
   */
  tags: Map<number, string>;
  /** The last team in at large (the cut line goes under it); the last seed when no bid is tagged. Null with no field. */
  lastAtLarge: number | null;
};

// The power conferences' short tags.
const BID_TAGS: Record<string, string> = { "Big Ten": "B1G", "Big 12": "B12" };

/** Whether the team is in a Group of Six conference that season: FBS, in a conference, not a power one. */
export function isGroupOfSix(season: Season, id: number): boolean {
  const t = season.teams.find((x) => x.id === id);
  return t !== undefined && t.classification === "fbs" && t.conference !== null && t.conference !== INDEPENDENTS && !powerConferences(season.year).includes(t.conference);
}

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
    // A champion constant across every simulated season counts as picked. A title game settled some other way (a
    // final one, say) reads the same; harmless, since liveRanking skips games already decided.
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
  const placeOf = new Map(order.map((id, k) => [id, k + 1]));
  const tags = new Map<number, string>();
  if (field.length > 0 && playoffFormat(season.year).autoBids === "power4G6") {
    const inField = new Set(field);
    for (const id of field) if (champions.has(id)) tags.set(id, BID_TAGS[champions.get(id)!] ?? champions.get(id)!);
    const g6 = order.find((id) => inField.has(id) && !tags.has(id) && isGroupOfSix(season, id));
    if (g6 !== undefined) tags.set(g6, "G6");
    const nd = field.find((id) => season.teams.find((t) => t.id === id)!.name === "Notre Dame" && placeOf.get(id)! <= 12);
    if (nd !== undefined) tags.set(nd, "ND");
  }
  const atLarge = field.filter((id) => !tags.has(id));
  const lastAtLarge = field.length === 0 ? null
    : atLarge.length > 0 && tags.size > 0 ? atLarge.reduce((a, b) => (placeOf.get(a)! > placeOf.get(b)! ? a : b)) : field.at(-1)!;
  // Notre Dame keeps its tag only when the top-12 rule is what gets it in: ranked below the last at-large team.
  if (lastAtLarge !== null) for (const [id, tag] of tags) if (tag === "ND" && placeOf.get(id)! < placeOf.get(lastAtLarge)!) tags.delete(id);
  return { order, place: placeOf, champions, field, tags, lastAtLarge };
}
