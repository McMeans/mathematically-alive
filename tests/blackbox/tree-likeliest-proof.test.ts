// The slowest real-season check, on its own so vitest runs it in parallel with the other files.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explore, pathTree, seasonFromCfbd } from "@/core";
import type { CfbdSnapshot, Season } from "@/core";

describe("help from elsewhere on a real season", () => {
  it("the likeliest way in proves the spot once locked, for every team in a real season", () => {
    const snap = JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot;
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    let checked = 0;
    // Most contenders' likeliest way leans on a tiebreak; three cut-off points give enough sure ones.
    for (const t of [3, 4, 5].flatMap((weeks) => {
      const cut: Season = {
        ...full,
        games: full.games.map((g) => (g.week > last - weeks ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
      };
      return full.teams.filter((x) => x.conference === "ACC").map((x) => ({ ...x, cut }));
    })) {
      const cut = t.cut;
      const opts = { conference: "ACC", teamId: t.id, iterations: 300, seed: 1 };
      const tree = pathTree(cut, opts);
      if (!tree.likeliest || tree.likeliest.needsTiebreak) continue;
      expect(tree.likeliest.chance).toBeGreaterThan(0);
      // Every pick shows on the card: as the team's own result, a named result elsewhere, or a counted favorite.
      const counted = Number(tree.likeliest.favorites?.match(/\d+/)?.[0] ?? 0);
      expect(tree.likeliest.own.length + tree.likeliest.needs.length + counted).toBe(tree.likeliest.picks.length);
      expect(tree.likeliest.named).toHaveLength(tree.likeliest.own.length + tree.likeliest.needs.length);
      const locks = Object.fromEntries(tree.likeliest.picks.map((p) => [p.gameId, p.winner]));
      expect(pathTree(cut, { ...opts, locks, depth: 0 }).root.verdict).toBe("In");
      // Every pick is needed: swap any one of them and the team is no longer sure to be in.
      const { tree: locked, outlook } = explore(cut, { ...opts, locks });
      expect(outlook.find((o) => o.teamId === t.id)!.status).toBe("clinched");
      for (const w of locked.weeks) {
        if (w.own && w.own.gameId in locks) expect(locks[w.own.gameId] === t.id ? w.own.ifLose : w.own.ifWin).not.toBe("In");
        for (const g of w.games.filter((x) => x.gameId in locks)) expect(locks[g.gameId] === g.homeId ? g.ifAway : g.ifHome).not.toBe("In");
      }
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
  }, 180_000);
});
