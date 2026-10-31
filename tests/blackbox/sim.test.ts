import { describe, expect, it } from "vitest";
import { gameWinProbability, simulateSeason, winProbability } from "@/core";
import type { Game, Season, Team } from "@/core";

function team(id: number, rating: number | null = 0, classification: Team["classification"] = "fbs"): Team {
  return { id, name: `T${id}`, abbreviation: null, conference: "C", classification, color: null, altColor: null, rating };
}
function game(id: number, homeId: number, awayId: number, o: Partial<Game> = {}): Game {
  return {
    id, week: 1, start: "2025-09-01T00:00:00Z", neutralSite: false, conferenceGame: true,
    homeId, awayId, homePoints: null, awayPoints: null, completed: false, spread: 0, ...o,
  };
}
function season(teams: Team[], games: Game[]): Season {
  return { year: 2025, fetchedAt: "2025-09-01T00:00:00Z", teams, games };
}
const tiny = () =>
  season([team(1), team(2), team(3), team(4)], [
    game(10, 1, 2), game(11, 3, 4), game(12, 1, 3), game(13, 2, 4, { conferenceGame: false }),
  ]);

describe("simulateSeason", () => {
  it("is identical for the same seed", () => {
    const a = simulateSeason(tiny(), { iterations: 500, seed: 7 });
    const b = simulateSeason(tiny(), { iterations: 500, seed: 7 });
    expect(a.teams).toEqual(b.teams);
  });

  it("differs for different seeds", () => {
    const a = simulateSeason(tiny(), { iterations: 500, seed: 1 });
    const b = simulateSeason(tiny(), { iterations: 500, seed: 2 });
    expect(a.teams[1].winDistribution).not.toEqual(b.teams[1].winDistribution);
  });

  it("keeps completed games fixed", () => {
    const s = tiny();
    s.games[0] = game(10, 1, 2, { completed: true, homePoints: 10, awayPoints: 20, spread: -40 });
    const r = simulateSeason(s, { iterations: 200, seed: 3 });
    r.forEachIteration((_, winnerOf) => expect(winnerOf(0)).toBe(2));
  });

  it("forces a locked result", () => {
    const r = simulateSeason(tiny(), { iterations: 200, seed: 3, locks: { 11: 4 } });
    r.forEachIteration((_, winnerOf) => expect(winnerOf(1)).toBe(4));
    expect(r.teams[4].expectedConferenceWins).toBeGreaterThanOrEqual(1);
  });

  it("lets a heavy favorite win nearly every time", () => {
    const s = season([team(1), team(2)], [game(1, 1, 2, { spread: -40 })]);
    const r = simulateSeason(s, { iterations: 2000, seed: 5 });
    expect(r.teams[1].expectedWins).toBeGreaterThan(0.99);
  });

  it("has expected wins sum to the number of games, and distributions sum to iterations", () => {
    const r = simulateSeason(tiny(), { iterations: 300, seed: 9 });
    const total = Object.values(r.teams).reduce((a, t) => a + t.expectedWins, 0);
    expect(total).toBeCloseTo(4, 9);
    const conf = Object.values(r.teams).reduce((a, t) => a + t.expectedConferenceWins, 0);
    expect(conf).toBeCloseTo(3, 9);
    for (const t of Object.values(r.teams)) {
      expect(t.winDistribution.reduce((a, b) => a + b, 0)).toBe(300);
    }
  });

  it("rejects a lock on a game that is already final", () => {
    const s = tiny();
    s.games[0] = { ...s.games[0], completed: true, homePoints: 10, awayPoints: 20 };
    expect(() => simulateSeason(s, { iterations: 1, seed: 1, locks: { [s.games[0].id]: s.games[0].homeId } })).toThrow(/already final/);
  });

  it("rejects a completed game that ended in a tie", () => {
    const s = tiny();
    s.games[0] = { ...s.games[0], completed: true, homePoints: 14, awayPoints: 14 };
    expect(() => simulateSeason(s, { iterations: 1, seed: 1 })).toThrow(/tie/);
  });

  it("a lock changes only its own game at the same seed", () => {
    const s = tiny();
    const g = s.games[0];
    const free = simulateSeason(s, { iterations: 50, seed: 9 });
    const locked = simulateSeason(s, { iterations: 50, seed: 9, locks: { [g.id]: g.homeId } });
    const rows = (r: typeof free) => {
      const out: number[][] = [];
      r.forEachIteration((_, winnerOf) => out.push(s.games.slice(1).map((_g, i) => winnerOf(i + 1))));
      return out;
    };
    expect(rows(locked)).toEqual(rows(free));
  });

  it("rejects a completed game with no score", () => {
    const s = tiny();
    s.games[0] = { ...s.games[0], completed: true, homePoints: null, awayPoints: null };
    expect(() => simulateSeason(s, { iterations: 1, seed: 1 })).toThrow(/no final score/);
  });

  it("rejects a lock for a team not in the game or an unknown game", () => {
    expect(() => simulateSeason(tiny(), { iterations: 1, seed: 1, locks: { 10: 4 } })).toThrow();
    expect(() => simulateSeason(tiny(), { iterations: 1, seed: 1, locks: { 99: 1 } })).toThrow();
  });

  it("rejects bad iteration counts and games with unknown teams", () => {
    expect(() => simulateSeason(tiny(), { iterations: 0, seed: 1 })).toThrow();
    const s = season([team(1)], [game(1, 1, 2)]);
    expect(() => simulateSeason(s, { iterations: 1, seed: 1 })).toThrow();
  });

  it("simulates 10,000 iterations of a 130-team season in under 2 seconds", () => {
    const teams = Array.from({ length: 130 }, (_, i) => team(i + 1, (i % 20) - 10));
    const games: Game[] = [];
    for (let i = 0; i < 900; i++) {
      const h = (i * 7) % 130;
      const a = (h + 1 + (i % 128)) % 130;
      games.push(game(i + 1, h + 1, a + 1, { spread: null, conferenceGame: i % 2 === 0 }));
    }
    const r = simulateSeason(season(teams, games), { iterations: 10000, seed: 1 });
    expect(r.iterations).toBe(10000);
    const total = Object.values(r.teams).reduce((n, t) => n + t.winDistribution.reduce((a, b) => a + b, 0), 0);
    expect(total).toBe(130 * 10000);
  });
});

describe("gameWinProbability", () => {
  it("uses the game's spread when present", () => {
    const s = tiny();
    expect(gameWinProbability(s, game(1, 1, 2, { spread: -7 }))).toBeCloseTo(winProbability(-7));
    expect(gameWinProbability(s, game(1, 1, 2, { spread: -7 }), { sd: 7 })).toBeCloseTo(winProbability(-7, 7));
    expect(() => gameWinProbability(s, game(1, 1, 2, { spread: -7 }), { sd: 0 })).toThrow(RangeError);
  });

  it("falls back to ratings with home field", () => {
    const s = season([team(1, 10), team(2, 4)], []);
    const p = gameWinProbability(s, game(1, 1, 2, { spread: null }));
    expect(p).toBeCloseTo(winProbability(-(6) - 2.5));
  });

  it("gives no home field at a neutral site", () => {
    const s = season([team(1, 5), team(2, 5)], []);
    expect(gameWinProbability(s, game(1, 1, 2, { spread: null, neutralSite: true }))).toBeCloseTo(0.5);
  });

  it("treats missing ratings as 0 for FBS and -10 for others", () => {
    const s = season([team(1, null), team(2, null, "fcs")], []);
    const p = gameWinProbability(s, game(1, 1, 2, { spread: null, neutralSite: true }));
    expect(p).toBeCloseTo(winProbability(-10));
    const unknown = gameWinProbability(s, game(2, 1, 9, { spread: null, neutralSite: true }));
    expect(unknown).toBeCloseTo(winProbability(-10));
  });
});
