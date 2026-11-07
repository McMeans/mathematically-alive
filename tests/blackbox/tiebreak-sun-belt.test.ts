import { describe, expect, it } from "vitest";
import {
  championshipParticipants, conferenceName, conferenceShort, explore, hasTiebreakRules, pathTree, seasonOutlook, type Game, type Season,
} from "@/core";

const SBC = "Sun Belt";
const EAST = ["App State", "Coastal Carolina", "Georgia Southern", "Georgia State", "James Madison", "Marshall", "Old Dominion"];
const WEST = ["Arkansas State", "Louisiana", "Louisiana Tech", "South Alabama", "Southern Miss", "Troy", "UL Monroe"];

// The fourteen members by the names the data uses (divisions are configured by name), plus Tulane (FBS) and Nicholls
// (FCS) outside. Only the games a case needs are listed: [winner, loser], conference games unless both aren't members.
// `open` games are unplayed. `ratings` stand in for the CFP ranking and the computer composite.
function build(games: [string, string][], ratings: Record<string, number> = {}, open: ([string, string] | [string, string, number])[] = []): Season & { id: (n: string) => number } {
  const names = [...EAST, ...WEST, "Tulane", "Nicholls"];
  const teams = names.map((name, i) => ({
    id: i + 1, name, abbreviation: null, conference: name === "Tulane" ? "American Athletic" : name === "Nicholls" ? "Southland" : SBC,
    classification: name === "Nicholls" ? ("fcs" as const) : ("fbs" as const), color: null, altColor: null, rating: ratings[name] ?? 0,
  }));
  const id = (n: string) => teams.find((t) => t.name === n)!.id;
  const member = (n: string) => EAST.includes(n) || WEST.includes(n);
  const game = (home: string, away: string, winner: string | null, i: number, spread: number | null = null): Game => ({
    id: i, week: 5 + (i % 8), start: "2026-11-07T18:00:00Z", neutralSite: false, conferenceGame: member(home) && member(away),
    homeId: id(home), awayId: id(away),
    homePoints: winner === null ? null : winner === home ? 21 : 14, awayPoints: winner === null ? null : winner === away ? 21 : 14,
    completed: winner !== null, spread,
  });
  return {
    year: 2026, fetchedAt: "", teams, id,
    games: [...games.map(([w, l], i) => game(w, l, w, i)), ...open.map(([h, a, spread], i) => game(h, a, null, games.length + i, spread ?? null))],
  };
}
const played = (g: Game) => (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId);
const pairWith = (s: Season, d: number) => championshipParticipants(s, SBC, played, { draw: () => d });

// Troy and UL Monroe lead the West at 3-2, 2-1 in division games, and never met. Troy beat Louisiana and Southern Miss
// and James Madison, and lost to Arkansas State and Old Dominion; UL Monroe the other way round against Louisiana,
// Arkansas State, James Madison and Old Dominion, and beat Louisiana Tech. James Madison (3-1) is placed above every
// West team in the whole conference; in the West, Louisiana and Arkansas State are level at 1-1 and split with both.
const westRace = (ratings: Record<string, number> = {}, outside: [string, string][] = []) => build([
  ["Troy", "Louisiana"], ["Arkansas State", "Troy"], ["Troy", "James Madison"], ["Old Dominion", "Troy"], ["Troy", "Southern Miss"],
  ["Louisiana", "UL Monroe"], ["UL Monroe", "Arkansas State"], ["James Madison", "UL Monroe"], ["UL Monroe", "Old Dominion"], ["UL Monroe", "Louisiana Tech"],
  ["James Madison", "Old Dominion"], ["James Madison", "Marshall"],
  ...outside,
], ratings);

describe("Sun Belt tiebreakers", () => {
  it("has rules for 2026 and goes by Sun Belt (SBC where space is tight) on the site", () => {
    expect(hasTiebreakRules(SBC, 2026)).toBe(true);
    expect(conferenceName(SBC)).toBe("Sun Belt");
    expect(conferenceShort(SBC)).toBe("SBC");
  });

  it("each division's champion plays, not the two best records in the conference", () => {
    // James Madison is 2-0. App State (2-1) beat Louisiana, the West's best at 2-1, but is second in the East.
    const s = build([
      ["James Madison", "App State"], ["James Madison", "Marshall"], ["App State", "Georgia Southern"], ["App State", "Louisiana"],
      ["Louisiana", "Troy"], ["Louisiana", "UL Monroe"],
    ]);
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toEqual([s.id("James Madison"), s.id("Louisiana")]);
  });

  it("the champion with the better conference record is seeded first, from either division", () => {
    // Louisiana is 2-0, James Madison 2-1 (it lost to Louisiana).
    const s = build([["Louisiana", "Troy"], ["Louisiana", "James Madison"], ["James Madison", "App State"], ["James Madison", "Coastal Carolina"]]);
    expect(pairWith(s, 0)).toEqual([s.id("Louisiana"), s.id("James Madison")]);
  });

  it("champions level on record: head-to-head between them, then the ranking, seeds them", () => {
    // Both 2-1: Troy beat James Madison and Louisiana and lost to App State; James Madison beat App State and Marshall.
    const met = build([["Troy", "James Madison"], ["Troy", "Louisiana"], ["App State", "Troy"], ["James Madison", "App State"], ["James Madison", "Marshall"]], { "James Madison": 20 });
    expect(pairWith(met, 0)).toEqual([met.id("Troy"), met.id("James Madison")]);
    const apart = build([["James Madison", "Marshall"], ["Troy", "Louisiana"]], { "James Madison": 20 });
    expect(pairWith(apart, 0)).toEqual([apart.id("James Madison"), apart.id("Troy")]);
  });

  it("two tied for a division: head-to-head first", () => {
    // Troy and Louisiana are 2-1 atop the West, and Troy beat Louisiana. Louisiana is 2-1 in the West and rated far
    // higher; Troy is 1-1 there (it lost to UL Monroe and beat Old Dominion).
    const s = build([["Troy", "Louisiana"], ["UL Monroe", "Troy"], ["Troy", "Old Dominion"], ["Louisiana", "UL Monroe"], ["Louisiana", "South Alabama"]], { Louisiana: 30 });
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toContain(s.id("Troy"));
  });

  it("two tied who never met: the better record in division games goes", () => {
    // Troy and Louisiana are 2-1. Troy is 2-0 in the West and lost to James Madison; Louisiana lost to Arkansas State
    // (1-1: it lost to South Alabama).
    const s = build([["Troy", "UL Monroe"], ["Troy", "South Alabama"], ["James Madison", "Troy"],
      ["Louisiana", "Southern Miss"], ["Louisiana", "Marshall"], ["Arkansas State", "Louisiana"], ["South Alabama", "Arkansas State"]], { Louisiana: 30 });
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toContain(s.id("Troy"));
  });

  it("the next-highest-placed opponent counts only the division's standings, not a higher team in the other division", () => {
    // Against Louisiana and Arkansas State (level below them) Troy and UL Monroe are both 1-1, and no lower West team
    // played both. James Madison, whom Troy beat, would decide for Troy if the whole conference counted. Level
    // against common non-division opponents too (1-1 against James Madison and Old Dominion), the ranking decides.
    const s = westRace({ "UL Monroe": 10 });
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toContain(s.id("UL Monroe"));
    const other = westRace({ Troy: 10 });
    for (const d of [0, 0.99]) expect(pairWith(other, d)).toContain(other.id("Troy"));
  });

  it("level through the ranking: overall win pct against FBS teams decides, games against FCS teams left out", () => {
    // Troy lost to Nicholls (FCS), UL Monroe to Tulane (FBS). Counting FCS games they would be level at 3-3.
    const s = westRace({}, [["Nicholls", "Troy"], ["Tulane", "UL Monroe"]]);
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toContain(s.id("Troy"));
  });

  it("level on everything: a coin toss decides", () => {
    const s = westRace();
    expect(new Set([0, 0.99].map((d) => pairWith(s, d).find((id) => id === s.id("Troy") || id === s.id("UL Monroe"))))).toEqual(
      new Set([s.id("Troy"), s.id("UL Monroe")]),
    );
  });

  it("a tie of three or more cut down goes on down the steps, not back to head-to-head", () => {
    // Louisiana, Troy, UL Monroe and South Alabama are 3-2. Among them Louisiana and Troy are 2-1, and Louisiana beat
    // Troy, but Troy is 3-1 in the West and Louisiana 2-2 (Louisiana lost to Arkansas State, Troy to Old Dominion).
    const s = build([
      ["Louisiana", "Troy"], ["Louisiana", "UL Monroe"], ["Troy", "UL Monroe"], ["Troy", "South Alabama"], ["UL Monroe", "South Alabama"], ["South Alabama", "Louisiana"],
      ["Arkansas State", "Louisiana"], ["Louisiana", "Marshall"], ["Troy", "Arkansas State"], ["Old Dominion", "Troy"],
      ["UL Monroe", "Georgia State"], ["UL Monroe", "Coastal Carolina"], ["South Alabama", "Georgia Southern"], ["South Alabama", "App State"],
    ], { Louisiana: 30 });
    for (const d of [0, 0.99]) expect(pairWith(s, d)).toContain(s.id("Troy"));
  });

  it("proofs go by the division: a division leader is in with two better records in the other division, a team behind its leader is out", () => {
    // Every game played. James Madison (3-0) and App State (2-1) top the conference; Louisiana leads the West at 2-1,
    // Troy is 1-1 behind it.
    const s = build([
      ["James Madison", "App State"], ["James Madison", "Marshall"], ["James Madison", "Old Dominion"], ["App State", "Georgia State"], ["App State", "Louisiana"],
      ["Louisiana", "Troy"], ["Louisiana", "UL Monroe"], ["Troy", "South Alabama"],
    ]);
    const status = (n: string) => seasonOutlook(s, { conference: SBC, iterations: 50, seed: 1 }).teams.find((t) => t.teamId === s.id(n))!.status;
    expect(status("Louisiana")).toBe("clinched");
    expect(status("James Madison")).toBe("clinched");
    expect(status("App State")).toBe("eliminated");
    expect(status("Troy")).toBe("eliminated");
  });

  it("with games left, a team can be in or out on its division alone", () => {
    // Louisiana is 3-0. Troy, 0-2 with one game left, can't catch it, however the East goes. UL Monroe, 0-0, plays
    // Louisiana: a win puts it ahead.
    const s = build(
      [["Louisiana", "Troy"], ["Louisiana", "South Alabama"], ["Louisiana", "Arkansas State"], ["Southern Miss", "Troy"]],
      {},
      [["Troy", "Louisiana Tech"], ["UL Monroe", "Louisiana"], ["James Madison", "App State"], ["Marshall", "Old Dominion"]],
    );
    const teams = seasonOutlook(s, { conference: SBC, iterations: 200, seed: 1 }).teams;
    const status = (n: string) => teams.find((t) => t.teamId === s.id(n))!.status;
    expect(status("Troy")).toBe("eliminated");
    expect(status("UL Monroe")).toBe("alive");
    expect(status("Louisiana")).toBe("alive");
    expect(status("James Madison")).toBe("alive");
    const titleGame = (names: string[]) => teams.filter((t) => names.map(s.id).includes(t.teamId)).reduce((a, t) => a + t.titleGame, 0);
    expect(titleGame(EAST)).toBeCloseTo(1);
    expect(titleGame(WEST)).toBeCloseTo(1);
  });

  it("a division leader at 100% in the sample isn't called in while a long-shot upset could still put a rival ahead", () => {
    // Louisiana is 3-0 and plays UL Monroe (0-0) as a 60-point favorite: only an upset puts UL Monroe ahead. The
    // rest of the West has played and can't catch Louisiana.
    const s = build(
      [["Louisiana", "Troy"], ["Louisiana", "South Alabama"], ["Louisiana", "Arkansas State"], ["Troy", "Louisiana Tech"], ["Troy", "Southern Miss"]],
      {},
      [["Louisiana", "UL Monroe", -60]],
    );
    const t = seasonOutlook(s, { conference: SBC, iterations: 200, seed: 1 }).teams.find((x) => x.teamId === s.id("Louisiana"))!;
    expect(t.titleGame).toBe(1);
    expect(t.status).toBe("alive");
  });

  it("a team at 0% in the sample isn't called out while a long-shot upset wins it its division, two better records in the other division or not", () => {
    // Troy is 1-1 and can finish 2-1 at best, below James Madison (3-0) and App State (2-0) in the East. Louisiana
    // (1-0) is a 60-point favorite over Troy; an upset makes Troy the West's best.
    const s = build(
      [["Troy", "UL Monroe"], ["Marshall", "Troy"], ["Louisiana", "Arkansas State"],
        ["James Madison", "Marshall"], ["James Madison", "Old Dominion"], ["James Madison", "Coastal Carolina"], ["App State", "Georgia State"], ["App State", "Georgia Southern"]],
      {},
      [["Louisiana", "Troy", -60]],
    );
    const t = seasonOutlook(s, { conference: SBC, iterations: 200, seed: 1 }).teams.find((x) => x.teamId === s.id("Troy"))!;
    expect(t.titleGame).toBe(0);
    expect(t.status).toBe("alive");
  });

  it("a Sun Belt team's path names the conference and its likeliest way in", () => {
    const s = build(
      [["Louisiana", "Troy"], ["James Madison", "App State"]],
      {},
      [["Troy", "UL Monroe"], ["Louisiana", "Marshall"], ["Troy", "Arkansas State"], ["Georgia State", "Old Dominion"]],
    );
    const r = explore(s, { conference: SBC, teamId: s.id("Troy"), iterations: 400, seed: 1 });
    const text = JSON.stringify([r.path, r.tree.likeliest]);
    expect(text).toMatch(/Sun Belt title game/);
    expect(r.tree.likeliest).not.toBeNull();
    // Troy needs Louisiana to lose: its way names that West rival, never an East team.
    expect(r.tree.likeliest!.rivals.map((x) => x.team)).toContain("Louisiana");
    for (const rival of r.tree.likeliest!.rivals) expect(WEST).toContain(rival.team);
  });
});

describe("Sun Belt proofs agree with checking every combination", () => {
  // Small random seasons among three teams in each division (the other eight never play, so they sit at 0-0),
  // division and cross-division games alike, each checked against every way its open games and draws can go.
  const ACTIVE = ["App State", "James Madison", "Marshall", "Louisiana", "Troy", "UL Monroe"];
  function randomSeason(seed: number) {
    let x = (seed * 2654435761) >>> 0;
    const rand = () => ((x = (Math.imul(x ^ (x >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296);
    const done: [string, string][] = [];
    const open: [string, string][] = [];
    for (let a = 0; a < ACTIVE.length; a++) {
      for (let b = a + 1; b < ACTIVE.length; b++) {
        const r = rand();
        if (r < 0.25) continue;
        if (r < 0.6 && open.length < 8) open.push([ACTIVE[a], ACTIVE[b]]);
        else done.push(rand() < 0.5 ? [ACTIVE[a], ACTIVE[b]] : [ACTIVE[b], ACTIVE[a]]);
      }
    }
    return build(done, {}, open);
  }

  /** Every pair of title-game teams over every way the draws can go (the team's ranking step fixed by `rank`). */
  function everyDraw(s: Season, winnerOf: (g: Game) => number, rank: (id: number) => number): [number, number][] {
    const out: [number, number][] = [];
    const queue: number[][] = [[]];
    while (queue.length) {
      const script = queue.pop()!;
      let j = 0;
      out.push(championshipParticipants(s, SBC, winnerOf, {
        rank,
        draw: (count) => {
          if (j === script.length) for (let c = 1; c < count; c++) queue.push([...script, c]);
          return ((script[j++] ?? 0) + 0.5) / count;
        },
      }));
    }
    return out;
  }

  it("never calls a team in or out wrongly, and settles every team that is", () => {
    let settled = 0;
    let alive = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const s = randomSeason(seed);
      const open = s.games.filter((g) => !g.completed);
      const outlook = seasonOutlook(s, { conference: SBC, iterations: 100, seed: 1 });
      for (const name of ACTIVE) {
        const teamId = s.id(name);
        let canIn = false;
        let canOut = false;
        for (let m = 0; m < 1 << open.length && !(canIn && canOut); m++) {
          const pick = new Map(open.map((g, k) => [g.id, (m >> k) & 1 ? g.awayId : g.homeId]));
          const winnerOf = (g: Game) => (g.completed ? played(g) : pick.get(g.id)!);
          if (everyDraw(s, winnerOf, (id) => (id === teamId ? Infinity : 0)).some((p) => p.includes(teamId))) canIn = true;
          if (everyDraw(s, winnerOf, (id) => (id === teamId ? -Infinity : 0)).some((p) => !p.includes(teamId))) canOut = true;
        }
        const truth = !canIn ? "eliminated" : !canOut ? "clinched" : "alive";
        const status = outlook.teams.find((t) => t.teamId === teamId)!.status;
        expect({ seed, name, status }).toEqual({ seed, name, status: truth });
        // The tree's root runs the proofs whatever the sample says (the outlook only for a sample at 0% or 100%).
        const root = pathTree(s, { conference: SBC, teamId, iterations: 100, seed: 1, depth: 0 }).root.outcome;
        if (root === "in") expect({ seed, name, truth }).toEqual({ seed, name, truth: "clinched" });
        if (root === "out") expect({ seed, name, truth }).toEqual({ seed, name, truth: "eliminated" });
        if (truth === "alive") alive++;
        else settled++;
      }
    }
    expect(settled).toBeGreaterThan(100);
    expect(alive).toBeGreaterThan(100);
  }, 120_000);
});
