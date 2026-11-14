import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explore, fillLabLocks, formatPlayoff, labChanges, seasonFromCfbd, seasonLab, simulateBracket, type CfbdSnapshot, type Season } from "@/core";

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

describe("lab records and change headline", () => {
  it("a picked title game counts in both teams' records", () => {
    const c = lab().conferences.find((x) => x.final?.exact) ?? lab().conferences.find((x) => x.final)!;
    const [w, l] = c.final!.teams;
    const before = lab().records, after = lab({ [c.conference]: w }).records;
    const parse = (r: string) => r.split("-").map(Number);
    expect(parse(after[w])).toEqual([parse(before[w])[0] + 1, parse(before[w])[1]]);
    expect(parse(after[l])).toEqual([parse(before[l])[0], parse(before[l])[1] + 1]);
  });

  it("a batch of field changes names up to four a line and counts the rest, so the headline stays short", () => {
    const filled = seasonLab(season, { ...opts, locks: fillLabLocks(season, {}, { seed: 9 }, conferences) });
    const h = labChanges(season, lab(), filled).headline;
    const { lines } = labChanges(season, lab(), filled);
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const l of lines) expect(l.text.split(" · ").length).toBeLessThanOrEqual(4);
    expect(h).toBe(lines.length ? lines.map((l) => `${l.label}: ${l.text}`).join(". ") : "No change to the field.");
  });

  it("a title pick the simulation can't honor gives no automatic bid", () => {
    const c = lab().conferences.find((x) => x.conference === "SEC")!;
    const out = c.standings.find((t) => !c.teams.some((x) => x.teamId === t.teamId))!.teamId;
    const me = explore(season, { conference: "SEC", iterations: 200, seed: 3, teamId: out, locks: {}, titleLocks: { SEC: out } })
      .outlook.find((t) => t.teamId === out)!;
    expect(me.autoBid).toBe(false);
  }, 30_000);
});
