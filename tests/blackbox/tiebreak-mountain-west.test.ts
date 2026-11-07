import { describe, expect, it } from "vitest";
import { championshipParticipants, conferenceName, conferenceShort, explore, hasTiebreakRules, type Game, type Season } from "@/core";

// Tiny made-up Mountain Wests. Teams are named by letter; `rating` stands in for the CFP ranking or the computer
// composite. Teams listed as `outside` are non-conference opponents: FBS unless `fcs`.
type Spec = { name: string; rating?: number; outside?: boolean; fcs?: boolean };
function build(specs: Spec[], conf: [string, string][], nonConf: [string, string][] = [], open: [string, string][] = []): Season & { id: (n: string) => number } {
  let nextId = 0;
  const teams = specs.map((s, i) => ({
    id: i + 1, name: s.name, abbreviation: null, conference: s.outside ? (s.fcs ? "Big Sky" : "Pac-12") : "Mountain West",
    classification: s.fcs ? ("fcs" as const) : ("fbs" as const), color: null, altColor: null, rating: s.rating ?? 0,
  }));
  const id = (n: string) => teams.find((t) => t.name === n)!.id;
  const game = (home: number, away: number, winner: number | undefined, conferenceGame: boolean): Game => ({
    id: nextId++, week: 1, start: "2026-11-07T18:00:00Z", neutralSite: false, conferenceGame,
    homeId: home, awayId: away,
    homePoints: winner === undefined ? null : winner === home ? 21 : 14,
    awayPoints: winner === undefined ? null : winner === away ? 21 : 14,
    completed: winner !== undefined, spread: null,
  });
  const games = [
    ...conf.map(([w, l]) => game(id(w), id(l), id(w), true)),
    ...nonConf.map(([w, l]) => game(id(w), id(l), id(w), false)),
    ...open.map(([h, a]) => game(id(h), id(a), undefined, true)),
  ];
  return { year: 2026, fetchedAt: "", teams, games, id };
}
const played = (g: Game) => (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId);
const pairWith = (s: Season, d: number) => championshipParticipants(s, "Mountain West", played, { draw: () => d });
const pair = (s: Season) => pairWith(s, 0);

// L 4-0 takes one spot. A and B are 1-1 for the other: they never met, both lost to L, A beat P and B beat Q.
// Outside the conference A beat X; B played no one.
const rankingRace = (bRating: number) => build(
  [{ name: "L" }, { name: "A" }, { name: "B", rating: bRating }, { name: "P" }, { name: "Q" }, { name: "X", outside: true }],
  [["L", "A"], ["L", "B"], ["L", "P"], ["L", "Q"], ["A", "P"], ["B", "Q"], ["P", "Q"]],
  [["A", "X"]],
);

describe("Mountain West tiebreakers", () => {
  it("has rules for 2026 and goes by Mountain West, or MW for short", () => {
    expect(hasTiebreakRules("Mountain West", 2026)).toBe(true);
    expect(conferenceName("Mountain West")).toBe("Mountain West");
    expect(conferenceShort("Mountain West")).toBe("MW");
  });

  it("the ranking decides before overall win pct", () => {
    const s = rankingRace(10);
    expect(pair(s)).toEqual([s.id("L"), s.id("B")]);
  });

  it("level on head-to-head and the ranking: the better overall record plays", () => {
    const s = rankingRace(0);
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toEqual([s.id("L"), s.id("A")]);
  });

  it("overall win pct counts at most one win over an FCS team", () => {
    // As above, but outside the conference A beat three FCS teams and lost to X (2-2 with one FCS win counted, 4-2
    // with all three), while B beat Y and Z and lost to X (3-2).
    const s = build(
      [{ name: "L" }, { name: "A" }, { name: "B" }, { name: "P" }, { name: "Q" },
        { name: "X", outside: true }, { name: "Y", outside: true }, { name: "Z", outside: true },
        { name: "F1", outside: true, fcs: true }, { name: "F2", outside: true, fcs: true }, { name: "F3", outside: true, fcs: true }],
      [["L", "A"], ["L", "B"], ["L", "P"], ["L", "Q"], ["A", "P"], ["B", "Q"], ["P", "Q"]],
      [["A", "F1"], ["A", "F2"], ["A", "F3"], ["X", "A"], ["B", "Y"], ["B", "Z"], ["X", "B"]],
    );
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toEqual([s.id("L"), s.id("B")]);
  });

  it("overall record goes by win pct, not wins: a team with an extra game gets no edge from it", () => {
    // As above, but outside the conference A went 2-2 (3-3 overall) and B 1-0 (2-1 overall): A has more wins, B the
    // better pct.
    const s = build(
      [{ name: "L" }, { name: "A" }, { name: "B" }, { name: "P" }, { name: "Q" },
        { name: "X", outside: true }, { name: "Y", outside: true }, { name: "Z", outside: true }],
      [["L", "A"], ["L", "B"], ["L", "P"], ["L", "Q"], ["A", "P"], ["B", "Q"], ["P", "Q"]],
      [["A", "X"], ["A", "Y"], ["Z", "A"], ["X", "A"], ["B", "Y"]],
    );
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toEqual([s.id("L"), s.id("B")]);
  });

  it("down the standings, a position some tied team didn't play in full is skipped", () => {
    // L 7-0 takes one spot. A and B are 3-2 for the other: they never met, both lost to L, and have no
    // non-conference games. Next in the standings, C and D are level at 2-2: A played both (lost to C, beat D),
    // B played only C and beat it. That position is skipped, so E (1-3) decides: A beat E, B lost to E.
    const s = build(
      ["L", "A", "B", "C", "D", "E", "F", "G"].map((name) => ({ name })),
      [["L", "A"], ["L", "B"], ["L", "C"], ["L", "D"], ["L", "E"], ["L", "F"], ["L", "G"],
        ["C", "A"], ["A", "D"], ["A", "E"], ["A", "F"],
        ["B", "C"], ["E", "B"], ["B", "F"], ["B", "G"],
        ["C", "G"], ["D", "G"], ["D", "F"], ["F", "E"]],
    );
    expect(pair(s)).toEqual([s.id("L"), s.id("A")]);
  });

  it("level on every step: a coin toss decides", () => {
    // L 4-0 takes one spot; A and B each lost to L and beat a winless team, with nothing else to tell them apart.
    const s = build(
      [{ name: "L" }, { name: "A" }, { name: "B" }, { name: "P" }, { name: "Q" }],
      [["L", "A"], ["L", "B"], ["L", "P"], ["L", "Q"], ["A", "P"], ["B", "Q"]],
    );
    const picks = [0, 0.99].map((d) => pairWith(s, d)[1]);
    expect(new Set(picks)).toEqual(new Set([s.id("A"), s.id("B")]));
  });

  it("North Dakota State, new to FBS in 2026, can play for the title", () => {
    const s = build(
      [{ name: "North Dakota State" }, { name: "B" }, { name: "C" }, { name: "D" }],
      [["North Dakota State", "B"], ["North Dakota State", "C"], ["North Dakota State", "D"], ["B", "C"], ["B", "D"], ["C", "D"]],
    );
    expect(pair(s)).toEqual([s.id("North Dakota State"), s.id("B")]);
  });

  it("a Mountain West team's path names the conference Mountain West", () => {
    const s = build([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }],
      [["A", "D"], ["B", "C"]], [], [["A", "B"], ["C", "D"], ["A", "C"], ["B", "D"]]);
    const r = explore(s, { conference: "Mountain West", teamId: s.id("A"), iterations: 300, seed: 7 });
    expect(r.path.summary).toMatch(/Mountain West title game/);
  });
});
