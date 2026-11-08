// Conference title games in the data: found whichever way CFBD flags them, never counted in the standings or a
// tiebreak, and, once listed after the regular season, deciding who plays. Real 2025 data comes from
// fixtures/national-2025.json (every FBS game of 2025, postseason included); core has only the 2026 rules, so it is
// loaded as 2026 where rules are needed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  committeeRanking, conferenceStandings, formatChampion, seasonFromCfbd, seasonOutlook, simulateNational, teamPath, teamRecord,
  type CfbdGame, type CfbdSnapshot, type Game, type Season,
} from "@/core";

const raw = JSON.parse(readFileSync("fixtures/national-2025.json", "utf8")) as CfbdSnapshot;
const as2026 = (r: CfbdSnapshot): CfbdSnapshot => ({ ...r, year: 2026 });
const played = (g: Game) => (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId);
const isTitleRow = (g: CfbdGame) => /championship/i.test(g.notes ?? "") && g.seasonType !== "postseason";
const withRows = (r: CfbdSnapshot, f: (g: CfbdGame) => CfbdGame | null): CfbdSnapshot =>
  ({ ...r, games: r.games.map(f).filter((g): g is CfbdGame => g !== null) });
const named = (s: Season, id: number) => s.teams.find((t) => t.id === id)!.name;
const titleGames = (s: Season) => s.games.filter((g) => g.titleGame).map((g) => `${named(s, g.homeId)}-${named(s, g.awayId)}`).sort();
const CONFERENCES = ["ACC", "American Athletic", "Big 12", "Big Ten", "Conference USA", "Mid-American", "Mountain West", "SEC", "Sun Belt"];

const REAL_2025 = [
  "Alabama-Georgia", "Boise State-UNLV", "Jacksonville State-Kennesaw State", "James Madison-Troy", "Ohio State-Indiana",
  "Texas Tech-BYU", "Tulane-North Texas", "Virginia-Duke", "Western Michigan-Miami (OH)",
];

describe("title games in the data", () => {
  it("finds every 2025 title game by CFBD's note, and none is a conference game", () => {
    const s = seasonFromCfbd(raw);
    expect(titleGames(s)).toEqual([...REAL_2025].sort());
    expect(s.games.filter((g) => g.titleGame).every((g) => !g.conferenceGame)).toBe(true);
  });

  it("flagged a conference game, a title game still counts in no conference's standings", () => {
    const base = seasonFromCfbd(raw);
    const flagged = seasonFromCfbd(withRows(raw, (g) => (isTitleRow(g) ? { ...g, conferenceGame: true } : g)));
    expect(titleGames(flagged)).toEqual(titleGames(base));
    for (const c of CONFERENCES) expect(conferenceStandings(flagged, c, played)).toEqual(conferenceStandings(base, c, played));
    const duke = base.teams.find((t) => t.name === "Duke")!.id;
    // Duke went 6-2 in the ACC and beat Virginia in the title game.
    expect(teamRecord(flagged, duke)).toMatchObject({ conferenceWins: 6, conferenceLosses: 2 });
  });

  it("without CFBD's note, the same title games are found from the schedule, flagged either way", () => {
    for (const conferenceGame of [true, false]) {
      const s = seasonFromCfbd(withRows(raw, (g) => (isTitleRow(g) ? { ...g, notes: null, conferenceGame } : { ...g, notes: null })));
      expect(titleGames(s)).toEqual([...REAL_2025].sort());
    }
  });

  it("before the title games are listed, no regular-season game is taken for one", () => {
    // The Big Ten's last week had one neutral-site game (Michigan State-Maryland at Ford Field) and CUSA's one too:
    // without the title game in the data, either looks like it to the schedule alone.
    for (const notes of [true, false]) {
      const s = seasonFromCfbd(withRows(raw, (g) => (isTitleRow(g) ? null : notes ? g : { ...g, notes: null })));
      expect(titleGames(s)).toEqual([]);
    }
  });

  it("a two-team conference has no title game: the 2025 Pac-12's two meetings are both conference games", () => {
    const s = seasonFromCfbd(withRows(raw, (g) => ({ ...g, notes: null })));
    const pac = new Set(s.teams.filter((t) => t.conference === "Pac-12").map((t) => t.id));
    const between = s.games.filter((g) => pac.has(g.homeId) && pac.has(g.awayId));
    expect(between).toHaveLength(2);
    expect(between.every((g) => g.conferenceGame && !g.titleGame)).toBe(true);
  });

  it("in past seasons with no notes, a last-week game is never taken for a missing title game", () => {
    // fixtures/cfp-<year>.json keep no notes. 2015 and 2023 Big Ten, 2018 Big 12, 2024 CUSA: one neutral-site game in
    // the last week; 2018 and 2021 Pac-12, 2022 MAC: a postponed game alone in title week.
    for (const year of [2015, 2018, 2021, 2022, 2023, 2024, 2025]) {
      const fixture = JSON.parse(readFileSync(`fixtures/cfp-${year}.json`, "utf8")).snapshot as CfbdSnapshot;
      const full = seasonFromCfbd(fixture);
      const titles = new Set(full.games.filter((g) => g.titleGame).map((g) => g.id));
      expect(titles.size).toBeGreaterThan(0);
      const s = seasonFromCfbd({ ...fixture, games: fixture.games.filter((g) => !titles.has(g.id)) });
      expect(s.games.filter((g) => g.titleGame)).toEqual([]);
      expect(committeeRanking(s).some((r) => r.champion)).toBe(false);
    }
  });
});

// A made-up 2026 conference as CFBD would list it: conference games, then (optionally) the title game in week 14.
type Row = [home: string, away: string, week: number, winner: string | null, conferenceGame: boolean, notes?: string];
function fromRows(conference: string, members: string[], rows: Row[]): Season & { id: (n: string) => number } {
  const idOf = (n: string) => members.indexOf(n) + 1;
  const games: CfbdGame[] = rows.map(([home, away, week, winner, conferenceGame, notes], i) => ({
    id: 500 + i, week, startDate: `2026-${week >= 14 ? "12-05" : `${String(8 + Math.floor(week / 4)).padStart(2, "0")}-${String(1 + (week % 4) * 7).padStart(2, "0")}`}T18:00:00.000Z`,
    completed: winner !== null, neutralSite: false, conferenceGame, notes: notes ?? null, seasonType: "regular",
    homeId: idOf(home), homeTeam: home, homeConference: conference, homeClassification: "fbs",
    homePoints: winner === null ? null : winner === home ? 30 : 20,
    awayId: idOf(away), awayTeam: away, awayConference: conference, awayClassification: "fbs",
    awayPoints: winner === null ? null : winner === away ? 30 : 20,
  }));
  const s = seasonFromCfbd({
    year: 2026, fetchedAt: "", teams: members.map((n) => ({ id: idOf(n), school: n, conference, classification: "fbs" })),
    games, lines: [], ratings: [],
  });
  return { ...s, id: idOf };
}

/** A round robin, the earlier-listed team winning every game, from week `from` on. */
const roundRobin = (teams: string[], from: number): Row[] =>
  teams.flatMap((a, i) => teams.slice(i + 1).map((b, j): Row => [a, b, from + ((i + j) % (teams.length - 1)), a, true]));

describe("title games in made-up 2026 conferences", () => {
  const PAC = ["Boise State", "Fresno State", "San Diego State", "Utah State", "Colorado State", "Oregon State", "Washington State", "Texas State"];
  // The Pac-12: a round robin in weeks 5-11, the four flex games in week 13 (between members, flagged conference
  // games), the title game in week 14 flagged a conference game too, with or without a note.
  const pac = (notes?: string) => fromRows("Pac-12", PAC, [
    ...roundRobin(PAC, 5),
    ["Utah State", "Boise State", 13, "Utah State", true], ["Colorado State", "Texas State", 13, "Texas State", true],
    ["Fresno State", "San Diego State", 13, "San Diego State", true], ["Washington State", "Oregon State", 13, "Oregon State", true],
    ["Boise State", "Fresno State", 14, null, true, notes],
  ]);

  for (const notes of ["Pac-12 Championship", undefined]) {
    it(`the Pac-12's title game is never its flex games, and neither counts in the standings (${notes ? "with" : "without"} a note)`, () => {
      const s = pac(notes);
      expect(s.games.filter((g) => g.titleGame).map((g) => [named(s, g.homeId), named(s, g.awayId), g.week])).toEqual([["Boise State", "Fresno State", 14]]);
      expect(s.games.filter((g) => g.week >= 13).every((g) => !g.conferenceGame)).toBe(true);
      for (const row of conferenceStandings(s, "Pac-12", played)) expect(row.wins + row.losses).toBe(7);
    });
  }

  it("the Pac-12's listed title game decides who plays: Boise State and Fresno State every season", () => {
    const s = pac("Pac-12 Championship");
    const o = seasonOutlook(s, { conference: "Pac-12", iterations: 200, seed: 4 }).teams;
    const at = (n: string) => o.find((t) => t.teamId === s.id(n))!;
    expect([at("Boise State").titleGame, at("Fresno State").titleGame, at("San Diego State").titleGame]).toEqual([1, 1, 0]);
    expect([at("Boise State").status, at("Fresno State").status, at("San Diego State").status]).toEqual(["clinched", "clinched", "eliminated"]);
    expect(at("Boise State").champion + at("Fresno State").champion).toBeCloseTo(1, 10);
  });

  const EAST = ["App State", "Coastal Carolina", "Georgia Southern", "Georgia State", "James Madison", "Marshall", "Old Dominion"];
  const WEST = ["Arkansas State", "Louisiana", "Louisiana Tech", "South Alabama", "Southern Miss", "Troy", "UL Monroe"];
  for (const notes of ["Sun Belt Championship", undefined]) {
    it(`the Sun Belt's title game, East against West, counts in neither division's standings (${notes ? "with" : "without"} a note)`, () => {
      const s = fromRows("Sun Belt", [...EAST, ...WEST], [
        ...roundRobin(EAST, 5), ...roundRobin(WEST, 5), ["Arkansas State", "App State", 13, "App State", true],
        ["App State", "Arkansas State", 14, "Arkansas State", true, notes],
      ]);
      const title = s.games.filter((g) => g.titleGame);
      expect(title.map((g) => g.week)).toEqual([14]);
      expect(title[0].conferenceGame).toBe(false);
      const standings = new Map(conferenceStandings(s, "Sun Belt", played).map((r) => [r.teamId, r]));
      // App State: 6-0 in the East, beat Arkansas State in week 13; the title-game loss isn't counted.
      expect(standings.get(s.id("App State"))).toMatchObject({ wins: 7, losses: 0 });
      expect(standings.get(s.id("Arkansas State"))).toMatchObject({ wins: 6, losses: 1 });
      const o = seasonOutlook(s, { conference: "Sun Belt", iterations: 100, seed: 2 }).teams;
      const app = o.find((t) => t.teamId === s.id("App State"))!;
      expect(app.titleResult).toEqual({ won: false, text: "Lost to Arkansas State 30-20 in the Sun Belt title game" });
      expect(formatChampion(app)).toBe("Lost");
    });
  }
});

describe("a listed title game decides who plays (2025 data under the 2026 rules)", () => {
  // The ACC's title game (Virginia-Duke), re-listed as Miami against Duke: the data says who plays, whatever the
  // tiebreak says (it sends Virginia).
  const swapped = (completed: boolean) => {
    const miami = raw.teams.find((t) => t.school === "Miami")!;
    return seasonFromCfbd(as2026(withRows(raw, (g) => (g.notes === "ACC Championship"
      ? { ...g, homeId: miami.id, homeTeam: miami.school, completed, homePoints: completed ? 24 : null, awayPoints: completed ? 17 : null }
      : g))));
  };
  const id = (s: Season, n: string) => s.teams.find((t) => t.name === n)!.id;

  it("unplayed: its two teams are in every simulated season and proven in; everyone else is out", () => {
    const s = swapped(false);
    const nat = simulateNational(s, { iterations: 200, seed: 1, conferences: ["ACC", "Big 12", "Big Ten", "SEC"] });
    const champs = new Set<number>();
    nat.forEachIteration((_, x) => {
      expect(new Set(x.titleGame("ACC"))).toEqual(new Set([id(s, "Duke"), id(s, "Miami")]));
      champs.add(x.champion("ACC"));
    });
    expect(champs).toEqual(new Set([id(s, "Duke"), id(s, "Miami")]));
    const o = seasonOutlook(s, { conference: "ACC", iterations: 200, seed: 1 }).teams;
    const at = (n: string) => o.find((t) => t.teamId === id(s, n))!;
    expect([at("Duke").status, at("Miami").status, at("Virginia").status]).toEqual(["clinched", "clinched", "eliminated"]);
    expect(at("Duke").titleResult).toBeNull();
    const path = (n: string) => teamPath(s, { conference: "ACC", teamId: id(s, n), iterations: 100, seed: 1 }).summary;
    expect(path("Miami")).toBe("Miami plays Duke in the ACC title game, Dec 6.");
    expect(path("Virginia")).toBe("Virginia didn't make the ACC title game: Miami and Duke play for it.");
  });

  it("final: its result decides the champion, and the page shows the result, not odds", () => {
    const s = swapped(true);
    const o = seasonOutlook(s, { conference: "ACC", iterations: 200, seed: 1 }).teams;
    const at = (n: string) => o.find((t) => t.teamId === id(s, n))!;
    expect([at("Miami").champion, at("Duke").champion]).toEqual([1, 0]);
    expect(at("Miami").titleResult).toEqual({ won: true, text: "Beat Duke 24-17 in the ACC title game" });
    expect(at("Duke").titleResult).toEqual({ won: false, text: "Lost to Miami 24-17 in the ACC title game" });
    expect([formatChampion(at("Miami")), formatChampion(at("Duke")), formatChampion(at("Virginia"))]).toEqual(["Won", "Lost", "0%"]);
    const path = (n: string) => teamPath(s, { conference: "ACC", teamId: id(s, n), iterations: 100, seed: 1 }).summary;
    expect(path("Miami")).toBe("Miami won the ACC title game, 24-17 over Duke.");
    expect(path("Duke")).toBe("Duke lost the ACC title game to Miami, 24-17.");
    expect(path("Virginia")).toBe("Virginia didn't make the ACC title game: Miami beat Duke 24-17.");
  });

  it("the real 2025 title games, played, decide every champion", () => {
    const s = seasonFromCfbd(as2026(raw));
    const nat = simulateNational(s, { iterations: 50, seed: 2, conferences: ["ACC", "Big 12", "Big Ten", "SEC", "Mid-American", "Mountain West"] });
    const want: Record<string, string> = { ACC: "Duke", "Big 12": "Texas Tech", "Big Ten": "Indiana", SEC: "Georgia", "Mid-American": "Western Michigan", "Mountain West": "Boise State" };
    nat.forEachIteration((_, x) => {
      for (const [c, n] of Object.entries(want)) expect(named(s, x.champion(c))).toBe(n);
    });
  });
});
