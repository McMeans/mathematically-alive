// A team that is out of its title game is not out of everything: its header, its race row and its page say what is
// proven and what is only a sample, and say it once.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  explore, formatChampion, formatChance, formatPlayoff, formatTitleOdds, oddsLabels, seasonFromCfbd, titleGameOutLine, winsLabel,
  type CfbdSnapshot, type RaceRow, type Season,
} from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json (its snapshot carries no abbreviations).
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const id = (s: Season, name: string) => s.teams.find((t) => t.name === name)!.id;
const FSU = id(season, "Florida State");
const LOU = id(season, "Louisville");
const run = (s: Season, teamId: number) => explore(s, { conference: "ACC", teamId, iterations: 600, seed: 7 });
const fsu = run(season, FSU);
const me = fsu.outlook.find((o) => o.teamId === FSU)!;

describe("a team proven out of its title game", { timeout: 60_000 }, () => {
  it("is Out of the title game and can't win the conference, but its playoff odds read <0.1%, never a flat 0%", () => {
    expect(me.status).toBe("eliminated");
    expect(me.playoff).toBe(0);
    expect(formatTitleOdds(me.titleGame, me.status)).toBe("Out");
    expect(formatPlayoff(me.playoff, me.cfp, me.status, me.autoBid, me.postseasonBan)).toBe("<0.1%");
    expect(formatChampion(me)).toBe("0%");
  });

  it("shows a flat 0% for the playoff only when the team is barred from the postseason", () => {
    expect(formatPlayoff(0, null, "eliminated", false, true)).toBe("0%");
  });

  it("says once that it is out of the title game, and for no team still in it", () => {
    expect(titleGameOutLine("ACC", me)).toBe("Out of the ACC title game. Playoff odds only.");
    expect(titleGameOutLine("Big Ten", { status: "eliminated", titleResult: null })).toBe("Out of the Big Ten title game. Playoff odds only.");
    expect(titleGameOutLine("ACC", { status: "alive", titleResult: null })).toBeNull();
    expect(titleGameOutLine("ACC", { status: "eliminated", titleResult: { won: false, text: "Lost" } })).toBeNull();
  });

  it("when every record reads the same, the board says it once, with the records small under it", () => {
    const flat = fsu.board!.flat!;
    expect(flat.text).toBe("Any finish: <0.1% playoff");
    expect(flat.value).toBe("<0.1%");
    const records = fsu.board!.records;
    expect(flat.records).toBe(records.map((r, k) => `${r.record} ${k === 0 ? r.likely : r.likely.replace(" likely", "")}`).join(" · "));
  });

  it("keeps the record tiles when the playoff odds match but a title-game odds differs", () => {
    const iowaState = id(season, "Iowa State");
    const board = explore(season, { conference: "Big 12", teamId: iowaState, iterations: 600, seed: 7 }).board!;
    expect(new Set(board.records.map((r) => r.playoffText)).size).toBe(1);
    expect(new Set(board.records.map((r) => r.titleGameText)).size).toBeGreaterThan(1);
    expect(board.flat).toBeNull();
  });

  it("keeps the record tiles when the records differ", () => {
    expect(run(season, LOU).board!.flat).toBeNull();
  });
});

describe("one odds format", { timeout: 60_000 }, () => {
  it("the team sheet's title-game odds use one decimal under 1%, like the rest of the page", () => {
    expect(formatChance(0, "alive")).toBe("<0.1%");
    expect(formatChance(0.0004, "alive")).toBe("<0.1%");
    expect(formatChance(0.004, "alive")).toBe("0.4%");
    expect(formatChance(0.42, "alive")).toBe("42%");
    expect(formatChance(1, "alive")).toBe(">99%");
    expect(formatChance(0, "eliminated")).toBe("Out");
    expect(formatChance(1, "clinched")).toBe("In");
  });

  it("the playoff race rail shows <0.1% for a live long shot, never 0%", () => {
    const rows = fsu.board!.race!.items.filter((x): x is RaceRow => x.kind === "team");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.text).toMatch(/^(<0\.1%|>99%|\d+(\.\d)?%)$/);
    expect(rows.find((r) => r.me)!.text).toBe("<0.1%");
  });
});

describe("short result labels", { timeout: 60_000 }, () => {
  it("name the winner in full, and by abbreviation for a narrow button", () => {
    expect(winsLabel("Florida International", "FIU")).toEqual({ full: "Florida International wins", short: "FIU wins" });
    expect(winsLabel("Duke", null)).toEqual({ full: "Duke wins", short: "Duke wins" });
  });

  it("come with each side of a game elsewhere", () => {
    const abbreviated: Season = { ...season, teams: season.teams.map((t) => ({ ...t, abbreviation: t.name.slice(0, 3).toUpperCase() })) };
    const sides = run(abbreviated, LOU).board!.help.flatMap((g) => g.games.flatMap((x) => x.sides));
    expect(sides.length).toBeGreaterThan(0);
    for (const s of sides) {
      const t = abbreviated.teams.find((x) => x.id === s.teamId)!;
      expect(s.label).toBe(`${t.name} wins`);
      expect(s.shortLabel).toBe(`${t.abbreviation} wins`);
    }
  });
});

describe("conference names on the board", { timeout: 60_000 }, () => {
  it("label the odds with the short form and keep the full name in sentences", () => {
    expect(oddsLabels("Sun Belt").champion).toBe("Win SBC");
    expect(oddsLabels("Mountain West").champion).toBe("Win MW");
    expect(oddsLabels("Sun Belt").mustWin).toBe("Must win Sun Belt");
    expect(oddsLabels("Sun Belt").conferenceRecord).toBe("Sun Belt record, counting your picks");
  });
});
