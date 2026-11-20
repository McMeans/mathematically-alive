// Split from tiebreak-big-ten.test.ts: the slowest Big Ten check, on its own so vitest runs it in parallel.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explore, seasonFromCfbd, type CfbdSnapshot } from "@/core";

describe("Big Ten seasons", () => {
  const s = seasonFromCfbd(JSON.parse(readFileSync("fixtures/big-ten-2026.json", "utf8")) as CfbdSnapshot);
  it("a page whose proofs keep running out of budget takes about as long as any other", () => {
    // Penn State in 2026 never reaches the title game in the simulation but can't be proved out, so almost every
    // branch of its tree asks for a proof that comes back open. Timed against Ohio State on the same data, so the
    // machine's speed and coverage instrumentation cancel out. Uncapped it took about 10 times as long; capped, under 3.
        const time = (team: string) => {
      const id = s.teams.filter((t) => t.conference === "Big Ten").find((t) => t.name === team)!.id;
      const t0 = performance.now();
      const e = explore(s, { conference: "Big Ten", teamId: id, iterations: 20_000, seed: 2026 });
      return { ms: performance.now() - t0, e, id };
    };
    const base = time("Ohio State");
    const slow = time("Penn State");
    expect(slow.e.outlook.find((o) => o.teamId === slow.id)!.titleGame).toBe(0);
    expect(slow.ms).toBeLessThan(5 * base.ms);
  }, 180_000);
});
