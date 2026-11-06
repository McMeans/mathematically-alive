import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { committeeRanking, seasonFromCfbd, type CfbdSnapshot, type Game, type Season } from "@/core";

// Past committee rankings with the season they ranked (fixtures/cfp-<year>.json, made by pnpm cfp). The stand-in is
// fitted to each season's latest one (pnpm fit-committee): the final ranking for 2014-2025, the first of 2026.
type Fixture = { snapshot: CfbdSnapshot; rankings: { week: number; ranks: { rank: number; teamId: number }[] }[] };
const YEARS = Array.from({ length: 13 }, (_, k) => 2014 + k);
const load = (year: number) => {
  const fx = JSON.parse(readFileSync(`fixtures/cfp-${year}.json`, "utf8")) as Fixture;
  return { season: seasonFromCfbd(fx.snapshot), latest: fx.rankings[fx.rankings.length - 1] };
};
const fixtures = new Map(YEARS.map((y) => [y, load(y)]));
const overlap = (a: number[], b: number[]) => a.filter((x) => b.includes(x)).length;

describe("committee stand-in on past committee rankings", () => {
  const results = YEARS.map((year) => {
    const { season, latest } = fixtures.get(year)!;
    const mine = committeeRanking(season, { throughWeek: latest.week - 1 }).map((r) => r.teamId);
    const theirs = latest.ranks.map((r) => r.teamId);
    return { year, top12: overlap(mine.slice(0, 12), theirs.slice(0, 12)), top4: overlap(mine.slice(0, 4), theirs.slice(0, 4)) };
  });

  it("puts at least 9 of the committee's top 12 in its own top 12, every season", () => {
    for (const r of results) expect(r.top12, String(r.year)).toBeGreaterThanOrEqual(9);
  });

  it("averages at least 10.5 of the committee's top 12", () => {
    expect(results.reduce((s, r) => s + r.top12, 0) / results.length).toBeGreaterThanOrEqual(10.5);
  });

  it("puts at least 3 of the committee's top 4 in its own top 4, every season", () => {
    for (const r of results) expect(r.top4, String(r.year)).toBeGreaterThanOrEqual(3);
  });

  it("ranks every FBS team once, 1 to n", () => {
    const { season } = fixtures.get(2025)!;
    const rows = committeeRanking(season);
    expect(rows.map((r) => r.rank)).toEqual(rows.map((_, k) => k + 1));
    expect(new Set(rows.map((r) => r.teamId)).size).toBe(season.teams.filter((t) => t.classification === "fbs").length);
    for (let k = 1; k < rows.length; k++) expect(rows[k - 1].score).toBeGreaterThanOrEqual(rows[k].score);
  });
});

describe("committee stand-in features", () => {
  const conf = (season: Season, id: number) => season.teams.find((t) => t.id === id)!.conference;

  it("flags the four power-conference title-game winners of 2025 as champions, and no Group of Six champion", () => {
    const { season } = fixtures.get(2025)!;
    const champs = committeeRanking(season).filter((r) => r.champion).map((r) => conf(season, r.teamId)).sort();
    expect(champs).toEqual(["ACC", "Big 12", "Big Ten", "SEC"]);
  });

  it("counts the Pac-12 as a power conference before 2024", () => {
    const { season } = fixtures.get(2023)!;
    const champs = committeeRanking(season).filter((r) => r.champion).map((r) => conf(season, r.teamId)).sort();
    expect(champs).toEqual(["ACC", "Big 12", "Big Ten", "Pac-12", "SEC"]);
  });

  it("finds a title game that shares its week with a postponed home game (Pac-12, 2018: Cal-Stanford)", () => {
    const { season } = fixtures.get(2018)!;
    const champs = committeeRanking(season).filter((r) => r.champion).map((r) => season.teams.find((t) => t.id === r.teamId)!.name).sort();
    expect(champs).toContain("Washington");
    expect(champs).toHaveLength(5);
  });

  it("gives no champion to a power conference without a title game (the Big 12 in 2015)", () => {
    const { season } = fixtures.get(2015)!;
    const champs = committeeRanking(season).filter((r) => r.champion).map((r) => conf(season, r.teamId)).sort();
    expect(champs).toEqual(["ACC", "Big Ten", "Pac-12", "SEC"]);
  });

  it("before the title games are played, nobody is a champion", () => {
    const { season, latest } = fixtures.get(2026)!;
    expect(committeeRanking(season, { throughWeek: latest.week - 1 }).some((r) => r.champion)).toBe(false);
  });

  it("counts only games through the given week", () => {
    const { season } = fixtures.get(2025)!;
    const early = new Map(committeeRanking(season, { throughWeek: 5 }).map((r) => [r.teamId, r]));
    for (const r of committeeRanking(season)) {
      const played = season.games.filter((g) => g.completed && g.week <= 5 && (g.homeId === r.teamId || g.awayId === r.teamId)).length;
      expect(early.get(r.teamId)!.wins + early.get(r.teamId)!.losses).toBe(played);
      expect(r.wins + r.losses).toBeGreaterThanOrEqual(played);
    }
  });

  it("takes the champions it is given", () => {
    const { season } = fixtures.get(2025)!;
    const pick = committeeRanking(season)[40].teamId;
    const rows = committeeRanking(season, { champions: [pick] });
    expect(rows.filter((r) => r.champion).map((r) => r.teamId)).toEqual([pick]);
  });

  // A tiny made-up season: four FBS teams and one FCS team.
  function tiny(): Season {
    const team = (id: number, rating: number | null, classification: "fbs" | "fcs" = "fbs") => ({
      id, name: `T${id}`, abbreviation: null, conference: id === 5 ? null : "Mountain West", classification,
      color: null, altColor: null, rating,
    });
    let gid = 0;
    const game = (home: number, away: number, winner: number, week = 1): Game => ({
      id: gid++, week, start: `2026-09-0${week}T00:00:00Z`, neutralSite: false, conferenceGame: false, homeId: home, awayId: away,
      homePoints: winner === home ? 30 : 10, awayPoints: winner === away ? 30 : 10, completed: true, spread: null,
    });
    return {
      year: 2026, fetchedAt: "",
      teams: [team(1, 10), team(2, 10), team(3, 0), team(4, null), team(5, null, "fcs")],
      games: [game(1, 5, 1), game(2, 3, 2), game(3, 4, 3, 2), game(4, 5, 4, 2)],
    };
  }

  it("rates a missing FBS rating as 0 and an FCS opponent as -10 in strength of schedule", () => {
    const rows = new Map(committeeRanking(tiny()).map((r) => [r.teamId, r]));
    expect(rows.get(4)!.rating).toBe(0);
    expect(rows.get(1)!.strength).toBe(-10);
    expect(rows.get(3)!.strength).toBe(5);
    expect(rows.get(4)!.strength).toBe(-5);
    expect(rows.has(5)).toBe(false);
  });

  it("with the same rating and record, the tougher schedule ranks higher", () => {
    const rows = committeeRanking(tiny()).map((r) => r.teamId);
    expect(rows.indexOf(2)).toBeLessThan(rows.indexOf(1));
  });

  it("a team with no games has a strength of schedule of 0", () => {
    const s = tiny();
    s.teams.push({ ...s.teams[0], id: 9, name: "T9" });
    expect(committeeRanking(s).find((r) => r.teamId === 9)!.strength).toBe(0);
  });
});
