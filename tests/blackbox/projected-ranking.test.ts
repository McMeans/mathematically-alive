import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { liveRanking, seasonFromCfbd, seasonLab, teamRecord, type CfbdSnapshot, type Season } from "@/core";

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
  it("winning out lifts a two-loss power team ranked in the teens a few places, not into the top four: every other team plays its games too", () => {
    const id = committee.slice(14, 20).find((t) => POWER.includes(conferenceOf(season, t) ?? "") && teamRecord(season, t).losses >= 2)!;
    const projected = lab(season, winOut(season, id)).live.find((t) => t.teamId === id)!;
    expect(projected.rank).toBeGreaterThan(4);
    expect(projected.rank).toBeLessThan(committee.indexOf(id) + 1);
  });

  it("a Group of Six team's wins lift it less than the same wins would lift a power team", () => {
    const id = committee.find((t) => !POWER.includes(conferenceOf(season, t) ?? "") && season.teams.find((x) => x.id === t)!.name !== "Notre Dame")!;
    const asPower: Season = { ...season, teams: season.teams.map((t) => (t.id === id ? { ...t, conference: "SEC" } : t)) };
    expect(placeOf(season, id)).toBe(placeOf(asPower, id));
    expect(placeOf(season, id, winOut(season, id))).toBeGreaterThan(placeOf(asPower, id, winOut(asPower, id)));
  });

  it("each power conference's likeliest champion in its title race holds a place in the projected field", () => {
    const l = lab(season);
    const field = new Set(l.playoff!.field.map((f) => f.teamId));
    for (const c of l.conferences.filter((x) => POWER.includes(x.conference))) {
      const best = [...c.teams].sort((a, b) => b.champion - a.champion || a.teamId - b.teamId)[0];
      expect(field.has(best.teamId)).toBe(true);
    }
  });

  it("a seed comes from the projected ranking, not the chance in: the field is in projected order, champions aside", () => {
    const l = lab(season);
    const order = new Map(l.live.map((t) => [t.teamId, t.rank]));
    const atLarge = l.playoff!.field.map((f) => f.teamId).filter((id) => order.has(id) && order.get(id)! <= 12);
    const places = atLarge.map((id) => order.get(id)!);
    expect(places).toEqual([...places].sort((a, b) => a - b));
  });
});
