import { describe, expect, it } from "vitest";
import { seasonFromCfbd, teamRecord, type CfbdGame, type CfbdSnapshot } from "@/core";

// A tiny made-up conference: three FBS teams plus an FCS opponent that only
// appears in a game row.
const ALPHA = 1;
const BETA = 2;
const GAMMA = 3;
const FCS = 99;

function game(overrides: Partial<CfbdGame> & Pick<CfbdGame, "id" | "homeId" | "awayId">): CfbdGame {
  return {
    week: 1,
    startDate: "2026-09-05T16:00:00.000Z",
    completed: false,
    neutralSite: false,
    conferenceGame: true,
    homeTeam: `Team ${overrides.homeId}`,
    awayTeam: `Team ${overrides.awayId}`,
    homeClassification: "fbs",
    awayClassification: "fbs",
    ...overrides,
  };
}

function snapshot(overrides: Partial<CfbdSnapshot> = {}): CfbdSnapshot {
  return {
    year: 2026,
    fetchedAt: "2026-10-30T12:00:00.000Z",
    teams: [
      { id: ALPHA, school: "Alpha", abbreviation: "ALP", conference: "Test", classification: "fbs", color: "#111111" },
      { id: BETA, school: "Beta", conference: "Test", classification: "fbs" },
      { id: GAMMA, school: "Gamma", conference: "Test", classification: "fbs" },
    ],
    games: [
      game({ id: 10, homeId: ALPHA, awayId: BETA, completed: true, homePoints: 28, awayPoints: 21 }),
      game({ id: 11, homeId: GAMMA, awayId: ALPHA, completed: true, homePoints: 35, awayPoints: 31, week: 2, startDate: "2026-09-12T16:00:00.000Z" }),
      game({
        id: 12,
        homeId: ALPHA,
        awayId: FCS,
        awayTeam: "Lowly State",
        awayClassification: "fcs",
        awayConference: "Big Sky",
        conferenceGame: false,
        completed: true,
        homePoints: 49,
        awayPoints: 3,
        week: 3,
        startDate: "2026-09-19T16:00:00.000Z",
      }),
      game({ id: 13, homeId: BETA, awayId: GAMMA, week: 4, startDate: "2026-09-26T16:00:00.000Z" }),
    ],
    lines: [
      { id: 13, lines: [{ provider: "A", spread: -3 }, { provider: "B", spread: -4 }, { provider: "C", spread: null }] },
    ],
    ratings: [
      { team: "Alpha", rating: 10.5 },
      { team: "Beta", rating: null },
    ],
    ...overrides,
  };
}

describe("seasonFromCfbd", () => {
  it("adds an opponent that only appears in a game, keeping its classification", () => {
    const season = seasonFromCfbd(snapshot());
    const fcs = season.teams.find((t) => t.id === FCS);
    expect(fcs).toMatchObject({ name: "Lowly State", classification: "fcs", conference: "Big Sky", rating: null });
  });

  it("attaches SP+ ratings by team name and leaves missing ones null", () => {
    const season = seasonFromCfbd(snapshot());
    expect(season.teams.find((t) => t.id === ALPHA)?.rating).toBe(10.5);
    expect(season.teams.find((t) => t.id === BETA)?.rating).toBeNull();
  });

  it("uses the median of the books' spreads and ignores books with no number", () => {
    const season = seasonFromCfbd(snapshot());
    expect(season.games.find((g) => g.id === 13)?.spread).toBe(-3.5);
    expect(season.games.find((g) => g.id === 10)?.spread).toBeNull();
  });

  it("orders games by kickoff time", () => {
    const raw = snapshot();
    const season = seasonFromCfbd({ ...raw, games: [...raw.games].reverse() });
    expect(season.games.map((g) => g.id)).toEqual([10, 11, 12, 13]);
  });

  it("keeps no score on a game that has not been played", () => {
    const raw = snapshot();
    const games = raw.games.map((g) => (g.id === 13 ? { ...g, homePoints: 0, awayPoints: 0 } : g));
    const upcoming = seasonFromCfbd({ ...raw, games }).games.find((g) => g.id === 13);
    expect(upcoming).toMatchObject({ completed: false, homePoints: null, awayPoints: null });
  });

  it("rejects a completed game without a final score", () => {
    const raw = snapshot();
    const games = raw.games.map((g) => (g.id === 10 ? { ...g, awayPoints: null } : g));
    expect(() => seasonFromCfbd({ ...raw, games })).toThrow(/no final score/);
  });

  it("rejects duplicate game ids", () => {
    const raw = snapshot();
    expect(() => seasonFromCfbd({ ...raw, games: [...raw.games, raw.games[0]] })).toThrow(/duplicate game id/);
  });
});

describe("teamRecord", () => {
  it("counts overall and conference results from completed games only", () => {
    const season = seasonFromCfbd(snapshot());
    expect(teamRecord(season, ALPHA)).toEqual({ wins: 2, losses: 1, conferenceWins: 1, conferenceLosses: 1 });
    expect(teamRecord(season, BETA)).toEqual({ wins: 0, losses: 1, conferenceWins: 0, conferenceLosses: 1 });
    expect(teamRecord(season, GAMMA)).toEqual({ wins: 1, losses: 0, conferenceWins: 1, conferenceLosses: 0 });
  });

  it("gives a team with no games played an empty record", () => {
    const raw = snapshot();
    const season = seasonFromCfbd({ ...raw, games: raw.games.filter((g) => g.id === 13) });
    expect(teamRecord(season, BETA)).toEqual({ wins: 0, losses: 0, conferenceWins: 0, conferenceLosses: 0 });
  });
});
