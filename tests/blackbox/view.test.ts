import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explore, nationalView, playoffSignals, seasonFromCfbd, simulateNational, simulateSeason, type CfbdSnapshot, type Season } from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const POWER = ["ACC", "Big 12", "SEC", "Big Ten"];
const N = 400;
const sim = simulateSeason(season, { iterations: N, seed: 11 });
const national = simulateNational(season, { iterations: N, seed: 11, conferences: POWER }, sim);
const byName = (s: Season, name: string) => s.teams.find((t) => t.name === name)!.id;

describe("national view", () => {
  const view = nationalView(national)!;

  it("projects a 12-team field of the teams with the best field odds, seeded 1 to 12", () => {
    expect(view.teams).toBe(12);
    expect(view.field.map((s) => s.seed)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const lowestIn = Math.min(...view.field.map((s) => s.field));
    for (const b of view.bubble) expect(b.field).toBeLessThanOrEqual(lowestIn);
    expect(new Set(view.field.map((s) => s.teamId)).size).toBe(12);
  });

  it("each spot says its field and seed odds", () => {
    for (const s of view.field) {
      expect(s.text).toMatch(new RegExp(`^In (\\d+%|>99%|<1%) · seed ${s.seed} in (\\d+%|>99%|<1%)$`));
      expect(s.atSeed).toBeLessThanOrEqual(s.field);
    }
  });

  it("the bubble lists the next six teams, best odds first, none of them in the projected field", () => {
    expect(view.bubble).toHaveLength(6);
    const inField = new Set(view.field.map((s) => s.teamId));
    view.bubble.forEach((b, k) => {
      expect(inField.has(b.teamId)).toBe(false);
      if (k > 0) expect(b.field).toBeLessThanOrEqual(view.bubble[k - 1].field);
      expect(b.text).toMatch(/^In /);
    });
    expect(nationalView(national, { bubble: 3 })!.bubble).toHaveLength(3);
  });

  it("the bracket puts seeds 5-12 in first-round games at the higher seed and byes in neutral quarterfinals", () => {
    const first = view.bracket.filter((g) => g.round === "First round");
    expect(first).toHaveLength(4);
    expect(first[0]).toMatchObject({ a: { seed: 5, teamId: view.field[4].teamId }, b: { seed: 12 }, site: "At the higher seed" });
    const quarters = view.bracket.filter((g) => g.round === "Quarterfinal");
    expect(quarters[0]).toMatchObject({ a: { seed: 1 }, b: { winnerOf: 3 }, site: "Neutral site" });
    expect(view.bracket.at(-1)!.round).toBe("Final");
    expect(view.note).toBe("Projected from 400 simulated seasons. Modelled odds, not a prediction of the committee.");
  });

  it("a four-team season's bracket is two semifinals and a final", () => {
    const old = { ...season, year: 2020 };
    const v = nationalView(simulateNational(old, { iterations: 100, seed: 3, conferences: [] }))!;
    expect(v.teams).toBe(4);
    expect(v.bracket.map((g) => g.round)).toEqual(["Semifinal", "Semifinal", "Final"]);
    expect(v.bracket[0]).toMatchObject({ a: { seed: 1 }, b: { seed: 4 } });
  });

  it("a season with no playoff run has no view", () => {
    const old = { ...season, year: 2024 };
    expect(nationalView(simulateNational(old, { iterations: 50, seed: 3, conferences: [] }))).toBeNull();
  });
});

describe("results elsewhere for the playoff", () => {
  const teamId = byName(season, "Georgia");
  const signals = playoffSignals(season, sim, national, teamId);

  it("never lists the team's own games, and the side it roots for is the one that helps", () => {
    const games = new Map(season.games.map((g) => [g.id, g]));
    for (const s of signals) {
      const g = games.get(s.gameId)!;
      expect(g.completed).toBe(false);
      expect([g.homeId, g.awayId]).not.toContain(teamId);
      const helps = s.rooting === s.homeId ? s.oddsIfHomeWins : s.oddsIfAwayWins;
      expect(helps).toBeGreaterThanOrEqual(Math.min(s.oddsIfHomeWins, s.oddsIfAwayWins));
      expect(s.swing).toBeGreaterThanOrEqual(0.01);
      expect(s.text).toMatch(/^Root for .+ over .+: .+ if .+ wins, .+ if .+ does\.$/);
    }
  });

  it("is sorted by swing and capped", () => {
    for (let k = 1; k < signals.length; k++) expect(signals[k].swing).toBeLessThanOrEqual(signals[k - 1].swing);
    expect(playoffSignals(season, sim, national, teamId, 2).length).toBeLessThanOrEqual(2);
  });

  it("finds at least one game that matters for a bubble team in a big run", () => {
    const big = simulateSeason(season, { iterations: 3000, seed: 5 });
    const nat = simulateNational(season, { iterations: 3000, seed: 5, conferences: POWER }, big);
    const bubbleTeam = nationalView(nat)!.bubble[0].teamId;
    expect(playoffSignals(season, big, nat, bubbleTeam).length).toBeGreaterThan(0);
  }, 60_000);

  it("is empty when the run has no playoff or the simulations don't match", () => {
    const old = { ...season, year: 2024 };
    const oldSim = simulateSeason(old, { iterations: 50, seed: 3 });
    expect(playoffSignals(old, oldSim, simulateNational(old, { iterations: 50, seed: 3, conferences: [] }, oldSim), teamId)).toEqual([]);
    expect(playoffSignals(season, simulateSeason(season, { iterations: 10, seed: 1 }), national, teamId)).toEqual([]);
  });

  it("explore returns the playoff signals for the team alongside its outlook", () => {
    const r = explore(season, { conference: "SEC", teamId, iterations: N, seed: 11 });
    expect(r.playoffGames).toEqual(signals);
  }, 60_000);
});
