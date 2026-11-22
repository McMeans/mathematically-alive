import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nationalView, seasonFromCfbd, seasonLab, simulateNational, simulateSeason, type CfbdSnapshot, type NationalOptions, type NationalResult } from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const conferences = ["ACC", "Big 12", "SEC", "Big Ten"];
const N = 1200;
const base: NationalOptions = { iterations: N, seed: 5, conferences };
const run = (o: Partial<NationalOptions> = {}) => simulateNational(season, { ...base, ...o });

/** Everything a run shows: its odds, and each simulated season's title games, ranking, field and champion. */
function snapshot(r: NationalResult) {
  const seasons: string[] = [];
  r.forEachIteration((it, s) => {
    seasons.push(`${it}:${conferences.map((c) => `${s.titleGame(c).join("v")}>${s.champion(c)}`).join(",")}|${s.ranking.join()}|${s.field?.join()}|${s.playoffChampion}`);
  });
  return { iterations: r.iterations, teams: r.teams, games: r.games, swings: r.swings, seasons };
}
/** One season of a run, by its number. */
function seasonsOf(r: NationalResult) {
  const out = new Map<number, string>();
  for (const line of snapshot(r).seasons) out.set(Number(line.split(":")[0]), line);
  return out;
}

const none = run();
// The game that swings the field most, its underdog and its favourite.
const swing = [...none.swings].filter((s) => s.home > 0.15 && s.home < 0.85).sort((a, b) => b.spots - a.spots)[0];
const game = season.games.find((g) => g.id === swing.gameId)!;
const underdog = swing.home < 0.5 ? game.homeId : game.awayId;
const favourite = underdog === game.homeId ? game.awayId : game.homeId;
const other = [...none.swings].filter((s) => s.home > 0.15 && s.home < 0.85 && s.gameId !== game.id).sort((a, b) => b.spots - a.spots)[0];
const game2 = season.games.find((g) => g.id === other.gameId)!;
// The SEC team likeliest to play in its title game, and the bracket's first game's lower seed.
const secLead = none.teams.filter((t) => t.conference === "SEC").sort((a, b) => b.titleGame! - a.titleGame!)[0].teamId;
const firstGame = nationalView(none)?.bracket[0];
const lowSeed = firstGame && "teamId" in firstGame.b ? firstGame.b.teamId : null;

describe("national simulation: a later run copies the earlier run's seasons a change doesn't touch", { timeout: 30_000 }, () => {
  const cases: [string, Partial<NationalOptions>, Partial<NationalOptions>][] = [
    ["a new pick", {}, { locks: { [game.id]: underdog } }],
    ["a pick of the favourite", {}, { locks: { [game.id]: favourite } }],
    ["a pick taken back", { locks: { [game.id]: underdog } }, {}],
    ["a pick switched to the other team", { locks: { [game.id]: underdog } }, { locks: { [game.id]: favourite } }],
    ["a second pick", { locks: { [game.id]: underdog } }, { locks: { [game.id]: underdog, [game2.id]: game2.homeId } }],
    ["a title-game pick", {}, { titleLocks: { SEC: secLead } }],
    ["a title-game pick taken back", { titleLocks: { SEC: secLead } }, {}],
    ["a playoff pick", {}, { bracketLocks: { 0: lowSeed! } }],
    ["a pick with a team followed", { teamId: favourite }, { teamId: favourite, locks: { [game2.id]: game2.awayId } }],
    ["a pick, following a team the earlier run didn't", {}, { teamId: favourite, locks: { [game2.id]: game2.awayId } }],
  ];
  for (const [what, before, after] of cases) {
    it(`gives exactly a fresh run's odds and seasons after ${what}`, () => {
      const earlier = run(before);
      expect(snapshot(run({ ...after, reuse: earlier }))).toEqual(snapshot(run(after)));
    });
  }
});

describe("national simulation: an estimate is the earlier run's seasons a change doesn't touch, with nothing simulated", { timeout: 30_000 }, () => {
  it("after a pick, it keeps exactly the seasons the picked team already won, each as the full run plays it", () => {
    const locks = { [game.id]: underdog };
    const estimate = run({ locks, reuse: none, estimate: true });
    // The seasons the underdog won with no picks.
    let won = 0;
    simulateSeason(season, { iterations: N, seed: 5 }).forEachIteration((_, winnerOf) => {
      if (winnerOf(season.games.indexOf(game)) === underdog) won++;
    });
    expect(estimate.iterations).toBe(won);
    expect(won).toBeGreaterThan(0);
    expect(won).toBeLessThan(N);
    const full = seasonsOf(run({ locks }));
    for (const [it, line] of seasonsOf(estimate)) expect(line).toBe(full.get(it));
  });

  it("its odds land near the full run's", () => {
    const locks = { [game.id]: favourite };
    const estimate = run({ locks, reuse: none, estimate: true });
    const full = run({ locks });
    for (const t of full.teams) {
      const e = estimate.teams.find((x) => x.teamId === t.teamId)!;
      expect(Math.abs(e.playoff!.field - t.playoff!.field)).toBeLessThan(0.08);
      if (t.titleGame !== null) expect(Math.abs(e.titleGame! - t.titleGame)).toBeLessThan(0.08);
    }
  });

  for (const [what, before, after] of [
    ["a second pick", { locks: { [game.id]: underdog } }, { locks: { [game.id]: underdog, [game2.id]: game2.homeId } }],
    ["a title-game pick", {}, { titleLocks: { SEC: secLead } }],
    ["a playoff pick", {}, { bracketLocks: { 0: lowSeed! } }],
  ] as [string, Partial<NationalOptions>, Partial<NationalOptions>][]) {
    it(`after ${what}, every season it keeps is one the full run plays the same`, () => {
      const estimate = run({ ...after, reuse: run(before), estimate: true });
      expect(estimate.iterations).toBeGreaterThan(0);
      expect(estimate.iterations).toBeLessThan(N);
      const full = seasonsOf(run(after));
      for (const [it, line] of seasonsOf(estimate)) expect(line).toBe(full.get(it));
    });
  }

  it("with a team followed, it copies that team's games the other way from the earlier run", () => {
    const locks = { [game2.id]: game2.awayId };
    const estimate = run({ teamId: favourite, locks, reuse: run({ teamId: favourite }), estimate: true });
    const full = run({ teamId: favourite, locks });
    expect(estimate.iterations).toBeLessThan(N);
    expect(estimate.games.map((g) => g.gameId)).toEqual(full.games.map((g) => g.gameId));
    for (const g of full.games) expect(Math.abs(estimate.games.find((x) => x.gameId === g.gameId)!.fieldIfWin - g.fieldIfWin)).toBeLessThan(0.1);
  });

  it("weighs the seasons it keeps, so the picked teams' odds land near the full run's too", () => {
    // Seasons the underdog won on its own lean to ones its rating ran high; weighed back, its odds match the full run.
    const big: NationalOptions = { iterations: 6000, seed: 9, conferences };
    const locks = { [game.id]: underdog };
    const estimate = simulateNational(season, { ...big, locks, reuse: simulateNational(season, big), estimate: true });
    const full = simulateNational(season, { ...big, locks });
    for (const id of [underdog, favourite]) {
      const e = estimate.teams.find((t) => t.teamId === id)!;
      const f = full.teams.find((t) => t.teamId === id)!;
      expect(Math.abs(e.playoff!.field - f.playoff!.field)).toBeLessThan(0.03);
      if (f.titleGame !== null) expect(Math.abs(e.titleGame! - f.titleGame)).toBeLessThan(0.03);
      expect(Math.abs(e.profile.wins - f.profile.wins)).toBeLessThan(0.1);
    }
  }, 30_000);

  it("with no earlier run, a lock it had taken back or changed, or one that followed another team, it is the full run", () => {
    const locks = { [game.id]: underdog };
    expect(snapshot(run({ locks, estimate: true }))).toEqual(snapshot(run({ locks })));
    const picked = run({ locks });
    expect(snapshot(run({ reuse: picked, estimate: true }))).toEqual(snapshot(run()));
    expect(snapshot(run({ locks: { [game.id]: favourite }, reuse: picked, estimate: true }))).toEqual(snapshot(run({ locks: { [game.id]: favourite } })));
    expect(snapshot(run({ locks, teamId: favourite, reuse: none, estimate: true }))).toEqual(snapshot(run({ locks, teamId: favourite })));
  });

  it("refuses a pick on a game already final", () => {
    const final = season.games.find((g) => g.completed)!;
    expect(() => run({ locks: { [final.id]: final.homeId }, reuse: none, estimate: true })).toThrow(/already final/);
    expect(() => run({ locks: { 999999999: 1 }, reuse: none, estimate: true })).toThrow(/unknown game/);
  });

  it("the Lab's estimate counts the seasons it kept in its summary", () => {
    const lab = seasonLab(season, { ...base, locks: { games: { [game.id]: underdog } }, reuse: none, estimate: true });
    expect(lab.national.iterations).toBeLessThan(N);
    expect(lab.summary).toBe(`1 pick · ${lab.national.iterations.toLocaleString("en-US")} simulated seasons`);
  });
});
