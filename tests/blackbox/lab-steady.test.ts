import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { labHeld, labTeamOdds, seasonFromCfbd, seasonLab, steadyLab, type CfbdSnapshot, type SeasonLab } from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const conferences = ["ACC", "Big 12", "SEC", "Big Ten"];
const QUICK = 500;
const FULL = 4000;
const run = (iterations: number, games: Record<number, number> = {}, reuse?: SeasonLab) =>
  seasonLab(season, { iterations, seed: 7, conferences, locks: { games }, reuse: reuse?.national });

// What the page shows before the pick (a full run), the quick runs either side of it, and the full run after.
const shown = run(FULL);
const quickBefore = run(QUICK);
const big = season.games.find((g) => g.id === shown.bigGames[0].gameId)!;
const underdog = shown.national.swings.find((s) => s.gameId === big.id)!.home >= 0.5 ? big.awayId : big.homeId;
const favourite = underdog === big.homeId ? big.awayId : big.homeId;
const pick = { [big.id]: underdog };
const quick = run(QUICK, pick, quickBefore);
const full = run(FULL, pick, shown);
const held = labHeld(quickBefore, quick);
const steady = steadyLab(shown, quick, held);
const field = (l: SeasonLab, id: number) => l.national.teams.find((t) => t.teamId === id)!.playoff!.field;

describe("season lab: a quick run doesn't bounce numbers the full run would move back", () => {
  it("an upset holds the playoff odds of teams it barely touches, not the teams it moves", () => {
    expect(held.field).not.toContain(favourite);
    expect(held.field).not.toContain(underdog);
    expect(held.field.length).toBeGreaterThan(50);
    for (const id of held.field) expect(Math.abs(field(quickBefore, id) - field(quick, id))).toBeLessThan(0.02);
  });

  it("an in-conference upset moves the title odds of the two teams in it", () => {
    if (big.conferenceGame) {
      expect(held.titles).not.toContain(favourite);
      expect(held.titles).not.toContain(underdog);
    }
    expect(held.titles.length).toBeGreaterThan(20);
    expect(held.ranks.length).toBeGreaterThan(20);
  });

  it("no picks changed holds everything", () => {
    const same = labHeld(quickBefore, run(QUICK, {}, quickBefore));
    const all = quickBefore.national.teams.length;
    expect([same.field.length, same.titles.length, same.ranks.length]).toEqual([all, all, all]);
  });

  it("a held team keeps the odds shown before the pick; a moved team shows the quick run's", () => {
    for (const id of held.field) if (shown.fieldTexts[id] !== undefined && quick.fieldTexts[id] !== undefined) expect(steady.fieldTexts[id]).toBe(shown.fieldTexts[id]);
    expect(steady.fieldTexts[favourite]).toBe(quick.fieldTexts[favourite]);
    expect(steady.fieldTexts[favourite]).not.toBe(shown.fieldTexts[favourite]);
  });

  it("fewer field odds flip back and forth through the quick run with held teams kept", () => {
    // A bounce: the shown text changes in the quick run, then the full run changes it again.
    const bounces = (mid: SeasonLab | typeof steady) =>
      Object.keys(full.fieldTexts).filter((id) => {
        const k = Number(id);
        return shown.fieldTexts[k] !== mid.fieldTexts[k] && mid.fieldTexts[k] !== full.fieldTexts[k];
      }).length;
    expect(bounces(quick)).toBeGreaterThan(0);
    expect(bounces(steady)).toBeLessThan(bounces(quick) / 2);
  });

  it("conference races and the ranking stay in order of the odds shown", () => {
    for (const c of steady.conferences) {
      for (let k = 1; k < c.teams.length; k++) expect(c.teams[k - 1].titleGame).toBeGreaterThanOrEqual(c.teams[k].titleGame);
    }
    steady.ranking.forEach((r, k) => {
      expect(r.rank).toBe(k + 1);
      if (k > 0) expect(steady.ranking[k - 1].meanRank).toBeLessThanOrEqual(r.meanRank);
    });
  });

  it("a playoff spot keeps its shown odds only with the same held team at the same seed", () => {
    steady.playoff!.field.forEach((s, k) => {
      const was = shown.playoff!.field[k];
      if (held.field.includes(s.teamId) && was.teamId === s.teamId) expect(s.text).toBe(was.text);
      else expect(s).toEqual(quick.playoff!.field[k]);
    });
  });

  it("a pinned team keeps its shown odds when held, and shows the quick run's when the pick moved it", () => {
    const pinned = held.field.find((id) => held.titles.includes(id) && labTeamOdds(season, shown, id)?.titleGame !== null)!;
    const keep = steadyLab({ ...shown, focus: labTeamOdds(season, shown, pinned) }, { ...quick, focus: labTeamOdds(season, quick, pinned) }, held);
    expect(keep.focus).toEqual(labTeamOdds(season, shown, pinned));
    const moved = steadyLab({ ...shown, focus: labTeamOdds(season, shown, favourite) }, { ...quick, focus: labTeamOdds(season, quick, favourite) }, held);
    expect(moved.focus!.playoffText).toBe(labTeamOdds(season, quick, favourite)!.playoffText);
    // Held playoff odds with moved title odds: each part on its own.
    const mixed = held.field.find((id) => !held.titles.includes(id) && labTeamOdds(season, shown, id)?.titleGame !== null);
    if (mixed !== undefined) {
      const m = steadyLab({ ...shown, focus: labTeamOdds(season, shown, mixed) }, { ...quick, focus: labTeamOdds(season, quick, mixed) }, held);
      expect(m.focus!.playoffText).toBe(labTeamOdds(season, shown, mixed)!.playoffText);
      expect(m.focus!.titleGameText).toBe(labTeamOdds(season, quick, mixed)!.titleGameText);
    }
  });

  it("a held race entry keeps its shown odds, and a held ranking entry its average rank", () => {
    for (const c of steady.conferences) {
      const was = shown.conferences.find((x) => x.conference === c.conference)!;
      for (const t of c.teams) {
        const before = was.teams.find((x) => x.teamId === t.teamId);
        if (held.titles.includes(t.teamId) && before) expect(t.text).toBe(before.text);
      }
    }
    for (const r of steady.ranking) {
      const before = shown.ranking.find((x) => x.teamId === r.teamId);
      if (held.ranks.includes(r.teamId) && before) expect(r.text).toBe(before.text);
      else expect(r.text).toBe(quick.ranking.find((x) => x.teamId === r.teamId)!.text);
    }
  });

  it("picks, records and the summary are the quick run's", () => {
    expect(steady.picks).toBe(1);
    expect(steady.summary).toBe(quick.summary);
    expect(steady.records).toEqual(quick.records);
  });
});
