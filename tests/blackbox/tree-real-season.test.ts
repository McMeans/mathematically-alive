// Real-season checks on the 2025 ACC fixture. Kept apart from tree.test.ts so vitest runs them in
// parallel with the rest; these are the slowest tests in the suite.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatOdds, pathTree, seasonFromCfbd, teamPath } from "@/core";
import type { CfbdSnapshot, Season, TreeNode } from "@/core";

const leaves = (n: TreeNode): TreeNode[] => (n.children.length ? n.children.flatMap(leaves) : [n]);
/** Every root-to-leaf path, as the list of nodes below the root. */
const paths = (n: TreeNode, above: TreeNode[] = []): TreeNode[][] =>
  n.children.length ? n.children.flatMap((c) => paths(c, [...above, c])) : [above];

describe("path tree on a real season", () => {
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
  }, 30_000);
});

describe("help from elsewhere on a real season", () => {
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
  }, 30_000);

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
        const tree = pathTree(cut, { conference: "ACC", teamId: t.id, iterations: 500, seed: 2 });
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

  it("California four weeks out: the card's wording, word for word", () => {
    const snap = JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot;
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

  it("the team's own part reads as a count of the results the way needs from it", () => {
    const snap = JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot;
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    const seen = new Set<string>();
    // These two cuts include a way that needs only some of a team's games, and one that needs none of them.
    for (const weeks of [2, 5]) {
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
      }
    }
    expect([...seen].sort()).toEqual(["either way", "some"]);
  }, 60_000);

  it("the card's rivals and the week by week agree with the picks, for every team", () => {
    const snap = JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot;
    const full = seasonFromCfbd(snap);
    const last = Math.max(...full.games.filter((g) => g.completed).map((g) => g.week));
    let rivals = 0;
    let sharedSeen = false;
    for (const weeks of [3, 4]) {
      const cut: Season = {
        ...full,
        games: full.games.map((g) => (g.week > last - weeks ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)),
      };
      const nameOf = (id: number) => cut.teams.find((x) => x.id === id)!.name;
      for (const t of cut.teams.filter((x) => x.conference === "ACC")) {
        const tree = pathTree(cut, { conference: "ACC", teamId: t.id, iterations: 500, seed: 1 });
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
          // The count under its name adds up to every game it has left.
          const won = r.games.filter((g) => g.result === "win").length;
          const either = r.games.filter((g) => g.result === null).length;
          expect(r.summary).toBe([`${r.needs} ${r.needs === 1 ? "loss" : "losses"}`, won ? `${won} ${won === 1 ? "win" : "wins"}` : "", either ? `${either} either way` : ""].filter(Boolean).join(", "));
          // The minimized line names every rival.
          expect(way.summary).toContain(r.team);
          rivals++;
        }
        // The team's own games, in kickoff order, each with the result the picks need from it.
        const own = cut.games
          .filter((g) => !g.completed && g.conferenceGame && (g.homeId === t.id || g.awayId === t.id))
          .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.week - b.week || a.id - b.id);
        expect(way.ownGames.map((g) => g.opponent)).toEqual(own.map((g) => nameOf(g.homeId === t.id ? g.awayId : g.homeId)));
        own.forEach((g, k) => {
          const w = picked.get(g.id);
          expect(way.ownGames[k].result).toBe(w === undefined ? null : w === t.id ? "win" : "lose");
        });
        expect(way.summary[0]).toBe(way.summary[0].toUpperCase());
        // Rivals that need the same number of losses share a phrase: "Duke and Miami each lose twice".
        const say = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
        for (const r of way.rivals) {
          const shared = way.rivals.filter((x) => x.needs === r.needs).length > 1;
          expect(way.summary).toContain(shared ? `each lose ${say(r.needs)}` : `${r.team} loses ${say(r.needs)}`);
          sharedSeen ||= shared;
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
    expect(sharedSeen).toBe(true);
  }, 60_000);

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
  }, 30_000);

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
  }, 30_000);
});

describe("locked games on a real season", () => {
  // Kansas in the 2026 Big 12 with its likeliest way locked: more than a dozen picks, many of them games elsewhere.
  const kansasLocked = () => {
    const s = seasonFromCfbd(JSON.parse(readFileSync("fixtures/big-12-2026.json", "utf8")) as CfbdSnapshot);
    const opts = { conference: "Big 12", teamId: s.teams.find((t) => t.name === "Kansas")!.id, iterations: 2000, seed: 1 };
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
