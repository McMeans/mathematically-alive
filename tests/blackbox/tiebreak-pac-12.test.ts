import { describe, expect, it } from "vitest";
import {
  championshipParticipants, conferenceName, conferenceStandings, explore, hasTiebreakRules, seasonFromCfbd, seasonOutlook, teamRecord,
  type CfbdGame, type Game, type Season,
} from "@/core";

const PAC = "Pac-12";

// Tiny made-up Pac-12s, named by letter; `rating` stands in for the CFP ranking and the SportSource score.
function build(names: string[], conf: [string, string][], ratings: Record<string, number> = {}): Season & { id: (n: string) => number } {
  const teams = names.map((name, i) => ({
    id: i + 1, name, abbreviation: null, conference: PAC, classification: "fbs" as const, color: null, altColor: null, rating: ratings[name] ?? 0,
  }));
  const id = (n: string) => teams.find((t) => t.name === n)!.id;
  const games: Game[] = conf.map(([w, l], i) => ({
    id: i, week: 5 + (i % 8), start: "2026-11-07T18:00:00Z", neutralSite: false, conferenceGame: true,
    homeId: id(w), awayId: id(l), homePoints: 21, awayPoints: 14, completed: true, spread: null,
  }));
  return { year: 2026, fetchedAt: "", teams, games, id };
}

const EIGHT = ["A", "B", "C", "D", "E", "F", "G", "H"];
/** A round robin of the eight: each team beats every team listed after it, except the `upsets` ([winner, loser]). */
function roundRobin(upsets: [string, string][], ratings: Record<string, number> = {}) {
  const games: [string, string][] = [];
  EIGHT.forEach((a, i) => EIGHT.slice(i + 1).forEach((b) => {
    const upset = upsets.some(([w, l]) => w === b && l === a);
    games.push(upset ? [b, a] : [a, b]);
  }));
  return build(EIGHT, games, ratings);
}

const played = (g: Game) => (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId);
const pairWith = (s: Season, d: number) => championshipParticipants(s, PAC, played, { draw: () => d });
const record = (s: Season & { id: (n: string) => number }, n: string) => {
  const r = conferenceStandings(s, PAC, played).find((x) => x.teamId === s.id(n))!;
  return `${r.wins}-${r.losses}`;
};

describe("Pac-12 tiebreakers", () => {
  it("has rules for 2026 and goes by Pac 12 on the site", () => {
    expect(hasTiebreakRules(PAC, 2026)).toBe(true);
    expect(hasTiebreakRules(PAC, 2027)).toBe(false);
    expect(conferenceName(PAC)).toBe("Pac 12");
  });

  it("two tied for first both play, and the head-to-head winner is seeded first", () => {
    // A and B are 6-1, A beat B. A lost to H, whom B beat, so B would go first on the two-team steps.
    const s = roundRobin([["H", "A"]]);
    expect([record(s, "A"), record(s, "B")]).toEqual(["6-1", "6-1"]);
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toEqual([s.id("A"), s.id("B")]);
  });

  it("two tied for second: head-to-head isn't a step, the record against the next-highest-placed teams decides", () => {
    // A is 7-0. B and C are 5-2, and B beat C, but B lost to H, the bottom team; C beat everyone below it.
    const s = roundRobin([["H", "B"]]);
    expect([record(s, "A"), record(s, "B"), record(s, "C")]).toEqual(["7-0", "5-2", "5-2"]);
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toEqual([s.id("A"), s.id("C")]);
  });

  it("for two teams the next-highest-placed common opponent comes before the record against all common opponents", () => {
    // B (5-2) beat A, the top team, and C, then lost to G and H. C (5-2) lost only to A and B. Against all common
    // opponents C is 5-1 and B 4-2; against A, the highest placed, B is 1-0 and C 0-1.
    const s = roundRobin([["B", "A"], ["G", "B"], ["H", "B"]]);
    expect([record(s, "A"), record(s, "B"), record(s, "C")]).toEqual(["6-1", "5-2", "5-2"]);
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toEqual([s.id("A"), s.id("B")]);
  });

  it("three tied for first: head-to-head seeds one, then the other two go to the two-team steps", () => {
    // A, B and C are 5-2. A beat B and C, B beat C. A lost to G and H, B to H. Of the two left, C beat all of
    // F, G and H (level at 2-5) and B didn't; head-to-head between them doesn't count.
    const s = roundRobin([["G", "A"], ["H", "A"], ["H", "B"]]);
    expect(["A", "B", "C"].map((n) => record(s, n))).toEqual(["5-2", "5-2", "5-2"]);
    expect(["F", "G", "H"].map((n) => record(s, n))).toEqual(["2-5", "2-5", "2-5"]);
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toEqual([s.id("A"), s.id("C")]);
  });

  it("three tied in a circle: the next-highest-placed common opponent decides, one spot at a time", () => {
    // A beat B, B beat C, C beat A: 1-1 each among them, so their records against everyone else are level too. Each
    // lost once below: A to H, B to G, C to F. E and F are level at 3-4: A and B beat both, C split, so A and B go on
    // to the two-team steps for the top seed. There C, at 5-2, is their highest-placed common opponent: B beat it, A
    // didn't. For second, A beat B, the highest placed team left, and C didn't.
    const s = roundRobin([["C", "A"], ["H", "A"], ["G", "B"], ["F", "C"]]);
    expect(["A", "B", "C"].map((n) => record(s, n))).toEqual(["5-2", "5-2", "5-2"]);
    expect(["E", "F"].map((n) => record(s, n))).toEqual(["3-4", "3-4"]);
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toEqual([s.id("B"), s.id("A")]);
  });

  it("three tied where not all played each other: no one is in for beating the other two, the next step decides", () => {
    // L is 3-1. A, B and C are 2-2; B and C never met (a canceled game). A beat both but lost to P and Q, whom B and
    // C beat: against their common opponents (P and Q) B and C are 2-0, A 0-2. Level through the two-team steps, B is
    // rated higher.
    const s = build(["L", "A", "B", "C", "P", "Q"], [
      ["L", "B"], ["L", "C"], ["L", "P"], ["Q", "L"],
      ["A", "B"], ["A", "C"], ["P", "A"], ["Q", "A"],
      ["B", "P"], ["B", "Q"], ["C", "P"], ["C", "Q"],
      ["P", "Q"],
    ], { B: 10 });
    expect(["L", "A", "B", "C"].map((n) => record(s, n))).toEqual(["3-1", "2-2", "2-2", "2-2"]);
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toEqual([s.id("L"), s.id("B")]);
  });

  it("two tied for second with nothing else between them (no game, same results): the ranking, then a coin toss", () => {
    // L beat everyone; B and C never met, and both beat D and E.
    const games: [string, string][] = [["L", "B"], ["L", "C"], ["L", "D"], ["L", "E"], ["B", "D"], ["B", "E"], ["C", "D"], ["C", "E"], ["D", "E"]];
    const ranked = build(["L", "B", "C", "D", "E"], games, { C: 5 });
    for (const d of [0, 0.99]) expect(pairWith(ranked, d)).toEqual([ranked.id("L"), ranked.id("C")]);
    const level = build(["L", "B", "C", "D", "E"], games);
    expect(new Set([0, 0.99].map((d) => pairWith(level, d)[1]))).toEqual(new Set([level.id("B"), level.id("C")]));
  });

  it("a Pac-12 team's path names the conference Pac 12", () => {
    const s = roundRobin([]);
    const open = { ...s, games: s.games.map((g, i) => (i % 3 === 0 ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)) };
    const r = explore(open, { conference: PAC, teamId: s.id("B"), iterations: 200, seed: 1 });
    const text = JSON.stringify([r.path, r.tree.likeliest]);
    expect(text).toMatch(/Pac 12 title game/);
    expect(text).not.toMatch(/Pac-12/);
  });
});

// The Pac-12's eight 2026 members, as CFBD names them.
const MEMBERS = ["Boise State", "Colorado State", "Fresno State", "Oregon State", "San Diego State", "Texas State", "Utah State", "Washington State"];
type RawGame = [home: string, away: string, week: number, winner: string | null, conferenceGame: boolean];
function fromCfbd(rows: RawGame[], year = 2026, conference = PAC): Season & { id: (n: string) => number } {
  const names = [...MEMBERS, "Nevada"];
  const idOf = (n: string) => names.indexOf(n) + 1;
  const conf = (n: string) => (MEMBERS.includes(n) ? conference : "Mountain West");
  const games: CfbdGame[] = rows.map(([home, away, week, winner, conferenceGame], i) => ({
    id: 100 + i, week, startDate: `${year}-11-${String(week).padStart(2, "0")}T18:00:00.000Z`, completed: winner !== null,
    neutralSite: false, conferenceGame,
    homeId: idOf(home), homeTeam: home, homeConference: conf(home), homeClassification: "fbs",
    homePoints: winner === null ? null : winner === home ? 24 : 10,
    awayId: idOf(away), awayTeam: away, awayConference: conf(away), awayClassification: "fbs",
    awayPoints: winner === null ? null : winner === away ? 24 : 10,
  }));
  const s = seasonFromCfbd({
    year, fetchedAt: "",
    teams: names.map((n) => ({ id: idOf(n), school: n, conference: conf(n), classification: "fbs" })),
    games, lines: [], ratings: [],
  });
  return { ...s, id: idOf };
}

describe("the Pac-12's week-13 flex games", () => {
  const conference: RawGame[] = [
    ["Boise State", "Utah State", 5, "Boise State", true], ["Oregon State", "Washington State", 6, "Oregon State", true],
    ["Fresno State", "San Diego State", 7, null, true], ["Texas State", "Colorado State", 8, null, true],
  ];
  const name = (s: Season, id: number) => s.teams.find((t) => t.id === id)!.name;
  const week13 = (s: Season) => s.games.filter((g) => g.week === 13).map((g) => `${name(s, g.awayId)} at ${name(s, g.homeId)}`).sort();

  it("until the data has them, the four projected pairings are played on Nov. 28, home teams as announced", () => {
    const s = fromCfbd(conference);
    expect(week13(s)).toEqual([
      "Boise State at Utah State", "Oregon State at Washington State", "San Diego State at Fresno State", "Texas State at Colorado State",
    ]);
    for (const g of s.games.filter((x) => x.week === 13)) {
      expect(g).toMatchObject({ conferenceGame: false, completed: false, neutralSite: false, homePoints: null });
      expect(g.start.startsWith("2026-11-28")).toBe(true);
    }
    expect(new Set(s.games.map((g) => g.id)).size).toBe(s.games.length);
  });

  it("a flex game the data has is a non-conference game, and replaces the projected games of both its teams", () => {
    // CFBD lists a flexed Boise State at Fresno State, flagged a conference game like every game between members.
    const s = fromCfbd([...conference, ["Fresno State", "Boise State", 13, "Fresno State", true]]);
    expect(week13(s)).toEqual(["Boise State at Fresno State", "Oregon State at Washington State", "Texas State at Colorado State"]);
    expect(s.games.find((g) => g.week === 13 && g.homeId === s.id("Fresno State"))!.conferenceGame).toBe(false);
    expect(teamRecord(s, s.id("Boise State"))).toEqual({ wins: 1, losses: 1, conferenceWins: 1, conferenceLosses: 0 });
    const boise = conferenceStandings(s, PAC, played).find((r) => r.teamId === s.id("Boise State"))!;
    expect([boise.wins, boise.losses]).toEqual([1, 0]);
  });

  it("a member's week-13 game against a non-member keeps its pairing out", () => {
    const s = fromCfbd([...conference, ["Nevada", "Boise State", 13, null, false]]);
    expect(week13(s)).toEqual(["Boise State at Nevada", "Oregon State at Washington State", "San Diego State at Fresno State", "Texas State at Colorado State"]);
  });

  it("no flex games for another season or conference", () => {
    expect(week13(fromCfbd(conference, 2027))).toEqual([]);
    expect(week13(fromCfbd(conference, 2026, "Mountain West"))).toEqual([]);
    const s = fromCfbd([["Fresno State", "Boise State", 13, "Fresno State", true]], 2026, "Mountain West");
    expect(s.games[0].conferenceGame).toBe(true);
  });

  it("the title game is set before the flex week: a flex game's result doesn't move the ranking tiebreak", () => {
    // L beat everyone. B and C never met and both beat D and E: the ranking decides second. B plays D in week 13, a
    // flex game; were it counted in the ranking, a B win would put B ahead more often.
    const s = build(["L", "B", "C", "D", "E"],
      [["L", "B"], ["L", "C"], ["L", "D"], ["L", "E"], ["B", "D"], ["B", "E"], ["C", "D"], ["C", "E"], ["D", "E"]]);
    const flex: Game = {
      id: 99, week: 13, start: "2026-11-28T17:00:00.000Z", neutralSite: false, conferenceGame: false,
      homeId: s.id("D"), awayId: s.id("B"), homePoints: null, awayPoints: null, completed: false, spread: null,
    };
    const season = { ...s, games: [...s.games, flex] };
    const odds = (locks: Record<number, number>) =>
      seasonOutlook(season, { conference: PAC, iterations: 400, seed: 3, locks }).teams.map((t) => [t.teamId, t.titleGame]);
    const base = odds({});
    const b = base.find(([id]) => id === s.id("B"))![1]!;
    expect(b).toBeGreaterThan(0.3);
    expect(b).toBeLessThan(0.7);
    expect(odds({ 99: s.id("B") })).toEqual(base);
    expect(odds({ 99: s.id("D") })).toEqual(base);
  });
});
