import { describe, expect, it } from "vitest";
import { championshipParticipants, explore, type Game, type Season } from "@/core";

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

  it("Sacramento State, new to FBS in 2026, can play for the title", () => {
    // Sacramento State 3-0; A 2-1, B 1-2, C 0-3. The NCAA made teams moving up eligible at once (June 2026).
    const s = build([{ name: "Sacramento State" }, { name: "A" }, { name: "B" }, { name: "C" }],
      [["Sacramento State", "A"], ["Sacramento State", "B"], ["Sacramento State", "C"], ["A", "B"], ["A", "C"], ["B", "C"]]);
    expect(pair(s)).toEqual([s.id("Sacramento State"), s.id("A")]);
  });

  it("a MAC team's path and tree name the conference MAC, never Mid-American", () => {
    // A 1-0 with B, C and D left; the other teams have games of their own left, so the tree has help from elsewhere.
    const s = build([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }],
      [["A", "E"]], [["A", "B"], ["A", "C"], ["A", "D"], ["B", "C"], ["C", "D"], ["D", "E"]]);
    const r = explore(s, { conference: "Mid-American", teamId: s.id("A"), iterations: 400, seed: 5 });
    const text = [r.path.summary, ...r.path.steps, r.tree.helpNote, r.tree.footnote ?? ""].join(" ");
    expect(r.path.summary).toMatch(/MAC title game/);
    expect(r.tree.helpNote).toMatch(/MAC game/);
    expect(text).not.toMatch(/Mid-American/);
  });
});
