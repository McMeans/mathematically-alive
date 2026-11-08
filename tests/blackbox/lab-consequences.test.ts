import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { labChanges, seasonFromCfbd, seasonLab, type CfbdSnapshot } from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const opts = { iterations: 2000, seed: 11, conferences: ["ACC", "Big 12", "SEC", "Big Ten"] };
const base = seasonLab(season, opts);
const name = (id: number) => season.teams.find((t) => t.id === id)!.name;
// The biggest game, picked for its underdog.
const big = season.games.find((g) => g.id === base.bigGames[0].gameId)!;
const underdog = base.national.swings.find((s) => s.gameId === big.id)!.home >= 0.5 ? big.awayId : big.homeId;
const favourite = underdog === big.homeId ? big.awayId : big.homeId;
const upset = seasonLab(season, { ...opts, locks: { games: { [big.id]: underdog } }, reuse: base.national });

describe("season lab: what a pick changed", () => {
  it("the change log names the team that entered the field after a pick, and the team that left", () => {
    const { headline, movers } = labChanges(season, base, upset);
    const before = new Set(base.playoff!.field.map((s) => s.teamId));
    const after = new Set(upset.playoff!.field.map((s) => s.teamId));
    const entered = upset.playoff!.field.filter((s) => !before.has(s.teamId));
    const left = base.playoff!.field.filter((s) => !after.has(s.teamId));
    expect(entered.length).toBeGreaterThan(0);
    for (const s of entered) expect(headline).toContain(`${name(s.teamId)} into the field as the ${s.seed} seed`);
    for (const s of left) expect(headline).toContain(`${name(s.teamId)} out`);
    // The beaten favourite's playoff odds fall, and it leads the movers.
    const fav = movers.find((m) => m.teamId === favourite)!;
    expect(fav.what).toBe("field");
    expect(fav.after).toBeLessThan(fav.before);
    expect(fav.text).toMatch(new RegExp(`^${name(favourite)}: playoff \\d+% → \\d+%$`));
    expect(movers.length).toBeLessThanOrEqual(5);
    for (let k = 1; k < movers.length; k++) expect(Math.abs(movers[k].after - movers[k].before)).toBeLessThanOrEqual(Math.abs(movers[k - 1].after - movers[k - 1].before));
  });

  it("comparing a run with itself changes nothing", () => {
    expect(labChanges(season, base, base)).toEqual({ headline: "No change to the projected field.", movers: [] });
  });

  it("with no playoff simulated, the change log has no headline and follows title-game odds", () => {
    const acc = { ...opts, conferences: ["ACC"] };
    const a = seasonLab(season, acc);
    const g = season.games.find((x) => !x.completed && x.conferenceGame && season.teams.find((t) => t.id === x.homeId)?.conference === "ACC")!;
    const b = seasonLab(season, { ...acc, locks: { games: { [g.id]: g.awayId } } });
    const { headline, movers } = labChanges(season, a, b);
    expect(headline).toBe("");
    expect(movers.every((m) => m.what === "title game" && m.text.includes(": title game "))).toBe(true);
    expect(a.bigGames).toEqual([]);
  });
});

describe("season lab: ranking reasons and big games", () => {
  it("every ranked team carries its average record and what lifts it", () => {
    for (const r of base.ranking) expect(r.reason).toMatch(/^About \d+-\d+( · .+)?$/);
    // The top team's record lifts it above the listed average.
    expect(base.ranking[0].reason).toContain("strong record");
    // A likely power-conference champion in the list says so.
    expect(base.ranking.some((r) => /(SEC|Big Ten|Big 12|ACC) title in \d+%/.test(r.reason))).toBe(true);
    const top = base.national.teams[0].profile;
    expect(top.wins + top.losses).toBeGreaterThanOrEqual(12);
  });

  it("big games are the open games that move the field most, and a picked game drops out", () => {
    expect(base.bigGames.length).toBeGreaterThan(0);
    expect(base.bigGames.length).toBeLessThanOrEqual(15);
    for (let k = 0; k < base.bigGames.length; k++) {
      const g = base.bigGames[k];
      expect(g.spots).toBeGreaterThanOrEqual(0.1);
      if (k > 0) expect(g.spots).toBeLessThanOrEqual(base.bigGames[k - 1].spots);
      expect(g.text).toBe(`Swings about ${g.spots.toFixed(1)} ${g.spots.toFixed(1) === "1.0" ? "spot" : "spots"} in the field`);
      expect(season.games.find((x) => x.id === g.gameId)!.completed).toBe(false);
    }
    expect(upset.bigGames.some((g) => g.gameId === big.id)).toBe(false);
    expect(upset.national.swings.find((s) => s.gameId === big.id)!.spots).toBe(0);
  });
});
