import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seasonFromCfbd, seasonLab, type CfbdSnapshot } from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const base = { iterations: 300, seed: 11, conferences: ["ACC", "Big 12", "SEC", "Big Ten"] };
const free = seasonLab(season, base);
const SHOWN = /^(\d+(\.\d)?%|<0\.1%|>99%)$/;

describe("season lab: odds worded for display", { timeout: 60_000 }, () => {
  it("never shows a flat 0% or 100% for a team's playoff chance", () => {
    const texts = Object.values(free.fieldTexts);
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).toMatch(SHOWN);
    expect(texts).not.toContain("100%");
    expect(texts).not.toContain("0%");
  });

  it("words a team's title-game and title chances in the title race the same way", () => {
    for (const c of free.conferences) {
      for (const t of c.teams) {
        expect(t.titleGameText).toMatch(SHOWN);
        expect(t.championText).toMatch(SHOWN);
        expect(t.text).toBe(`Title game ${t.titleGameText} · champion ${t.championText}`);
      }
    }
  });
});

describe("season lab: opening a link with picks", { timeout: 60_000 }, () => {
  it("says how many picks loaded", () => {
    const games = season.games.filter((g) => !g.completed && !g.titleGame);
    const one = seasonLab(season, { ...base, locks: { games: { [games[0].id]: games[0].homeId } } });
    const two = seasonLab(season, { ...base, locks: { games: { [games[0].id]: games[0].homeId, [games[1].id]: games[1].homeId } } });
    expect(one.loaded).toBe("1 pick loaded.");
    expect(two.loaded).toBe("2 picks loaded.");
  });
});
