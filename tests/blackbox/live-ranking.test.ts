import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { liveRanking, liveRanks, seasonFromCfbd, seasonLab, simulateNational, type CfbdSnapshot, type Game, type Season, type Team } from "@/core";

// A tiny made-up league: six even teams (rating 0), one week played, a ranking after it, and week 3 still to play.
const team = (id: number, name: string): Team => ({
  id, name, abbreviation: null, conference: "Test", classification: "fbs", color: null, altColor: null, rating: 0,
});
const [A, B, C, D, E, F] = [1, 2, 3, 4, 5, 6];
const game = (id: number, week: number, homeId: number, awayId: number, result?: [number, number]): Game => ({
  id, week, start: `2026-09-${String(week * 7).padStart(2, "0")}T18:00:00Z`, neutralSite: false, conferenceGame: true, homeId, awayId,
  homePoints: result?.[0] ?? null, awayPoints: result?.[1] ?? null, completed: result !== undefined, spread: null,
});
const league: Season = {
  year: 2026,
  fetchedAt: "2026-09-15T00:00:00Z",
  teams: [team(A, "Ash"), team(B, "Birch"), team(C, "Cedar"), team(D, "Dogwood"), team(E, "Elm"), team(F, "Fir")],
  games: [
    game(11, 1, A, C, [24, 10]), game(12, 1, B, D, [21, 14]), game(13, 1, E, F, [17, 3]),
    game(31, 3, C, F), game(32, 3, A, D), game(33, 3, B, E),
  ],
  // The committee ranked four of them; Elm and Fir it left out.
  committeeRankings: [{ week: 2, postseason: false, teamIds: [A, B, C, D] }],
};
const ids = (s: Season, opts?: Parameters<typeof liveRanking>[1]) => liveRanking(s, opts).teams.map((t) => t.teamId);

describe("live ranking", () => {
  it("is the committee's ranking while no result has come in since, unranked teams placed after it", () => {
    const live = liveRanking(league);
    expect(live.teams.map((t) => t.teamId)).toEqual([A, B, C, D, E, F]);
    expect(live.teams.map((t) => t.committeeRank)).toEqual([1, 2, 3, 4, null, null]);
    expect(live.teams.every((t) => t.change === 0)).toBe(true);
    expect(live.release).toEqual(league.committeeRankings![0]);
  });

  it("a picked upset drops the loser and lifts the winner", () => {
    // Elm, unranked, beats Birch (#2).
    const live = liveRanking(league, { locks: { 33: E } });
    const of = (id: number) => live.teams.find((t) => t.teamId === id)!;
    expect(of(B).rank).toBeGreaterThan(of(C).rank);
    expect(of(B).change).toBeLessThan(0);
    expect(of(E).rank).toBeLessThan(of(D).rank);
    expect(of(E).change).toBeGreaterThan(0);
  });

  it("a real result since the ranking moves it the same way a pick does", () => {
    const played = { ...league, games: league.games.map((g) => (g.id === 32 ? { ...g, homePoints: 7, awayPoints: 20, completed: true } : g)) };
    expect(ids(played)).toEqual(ids(league, { locks: { 32: D } }));
  });

  it("a result in a game its team isn't in leaves a team where it was", () => {
    // Cedar, the team Ash beat, losing again doesn't cost Ash its place: the committee ranks on a team's own results.
    expect(ids(league, { locks: { 31: F } }).slice(0, 2)).toEqual([A, B]);
  });

  it("a pick that names neither team in the game moves nothing", () => {
    expect(ids(league, { locks: { 31: A } })).toEqual([A, B, C, D, E, F]);
  });

  it("a picked conference champion gets the title game's win", () => {
    const order = ids(league, { champions: [E] });
    expect(order.indexOf(E)).toBeLessThan(order.indexOf(D));
  });

  it("before the committee's first ranking, the stand-in orders the teams and none has a rank to show", () => {
    const early = { ...league, committeeRankings: [] };
    const live = liveRanking(early);
    expect(live.release).toBeNull();
    expect(live.teams.every((t) => t.committeeRank === null)).toBe(true);
    // The three 1-0 teams first.
    expect(new Set(live.teams.slice(0, 3).map((t) => t.teamId))).toEqual(new Set([A, B, E]));
    expect(liveRanks(early)).toEqual({});
  });

  it("tags the top 25 by name with its live place", () => {
    expect(liveRanks(league, { locks: { 33: E } })[B]).not.toBe("#2");
    expect(liveRanks(league)).toEqual({ [A]: "#1", [B]: "#2", [C]: "#3", [D]: "#4", [E]: "#5", [F]: "#6" });
  });
});

describe("live ranking on a real season", () => {
  // 2026 through week 9, and the committee's first ranking (week 10), from fixtures/cfp-2026.json.
  const fx = JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot; rankings: { week: number; ranks: { teamId: number }[] }[] };
  const first = fx.rankings[0];
  const season: Season = { ...seasonFromCfbd(fx.snapshot), committeeRankings: [{ week: first.week, postseason: false, teamIds: first.ranks.map((r) => r.teamId) }] };
  const committee = first.ranks.map((r) => r.teamId);

  it("matches the committee's top 25 exactly before any new result", () => {
    expect(ids(season).slice(0, 25)).toEqual(committee);
  });

  it("starts each simulated season's ranking from the committee's: swapping its top two swaps their average places", () => {
    const run = (s: Season) => simulateNational(s, { iterations: 200, seed: 3, conferences: ["ACC", "Big 12", "SEC", "Big Ten"] });
    const meanRank = (r: ReturnType<typeof run>, id: number) => r.teams.find((t) => t.teamId === id)!.meanRank;
    const [one, two] = committee;
    const asRanked = run(season);
    const swapped = run({ ...season, committeeRankings: [{ ...season.committeeRankings![0], teamIds: [two, one, ...committee.slice(2)] }] });
    expect(meanRank(asRanked, one) - meanRank(asRanked, two)).toBeLessThan(meanRank(swapped, one) - meanRank(swapped, two));
  });

  it("a team's own simulated wins still move it: locking the committee's #1 to lose its next game lowers its average place", () => {
    const one = committee[0];
    const next = season.games.find((g) => !g.completed && (g.homeId === one || g.awayId === one))!;
    const loses = next.homeId === one ? next.awayId : next.homeId;
    const run = (locks: Record<number, number>) => simulateNational(season, { iterations: 200, seed: 3, locks, conferences: ["ACC", "Big 12", "SEC", "Big Ten"] });
    const meanRank = (r: ReturnType<typeof run>) => r.teams.find((t) => t.teamId === one)!.meanRank;
    expect(meanRank(run({ [next.id]: loses }))).toBeGreaterThan(meanRank(run({ [next.id]: one })));
  });

  it("the focus team's what-if odds match locking its game, with the anchored ranking", () => {
    const one = committee[0];
    const next = season.games.find((g) => !g.completed && (g.homeId === one || g.awayId === one))!;
    const loses = next.homeId === one ? next.awayId : next.homeId;
    const opts = { iterations: 200, seed: 3, conferences: ["ACC", "Big 12", "SEC", "Big Ten"] };
    const focus = simulateNational(season, { ...opts, teamId: one }).games.find((g) => g.gameId === next.id)!;
    const field = (locks: Record<number, number>) => simulateNational(season, { ...opts, locks }).teams.find((t) => t.teamId === one)!.playoff!.field;
    expect(focus.fieldIfWin).toBeCloseTo(field({ [next.id]: one }), 10);
    expect(focus.fieldIfLose).toBeCloseTo(field({ [next.id]: loses }), 10);
  });

  it("the Season Lab's top 25 is the projected final ranking, each move measured from the current ranking", () => {
    const opts = { iterations: 50, seed: 3, conferences: ["ACC", "Big 12", "SEC", "Big Ten"] };
    const top = seasonLab(season, opts).live;
    expect(top).toHaveLength(25);
    const now = liveRanking(season).teams;
    for (const t of top) {
      const cur = now.find((x) => x.teamId === t.teamId)!;
      expect(t.committeeRank).toBe(cur.committeeRank);
      expect(t.change).toBe(cur.rank - t.rank);
    }
    const one = committee[0];
    const next = season.games.find((g) => !g.completed && (g.homeId === one || g.awayId === one))!;
    const loses = next.homeId === one ? next.awayId : next.homeId;
    const picked = seasonLab(season, { ...opts, locks: { games: { [next.id]: loses }, titles: {}, bracket: {} } }).live;
    expect(picked.find((t) => t.teamId === one)?.rank ?? 26).toBeGreaterThan(top.find((t) => t.teamId === one)!.rank);
  });

  it("the Season Lab seeds its projected field and bracket from the projected ranking, and a pick reseeds them", () => {
    const opts = { iterations: 50, seed: 3, conferences: ["ACC", "Big 12", "SEC", "Big Ten"] };
    const base = seasonLab(season, opts);
    const field = base.playoff!.field.map((f) => f.teamId);
    expect(field[0]).toBe(committee[0]);
    // Every seeded team but the automatic bids comes from the ranking's top, in its order; the bubble is who's next.
    const order = base.live.map((t) => t.teamId);
    const next = order.filter((id) => !field.includes(id));
    expect(base.playoff!.bubble.map((b) => b.teamId)).toEqual(next.slice(0, base.playoff!.bubble.length));
    const quarterfinal = base.playoff!.bracket.find((g) => g.round === "Quarterfinal")!;
    expect(quarterfinal.a).toEqual({ teamId: committee[0], seed: 1 });

    const one = committee[0];
    const game = season.games.find((g) => !g.completed && (g.homeId === one || g.awayId === one))!;
    const loses = game.homeId === one ? game.awayId : game.homeId;
    const picked = seasonLab(season, { ...opts, locks: { games: { [game.id]: loses }, titles: {}, bracket: {} } });
    expect(picked.playoff!.field[0].teamId).not.toBe(one);
    expect(picked.playoff!.bracket.find((g) => g.round === "Quarterfinal")!.a).toEqual({ teamId: picked.playoff!.field[0].teamId, seed: 1 });
  });
});
