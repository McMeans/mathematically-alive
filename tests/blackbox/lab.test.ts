import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeLabLocks, encodeLabLocks, seasonFromCfbd, seasonLab, type CfbdSnapshot, type Season } from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const POWER = ["ACC", "Big 12", "SEC", "Big Ten"];
const base = { iterations: 300, seed: 11, conferences: POWER };
const free = seasonLab(season, base);
const teamOf = (lab: ReturnType<typeof seasonLab>, id: number) => lab.national.teams.find((t) => t.teamId === id)!;
const open = season.games.filter((g) => !g.completed);
const sec = free.conferences.find((c) => c.conference === "SEC")!;
const fieldOdds = (lab: ReturnType<typeof seasonLab>, id: number) => teamOf(lab, id).playoff!.field;

describe("season lab: picks", () => {
  it("with no picks, says so and lists every conference's title race and a top 25", () => {
    expect(free.picks).toBe(0);
    expect(free.summary).toBe("No picks yet · 300 simulated seasons");
    expect(free.conferences.map((c) => c.conference)).toEqual(POWER);
    expect(free.ranking).toHaveLength(25);
    expect(free.ranking[0].rank).toBe(1);
    expect(free.ranking[0].text).toMatch(/^Average rank \d+\.\d · top 12 in /);
    expect(free.playoff?.field).toHaveLength(12);
    expect(sec.name).toBe("SEC");
    expect(sec.picked).toBeNull();
    expect(sec.teams[0].text).toMatch(/^Title game .+% · champion .+%$/);
  });

  it("a locked upset raises the underdog's playoff odds", () => {
    // The game whose home favourite has the best field odds against an away team with some chance.
    const g = open
      .filter((x) => fieldOdds(free, x.homeId) > 0.5 && (teamOf(free, x.awayId)?.playoff?.field ?? 0) > 0)
      .sort((a, b) => fieldOdds(free, b.homeId) - fieldOdds(free, a.homeId))[0];
    const upset = seasonLab(season, { ...base, locks: { games: { [g.id]: g.awayId } }, reuse: free.national });
    expect(fieldOdds(upset, g.awayId)).toBeGreaterThan(fieldOdds(free, g.awayId));
    expect(fieldOdds(upset, g.homeId)).toBeLessThan(fieldOdds(free, g.homeId));
    expect(upset.summary).toBe("1 pick · 300 simulated seasons");
  });

  it("a title-game pick makes that team champion every season it plays in the title game", () => {
    const pick = sec.teams[1].teamId;
    const lab = seasonLab(season, { ...base, locks: { titles: { SEC: pick } }, reuse: free.national });
    const t = teamOf(lab, pick);
    expect(t.champion).toBe(t.titleGame);
    expect(t.champion).toBeGreaterThan(teamOf(free, pick).champion!);
    expect(lab.conferences.find((c) => c.conference === "SEC")!.picked).toBe(pick);
    // The other conferences' races are untouched.
    for (const c of ["ACC", "Big 12", "Big Ten"]) expect(lab.conferences.find((x) => x.conference === c)!.teams).toEqual(free.conferences.find((x) => x.conference === c)!.teams);
  });

  it("a title-game pick with a reused run matches the same pick run fresh", () => {
    const pick = sec.teams[0].teamId;
    const reused = seasonLab(season, { ...base, locks: { titles: { SEC: pick } }, reuse: free.national });
    const fresh = seasonLab(season, { ...base, locks: { titles: { SEC: pick } } });
    expect(reused.national.teams).toEqual(fresh.national.teams);
  });

  it("a pick for the national title makes that team champion every season it reaches the final", () => {
    const pick = free.playoff!.field[5].teamId;
    const final = free.playoff!.bracket.length - 1;
    const lab = seasonLab(season, { ...base, locks: { bracket: { [final]: pick } }, reuse: free.national });
    const p = teamOf(lab, pick).playoff!;
    expect(p.champion).toBe(p.final);
    expect(p.champion).toBeGreaterThan(teamOf(free, pick).playoff!.champion);
    // Picking a team that never reaches a game changes nothing.
    const never = free.national.teams.find((t) => t.playoff!.field === 0)!.teamId;
    const none = seasonLab(season, { ...base, locks: { bracket: { [final]: never } } });
    expect(none.national.teams).toEqual(free.national.teams);
  });

  it("refuses a title pick for a team outside the conference, or a bracket game that doesn't exist", () => {
    const mac = season.teams.find((t) => t.conference === "Mid-American")!.id;
    expect(() => seasonLab(season, { ...base, locks: { titles: { SEC: mac } } })).toThrow(/not in SEC/);
    expect(() => seasonLab(season, { ...base, locks: { bracket: { 99: mac } } })).toThrow(/bracket game 99/);
  });
});

describe("season lab: picks it would ignore", () => {
  it("a title pick for a conference that isn't simulated is left out and not counted", () => {
    const mac = season.teams.find((t) => t.conference === "Mid-American")!.id;
    const lab = seasonLab(season, { ...base, locks: { titles: { "Mid-American": mac } }, reuse: free.national });
    expect([lab.picks, lab.summary]).toEqual([0, "No picks yet · 300 simulated seasons"]);
  });

  it("a kind of pick passed as undefined reads as none", () => {
    const lab = seasonLab(season, { ...base, locks: { games: undefined, titles: undefined, bracket: undefined }, reuse: free.national });
    expect(lab.picks).toBe(0);
    expect(decodeLabLocks(season, encodeLabLocks(season, { titles: undefined })).locks).toEqual({ games: {}, titles: {}, bracket: {} });
  });
});

describe("season lab: picks in a link", () => {
  const g1 = open[0];
  const g2 = open[open.length - 1];
  const locks = { games: { [g1.id]: g1.awayId, [g2.id]: g2.homeId }, titles: { SEC: sec.teams[0].teamId }, bracket: { 10: free.playoff!.field[0].teamId } };

  it("round-trips every kind of pick through a short URL-safe string", () => {
    const text = encodeLabLocks(season, locks);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(text.length).toBeLessThan(40);
    expect(decodeLabLocks(season, text)).toEqual({ locks, settled: 0, dropped: 0, note: "" });
  });

  it("no picks round-trip to no picks, and an empty string reads as none", () => {
    expect(decodeLabLocks(season, encodeLabLocks(season, {})).locks).toEqual({ games: {}, titles: {}, bracket: {} });
    expect(decodeLabLocks(season, "")).toEqual({ locks: { games: {}, titles: {}, bracket: {} }, settled: 0, dropped: 0, note: "" });
  });

  it("a pick on a game that has since gone final is dropped and reported", () => {
    const text = encodeLabLocks(season, { games: { [g1.id]: g1.homeId, [g2.id]: g2.awayId } });
    const later: Season = { ...season, games: season.games.map((g) => (g.id === g1.id ? { ...g, completed: true, homePoints: 10, awayPoints: 7 } : g)) };
    const out = decodeLabLocks(later, text);
    expect(out.locks.games).toEqual({ [g2.id]: g2.awayId });
    expect(out.settled).toBe(1);
    expect(out.note).toBe("1 pick was settled by real results.");
  });

  it("picks that no longer fit the season are left out, and garbage never throws", () => {
    const text = encodeLabLocks(season, locks);
    const smaller: Season = { ...season, games: season.games.filter((g) => g.id !== g1.id) };
    const out = decodeLabLocks(smaller, text);
    expect(out.dropped).toBe(1);
    expect(out.locks.games).toEqual({ [g2.id]: g2.homeId });
    expect(out.note).toBe("1 pick no longer fits the season and was left out.");
    for (const junk of ["!!!!", "A", "AQ", "Ag", "_____w", text + "AA"]) expect(() => decodeLabLocks(season, junk)).not.toThrow();
    expect(decodeLabLocks(season, "!!!!").dropped).toBe(1);
    expect(decodeLabLocks(season, "Ag").dropped).toBe(1); // version 2
    expect(decodeLabLocks(season, text.slice(0, 4)).dropped).toBe(1); // cut off
  });

  it("a title pick for a conference with no title game is left out", () => {
    const ind = season.teams.find((t) => t.conference === "FBS Independents");
    expect(ind).toBeDefined();
    const out = decodeLabLocks(season, encodeLabLocks(season, { titles: { "FBS Independents": ind!.id } }));
    expect(out.locks.titles).toEqual({});
    expect(out.dropped).toBe(1);
  });

  it("refuses to encode a pick for a game or team the season doesn't have", () => {
    expect(() => encodeLabLocks(season, { games: { 1: 2 } })).toThrow(/unknown game 1/);
    expect(() => encodeLabLocks(season, { games: { [g1.id]: -5 } })).toThrow(/not in game/);
    expect(() => encodeLabLocks(season, { titles: { Nowhere: 1 } })).toThrow(/isn't a conference/);
    expect(() => encodeLabLocks(season, { titles: { SEC: -5 } })).toThrow(/team -5 is not in SEC/);
    expect(() => encodeLabLocks(season, { bracket: { 99: g1.homeId } })).toThrow(/bracket game 99/);
    expect(() => encodeLabLocks(season, { bracket: { 0: -5 } })).toThrow(/team -5 isn't in the season/);
  });
});
