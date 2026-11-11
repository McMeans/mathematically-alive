import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fillLabLocks, gameWinProbability, liveRanking, seasonFromCfbd, seasonLab, teamRecord, type CfbdSnapshot, type Season } from "@/core";

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

  it("each power conference's champion holds a place in the projected field: its highest-ranked team when none is picked", () => {
    const l = lab(season);
    const field = new Set(l.playoff!.field.map((f) => f.teamId));
    for (const c of POWER) {
      const top = l.live.find((t) => conferenceOf(season, t.teamId) === c);
      if (top) expect(field.has(top.teamId)).toBe(true);
    }
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
