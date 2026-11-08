import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  INDEPENDENTS, conferenceName, conferenceShort, exploreIndependent, formatRecord, formatSideOdds, independentOutlook, oddsLabels, seasonFromCfbd,
  simulateNational, type CfbdSnapshot, type Season,
} from "@/core";

// The 2026 national snapshot through week 9: Notre Dame and UConn are the FBS independents, each with four games left.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const id = (name: string) => season.teams.find((t) => t.name === name)!.id;
const ND = id("Notre Dame");
const UCONN = id("UConn");
const opts = { iterations: 300, seed: 11 };
const POWER = ["ACC", "Big 12", "SEC", "Big Ten"];

describe("FBS independents", () => {
  const { teams, national } = independentOutlook(season, opts);

  it("lists every FBS independent with its playoff odds from the national simulation", () => {
    expect(teams.map((t) => t.teamId)).toEqual([ND, UCONN]);
    for (const t of teams) {
      const n = national.teams.find((x) => x.teamId === t.teamId)!;
      expect(t.playoff).toBe(n.playoff!.field);
      expect(t.cfp).toEqual(n.playoff);
      expect(t.games).toEqual([]);
      expect(t.postseasonBan).toBe(false);
      expect(t.record.conferenceWins + t.record.conferenceLosses).toBe(0);
    }
    expect(teams[0].playoff).toBeGreaterThan(teams[1].playoff);
  });

  it("names how each gets in: Notre Dame's top-12 bid, otherwise at large", () => {
    expect(teams[0].route).toBe("No conference to win: gets in with a top-12 finish in the final ranking (an automatic bid), else at large");
    expect(teams[1].route).toBe("No conference to win: gets in at large");
  });

  it("goes by Independents on the site, with a record that has no conference part", () => {
    expect(conferenceName(INDEPENDENTS)).toBe("Independents");
    expect(conferenceShort(INDEPENDENTS)).toBe("Independents");
    expect(formatRecord({ wins: 7, losses: 1, conferenceWins: 0, conferenceLosses: 0 }, INDEPENDENTS)).toBe("7-1");
    expect(oddsLabels(INDEPENDENTS).playoff).toBe("Playoff");
  });

  it("copies an earlier national run's title races, so its odds match that run", () => {
    const base = simulateNational(season, { ...opts, conferences: POWER });
    const reused = independentOutlook(season, { ...opts, reuse: base });
    expect(reused.national.conferences).toEqual(POWER);
    expect(reused.teams[0].playoff).toBe(base.teams.find((t) => t.teamId === ND)!.playoff!.field);
  });

  it("needs a national simulation", () => {
    expect(() => independentOutlook({ ...season, year: 2025 }, opts)).toThrow("No national simulation for 2025, so no playoff odds for independents");
  });
});

describe("an independent's page", () => {
  const r = exploreIndependent(season, { ...opts, teamId: ND });
  const me = r.outlook.find((o) => o.teamId === ND)!;

  it("lists its unplayed games in schedule order, each with its odds either way and its chance to win", () => {
    const left = season.games.filter((g) => !g.completed && (g.homeId === ND || g.awayId === ND));
    expect(r.games.map((g) => g.gameId)).toEqual(left.map((g) => g.id));
    expect(me.games.map((g) => g.gameId)).toEqual(left.map((g) => g.id));
    for (const g of r.games) {
      expect(g.ifWin).toMatch(/^(<0\.1%|>99%|\d+(\.\d)?%)$/);
      expect(g.winChance).toMatch(/^\d+% to win$/);
      expect(g.date).toMatch(/^[A-Z][a-z]{2} \d+$/);
      expect(g.projected).toBe(false);
      const game = season.games.find((x) => x.id === g.gameId)!;
      expect(g.opponentId).toBe(game.homeId === ND ? game.awayId : game.homeId);
      expect(g.site).toBe(game.neutralSite ? "neutral" : game.homeId === ND ? "home" : "away");
    }
    // Winning helps: over its games, its odds are higher if it wins than if it loses.
    expect(me.games.every((g) => g.playoffIfWin >= g.playoffIfLose)).toBe(true);
    expect(me.games.some((g) => g.playoffIfWin > g.playoffIfLose)).toBe(true);
  });

  it("each result's odds are what picking it shows", () => {
    const g = r.games[0];
    const won = exploreIndependent(season, { ...opts, teamId: ND, locks: { [g.gameId]: ND } });
    const lost = exploreIndependent(season, { ...opts, teamId: ND, locks: { [g.gameId]: g.opponentId } });
    const odds = (x: typeof won) => x.outlook.find((o) => o.teamId === ND)!.playoff;
    expect(formatSideOdds(odds(won), "alive")).toBe(g.ifWin);
    expect(formatSideOdds(odds(lost), "alive")).toBe(g.ifLose);
    // The locked game stays listed, with its odds either way.
    expect(won.games[0].gameId).toBe(g.gameId);
    expect(won.outlook.find((o) => o.teamId === ND)!.record.wins).toBe(me.record.wins + 1);
  });

  it("names results elsewhere that move its playoff odds, none of them its own games", () => {
    for (const s of r.playoffGames) {
      expect(s.homeId).not.toBe(ND);
      expect(s.awayId).not.toBe(ND);
      expect(s.text).toMatch(/^Root for /);
    }
  });

  it("is only for an FBS independent", () => {
    expect(() => exploreIndependent(season, { ...opts, teamId: id("Miami") })).toThrow(`team ${id("Miami")} is not an FBS independent`);
  });

  it("a barred independent is out of the playoff whatever it does, and says why", () => {
    const banned: Season = { ...season, teams: season.teams.map((t) => (t.id === ND ? { ...t, postseasonBan: true } : t)) };
    const b = exploreIndependent(banned, { ...opts, teamId: ND });
    const o = b.outlook.find((x) => x.teamId === ND)!;
    expect(o.playoff).toBe(0);
    expect(o.postseasonBan).toBe(true);
    expect(o.route).toBe("Barred from the postseason this season: no title game, no playoff");
    for (const g of b.games) expect([g.ifWin, g.ifLose]).toEqual(["0%", "0%"]);
  });
});
