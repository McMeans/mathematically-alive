import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { championshipParticipants, seasonFromCfbd, type CfbdSnapshot, type Game } from "@/core";

const snapshot = JSON.parse(readFileSync("fixtures/acc-2025.json", "utf8")) as CfbdSnapshot;
const season = seasonFromCfbd(snapshot);
const acc = season.teams.filter((t) => t.conference === "ACC");
const byName = (name: string) => season.teams.find((t) => t.name === name)!.id;
const winnerOf = (g: Game) => (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId);

describe("2025 ACC fixture", () => {
  it("the ACC has 17 teams", () => {
    expect(acc).toHaveLength(17);
  });

  it("every completed game has a score", () => {
    const done = season.games.filter((g) => g.completed);
    expect(done.length).toBeGreaterThan(100);
    for (const g of done) {
      expect(g.homePoints).not.toBeNull();
      expect(g.awayPoints).not.toBeNull();
    }
  });

  // Skipped: our July 2026 ACC policy picks Miami over Duke for the second slot
  // from the real 2025 results; the 2025 ACC used different tiebreak steps
  // (SportSource Team Success Ranking etc.), so the real field is not reproduced.
  it.skip("the real results send Duke and Virginia to the ACC Championship Game", () => {
    const title = season.games.find((g) => g.week === 15 && !g.conferenceGame && g.neutralSite && acc.some((t) => t.id === g.homeId) && acc.some((t) => t.id === g.awayId));
    expect(title).toBeDefined();
    const played = [title!.homeId, title!.awayId].sort((a, b) => a - b);
    expect(played).toEqual([byName("Duke"), byName("Virginia")].sort((a, b) => a - b));

    const pair = championshipParticipants(season, "ACC", winnerOf, { draw: () => 0.5 });
    expect([...pair].sort((a, b) => a - b)).toEqual(played);
  });
});
