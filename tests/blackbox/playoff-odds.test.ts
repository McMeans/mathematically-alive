import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explore, mustWinConference, playoffDetail, seasonFromCfbd, seasonOutlook, simulateNational, type CfbdSnapshot, type Season } from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json: a season the national simulation can run.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const POWER = ["ACC", "Big 12", "SEC", "Big Ten"];
const N = 300;
const SEED = 11;
const id = (name: string) => season.teams.find((t) => t.name === name)!.id;
const unplayed = (teamId: number) => season.games.filter((g) => !g.completed && (g.homeId === teamId || g.awayId === teamId));
const opponent = (g: Season["games"][number], teamId: number) => (g.homeId === teamId ? g.awayId : g.homeId);
const outlook = (conference: string, extra: { teamId?: number; locks?: Record<number, number> } = {}) =>
  seasonOutlook(season, { conference, iterations: N, seed: SEED, ...extra });
const national = (extra: { teamId?: number; locks?: Record<number, number>; reuse?: ReturnType<typeof simulateNational> } = {}) =>
  simulateNational(season, { iterations: N, seed: SEED, conferences: POWER, ...extra });

describe("team page playoff odds from the national simulation", () => {
  const georgia = id("Georgia");
  const sec = outlook("SEC", { teamId: georgia });
  const base = national();

  it("a power conference's playoff odds are the national run's field shares", () => {
    const field = new Map(base.teams.map((t) => [t.teamId, t.playoff!]));
    for (const t of sec.teams) {
      expect(t.playoff).toBe(field.get(t.teamId)!.field);
      expect(t.cfp).toEqual(field.get(t.teamId));
    }
    expect(sec.national).not.toBeNull();
  });

  it("title-game and champion odds match the national run's", () => {
    const nt = new Map(base.teams.map((t) => [t.teamId, t]));
    for (const t of sec.teams) {
      expect(t.titleGame).toBe(nt.get(t.teamId)!.titleGame);
      expect(t.champion).toBe(nt.get(t.teamId)!.champion);
    }
  });

  it("at-large odds never exceed the playoff odds, and in-field odds cover the champion's auto bid", () => {
    for (const t of sec.teams) {
      expect(t.atLarge).toBeLessThanOrEqual(t.playoff + 1e-12);
      // Under the 2026 format the power champion is always in, so the field odds are at least the title odds.
      expect(t.playoff).toBeGreaterThanOrEqual(t.champion - 1e-12);
      expect(t.playoff).toBeCloseTo(t.champion + t.atLarge, 10);
    }
  });

  it("each Win/Lose playoff column is exactly what locking that result shows", () => {
    const me = sec.teams.find((t) => t.teamId === georgia)!;
    expect(me.games.length).toBe(unplayed(georgia).length);
    for (const g of unplayed(georgia).slice(0, 2)) {
      const odds = me.games.find((x) => x.gameId === g.id)!;
      const win = outlook("SEC", { locks: { [g.id]: georgia } }).teams.find((t) => t.teamId === georgia)!;
      const lose = outlook("SEC", { locks: { [g.id]: opponent(g, georgia) } }).teams.find((t) => t.teamId === georgia)!;
      expect([odds.playoffIfWin, odds.playoffIfLose, odds.titleIfWin, odds.titleIfLose]).toEqual([win.playoff, lose.playoff, win.titleGame, lose.titleGame]);
    }
  });

  it("a non-conference game against another power team keeps the pairing too", () => {
    const team = season.teams.find((t) => POWER.includes(t.conference ?? "") && unplayed(t.id).some((g) => {
      const o = season.teams.find((x) => x.id === opponent(g, t.id))!;
      return o.conference !== t.conference && POWER.includes(o.conference ?? "");
    }))!;
    const g = unplayed(team.id).find((x) => {
      const o = season.teams.find((t) => t.id === opponent(x, team.id))!;
      return o.conference !== team.conference && POWER.includes(o.conference ?? "");
    })!;
    const r = national({ teamId: team.id });
    const odds = r.games.find((x) => x.gameId === g.id)!;
    const share = (locks: Record<number, number>) => national({ locks }).teams.find((t) => t.teamId === team.id)!;
    const win = share({ [g.id]: team.id });
    const lose = share({ [g.id]: opponent(g, team.id) });
    expect([odds.fieldIfWin, odds.fieldIfLose, odds.titleIfWin, odds.titleIfLose]).toEqual([win.playoff!.field, lose.playoff!.field, win.titleGame, lose.titleGame]);
  });

  it("a win lifts a contender's playoff odds over a loss", () => {
    const me = sec.teams.find((t) => t.teamId === georgia)!;
    expect(me.games.some((g) => g.playoffIfWin > g.playoffIfLose)).toBe(true);
    for (const g of me.games) expect(g.playoffIfWin).toBeGreaterThanOrEqual(g.playoffIfLose);
  });

  it("a team that only gets in as champion must win its conference", () => {
    const all = POWER.flatMap((c) => outlook(c).teams);
    const longShot = all.find((t) => t.playoff > 0 && t.atLarge === 0);
    expect(longShot).toBeDefined();
    expect(mustWinConference(longShot!)).toBe(true);
    const contender = all.find((t) => t.atLarge > 0)!;
    expect(mustWinConference(contender)).toBe(false);
  });

  it("shows the bye and national-title odds for a team that can make the field", () => {
    const me = sec.teams.find((t) => t.teamId === georgia)!;
    const rows = playoffDetail(me);
    expect(rows.map((r) => r.label)).toEqual(["First-round bye", "National title"]);
    expect(rows[0].value).toMatch(/%$/);
  });

  it("shows no detail for a team that never makes the field", () => {
    const out = POWER.flatMap((c) => outlook(c).teams).find((t) => t.playoff === 0)!;
    expect(playoffDetail(out)).toEqual([]);
  });

  it("explore hands back the national run for the next what-if", () => {
    const r = explore(season, { conference: "SEC", teamId: georgia, iterations: 50, seed: SEED });
    expect(r.national).not.toBeNull();
    expect(r.national!.iterations).toBe(50);
  });
});

describe("reusing an earlier national run", () => {
  const georgia = id("Georgia");
  const [g1, g2] = unplayed(georgia);

  it("gives the same odds as a fresh run, whatever locks either run had", () => {
    const earlier = national({ locks: { [g1.id]: opponent(g1, georgia) } });
    const locks = { [g1.id]: georgia, [g2.id]: georgia };
    const fresh = national({ locks, teamId: georgia });
    const reused = national({ locks, teamId: georgia, reuse: earlier });
    expect(reused.teams).toEqual(fresh.teams);
    expect(reused.games).toEqual(fresh.games);
  });

  it("ignores a run of another seed", () => {
    const other = simulateNational(season, { iterations: N, seed: SEED + 1, conferences: POWER });
    expect(national({ reuse: other }).teams).toEqual(base().teams);
  });

  it("works with a run that simulated the conferences in another order", () => {
    const other = simulateNational(season, { iterations: N, seed: SEED, conferences: [...POWER].reverse() });
    expect(national({ reuse: other }).teams).toEqual(base().teams);
  });

    expect(national({ reuse: earlier }).teams).toEqual(base().teams);
  });
});

const base = () => national();

describe("seasons the national simulation can't run", () => {
  it("fall back to the rough estimate, with no national detail", () => {
    // A season with only one power conference: the 2026 field needs every power champion.
    const acc = season.teams.filter((t) => t.conference === "ACC");
    const ids = new Set(acc.map((t) => t.id));
    const small: Season = { ...season, teams: acc, games: season.games.filter((g) => ids.has(g.homeId) && ids.has(g.awayId)) };
    const o = seasonOutlook(small, { conference: "ACC", iterations: 100, seed: SEED });
    expect(o.national).toBeNull();
    for (const t of o.teams) {
      expect(t.cfp).toBeNull();
      expect(playoffDetail(t)).toEqual([]);
    }
  });

  it("asking for what-if columns for a team outside FBS gives none", () => {
    const fcs = season.teams.find((t) => t.classification !== "fbs")!;
    expect(national({ teamId: fcs.id }).games).toEqual([]);
  });
});
