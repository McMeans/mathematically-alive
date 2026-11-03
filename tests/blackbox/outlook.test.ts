import { describe, expect, it } from "vitest";
import { championshipParticipants, mustWinConference, seasonOutlook } from "@/core";
import type { Game, Season } from "@/core";

const ratings: Record<number, number> = { 1: 5, 2: 10, 3: -5, 4: 0, 5: -20, 10: 8, 11: -2 };

function team(id: number, conference: string | null, classification: "fbs" | "fcs" = "fbs") {
  return {
    id, name: `T${id}`, abbreviation: null, conference, classification,
    color: null, altColor: null, rating: ratings[id] ?? null,
  };
}

let nextId = 0;
function game(home: number, away: number, conf: boolean, winner?: number): Game {
  return {
    id: nextId++, week: 1, start: "2026-09-01T00:00:00Z", neutralSite: false, conferenceGame: conf,
    homeId: home, awayId: away,
    homePoints: winner === undefined ? null : winner === home ? 21 : 14,
    awayPoints: winner === undefined ? null : winner === away ? 21 : 14,
    completed: winner !== undefined, spread: null,
  };
}

// Conference "C": team 1 beat everyone, team 5 lost to everyone, and 2, 3, 4
// still have to play each other. Teams 10 and 11 are outside the conference.
function build(): { season: Season; upset: Game } {
  nextId = 0;
  const upset = game(2, 3, true);
  const games = [
    game(1, 2, true, 1), game(1, 3, true, 1), game(1, 4, true, 1), game(1, 5, true, 1),
    game(2, 5, true, 2), game(3, 5, true, 3), game(4, 5, true, 4),
    upset, game(2, 4, true), game(3, 4, true),
    game(10, 2, false), game(3, 11, false), game(10, 11, false),
  ];
  const teams = [1, 2, 3, 4, 5].map((id) => team(id, "C")).concat([team(10, "Other"), team(11, "Other")]);
  return { season: { year: 2026, fetchedAt: "", teams, games }, upset };
}

const run = (season: Season, extra: { locks?: Record<number, number>; seed?: number; teamId?: number } = {}) =>
  seasonOutlook(season, { conference: "C", iterations: 4000, seed: extra.seed ?? 7, locks: extra.locks, teamId: extra.teamId });
const byTeam = (o: ReturnType<typeof run>, id: number) => o.teams.find((t) => t.teamId === id)!;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("season outlook", () => {
  it("gives the same answer twice for the same seed", () => {
    const { season } = build();
    expect(run(season)).toEqual(run(season));
  });

  it("covers exactly the teams in the conference with their current record", () => {
    const { season } = build();
    const o = run(season);
    expect(o.iterations).toBe(4000);
    expect(o.teams.map((t) => t.teamId).sort()).toEqual([1, 2, 3, 4, 5]);
    expect(byTeam(o, 1).record).toEqual({ wins: 4, losses: 0, conferenceWins: 4, conferenceLosses: 0 });
    expect(byTeam(o, 1).expectedConferenceWins).toBe(4);
  });

  it("counts locked results in a team's record", () => {
    const { season, upset } = build();
    const o = run(season, { locks: { [upset.id]: 3 } });
    expect(byTeam(o, 3).record).toEqual({ wins: 2, losses: 1, conferenceWins: 2, conferenceLosses: 1 });
    expect(byTeam(o, 2).record).toEqual({ wins: 1, losses: 2, conferenceWins: 1, conferenceLosses: 2 });
  });

  it("breaks a tie on ranking toward the team with the better simulated record", () => {
    // Conference "R": 20 beat everyone; 21 and 22 are 1-1, never met, and have equal ratings. Only the
    // ranking step separates them, and 21 wins its game outside the conference while 22 loses its.
    nextId = 100;
    const out = game(21, 24, false);
    const other = game(22, 25, false);
    const games = [
      game(20, 21, true, 20), game(20, 22, true, 20), game(20, 23, true, 20),
      game(21, 23, true, 21), game(22, 23, true, 22), out, other,
    ];
    const teams = [20, 21, 22, 23].map((id) => team(id, "R")).concat([team(24, "Other"), team(25, "Other")]);
    const o = seasonOutlook({ year: 2026, fetchedAt: "", teams, games }, {
      conference: "R", iterations: 4000, seed: 7, locks: { [out.id]: 21, [other.id]: 25 },
    });
    const a = o.teams.find((t) => t.teamId === 21)!.titleGame;
    const b = o.teams.find((t) => t.teamId === 22)!.titleGame;
    expect(a + b).toBeCloseTo(1, 10);
    expect(a).toBeGreaterThan(0.6);
  });

  it("puts two teams in the title game every iteration", () => {
    const { season } = build();
    expect(sum(run(season).teams.map((t) => t.titleGame))).toBeCloseTo(2, 10);
  });

  it("crowns exactly one champion every iteration", () => {
    const { season } = build();
    expect(sum(run(season).teams.map((t) => t.champion))).toBeCloseTo(1, 10);
  });

  it("sends a team that has clinched to the title game every time", () => {
    const { season } = build();
    expect(byTeam(run(season), 1).titleGame).toBe(1);
  });

  it("keeps an eliminated team out of the title game", () => {
    const { season } = build();
    const t = byTeam(run(season), 5);
    expect(t.titleGame).toBe(0);
    expect(t.champion).toBe(0);
  });

  it("raises the underdog's title game odds when it is locked to pull an upset", () => {
    const { season, upset } = build();
    const base = byTeam(run(season), 3).titleGame;
    const locked = byTeam(run(season, { locks: { [upset.id]: 3 } }), 3).titleGame;
    expect(locked).toBeGreaterThan(base);
  });

  it("keeps playoff odds between 0 and 1 and at least the champion odds", () => {
    const { season } = build();
    for (const t of run(season).teams) {
      expect(t.playoff).toBeGreaterThanOrEqual(0);
      expect(t.playoff).toBeLessThanOrEqual(1);
      expect(t.playoff).toBeGreaterThanOrEqual(t.champion);
    }
  });

  it("lets the champion in on the auto bid but not a winless team outside the top 11", () => {
    const { season } = build();
    // Twelve idle FBS teams outrank the winless team 5 on the ordering score.
    const idle = Array.from({ length: 12 }, (_, i) => team(100 + i, "Idle"));
    const crowded: Season = { ...season, teams: [...season.teams, ...idle] };
    const o = run(crowded);
    expect(byTeam(o, 5).playoff).toBe(0);
    expect(byTeam(o, 1).playoff).toBeGreaterThanOrEqual(byTeam(o, 1).champion);
    expect(byTeam(o, 1).playoff).toBeGreaterThan(0);
  });

  it("lets a strong non-champion in on ranking, beyond its title odds", () => {
    const { season } = build();
    // 12 idle FBS teams sit at score 0, so only teams that win enough rank top 11.
    const idle = Array.from({ length: 12 }, (_, i) => team(100 + i, "Idle"));
    const crowded: Season = { ...season, teams: [...season.teams, ...idle] };
    const t = byTeam(run(crowded), 2);
    expect(t.playoff).toBeGreaterThan(t.champion);
    expect(t.playoff).toBeLessThan(1);
  });

  it("a non-conference win raises a contender's playoff odds", () => {
    const { season } = build();
    const idle = Array.from({ length: 12 }, (_, i) => team(100 + i, "Idle"));
    const t = byTeam(run({ ...season, teams: [...season.teams, ...idle] }, { teamId: 2 }), 2);
    expect(t.atLarge).toBeGreaterThan(0);
    const nc = t.games.find((x) => x.gameId === season.games[10].id)!; // 10 vs 2
    expect(nc.playoffIfWin).toBeGreaterThan(nc.playoffIfLose);
  });

  it("a team whose only way into the playoff is the title has no at-large odds", () => {
    const { season } = build();
    // Eleven idle teams rated far above anyone fill every at-large spot.
    const strong = Array.from({ length: 11 }, (_, i) => ({ ...team(100 + i, "Idle"), rating: 200 }));
    const o = run({ ...season, teams: [...season.teams, ...strong] });
    const t = byTeam(o, 2);
    expect(t.playoff).toBeGreaterThan(0);
    expect(t.atLarge).toBe(0);
    expect(mustWinConference(t)).toBe(true);
    const contender = byTeam(run({ ...season, teams: [...season.teams, ...Array.from({ length: 12 }, (_, i) => team(100 + i, "Idle"))] }), 2);
    expect(mustWinConference(contender)).toBe(false);
    expect(t.playoff).toBeCloseTo(t.champion, 10);
  });

  it("a conference win raises a contender's playoff odds", () => {
    const { season, upset } = build();
    const idle = Array.from({ length: 12 }, (_, i) => team(100 + i, "Idle"));
    const x = byTeam(run({ ...season, teams: [...season.teams, ...idle] }, { teamId: 2 }), 2).games.find((y) => y.gameId === upset.id)!;
    expect(x.playoffIfWin).toBeGreaterThan(x.playoffIfLose);
    expect(x.titleIfWin).toBeGreaterThan(x.titleIfLose);
  });

  it("a game's odds either way are exactly what picking that result shows", () => {
    const { season } = build();
    const idle = Array.from({ length: 12 }, (_, i) => team(100 + i, "Idle"));
    const s: Season = { ...season, teams: [...season.teams, ...idle] };
    const pick = (gameId: number, winner: number, locks: Record<number, number> = {}) =>
      byTeam(run(s, { locks: { ...locks, [gameId]: winner } }), 2);
    // Every one of team 2's games, conference or not, with and without a pick already on one of them.
    for (const locks of [{}, { [season.games[10].id]: 10 }]) {
      const t = byTeam(run(s, { teamId: 2, locks }), 2);
      expect(t.games.map((x) => x.gameId)).toEqual(s.games.filter((g) => !g.completed && (g.homeId === 2 || g.awayId === 2)).map((g) => g.id));
      for (const x of t.games) {
        const g = s.games.find((y) => y.id === x.gameId)!;
        const opp = g.homeId === 2 ? g.awayId : g.homeId;
        const [win, lose] = [pick(g.id, 2, locks), pick(g.id, opp, locks)];
        expect([x.titleIfWin, x.titleIfLose, x.playoffIfWin, x.playoffIfLose]).toEqual([win.titleGame, lose.titleGame, win.playoff, lose.playoff]);
      }
    }
    // Only the team asked about gets them.
    expect(byTeam(run(s, { teamId: 2 }), 3).games).toEqual([]);
  });

  it("keeps what-if runs paired: locking a game outside the conference leaves its odds identical", () => {
    const { season } = build();
    const outside = season.games[12]; // 10 vs 11, no conference team involved
    const base = run(season);
    const locked = run(season, { locks: { [outside.id]: 11 } });
    for (const t of base.teams) {
      const l = byTeam(locked, t.teamId);
      expect(l.titleGame).toBe(t.titleGame);
      expect(l.champion).toBe(t.champion);
    }
  });

  it("keeps a lock's effect local: locking 2 over 4 doesn't change team 5 or team 1's title game", () => {
    const { season } = build();
    const g = season.games[8]; // 2 vs 4
    const locked = run(season, { locks: { [g.id]: 2 } });
    const base = run(season);
    expect(byTeam(locked, 1).titleGame).toBe(byTeam(base, 1).titleGame);
    expect(byTeam(locked, 5).titleGame).toBe(0);
    expect(byTeam(locked, 4).titleGame).toBeLessThan(byTeam(base, 4).titleGame);
  });

  it("throws for a conference with no teams", () => {
    const { season } = build();
    expect(() => seasonOutlook(season, { conference: "Nope", iterations: 10, seed: 1 })).toThrow(/fewer than two teams/);
  });

  it("throws for a conference with a single team", () => {
    const { season } = build();
    const solo: Season = { ...season, teams: season.teams.filter((t) => t.id !== 11) };
    expect(() => seasonOutlook(solo, { conference: "Other", iterations: 10, seed: 1 })).toThrow(/fewer than two teams/);
  });
});

describe("championship participants input checks", () => {
  it("throws a descriptive error when winnerOf names a team that isn't in the game", () => {
    const { season } = build();
    expect(() => championshipParticipants(season, "C", () => 99, { draw: () => 0.5 })).toThrow(/not in game/);
  });
});
