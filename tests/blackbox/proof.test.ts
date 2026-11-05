import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { championshipParticipants, explore, formatChance, pathTree, seasonFromCfbd, seasonOutlook, teamPath } from "@/core";
import type { CfbdSnapshot, Game, Season } from "@/core";

let nextId = 0;
function game(home: number, away: number, winner?: number, spread: number | null = null): Game {
  return {
    id: nextId++, week: 1, start: "2026-11-07T18:00:00Z", neutralSite: false, conferenceGame: true, homeId: home, awayId: away,
    homePoints: winner === undefined ? null : winner === home ? 21 : 14,
    awayPoints: winner === undefined ? null : winner === away ? 21 : 14,
    completed: winner !== undefined, spread,
  };
}
const season = (games: Game[]): Season => ({
  year: 2026, fetchedAt: "", games,
  teams: [1, 2, 3, 4].map((id) => ({ id, name: `Team${id}`, abbreviation: null, conference: "ACC", classification: "fbs" as const, color: null, altColor: null, rating: null })),
});
const o = { conference: "ACC", iterations: 2000, seed: 1 };

// Team 1 (1-1) gets in only through a 60-point upset: beating Team 3, or Team 4 beating Team 2 and a three-way tie.
function longshot() {
  nextId = 0;
  const upset1 = game(3, 1, undefined, -60);
  const upset2 = game(2, 4, undefined, -60);
  return { upset1, upset2, s: season([game(1, 4, 1), game(2, 1, 2), game(3, 2, 3), game(3, 4, 3), upset1, upset2]) };
}

describe("proven clinch and elimination", () => {
  it("a team alive only through an unlikely combination is not out, even at 0% in the sample", () => {
    const { s, upset1, upset2 } = longshot();
    const p = teamPath(s, { ...o, teamId: 1 });
    expect(p.titleGame).toBe(0);
    expect(p.status).toBe("alive");
    const me = seasonOutlook(s, o).teams.find((t) => t.teamId === 1)!;
    expect(me.status).toBe("alive");
    expect(formatChance(me.titleGame, me.status)).toBe("<1%");
    expect(pathTree(s, { ...o, teamId: 1 }).root.verdict).toBe("<1%");
    // The combination really does it.
    expect(teamPath(s, { ...o, teamId: 1, locks: { [upset1.id]: 1, [upset2.id]: 4 } }).titleGame).toBeGreaterThan(0);
  });

  it("a team that only gets in as a tied team through the game-count rule is not out", () => {
    nextId = 0;
    // Team 1 is 2-0 in two games. Team 2 is 1-1 in three; beating Team 5 makes it 2-1, the same
    // wins as Team 1, so the two are the "Tied Teams" and both go, past Teams 3 and 4 at 3-1.
    const last = game(2, 5);
    const games = [
      game(1, 2, 1), game(1, 5, 1), game(2, 3, 2),
      game(3, 5, 3), game(3, 6, 3), game(3, 7, 3),
      game(4, 5, 4), game(4, 6, 4), game(4, 7, 4), game(6, 4, 6),
      last,
    ];
    const s: Season = {
      year: 2026, fetchedAt: "", games,
      teams: [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id, name: `Team${id}`, abbreviation: null, conference: "ACC", classification: "fbs" as const, color: null, altColor: null, rating: null })),
    };
    expect(pathTree(s, { ...o, teamId: 2 }).root.verdict).not.toBe("Out");
    expect(pathTree(s, { ...o, teamId: 2, locks: { [last.id]: 2 } }).root.verdict).toBe("In");
    expect(pathTree(s, { ...o, teamId: 2, locks: { [last.id]: 5 } }).root.verdict).toBe("Out");
  });

  it("a team no combination can put in is out, and one no combination can keep out is in", () => {
    const { s, upset1, upset2 } = longshot();
    const out = { ...o, teamId: 1, locks: { [upset1.id]: 3, [upset2.id]: 2 } };
    expect(teamPath(s, out).status).toBe("eliminated");
    expect(pathTree(s, out).root.verdict).toBe("Out");
    const t3 = seasonOutlook(s, { ...o, locks: out.locks }).teams.find((t) => t.teamId === 3)!;
    expect(t3.status).toBe("clinched");
    expect(formatChance(t3.titleGame, t3.status)).toBe("In");
    expect(formatChance(1, "alive")).toBe(">99%");
    expect(formatChance(0.42, "alive")).toBe("42%");
  });

  it("help marks the result elsewhere that would knock the team out", () => {
    const { s, upset1, upset2 } = longshot();
    const h = pathTree(s, { ...o, teamId: 1, locks: { [upset1.id]: 3 } }).help.find((x) => x.gameId === upset2.id)!;
    expect(h.ifHomeWins).toBe("out");
    expect(h.ifAwayWins).toBeNull();
  });

  it("explore gives the same numbers as the separate calls, from one simulation", () => {
    const { s } = longshot();
    const r = explore(s, { ...o, teamId: 3 });
    expect(r.path).toEqual(teamPath(s, { ...o, teamId: 3 }));
    expect(r.tree).toEqual(pathTree(s, { ...o, teamId: 3 }));
    expect(r.outlook).toEqual(seasonOutlook(s, { ...o, teamId: 3 }).teams);
  });
});

describe("proofs agree with checking every combination", () => {
  // Small random conferences (schedules 1 or 2 games apart, so the game-count rule comes into play),
  // each checked against every way its open games can go.
  function randomConference(seed: number): Season {
    let x = seed * 2654435761 >>> 0;
    const rand = () => ((x = (Math.imul(x ^ (x >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296);
    for (;;) {
      nextId = 0;
      const n = 5 + Math.floor(rand() * 2);
      const pairs: [number, number][] = [];
      for (let a = 1; a <= n; a++) for (let b = a + 1; b <= n; b++) pairs.push([a, b]);
      pairs.sort(() => rand() - 0.5);
      const deg = new Array(n + 1).fill(0);
      const most = seed % 3 === 0 ? 5 : 4;
      const picked = pairs.filter(([a, b]) => deg[a] < most && deg[b] < most && (rand() < 0.85) && (deg[a]++, deg[b]++, true));
      const counts = deg.slice(1);
      const spread = Math.max(...counts) - Math.min(...counts);
      if (spread < 1 || spread > 2) continue;
      const games = picked.map(([a, b]) => {
        const done = rand() < 0.45;
        return game(a, b, done ? (rand() < 0.5 ? a : b) : undefined, 0);
      });
      if (games.filter((g) => !g.completed).length > 9) continue;
      return {
        year: 2026, fetchedAt: "", games,
        teams: Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Team${i + 1}`, abbreviation: null, conference: "ACC", classification: "fbs" as const, color: null, altColor: null, rating: 0 })),
      };
    }
  }

  /** Every pair of title-game teams over every way the draws can go (the team's ranking step fixed by `rank`). */
  function everyDraw(s: Season, winnerOf: (g: Game) => number, rank: (id: number) => number): [number, number][] {
    const out: [number, number][] = [];
    const queue: number[][] = [[]];
    while (queue.length) {
      const script = queue.pop()!;
      let j = 0;
      const pair = championshipParticipants(s, "ACC", winnerOf, {
        rank,
        draw: (count) => {
          if (j === script.length) for (let c = 1; c < count; c++) queue.push([...script, c]);
          return ((script[j++] ?? 0) + 0.5) / count;
        },
      });
      out.push(pair);
    }
    return out;
  }

  /** Can the team get in (winning every ranking step), and can it miss (losing every one), over all completions and draws? */
  function bruteForce(s: Season, teamId: number): { canIn: boolean; canOut: boolean } {
    const open = s.games.filter((g) => !g.completed);
    let canIn = false;
    let canOut = false;
    for (let m = 0; m < 1 << open.length && !(canIn && canOut); m++) {
      const pick = new Map(open.map((g, k) => [g.id, (m >> k) & 1 ? g.awayId : g.homeId]));
      const winnerOf = (g: Game) => (g.completed ? (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId) : pick.get(g.id)!);
      if (everyDraw(s, winnerOf, (id) => (id === teamId ? Infinity : 0)).some(([a, b]) => a === teamId || b === teamId)) canIn = true;
      if (everyDraw(s, winnerOf, (id) => (id === teamId ? -Infinity : 0)).some(([a, b]) => a !== teamId && b !== teamId)) canOut = true;
    }
    return { canIn, canOut };
  }

  it("never calls a team in or out wrongly, and settles every team that is", () => {
    let settled = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const s = randomConference(seed);
      const outlook = seasonOutlook(s, { conference: "ACC", iterations: 200, seed: 1 });
      for (const t of outlook.teams) {
        const { canIn, canOut } = bruteForce(s, t.teamId);
        const truth = !canIn ? "eliminated" : !canOut ? "clinched" : "alive";
        expect({ seed, team: t.teamId, status: t.status }).toEqual({ seed, team: t.teamId, status: truth });
        if (truth !== "alive") settled++;
      }
    }
    expect(settled).toBeGreaterThan(150);
  });
});

describe("a team with one rival left", () => {
  it("is in once every other team but one is out, however deep the proof would have to go", () => {
    const snap = JSON.parse(readFileSync("fixtures/acc-2026.json", "utf8")) as CfbdSnapshot;
    const season = seasonFromCfbd(snap);
    const id = (name: string) => season.teams.find((t) => t.name === name)!.id;
    const between = (a: string, b: string) =>
      season.games.find((g) => !g.completed && g.conferenceGame && [g.homeId, g.awayId].includes(id(a)) && [g.homeId, g.awayId].includes(id(b)))!.id;
    // Wake Forest 7-2 with these results; everyone but Miami is out, so Wake Forest takes the other spot.
    const results: [string, string][] = [
      ["Georgia Tech", "Louisville"], ["SMU", "Virginia Tech"], ["Wake Forest", "SMU"],
      ["Miami", "Duke"], ["Wake Forest", "Georgia Tech"], ["Duke", "Wake Forest"],
    ];
    const locks = Object.fromEntries(results.map(([w, l]) => [between(w, l), id(w)]));
    const r = explore(season, { conference: "ACC", teamId: id("Wake Forest"), iterations: 2000, seed: 1, locks });
    const alive = r.outlook.filter((o) => o.status !== "eliminated").map((o) => o.teamId);
    expect(alive.sort()).toEqual([id("Miami"), id("Wake Forest")].sort());
    expect(r.outlook.find((o) => o.teamId === id("Wake Forest"))!.status).toBe("clinched");
    expect(r.tree.root.outcome).toBe("in");
  }, 60_000);
});
