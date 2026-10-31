import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pathTree, seasonFromCfbd, teamPath } from "@/core";
import type { CfbdSnapshot, Game, Season, TreeNode } from "@/core";

function team(id: number, conference: string) {
  return {
    id, name: `Team${id}`, abbreviation: null, conference, classification: "fbs" as const,
    color: null, altColor: null, rating: null,
  };
}

let nextId = 0;
function game(home: number, away: number, winner?: number, extra: Partial<Game> = {}): Game {
  return {
    id: nextId++, week: 1, start: "2026-11-07T18:00:00Z", neutralSite: false, conferenceGame: true,
    homeId: home, awayId: away,
    homePoints: winner === undefined ? null : winner === home ? 21 : 14,
    awayPoints: winner === undefined ? null : winner === away ? 21 : 14,
    completed: winner !== undefined, spread: null, ...extra,
  };
}
const season = (games: Game[], n = 4): Season => ({
  year: 2026, fetchedAt: "", games,
  teams: Array.from({ length: n }, (_, i) => team(i + 1, "C")),
});
const base = { conference: "C", iterations: 4000, seed: 5 };

// Team 1 beat team 4 already; it still plays 2, 3 (Nov 14) and, earlier, 4's rival game.
function scenario() {
  nextId = 0;
  const early = game(1, 2, undefined, { start: "2026-11-07T18:00:00Z" });
  const mid = game(3, 1, undefined, { start: "2026-11-14T18:00:00Z" });
  const late = game(1, 4, undefined, { start: "2026-11-21T18:00:00Z", neutralSite: true });
  const s = season([game(1, 4, 1), game(2, 3, 2), game(2, 4, 4), game(3, 4, 3), early, mid, late]);
  return { early, mid, late, s };
}
const leaves = (n: TreeNode): TreeNode[] => (n.children.length ? n.children.flatMap(leaves) : [n]);

describe("path tree", () => {
  it("the root odds equal the team's title-game odds from teamPath", () => {
    const { s } = scenario();
    const t = pathTree(s, { ...base, teamId: 1 });
    expect(t.root.odds).toBe(teamPath(s, { ...base, teamId: 1 }).titleGame);
    expect(t.titleGame).toBe(t.root.odds);
    expect(t.root.reach).toBe(1);
    expect(t.root.label).toBe("Today");
    expect(t.root.detail).toBe("");
  });

  it("each branch's reach adds up to its parent's", () => {
    const { s } = scenario();
    const walk = (n: TreeNode) => {
      if (!n.children.length) return;
      expect(n.children).toHaveLength(2);
      expect(n.children[0].reach + n.children[1].reach).toBeCloseTo(n.reach, 10);
      n.children.forEach(walk);
    };
    walk(pathTree(s, { ...base, teamId: 1 }).root);
  });

  it("winning a game gives at least the odds of losing it", () => {
    const { s } = scenario();
    const [win, loss] = pathTree(s, { ...base, teamId: 1 }).root.children;
    expect(win.win).toBe(true);
    expect(loss.win).toBe(false);
    expect(win.odds!).toBeGreaterThanOrEqual(loss.odds!);
    expect(win.odds!).toBeGreaterThan(loss.odds!);
  });

  it("levels follow kickoff order and the depth option limits them", () => {
    const { s, early } = scenario();
    const one = pathTree(s, { ...base, teamId: 1, depth: 1 }).root;
    expect(one.children.map((c) => c.gameId)).toEqual([early.id, early.id]);
    expect(one.children.every((c) => c.children.length === 0)).toBe(true);
    const def = pathTree(s, { ...base, teamId: 1 }).root;
    expect(leaves(def)).toHaveLength(8);
    const two = pathTree(s, { ...base, teamId: 1, depth: 2 }).root;
    expect(leaves(two)).toHaveLength(4);
    const big = pathTree(s, { ...base, teamId: 1, depth: 9 }).root;
    expect(leaves(big)).toHaveLength(8);
  });

  it("labels and details name the opponent, date and site", () => {
    const { s } = scenario();
    const root = pathTree(s, { ...base, teamId: 1 }).root;
    expect(root.children[0].label).toBe("Beat Team2");
    expect(root.children[1].label).toBe("Lose to Team2");
    expect(root.children[0].detail).toBe("Nov 7 · home");
    const mid = root.children[0].children[0];
    expect(mid.label).toBe("Beat Team3");
    expect(mid.detail).toBe("Nov 14 · away");
    expect(mid.children[0].detail).toBe("Nov 21 · neutral");
  });

  it("a game with an unreadable date falls back to its week", () => {
    nextId = 0;
    const s = season([game(1, 2, undefined, { start: "TBD", week: 12 }), game(3, 4, 3)]);
    expect(pathTree(s, { ...base, teamId: 1 }).root.children[0].detail).toBe("week 12 · home");
  });

  it("leaves carry final records only when the tree covers every remaining game", () => {
    const { s } = scenario();
    const full = pathTree(s, { ...base, teamId: 1 }).root;
    expect(full.record).toBeNull();
    expect(leaves(full).map((l) => l.record)).toEqual(["4-0", "3-1", "3-1", "2-2", "3-1", "2-2", "2-2", "1-3"]);
    const partial = pathTree(s, { ...base, teamId: 1, depth: 2 }).root;
    expect(leaves(partial).every((l) => l.record === null)).toBe(true);
  });

  it("the likely path follows the more probable result at each level", () => {
    nextId = 0;
    // Team 1 is a heavy favorite in the first game, a heavy underdog in the second.
    const s = season([
      game(1, 2, undefined, { spread: -30, start: "2026-11-07T18:00:00Z" }),
      game(3, 1, undefined, { spread: -30, start: "2026-11-14T18:00:00Z" }),
      game(2, 4, 2), game(3, 4, 3),
    ]);
    const root = pathTree(s, { ...base, teamId: 1 }).root;
    expect(root.likely).toBe(true);
    const [w, l] = root.children;
    expect([w.likely, l.likely]).toEqual([true, false]);
    const [ww, wl] = w.children;
    expect([ww.likely, wl.likely]).toEqual([false, true]);
    expect(l.children.every((c) => !c.likely)).toBe(true);
  });

  it("an even tie on reach prefers the win", () => {
    nextId = 0;
    const s = season([game(1, 2, undefined, { spread: 0 }), game(3, 4, 3)], 4);
    const t = pathTree(s, { ...base, iterations: 2, teamId: 1, depth: 1 }).root;
    const [w, l] = t.children;
    if (w.reach === l.reach) expect(w.likely).toBe(true);
    expect(w.likely !== l.likely).toBe(true);
  });

  it("a locked game's contradicting branch is empty but the tree keeps its shape", () => {
    const { s, early } = scenario();
    const free = pathTree(s, { ...base, teamId: 1 }).root;
    const locked = pathTree(s, { ...base, teamId: 1, locks: { [early.id]: 1 } }).root;
    const [win, loss] = locked.children;
    expect(loss.reach).toBe(0);
    expect(loss.odds).toBeNull();
    expect(loss.children.every((c) => c.reach === 0 && c.odds === null)).toBe(true);
    expect(win.reach).toBe(1);
    expect(leaves(locked)).toHaveLength(leaves(free).length);
    expect(locked.children[0].label).toBe(free.children[0].label);
  });

  it("a team with no games left gets a bare root", () => {
    nextId = 0;
    const s = season([game(1, 2, 1), game(3, 4, undefined)]);
    const t = pathTree(s, { ...base, teamId: 1 });
    expect(t.root.children).toEqual([]);
    expect(t.root.reach).toBe(1);
    expect(t.root.record).toBeNull();
    expect(t.root.odds).toBe(t.titleGame);
  });

  it("branches reached in too few seasons have no odds", () => {
    nextId = 0;
    const s = season([game(1, 2, undefined, { spread: -60 }), game(3, 4, 3)]);
    const root = pathTree(s, { ...base, teamId: 1, depth: 1 }).root;
    const loss = root.children[1];
    expect(loss.reach).toBeLessThan(0.01);
    expect(loss.odds).toBeNull();
    expect(root.children[0].odds).not.toBeNull();
  });

  it("rejects a team outside the conference, a tiny conference and a bad depth", () => {
    const { s } = scenario();
    expect(() => pathTree(s, { ...base, teamId: 99 })).toThrow(/not in C/);
    expect(() => pathTree(s, { ...base, conference: "Nope", teamId: 1 })).toThrow(/fewer than two/);
    expect(() => pathTree(s, { ...base, teamId: 1, depth: -1 })).toThrow(RangeError);
  });

  it("builds a tree for every team in the 2025 ACC fixture with the last two weeks unplayed", () => {
    const snap = JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot;
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    const cut: Season = {
      ...full,
      games: full.games.map((g) => (g.week > last - 2 ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
    };
    for (const t of cut.teams.filter((x) => x.conference === "ACC")) {
      const o = { conference: "ACC", teamId: t.id, iterations: 500, seed: 1 };
      const tree = pathTree(cut, o);
      expect(tree.titleGame).toBe(teamPath(cut, o).titleGame);
      expect(leaves(tree.root).reduce((a, l) => a + l.reach, 0)).toBeCloseTo(1, 10);
    }
  });
});
