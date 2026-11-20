// Real-season checks on the 2025 ACC fixture, split over several files so vitest runs them in parallel;
// these are the slowest tests in the suite.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatOdds, pathTree, seasonFromCfbd, teamPath } from "@/core";
import type { CfbdSnapshot, Season, TreeNode } from "@/core";
// The 2025 results are checked under the 2026 rules, the only ones core has, so the fixture is loaded as 2026.

const leaves = (n: TreeNode): TreeNode[] => (n.children.length ? n.children.flatMap(leaves) : [n]);
/** Every root-to-leaf path, as the list of nodes below the root. */
const paths = (n: TreeNode, above: TreeNode[] = []): TreeNode[][] =>
  n.children.length ? n.children.flatMap((c) => paths(c, [...above, c])) : [above];

describe("path tree on a real season", () => {
  it("builds a tree for every team in the 2025 ACC fixture with the last three weeks unplayed", () => {
    const snap = { ...(JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot), year: 2026 };
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    const cut: Season = {
      ...full,
      games: full.games.map((g) => (g.week > last - 3 ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
    };
    let early = 0;
    for (const t of cut.teams.filter((x) => x.conference === "ACC")) {
      const o = { conference: "ACC", teamId: t.id, iterations: 500, seed: 1 };
      const tree = pathTree(cut, o);
      expect(tree.titleGame).toBe(teamPath(cut, o).titleGame);
      expect(leaves(tree.root).reduce((a, l) => a + l.reach, 0)).toBeCloseTo(1, 10);
      const left = cut.games.filter((g) => !g.completed && g.conferenceGame && (g.homeId === t.id || g.awayId === t.id)).length;
      for (const p of paths(tree.root)) {
        const leaf = p.length ? p[p.length - 1] : tree.root;
        // Every leaf is either after the last conference game or a settled/rare stop that counts the rest.
        if (leaf.outcome === null) expect(p.length).toBe(left);
        else expect(leaf.rest).toBe(left - p.length);
        if (leaf.rest > 0) early++;
      }
    }
    expect(early).toBeGreaterThan(0);
  }, 30_000);
});

describe("help from elsewhere on a real season", () => {
  it("orders help: games that matter now, then games that matter in a scenario, then the rest by kickoff", () => {
    const snap = { ...(JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot), year: 2026 };
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    const cut: Season = {
      ...full,
      games: full.games.map((g) => (g.week > last - 3 ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
    };
    const kickoff = new Map(cut.games.map((g) => [g.id, Date.parse(g.start)]));
    let scenarioOnly = 0;
    for (const t of cut.teams.filter((x) => x.conference === "ACC")) {
      const { help } = pathTree(cut, { conference: "ACC", teamId: t.id, iterations: 2000, seed: 1 });
      const tier = (h: (typeof help)[number]) => (h.now ? 0 : h.scenario ? 1 : 2);
      const weight = (h: (typeof help)[number]) => (h.now ? h.swing : h.scenario ? h.scenario.swing : 0);
      for (let i = 1; i < help.length; i++) {
        const [a, b] = [help[i - 1], help[i]];
        expect(tier(a)).toBeLessThanOrEqual(tier(b));
        if (tier(a) === tier(b) && tier(a) < 2) expect(weight(a)).toBeGreaterThanOrEqual(weight(b));
        if (tier(a) === 2 && tier(b) === 2) expect(kickoff.get(a.gameId)!).toBeLessThanOrEqual(kickoff.get(b.gameId)!);
      }
      for (const h of help) {
        expect(h.homeId === t.id || h.awayId === t.id).toBe(false);
        expect(h.rooting === null).toBe(tier(h) === 2);
        if (h.scenario) expect(h.scenario.when).toMatch(new RegExp(`^if ${t.name} (wins out|loses only to|beats|loses to)`));
        if (!h.now && h.scenario) scenarioOnly++;
      }
    }
    expect(scenarioOnly).toBeGreaterThan(0);
  }, 30_000);

  it("the likeliest way, tiebreak included, is never likelier than the team's title odds, nor far below them for a contender", () => {
    const snap = { ...(JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot), year: 2026 };
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    let viaTiebreak = 0;
    for (const weeks of [3, 4]) {
      const cut: Season = {
        ...full,
        games: full.games.map((g) => (g.week > last - weeks ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
      };
      for (const t of cut.teams.filter((x) => x.conference === "ACC")) {
        const tree = pathTree(cut, { conference: "ACC", teamId: t.id, iterations: 1000, seed: 1 });
        const way = tree.likeliest;
        if (!way) continue;
        // One combination of results can't be likelier than every way in together (allowing for sampling noise).
        expect(way.overall).toBeLessThanOrEqual(tree.titleGame + 0.03);
        expect(way.line).toContain(`(${formatOdds(way.overall)} chance)`);
        if (way.needsTiebreak) {
          // A way through the ranking tiebreak counts the chance of winning it, and says so.
          expect(way.overall).toBeCloseTo(way.chance * way.tiebreak!, 12);
          expect(way.note).toMatch(new RegExp(`^With these results ${t.name} gets in (about \\d+% of the time|under 1% of the time|rarely), depending on the ranking tiebreak\\.$`));
          viaTiebreak++;
        } else {
          expect(way.tiebreak).toBeNull();
          expect(way.overall).toBe(way.chance);
        }
        // A real contender whose route runs through a tiebreak isn't shown only a long shot that avoids it.
        if (tree.titleGame >= 0.05) expect(way.overall).toBeGreaterThan(tree.titleGame / 10);
      }
    }
    expect(viaTiebreak).toBeGreaterThan(3);
  }, 60_000);
});
