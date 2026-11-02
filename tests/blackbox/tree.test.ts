import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explore, formatFine, formatOdds, pathTree, seasonFromCfbd, seasonOutlook, teamPath, teamRecord, winProbability } from "@/core";
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
  const other = game(3, 4, undefined, { spread: 0, start: "2026-11-14T18:00:00Z", week: 2 });
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
    expect(t.footnote).toBe("Not listed: Team9 (Nov 1). Non-conference results don't change the C title-game race.");
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
    // Out in almost every simulated season: only the ranking tiebreak, which a team rated this low
    // rarely wins, gets it in. Rare, not impossible, so it shows as under 1%, not Out.
    expect(loss.odds).toBeGreaterThan(0);
    expect(loss.odds).toBeLessThan(0.01);
    expect(loss.outcome).toBeNull();
    expect(loss.verdict).toBe(formatOdds(loss.odds!));
    expect(win.outcome).toBeNull();
    const h = t.help.find((x) => x.gameId === other.id)!;
    expect(h.now).toBe(true);
    expect(h.scenario).not.toBeNull();
    expect(h.scenario!.when).toBe("if Team1 wins out");
    expect(h.scenario!.oddsIfHomeWins).toBe(1);
    // With a Team4 win, Team1 needs the ranking tiebreak, which a 3-1 record makes winnable.
    expect(h.scenario!.oddsIfAwayWins!).toBeLessThan(0.6);
    expect(h.scenario!.swing).toBeGreaterThan(h.swing + 0.05);
    expect(h.scenario!.line).toBe(`Matters more if Team1 wins out: 100% with a Team3 win, ${formatOdds(h.scenario!.oddsIfAwayWins!)} with a Team4 win.`);
    expect(h.rooting).toBe(3);
  });

  it("a locked own game turns a scenario swing into the swing now", () => {
    const { s, upset, other } = needsHelp();
    const locked = pathTree(s, { ...base, teamId: 1, locks: { [upset.id]: 1 } });
    expect(locked.help[0].gameId).toBe(other.id);
    // In for sure with a Team3 win; with a Team4 win only through the ranking tiebreak.
    expect(locked.help[0].swing).toBeGreaterThan(0.5);
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
    expect(t.likeliest!.chance).toBeCloseTo(winProbability(14) * winProbability(0), 10);
    expect(t.likeliest!.upsets).toBe(1);
    expect(t.likeliest!.needsTiebreak).toBe(false);
    expect(t.likeliest!.line).toBe(`Likeliest way in (${formatOdds(t.likeliest!.chance)} chance): Team1 beats Team2; and Team3 beats Team4.`);
    expect(t.likeliest!.heading).toBe(`${formatOdds(t.likeliest!.chance)} chance`);
    expect(t.likeliest!.own).toEqual(["Beat Team2"]);
    expect(t.likeliest!.named).toEqual(t.likeliest!.picks);
    expect(t.likeliest!.needs).toEqual(["Team3 over Team4"]);
    expect(t.likeliest!.favorites).toBeNull();
    expect(t.likeliest!.note).toBeNull();
    // The card's breakdown: the team's job, who has to lose, and the picks week by week.
    expect(t.likeliest!.ownJob).toBe("Win its last game");
    expect(t.likeliest!.ownChance).toBeCloseTo(winProbability(14), 10);
    expect(t.likeliest!.rivals).toEqual([
      { teamId: 4, team: "Team4", needs: 1, left: 1, line: "Loses to Team3", games: [{ opponent: "Team3", chance: winProbability(0), result: "lose" }], chance: winProbability(0) },
    ]);
    expect(t.likeliest!.weeks.map((w) => [w.label, w.own, w.root.map((r) => r.what), w.favorites, w.afterLabel])).toEqual([
      ["Nov 7", "Beat Team2", [], null, t.likeliest!.weeks[0].afterLabel],
      ["Nov 14", null, ["Team3 over Team4"], null, "In"],
    ]);
    // After the upset alone, the odds are what the tree says for beating Team2.
    expect(t.likeliest!.weeks[0].after).toBeCloseTo(t.root.children[0].odds!, 10);
    // Locking it in makes it certain, and a team already in has no "way in" to show.
    const locked = pathTree(s, { ...base, teamId: 1, locks: { [upset.id]: 1, [other.id]: 3 } });
    expect(locked.root.verdict).toBe("In");
    expect(locked.likeliest).toBeNull();
  });

  it("the likeliest way in is the most probable combination that gets the team in, keeping only what it needs", () => {
    nextId = 0;
    // Team 1 is 1-1. Five games left; every combination is checked by hand below.
    const open = [
      game(1, 2, undefined, { spread: 3 }),
      game(3, 4, undefined, { spread: -6 }),
      game(2, 5, undefined, { spread: -2 }),
      game(4, 5, undefined, { spread: 4 }),
      game(3, 5, undefined, { spread: -10 }),
    ];
    const s: Season = {
      year: 2026, fetchedAt: "",
      games: [game(1, 3, 1), game(4, 1, 4), game(2, 3, 3), game(5, 1, 1), ...open],
      teams: [1, 2, 3, 4, 5].map((id) => team(id, "C", 0)),
    };
    const t = pathTree(s, { ...base, teamId: 1 });
    const way = t.likeliest!;
    // Brute force: the likeliest full set of results that proves Team1 in.
    let best = { p: 0, winners: [] as number[] };
    for (let m = 0; m < 1 << open.length; m++) {
      const winners = open.map((g, k) => ((m >> k) & 1 ? g.awayId : g.homeId));
      const locks = Object.fromEntries(open.map((g, k) => [g.id, winners[k]]));
      if (pathTree(s, { ...base, teamId: 1, locks, depth: 0 }).root.verdict !== "In") continue;
      const p = open.reduce((acc, g, k) => acc * (winners[k] === g.homeId ? winProbability(g.spread!) : 1 - winProbability(g.spread!)), 1);
      if (p > best.p) best = { p, winners };
    }
    for (const pick of way.picks) expect(pick.winner).toBe(best.winners[open.findIndex((g) => g.id === pick.gameId)]);
    expect(way.chance).toBeGreaterThanOrEqual(best.p);
    // Locking the picks proves the spot, and every pick is needed: drop any one and it isn't proven.
    const lock = (picks: typeof way.picks) => Object.fromEntries(picks.map((p) => [p.gameId, p.winner]));
    expect(pathTree(s, { ...base, teamId: 1, locks: lock(way.picks), depth: 0 }).root.verdict).toBe("In");
    for (const drop of way.picks) {
      expect(pathTree(s, { ...base, teamId: 1, locks: lock(way.picks.filter((p) => p !== drop)), depth: 0 }).root.verdict).not.toBe("In");
    }
  });

  it("the likeliest way in still holds once locked when schedules differ by several games", () => {
    // Team 1 plays five conference games, team 6 one: past the spread the proof's early stops assume.
    nextId = 500;
    const games = [
      game(1, 2, 1), game(1, 3), game(1, 4), game(1, 5), game(1, 6),
      game(2, 3, 3), game(2, 4), game(3, 5), game(4, 5, 4), game(2, 5),
    ];
    const s6 = season(games, 6);
    let checked = 0;
    for (let id = 1; id <= 6; id++) {
      const way = pathTree(s6, { ...base, teamId: id }).likeliest;
      if (!way) continue;
      const locks = Object.fromEntries(way.picks.map((p) => [p.gameId, p.winner]));
      const v = pathTree(s6, { ...base, teamId: id, locks }).root.verdict;
      if (way.needsTiebreak) expect(v, `team ${id}`).not.toBe("Out");
      else expect(v, `team ${id}`).toBe("In");
      checked++;
    }
    expect(checked).toBeGreaterThan(2);
  });

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
      const opts = { conference: "ACC", teamId: t.id, iterations: 1000, seed: 1 };
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
  }, 60_000);

  it("the likeliest way, tiebreak included, is never likelier than the team's title odds, nor far below them for a contender", () => {
    const snap = JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot;
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    let viaTiebreak = 0;
    for (const weeks of [3, 4]) {
      const cut: Season = {
        ...full,
        games: full.games.map((g) => (g.week > last - weeks ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
      };
      for (const t of cut.teams.filter((x) => x.conference === "ACC")) {
        const tree = pathTree(cut, { conference: "ACC", teamId: t.id, iterations: 2000, seed: 1 });
        const way = tree.likeliest;
        if (!way) continue;
        // One combination of results can't be likelier than every way in together (allowing for sampling noise).
        expect(way.overall).toBeLessThanOrEqual(tree.titleGame + 0.03);
        expect(way.heading).toBe(`${formatOdds(way.overall)} chance`);
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

  it("no result shows a flat 100% or 0% unless it's proven", () => {
    const snap = JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot;
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

  it("a week marks the same side as helping that the team is told to root for", () => {
    const snap = JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot;
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    let checked = 0;
    for (const weeks of [2, 3, 4]) {
      const cut: Season = {
        ...full,
        games: full.games.map((g) => (g.week > last - weeks ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
      };
      for (const t of cut.teams.filter((x) => x.conference === "ACC")) {
        const tree = pathTree(cut, { conference: "ACC", teamId: t.id, iterations: 2000, seed: 2 });
        const help = new Map(tree.help.map((h) => [h.gameId, h]));
        for (const g of tree.weeks.flatMap((w) => w.games)) {
          const h = help.get(g.gameId);
          if (!h || g.helps === null || h.rooting === null || h.ifHomeWins || h.ifAwayWins) continue;
          expect(g.helps, `${t.name}: ${h.label}`).toBe(h.rooting);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  }, 60_000);

  it("the card's rivals and the week by week agree with the picks, for every team", () => {
    const snap = JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot;
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    let rivals = 0;
    for (const weeks of [3, 4]) {
      const cut: Season = {
        ...full,
        games: full.games.map((g) => (g.week > last - weeks ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
      };
      const nameOf = (id: number) => cut.teams.find((x) => x.id === id)!.name;
      for (const t of cut.teams.filter((x) => x.conference === "ACC")) {
        const tree = pathTree(cut, { conference: "ACC", teamId: t.id, iterations: 1000, seed: 1 });
        const way = tree.likeliest;
        if (!way) continue;
        const picked = new Map(way.picks.map((p) => [p.gameId, p.winner]));
        for (const r of way.rivals) {
          // Each of the rival's games says exactly what the picks need from it: a loss, a win, or nothing.
          // In kickoff order.
          const mine = cut.games
            .filter((g) => !g.completed && g.conferenceGame && (g.homeId === r.teamId || g.awayId === r.teamId) && g.homeId !== t.id && g.awayId !== t.id)
            .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.week - b.week || a.id - b.id);
          expect(r.games.map((g) => g.opponent)).toEqual(mine.map((g) => nameOf(g.homeId === r.teamId ? g.awayId : g.homeId)));
          let chance = 1;
          mine.forEach((g, k) => {
            const w = picked.get(g.id);
            expect(r.games[k].result).toBe(w === undefined ? null : w === r.teamId ? "win" : "lose");
            if (w !== undefined) chance *= w === r.teamId ? 1 - r.games[k].chance : r.games[k].chance;
          });
          expect(r.needs).toBe(r.games.filter((g) => g.result === "lose").length);
          expect(r.chance).toBeCloseTo(chance, 12);
          rivals++;
        }
        // No pick is a result the week by week shows knocks the team out.
        for (const g of tree.weeks.flatMap((w) => w.games)) {
          const w = picked.get(g.gameId);
          if (w !== undefined) expect(w === g.homeId ? g.ifHome : g.ifAway).not.toBe("Out");
        }
        for (const w of tree.weeks) {
          const own = w.own && picked.get(w.own.gameId);
          if (w.own && own !== undefined) expect(own === t.id ? w.own.ifWin : w.own.ifLose).not.toBe("Out");
        }
      }
    }
    expect(rivals).toBeGreaterThan(10);
  }, 60_000);

  it("the season by week gives the team's game with its odds either way, and the games elsewhere that matter", () => {
    const { s, upset, other } = needsHelp();
    const t = pathTree(s, { ...base, teamId: 1 });
    expect(t.weeks.map((w) => [w.week, w.label])).toEqual([[1, "Nov 7"], [2, "Nov 14"]]);
    const [first, second] = t.weeks;
    const [win, loss] = t.root.children;
    expect(first.own).toMatchObject({ gameId: upset.id, opponent: "Team2", site: "home", oddsIfWin: win.odds, oddsIfLose: loss.odds });
    expect(first.own!.ifWin).toBe(formatFine(win.odds!));
    expect(first.games).toEqual([]);
    expect(second.own).toBeNull();
    const h = t.help.find((x) => x.gameId === other.id)!;
    expect(second.games).toEqual([{ gameId: other.id, homeId: 3, awayId: 4, home: "Team3", away: "Team4",
      ifHome: formatFine(h.oddsIfHomeWins!), ifAway: formatFine(h.oddsIfAwayWins!), swing: h.swing, likely: 3, matters: true, helps: 3, impact: "big" }]);
    const locked = pathTree(s, { ...base, teamId: 1, locks: { [other.id]: 4 } });
    // Locked, the picked side shows the odds now; the other side is worked out with that pick swapped.
    const swappedIn = pathTree(s, { ...base, iterations: 2000, teamId: 1, locks: { [other.id]: 3 } }).titleGame;
    expect(locked.weeks[1].games[0]).toMatchObject({ ifHome: formatFine(swappedIn), ifAway: formatFine(locked.titleGame), helps: null, impact: null });
    // A locked own game works the same way: its other side is proven or simulated, never left blank.
    const ownLocked = pathTree(s, { ...base, teamId: 1, locks: { [upset.id]: 1, [other.id]: 3 } });
    expect(ownLocked.weeks[0].own!.ifWin).toBe("In");
    expect(ownLocked.weeks[0].own!.ifLose).not.toBe("—");
    // Proven in, the picked side says so instead of 100%.
    expect(ownLocked.weeks[1].games[0].ifHome).toBe("In");
    // With the upset locked in too, Team1 is in: the own game's winning side says so.
    const both = pathTree(s, { ...base, teamId: 1, locks: { [other.id]: 3 } });
    expect(both.weeks[0].own!.ifWin).toBe("In");
  });

  it("a game elsewhere marks the side that helps, and bigger impact means a bigger gap in the odds", () => {
    const snap = JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot;
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    const cut: Season = {
      ...full,
      games: full.games.map((g) => (g.week > last - 3 ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
    };
    const gaps: Record<string, number[]> = { big: [], some: [], small: [] };
    for (const t of cut.teams.filter((x) => x.conference === "ACC")) {
      const tree = pathTree(cut, { conference: "ACC", teamId: t.id, iterations: 1000, seed: 1 });
      for (const g of tree.weeks.flatMap((w) => w.games)) {
        const h = tree.help.find((x) => x.gameId === g.gameId)!;
        if (g.helps === null) { expect(g.impact).toBeNull(); continue; }
        const mine = g.helps === g.homeId ? h.oddsIfHomeWins! : h.oddsIfAwayWins!;
        const theirs = g.helps === g.homeId ? h.oddsIfAwayWins! : h.oddsIfHomeWins!;
        expect(mine).toBeGreaterThan(theirs);
        gaps[g.impact!].push((mine - theirs) / Math.max(tree.titleGame, 0.02));
      }
    }
    expect(gaps.big.length && gaps.some.length && gaps.small.length).toBeGreaterThan(0);
    expect(Math.min(...gaps.big)).toBeGreaterThan(Math.max(...gaps.some));
    expect(Math.min(...gaps.some)).toBeGreaterThan(Math.max(...gaps.small));
  });

  it("a week still being played shows the team's game that's already final, not a bye", () => {
    const { s, other } = needsHelp();
    // Team1's loss at Team4 moves into the same week as Team3 v Team4, which is still to play.
    const games = s.games.map((g) => (g.completed && g.homeId === 4 && g.awayId === 1 ? { ...g, week: other.week, start: other.start } : g));
    const t = pathTree({ ...s, games }, { ...base, teamId: 1 });
    const week = t.weeks.find((w) => w.week === other.week)!;
    expect(week.own).toBeNull();
    expect(week.played).toMatchObject({ opponent: "Team4", site: "away", won: false, score: "14-21" });
    // A week can hold both: Team1 beat Team3 in week 1 and still plays Team2 that week.
    const first = t.weeks.find((w) => w.week !== other.week)!;
    expect(first.played).toMatchObject({ opponent: "Team3", site: "home", won: true, score: "21-14" });
    expect(first.own).not.toBeNull();
  });

  it("a week shows the team's non-conference game, so it doesn't read as a bye", () => {
    const { s, other } = needsHelp();
    const next = game(1, 5, undefined, { conferenceGame: false, week: other.week, start: "2026-11-15T18:00:00Z" });
    const done = game(6, 1, 1, { conferenceGame: false, week: 1, start: "2026-11-06T18:00:00Z" });
    const t = pathTree({ ...s, teams: [...s.teams, team(5, "X"), team(6, "X")], games: [...s.games, next, done] }, { ...base, teamId: 1 });
    const week = t.weeks.find((w) => w.week === other.week)!;
    expect(week.own).toBeNull();
    // With no conference game of its own that week, the week goes by the team's game.
    expect(week.label).toBe("Nov 15");
    expect(week.nonConference).toEqual({ gameId: next.id, opponent: "Team5", site: "home", date: "Nov 15", won: null, score: null });
    // Already played: the result, next to the conference game still to come that week.
    const first = t.weeks.find((w) => w.week === 1)!;
    expect(first.own).not.toBeNull();
    expect(first.nonConference).toMatchObject({ opponent: "Team6", site: "away", won: true, score: "21-14" });
  });

  it("records count locked results as played", () => {
    const { s, upset } = needsHelp();
    const now = teamRecord(s, 1);
    expect(teamRecord(s, 1, { [upset.id]: 1 })).toEqual({ ...now, wins: now.wins + 1, conferenceWins: now.conferenceWins + 1 });
    expect(teamRecord(s, 2, { [upset.id]: 1 })).toMatchObject({ losses: teamRecord(s, 2).losses + 1 });
    // A lock on a game already played changes nothing.
    expect(teamRecord(s, 1, { [s.games[0].id]: 3 })).toEqual(now);
    const picked = seasonOutlook(s, { ...base, locks: { [upset.id]: 2 } }).teams.find((o) => o.teamId === 1)!;
    expect(picked.record).toEqual({ ...now, losses: now.losses + 1, conferenceLosses: now.conferenceLosses + 1 });
  });

  it("a side that helps even a little is marked, and one that can't is not", () => {
    const snap = JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot;
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    const cut: Season = {
      ...full,
      games: full.games.map((g) => (g.week > last - 3 ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
    };
    let faint = 0;
    for (const t of cut.teams.filter((x) => x.conference === "ACC")) {
      const tree = pathTree(cut, { conference: "ACC", teamId: t.id, iterations: 1000, seed: 1 });
      for (const g of tree.weeks.flatMap((w) => w.games)) {
        const h = tree.help.find((x) => x.gameId === g.gameId)!;
        // Proven the same either way (in or out whatever happens): neither side helps.
        if (h.ifHomeWins !== null && h.ifHomeWins === h.ifAwayWins) expect(g.helps).toBeNull();
        if (g.helps !== null && !h.now && !h.scenario) faint++;
      }
    }
    // Some games lean too little to count as mattering, and still show which side helps.
    expect(faint).toBeGreaterThan(0);
  });

  it("fine odds tell long shots apart below 1%", () => {
    expect(formatFine(0.0004)).toBe("<0.1%");
    expect(formatFine(0.004)).toBe("0.4%");
    expect(formatFine(0.0094)).toBe("0.9%");
    expect(formatFine(0.0096)).toBe("1%");
    expect(formatFine(0.42)).toBe("42%");
    expect(formatFine(0)).toBe("0%");
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
    // The season by week still lists it, marked as not mattering, after every game that does.
    const games = pathTree(s, o).weeks.flatMap((w) => w.games);
    const listed = games.find((g) => g.gameId === lopsided.id)!;
    expect(listed.matters).toBe(false);
    expect(listed.helps).toBeNull();
    expect(listed.impact).toBeNull();
    expect(games.indexOf(listed)).toBe(games.length - 1);
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
