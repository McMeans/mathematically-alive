import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { liveRanking, seasonFromCfbd, type CfbdSnapshot, type Season } from "@/core";

// A backtest of the live ranking on real results, over every season 2014-2025 (fixtures/cfp-<year>.json).
// For each season, take each weekly committee ranking except the last as the starting point, and the games played
// before the last ranking's week as the season so far. liveRanking moves the earlier ranking by the results since it
// (the games from its week on), and that moved order is compared with the committee's last regular ranking: how many
// of that ranking's top 12 are in the model's top 12, and its top 25 in the model's top 25. The baseline is the
// earlier ranking left unchanged. The thresholds sit just under what the model measures (about 11.0 of 12 and 23.0 of
// 25, against 10.0 and 21.9 unchanged), so a change to the fit that makes the moved ranking worse fails here.
type Fixture = { snapshot: CfbdSnapshot; rankings: { week: number; ranks: { rank: number; teamId: number }[] }[] };
const YEARS = Array.from({ length: 12 }, (_, k) => 2014 + k);

const overlap = (a: number[], b: number[], n: number) => {
  const top = new Set(a.slice(0, n));
  return b.slice(0, n).filter((id) => top.has(id)).length;
};

type Case = { year: number; moved: number[]; before: number[]; final: number[] };
const cases: Case[] = YEARS.flatMap((year) => {
  const fx = JSON.parse(readFileSync(`fixtures/cfp-${year}.json`, "utf8")) as Fixture;
  const full = seasonFromCfbd(fx.snapshot);
  const fbs = new Set(full.teams.filter((t) => t.classification === "fbs").map((t) => t.id));
  const rk = fx.rankings.map((r) => ({ week: r.week, ids: [...r.ranks].sort((a, b) => a.rank - b.rank).map((x) => x.teamId).filter((id) => fbs.has(id)) }));
  const last = rk.length - 1;
  const games = full.games.filter((g) => g.week < rk[last].week);
  return rk.slice(0, last).map((r) => {
    const season: Season = { ...full, games, committeeRankings: [{ week: r.week, postseason: false, teamIds: r.ids }] };
    return { year, moved: liveRanking(season).teams.map((t) => t.teamId), before: r.ids, final: rk[last].ids };
  });
});
const average = (n: number, pick: (c: Case) => number[]) => cases.reduce((sum, c) => sum + overlap(c.final, pick(c), n), 0) / cases.length;

describe("live ranking backtest, 2014-2025", () => {
  it("covers every season's earlier rankings", () => {
    expect(new Set(cases.map((c) => c.year)).size).toBe(YEARS.length);
    expect(cases.length).toBeGreaterThan(50);
  });

  it("the committee's ranking moved by real results holds the committee's later top 12", () => {
    expect(average(12, (c) => c.moved)).toBeGreaterThanOrEqual(10.8);
  });

  it("the committee's ranking moved by real results holds the committee's later top 25", () => {
    expect(average(25, (c) => c.moved)).toBeGreaterThanOrEqual(22.8);
  });

  it("moving the earlier ranking by the results beats leaving it unchanged, in the top 12 and the top 25", () => {
    expect(average(12, (c) => c.moved)).toBeGreaterThan(average(12, (c) => c.before));
    expect(average(25, (c) => c.moved)).toBeGreaterThan(average(25, (c) => c.before));
  });
});
