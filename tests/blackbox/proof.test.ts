import { describe, expect, it } from "vitest";
import { explore, formatChance, pathTree, seasonOutlook, teamPath } from "@/core";
import type { Game, Season } from "@/core";

let nextId = 0;
function game(home: number, away: number, winner?: number, spread: number | null = null): Game {
  return {
    id: nextId++, week: 1, start: "2026-11-07T18:00:00Z", neutralSite: false, conferenceGame: true, homeId: home, awayId: away,
    homePoints: winner === undefined ? null : winner === home ? 21 : 14,
    awayPoints: winner === undefined ? null : winner === away ? 21 : 14,
    completed: winner !== undefined, spread,
  };
}
const season = (games: Game[]): Season => ({
  year: 2026, fetchedAt: "", games,
  teams: [1, 2, 3, 4].map((id) => ({ id, name: `Team${id}`, abbreviation: null, conference: "C", classification: "fbs" as const, color: null, altColor: null, rating: null })),
});
const o = { conference: "C", iterations: 2000, seed: 1 };

// Team 1 (1-1) gets in only through a 60-point upset: beating Team 3, or Team 4 beating Team 2 and a three-way tie.
function longshot() {
  nextId = 0;
  const upset1 = game(3, 1, undefined, -60);
  const upset2 = game(2, 4, undefined, -60);
  return { upset1, upset2, s: season([game(1, 4, 1), game(2, 1, 2), game(3, 2, 3), game(3, 4, 3), upset1, upset2]) };
}

describe("proven clinch and elimination", () => {
  it("a team alive only through an unlikely combination is not out, even at 0% in the sample", () => {
    const { s, upset1, upset2 } = longshot();
    const p = teamPath(s, { ...o, teamId: 1 });
    expect(p.titleGame).toBe(0);
    expect(p.status).toBe("alive");
    const me = seasonOutlook(s, o).teams.find((t) => t.teamId === 1)!;
    expect(me.status).toBe("alive");
    expect(formatChance(me.titleGame, me.status)).toBe("<1%");
    expect(pathTree(s, { ...o, teamId: 1 }).root.verdict).toBe("<1%");
    // The combination really does it.
    expect(teamPath(s, { ...o, teamId: 1, locks: { [upset1.id]: 1, [upset2.id]: 4 } }).titleGame).toBeGreaterThan(0);
  });

  it("a team that only gets in as a tied team through the game-count rule is not out", () => {
    nextId = 0;
    // Team 1 is 2-0 in two games. Team 2 is 1-1 in three; beating Team 5 makes it 2-1, the same
    // wins as Team 1, so the two are the "Tied Teams" and both go, past Teams 3 and 4 at 3-1.
    const last = game(2, 5);
    const games = [
      game(1, 2, 1), game(1, 5, 1), game(2, 3, 2),
      game(3, 5, 3), game(3, 6, 3), game(3, 7, 3),
      game(4, 5, 4), game(4, 6, 4), game(4, 7, 4), game(6, 4, 6),
      last,
    ];
    const s: Season = {
      year: 2026, fetchedAt: "", games,
      teams: [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, name: `Team${id}`, abbreviation: null, conference: "C", classification: "fbs" as const, color: null, altColor: null, rating: null })),
    };
    expect(pathTree(s, { ...o, teamId: 2 }).root.verdict).not.toBe("Out");
    expect(pathTree(s, { ...o, teamId: 2, locks: { [last.id]: 2 } }).root.verdict).toBe("In");
    expect(pathTree(s, { ...o, teamId: 2, locks: { [last.id]: 5 } }).root.verdict).toBe("Out");
  });

  it("a team no combination can put in is out, and one no combination can keep out is in", () => {
    const { s, upset1, upset2 } = longshot();
    const out = { ...o, teamId: 1, locks: { [upset1.id]: 3, [upset2.id]: 2 } };
    expect(teamPath(s, out).status).toBe("eliminated");
    expect(pathTree(s, out).root.verdict).toBe("Out");
    const t3 = seasonOutlook(s, { ...o, locks: out.locks }).teams.find((t) => t.teamId === 3)!;
    expect(t3.status).toBe("clinched");
    expect(formatChance(t3.titleGame, t3.status)).toBe("In");
    expect(formatChance(1, "alive")).toBe(">99%");
    expect(formatChance(0.42, "alive")).toBe("42%");
  });

  it("help marks the result elsewhere that would knock the team out", () => {
    const { s, upset1, upset2 } = longshot();
    const h = pathTree(s, { ...o, teamId: 1, locks: { [upset1.id]: 3 } }).help.find((x) => x.gameId === upset2.id)!;
    expect(h.ifHomeWins).toBe("out");
    expect(h.ifAwayWins).toBeNull();
  });

  it("explore gives the same numbers as the separate calls, from one simulation", () => {
    const { s } = longshot();
    const r = explore(s, { ...o, teamId: 3 });
    expect(r.path).toEqual(teamPath(s, { ...o, teamId: 3 }));
    expect(r.tree).toEqual(pathTree(s, { ...o, teamId: 3 }));
    expect(r.outlook).toEqual(seasonOutlook(s, o).teams);
  });
});
