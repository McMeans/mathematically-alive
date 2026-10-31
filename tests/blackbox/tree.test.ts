import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatOdds, pathTree, seasonFromCfbd, teamPath } from "@/core";
import type { CfbdSnapshot, Game, Season, TreeNode } from "@/core";

function team(id: number, conference: string, rating: number | null = null) {
  return {
    id, name: `Team${id}`, abbreviation: null, conference, classification: "fbs" as const,
    color: null, altColor: null, rating,
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
const nodes = (n: TreeNode): TreeNode[] => [n, ...n.children.flatMap(nodes)];
/** Every root-to-leaf path, as the list of nodes below the root. */
const paths = (n: TreeNode, above: TreeNode[] = []): TreeNode[][] =>
  n.children.length ? n.children.flatMap((c) => paths(c, [...above, c])) : [above];

// Team 1 (rated lowest) is a big underdog against Team 2, then Team 3 plays Team 4.
// Beat Team 2 and Team 1 is in exactly when Team 3 beats Team 4; lose and it's out either way.
function needsHelp() {
  nextId = 0;
  const upset = game(1, 2, undefined, { spread: 14, start: "2026-11-07T18:00:00Z" });
  const other = game(3, 4, undefined, { spread: 0, start: "2026-11-14T18:00:00Z" });
  const s: Season = {
    year: 2026, fetchedAt: "",
    games: [game(1, 3, 1), game(4, 1, 4), game(2, 3, 2), game(2, 4, 2), upset, other],
    teams: [team(1, "C", -10), team(2, "C", 5), team(3, "C", 0), team(4, "C", 1)],
  };
  return { s, upset, other };
}

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
    const { s, early, mid } = scenario();
    const one = pathTree(s, { ...base, teamId: 1, depth: 1 }).root;
    expect(one.children.map((c) => c.gameId)).toEqual([early.id, early.id]);
    expect(one.children.every((c) => c.children.length === 0)).toBe(true);
    const two = pathTree(s, { ...base, teamId: 1, depth: 2 }).root;
    expect(two.children[0].children.map((c) => c.gameId)).toEqual([mid.id, mid.id]);
    expect(Math.max(...paths(two).map((p) => p.length))).toBe(2);
  });

  it("the tree branches on every remaining conference game by default", () => {
    const { s, early, mid, late } = scenario();
    const last = game(2, 1, undefined, { start: "2026-11-28T18:00:00Z" });
    s.games.push(last);
    const root = pathTree(s, { ...base, teamId: 1 }).root;
    const all = paths(root);
    expect(all.some((p) => p.length === 4)).toBe(true);
    for (const p of all) {
      expect(p.map((n) => n.gameId)).toEqual([early.id, mid.id, late.id, last.id].slice(0, p.length));
      // A branch only stops early when its outcome is settled.
      if (p.length < 4) expect(p[p.length - 1].outcome).not.toBeNull();
    }
    expect(pathTree(s, { ...base, teamId: 1, depth: 9 }).root).toEqual(root);
  });

  it("a branch stops once the team is in or out in every season that goes that way", () => {
    const { s } = scenario();
    const root = pathTree(s, { ...base, teamId: 1 }).root;
    const settled = nodes(root).filter((n) => n.outcome === "in" || n.outcome === "out");
    expect(settled.length).toBeGreaterThan(0);
    for (const n of settled) {
      expect(n.children).toEqual([]);
      expect(n.odds).toBe(n.outcome === "in" ? 1 : 0);
      expect(n.verdict).toBe(n.outcome === "in" ? "In" : "Out");
    }
    // Beat Team2 and Team3 and Team1 is in, whatever happens against Team4.
    const early = root.children[0].children[0];
    expect(early.label).toBe("Beat Team3");
    expect(early.outcome).toBe("in");
    expect(early.rest).toBe(1);
    expect(early.note).toBe("In the title game whatever else happens. The last game can't change that.");
    const open = nodes(root).filter((n) => n.outcome === null);
    for (const n of open) {
      expect(n.verdict).toBe(formatOdds(n.odds!));
      expect(n.note).toBeNull();
      expect(n.rest).toBe(0);
    }
  });

  it("a team that is in whatever happens keeps its tree, every branch in", () => {
    nextId = 0;
    const s = season([game(1, 3, 1), game(1, 4, 1), game(2, 3, 2), game(2, 4, 2), game(1, 2), game(3, 4)]);
    const t = pathTree(s, { ...base, teamId: 1 }).root;
    expect(t.outcome).toBe("in");
    expect(t.verdict).toBe("In");
    expect(t.children.map((c) => c.label)).toEqual(["Beat Team2", "Lose to Team2"]);
    expect(t.children.every((c) => c.outcome === "in")).toBe(true);
  });

  it("non-conference games stay out of the tree and the footnote names them", () => {
    const { s, early } = scenario();
    s.teams.push(team(9, "Other"));
    s.games.push(game(9, 1, undefined, { conferenceGame: false, start: "2026-11-01T18:00:00Z" }));
    const t = pathTree(s, { ...base, teamId: 1 });
    expect(t.root.children[0].gameId).toBe(early.id);
    expect(t.footnote).toBe("Not in the tree: Team9 (Nov 1). Non-conference results don't change the C title-game race.");
    expect(pathTree(scenario().s, { ...base, teamId: 1 }).footnote).toBeNull();
    expect(pathTree(scenario().s, { ...base, teamId: 1, depth: 1 }).footnote).toBe(
      "The tree stops after 1 game; 2 later C games aren't shown.",
    );
  });

  it("labels and details name the opponent, date and site", () => {
    const { s } = scenario();
    const root = pathTree(s, { ...base, teamId: 1 }).root;
    expect(root.children[0].label).toBe("Beat Team2");
    expect(root.children[1].label).toBe("Lose to Team2");
    expect(root.children[0].detail).toBe("Nov 7 · home");
    const mid = root.children[0].children[1];
    expect(mid.label).toBe("Lose to Team3");
    expect(mid.detail).toBe("Nov 14 · away");
    expect(mid.children[0].detail).toBe("Nov 21 · neutral");
  });

  it("a game with an unreadable date falls back to its week", () => {
    nextId = 0;
    const s = season([game(1, 2, undefined, { start: "TBD", week: 12 }), game(3, 4, 3)]);
    expect(pathTree(s, { ...base, teamId: 1 }).root.children[0].detail).toBe("week 12 · home");
  });

  it("leaves after the last conference game carry the final conference record", () => {
    const { s } = scenario();
    const full = pathTree(s, { ...base, teamId: 1 }).root;
    expect(full.record).toBeNull();
    for (const p of paths(full)) {
      const leaf = p[p.length - 1];
      if (p.length < 3) expect(leaf.record).toBeNull();
      else expect(leaf.record).toBe(`${1 + p.filter((n) => n.win).length}-${p.filter((n) => !n.win).length} C`);
    }
    const partial = pathTree(s, { ...base, teamId: 1, depth: 2 }).root;
    expect(leaves(partial).every((l) => l.record === null)).toBe(true);
  });

  it("the likely path follows the more probable result at each level", () => {
    // Team 1 is a heavy favorite in the first game, a heavy underdog in the second.
    const { s, early, mid } = scenario();
    early.spread = -30;
    mid.spread = -30;
    const root = pathTree(s, { ...base, teamId: 1 }).root;
    expect(root.likely).toBe(true);
    const [w, l] = root.children;
    expect([w.likely, l.likely]).toEqual([true, false]);
    const [ww, wl] = w.children;
    expect([ww.likely, wl.likely]).toEqual([false, true]);
    expect(nodes(l).every((c) => !c.likely)).toBe(true);
  });

  it("an even tie on reach prefers the win", () => {
    nextId = 0;
    const s = season([game(1, 2, undefined, { spread: 0 }), game(3, 4, 3)], 4);
    const t = pathTree(s, { ...base, iterations: 2, teamId: 1, depth: 1 }).root;
    const [w, l] = t.children;
    if (w.reach === l.reach) expect(w.likely).toBe(true);
    expect(w.likely !== l.likely).toBe(true);
  });

  it("a locked game's contradicting branch is ruled out and the other side carries on", () => {
    const { s, early } = scenario();
    const free = pathTree(s, { ...base, teamId: 1 }).root;
    const locked = pathTree(s, { ...base, teamId: 1, locks: { [early.id]: 1 } }).root;
    const [win, loss] = locked.children;
    expect(loss.reach).toBe(0);
    expect(loss.odds).toBeNull();
    expect(loss.outcome).toBe("never");
    expect(loss.verdict).toBe("—");
    expect(loss.children).toEqual([]);
    expect(loss.note).toBe("A locked result rules this out.");
    expect(win.reach).toBe(1);
    expect(win.children.length).toBe(2);
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
    const s = season([game(1, 2, undefined, { spread: -40 }), game(3, 4, 3)]);
    const root = pathTree(s, { ...base, teamId: 1, depth: 1 }).root;
    const loss = root.children[1];
    expect(loss.reach).toBeLessThan(0.01);
    expect(loss.odds).toBeNull();
    expect(loss.outcome).toBe("rare");
    expect(loss.verdict).toBe("Rare");
    expect(root.children[0].odds).not.toBeNull();
  });

  it("rejects a team outside the conference, a tiny conference and a bad depth", () => {
    const { s } = scenario();
    expect(() => pathTree(s, { ...base, teamId: 99 })).toThrow(/not in C/);
    expect(() => pathTree(s, { ...base, conference: "Nope", teamId: 1 })).toThrow(/fewer than two/);
    expect(() => pathTree(s, { ...base, teamId: 1, depth: -1 })).toThrow(RangeError);
  });

  it("builds a tree for every team in the 2025 ACC fixture with the last three weeks unplayed", () => {
    const snap = JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot;
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
  });
});

describe("help from elsewhere", () => {
  it("lists every other remaining conference game, and only those", () => {
    const { s, upset, other } = needsHelp();
    s.teams.push(team(9, "Other"));
    s.games.push(game(9, 3, undefined, { conferenceGame: false }));
    const t = pathTree(s, { ...base, teamId: 1 });
    expect(t.help.map((h) => h.gameId)).toEqual([other.id]);
    expect(t.help.some((h) => h.gameId === upset.id)).toBe(false);
    const h = t.help[0];
    expect(h.label).toBe("Team4 at Team3");
    expect(h.detail).toBe("Nov 14");
  });

  it("a rival's game that decides the team's spot matters now and roots for the rival's opponent", () => {
    nextId = 0;
    // Team 2 is done at 1-2. Team 3 beats Team 4 and takes the second spot; loses and it's a three-way tie.
    const decider = game(3, 4);
    const s = season([game(1, 2, 1), game(1, 3, 1), game(1, 4, 1), game(2, 4, 2), game(3, 2, 3), decider]);
    const t = pathTree(s, { ...base, teamId: 2 });
    expect(t.root.children).toEqual([]);
    const [h] = t.help;
    expect(h.gameId).toBe(decider.id);
    expect(h.now).toBe(true);
    expect(h.oddsIfHomeWins).toBe(0);
    expect(h.oddsIfAwayWins!).toBeGreaterThan(0.2);
    expect(h.swing).toBeCloseTo(h.oddsIfAwayWins!, 10);
    expect(h.rooting).toBe(4);
    expect(t.helpNote).toBe("Every other C game left can change Team2's odds.");
  });

  it("a game that matters far more if the team wins out says so", () => {
    const { s, other } = needsHelp();
    const t = pathTree(s, { ...base, teamId: 1 });
    const [win, loss] = t.root.children;
    // Out in every simulated season, but only through the rating tiebreak, which could go either way: not proven.
    expect(loss.odds).toBe(0);
    expect(loss.outcome).toBeNull();
    expect(loss.verdict).toBe("<1%");
    expect(win.outcome).toBeNull();
    const h = t.help.find((x) => x.gameId === other.id)!;
    expect(h.now).toBe(true);
    expect(h.scenario).not.toBeNull();
    expect(h.scenario!.when).toBe("if Team1 wins out");
    expect(h.scenario!.oddsIfHomeWins).toBe(1);
    expect(h.scenario!.oddsIfAwayWins).toBe(0);
    expect(h.scenario!.swing).toBeGreaterThan(h.swing + 0.05);
    expect(h.scenario!.line).toBe("Matters more if Team1 wins out: 100% with a Team3 win, 0% with a Team4 win.");
    expect(h.rooting).toBe(3);
  });

  it("a locked own game turns a scenario swing into the swing now", () => {
    const { s, upset, other } = needsHelp();
    const locked = pathTree(s, { ...base, teamId: 1, locks: { [upset.id]: 1 } });
    expect(locked.help[0].gameId).toBe(other.id);
    expect(locked.help[0].swing).toBe(1);
    expect(locked.help[0].scenario).toBeNull();
  });

  it("orders help: games that matter now, then games that matter in a scenario, then the rest by kickoff", () => {
    const snap = JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot;
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
  });

  it("locking the team's win-out makes a game's swing clear when it wasn't before", () => {
    const { s, upset, other } = needsHelp();
    upset.spread = 30;
    const o = { ...base, iterations: 300, teamId: 1 };
    const before = pathTree(s, o).help.find((h) => h.gameId === other.id)!;
    expect(before.now).toBe(false);
    expect(before.scenario).toBeNull();
    const after = pathTree(s, { ...o, locks: { [upset.id]: 1 } }).help.find((h) => h.gameId === other.id)!;
    expect(after.now).toBe(true);
    expect(after.rooting).toBe(3);
  });

  it("a result that clinches the team's spot is marked in, one that doesn't prove anything is not", () => {
    const { s, upset, other } = needsHelp();
    const h = pathTree(s, { ...base, teamId: 1, locks: { [upset.id]: 1 } }).help.find((x) => x.gameId === other.id)!;
    expect(h.ifHomeWins).toBe("in");
    expect(h.ifAwayWins).toBeNull();
    expect(pathTree(s, { ...base, teamId: 1 }).help[0].ifHomeWins).toBeNull();
  });

  it("the likeliest way in names the team's results and the results elsewhere it needs", () => {
    const { s, upset, other } = needsHelp();
    const t = pathTree(s, { ...base, teamId: 1 });
    expect(t.likeliest!.picks).toEqual([{ gameId: upset.id, winner: 1 }, { gameId: other.id, winner: 3 }]);
    expect(t.likeliest!.share).toBeCloseTo(t.titleGame, 10);
    expect(t.likeliest!.line).toBe(`Likeliest way in (${formatOdds(t.likeliest!.share)} of simulated seasons): Team1 beats Team2; and Team3 beats Team4.`);
    // Locking it in makes it certain, and a team already in has no "way in" to show.
    const locked = pathTree(s, { ...base, teamId: 1, locks: { [upset.id]: 1, [other.id]: 3 } });
    expect(locked.root.verdict).toBe("In");
    expect(locked.likeliest).toBeNull();
  });

  it("the likeliest way in picks only games elsewhere that matter, each one in the help list", () => {
    const snap = JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot;
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    const cut: Season = {
      ...full,
      games: full.games.map((g) => (g.week > last - 3 ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
    };
    let checked = 0;
    for (const t of cut.teams.filter((x) => x.conference === "ACC")) {
      const tree = pathTree(cut, { conference: "ACC", teamId: t.id, iterations: 2000, seed: 1 });
      if (!tree.likeliest) continue;
      const picked = new Set(tree.likeliest.picks.map((p) => p.gameId));
      const own = new Set(cut.games.filter((g) => g.homeId === t.id || g.awayId === t.id).map((g) => g.id));
      const mattering = new Set(tree.help.filter((h) => h.now || h.scenario !== null).map((h) => h.gameId));
      for (const id of picked) if (!own.has(id)) expect(mattering.has(id)).toBe(true);
      expect(picked.size).toBeLessThan(own.size + tree.help.length);
      expect(tree.likeliest.share).toBeGreaterThan(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("a locked game drops out of the help list", () => {
    const { s, other } = needsHelp();
    const t = pathTree(s, { ...base, teamId: 1, locks: { [other.id]: 3 } });
    expect(t.help).toEqual([]);
    expect(t.helpNote).toBe("No other C games are left to play.");
  });

  it("a game whose result can't change the odds is never flagged, even when its upset side is small", () => {
    nextId = 0;
    // Team 2's spot hangs on 2 v 3 and 3 v 4. Teams 5 and 6 are 0-2 and can't reach it.
    const lopsided = game(5, 6, undefined, { spread: -24 });
    const s = season([
      game(1, 2, 1), game(1, 3, 1), game(1, 4, 1), game(2, 4, 2), game(1, 5, 1), game(1, 6, 1),
      game(2, 5, 2), game(2, 6, 2), game(2, 3), game(3, 4), lopsided,
    ], 6);
    const o = { ...base, teamId: 2 };
    const home = pathTree(s, { ...o, locks: { [lopsided.id]: 5 } }).titleGame;
    const away = pathTree(s, { ...o, locks: { [lopsided.id]: 6 } }).titleGame;
    expect(home).toBe(away);
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const h = pathTree(s, { ...o, seed }).help.find((x) => x.gameId === lopsided.id)!;
      expect(h.now).toBe(false);
      expect(h.scenario).toBeNull();
      expect(h.rooting).toBeNull();
      expect(teamPath(s, { ...o, seed }).keyGames.some((k) => k.gameId === lopsided.id)).toBe(false);
    }
  });

  it("the help note covers settled teams and games that don't matter", () => {
    const { s } = needsHelp();
    s.games.push(game(2, 3, undefined, { start: "2026-11-21T18:00:00Z" }));
    const t = pathTree(s, { ...base, teamId: 1 });
    expect(t.help).toHaveLength(2);
    nextId = 100;
    const out = season([game(2, 1, 2), game(3, 1, 3), game(4, 1, 4), game(2, 3), game(2, 4)]);
    expect(pathTree(out, { ...base, teamId: 1 }).helpNote).toBe(
      "Team1 is out whatever happens, so no result elsewhere changes that.",
    );
    expect(pathTree(out, { ...base, teamId: 1 }).root.verdict).toBe("Out");
  });
});
