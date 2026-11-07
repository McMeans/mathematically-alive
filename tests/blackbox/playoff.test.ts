import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { committeeRanking, playoffField, playoffFormat, seasonFromCfbd, simulateNational, type CfbdSnapshot, type Season } from "@/core";

type Fixture = { snapshot: CfbdSnapshot; rankings: { week: number; ranks: { rank: number; teamId: number }[] }[] };
const load = (year: number) => {
  const fx = JSON.parse(readFileSync(`fixtures/cfp-${year}.json`, "utf8")) as Fixture;
  const season = seasonFromCfbd(fx.snapshot);
  const latest = fx.rankings[fx.rankings.length - 1];
  // The committee's final ranking, then everyone else in the stand-in's order.
  const top = latest.ranks.map((r) => r.teamId);
  const rest = committeeRanking(season, { throughWeek: latest.week - 1 }).map((r) => r.teamId).filter((id) => !top.includes(id));
  return { season, ranking: [...top, ...rest] };
};
const ids = (season: Season, names: string[]) => names.map((n) => {
  const t = season.teams.find((x) => x.name === n);
  if (!t) throw new Error(n);
  return t.id;
});
const names = (season: Season, list: readonly number[]) => list.map((id) => season.teams.find((t) => t.id === id)!.name);

describe("playoff formats", () => {
  it("every season from 2014 to 2026 has a cited format, and other seasons are an error", () => {
    for (let y = 2014; y <= 2026; y++) expect(playoffFormat(y).source.length).toBeGreaterThan(20);
    expect(playoffFormat(2023).teams).toBe(4);
    expect(playoffFormat(2026).teams).toBe(12);
    expect(() => playoffFormat(2013)).toThrow("No playoff format for 2013");
    expect(() => playoffFormat(2027)).toThrow("No playoff format for 2027");
  });
});

describe("playoff field from a ranking", () => {
  it("four-team seasons take the top four by ranking (2023)", () => {
    const { season, ranking } = load(2023);
    expect(names(season, playoffField(season, ranking, []))).toEqual(["Michigan", "Washington", "Texas", "Alabama"]);
  });

  it("reproduces the 2024 field: the four highest-ranked champions get the byes, and Clemson's title bumps Alabama", () => {
    const { season, ranking } = load(2024);
    const champions = ids(season, ["Oregon", "Georgia", "Boise State", "Arizona State", "Clemson"]);
    expect(names(season, playoffField(season, ranking, champions))).toEqual([
      "Oregon", "Georgia", "Boise State", "Arizona State", "Texas", "Penn State",
      "Notre Dame", "Ohio State", "Tennessee", "Indiana", "SMU", "Clemson",
    ]);
  });

  it("reproduces the 2025 field: straight seeding, and ranked champions in place of Notre Dame and BYU", () => {
    const { season, ranking } = load(2025);
    const champions = ids(season, ["Indiana", "Georgia", "Texas Tech", "Duke", "Tulane", "James Madison"]);
    expect(names(season, playoffField(season, ranking, champions))).toEqual([
      "Indiana", "Ohio State", "Georgia", "Texas Tech", "Oregon", "Ole Miss",
      "Texas A&M", "Oklahoma", "Alabama", "Miami", "Tulane", "James Madison",
    ]);
  });

  describe("2026: the power champions, the top Group of Six team and Notre Dame in the top 12", () => {
    const { season, ranking: base } = load(2026);
    const conf = new Map(season.teams.map((t) => [t.id, t.conference]));
    const nd = ids(season, ["Notre Dame"])[0];
    const power = ["ACC", "Big 12", "Big Ten", "SEC"];
    const g6 = base.filter((id) => !power.includes(conf.get(id)!) && conf.get(id) !== "FBS Independents");
    // Champions from deep in the ranking, one per power conference.
    const champions = power.map((c) => base.filter((id) => conf.get(id) === c)[8]);
    const others = base.filter((id) => id !== nd && !champions.includes(id) && !g6.includes(id));
    // Notre Dame at `ndAt` (1-based), then the champions and the top Group of Six team (not a champion) at 20-24.
    const ranked = (ndAt: number) => {
      const r = others.slice(0, 19);
      r.splice(ndAt - 1, 0, nd);
      return [...r.slice(0, 19), ...champions, g6[0], ...r.slice(19), ...others.slice(19), ...g6.slice(1)];
    };

    it("power champions and the top Group of Six team get in wherever they rank, seeded by ranking", () => {
      const r = ranked(1);
      const field = playoffField(season, r, champions);
      expect(field).toHaveLength(12);
      for (const id of [...champions, g6[0]]) expect(field).toContain(id);
      expect(field.slice(7)).toEqual([...champions, g6[0]]);
      expect(field.slice(0, 7)).toEqual(r.slice(0, 7));
    });

    it("Notre Dame ranked 12th gets in ahead of better-ranked teams; 13th, it doesn't", () => {
      const at12 = playoffField(season, ranked(12), champions);
      expect(at12).toContain(nd);
      expect(at12).not.toContain(ranked(12)[6]);
      expect(playoffField(season, ranked(13), champions)).not.toContain(nd);
    });

    it("the Group of Six bid needs no conference title", () => {
      const field = playoffField(season, ranked(1), champions);
      expect(field).toContain(g6[0]);
      expect(field).not.toContain(g6[1]);
    });
  });
});

describe("national simulation: playoff field and bracket", () => {
  const national = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as Fixture).snapshot);
  const POWER = ["ACC", "Big 12", "SEC", "Big Ten"];
  const N = 400;
  const result = simulateNational(national, { iterations: N, seed: 7, conferences: POWER });
  const conf = new Map(national.teams.map((t) => [t.id, t.conference]));

  it("every season's field holds every power champion and the top Group of Six team, seeded in ranking order", () => {
    let seasons = 0;
    result.forEachIteration((_, s) => {
      seasons++;
      const field = s.field!;
      expect(new Set(field).size).toBe(12);
      for (const c of POWER) expect(field).toContain(s.champion(c));
      const topG6 = s.ranking.find((id) => !["ACC", "Big 12", "SEC", "Big Ten", "FBS Independents"].includes(conf.get(id)!));
      expect(field).toContain(topG6);
      const at = field.map((id) => s.ranking.indexOf(id));
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      expect(field).toContain(s.playoffChampion);
    });
    expect(seasons).toBe(N);
  });

  it("round shares add up to the field: 12 in, 4 byes, 8 quarterfinalists, 4 semifinalists, 2 finalists, 1 champion", () => {
    expect(result.playoff).toBe(true);
    const sum = (f: "field" | "bye" | "quarterfinal" | "semifinal" | "final" | "champion") =>
      result.teams.reduce((s, t) => s + (t.playoff![f] ?? 0), 0);
    expect(sum("field")).toBeCloseTo(12, 9);
    expect(sum("bye")).toBeCloseTo(4, 9);
    expect(sum("quarterfinal")).toBeCloseTo(8, 9);
    expect(sum("semifinal")).toBeCloseTo(4, 9);
    expect(sum("final")).toBeCloseTo(2, 9);
    expect(sum("champion")).toBeCloseTo(1, 9);
    for (const t of result.teams) {
      const p = t.playoff!;
      expect(p.seeds.reduce((a, b) => a + b, 0)).toBeCloseTo(p.field, 12);
      expect(p.bye).toBeLessThanOrEqual(p.quarterfinal!);
      expect(p.quarterfinal!).toBeLessThanOrEqual(p.field);
      expect(p.champion).toBeLessThanOrEqual(p.final);
      expect(p.final).toBeLessThanOrEqual(p.semifinal);
    }
  });

  it("its shares agree with the seasons it replays", () => {
    const counts = new Map<number, { field: number; title: number }>();
    result.forEachIteration((_, s) => {
      for (const id of s.field!) counts.set(id, { field: (counts.get(id)?.field ?? 0) + 1, title: counts.get(id)?.title ?? 0 });
      const c = counts.get(s.playoffChampion!)!;
      c.title++;
    });
    for (const t of result.teams) {
      expect(t.playoff!.field).toBeCloseTo((counts.get(t.teamId)?.field ?? 0) / N, 12);
      expect(t.playoff!.champion).toBeCloseTo((counts.get(t.teamId)?.title ?? 0) / N, 12);
    }
  });

  it("a locked upset in a contender's game lowers its playoff and bye odds", () => {
    const miami = national.teams.find((t) => t.name === "Miami")!.id;
    const game = national.games.find((g) => !g.completed && (g.homeId === miami || g.awayId === miami))!;
    const other = game.homeId === miami ? game.awayId : game.homeId;
    const lost = simulateNational(national, { iterations: N, seed: 7, conferences: POWER, locks: { [game.id]: other } });
    const before = result.teams.find((t) => t.teamId === miami)!.playoff!;
    const after = lost.teams.find((t) => t.teamId === miami)!.playoff!;
    expect(after.bye).toBeLessThan(before.bye);
    expect(after.field).toBeLessThan(before.field);
  });

  it("without every power conference's title game, the playoff isn't simulated", () => {
    const r = simulateNational(national, { iterations: 50, seed: 7, conferences: ["SEC"] });
    expect(r.playoff).toBe(false);
    expect(r.teams.every((t) => t.playoff === null)).toBe(true);
    r.forEachIteration((_, s) => {
      expect(s.field).toBeNull();
      expect(s.playoffChampion).toBeNull();
    });
  });

  it("a 2024 or 2025 season gets no playoff: its format needs Group of Six champions", () => {
    const { season } = load(2025);
    expect(simulateNational(season, { iterations: 20, seed: 7, conferences: [] }).playoff).toBe(false);
  });

  it("a four-team season plays semifinals and a final from the stand-in's top four", () => {
    const { season } = load(2023);
    const r = simulateNational(season, { iterations: 200, seed: 7, conferences: [] });
    expect(r.playoff).toBe(true);
    r.forEachIteration((_, s) => {
      expect(s.field).toEqual(s.ranking.slice(0, 4));
      expect(s.field).toContain(s.playoffChampion);
    });
    const sum = (f: "field" | "semifinal" | "final" | "champion") => r.teams.reduce((a, t) => a + t.playoff![f], 0);
    expect([sum("field"), sum("semifinal"), sum("final"), sum("champion")].map((x) => Math.round(x * 1e9) / 1e9)).toEqual([4, 4, 2, 1]);
    for (const t of r.teams) {
      expect(t.playoff!.bye).toBe(0);
      expect(t.playoff!.quarterfinal).toBeNull();
    }
  });
});
