import { describe, expect, it } from "vitest";
import { gameWinProbability, seasonFromCfbd, teamRecord, winProbability, type CfbdGame, type CfbdSnapshot } from "@/core";

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

describe("market-adjusted ratings", () => {
  // Alpha and Beta rate equal by SP+, so SP+ makes Alpha a 2.5-point home favorite over Beta.
  const teams: CfbdSnapshot["teams"] = [
    { id: ALPHA, school: "Alpha", conference: "Test", classification: "fbs" },
    { id: BETA, school: "Beta", conference: "Test", classification: "fbs" },
    { id: GAMMA, school: "Gamma", conference: "Test", classification: "fbs" },
  ];
  const ratings = [{ team: "Alpha", rating: 10 }, { team: "Beta", rating: 10 }, { team: "Gamma", rating: 0 }];
  const games = [
    game({ id: 20, homeId: ALPHA, awayId: GAMMA, week: 1 }),
    game({ id: 21, homeId: ALPHA, awayId: BETA, week: 2, startDate: "2026-09-12T16:00:00.000Z" }),
  ];
  const unlined = (season: ReturnType<typeof seasonFromCfbd>) =>
    gameWinProbability(season, season.games.find((g) => g.id === 21)!);

  it("a line weaker than SP+ lowers a team's odds in its games without a line", () => {
    // SP+ says Alpha by 12.5 over Gamma; the market says only 2.5 (say, its QB is out).
    const base = seasonFromCfbd({ year: 2026, fetchedAt: "x", teams, games, ratings, lines: [] });
    const hurt = seasonFromCfbd({ year: 2026, fetchedAt: "x", teams, games, ratings, lines: [{ id: 20, lines: [{ spread: -2.5 }] }] });
    expect(unlined(hurt)).toBeLessThan(unlined(base));
  });

  it("moves a home team by half its line's gap from SP+", () => {
    // SP+: Alpha by 12.5 at home. Line: Alpha by 2.5. Gap 10, so Alpha is 5 weaker: Beta's 2.5-point favorite at Alpha.
    const hurt = seasonFromCfbd({ year: 2026, fetchedAt: "x", teams, games, ratings, lines: [{ id: 20, lines: [{ spread: -2.5 }] }] });
    expect(unlined(hurt)).toBeCloseTo(winProbability(2.5), 10);
  });

  it("moves an away team the same way when it's the side the line rates weaker", () => {
    // SP+: Alpha by 7.5 at Gamma. Line: Alpha by 1.5. Alpha is 3 weaker, so a 0.5-point underdog at home to Beta.
    const away = [game({ id: 20, homeId: GAMMA, awayId: ALPHA, week: 1 }), games[1]];
    const s = seasonFromCfbd({ year: 2026, fetchedAt: "x", teams, games: away, ratings, lines: [{ id: 20, lines: [{ spread: 1.5 }] }] });
    expect(unlined(s)).toBeCloseTo(winProbability(0.5), 10);
  });

  it("gives no home edge at a neutral site when comparing a line with SP+", () => {
    // Neutral site: SP+ says Alpha by 10, and so does the line, so nothing moves.
    const neutral = [game({ id: 20, homeId: ALPHA, awayId: GAMMA, week: 1, neutralSite: true }), games[1]];
    const s = seasonFromCfbd({ year: 2026, fetchedAt: "x", teams, games: neutral, ratings, lines: [{ id: 20, lines: [{ spread: -10 }] }] });
    expect(unlined(s)).toBeCloseTo(winProbability(-2.5), 10);
  });

  it("a line that agrees with SP+ leaves the odds alone", () => {
    const base = seasonFromCfbd({ year: 2026, fetchedAt: "x", teams, games, ratings, lines: [] });
    const same = seasonFromCfbd({ year: 2026, fetchedAt: "x", teams, games, ratings, lines: [{ id: 20, lines: [{ spread: -12.5 }] }] });
    expect(unlined(same)).toBeCloseTo(unlined(base), 10);
  });

  it("an absurd line moves a team's strength by at most 7 points", () => {
    const wild = seasonFromCfbd({ year: 2026, fetchedAt: "x", teams, games, ratings, lines: [{ id: 20, lines: [{ spread: 80 }] }] });
    // Alpha (10, at most 7 weaker) at home against Beta (10, its lines say nothing): no worse than a 4.5-point underdog.
    expect(unlined(wild)).toBeCloseTo(winProbability(4.5), 10);
  });

  it("leaves the published SP+ rating alone, so tiebreak stand-ins and the committee model still use SP+", () => {
    const hurt = seasonFromCfbd({ year: 2026, fetchedAt: "x", teams, games, ratings, lines: [{ id: 20, lines: [{ spread: -2.5 }] }] });
    expect(hurt.teams.find((t) => t.id === ALPHA)!.rating).toBe(10);
  });

  it("only uses a team's three latest lined games", () => {
    // Three recent lines agree with SP+; an older one said Alpha was far weaker. The old one shouldn't count.
    const more = [
      game({ id: 30, homeId: ALPHA, awayId: GAMMA, week: 1, startDate: "2026-08-29T16:00:00.000Z" }),
      game({ id: 31, homeId: ALPHA, awayId: GAMMA, week: 1, startDate: "2026-09-01T16:00:00.000Z" }),
      game({ id: 32, homeId: ALPHA, awayId: GAMMA, week: 1, startDate: "2026-09-03T16:00:00.000Z" }),
      game({ id: 33, homeId: ALPHA, awayId: GAMMA, week: 1, startDate: "2026-09-04T16:00:00.000Z" }),
      games[1],
    ];
    const lines = [{ id: 30, lines: [{ spread: 20 }] }, ...[31, 32, 33].map((id) => ({ id, lines: [{ spread: -12.5 }] }))];
    const s = seasonFromCfbd({ year: 2026, fetchedAt: "x", teams, games: more, ratings, lines });
    expect(unlined(s)).toBeCloseTo(winProbability(-2.5), 10);
  });

  it("a game with its own line still uses that line", () => {
    const lined = [...games.slice(0, 1), { ...games[1] }];
    const s = seasonFromCfbd({ year: 2026, fetchedAt: "x", teams, games: lined, ratings, lines: [{ id: 20, lines: [{ spread: 20 }] }, { id: 21, lines: [{ spread: -3 }] }] });
    expect(gameWinProbability(s, s.games.find((g) => g.id === 21)!)).toBeCloseTo(winProbability(-3), 10);
  });
});
