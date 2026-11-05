import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { championshipParticipants, explore, seasonFromCfbd, seasonOutlook, type CfbdSnapshot, type Game, type Season } from "@/core";

// Tiny made-up SECs. Teams are named by letter; `rating` stands in for the ranking, which takes the place of the
// scoring-margin step until every score is in. Unless a test asks for every score, the first team has a
// non-conference game still to play, so the ranking is that step. Each test rates the team the earlier steps should
// lose higher, so a pass means those steps decided.
type Spec = { name: string; rating?: number; conference?: string | null };
/** A conference game: winner, loser, and optionally the score [winner's points, loser's points]. */
type Conf = [string, string] | [string, string, number, number];
/** A non-conference game; no winner means not played yet. */
type Other = { home: string; away: string; winner?: string; score?: [number, number] };
let nextId = 0;
function build(specs: Spec[], conf: Conf[], other: Other[] = [], { scored = false } = {}): Season & { id: (n: string) => number } {
  nextId = 0;
  if (!scored) {
    specs = [...specs, { name: "Later", conference: null }];
    other = [...other, { home: specs[0].name, away: "Later" }];
  }
  const teams = specs.map((s, i) => ({
    id: i + 1, name: s.name, abbreviation: null, conference: s.conference === undefined ? "SEC" : s.conference,
    classification: "fbs" as const, color: null, altColor: null, rating: s.rating ?? 0,
  }));
  const id = (n: string) => teams.find((t) => t.name === n)!.id;
  const game = (home: number, away: number, winner: number | undefined, score: [number, number], conferenceGame: boolean): Game => ({
    id: nextId++, week: 1, start: "2026-11-07T18:00:00Z", neutralSite: false, conferenceGame,
    homeId: home, awayId: away,
    homePoints: winner === undefined ? null : winner === home ? score[0] : score[1],
    awayPoints: winner === undefined ? null : winner === away ? score[0] : score[1],
    completed: winner !== undefined, spread: null,
  });
  const games = [
    ...conf.map(([w, l, wp, lp]) => game(id(w), id(l), id(w), [wp ?? 21, lp ?? 14], true)),
    ...other.map((g) => game(id(g.home), id(g.away), g.winner === undefined ? undefined : id(g.winner), g.score ?? [21, 14], false)),
  ];
  return { year: 2026, fetchedAt: "", teams, games, id };
}
const played = (g: Game) => (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId);
const pair = (s: Season, draw = () => 0) => championshipParticipants(s, "SEC", played, { draw });
const letters = (...names: string[]): Spec[] => names.map((name) => ({ name }));

describe("SEC tiebreakers", () => {
  it("two teams tied for second: the head-to-head winner gets in", () => {
    // L 3-0; A and B 2-2, A beat B.
    const s = build([{ name: "L" }, { name: "A" }, { name: "B", rating: 10 }, { name: "X" }, { name: "Y" }],
      [["L", "A"], ["L", "B"], ["L", "Y"], ["A", "B"], ["A", "X"], ["Y", "A"], ["B", "X"], ["B", "Y"]]);
    expect(pair(s)).toEqual([s.id("L"), s.id("A")]);
  });

  it("two teams that didn't play: the better record against common opponents gets in", () => {
    // L 6-0. A and B 2-2 and never met; against L, X and Y (both played all three) A is 2-1, B 1-2.
    const s = build(
      [{ name: "L" }, { name: "A" }, { name: "B", rating: 10 }, { name: "X" }, { name: "Y" }, { name: "Z" }, { name: "W" }],
      [["L", "A"], ["L", "B"], ["L", "X"], ["L", "Y"], ["L", "Z"], ["L", "W"],
        ["A", "X"], ["A", "Y"], ["Z", "A"], ["B", "X"], ["Y", "B"], ["B", "W"], ["W", "Z"]],
    );
    expect(pair(s)).toEqual([s.id("L"), s.id("A")]);
  });

  it("common opponents come before the best placed of them", () => {
    // A 2-1 and B 4-2 lead and never met, so both are in; the steps seed them. Against their common opponents M, X
    // and Y, A is 2-1 and B 1-2, though B beat M, the best placed of them (3-2).
    const s = build(
      [{ name: "A" }, { name: "B", rating: 10 }, ...letters("M", "X", "Y", "F1", "F2", "F3", "F4", "F5", "F6")],
      [["M", "A"], ["A", "X"], ["A", "Y"], ["B", "M"], ["X", "B"], ["Y", "B"], ["B", "F1"], ["B", "F2"], ["B", "F3"],
        ["M", "F4"], ["M", "F5"], ["F6", "M"], ["F1", "F6"], ["F2", "F6"]],
    );
    expect(pair(s)).toEqual([s.id("A"), s.id("B")]);
  });

  it("level against common opponents: the best placed of them decides, and opponents level on record are told apart by head-to-head", () => {
    // L 4-0. A and B 3-2, both 1-2 against their common opponents L, D and E. D and E are 2-3, and D beat E, so
    // D is placed above E: A beat D, B lost to D. Counted together, D and E would leave A and B level.
    const s = build(
      [{ name: "L" }, { name: "A" }, { name: "B", rating: 10 }, ...letters("D", "E", "X", "Y", "P", "Q", "R", "S")],
      [["L", "A"], ["L", "B"], ["L", "D"], ["L", "E"], ["A", "D"], ["E", "A"], ["D", "B"], ["B", "E"], ["D", "E"],
        ["E", "X"], ["Y", "D"], ["X", "Y"], ["A", "P"], ["A", "Q"], ["B", "R"], ["B", "S"]],
    );
    expect(pair(s)).toEqual([s.id("L"), s.id("A")]);
  });

  it("three opponents level on record who didn't all meet: one that beat the other two is placed above them", () => {
    // L 5-0. A and B 4-2, both 2-2 against their common opponents L, D, E and F. D, E and F are 3-3; D beat E and F,
    // who never met, so D is placed first: A beat D, B lost to D. Counted together, D, E and F would leave A and B level.
    const s = build(
      [{ name: "L" }, { name: "A" }, { name: "B", rating: 10 }, ...letters("D", "E", "F", "G1", "G2", "G3", "H1", "H2", "H3", "H4")],
      [["A", "D"], ["E", "A"], ["A", "F"], ["D", "B"], ["B", "E"], ["B", "F"], ["D", "E"], ["D", "F"], ["L", "A"], ["L", "B"],
        ["L", "D"], ["G1", "D"], ["L", "E"], ["E", "G2"], ["E", "G3"], ["F", "G1"], ["F", "G2"], ["F", "G3"], ["L", "G1"],
        ["A", "H1"], ["A", "H2"], ["B", "H3"], ["B", "H4"]],
    );
    expect(pair(s)).toEqual([s.id("L"), s.id("A")]);
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

  it("three or more who all played each other: the two with the best record among them are both in", () => {
    // A, B, C and D 3-2. Among them A and B are 2-1, C and D 1-2. A beat B, so A is seeded first.
    const s = build(
      [{ name: "A" }, { name: "B" }, { name: "C", rating: 10 }, { name: "D", rating: 10 }, ...letters("P", "Q", "R", "S")],
      [["A", "B"], ["A", "C"], ["B", "C"], ["B", "D"], ["C", "D"], ["D", "A"], ["C", "P"], ["C", "Q"], ["D", "P"], ["D", "Q"],
        ["A", "R"], ["S", "A"], ["B", "R"], ["S", "B"], ["P", "S"], ["Q", "S"], ["R", "S"]],
    );
    expect(pair(s)).toEqual([s.id("A"), s.id("B")]);
  });

  it("three who didn't all meet: one that lost to both others is out, and the other two are in", () => {
    // A 4-2, B and C 2-1; B and C beat A and never met.
    const s = build([{ name: "A", rating: 10 }, { name: "B" }, { name: "C" }, ...letters("P", "Q", "R", "S")],
      [["B", "A"], ["C", "A"], ["A", "P"], ["A", "Q"], ["A", "R"], ["A", "S"], ["B", "P"], ["Q", "B"], ["C", "R"], ["S", "C"]]);
    expect(pair(s).sort()).toEqual([s.id("B"), s.id("C")].sort());
  });

  it("three who didn't all meet: one that beat both others is in", () => {
    // A beat B and C (who never met); all three 2-1. Then B and C tie on every step but the last two.
    const s = build(
      [{ name: "A" }, { name: "B", rating: 5 }, { name: "C", rating: 10 }, { name: "D" }, { name: "E" }],
      [["A", "B"], ["A", "C"], ["D", "A"], ["B", "D"], ["B", "E"], ["C", "D"], ["C", "E"]],
    );
    expect(pair(s)).toEqual([s.id("A"), s.id("C")]);
  });

  // A and B 1-0 over X and Y (both 0-1), level on every step before scoring margin. X and Y also play outside the
  // conference, which sets the season averages their conference games are measured against.
  const margin = (a: Conf, b: Conf, xOther: [number, number][], yOther: [number, number][], scored = true) =>
    build(
      [{ name: "A" }, { name: "B", rating: 10 }, { name: "X" }, { name: "Y" }, { name: "N", conference: null }],
      [a, b],
      [
        // [X's or Y's points, the opponent's]
        ...xOther.map(([x, n]) => ({ home: "X", away: "N", winner: x > n ? "X" : "N", score: [Math.max(x, n), Math.min(x, n)] as [number, number] })),
        ...yOther.map(([y, n]) => ({ home: "Y", away: "N", winner: y > n ? "Y" : "N", score: [Math.max(y, n), Math.min(y, n)] as [number, number] })),
      ],
      { scored },
    );

  it("once every score is in, the capped relative scoring margin decides", () => {
    // X averages 8.5 scored and 27.5 allowed, so A's 35-7 is +45%; Y averages 12 and 20.5, so B's 21-14 is -14%.
    const s = margin(["A", "X", 35, 7], ["B", "Y", 21, 14], [[10, 20]], [[10, 20]]);
    expect(pair(s)).toEqual([s.id("A"), s.id("B")]);
  });

  it("scoring margin counts at most 200% of what the opponent allows", () => {
    // X allows 17.5 a game, so A's 70 points are 400%, counted as 200%: +124% in all, against B's +160%.
    const s = build(
      [{ name: "A", rating: 10 }, { name: "B" }, { name: "X" }, { name: "Y" }, { name: "N", conference: null }],
      [["A", "X", 70, 7], ["B", "Y", 40, 0]],
      [
        { home: "X", away: "N", winner: "X", score: [10, 0] }, { home: "N", away: "X", winner: "X", score: [10, 0] },
        { home: "X", away: "N", winner: "X", score: [10, 0] }, { home: "Y", away: "N", winner: "Y", score: [20, 10] },
      ],
      { scored: true },
    );
    expect(pair(s)).toEqual([s.id("B"), s.id("A")]);
  });

  it("while a score is still to come, the ranking stands in for scoring margin", () => {
    const s = margin(["A", "X", 35, 7], ["B", "Y", 21, 14], [[10, 20]], [[10, 20]], false);
    expect(pair(s)).toEqual([s.id("B"), s.id("A")]);
  });

  it("the title game, between two members outside the conference schedule, isn't part of the season averages", () => {
    const s = margin(["A", "X", 35, 7], ["B", "Y", 21, 14], [[10, 20]], [[10, 20]]);
    // A 70-0 rout of X here would make X's averages favour B, were it counted.
    const title = { ...s.games[0], id: 99, week: 2, conferenceGame: false, homeId: s.id("A"), awayId: s.id("X"), homePoints: 70, awayPoints: 0 };
    expect(pair({ ...s, games: [...s.games, title] })).toEqual([s.id("A"), s.id("B")]);
  });

  it("level on everything: a random draw, one name per open spot", () => {
    const two = build([{ name: "A" }, { name: "B" }, { name: "X" }, { name: "Y" }], [["A", "X"], ["B", "Y"]]);
    expect(pair(two, () => 0)).toEqual([two.id("A"), two.id("B")]);
    expect(pair(two, () => 0.99)).toEqual([two.id("B"), two.id("A")]);
    const three = build(letters("A", "B", "C", "X", "Y", "Z"), [["A", "X"], ["B", "Y"], ["C", "Z"]]);
    expect(pair(three, () => 0)).toEqual([three.id("A"), three.id("B")]);
    expect(pair(three, () => 0.99)).toEqual([three.id("C"), three.id("B")]);
  });

  it("a tie that scoring margin will settle leaves both teams alive, and the note names that step", () => {
    // L 4-0. A and B 2-1, level on every step before scoring margin, and P and Q (0-1) still meet; the margin isn't
    // known until then, so neither A nor B is in or out.
    const s = build(
      [{ name: "L" }, { name: "A", rating: 5 }, { name: "B" }, ...letters("X", "Y", "Z", "W", "P", "Q")],
      [["L", "A"], ["L", "B"], ["A", "X"], ["A", "Z"], ["B", "Y"], ["B", "W"], ["L", "P"], ["L", "Q"]],
      [{ home: "P", away: "Q" }],
    );
    const games = s.games.map((g) => (g.homeId === s.id("P") && g.awayId === s.id("Q") ? { ...g, conferenceGame: true } : g));
    const sec = { ...s, games };
    const o = seasonOutlook(sec, { conference: "SEC", iterations: 2000, seed: 1 }).teams;
    for (const n of ["A", "B"]) {
      const t = o.find((x) => x.teamId === s.id(n))!;
      expect(t.status, n).toBe("alive");
      expect(t.titleGame, n).toBeGreaterThan(0);
      expect(t.titleGame, n).toBeLessThan(1);
    }
    const way = explore(sec, { conference: "SEC", teamId: s.id("B"), iterations: 2000, seed: 1 }).tree.likeliest!;
    expect(way.needsTiebreak).toBe(true);
    expect(way.note).toMatch(/, depending on the scoring margin tiebreak\.$/);
  });
});

describe("SEC seasons", () => {
  const load = (year: number) => seasonFromCfbd(JSON.parse(readFileSync(`fixtures/sec-${year}.json`, "utf8")) as CfbdSnapshot);
  const members = (s: Season) => s.teams.filter((t) => t.conference === "SEC");

  it("the 2025 results send Alabama and Georgia, who played the real title game", () => {
    // Four teams finished 7-1 with no common opponent; their opponents' win pct put Alabama in, then Georgia.
    const s = load(2025);
    expect(members(s)).toHaveLength(16);
    const name = (id: number) => s.teams.find((t) => t.id === id)!.name;
    expect(pair(s).map(name)).toEqual(["Alabama", "Georgia"]);
    expect(pair(s, () => 0.99).map(name)).toEqual(["Alabama", "Georgia"]);
  });

  it("every team plays eight conference games in 2025 and nine in 2026", () => {
    for (const [year, count] of [[2025, 8], [2026, 9]]) {
      const s = load(year);
      const ids = new Set(members(s).map((t) => t.id));
      for (const id of ids) {
        expect(s.games.filter((g) => g.conferenceGame && (g.homeId === id || g.awayId === id) && ids.has(g.homeId) && ids.has(g.awayId))).toHaveLength(count);
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
    let checked = 0;
    for (const t of members(cut)) {
      const opts = { conference: "SEC", teamId: t.id, iterations: 300, seed: 1 };
      const way = explore(cut, opts).tree.likeliest;
      if (!way || way.needsTiebreak) continue;
      const locks = Object.fromEntries(way.picks.map((p) => [p.gameId, p.winner]));
      expect(explore(cut, { ...opts, locks }).outlook.find((o) => o.teamId === t.id)!.status, t.name).toBe("clinched");
      checked++;
    }
    expect(checked).toBeGreaterThan(2);
  }, 60_000);

  it("2026 title odds across the conference add up to two spots", () => {
    const s = load(2026);
    const o = seasonOutlook(s, { conference: "SEC", iterations: 2000, seed: 1 });
    expect(o.teams).toHaveLength(16);
    expect(o.teams.reduce((sum, t) => sum + t.titleGame, 0)).toBeCloseTo(2, 9);
    for (const t of o.teams) if (t.status === "eliminated") expect(t.titleGame).toBe(0);
    for (const t of o.teams) if (t.status === "clinched") expect(t.titleGame).toBe(1);
  });
});
