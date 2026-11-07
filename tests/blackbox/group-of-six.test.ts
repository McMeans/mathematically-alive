import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mustWinConference, playoffRoute, seasonFromCfbd, seasonOutlook, simulateNational, type CfbdSnapshot } from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const CONFERENCES = ["ACC", "Big 12", "SEC", "Big Ten", "Mid-American", "Conference USA", "Mountain West"];
const N = 200;
const SEED = 7;
const mac = new Set(season.teams.filter((t) => t.conference === "Mid-American").map((t) => t.id));
const members = (c: string) => new Set(season.teams.filter((t) => t.conference === c).map((t) => t.id));

describe("Group of Six conferences in the national simulation (the MAC, CUSA and the Mountain West)", { timeout: 120_000 }, () => {
  const national = simulateNational(season, { iterations: N, seed: SEED, conferences: CONFERENCES });
  const outlook = seasonOutlook(season, { conference: "Mid-American", iterations: N, seed: SEED, reuse: national });

  it("plays the MAC title game: two teams every season, one champion", () => {
    const teams = national.teams.filter((t) => mac.has(t.teamId));
    expect(teams.reduce((s, t) => s + t.titleGame!, 0)).toBeCloseTo(2);
    expect(teams.reduce((s, t) => s + t.champion!, 0)).toBeCloseTo(1);
    national.forEachIteration((_, s) => {
      const [a, b] = s.titleGame("Mid-American");
      expect(mac.has(a) && mac.has(b) && a !== b).toBe(true);
      expect([a, b]).toContain(s.champion("Mid-American"));
    });
  });

  for (const [conference, label] of [["Conference USA", "CUSA"], ["Mountain West", "Mountain West"]]) {
    it(`plays the ${label} title game: two of its teams every season, one of them champion`, () => {
      const ids = members(conference);
      expect(ids.size).toBeGreaterThan(2);
      const teams = national.teams.filter((t) => ids.has(t.teamId));
      expect(teams.reduce((s, t) => s + t.titleGame!, 0)).toBeCloseTo(2);
      expect(teams.reduce((s, t) => s + t.champion!, 0)).toBeCloseTo(1);
      national.forEachIteration((_, s) => {
        const [a, b] = s.titleGame(conference);
        expect(ids.has(a) && ids.has(b) && a !== b).toBe(true);
        expect([a, b]).toContain(s.champion(conference));
      });
    });

    it(`a ${label} team's odds come from the national run, and its route is the Group of Six bid`, () => {
      const outlook = seasonOutlook(season, { conference, iterations: N, seed: SEED, reuse: national });
      expect(outlook.national).not.toBeNull();
      const byId = new Map(national.teams.map((t) => [t.teamId, t]));
      for (const t of outlook.teams) {
        expect(t.playoff).toBe(byId.get(t.teamId)!.playoff!.field);
        expect(t.titleGame).toBe(byId.get(t.teamId)!.titleGame);
        expect(mustWinConference(t)).toBe(false);
        expect(playoffRoute(t)).toMatch(/highest-ranked Group of Six team, conference champion or not/);
      }
    });
  }

  it("a MAC team's playoff odds come from the national run", () => {
    expect(outlook.national).not.toBeNull();
    const field = new Map(national.teams.map((t) => [t.teamId, t.playoff!.field]));
    for (const t of outlook.teams) {
      expect(t.playoff).toBe(field.get(t.teamId));
      expect(t.titleGame).toBe(national.teams.find((x) => x.teamId === t.teamId)!.titleGame);
    }
  });

  it("the route a MAC team is shown is the Group of Six bid, never \"must win\" its conference", () => {
    for (const t of outlook.teams) {
      expect(mustWinConference(t)).toBe(false);
      expect(playoffRoute(t)).toMatch(/highest-ranked Group of Six team, conference champion or not/);
      expect(playoffRoute(t)).not.toMatch(/must win/i);
    }
  });

  it("a power-conference team keeps its champion route, with no Group of Six note", () => {
    const sec = seasonOutlook(season, { conference: "SEC", iterations: N, seed: SEED, reuse: national });
    for (const t of sec.teams) expect(playoffRoute(t)).toBeNull();
    // Reusing the five-conference run leaves the SEC's odds as the run had them.
    const field = new Map(national.teams.map((t) => [t.teamId, t.playoff!.field]));
    for (const t of sec.teams) expect(t.playoff).toBe(field.get(t.teamId));
  });

  it("with the MAC title game played, the Group of Six bid still goes to the top-ranked Group of Six team", () => {
    const g6 = new Set(season.teams.filter((t) => t.classification === "fbs" && t.conference !== null
      && !["ACC", "Big 12", "SEC", "Big Ten", "FBS Independents"].includes(t.conference)).map((t) => t.id));
    national.forEachIteration((_, s) => {
      const top = s.ranking.find((id) => g6.has(id))!;
      expect(s.field).toContain(top);
    });
  });
});
