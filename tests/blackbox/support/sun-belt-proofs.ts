import { describe, expect, it } from "vitest";
import { championshipParticipants, pathTree, seasonOutlook, type Game, type Season } from "@/core";
import { SBC, build, played } from "./sun-belt";

/** Registers the brute-force proof check over random seasons `from`..`to`. Split across files so vitest runs the halves in parallel. */
export function sunBeltProofs(from: number, to: number) {
describe(`Sun Belt proofs agree with checking every combination (seeds ${from}-${to})`, () => {
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
    for (let seed = from; seed <= to; seed++) {
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
    expect(settled).toBeGreaterThan(30);
    expect(alive).toBeGreaterThan(30);
  }, 120_000);
});
}
