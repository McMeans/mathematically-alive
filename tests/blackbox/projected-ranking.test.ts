import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fillLabLocks, gameWinProbability, liveRanking, seasonFromCfbd, seasonLab, teamRecord, type CfbdSnapshot, type Game, type Season, type Team } from "@/core";

// 2026 through week 9, and the committee's first ranking (week 10), from fixtures/cfp-2026.json.
const fx = JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot; rankings: { week: number; ranks: { teamId: number }[] }[] };
const first = fx.rankings[0];
const season: Season = { ...seasonFromCfbd(fx.snapshot), committeeRankings: [{ week: first.week, postseason: false, teamIds: first.ranks.map((r) => r.teamId) }] };
const committee = first.ranks.map((r) => r.teamId);
const POWER = ["ACC", "Big 12", "Big Ten", "SEC"];
const conferences = [...new Set(season.teams.flatMap((t) => (t.classification === "fbs" && t.conference && t.conference !== "FBS Independents" ? [t.conference] : [])))];
const opts = { iterations: 300, seed: 5, conferences };
const conferenceOf = (s: Season, id: number) => s.teams.find((t) => t.id === id)!.conference;
const winOut = (s: Season, id: number) => Object.fromEntries(s.games.filter((g) => !g.completed && !g.titleGame && (g.homeId === id || g.awayId === id)).map((g) => [g.id, id]));
const lab = (s: Season, games: Record<number, number> = {}) => seasonLab(s, { ...opts, locks: { games, titles: {}, bracket: {} } });
const placeOf = (s: Season, id: number, locks?: Record<number, number>) => liveRanking(s, { locks }).teams.find((t) => t.teamId === id)!.rank;

describe("projected ranking", () => {
  it("winning out lifts a two-loss power team ranked in the teens a few places, not into the top four", () => {
    const id = committee.slice(14, 20).find((t) => POWER.includes(conferenceOf(season, t) ?? "") && teamRecord(season, t).losses >= 2)!;
    const projected = lab(season, winOut(season, id)).live.find((t) => t.teamId === id)!;
    expect(projected.rank).toBeGreaterThan(4);
    expect(projected.rank).toBeLessThan(committee.indexOf(id) + 1);
  });

  it("a Group of Six team's wins lift it less than the same wins would lift a power team", () => {
    const id = committee.find((t) => !POWER.includes(conferenceOf(season, t) ?? "") && season.teams.find((x) => x.id === t)!.name !== "Notre Dame")!;
    const asPower: Season = { ...season, teams: season.teams.map((t) => (t.id === id ? { ...t, conference: "SEC" } : t)) };
    // Its games left, played and won.
    const won = (s: Season): Season => ({ ...s, games: s.games.map((g) => (winOut(s, id)[g.id] ? { ...g, completed: true, homePoints: g.homeId === id ? 30 : 10, awayPoints: g.homeId === id ? 10 : 30 } : g)) });
    expect(placeOf(season, id)).toBe(placeOf(asPower, id));
    expect(placeOf(won(season), id)).toBeGreaterThan(placeOf(won(asPower), id));
  });

  it("with no picks the projected field is the current picture: the committee's order, its top team the 1 seed", () => {
    const l = lab(season);
    expect(l.live.map((t) => t.teamId)).toEqual(committee);
    expect(l.playoff!.field[0].teamId).toBe(committee[0]);
  });

  it("with no title pick, a power conference's spot goes to the likelier winner of its two likeliest title-game teams", () => {
    const l = lab(season);
    const field = new Set(l.playoff!.field.map((f) => f.teamId));
    for (const c of POWER) {
      const pair = l.national.teams.filter((t) => t.conference === c && (t.titleGame ?? 0) > 0)
        .sort((a, b) => b.titleGame! - a.titleGame!).slice(0, 2).sort((a, b) => b.champion! - a.champion!);
      if (pair.length) expect(field.has(pair[0].teamId)).toBe(true);
    }
  });

  it("the lab gives each team's record with its picks counted", () => {
    const id = committee[0];
    expect(lab(season, winOut(season, id)).records[id]).toBe(`${teamRecord(season, id, winOut(season, id)).wins}-${teamRecord(season, id).losses}`);
  });

  it("a seed comes from the projected ranking, not the chance in: the field is in projected order, champions aside", () => {
    const l = lab(season);
    const order = new Map(l.live.map((t) => [t.teamId, t.rank]));
    const atLarge = l.playoff!.field.map((f) => f.teamId).filter((id) => order.has(id) && order.get(id)! <= 12);
    const places = atLarge.map((id) => order.get(id)!);
    expect(places).toEqual([...places].sort((a, b) => a - b));
  });

  it("with every game picked, the picks count as if they had been played: the season is ranked on its whole record", () => {
    const open = season.games.filter((g) => !g.completed);
    // Favourites win every open game.
    const locks = Object.fromEntries(open.map((g) => [g.id, gameWinProbability(season, g) >= 0.5 ? g.homeId : g.awayId]));
    const played: Season = { ...season, games: season.games.map((g) => (locks[g.id] === undefined ? g : { ...g, completed: true, homePoints: locks[g.id] === g.homeId ? 30 : 10, awayPoints: locks[g.id] === g.homeId ? 10 : 30 })) };
    const order = (s: Season, l?: Record<number, number>) => liveRanking(s, { locks: l }).teams.map((t) => t.teamId);
    expect(order(season, locks)).toEqual(order(played));
  });

  it("no team with three losses ranks above seventh, or with four above thirteenth", () => {
    // The committee's top team loses every game it has left.
    const id = committee[0];
    const locks = Object.fromEntries(season.games.filter((g) => !g.completed && (g.homeId === id || g.awayId === id)).map((g) => [g.id, g.homeId === id ? g.awayId : g.homeId]));
    const losses = teamRecord(season, id, locks).losses;
    const rank = liveRanking(season, { locks }).teams.find((t) => t.teamId === id)!.rank;
    expect(losses).toBeGreaterThanOrEqual(3);
    expect(rank).toBeGreaterThanOrEqual(losses >= 4 ? 13 : 7);
  });

  it("no team with five losses ranks above 22nd, and none with six is in the top 25", () => {
    // A made-up league of 30 even teams. The committee ranked T1-T25 in week 8. Before it, T9 (ranked 9th) and T10 (10th)
    // each lost five games to the five unranked teams, T26-T30. T10 then loses a sixth, a pick in week 9.
    const T = (i: number) => i;
    const teams: Team[] = Array.from({ length: 30 }, (_, k) => ({
      id: T(k + 1), name: `T${k + 1}`, abbreviation: null, conference: "Test", classification: "fbs", color: null, altColor: null, rating: 0,
    }));
    const game = (id: number, week: number, homeId: number, awayId: number, awayWon?: boolean): Game => ({
      id, week, start: `2026-09-${String(week).padStart(2, "0")}T18:00:00Z`, neutralSite: false, conferenceGame: false, homeId, awayId,
      homePoints: awayWon === undefined ? null : awayWon ? 10 : 30, awayPoints: awayWon === undefined ? null : awayWon ? 30 : 10, completed: awayWon !== undefined, spread: null,
    });
    const games: Game[] = [];
    for (let i = 0; i < 5; i++) {
      games.push(game(100 + i, i + 1, T(9), T(26 + i), true));
      games.push(game(200 + i, i + 1, T(10), T(26 + ((i + 1) % 5)), true));
    }
    games.push(game(300, 9, T(10), T(26)));
    const league: Season = {
      year: 2026, fetchedAt: "2026-10-20T00:00:00Z", teams, games,
      committeeRankings: [{ week: 8, postseason: false, teamIds: Array.from({ length: 25 }, (_, k) => T(k + 1)) }],
    };
    const locks = { 300: T(26) };
    expect(teamRecord(league, T(9)).losses).toBe(5);
    expect(teamRecord(league, T(10), locks).losses).toBe(6);

    const live = liveRanking(league, { locks }).teams;
    const place = (id: number) => live.find((t) => t.teamId === id)!.rank;
    expect(place(T(9))).toBeGreaterThanOrEqual(22);
    expect(place(T(10))).toBeGreaterThanOrEqual(26);
    // Without the pick, the committee's 10th (five losses) still can't sit above 22nd.
    expect(liveRanking(league).teams.find((t) => t.teamId === T(10))!.rank).toBeGreaterThanOrEqual(22);
  });

  it("filling the season re-picks a title game whose earlier pick the filled games put out of it", () => {
    const fill = fillLabLocks(season, {}, "favorites", conferences);
    const l = lab(season, fill.games);
    const c = l.conferences.find((x) => x.final?.exact && fill.titles[x.conference] !== undefined)!;
    // A pick for a conference team not in the filled title game.
    const out = season.teams.find((t) => t.conference === c.conference && !c.final!.teams.includes(t.id))!.id;
    const refill = fillLabLocks(season, { titles: { [c.conference]: out } }, "favorites", conferences);
    expect(c.final!.teams).toContain(refill.titles[c.conference]);
    const full = seasonLab(season, { ...opts, locks: refill });
    expect(full.conferences.filter((x) => x.final).every((x) => x.picked !== null)).toBe(true);
  });
});
