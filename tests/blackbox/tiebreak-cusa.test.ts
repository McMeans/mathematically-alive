import { describe, expect, it } from "vitest";
import { championshipParticipants, conferenceName, conferenceShort, explore, hasTiebreakRules, type Game, type Season } from "@/core";

// Tiny made-up Conference USAs. Teams are named by letter; `rating` stands in for the average computer ranking.
type Spec = { name: string; rating?: number };
function build(specs: Spec[], conf: [string, string][], open: [string, string][] = []): Season & { id: (n: string) => number } {
  let nextId = 0;
  const teams = specs.map((s, i) => ({
    id: i + 1, name: s.name, abbreviation: null, conference: "Conference USA",
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
const pair = (s: Season) => championshipParticipants(s, "Conference USA", played, { draw: () => 0 });

describe("Conference USA tiebreakers", () => {
  it("has rules for 2026 and goes by CUSA on the site", () => {
    expect(hasTiebreakRules("Conference USA", 2026)).toBe(true);
    expect(conferenceName("Conference USA")).toBe("CUSA");
    expect(conferenceShort("Conference USA")).toBe("CUSA");
  });

  it("level on head-to-head and common opponents: order of finish decides before the computer ranking", () => {
    // L 6-0 takes one spot. A and B are 3-2 for the other: they never met, and both lost to L and went 3-1 against
    // C1, C2, W1 and W2. C1 (2-2) is the best placed common opponent after L; A beat it, B lost to it. B rates
    // higher, but CUSA ranks order of finish first (the MAC does the reverse), so A plays.
    const s = build(
      [{ name: "L" }, { name: "A" }, { name: "B", rating: 10 }, { name: "C1" }, { name: "C2" }, { name: "W1" }, { name: "W2" }],
      [["L", "A"], ["L", "B"], ["L", "C1"], ["L", "C2"], ["L", "W1"], ["L", "W2"],
        ["A", "C1"], ["C2", "A"], ["A", "W1"], ["A", "W2"], ["C1", "B"], ["B", "C2"], ["B", "W1"], ["B", "W2"],
        ["C1", "C2"], ["W1", "W2"]],
    );
    expect(pair(s)).toEqual([s.id("L"), s.id("A")]);
  });

  // L 5-0 takes one spot. A and B are 1-1 for the other: they never met, both lost to L (their only common opponent),
  // and A beat P (1-2) while B beat Q (0-3). So A's opponents went 6-2 to B's 5-3.
  const sosRace = (bRating: number) => build(
    [{ name: "L" }, { name: "A" }, { name: "B", rating: bRating }, { name: "P" }, { name: "Q" }, { name: "R" }],
    [["L", "A"], ["L", "B"], ["L", "P"], ["L", "Q"], ["L", "R"], ["A", "P"], ["B", "Q"], ["P", "R"], ["R", "Q"]],
  );

  it("level through the computer ranking: the stronger conference schedule plays, whatever the draw", () => {
    const s = sosRace(0);
    for (const d of [0, 0.99]) {
      expect(championshipParticipants(s, "Conference USA", played, { draw: () => d })).toEqual([s.id("L"), s.id("A")]);
    }
  });

  it("the computer ranking decides before strength of schedule", () => {
    const s = sosRace(10);
    expect(pair(s)).toEqual([s.id("L"), s.id("B")]);
  });

  it("level on every step: a coin toss decides", () => {
    // As above, but A and B each beat a winless team, so their opponents' records match too.
    const s = build(
      [{ name: "L" }, { name: "A" }, { name: "B" }, { name: "P" }, { name: "Q" }],
      [["L", "A"], ["L", "B"], ["L", "P"], ["L", "Q"], ["A", "P"], ["B", "Q"]],
    );
    const picks = [0, 0.99].map((d) => championshipParticipants(s, "Conference USA", played, { draw: () => d })[1]);
    expect(new Set(picks)).toEqual(new Set([s.id("A"), s.id("B")]));
  });

  it("a CUSA team's path names the conference CUSA, never Conference USA", () => {
    const s = build([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }],
      [["A", "D"], ["B", "C"]], [["A", "B"], ["C", "D"], ["A", "C"], ["B", "D"]]);
    const r = explore(s, { conference: "Conference USA", teamId: s.id("A"), iterations: 300, seed: 7 });
    expect(r.path.summary).toMatch(/CUSA title game/);
    const text = [r.path.summary, ...r.path.steps.map((x) => JSON.stringify(x)), r.tree.helpNote, r.tree.footnote].join(" ");
    expect(text).not.toMatch(/Conference USA/);
  });
});
