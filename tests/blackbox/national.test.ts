import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seasonFromCfbd, seasonOutlook, simulateNational, simulateSeason, type CfbdSnapshot, type NationalSeason, type Season } from "@/core";

// Every FBS game of 2026 through week 9 (the season the first committee ranking saw), from fixtures/cfp-2026.json.
const national = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const POWER = ["ACC", "Big 12", "SEC", "Big Ten"];
const N = 400;
const run = (season: Season, extra: { locks?: Record<number, number>; seed?: number; conferences?: string[] } = {}) =>
  simulateNational(season, { iterations: N, seed: extra.seed ?? 7, locks: extra.locks, conferences: extra.conferences ?? POWER });
const byName = (season: Season, name: string) => season.teams.find((t) => t.name === name)!.id;

type Snap = { titles: (readonly [number, number])[]; champs: number[]; ranking: number[]; field: number[] | null; playoffChampion: number | null };
const seasons = (r: ReturnType<typeof run>, conferences = POWER): Snap[] => {
  const out: Snap[] = [];
  r.forEachIteration((_, s: NationalSeason) => {
    out.push({
      titles: conferences.map((c) => s.titleGame(c)), champs: conferences.map((c) => s.champion(c)), ranking: [...s.ranking],
      field: s.field && [...s.field], playoffChampion: s.playoffChampion,
    });
  });
  return out;
};

describe("national simulation: conference title games", () => {
  const result = run(national);
  const all = seasons(result);

  it("every simulated conference sends two of its members, and one of them is champion", () => {
    const conf = new Map(national.teams.map((t) => [t.id, t.conference]));
    for (const s of all) {
      POWER.forEach((c, k) => {
        const [a, b] = s.titles[k];
        expect(a).not.toBe(b);
        expect([conf.get(a), conf.get(b)]).toEqual([c, c]);
        expect([a, b]).toContain(s.champs[k]);
      });
    }
  });

  it("title-game shares add up to two teams and one champion per conference", () => {
    for (const c of POWER) {
      const members = result.teams.filter((t) => t.conference === c);
      expect(members.reduce((s, t) => s + t.titleGame!, 0)).toBeCloseTo(2, 9);
      expect(members.reduce((s, t) => s + t.champion!, 0)).toBeCloseTo(1, 9);
    }
  });

  it("plays the same title games as each conference's own outlook", () => {
    const sim = simulateSeason(national, { iterations: N, seed: 7 });
    const nat = simulateNational(national, { iterations: N, seed: 7, conferences: POWER }, sim);
    for (const c of ["ACC", "SEC"]) {
      const outlook = seasonOutlook(national, { conference: c, iterations: N, seed: 7 }, sim).teams;
      for (const o of outlook) {
        const t = nat.teams.find((x) => x.teamId === o.teamId)!;
        expect(t.titleGame).toBe(o.titleGame);
        expect(t.champion).toBe(o.champion);
      }
    }
  }, 30_000);

  it("teams in conferences it doesn't simulate have no title-game odds", () => {
    const g6 = result.teams.filter((t) => t.conference === "Sun Belt" || t.conference === null);
    expect(g6.length).toBeGreaterThan(5);
    for (const t of g6) {
      expect(t.titleGame).toBeNull();
      expect(t.champion).toBeNull();
    }
  });

  it("asking for a title game it didn't simulate is an error", () => {
    expect(() => result.forEachIteration((_, s) => s.titleGame("Sun Belt"))).toThrow("Sun Belt's title game isn't simulated");
  });

  it("a conference without tiebreak rules can't be simulated", () => {
    // Every FBS conference has rules in 2026, so the Sun Belt's teams stand in for a made-up one without.
    const gulf = { ...national, teams: national.teams.map((t) => (t.conference === "Sun Belt" ? { ...t, conference: "Gulf South" } : t)) };
    expect(() => run(gulf, { conferences: ["Gulf South"] })).toThrow("No tiebreak rules for Gulf South in 2026");
  });

  it("a title game already in the data decides the champion", () => {
    // The real 2025 SEC season, title game included (Georgia beat Alabama), under the 2026 rules.
    const sec = seasonFromCfbd({ ...(JSON.parse(readFileSync("fixtures/sec-2025.json", "utf8")) as CfbdSnapshot), year: 2026 });
    const r = run(sec, { conferences: ["SEC"] });
    expect(r.teams.find((t) => t.teamId === byName(sec, "Georgia"))!.champion).toBe(1);
    expect(r.teams.find((t) => t.teamId === byName(sec, "Alabama"))!.titleGame).toBe(1);
    expect(r.teams.find((t) => t.teamId === byName(sec, "Alabama"))!.champion).toBe(0);
  });
});

describe("national simulation: committee stand-in ranking", () => {
  const result = run(national);
  const all = seasons(result);
  const fbs = national.teams.filter((t) => t.classification === "fbs").map((t) => t.id).sort((a, b) => a - b);

  it("ranks every FBS team exactly once in every season", () => {
    for (const s of all) expect([...s.ranking].sort((a, b) => a - b)).toEqual(fbs);
  });

  it("its shares agree with the seasons it replays", () => {
    const miami = byName(national, "Miami");
    const top12 = all.filter((s) => s.ranking.indexOf(miami) < 12).length / N;
    const mean = all.reduce((sum, s) => sum + s.ranking.indexOf(miami) + 1, 0) / N;
    const t = result.teams.find((x) => x.teamId === miami)!;
    expect(t.top12).toBeCloseTo(top12, 12);
    expect(t.meanRank).toBeCloseTo(mean, 9);
    expect(t.top4).toBeLessThanOrEqual(t.top12);
    expect(t.top12).toBeLessThanOrEqual(t.top25);
  });

  it("lists teams by mean rank, and the committee's first-ranked team of 2026 leads", () => {
    for (let k = 1; k < result.teams.length; k++) expect(result.teams[k - 1].meanRank).toBeLessThanOrEqual(result.teams[k].meanRank);
    expect(result.teams[0].teamId).toBe(byName(national, "Miami"));
  });

  it("is deterministic for a seed and changes with it", () => {
    expect(seasons(run(national))).toEqual(all);
    expect(seasons(run(national, { seed: 8 }))).not.toEqual(all);
  });

  it("a lock changes only its own game: seasons that already went that way are unchanged", () => {
    const game = national.games.find((g) => !g.completed && g.conferenceGame && national.teams.find((t) => t.id === g.homeId)!.conference === "SEC")!;
    const sim = simulateSeason(national, { iterations: N, seed: 7 });
    const homeWon: boolean[] = [];
    const gi = national.games.indexOf(game);
    sim.forEachIteration((_, winnerAt) => homeWon.push(winnerAt(gi) === game.homeId));
    const locked = seasons(run(national, { locks: { [game.id]: game.homeId } }));
    let same = 0;
    all.forEach((s, k) => {
      if (!homeWon[k]) return;
      expect(locked[k]).toEqual(s);
      same++;
    });
    expect(same).toBeGreaterThan(0);
    expect(same).toBeLessThan(N);
  });

  it("a locked upset loss drops the loser in the ranking", () => {
    const miami = byName(national, "Miami");
    const game = national.games.find((g) => !g.completed && (g.homeId === miami || g.awayId === miami))!;
    const other = game.homeId === miami ? game.awayId : game.homeId;
    const lost = run(national, { locks: { [game.id]: other } }).teams.find((t) => t.teamId === miami)!;
    const base = result.teams.find((t) => t.teamId === miami)!;
    expect(lost.meanRank).toBeGreaterThan(base.meanRank);
    expect(lost.top4).toBeLessThan(base.top4);
  });

  it("winning a power-conference title helps a team's place", () => {
    // Champions get the stand-in's champion weight and an extra win; losers an extra loss.
    const miami = byName(national, "Miami");
    let champ = 0;
    let champRank = 0;
    let other = 0;
    let otherRank = 0;
    for (const s of all) {
      const at = s.ranking.indexOf(miami) + 1;
      if (s.champs[0] === miami) { champ++; champRank += at; }
      else { other++; otherRank += at; }
    }
    expect(champ).toBeGreaterThan(0);
    expect(other).toBeGreaterThan(0);
    expect(champRank / champ).toBeLessThan(otherRank / other);
  });
});
