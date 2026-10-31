import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatOdds, seasonFromCfbd, teamPath } from "@/core";
import type { CfbdSnapshot, Game, Season } from "@/core";

function team(id: number, conference: string) {
  return {
    id, name: `Team${id}`, abbreviation: null, conference, classification: "fbs" as const,
    color: null, altColor: null, rating: null,
  };
}

let nextId = 0;
function game(home: number, away: number, winner?: number): Game {
  return {
    id: nextId++, week: 1, start: "2026-11-22T18:00:00Z", neutralSite: false, conferenceGame: true,
    homeId: home, awayId: away,
    homePoints: winner === undefined ? null : winner === home ? 21 : 14,
    awayPoints: winner === undefined ? null : winner === away ? 21 : 14,
    completed: winner !== undefined, spread: null,
  };
}
const season = (games: Game[], n = 4): Season => ({
  year: 2026, fetchedAt: "", games,
  teams: Array.from({ length: n }, (_, i) => team(i + 1, "C")),
});
const path = (s: Season, teamId: number, seed = 3) => teamPath(s, { conference: "C", teamId, iterations: 3000, seed });

// Team 1 beat everyone. Team 2 only lost to 1 and has one decisive game left
// (2 v 3); 3 and 4 still play each other.
function scenario() {
  nextId = 0;
  const decider = game(2, 3);
  return { decider, s: season([game(1, 2, 1), game(1, 3, 1), game(1, 4, 1), game(2, 4, 2), decider, game(3, 4)]) };
}

describe("team path", () => {
  it("a clinched team says clinched", () => {
    const p = path(scenario().s, 1);
    expect(p.status).toBe("clinched");
    expect(p.titleGame).toBe(1);
    expect(p.summary).toBe("Clinched a spot in the C Championship Game.");
  });

  it("an eliminated team says eliminated", () => {
    nextId = 0;
    const s = season([
      game(1, 2, 1), game(1, 3, 1), game(1, 4, 1), game(1, 5, 1), game(2, 5, 2), game(3, 5, 3), game(4, 5, 4),
      game(2, 3), game(2, 4), game(3, 4),
    ], 5);
    const p = path(s, 5);
    expect(p.status).toBe("eliminated");
    expect(p.summary).toBe("Eliminated from the C Championship Game.");
    expect(p.keyGames).toEqual([]);
  });

  it("winning out raises the odds", () => {
    const { s } = scenario();
    const p = path(s, 2);
    expect(p.status).toBe("alive");
    expect(p.ifWinOut).not.toBeNull();
    expect(p.ifWinOut!).toBeGreaterThan(p.titleGame);
    expect(p.ifWinOut!).toBe(1);
  });

  it("ifWinOut is null when no games remain", () => {
    nextId = 0;
    const s = season([game(1, 2, 1), game(1, 3, 1), game(2, 3, 2)], 3);
    expect(path(s, 3).ifWinOut).toBeNull();
  });

  it("the top key game is the one that decides it", () => {
    const { s, decider } = scenario();
    const k = path(s, 2).keyGames[0];
    expect(k.gameId).toBe(decider.id);
    expect(k.swing).toBeGreaterThan(0.3);
    expect(k.swing).toBeCloseTo(Math.abs(k.oddsIfHomeWins - k.oddsIfAwayWins), 10);
    expect(path(s, 2).keyGames.length).toBeLessThanOrEqual(5);
  });

  it("rooting points to the team that helps", () => {
    const { s, decider } = scenario();
    expect(path(s, 2).keyGames[0].rooting).toBe(2);
    // Team 4 gains when 2 loses (more teams end up tied), so it roots against Team 2.
    const other = path(s, 4).keyGames.find((k) => k.gameId === decider.id);
    expect(other).toBeDefined();
    const better = other!.rooting === other!.homeId ? other!.oddsIfHomeWins : other!.oddsIfAwayWins;
    const worse = other!.rooting === other!.homeId ? other!.oddsIfAwayWins : other!.oddsIfHomeWins;
    expect(better).toBeGreaterThan(worse);
  });

  it("the summary names the team and a percentage", () => {
    const { s } = scenario();
    const p = path(s, 3);
    expect(p.summary).toContain("Team3");
    expect(p.summary).toMatch(/\d+%|<1%|>99%/);
    expect(p.steps.join(" ")).toMatch(/Root for|Win /);
  });

  it("shows a late kickoff on its Eastern-time date", () => {
    const { s, decider } = scenario();
    decider.start = "2026-11-22T00:30:00Z";
    const text = path(s, 2).steps.join(" ");
    expect(text).toContain("Nov 21");
    expect(text).not.toContain("Nov 22");
  });

  it("is deterministic for a seed", () => {
    const { s } = scenario();
    expect(path(s, 2, 11)).toEqual(path(s, 2, 11));
  });

  it("rejects a team outside the conference", () => {
    expect(() => path(scenario().s, 99)).toThrow();
  });
});

describe("formatOdds", () => {
  it("rounds and handles the edges", () => {
    expect(formatOdds(0)).toBe("0%");
    expect(formatOdds(1)).toBe("100%");
    expect(formatOdds(0.004)).toBe("<1%");
    expect(formatOdds(0.996)).toBe(">99%");
    expect(formatOdds(0.5)).toBe("50%");
  });
});

describe("2025 ACC fixture with the last two weeks unplayed", () => {
  it("runs for every ACC team with valid statuses", () => {
    const snap = JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot;
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    const cut: Season = {
      ...full,
      games: full.games.map((g) =>
        g.week > last - 2 ? { ...g, completed: false, homePoints: null, awayPoints: null } : g),
    };
    for (const t of cut.teams.filter((x) => x.conference === "ACC")) {
      const p = teamPath(cut, { conference: "ACC", teamId: t.id, iterations: 500, seed: 1 });
      expect(["clinched", "alive", "eliminated"]).toContain(p.status);
      expect(p.summary).toContain(p.status === "alive" ? t.name : "ACC");
    }
  });
});
