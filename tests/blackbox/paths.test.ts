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
function game(home: number, away: number, winner?: number, extra: Partial<Game> = {}): Game {
  return {
    id: nextId++, week: 1, start: "2026-11-22T18:00:00Z", neutralSite: false, conferenceGame: true,
    homeId: home, awayId: away,
    homePoints: winner === undefined ? null : winner === home ? 21 : 14,
    awayPoints: winner === undefined ? null : winner === away ? 21 : 14,
    completed: winner !== undefined, spread: null, ...extra,
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
    expect(p.summary).toBe("Team1 is in the C title game whatever happens.");
  });

  it("an eliminated team says eliminated", () => {
    nextId = 0;
    const s = season([
      game(1, 2, 1), game(1, 3, 1), game(1, 4, 1), game(1, 5, 1), game(2, 5, 2), game(3, 5, 3), game(4, 5, 4),
      game(2, 3), game(2, 4), game(3, 4),
    ], 5);
    const p = path(s, 5);
    expect(p.status).toBe("eliminated");
    expect(p.summary).toBe("Team5 can't make the C title game: no combination of remaining results gets it there.");
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

  it("a win-out seen in too few simulated seasons gives no win-out odds", () => {
    nextId = 0;
    // Team 4 is a ~40-point underdog in both remaining games, so it almost never wins out.
    const long = (home: number, away: number) => ({ ...game(home, away), spread: away === 4 ? -40 : 40 });
    const s = season([game(1, 2, 1), game(1, 3, 1), game(2, 3, 2), long(1, 4), long(4, 2)]);
    const p = path(s, 4);
    expect(p.ifWinOut).toBeNull();
    expect(p.summary).not.toMatch(/Win out/);
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
    const line = path(s, 2).steps.find((x) => x.includes("Team3"))!;
    expect(line).toContain("Nov 21");
  });

  it("a locked game is absent from keyGames", () => {
    const { s, decider } = scenario();
    const third = s.games[5];
    const p = teamPath(s, { conference: "C", teamId: 2, iterations: 3000, seed: 3, locks: { [third.id]: 3 } });
    expect(p.keyGames.some((k) => k.gameId === third.id)).toBe(false);
    expect(p.keyGames[0].gameId).toBe(decider.id);
  });

  it("a lock shifts titleGame and ifWinOut, and a lock on the team's own game counts toward win-out", () => {
    const { s, decider } = scenario();
    const base = path(s, 2);
    const win = teamPath(s, { conference: "C", teamId: 2, iterations: 3000, seed: 3, locks: { [decider.id]: 2 } });
    const lose = teamPath(s, { conference: "C", teamId: 2, iterations: 3000, seed: 3, locks: { [decider.id]: 3 } });
    expect(win.titleGame).toBeGreaterThan(base.titleGame);
    expect(win.status).toBe("clinched");
    expect(win.ifWinOut).toBe(1);
    expect(lose.titleGame).toBeLessThan(base.titleGame);
    expect(lose.ifWinOut).toBeNull();
  });

  it("skips a near-certain game whose upset is too rare to measure", () => {
    const { s } = scenario();
    const third = s.games[5];
    const open = path(s, 2).keyGames.some((k) => k.gameId === third.id);
    expect(open).toBe(true);
    third.spread = -60;
    expect(path(s, 2).keyGames.some((k) => k.gameId === third.id)).toBe(false);
  });

  it("a non-conference game is never a key game, even the team's own", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { s } = scenario();
      s.teams.push({ ...s.teams[0], id: 9, name: "Team9", conference: "Other" });
      const nc = game(2, 9, undefined, { conferenceGame: false, spread: 0 });
      s.games.push(nc);
      expect(path(s, 2, seed).keyGames.some((k) => k.gameId === nc.id)).toBe(false);
    }
  });

  it("a conference game whose result can't change the odds is never a key game", () => {
    nextId = 0;
    // Team 2's spot hangs on 2 v 3 and 3 v 4. Teams 5 and 6 are 0-2 and can't reach it.
    const lopsided = game(5, 6, undefined, { spread: -24 });
    const s = season([
      game(1, 2, 1), game(1, 3, 1), game(1, 4, 1), game(2, 4, 2), game(1, 5, 1), game(1, 6, 1),
      game(2, 5, 2), game(2, 6, 2), game(2, 3), game(3, 4), lopsided,
    ], 6);
    const lock = (w: number) => teamPath(s, { conference: "C", teamId: 2, iterations: 3000, seed: 3, locks: { [lopsided.id]: w } });
    expect(lock(5).titleGame).toBe(lock(6).titleGame);
    expect(lock(5).titleGame).toBeGreaterThan(0.3);
    expect(lock(5).titleGame).toBeLessThan(0.95);
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(path(s, 2, seed).keyGames.some((k) => k.gameId === lopsided.id)).toBe(false);
    }
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
