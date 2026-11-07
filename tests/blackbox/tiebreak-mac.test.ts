import { describe, expect, it } from "vitest";
import { championshipParticipants, seasonOutlook, type Game, type Season } from "@/core";

// Tiny made-up MACs. Teams are named by letter; `rating` stands in for the SportSource Team Rating Score.
type Spec = { name: string; rating?: number };
function build(specs: Spec[], conf: [string, string][], open: [string, string][] = []): Season & { id: (n: string) => number } {
  let nextId = 0;
  const teams = specs.map((s, i) => ({
    id: i + 1, name: s.name, abbreviation: null, conference: "Mid-American",
    classification: "fbs" as const, color: null, altColor: null, rating: s.rating ?? 0,
  }));
  const id = (n: string) => teams.find((t) => t.name === n)!.id;
  const game = (home: number, away: number, winner: number | undefined): Game => ({
    id: nextId++, week: 1, start: "2026-11-07T18:00:00Z", neutralSite: false, conferenceGame: true,
    homeId: home, awayId: away,
    homePoints: winner === undefined ? null : winner === home ? 21 : 14,
    awayPoints: winner === undefined ? null : winner === away ? 21 : 14,
    completed: winner !== undefined, spread: null,
  });
  const games = [...conf.map(([w, l]) => game(id(w), id(l), id(w))), ...open.map(([h, a]) => game(id(h), id(a), undefined))];
  return { year: 2026, fetchedAt: "", teams, games, id };
}
const played = (g: Game) => (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId);
const pair = (s: Season) => championshipParticipants(s, "Mid-American", played, { draw: () => 0 });

describe("MAC tiebreakers", () => {
  it("level on head-to-head and common opponents: the Team Rating Score decides before order of finish", () => {
    // A and B 3-1, never met, both 3-1 against the same four opponents. A beat C1, the best placed of them, B lost
    // to it; B rates higher, and the MAC ranks the rating step first.
    const s = build(
      [{ name: "A" }, { name: "B", rating: 10 }, { name: "C1" }, { name: "C2" }, { name: "W1" }, { name: "W2" }],
      [["A", "C1"], ["C2", "A"], ["A", "W1"], ["A", "W2"], ["C1", "B"], ["B", "C2"], ["B", "W1"], ["B", "W2"], ["C1", "C2"], ["W1", "W2"]],
    );
    expect(pair(s)).toEqual([s.id("B"), s.id("A")]);
  });

  it("head-to-head between two tied teams comes first", () => {
    // L 4-0; A and B 2-2, B beat A, though A rates higher.
    const s = build([{ name: "L" }, { name: "A", rating: 10 }, { name: "B" }, { name: "X" }, { name: "Y" }],
      [["L", "A"], ["L", "B"], ["L", "X"], ["L", "Y"], ["B", "A"], ["A", "X"], ["A", "Y"], ["B", "X"], ["Y", "B"]]);
    expect(pair(s)).toEqual([s.id("L"), s.id("B")]);
  });

  it("Sacramento State can't play for the title in 2026, whatever its record", () => {
    // Sacramento State 3-0; A 2-1, B 1-2, C 0-3.
    const s = build([{ name: "Sacramento State" }, { name: "A" }, { name: "B" }, { name: "C" }],
      [["Sacramento State", "A"], ["Sacramento State", "B"], ["Sacramento State", "C"], ["A", "B"], ["A", "C"], ["B", "C"]]);
    expect(pair(s)).toEqual([s.id("A"), s.id("B")]);
  });

  it("an ineligible team ahead in the standings doesn't stop a clinch, and is itself eliminated", () => {
    // Sacramento State 2-0, A 2-1, B 1-1 with D left, C 1-2, D 0-2. Only B can still reach A's 2-1, so A is in
    // for sure; counting Sacramento State as a rival, it wouldn't be.
    const s = build([{ name: "Sacramento State", rating: 20 }, { name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }],
      [["Sacramento State", "A"], ["Sacramento State", "B"], ["A", "C"], ["A", "D"], ["B", "C"], ["C", "D"]], [["B", "D"]]);
    const o = seasonOutlook(s, { conference: "Mid-American", iterations: 200, seed: 3 });
    const of = (n: string) => o.teams.find((t) => t.teamId === s.id(n))!;
    expect(of("A").titleGame).toBe(1);
    expect(of("A").status).toBe("clinched");
    expect(of("Sacramento State").titleGame).toBe(0);
    expect(of("Sacramento State").status).toBe("eliminated");
  });
});
