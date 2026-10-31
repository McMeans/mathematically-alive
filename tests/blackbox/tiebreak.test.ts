import { describe, expect, it } from "vitest";
import { championshipParticipants, conferenceStandings } from "@/core";
import type { Game, Season } from "@/core";

// Each result is [winner, loser]; ids are 1..n, all in conference "C".
function league(n: number, results: [number, number][], ratings: Record<number, number> = {}): {
  season: Season;
  winnerOf: (g: Game) => number;
} {
  const teams = Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `T${i + 1}`,
    abbreviation: null,
    conference: "C",
    classification: "fbs" as const,
    color: null,
    altColor: null,
    rating: ratings[i + 1] ?? null,
  }));
  const winners = new Map<number, number>();
  const games: Game[] = results.map(([w, l], i) => {
    winners.set(i, w);
    return {
      id: i,
      week: i + 1,
      start: "2026-09-01T00:00:00Z",
      neutralSite: false,
      conferenceGame: true,
      homeId: w,
      awayId: l,
      homePoints: 1,
      awayPoints: 0,
      completed: true,
      spread: null,
    };
  });
  return { season: { year: 2026, fetchedAt: "", teams, games }, winnerOf: (g) => winners.get(g.id)! };
}

const noDraw = () => {
  throw new Error("draw should not be needed");
};
const run = (l: ReturnType<typeof league>, draw: () => number = noDraw, rank?: (id: number) => number) =>
  championshipParticipants(l.season, "C", l.winnerOf, { draw, rank });

describe("conference standings", () => {
  it("lists teams best record first with wins, losses and pct", () => {
    const l = league(3, [[1, 2], [1, 3], [2, 3]]);
    const s = conferenceStandings(l.season, "C", l.winnerOf);
    expect(s.map((x) => x.teamId)).toEqual([1, 2, 3]);
    expect(s[1]).toEqual({ teamId: 2, wins: 1, losses: 1, pct: 0.5 });
  });
});

const chain = (winner: number, from: number, to: number): [number, number][] =>
  Array.from({ length: to - from + 1 }, (_, k) => [winner, from + k]);

describe("championship participants", () => {
  it("takes the two best records without any tiebreak", () => {
    const l = league(4, [[1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]]);
    expect(run(l)).toEqual([1, 2]);
  });

  it("seeds two teams tied for first by the tiebreak", () => {
    // 1 and 2 are both 2-0 and never met; rank decides the seeding.
    const l = league(4, [[1, 3], [1, 4], [2, 3], [2, 4], [3, 4]]);
    expect(run(l, noDraw, (id) => -id)).toEqual([1, 2]);
    expect(run(l, noDraw, (id) => id)).toEqual([2, 1]);
  });

  it("breaks a two-way tie for second place by head-to-head, ahead of rank", () => {
    // 1 is 3-0; 2 and 3 are both 2-1 and 3 beat 2.
    const l = league(4, [[1, 2], [1, 3], [1, 4], [3, 2], [2, 4], [3, 4]], { 2: 90, 3: 10 });
    expect(run(l)).toEqual([1, 3]);
  });

  it("falls back to rank when the tied teams did not play each other", () => {
    const l = league(5, [[1, 4], [1, 5], [2, 4], [5, 2], [3, 5], [4, 3]], { 2: 5, 3: 20 });
    expect(run(l)).toEqual([1, 3]);
  });

  it("falls back to a seeded draw when head-to-head and rank are both level", () => {
    const l = league(5, [[1, 4], [1, 5], [2, 4], [5, 2], [3, 5], [4, 3]]);
    expect(run(l, () => 0.1)).toEqual([1, 2]);
    expect(run(l, () => 0.9)).toEqual([1, 3]);
  });

  it("a three-way round-robin tie is won by the team 2-0 among the tied teams", () => {
    // 4 is 2-1 and leads. 1, 2, 3 are each 2-2; among themselves 1 beat 2 and 3, 2 beat 3.
    const l = league(5, [[1, 2], [1, 3], [2, 3], [4, 1], [5, 1], [4, 2], [2, 5], [3, 4], [3, 5]]);
    expect(run(l)).toEqual([4, 1]);
  });

  it("with no round robin, a team that beat every other tied team is placed first", () => {
    // 1, 2, 3 are each 2-1. 1 beat 2 and 3, who never met. Rank then orders 2 over 3.
    const l = league(5, [[1, 2], [1, 3], [4, 1], [2, 4], [2, 5], [3, 4], [3, 5]], { 2: 10, 3: 5 });
    expect(run(l)).toEqual([1, 2]);
  });

  it("with no round robin, a team that lost to every other tied team is eliminated", () => {
    // 4 is 4-0. 1, 2, 3 are 3-3; 1 and 3 beat 2 but never met. 2 is eliminated, rank orders 3 over 1.
    const results: [number, number][] = [
      ...chain(4, 1, 3), [4, 8],
      [1, 2], [3, 2],
      [1, 5], [1, 6], [7, 1], [8, 1],
      [3, 5], [3, 6], [7, 3], [8, 3],
      [2, 5], [2, 6], [2, 7], [5, 7], [6, 7], [5, 8], [6, 8],
    ];
    const l = league(8, results, { 1: 1, 3: 50 });
    const s = conferenceStandings(l.season, "C", l.winnerOf);
    expect(s[0].teamId).toBe(4);
    for (const id of [1, 2, 3]) expect(s.find((x) => x.teamId === id)).toMatchObject({ wins: 3, losses: 3 });
    expect(s.slice(1, 4).map((x) => x.teamId).sort()).toEqual([1, 2, 3]);
    expect(run(l)).toEqual([4, 3]);
  });

  it("treats a team with fewer games as tied when it matches the leader's losses", () => {
    // Team 1 is 7-1 in 8 games, team 2 is 8-1 in 9 games; they never met.
    const results: [number, number][] = [...chain(1, 3, 9), [10, 1], ...chain(2, 3, 10), [3, 2]];
    const l = league(10, results);
    const s = conferenceStandings(l.season, "C", l.winnerOf);
    expect(s.find((x) => x.teamId === 1)).toMatchObject({ wins: 7, losses: 1 });
    expect(s.find((x) => x.teamId === 2)).toMatchObject({ wins: 8, losses: 1 });
    expect(run(l)).toEqual([2, 1]);
  });

  it("a 7-1 team in fewer games joins a tie for first but loses it on win pct", () => {
    // 2 and 3 are 8-1 (never met); 1 is 7-1 in 8 games. Rank puts 3 first, then 2 beats 1 on pct.
    const results: [number, number][] = [
      ...chain(1, 4, 10), [11, 1],
      ...chain(2, 4, 11), [12, 2],
      ...chain(3, 4, 11), [13, 3],
      ...chain(4, 12, 13), ...chain(5, 12, 13), ...chain(6, 12, 13),
    ];
    const l = league(13, results, { 3: 9 });
    expect(run(l)).toEqual([3, 2]);
  });

  it("restarts after placing one team: the remaining candidates are re-tied from scratch", () => {
    // 1, 2, 3 each beat one of the others (1>2, 2>3, 3>1) and 4 and 5, so all are 3-1.
    // Rank places 3; the restart finds 1 and 2 tied and head-to-head puts 1 second.
    const l = league(5, [[1, 2], [2, 3], [3, 1], ...chain(1, 4, 5), ...chain(2, 4, 5), ...chain(3, 4, 5)], { 3: 99 });
    expect(run(l)).toEqual([3, 1]);
  });
});
