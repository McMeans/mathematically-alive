// Real-season checks on the 2025 ACC fixture, split over several files so vitest runs them in parallel;
// these are the slowest tests in the suite.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pathTree, seasonFromCfbd } from "@/core";
import type { CfbdSnapshot, Season } from "@/core";
// The 2025 results are checked under the 2026 rules, the only ones core has, so the fixture is loaded as 2026.

describe("help from elsewhere on a real season", () => {
  it("a week marks the same side as helping that the team is told to root for", () => {
    const snap = { ...(JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot), year: 2026 };
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

  it("the card's rivals and the week by week agree with the picks, for every team", () => {
    const snap = { ...(JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot), year: 2026 };
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
    const snap = { ...(JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot), year: 2026 };
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
    const snap = { ...(JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot), year: 2026 };
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
