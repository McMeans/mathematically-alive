import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { championshipParticipants, explore, pathTree, seasonFromCfbd, seasonOutlook, type CfbdSnapshot, type Game, type Season } from "@/core";

// Tiny made-up Big 12s. Teams are named by letter; `rating` stands in for the SportSource ranking, and
// each test rates the team the earlier steps should lose higher, so a pass means those steps decided.
type Spec = { name: string; rating?: number; conference?: string | null; fcs?: boolean };
let nextId = 0;
function build(specs: Spec[], conf: [string, string][], other: { home: string; away: string; winner?: string }[] = []): Season & { id: (n: string) => number } {
  nextId = 0;
  const teams = specs.map((s, i) => ({
    id: i + 1, name: s.name, abbreviation: null, conference: s.conference === undefined ? "Big 12" : s.conference,
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
    ...other.map((g) => game(id(g.home), id(g.away), g.winner === undefined ? undefined : id(g.winner), false)),
  ];
  return { year: 2026, fetchedAt: "", teams, games, id };
}
const played = (g: Game) => (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId);
const pair = (s: Season, winnerOf: (g: Game) => number = played, draw = () => 0) =>
  championshipParticipants(s, "Big 12", winnerOf, { draw });

describe("Big 12 tiebreakers", () => {
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

  it("level against common opponents: the result against the best placed of them decides, a tied group counting as one", () => {
    // L 3-0. A and B 2-2, both 0-1 against L and 2-2 against all common opponents. Y and Q (1-2) are the next
    // placed, tied: A is 1-1 against them as a group, B 2-0.
    const s = build(
      [{ name: "L" }, { name: "A", rating: 10 }, { name: "B" }, { name: "X" }, { name: "Y" }, { name: "Q" }],
      [["L", "A"], ["L", "B"], ["L", "X"], ["A", "X"], ["Y", "A"], ["A", "Q"], ["X", "B"], ["B", "Y"], ["B", "Q"], ["Q", "X"]],
    );
    expect(pair(s)).toEqual([s.id("L"), s.id("B")]);
  });

  it("with nothing in common, the tougher conference schedule seeds first", () => {
    // A and B 1-0, no common opponents. A beat X (1-1), B beat Y (0-2).
    const s = build([{ name: "A" }, { name: "B", rating: 10 }, { name: "X" }, { name: "Y" }],
      [["A", "X"], ["B", "Y"], ["X", "Y"]]);
    expect(pair(s)).toEqual([s.id("A"), s.id("B")]);
  });

  it("then total wins, counting only one win over a team below FBS", () => {
    // A and B 1-0 over winless X and Y. A beat two FCS teams (one counts), B one FBS and one FCS team.
    const s = build(
      [{ name: "A", rating: 10 }, { name: "B" }, { name: "X" }, { name: "Y" },
        { name: "F1", conference: null, fcs: true }, { name: "F2", conference: null, fcs: true }, { name: "N", conference: null }],
      [["A", "X"], ["B", "Y"]],
      [{ home: "A", away: "F1", winner: "A" }, { home: "A", away: "F2", winner: "A" }, { home: "B", away: "N", winner: "B" }, { home: "B", away: "F1", winner: "B" }],
    );
    expect(pair(s)).toEqual([s.id("B"), s.id("A")]);
  });

  it("total wins leaves out the title game, a non-conference game between two members", () => {
    // A and B 1-0 over winless X and Y, level on every step before total wins. A beat N outside the conference;
    // B beat X in the title game, which comes after the tiebreak, so A has more wins. B is ranked higher.
    const s = build(
      [{ name: "A" }, { name: "B", rating: 10 }, { name: "X" }, { name: "Y" }, { name: "N", conference: null }],
      [["A", "X"], ["B", "Y"]],
      [{ home: "A", away: "N", winner: "A" }, { home: "B", away: "X", winner: "B" }],
    );
    expect(pair(s)).toEqual([s.id("A"), s.id("B")]);
    const title = s.games.find((g) => !g.conferenceGame && g.homeId === s.id("B"))!;
    const unplayed = { ...s, games: s.games.map((g) => (g === title ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)) };
    expect(pair(unplayed, (g) => (g.id === title.id ? s.id("B") : played(g)))).toEqual([s.id("A"), s.id("B")]);
  });

  it("an unplayed non-conference game counts for total wins as the caller decides it", () => {
    const s = build(
      [{ name: "A" }, { name: "B", rating: 10 }, { name: "X" }, { name: "Y" }, { name: "N", conference: null }],
      [["A", "X"], ["B", "Y"]],
      [{ home: "A", away: "N" }],
    );
    const nonConf = s.games.find((g) => !g.conferenceGame)!;
    expect(pair(s, (g) => (g === nonConf ? s.id("A") : played(g)))).toEqual([s.id("A"), s.id("B")]);
    expect(pair(s, (g) => (g === nonConf ? s.id("N") : played(g)))).toEqual([s.id("B"), s.id("A")]);
  });

  it("then the ranking, then a coin toss", () => {
    const even = (b: number) => build([{ name: "A" }, { name: "B", rating: b }, { name: "X" }, { name: "Y" }], [["A", "X"], ["B", "Y"]]);
    const ranked = even(10);
    expect(pair(ranked)).toEqual([ranked.id("B"), ranked.id("A")]);
    const tossed = even(0);
    expect(pair(tossed, played, () => 0)).toEqual([tossed.id("A"), tossed.id("B")]);
    expect(pair(tossed, played, () => 0.99)).toEqual([tossed.id("B"), tossed.id("A")]);
  });

  it("three teams who all met: once one is seeded on a later step, the other two go back to head-to-head", () => {
    // A beat B, B beat C, C beat A; all beat D. Every step through schedule strength is even; C has an extra
    // non-conference win, so C is seeded, then A gets the second spot over B by head-to-head.
    const s = build(
      [{ name: "A" }, { name: "B", rating: 10 }, { name: "C" }, { name: "D" }, { name: "N", conference: null }],
      [["A", "B"], ["B", "C"], ["C", "A"], ["A", "D"], ["B", "D"], ["C", "D"]],
      [{ home: "C", away: "N", winner: "C" }],
    );
    expect(pair(s)).toEqual([s.id("C"), s.id("A")]);
  });

  it("three teams who didn't all meet: one that beat both others is seeded first", () => {
    // A beat B and C (who never met); all three 2-1. Then B and C tie on every step but the ranking.
    const s = build(
      [{ name: "A" }, { name: "B", rating: 5 }, { name: "C", rating: 10 }, { name: "D" }, { name: "E" }],
      [["A", "B"], ["A", "C"], ["D", "A"], ["B", "D"], ["B", "E"], ["C", "D"], ["C", "E"]],
    );
    expect(pair(s)).toEqual([s.id("A"), s.id("C")]);
  });

  it("a tie decided by total wins still open in a non-conference game leaves both teams alive", () => {
    // L 2-0. A and B 1-1, level on every step before total wins. B has one more non-conference win so far; A
    // still plays N. Win and A ties B on wins and gets in on the ranking; lose and B gets in.
    const s = build(
      // The ranking moves with simulated results, so A's lead there is wide.
      [{ name: "L" }, { name: "A", rating: 40 }, { name: "B" }, { name: "X" }, { name: "Y" },
        { name: "N", conference: null, rating: 40 }, { name: "M", conference: null }],
      [["L", "A"], ["L", "B"], ["A", "X"], ["B", "Y"]],
      [{ home: "B", away: "M", winner: "B" }, { home: "A", away: "N" }],
    );
    const odds = (locks?: Record<number, number>) =>
      seasonOutlook(s, { conference: "Big 12", iterations: 2000, seed: 1, locks }).teams.find((o) => o.teamId === s.id("A"))!;
    const open = odds();
    expect(open.titleGame).toBeGreaterThan(0.3);
    expect(open.titleGame).toBeLessThan(1);
    expect(open.status).toBe("alive");
    const nonConf = s.games.find((g) => !g.conferenceGame && g.homeId === s.id("A"))!;
    expect(odds({ [nonConf.id]: s.id("A") }).titleGame).toBe(1);
    const lost = odds({ [nonConf.id]: s.id("N") });
    expect(lost.titleGame).toBe(0);
  });
});

describe("non-conference games in the Big 12", () => {
  // L 2-0. A and B 1-1, level on every step before total wins; B has one more non-conference win, and A still
  // plays N. The result decides the second spot, through total wins.
  const scenario = (conference: string) => {
    // P and Q (0-2) still meet: a conference game left that week, which the week list is built around.
    const s = build(
      [{ name: "L" }, { name: "A", rating: 40 }, { name: "B" }, { name: "X" }, { name: "Y" }, { name: "P" }, { name: "Q" },
        { name: "N", conference: null, rating: 40 }, { name: "M", conference: null }],
      [["L", "A"], ["L", "B"], ["A", "X"], ["B", "Y"], ["L", "P"], ["L", "Q"]],
      [{ home: "B", away: "M", winner: "B" }, { home: "A", away: "N" }, { home: "P", away: "Q" }],
    );
    const games = s.games.map((g) => (g.homeId === s.id("P") && g.awayId === s.id("Q") ? { ...g, conferenceGame: true } : g));
    const named = { ...s, games, teams: s.teams.map((t) => (t.conference === "Big 12" ? { ...t, conference } : t)) };
    const card = pathTree(named, { conference, teamId: s.id("A"), iterations: 2000, seed: 1 }).weeks.find((w) => w.nonConference)!.nonConference!;
    return card;
  };

  it("a Big 12 team's non-conference card shows its title odds either way, since total wins counts it", () => {
    const card = scenario("Big 12");
    expect(card.titleIfWin).toBe(">99%");
    expect(card.titleIfLose).toBe("<0.1%");
  });

  it("where the tiebreak ignores non-conference results, the card shows no title odds", () => {
    const card = scenario("ACC");
    expect(card.titleIfWin).toBeNull();
    expect(card.titleIfLose).toBeNull();
    expect(card.ifWin).not.toBeNull();
  });
});

describe("Big 12 seasons", () => {
  const load = (year: number) => seasonFromCfbd(JSON.parse(readFileSync(`fixtures/big-12-${year}.json`, "utf8")) as CfbdSnapshot);

  it("the 2025 results send Texas Tech and BYU, who played the real title game", () => {
    const s = load(2025);
    const big12 = s.teams.filter((t) => t.conference === "Big 12");
    expect(big12).toHaveLength(16);
    const name = (id: number) => s.teams.find((t) => t.id === id)!.name;
    expect(pair(s).map(name).sort()).toEqual(["BYU", "Texas Tech"]);
  });

  it("every team plays nine conference games, so no team is placed by game count", () => {
    for (const s of [load(2025), load(2026)]) {
      const ids = new Set(s.teams.filter((t) => t.conference === "Big 12").map((t) => t.id));
      for (const id of ids) {
        expect(s.games.filter((g) => g.conferenceGame && (g.homeId === id || g.awayId === id) && ids.has(g.homeId) && ids.has(g.awayId))).toHaveLength(9);
      }
    }
  });

  it("the likeliest way in proves the spot once locked, three and four weeks from the end of 2025", () => {
    const full = load(2025);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    let checked = 0;
    for (const weeks of [3, 4]) {
      const cut: Season = {
        ...full,
        games: full.games.map((g) => (g.week > last - weeks ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
      };
      for (const t of cut.teams.filter((x) => x.conference === "Big 12")) {
        const opts = { conference: "Big 12", teamId: t.id, iterations: 300, seed: 1 };
        const way = explore(cut, opts).tree.likeliest;
        if (!way || way.needsTiebreak) continue;
        const locks = Object.fromEntries(way.picks.map((p) => [p.gameId, p.winner]));
        expect(explore(cut, { ...opts, locks }).outlook.find((o) => o.teamId === t.id)!.status, t.name).toBe("clinched");
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(5);
  }, 60_000);

  it("a way in through the tiebreak names total wins as well as the ranking", () => {
    const s = load(2026);
    const notes = s.teams
      .filter((t) => t.conference === "Big 12")
      .map((t) => explore(s, { conference: "Big 12", teamId: t.id, iterations: 300, seed: 1 }).tree.likeliest)
      .filter((w) => w?.needsTiebreak);
    expect(notes.length).toBeGreaterThan(0);
    for (const w of notes) expect(w!.note).toMatch(/, depending on total wins and the ranking tiebreak\.$/);
  }, 60_000);

  it("2026 title odds across the conference add up to two spots", () => {
    const s = load(2026);
    const o = seasonOutlook(s, { conference: "Big 12", iterations: 2000, seed: 1 });
    expect(o.teams).toHaveLength(16);
    expect(o.teams.reduce((sum, t) => sum + t.titleGame, 0)).toBeCloseTo(2, 9);
    for (const t of o.teams) if (t.status === "eliminated") expect(t.titleGame).toBe(0);
  });
});
