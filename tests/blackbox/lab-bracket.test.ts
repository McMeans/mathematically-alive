import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explore, formatPlayoff, seasonFromCfbd, seasonLab, simulateBracket, type CfbdSnapshot, type Season } from "@/core";

const fx = JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot; rankings: { week: number; ranks: { teamId: number }[] }[] };
const first = fx.rankings[0];
const season: Season = { ...seasonFromCfbd(fx.snapshot), committeeRankings: [{ week: first.week, postseason: false, teamIds: first.ranks.map((r) => r.teamId) }] };
const conferences = [...new Set(season.teams.flatMap((t) => (t.classification === "fbs" && t.conference && t.conference !== "FBS Independents" ? [t.conference] : [])))];
const opts = { iterations: 200, seed: 3, conferences };
const lab = (titles: Record<string, number> = {}) => seasonLab(season, { ...opts, locks: { games: {}, titles, bracket: {} } });

describe("lab bracket and title picks", () => {
  it("simulating the bracket crowns a champion, keeps the picks made and plays from the seeds given", () => {
    const games = lab().playoff!.bracket;
    const first = games.find((g) => g.round === "First round")!;
    const kept = "teamId" in first.b ? first.b.teamId : 0;
    const out = simulateBracket(season, games, { [first.index]: kept }, 7);
    expect(out[first.index]).toBe(kept);
    expect(Object.keys(out)).toHaveLength(games.length);
    expect(simulateBracket(season, games, {}, 7)).toEqual(simulateBracket(season, games, {}, 7));
  });

  it("picking a title-game winner leaves both teams' odds in that game as they were", () => {
    const before = lab().conferences.find((c) => c.final)!;
    const after = lab({ [before.conference]: before.final!.teams[0] }).conferences.find((c) => c.conference === before.conference)!;
    expect(after.final!.texts).toEqual(before.final!.texts);
  });

  it("a power conference champion picked in the team view is in the playoff", () => {
    const c = lab().conferences.find((x) => x.conference === "SEC")!;
    const id = c.final!.teams[0];
    const me = explore(season, { conference: "SEC", iterations: 200, seed: 3, teamId: id, locks: {}, titleLocks: { SEC: id } })
      .outlook.find((t) => t.teamId === id)!;
    expect(formatPlayoff(me.playoff, me.cfp, me.status, me.autoBid)).toBe("In");
    expect(me.autoBid).toBe(true);
  });
});
