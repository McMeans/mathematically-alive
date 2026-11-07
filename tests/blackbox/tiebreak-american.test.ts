import { describe, expect, it } from "vitest";
import {
  championshipParticipants, conferenceName, conferenceShort, conferenceStandings, explore, hasTiebreakRules, seasonFromCfbd,
  simulateNational, teamRecord, type CfbdGame, type Game, type Season,
} from "@/core";

const AAC = "American Athletic";

// Tiny made-up Americans. Teams are named by letter; `rating` stands in for the CFP ranking or the computer composite.
// Teams listed as `outside` are non-conference opponents: FBS unless `fcs`.
type Spec = { name: string; rating?: number; outside?: boolean; fcs?: boolean };
function build(specs: Spec[], conf: [string, string][], nonConf: [string, string][] = [], open: [string, string][] = []): Season & { id: (n: string) => number } {
  let nextId = 0;
  const teams = specs.map((s, i) => ({
    id: i + 1, name: s.name, abbreviation: null, conference: s.outside ? (s.fcs ? "Big Sky" : "Sun Belt") : AAC,
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
const pairWith = (s: Season, d: number) => championshipParticipants(s, AAC, played, { draw: () => d });
const pair = (s: Season) => pairWith(s, 0);

// L 7-0 takes one spot. A and B are 2-2 for the other and never met. Their common opponents are L and C: A lost to L
// and beat C, B lost to both.
const commonRace = (bRating: number) => build(
  [{ name: "L" }, { name: "A" }, { name: "B", rating: bRating }, ...["C", "D", "E", "F", "G"].map((name) => ({ name }))],
  [["L", "A"], ["L", "B"], ["L", "C"], ["L", "D"], ["L", "E"], ["L", "F"], ["L", "G"],
    ["A", "C"], ["A", "D"], ["E", "A"], ["C", "B"], ["B", "F"], ["B", "G"],
    ["D", "E"], ["F", "E"]],
);

// L 4-0 takes one spot. A and B are 1-1 for the other: they never met, both lost to L (their only common opponent),
// A beat P and B beat Q. Outside the conference, `a` and `b` list their games.
const overallRace = (a: [string, string][], b: [string, string][]) => build(
  [{ name: "L" }, { name: "A" }, { name: "B" }, { name: "P" }, { name: "Q" },
    { name: "X", outside: true }, { name: "Y", outside: true }, { name: "Z", outside: true },
    { name: "F1", outside: true, fcs: true }, { name: "F2", outside: true, fcs: true }, { name: "F3", outside: true, fcs: true }],
  [["L", "A"], ["L", "B"], ["L", "P"], ["L", "Q"], ["A", "P"], ["B", "Q"], ["P", "Q"]],
  [...a, ...b],
);

describe("American tiebreakers", () => {
  it("has rules for 2026 and goes by American on the site", () => {
    expect(hasTiebreakRules(AAC, 2026)).toBe(true);
    expect(conferenceName(AAC)).toBe("American");
    expect(conferenceShort(AAC)).toBe("American");
  });

  it("the ranking decides before common opponents", () => {
    const s = commonRace(10);
    expect(pair(s)).toEqual([s.id("L"), s.id("B")]);
  });

  it("level on head-to-head and the ranking: the better record against common opponents plays", () => {
    const s = commonRace(0);
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toEqual([s.id("L"), s.id("A")]);
  });

  it("level through common opponents: the better overall win pct plays, every FCS win counted", () => {
    // A beat three FCS teams and lost to X (4-2 overall); B beat Y and Z and lost to X (3-2). The Mountain West,
    // counting one FCS win, would take B.
    const s = overallRace([["A", "F1"], ["A", "F2"], ["A", "F3"], ["X", "A"]], [["B", "Y"], ["B", "Z"], ["X", "B"]]);
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toEqual([s.id("L"), s.id("A")]);
  });

  it("overall record goes by win pct, not wins", () => {
    // A went 2-2 outside the conference (3-3 overall), B 1-0 (2-1 overall).
    const s = overallRace([["A", "X"], ["A", "Y"], ["Z", "A"], ["X", "A"]], [["B", "Y"]]);
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toEqual([s.id("L"), s.id("B")]);
  });

  it("level on every step: a coin toss decides", () => {
    const s = overallRace([], []);
    const picks = [0, 0.99].map((d) => pairWith(s, d)[1]);
    expect(new Set(picks)).toEqual(new Set([s.id("A"), s.id("B")]));
  });

  it("a three-way tie where not all played each other: the one that beat both others is in", () => {
    // L 6-0 takes one spot. A, B and C are 2-2: A beat B and C, who never met. B and C rate higher.
    const s = build(
      [{ name: "L" }, { name: "A" }, { name: "B", rating: 10 }, { name: "C", rating: 10 }, { name: "P" }, { name: "Q" }, { name: "R" }],
      [["L", "A"], ["L", "B"], ["L", "C"], ["L", "P"], ["L", "Q"], ["L", "R"],
        ["A", "B"], ["A", "C"], ["P", "A"], ["B", "P"], ["B", "Q"], ["C", "Q"], ["C", "R"]],
    );
    expect(conferenceStandings(s, AAC, played).slice(1, 4).map((r) => r.pct)).toEqual([0.5, 0.5, 0.5]);
    expect(pair(s)).toEqual([s.id("L"), s.id("A")]);
  });

  it("a team that lost to the others isn't dropped for it: the ranking still decides", () => {
    // L 6-0 takes one spot. A, B and C are level at .500 for the other: A and B never met, and both beat C (3-3).
    // C rates highest.
    const s = build(
      [{ name: "L" }, { name: "A" }, { name: "B" }, { name: "C", rating: 10 }, { name: "P" }, { name: "Q" }, { name: "R" }],
      [["L", "A"], ["L", "B"], ["L", "C"], ["L", "P"], ["L", "Q"], ["L", "R"], ["A", "C"], ["B", "C"],
        ["C", "P"], ["C", "Q"], ["C", "R"]],
    );
    expect(conferenceStandings(s, AAC, played).slice(1, 4).map((r) => r.pct)).toEqual([0.5, 0.5, 0.5]);
    expect(pair(s)).toEqual([s.id("L"), s.id("C")]);
  });

  it("three tied for first: the two the ranking puts level on top both play", () => {
    // A, B and C are 3-1; only B and C met (C won). A and B rate level, above C. A has the better overall record.
    // Placed one at a time, A would go first and C, having beaten B, would take the other spot.
    const s = build(
      [{ name: "A", rating: 10 }, { name: "B", rating: 10 }, { name: "C" }, ...["D", "E", "F", "G", "H"].map((name) => ({ name })),
        { name: "X", outside: true }],
      [["G", "A"], ["A", "D"], ["A", "E"], ["A", "F"], ["C", "B"], ["B", "D"], ["B", "E"], ["B", "H"],
        ["C", "D"], ["E", "C"], ["C", "F"], ["D", "G"], ["E", "G"], ["F", "G"]],
      [["A", "X"]],
    );
    for (const d of [0, 0.99]) expect(new Set(pairWith(s, d))).toEqual(new Set([s.id("A"), s.id("B")]));
  });

  it("an American team's path names the conference American", () => {
    const s = build([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }],
      [["A", "D"], ["B", "C"]], [], [["A", "B"], ["C", "D"], ["A", "C"], ["B", "D"]]);
    const r = explore(s, { conference: AAC, teamId: s.id("A"), iterations: 300, seed: 7 });
    expect(r.path.summary).toMatch(/American title game/);
    expect(r.path.summary).not.toMatch(/American Athletic/);
  });
});

// Army-Navy as CFBD lists it: a conference game (both are American members), in the week after the title game.
type RawGame = [home: string, away: string, week: number, winner: string | null, conferenceGame: boolean, neutral?: boolean];
function fromCfbd(members: string[], outside: string[], rows: RawGame[]): Season & { id: (n: string) => number } {
  const names = [...members, ...outside];
  const idOf = (n: string) => names.indexOf(n) + 1;
  const conf = (n: string) => (members.includes(n) ? AAC : "Sun Belt");
  const games: CfbdGame[] = rows.map(([home, away, week, winner, conferenceGame, neutral], i) => ({
    id: 100 + i, week, startDate: `2026-${week >= 14 ? "12" : "11"}-${String(week >= 14 ? (week - 13) * 6 : week).padStart(2, "0")}T18:00:00.000Z`,
    completed: winner !== null, neutralSite: neutral ?? false, conferenceGame,
    homeId: idOf(home), homeTeam: home, homeConference: conf(home), homeClassification: "fbs",
    homePoints: winner === null ? null : winner === home ? 24 : 10,
    awayId: idOf(away), awayTeam: away, awayConference: conf(away), awayClassification: "fbs",
    awayPoints: winner === null ? null : winner === away ? 24 : 10,
  }));
  const s = seasonFromCfbd({
    year: 2026, fetchedAt: "",
    teams: names.map((n) => ({ id: idOf(n), school: n, conference: conf(n), classification: "fbs" })),
    games, lines: [], ratings: [],
  });
  return { ...s, id: idOf };
}

describe("Army-Navy and the American", () => {
  // L beat everyone; Army beat P; B beat Q; P and Q beat Navy. Outside the conference Army beat X and B beat Y.
  // Army-Navy, flagged a conference game, is played after the title game.
  const rows = (armyNavy: string | null): RawGame[] => [
    ["L", "Army", 10, "L", true], ["L", "B", 10, "L", true], ["L", "P", 11, "L", true], ["L", "Q", 11, "L", true],
    ["L", "Navy", 12, "L", true], ["Army", "P", 12, "Army", true], ["B", "Q", 12, "B", true],
    ["P", "Navy", 13, "P", true], ["Q", "Navy", 13, "Q", true],
    ["Army", "X", 1, "Army", false], ["B", "Y", 1, "B", false],
    ["Army", "Navy", 15, armyNavy, true, true],
  ];
  const members = ["L", "Army", "B", "P", "Q", "Navy"];

  it("isn't an American conference game: it counts in neither team's conference record", () => {
    const s = fromCfbd(members, ["X", "Y"], rows("Navy"));
    expect(teamRecord(s, s.id("Army"))).toMatchObject({ wins: 2, losses: 2, conferenceWins: 1, conferenceLosses: 1 });
    expect(teamRecord(s, s.id("Navy"))).toMatchObject({ conferenceWins: 0, conferenceLosses: 3 });
    const navy = conferenceStandings(s, AAC, played).find((r) => r.teamId === s.id("Navy"))!;
    expect([navy.wins, navy.losses]).toEqual([0, 3]);
  });

  it("played after the title game, it doesn't count in Army's overall record for the tiebreak", () => {
    // Army and B are level through common opponents and 2-1 overall before Army-Navy: a coin toss decides, even with
    // Army's loss to Navy in the data.
    const s = fromCfbd(members, ["X", "Y"], rows("Navy"));
    const picks = [0, 0.99].map((d) => pairWith(s, d)[1]);
    expect(new Set(picks)).toEqual(new Set([s.id("Army"), s.id("B")]));
  });

  it("the title game in the data decides the champion, not Army-Navy a week later", () => {
    // As above, but B also beat P, so L and B are first and second. They met in the title game in week 14 (L won);
    // Army-Navy is still to come.
    const s = fromCfbd(members, ["X", "Y"], [...rows(null), ["B", "P", 13, "B", true], ["L", "B", 14, "L", false, true]]);
    const r = simulateNational(s, { iterations: 40, seed: 3, conferences: [AAC] });
    r.forEachIteration((_, x) => {
      expect(x.champion(AAC)).toBe(s.id("L"));
    });
  });

  it("when Army and Navy play for the title, Army-Navy's result isn't taken for the title game", () => {
    // Army and Navy beat everyone else; Navy also wins Army-Navy, a week after the title game.
    const s = fromCfbd(["Army", "Navy", "C", "D", "E"], [], [
      ["Army", "C", 10, "Army", true], ["Army", "D", 11, "Army", true], ["Army", "E", 12, "Army", true],
      ["Navy", "C", 11, "Navy", true], ["Navy", "D", 12, "Navy", true], ["Navy", "E", 13, "Navy", true],
      ["C", "D", 13, "C", true], ["D", "E", 10, "D", true], ["E", "C", 12, "E", true],
      ["Army", "Navy", 15, "Navy", true, true],
    ]);
    const r = simulateNational(s, { iterations: 200, seed: 5, conferences: [AAC] });
    const champs = new Set<number>();
    r.forEachIteration((_, x) => {
      expect(new Set(x.titleGame(AAC).slice(0, 2))).toEqual(new Set([s.id("Army"), s.id("Navy")]));
      champs.add(x.champion(AAC));
    });
    expect(champs).toEqual(new Set([s.id("Army"), s.id("Navy")]));
  });
});
