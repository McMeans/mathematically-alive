import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { championshipParticipants, explore, seasonFromCfbd, seasonOutlook, type CfbdSnapshot, type Game, type Season } from "@/core";

// Tiny made-up Big Tens. Teams are named by letter; `rating` stands in for the SportSource ranking, and each test
// rates the team the earlier steps should lose higher, so a pass means those steps decided.
type Spec = { name: string; rating?: number; conference?: string | null };
let nextId = 0;
function build(specs: Spec[], conf: [string, string][], other: { home: string; away: string; winner?: string }[] = []): Season & { id: (n: string) => number } {
  nextId = 0;
  const teams = specs.map((s, i) => ({
    id: i + 1, name: s.name, abbreviation: null, conference: s.conference === undefined ? "Big Ten" : s.conference,
    classification: "fbs" as const, color: null, altColor: null, rating: s.rating ?? 0,
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
    ...other.map((g) => game(id(g.home), id(g.away), g.winner === undefined ? undefined : id(g.winner), false)),
  ];
  return { year: 2026, fetchedAt: "", teams, games, id };
}
const played = (g: Game) => (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId);
const pair = (s: Season, draw = () => 0) => championshipParticipants(s, "Big Ten", played, { draw });
const letters = (...names: string[]): Spec[] => names.map((name) => ({ name }));

describe("Big Ten tiebreakers", () => {
  it("two teams tied for second: the head-to-head winner gets in", () => {
    // L 3-0; A and B 2-2, A beat B.
    const s = build([{ name: "L" }, { name: "A" }, { name: "B", rating: 10 }, { name: "X" }, { name: "Y" }],
      [["L", "A"], ["L", "B"], ["L", "Y"], ["A", "B"], ["A", "X"], ["Y", "A"], ["B", "X"], ["B", "Y"]]);
    expect(pair(s)).toEqual([s.id("L"), s.id("A")]);
  });

  it("two teams tied for first are both in, seeded by head-to-head", () => {
    // A and B 3-1; A beat B, Z beat A.
    const s = build([{ name: "A" }, { name: "B", rating: 10 }, ...letters("X", "Y", "Z")],
      [["A", "B"], ["A", "X"], ["A", "Y"], ["Z", "A"], ["B", "X"], ["B", "Y"], ["B", "Z"]]);
    expect(pair(s)).toEqual([s.id("A"), s.id("B")]);
  });

  it("two teams that didn't play: the better record against common opponents gets in", () => {
    // L 6-0. A and B 2-2 and never met; against L, X and Y (both played all three) A is 2-1, B 1-2.
    const s = build(
      [{ name: "L" }, { name: "A" }, { name: "B", rating: 10 }, ...letters("X", "Y", "Z", "W")],
      [["L", "A"], ["L", "B"], ["L", "X"], ["L", "Y"], ["L", "Z"], ["L", "W"],
        ["A", "X"], ["A", "Y"], ["Z", "A"], ["B", "X"], ["Y", "B"], ["B", "W"], ["W", "Z"]],
    );
    expect(pair(s)).toEqual([s.id("L"), s.id("A")]);
  });

  it("level against common opponents: the record against the best placed of them decides", () => {
    // A and B 3-1 and never met, both 1-1 against their common opponents M (2-1) and X (1-1). A beat M, the best
    // placed of them; B lost to M.
    const s = build(
      [{ name: "A" }, { name: "B", rating: 10 }, ...letters("M", "X", "F1", "F2", "F3", "F4", "F5", "F6")],
      [["A", "M"], ["X", "A"], ["A", "F3"], ["A", "F4"], ["M", "B"], ["B", "X"], ["B", "F5"], ["B", "F6"], ["M", "F1"]],
    );
    expect(pair(s)).toEqual([s.id("A"), s.id("B")]);
  });

  it("common opponents level on record count as one group, not ordered by head-to-head", () => {
    // L 4-0. A and B 3-2, both 1-2 against their common opponents L, D and E. D and E are 2-3; D beat E. A beat D
    // and B beat E, so against D and E together they are level, and so is every later step until the ranking (B).
    const s = build(
      [{ name: "L" }, { name: "A" }, { name: "B", rating: 10 }, ...letters("D", "E", "X", "Y", "P", "Q", "R", "S")],
      [["L", "A"], ["L", "B"], ["L", "D"], ["L", "E"], ["A", "D"], ["E", "A"], ["D", "B"], ["B", "E"], ["D", "E"],
        ["E", "X"], ["Y", "D"], ["X", "Y"], ["A", "P"], ["A", "Q"], ["B", "R"], ["B", "S"]],
    );
    expect(pair(s)).toEqual([s.id("L"), s.id("B")]);
  });

  it("then the conference win pct of their conference opponents; the one best is in and the rest start over for second", () => {
    // A, B and C 1-0 over X (2-1), Y (1-2) and Z (0-3). A is in; B and C then differ only on their opponents too.
    const s = build([{ name: "A" }, { name: "B", rating: 5 }, { name: "C", rating: 10 }, ...letters("X", "Y", "Z")],
      [["A", "X"], ["B", "Y"], ["C", "Z"], ["X", "Y"], ["X", "Z"], ["Y", "Z"]]);
    expect(pair(s)).toEqual([s.id("A"), s.id("B")]);
  });

  it("opponents' win pct level as fractions is level, however the sum rounds", () => {
    // A and B 3-0, never met, nothing in common. A's opponents are 1-1, 1-2 and 2-1, and so are B's: 1/2 on average
    // for both, a tie that goes on to the ranking (B). Summed in a different order, the same three can round apart.
    const s = build(
      [{ name: "A" }, { name: "B", rating: 10 }, ...letters("H", "T1", "S1", "S2", "H2", "T2", "F1", "F3", "F4", "F6", "F7", "F8")],
      [["A", "H"], ["A", "T1"], ["A", "S1"], ["B", "S2"], ["B", "H2"], ["B", "T2"], ["H", "F1"], ["S1", "T1"], ["T1", "F3"],
        ["S1", "F4"], ["H2", "F6"], ["S2", "T2"], ["T2", "F7"], ["S2", "F8"]],
    );
    expect(pair(s)).toEqual([s.id("B"), s.id("A")]);
  });

  it("then the ranking, then a random draw", () => {
    const even = (b: number) => build([{ name: "A" }, { name: "B", rating: b }, { name: "X" }, { name: "Y" }], [["A", "X"], ["B", "Y"]]);
    const ranked = even(10);
    expect(pair(ranked)).toEqual([ranked.id("B"), ranked.id("A")]);
    const drawn = even(0);
    expect(pair(drawn, () => 0)).toEqual([drawn.id("A"), drawn.id("B")]);
    expect(pair(drawn, () => 0.99)).toEqual([drawn.id("B"), drawn.id("A")]);
  });

  it("non-conference wins don't count", () => {
    // A and B 1-0 and level on every conference step; A also beat N outside the conference. The ranking (B) decides.
    const s = build([{ name: "A" }, { name: "B", rating: 10 }, { name: "X" }, { name: "Y" }, { name: "N", conference: null }],
      [["A", "X"], ["B", "Y"]], [{ home: "A", away: "N", winner: "A" }]);
    expect(pair(s)).toEqual([s.id("B"), s.id("A")]);
  });

  it("three or more who all played each other: the two with the best record among them are both in", () => {
    // A, B, C and D 3-2. Among them A and B are 2-1, C and D 1-2. A beat B, so A is seeded first.
    const s = build(
      [{ name: "A" }, { name: "B" }, { name: "C", rating: 10 }, { name: "D", rating: 10 }, ...letters("P", "Q", "R", "S")],
      [["A", "B"], ["A", "C"], ["B", "C"], ["B", "D"], ["C", "D"], ["D", "A"], ["C", "P"], ["C", "Q"], ["D", "P"], ["D", "Q"],
        ["A", "R"], ["S", "A"], ["B", "R"], ["S", "B"], ["P", "S"], ["Q", "S"], ["R", "S"]],
    );
    expect(pair(s)).toEqual([s.id("A"), s.id("B")]);
  });

  it("three who didn't all meet: one that beat both others is seeded first", () => {
    // A beat B and C (who never met); all three 2-1. Then B and C tie on every step but the ranking.
    const s = build(
      [{ name: "A" }, { name: "B", rating: 5 }, { name: "C", rating: 10 }, { name: "D" }, { name: "E" }],
      [["A", "B"], ["A", "C"], ["D", "A"], ["B", "D"], ["B", "E"], ["C", "D"], ["C", "E"]],
    );
    expect(pair(s)).toEqual([s.id("A"), s.id("C")]);
  });

  it("three who didn't all meet: one that lost to both others isn't out for it", () => {
    // A 4-2, B and C 2-1, all .667; B and C beat A and never met. Nothing in common, and every opponents' win pct
    // is 7/18, so the ranking (A) puts A in, and B and C go to the draw for second.
    const s = build([{ name: "A", rating: 10 }, { name: "B" }, { name: "C" }, ...letters("P", "Q", "R", "S")],
      [["B", "A"], ["C", "A"], ["A", "P"], ["A", "Q"], ["A", "R"], ["A", "S"], ["B", "P"], ["Q", "B"], ["C", "R"], ["S", "C"]]);
    expect(pair(s)).toEqual([s.id("A"), s.id("B")]);
  });

  it("a tie the ranking will settle leaves both teams alive, and the note names the ranking", () => {
    // L 4-0. A and B 2-1, level on every step before the ranking, and P and Q (0-1) still meet.
    const s = build(
      [{ name: "L" }, { name: "A", rating: 5 }, { name: "B" }, ...letters("X", "Y", "Z", "W", "P", "Q")],
      [["L", "A"], ["L", "B"], ["A", "X"], ["A", "Z"], ["B", "Y"], ["B", "W"], ["L", "P"], ["L", "Q"]],
      [{ home: "P", away: "Q" }],
    );
    const games = s.games.map((g) => (g.homeId === s.id("P") && g.awayId === s.id("Q") ? { ...g, conferenceGame: true } : g));
    const b1g = { ...s, games };
    const o = seasonOutlook(b1g, { conference: "Big Ten", iterations: 2000, seed: 1 }).teams;
    for (const n of ["A", "B"]) {
      const t = o.find((x) => x.teamId === s.id(n))!;
      expect(t.status, n).toBe("alive");
      expect(t.titleGame, n).toBeGreaterThan(0);
      expect(t.titleGame, n).toBeLessThan(1);
    }
    const way = explore(b1g, { conference: "Big Ten", teamId: s.id("B"), iterations: 2000, seed: 1 }).tree.likeliest!;
    expect(way.needsTiebreak).toBe(true);
    expect(way.note).toMatch(/, depending on the ranking tiebreak\.$/);
  });
});

describe("Big Ten seasons", () => {
  // Core has only the 2026 rules, so a 2025 fixture is loaded as 2026 to check the real 2025 title game under them.
  const load = (year: number) => seasonFromCfbd({ ...(JSON.parse(readFileSync(`fixtures/big-ten-${year}.json`, "utf8")) as CfbdSnapshot), year: 2026 });
  const members = (s: Season) => s.teams.filter((t) => t.conference === "Big Ten");

  it("the 2025 results send Indiana and Ohio State, who played the real title game", () => {
    // Both went 9-0; nobody else finished better than 8-1.
    const s = load(2025);
    expect(members(s)).toHaveLength(18);
    const name = (id: number) => s.teams.find((t) => t.id === id)!.name;
    expect(pair(s).map(name).sort()).toEqual(["Indiana", "Ohio State"]);
    expect(pair(s, () => 0.99).map(name).sort()).toEqual(["Indiana", "Ohio State"]);
  });

  it("every team plays nine conference games in 2025 and 2026", () => {
    for (const year of [2025, 2026]) {
      const s = load(year);
      const ids = new Set(members(s).map((t) => t.id));
      for (const id of ids) {
        expect(s.games.filter((g) => g.conferenceGame && (g.homeId === id || g.awayId === id) && ids.has(g.homeId) && ids.has(g.awayId))).toHaveLength(9);
      }
    }
  });

  it("the likeliest way in proves the spot once locked, three weeks from the end of 2025", () => {
    const full = load(2025);
    const last = Math.max(...full.games.filter((g) => g.completed && g.conferenceGame).map((g) => g.week));
    const cut: Season = {
      ...full,
      games: full.games.map((g) => (g.week > last - 3 ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
    };
    // Eighteen teams are slow to explore, so three proved ways in are enough.
    let checked = 0;
    for (const t of members(cut)) {
      if (checked === 3) break;
      const opts = { conference: "Big Ten", teamId: t.id, iterations: 300, seed: 1 };
      const way = explore(cut, opts).tree.likeliest;
      if (!way || way.needsTiebreak) continue;
      const locks = Object.fromEntries(way.picks.map((p) => [p.gameId, p.winner]));
      expect(explore(cut, { ...opts, locks }).outlook.find((o) => o.teamId === t.id)!.status, t.name).toBe("clinched");
      checked++;
    }
    expect(checked).toBe(3);
  }, 60_000);

  it("2026 title odds across the conference add up to two spots", () => {
    const s = load(2026);
    const o = seasonOutlook(s, { conference: "Big Ten", iterations: 2000, seed: 1 });
    expect(o.teams).toHaveLength(18);
    expect(o.teams.reduce((sum, t) => sum + t.titleGame, 0)).toBeCloseTo(2, 9);
    for (const t of o.teams) if (t.status === "eliminated") expect(t.titleGame).toBe(0);
    for (const t of o.teams) if (t.status === "clinched") expect(t.titleGame).toBe(1);
  });
});
