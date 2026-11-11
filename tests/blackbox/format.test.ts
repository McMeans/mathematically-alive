import { describe, expect, it } from "vitest";
import { formatRecord, goalStatus, oddsLabels, statusTags, teamRecord, type NationalPlayoff } from "@/core";
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
    expect(oddsLabels("ACC")).toEqual({ titleGame: "Title game", champion: "Win ACC", playoff: "Playoff", winOut: "Win out",
      beta: "Beta", conferenceRecord: "ACC record, counting your picks", mustWin: "Must win ACC", nonConference: "Non-con", conference: "ACC", cfp: "CFP",
      projected: "Projected", projectedNote: "A projected matchup, not yet confirmed.",
    });
    expect(oddsLabels("Big Ten").champion).toBe("Win Big Ten");
  });
});

describe("statusTags", () => {
  const cfp = (seed: number | null): NationalPlayoff => ({
    field: seed === null ? 0 : 1, bye: 0, seeds: [], quarterfinal: null, semifinal: 0, final: 0, champion: 0,
    run: { seed, state: seed === null ? "out" : "in", text: "" },
  });
  const team = { playoff: 0.05, cfp: null, postseasonBan: false };

  it("names how alive a team is for each goal, playoff first", () => {
    expect(statusTags({ ...team, playoff: 0.0004, status: "eliminated", titleGame: 0 }, "ACC title game")).toEqual([
      { label: "Playoff · Needs a miracle", live: true },
      { label: "ACC title game · Out", live: false },
    ]);
    expect(statusTags({ ...team, playoff: 0.15, status: "alive", titleGame: 0.09 }, "ACC title game")).toEqual([
      { label: "Playoff · In the hunt", live: true },
      { label: "ACC title game · Long shot", live: true },
    ]);
    expect(statusTags({ ...team, playoff: 0.62, status: "clinched", titleGame: 1 }, "SEC title game").map((t) => t.label)).toEqual(["Playoff · In control", "SEC title game · Clinched"]);
  });

  it("gives an independent only the playoff", () => {
    expect(statusTags(team, null)).toEqual([{ label: "Playoff · Long shot", live: true }]);
  });

  it("proves the playoff only once the field is announced, or for a team barred from it", () => {
    expect(statusTags({ ...team, cfp: cfp(4) }, null)[0].label).toBe("Playoff · Clinched");
    expect(statusTags({ ...team, cfp: cfp(null) }, null)).toEqual([{ label: "Playoff · Out", live: false }]);
    expect(statusTags({ ...team, postseasonBan: true }, null)).toEqual([{ label: "Playoff · Barred", live: false }]);
  });

  it("uses the same words for any goal at each level of odds", () => {
    expect([0.5, 0.1, 0.01, 0.009].map((p) => goalStatus(p, "alive"))).toEqual(["In control", "In the hunt", "Long shot", "Needs a miracle"]);
  });
});
