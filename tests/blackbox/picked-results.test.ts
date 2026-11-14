import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gameWinProbability, liveRanking, seasonFromCfbd, teamRecord, type CfbdSnapshot, type Game, type Season } from "@/core";

// 2026 through week 9, and the committee's first ranking (week 10), from fixtures/cfp-2026.json.
const fx = JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot; rankings: { week: number; ranks: { teamId: number }[] }[] };
const first = fx.rankings[0];
const season: Season = { ...seasonFromCfbd(fx.snapshot), committeeRankings: [{ week: first.week, postseason: false, teamIds: first.ranks.map((r) => r.teamId) }] };
const committee = first.ranks.map((r) => r.teamId);
const POWER = ["ACC", "Big 12", "Big Ten", "SEC"];
const nameOf = (id: number) => season.teams.find((t) => t.id === id)!.name;
const conferenceOf = (id: number) => season.teams.find((t) => t.id === id)!.conference ?? "";
const rankOf = (id: number, locks?: Record<number, number>) => liveRanking(season, { locks }).teams.find((t) => t.teamId === id)!.rank;
const isArmyNavy = (g: Game) => new Set([nameOf(g.homeId), nameOf(g.awayId)]).has("Army") && new Set([nameOf(g.homeId), nameOf(g.awayId)]).has("Navy");
const unplayed = season.games.filter((g) => !g.completed && g.week >= season.committeeRankings![0].week);
// The same game played, the given team winning, after the committee's ranking.
const played = (g: Game, winner: number): Season => ({
  ...season,
  games: season.games.map((x) => (x.id === g.id ? { ...x, completed: true, homePoints: winner === g.homeId ? 30 : 10, awayPoints: winner === g.homeId ? 10 : 30 } : x)),
});
const order = (s: Season, locks?: Record<number, number>) => liveRanking(s, { locks }).teams.map((t) => t.teamId);

describe("picked results", () => {
  it("an unranked team that loses drops in the projected ranking", () => {
    const base = liveRanking(season).teams;
    const candidates = base.filter((t) => t.rank >= 26 && t.rank < base.length);
    let checked = 0;
    for (const t of candidates) {
      const g = unplayed.filter((x) => !isArmyNavy(x) && (x.homeId === t.teamId || x.awayId === t.teamId)).sort((a, b) => a.week - b.week)[0];
      if (!g) continue;
      const winner = g.homeId === t.teamId ? g.awayId : g.homeId;
      expect(rankOf(t.teamId, { [g.id]: winner }), nameOf(t.teamId)).toBeGreaterThan(t.rank);
      checked++;
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("a picked result moves both teams exactly as the same result played", () => {
    for (const g of unplayed.filter((x) => !isArmyNavy(x)).slice(0, 25)) {
      for (const winner of [g.homeId, g.awayId]) {
        expect(order(season, { [g.id]: winner }), `${nameOf(g.homeId)} v ${nameOf(g.awayId)}`).toEqual(order(played(g, winner)));
      }
    }
  });

  it("an underdog's picked win lifts it no more than the win itself would", () => {
    const fbs = new Set(liveRanking(season).teams.map((t) => t.teamId));
    const upsets = unplayed.filter((g) => !isArmyNavy(g)).flatMap((g) => {
      const p = gameWinProbability(season, g);
      const winner = p < 0.3 ? g.homeId : p > 0.7 ? g.awayId : null;
      return winner !== null && fbs.has(winner) ? [{ g, winner }] : [];
    });
    expect(upsets.length).toBeGreaterThan(5);
    for (const { g, winner } of upsets) {
      expect(rankOf(winner, { [g.id]: winner }), nameOf(winner)).toBeGreaterThanOrEqual(liveRanking(played(g, winner)).teams.find((t) => t.teamId === winner)!.rank);
    }
  });

  it("an unranked team that wins out against a weak schedule stays below a one-loss power team", () => {
    const top25 = new Set(committee.slice(0, 25));
    const left = (id: number) => unplayed.filter((g) => !g.titleGame && (g.homeId === id || g.awayId === id));
    const candidate = season.teams.find((t) =>
      t.classification === "fbs" && !top25.has(t.id) && !POWER.includes(t.conference ?? "") && t.name !== "Notre Dame" &&
      t.conference !== "FBS Independents" && teamRecord(season, t.id).losses <= 1 && left(t.id).length > 0);
    expect(candidate).toBeDefined();
    const locks = Object.fromEntries(left(candidate!.id).map((g) => [g.id, candidate!.id]));
    const live = liveRanking(season, { locks }).teams;
    const mine = live.find((t) => t.teamId === candidate!.id)!.rank;
    const rivals = live.filter((t) => top25.has(t.teamId) && POWER.includes(conferenceOf(t.teamId)) && teamRecord(season, t.teamId).losses <= 1);
    expect(rivals.length).toBeGreaterThan(0);
    for (const r of rivals) expect(mine, nameOf(r.teamId)).toBeGreaterThan(r.rank);
  });
});
