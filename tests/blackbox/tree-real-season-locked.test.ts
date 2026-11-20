// Real-season checks on the 2025 ACC fixture, split over several files so vitest runs them in parallel;
// these are the slowest tests in the suite.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pathTree, seasonFromCfbd } from "@/core";
import type { CfbdSnapshot } from "@/core";
// The 2025 results are checked under the 2026 rules, the only ones core has, so the fixture is loaded as 2026.

describe("locked games on a real season", () => {
  // Kansas in the 2026 Big 12 with its likeliest way locked: more than a dozen picks, many of them games elsewhere.
  const kansasLocked = () => {
    const s = seasonFromCfbd(JSON.parse(readFileSync("fixtures/big-12-2026.json", "utf8")) as CfbdSnapshot);
    const opts = { conference: "Big 12", teamId: s.teams.find((t) => t.name === "Kansas")!.id, iterations: 1000, seed: 1 };
    const locks = Object.fromEntries(pathTree(s, opts).likeliest!.picks.map((p) => [p.gameId, p.winner]));
    const tree = pathTree(s, { ...opts, locks });
    return { s, opts, locks, tree, lockedElsewhere: tree.weeks.flatMap((w) => w.games).filter((g) => g.gameId in locks) };
  };
  it("every locked game elsewhere shows the team's odds for its other side, however many games are locked", () => {
    const { locks, lockedElsewhere } = kansasLocked();
    expect(lockedElsewhere.length).toBeGreaterThan(12);
    for (const g of lockedElsewhere) {
      const other = locks[g.gameId] === g.homeId ? g.ifAway : g.ifHome;
      expect(other, `${g.home} vs ${g.away}`).not.toBe("—");
    }
  }, 60_000);

  it("a locked game's other side matches the odds with that result picked instead", () => {
    const { s, opts, locks, lockedElsewhere } = kansasLocked();
    const otherOf = (g: (typeof lockedElsewhere)[number]) => (locks[g.gameId] === g.homeId ? g.awayId : g.homeId);
    const shownOf = (g: (typeof lockedElsewhere)[number]) => (otherOf(g) === g.homeId ? g.ifHome : g.ifAway);
    // Five of them, those showing a percentage first: each check reruns the tree, and In or Out comes from a proof.
    const sample = [...lockedElsewhere].sort((a, b) => Number(/%$/.test(shownOf(b))) - Number(/%$/.test(shownOf(a)))).slice(0, 5);
    expect(sample.filter((g) => /%$/.test(shownOf(g))).length).toBeGreaterThan(2);
    for (const g of sample) {
      const other = otherOf(g);
      const swapped = pathTree(s, { ...opts, locks: { ...locks, [g.gameId]: other }, depth: 0 });
      const there = swapped.weeks.flatMap((w) => w.games).find((x) => x.gameId === g.gameId)!;
      expect(shownOf(g), `${g.home} vs ${g.away}`).toBe(other === g.homeId ? there.ifHome : there.ifAway);
    }
  }, 60_000);
});
