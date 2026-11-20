// Real-season checks on the 2025 ACC fixture, split over several files so vitest runs them in parallel;
// these are the slowest tests in the suite.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pathTree, seasonFromCfbd } from "@/core";
import type { CfbdSnapshot, Season } from "@/core";
// The 2025 results are checked under the 2026 rules, the only ones core has, so the fixture is loaded as 2026.

describe("help from elsewhere on a real season", () => {
  it("the team's own part reads as a count of the results the way needs from it", () => {
    const snap = { ...(JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot), year: 2026 };
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    const seen = new Set<string>();
    // These two cuts include a way that needs only some of a team's games, and one that needs none of them.
    cuts: for (const weeks of [2, 5]) {
      const cut: Season = {
        ...full,
        games: full.games.map((g) => (g.week > last - weeks ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
      };
      for (const t of cut.teams.filter((x) => x.conference === "ACC")) {
        const way = pathTree(cut, { conference: "ACC", teamId: t.id, iterations: 500, seed: 1 }).likeliest;
        if (!way) continue;
        const left = way.ownGames.length;
        const wins = way.ownGames.filter((g) => g.result === "win").length;
        const losses = way.ownGames.filter((g) => g.result === "lose").length;
        const [verb, n] = wins > 0 ? ["win", wins] : ["lose", losses];
        if (wins > 0 && losses > 0) {
          // Needs some of each: both are named.
          expect(way.ownJob).toBe(`Win ${wins} and lose ${losses} of ${left} left`);
          expect(way.summary.startsWith(`Win ${wins} and lose ${losses} of ${left}`)).toBe(true);
        } else if (n === 0) {
          expect(way.ownSummary).toBe("either way");
          expect(way.ownJob).toBe("Its own results don't matter on this way in");
          seen.add("either way");
        } else if (n === left) {
          expect(way.ownSummary).toBe(left === 1 ? `${verb}s its last game` : left === 2 ? `${verb}s both` : `${verb}s all ${left}`);
          expect(way.summary.startsWith(`${verb[0].toUpperCase()}${verb.slice(1)} out`)).toBe(true);
        } else {
          expect(way.ownSummary).toBe(`${verb}s ${n} of ${left}`);
          expect(way.ownJob).toBe(`${verb[0].toUpperCase()}${verb.slice(1)} ${n} of ${left} left`);
          expect(way.summary.startsWith(`${verb[0].toUpperCase()}${verb.slice(1)} ${n} of ${left}`)).toBe(true);
          seen.add("some");
        }
        // Both kinds seen: the rest of the sweep adds time, not cases.
        if (seen.size === 2) break cuts;
      }
    }
    expect([...seen].sort()).toEqual(["either way", "some"]);
    // Up to 36 trees, though the sweep stops once both kinds are seen.
  }, 120_000);

  it("California four weeks out: the card's wording, word for word", () => {
    const snap = { ...(JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot), year: 2026 };
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    const cut: Season = {
      ...full,
      games: full.games.map((g) => (g.week > last - 4 ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
    };
    const cal = cut.teams.find((t) => t.name === "California")!;
    const way = pathTree(cut, { conference: "ACC", teamId: cal.id, iterations: 500, seed: 1 }).likeliest!;
    expect(way.title).toBe("What California needs");
    expect(way.scope).toBe("On its likeliest way in");
    expect(way.ownJob).toBe("Win all 2 left");
    expect(way.ownSummary).toBe("wins both");
    expect(way.summary).toBe("Win out, Duke and Virginia each lose twice, Miami, Louisville and SMU each lose once");
    expect(way.rivals.map((r) => [r.team, r.summary])).toEqual([
      ["Duke", "2 losses, 1 win"],
      ["Virginia", "2 losses"],
      ["Miami", "1 loss, 1 win, 1 either way"],
      ["Louisville", "1 loss, 1 win"],
      ["SMU", "1 loss"],
    ]);
  }, 30_000);

  it("no result shows a flat 100% or 0% unless it's proven", () => {
    const snap = { ...(JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot), year: 2026 };
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    const cut: Season = {
      ...full,
      games: full.games.map((g) => (g.week > last - 4 ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
    };
    const open = cut.games.filter((g) => !g.completed && g.conferenceGame);
    let checked = 0;
    for (const t of cut.teams.filter((x) => x.conference === "ACC")) {
      // Win out, plus a few home wins elsewhere: some teams end up nearly in, and a small sample says
      // 100% where the proof doesn't.
      const own = open.filter((g) => g.homeId === t.id || g.awayId === t.id);
      const locks: Record<number, number> = Object.fromEntries(own.map((g) => [g.id, t.id]));
      for (const g of open.filter((x) => !own.includes(x)).slice(0, 4)) locks[g.id] = g.homeId;
      const tree = pathTree(cut, { conference: "ACC", teamId: t.id, iterations: 500, seed: 1, locks });
      for (const w of tree.weeks) {
        const shown = [...w.games.flatMap((g) => [g.ifHome, g.ifAway]), ...(w.own ? [w.own.ifWin, w.own.ifLose] : [])];
        for (const s of shown) expect(s, `${t.name} week ${w.week}`).not.toMatch(/^(100|0)%$/);
        checked += shown.length;
      }
    }
    expect(checked).toBeGreaterThan(20);
  }, 60_000);
});
