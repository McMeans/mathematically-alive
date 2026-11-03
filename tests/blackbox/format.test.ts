import { describe, expect, it } from "vitest";
import { formatRecord, oddsLabels, teamRecord } from "@/core";
import type { Game, Season } from "@/core";

const team = (id: number) => ({
  id, name: `Team${id}`, abbreviation: null, conference: "ACC", classification: "fbs" as const,
  color: null, altColor: null, rating: null,
});
const game = (id: number, home: number, away: number, winner: number | null, conferenceGame: boolean): Game => ({
  id, week: id, start: "2026-09-01T18:00:00Z", neutralSite: false, conferenceGame, homeId: home, awayId: away,
  homePoints: winner === null ? null : winner === home ? 21 : 14,
  awayPoints: winner === null ? null : winner === away ? 21 : 14,
  completed: winner !== null, spread: null,
});

describe("formatRecord", () => {
  // Team 1: beat 2 (ACC), lost to 3 (ACC), beat 4 (non-conference), plays 2 again later.
  const season: Season = {
    year: 2026, fetchedAt: "", teams: [1, 2, 3, 4].map(team),
    games: [game(1, 1, 2, 1, true), game(2, 3, 1, 3, true), game(3, 1, 4, 1, false), game(4, 2, 1, null, true)],
  };

  it("shows the overall record with the conference record after it", () => {
    expect(formatRecord(teamRecord(season, 1), "ACC")).toBe("2-1 (1-1 ACC)");
  });

  it("counts a locked pick in both records", () => {
    expect(formatRecord(teamRecord(season, 1, { 4: 2 }), "ACC")).toBe("2-2 (1-2 ACC)");
  });

  it("drops the conference part for a team with no conference", () => {
    expect(formatRecord(teamRecord(season, 1), null)).toBe("2-1");
  });

  it("shows a team with no conference games as 0-0 in conference", () => {
    expect(formatRecord(teamRecord(season, 4), "ACC")).toBe("0-1 (0-0 ACC)");
  });
});

describe("oddsLabels", () => {
  it("names each odds tile after the conference", () => {
    expect(oddsLabels("ACC")).toEqual({ titleGame: "Title game", champion: "Win ACC", playoff: "Playoff", winOut: "Win out" });
    expect(oddsLabels("Big Ten").champion).toBe("Win Big Ten");
  });
});
