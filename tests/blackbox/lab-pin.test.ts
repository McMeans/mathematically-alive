import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fillLabLocks, labOddsChange, labTeamOdds, seasonFromCfbd, seasonLab, type CfbdSnapshot } from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const base = { iterations: 300, seed: 11, conferences: ["ACC", "Big 12", "SEC", "Big Ten"] };
const LOU = season.teams.find((t) => t.name === "Louisville")!.id;
const free = seasonLab(season, base);

describe("season lab: a pinned team's odds", () => {
  it("reads the team's playoff, title-game and title odds from the run, worded for display", () => {
    const o = labTeamOdds(season, free, LOU)!;
    expect(o.teamId).toBe(LOU);
    expect(o.playoff).toBeGreaterThan(0);
    expect(o.titleGame).toBeGreaterThanOrEqual(o.champion!);
    for (const t of [o.playoffText, o.titleGameText, o.championText]) expect(t).toMatch(/^(\d+(\.\d)?%|<0\.1%|>99%)$/);
  });

  it("follows the picks: Louisville winning out raises its playoff odds", () => {
    const wins = Object.fromEntries(season.games.filter((g) => !g.completed && (g.homeId === LOU || g.awayId === LOU)).map((g) => [g.id, LOU]));
    const after = labTeamOdds(season, seasonLab(season, { ...base, locks: { games: wins } }), LOU)!;
    expect(after.playoff!).toBeGreaterThan(labTeamOdds(season, free, LOU)!.playoff!);
  });

  it("a team the run doesn't have gives no odds", () => {
    expect(labTeamOdds(season, free, -1)).toBeNull();
  });

  it("a team the picks put out of its title game reads 0%, not <0.1%, and the two in it read 100%", () => {
    // Every game picked: each title game with an exact matchup is settled.
    const lab = seasonLab(season, { ...base, locks: fillLabLocks(season, {}, "favorites", base.conferences) });
    const settled = lab.conferences.filter((c) => c.matchup?.exact);
    expect(settled.length).toBeGreaterThan(0);
    for (const c of settled) {
      for (const s of c.standings) {
        const o = labTeamOdds(season, lab, s.teamId)!;
        if (c.matchup!.teams.includes(s.teamId)) {
          expect(o.titleGameText).toBe("100%");
          expect(c.teams.find((t) => t.teamId === s.teamId)!.titleGameText).toBe("100%");
          // The fill picks each settled title game's winner: it reads 100% to win the conference, the team it beats 0%.
          expect(o.championText).toBe(c.picked === s.teamId ? "100%" : "0%");
          expect(c.teams.find((t) => t.teamId === s.teamId)!.championText).toBe(o.championText);
        } else {
          expect([o.titleGameText, o.championText]).toEqual(["0%", "0%"]);
          // Out of the title game isn't proven out of the playoff: an at-large spot stays open.
          expect(o.playoffText).not.toBe("0%");
        }
      }
    }
  });

  it("with games still open, a team that can't reach the title game reads 0% and one sure of it 100%, its title still open", () => {
    // Every game but the last week of conference play picked: some teams are settled while others' games are still to play.
    const all = fillLabLocks(season, {}, "favorites");
    const conf = new Map(season.teams.map((t) => [t.id, t.conference]));
    const last = Math.max(...season.games.filter((g) => !g.completed && !g.titleGame && conf.get(g.homeId) === conf.get(g.awayId) && base.conferences.includes(conf.get(g.homeId) ?? "")).map((g) => g.week));
    const games = Object.fromEntries(Object.entries(all.games).filter(([id]) => season.games.find((g) => g.id === Number(id))!.week !== last));
    const lab = seasonLab(season, { ...base, locks: { games } });
    let out = 0;
    let sure = 0;
    for (const c of lab.conferences) {
      const best = (k: number) => [...c.standings].map((s) => s.wins).sort((a, b) => b - a)[k];
      for (const s of c.standings) {
        const o = labTeamOdds(season, lab, s.teamId)!;
        const others = c.standings.filter((x) => x.teamId !== s.teamId);
        // Short of the second-best record even winning every open game: out, whatever the tiebreaks say.
        if (s.wins + s.open < best(1)) {
          out++;
          expect([o.titleGameText, o.championText]).toEqual(["0%", "0%"]);
        }
        // Ahead of all but at most one other team even if they win every open game and it loses its own: in.
        if (s.open > 0 || others.some((x) => x.open > 0)) {
          if (others.filter((x) => x.wins + x.open >= s.wins).length <= 1) {
            sure++;
            expect(o.titleGameText).toBe("100%");
            // No title-game winner picked: the title is still open, never a flat 100% or 0%.
            expect(["0%", "100%"]).not.toContain(o.championText);
          }
        }
      }
    }
    expect(out).toBeGreaterThan(0);
    expect(sure).toBeGreaterThan(0);
  });
});

describe("season lab: how a pinned team's odds moved", () => {
  it("counts points of the odds as shown, so 5% to 9% reads +4 pts and 5% to 6% reads +1 pt", () => {
    expect(labOddsChange(0.05, 0.06)).toBe("+1 pt");
    expect(labOddsChange(0.06, 0.05)).toBe("−1 pt");
    expect(labOddsChange(0.05, 0.09)).toBe("+4 pts");
    expect(labOddsChange(0.094, 0.051)).toBe("−4 pts");
    expect(labOddsChange(0.004, 0.007)).toBe("+0.3 pts");
  });

  it("reads the edge odds as shown: \">99%\" as 99 and \"<0.1%\" as 0.1", () => {
    expect(labOddsChange(0.98, 1)).toBe("+1 pt"); // 98% to >99%
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

  it("once the picks settle a matchup, offers exactly those two, in seed order", () => {
    const lab = seasonLab(season, { ...base, locks: fillLabLocks(season, {}, "favorites") });
    const settled = lab.conferences.filter((c) => c.matchup?.exact);
    expect(settled.length).toBeGreaterThan(0);
    for (const c of settled) {
      expect(c.final!.exact).toBe(true);
      expect(c.final!.teams).toEqual(c.matchup!.teams);
      expect(c.final!.chances[0] + c.final!.chances[1]).toBeCloseTo(1, 9);
    }
  });
});
