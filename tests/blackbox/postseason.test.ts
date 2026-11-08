// The playoff once the committee has announced the field, end to end on the real 2025 postseason
// (fixtures/national-2025.json: every FBS game of 2025, the title games and playoff games with CFBD's seeds included,
// and the committee's rankings). Core has only the 2026 rules, so the season runs as 2026 where rules are needed;
// the field from the selection-day ranking is checked under both seasons' formats.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  announcedField, checkFetch, formatPlayoff, independentOutlook, nationalView, playoffDetail, playoffRoute, seasonFromCfbd,
  seasonOutlook, simulateNational, type CfbdSnapshot, type PlayoffGame, type Season,
} from "@/core";

const raw = JSON.parse(readFileSync("fixtures/national-2025.json", "utf8")) as CfbdSnapshot;
const season = seasonFromCfbd({ ...raw, year: 2026 });
const season2025 = seasonFromCfbd(raw);
const POWER = ["ACC", "Big 12", "Big Ten", "SEC"];
const names = (s: Season, ids: readonly number[]) => ids.map((id) => s.teams.find((t) => t.id === id)!.name);
const id = (n: string) => season.teams.find((t) => t.name === n)!.id;

const BRACKET_2025 = [
  "Indiana", "Ohio State", "Georgia", "Texas Tech", "Oregon", "Ole Miss", "Texas A&M", "Oklahoma", "Alabama", "Miami", "Tulane", "James Madison",
];

/** The season with the playoff games from `round` on not yet played. */
const unplayedFrom = (s: Season, rounds: string[]): Season => ({
  ...s,
  playoffGames: s.playoffGames!.map((g): PlayoffGame => (rounds.includes(g.round) ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
});
/** The season with only the playoff games of `rounds` listed (CFBD lists a game once its matchup is set). */
const listedOnly = (s: Season, rounds: string[]): Season => ({ ...s, playoffGames: s.playoffGames!.filter((g) => rounds.includes(g.round)) });

describe("the announced field", () => {
  it("comes from CFBD's playoff games, which seed every team (2025)", () => {
    const f = announcedField(season)!;
    expect(f.source).toBe("bracket");
    expect(names(season, f.seeds)).toEqual(BRACKET_2025);
  });

  it("from the selection-day ranking under the 2025 format, it is the field the committee announced", () => {
    const f = announcedField({ ...season2025, playoffGames: [] })!;
    expect(f.source).toBe("ranking");
    expect(names(season2025, f.seeds)).toEqual(BRACKET_2025);
  });

  it("under the 2026 format the same ranking sends Duke, an unranked power champion, last, and Notre Dame in the top 12", () => {
    const f = announcedField({ ...season, playoffGames: [] })!;
    expect(names(season, f.seeds)).toEqual([
      "Indiana", "Ohio State", "Georgia", "Texas Tech", "Oregon", "Ole Miss", "Texas A&M", "Oklahoma", "Alabama", "Notre Dame", "Tulane", "Duke",
    ]);
  });

  it("with only the first round listed, the ranking fills the byes and the listed seeds stand", () => {
    const f = announcedField(listedOnly(season2025, ["first_round"]))!;
    expect(f.source).toBe("ranking");
    expect(names(season2025, f.seeds)).toEqual(BRACKET_2025);
    // A listed seed the ranking would put elsewhere stays where the bracket has it.
    const moved = listedOnly(season, ["first_round"]);
    expect(names(season, announcedField(moved)!.seeds).slice(4)).toEqual(BRACKET_2025.slice(4));
  });

  it("isn't there before the selection-day ranking, nor while a power conference's title game is unplayed", () => {
    const early = { ...season, playoffGames: [], committeeRankings: season.committeeRankings!.slice(0, -1) };
    expect(announcedField(early)).toBeNull();
    const unplayed: Season = {
      ...season, playoffGames: [],
      games: season.games.map((g) => (g.titleGame && g.homeId === id("Ohio State") ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
    };
    expect(announcedField(unplayed)).toBeNull();
    expect(announcedField({ ...season, playoffGames: [], committeeRankings: [] })).toBeNull();
  });
});

describe("the playoff once announced (2025, played out)", () => {
  const nat = simulateNational(season, { iterations: 300, seed: 1, conferences: POWER });
  const cfp = (n: string) => nat.teams.find((t) => t.teamId === id(n))!.playoff!;

  it("every simulated season uses the announced field, and the real results decide the bracket", () => {
    expect(nat.announced?.source).toBe("bracket");
    nat.forEachIteration((_, s) => {
      expect(names(season, s.field!)).toEqual(BRACKET_2025);
      expect(s.playoffChampion).toBe(id("Indiana"));
    });
    expect(cfp("Indiana")).toMatchObject({ field: 1, bye: 1, champion: 1, final: 1 });
    expect(cfp("Miami")).toMatchObject({ field: 1, bye: 0, quarterfinal: 1, final: 1, champion: 0 });
    expect(cfp("Notre Dame")).toMatchObject({ field: 0, champion: 0 });
  });

  it("each team's run reads as it went", () => {
    expect(cfp("Indiana").run).toEqual({ seed: 1, state: "champion", text: "Seed 1 in the playoff: won the national title, 27-21 over Miami" });
    expect(cfp("Ohio State").run).toEqual({ seed: 2, state: "out", text: "Seed 2 in the playoff: lost to Miami 24-14 in the quarterfinal" });
    expect(cfp("Notre Dame").run).toEqual({ seed: null, state: "out", text: "Not selected for the playoff" });
  });

  it("a team page shows In or Out, the seed, and the national title as Won or Out", () => {
    const o = (c: string, n: string) => seasonOutlook(season, { conference: c, iterations: 200, seed: 1 }).teams.find((t) => t.teamId === id(n))!;
    const indiana = o("Big Ten", "Indiana");
    expect(formatPlayoff(indiana.playoff, indiana.cfp, indiana.status)).toBe("In");
    expect(playoffDetail(indiana)).toEqual([{ label: "Seed", value: "1" }, { label: "National title", value: "Won" }]);
    expect(playoffRoute(indiana)).toBe("Seed 1 in the playoff: won the national title, 27-21 over Miami");
    const oleMiss = o("SEC", "Ole Miss");
    expect(playoffDetail(oleMiss)).toEqual([{ label: "Seed", value: "6" }, { label: "National title", value: "Out" }]);
    // Duke won the ACC but wasn't picked (the 2025 format): out, and no "Must win ACC".
    const duke = o("ACC", "Duke");
    expect(formatPlayoff(duke.playoff, duke.cfp, duke.status)).toBe("Out");
    expect(playoffDetail(duke)).toEqual([]);
    expect(playoffRoute(duke)).toBe("Not selected for the playoff");
  });

  it("an independent left out reads Not selected", () => {
    const nd = independentOutlook(season, { iterations: 100, seed: 1 }).teams.find((t) => t.teamId === id("Notre Dame"))!;
    expect(nd.route).toBe("Not selected for the playoff");
    expect(formatPlayoff(nd.playoff, nd.cfp, "alive")).toBe("Out");
  });

  it("the national view shows the field with each run, no bubble, and the bracket's results", () => {
    const v = nationalView(nat, { season })!;
    expect([v.announced, v.heading, v.bracketHeading]).toEqual([true, "Playoff field", "Bracket"]);
    expect(names(season, v.field.map((f) => f.teamId))).toEqual(BRACKET_2025);
    expect(v.field[0].text).toBe("Won the national title, 27-21 over Miami");
    expect(v.field[9].text).toBe("Lost to Indiana 27-21 in the national title game");
    expect(v.bubble).toEqual([]);
    expect(v.bracket.map((g) => g.result)).toEqual([
      "Oregon 51, James Madison 34", "Ole Miss 41, Tulane 10", "Miami 10, Texas A&M 3", "Alabama 34, Oklahoma 24",
      "Indiana 38, Alabama 3", "Miami 24, Ohio State 14", "Ole Miss 39, Georgia 34", "Oregon 23, Texas Tech 0",
      "Indiana 56, Oregon 22", "Miami 31, Ole Miss 27", "Indiana 27, Miami 21",
    ]);
    expect(v.bracket[10].a).toEqual({ teamId: id("Indiana"), seed: 1 });
    expect(v.note).toMatch(/^The field and seeds the committee announced/);
  });
});

describe("the playoff in progress", () => {
  it("before the semifinals, only the four teams left can win it, and the bracket simulates the rest", () => {
    const s = unplayedFrom(season, ["semifinal", "championship"]);
    const nat = simulateNational(s, { iterations: 600, seed: 3, conferences: POWER });
    const left = ["Indiana", "Oregon", "Ole Miss", "Miami"];
    const champion = (n: string) => nat.teams.find((t) => t.teamId === id(n))!.playoff!.champion;
    for (const n of left) expect(champion(n)).toBeGreaterThan(0.02);
    expect(left.reduce((sum, n) => sum + champion(n), 0)).toBeCloseTo(1, 10);
    for (const n of ["Ohio State", "Georgia", "Alabama", "Notre Dame"]) expect(champion(n)).toBe(0);
    // Indiana and Oregon always meet in a semifinal, as the bracket has them.
    nat.forEachIteration((_, x) => expect(left).toContain(names(s, [x.playoffChampion!])[0]));
    const indiana = nat.teams.find((t) => t.teamId === id("Indiana"))!.playoff!;
    expect(indiana.run).toEqual({ seed: 1, state: "in", text: "Seed 1 in the playoff: beat Alabama 38-3 in the quarterfinal" });
    expect(indiana.semifinal).toBe(1);
    const v = nationalView(nat, { season: s })!;
    expect(v.bracket.slice(8).map((g) => g.result)).toEqual([null, null, null]);
    expect(v.bracket[8].a).toEqual({ teamId: id("Indiana"), seed: 1 });
    expect(v.bracket[10].a).toEqual({ winnerOf: 8 });
    expect(v.field[0].text).toMatch(/^Beat Alabama 38-3 in the quarterfinal · national title \d+%$/);
  });

  it("before the first round, the top four seeds read as byes and nothing is decided", () => {
    const s = listedOnly(unplayedFrom(season, ["first_round"]), ["first_round"]);
    const nat = simulateNational(s, { iterations: 200, seed: 3, conferences: POWER });
    expect(nat.announced?.source).toBe("ranking");
    expect(names(s, nat.announced!.seeds)).toEqual(BRACKET_2025);
    const run = (n: string) => nat.teams.find((t) => t.teamId === id(n))!.playoff!.run;
    expect(run("Georgia")?.text).toBe("Seed 3 in the playoff, with a first-round bye");
    expect(run("Oregon")?.text).toBe("Seed 5 in the playoff");
    const field = nationalView(nat, { season: s })!.field;
    expect(field[2].text).toMatch(/^First-round bye · national title \d+%$/);
    expect(field[4].text).toMatch(/^National title \d+%$/);
  });
});

describe("before the field is announced", () => {
  it("the field is simulated and playoff odds read as odds, with no run", () => {
    const s: Season = { ...season, playoffGames: [], committeeRankings: season.committeeRankings!.slice(0, -1) };
    const nat = simulateNational(s, { iterations: 300, seed: 1, conferences: POWER });
    expect(nat.announced).toBeNull();
    const fields = new Set<string>();
    nat.forEachIteration((_, x) => fields.add(x.field!.join()));
    expect(fields.size).toBeGreaterThan(1);
    const o = seasonOutlook(s, { conference: "SEC", iterations: 300, seed: 1 }).teams.find((t) => t.teamId === id("Ole Miss"))!;
    expect(o.cfp!.run).toBeNull();
    expect(formatPlayoff(o.playoff, o.cfp, o.status)).toMatch(/^(<0\.1%|>99%|\d+(\.\d)?%)$/);
    expect(nationalView(nat, { season: s })!.heading).toBe("Projected playoff field");
  });
});

describe("the snapshot's committee rankings", () => {
  it("a refresh may not drop most of them", () => {
    const prev = { ...raw, year: 2026 };
    expect(checkFetch({ ...prev, rankings: prev.rankings!.slice(0, 2) }, prev)).toEqual([
      "CFBD returned 2 rankings for 2026, down from 6 in the previous snapshot.",
    ]);
    expect(checkFetch({ ...prev, rankings: [] }, { ...prev, rankings: undefined })).toEqual([]);
  });
});
