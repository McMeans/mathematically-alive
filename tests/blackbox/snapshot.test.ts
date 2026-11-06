import { describe, expect, it } from "vitest";
import { checkSnapshot, seasonFromCfbd, type CfbdGame, type CfbdSnapshot, type CfbdTeam } from "@/core";

// A tiny made-up national snapshot: two ACC teams that play each other, a Sun Belt pair, an independent and an
// FCS team.
const team = (id: number, conference: string | null, classification = "fbs"): CfbdTeam => ({
  id,
  school: `Team ${id}`,
  conference,
  classification,
});

const game = (id: number, homeId: number, awayId: number, conferenceGame: boolean): CfbdGame => ({
  id,
  week: 1,
  startDate: "2026-09-05T16:00:00.000Z",
  completed: false,
  neutralSite: false,
  conferenceGame,
  homeId,
  awayId,
  homeTeam: `Team ${homeId}`,
  awayTeam: `Team ${awayId}`,
  homeClassification: "fbs",
  awayClassification: "fbs",
});

function snapshot(overrides: Partial<CfbdSnapshot> = {}): CfbdSnapshot {
  return {
    year: 2026,
    fetchedAt: "2026-11-01T12:00:00.000Z",
    teams: [team(1, "ACC"), team(2, "ACC"), team(3, "Sun Belt"), team(4, "Sun Belt"), team(5, null), team(6, "Big Sky", "fcs")],
    games: [game(10, 1, 2, true), game(11, 3, 4, true), game(12, 5, 1, false)],
    lines: [],
    ratings: [],
    ...overrides,
  };
}

describe("checkSnapshot", () => {
  it("passes a snapshot with a full schedule and rules for every supported conference", () => {
    expect(checkSnapshot(seasonFromCfbd(snapshot()), ["ACC"]).errors).toEqual([]);
  });

  it("reports every other FBS conference as not supported, independents included, and leaves out FCS", () => {
    expect(checkSnapshot(seasonFromCfbd(snapshot()), ["ACC"]).notSupported).toEqual(["FBS Independents", "Sun Belt"]);
  });

  it("fails a supported conference with a member that plays no conference game against another member", () => {
    const games = [game(10, 1, 3, true), game(11, 3, 4, true)];
    expect(checkSnapshot(seasonFromCfbd(snapshot({ games })), ["ACC"]).errors).toEqual([
      "No full schedule for ACC in the 2026 snapshot.",
    ]);
  });

  it("fails a supported conference that has no teams in the snapshot", () => {
    const { errors } = checkSnapshot(seasonFromCfbd(snapshot()), ["ACC", "SEC"]);
    expect(errors).toEqual(["No full schedule for SEC in the 2026 snapshot."]);
  });

  it("fails a supported conference with no tiebreak rules for the season", () => {
    const { errors, notSupported } = checkSnapshot(seasonFromCfbd(snapshot()), ["ACC", "Sun Belt"]);
    expect(errors).toEqual(["No tiebreak rules for Sun Belt in 2026."]);
    expect(notSupported).toEqual(["FBS Independents"]);
  });

  it("fails a season it has no rules for, even with full schedules", () => {
    expect(checkSnapshot(seasonFromCfbd(snapshot({ year: 2019 })), ["ACC"]).errors).toEqual(["No tiebreak rules for ACC in 2019."]);
  });

  it("fails a snapshot with no FBS teams", () => {
    const { errors } = checkSnapshot(seasonFromCfbd(snapshot({ teams: [team(6, "Big Sky", "fcs")], games: [] })), []);
    expect(errors).toEqual(["The 2026 snapshot has no FBS teams."]);
  });
});
