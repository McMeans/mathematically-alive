import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { labOddsChange, labTeamOdds, seasonFromCfbd, seasonLab, type CfbdSnapshot } from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const base = { iterations: 300, seed: 11, conferences: ["ACC", "Big 12", "SEC", "Big Ten"] };
const LOU = season.teams.find((t) => t.name === "Louisville")!.id;
const free = seasonLab(season, base);

describe("season lab: a pinned team's odds", () => {
  it("reads the team's playoff, title-game and title odds from the run, worded for display", () => {
    const o = labTeamOdds(free.national, LOU)!;
    expect(o.teamId).toBe(LOU);
    expect(o.playoff).toBeGreaterThan(0);
    expect(o.titleGame).toBeGreaterThanOrEqual(o.champion!);
    for (const t of [o.playoffText, o.titleGameText, o.championText]) expect(t).toMatch(/^(\d+(\.\d)?%|<0\.1%|>99%)$/);
  });

  it("follows the picks: Louisville winning out raises its playoff odds", () => {
    const wins = Object.fromEntries(season.games.filter((g) => !g.completed && (g.homeId === LOU || g.awayId === LOU)).map((g) => [g.id, LOU]));
    const after = labTeamOdds(seasonLab(season, { ...base, locks: { games: wins } }).national, LOU)!;
    expect(after.playoff!).toBeGreaterThan(labTeamOdds(free.national, LOU)!.playoff!);
  });

  it("a team the run doesn't have gives no odds", () => {
    expect(labTeamOdds(free.national, -1)).toBeNull();
  });
});

describe("season lab: how a pinned team's odds moved", () => {
  it("counts points of the odds as shown, so 5% to 9% reads +4 pts", () => {
    expect(labOddsChange(0.05, 0.09)).toBe("+4 pts");
    expect(labOddsChange(0.094, 0.051)).toBe("−4 pts");
    expect(labOddsChange(0.004, 0.007)).toBe("+0.3 pts");
  });

  it("reads the edge odds as shown: \">99%\" as 99 and \"<0.1%\" as 0.1", () => {
    expect(labOddsChange(0.98, 1)).toBe("+1 pts"); // 98% to >99%
    expect(labOddsChange(0.995, 0.999)).toBeNull(); // >99% both ways
    expect(labOddsChange(0, 0.004)).toBe("+0.3 pts"); // <0.1% to 0.4%
  });

  it("says nothing when the shown odds are the same or not simulated", () => {
    expect(labOddsChange(0.05, 0.051)).toBeNull();
    expect(labOddsChange(null, 0.2)).toBeNull();
  });
});

describe("season lab: picking a title game before it's settled", () => {
  it("offers each conference's two likeliest teams, likelier first, with chances that add to 100", () => {
    for (const c of free.conferences) {
      const f = c.final!;
      expect(f.teams).toEqual([c.teams[0].teamId, c.teams[1].teamId]);
      expect(f.key).toBe([...f.teams].sort((x, y) => x - y).join("|"));
      expect(f.chances[0] + f.chances[1]).toBeCloseTo(1, 9);
      expect(f.texts.every((t) => /^(\d+%|<1%|>99%)$/.test(t))).toBe(true);
      expect(f.exact).toBe(false);
    }
  });

  it("a title pick for one of the two likeliest teams makes it the champion whenever it plays the game", () => {
    const acc = free.conferences.find((c) => c.conference === "ACC")!;
    const [a] = acc.final!.teams;
    const lab = seasonLab(season, { ...base, locks: { titles: { ACC: a } } });
    const t = lab.national.teams.find((x) => x.teamId === a)!;
    expect(t.champion).toBeCloseTo(t.titleGame!, 9);
    expect(lab.conferences.find((c) => c.conference === "ACC")!.picked).toBe(a);
  });
});
