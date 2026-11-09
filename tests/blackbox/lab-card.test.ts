import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fillLabLocks, labCard, seasonFromCfbd, seasonLab, type CfbdSnapshot } from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const opts = { iterations: 500, seed: 5, conferences: ["ACC", "Big 12", "SEC", "Big Ten"] };
const base = seasonLab(season, opts);
const team = (id: number) => season.teams.find((t) => t.id === id)!;

describe("season lab: the share card", () => {
  it("shows the projected field by seed, with names and colours, and the title favourite", () => {
    const card = labCard(season, base)!;
    expect(card.heading).toBe(base.playoff!.heading);
    expect(card.picks).toBe("No picks");
    expect(card.field.map((s) => [s.seed, s.teamId])).toEqual(base.playoff!.field.map((s) => [s.seed, s.teamId]));
    for (const s of card.field) expect([s.name, s.color]).toEqual([team(s.teamId).name, team(s.teamId).color]);
    // The favourite is the field's likeliest champion.
    const best = Math.max(...base.playoff!.field.map((s) => s.champion));
    const fav = base.playoff!.field.find((s) => s.champion === best)!;
    expect(card.champion).toMatch(new RegExp(`^Title favorite: ${team(fav.teamId).name}, \\d+%$`));
  });

  it("counts picks, and says so once every game is picked", () => {
    const g = season.games.find((x) => !x.completed && !x.titleGame)!;
    const one = seasonLab(season, { ...opts, locks: { games: { [g.id]: g.homeId } }, reuse: base.national });
    expect(labCard(season, one)!.picks).toBe("1 pick");
    const g2 = season.games.filter((x) => !x.completed && !x.titleGame)[1];
    const two = seasonLab(season, { ...opts, locks: { games: { [g.id]: g.homeId, [g2.id]: g2.awayId } }, reuse: base.national });
    expect(labCard(season, two)!.picks).toBe("2 picks");
    const all = seasonLab(season, { ...opts, locks: fillLabLocks(season, {}, "favorites") });
    expect(labCard(season, all)!.picks).toBe("Every game picked");
  });

  it("names the national champion once a team is picked to win every playoff game it plays", () => {
    const filled = fillLabLocks(season, {}, "favorites");
    const top = seasonLab(season, { ...opts, locks: filled }).playoff!;
    const id = top.field[0].teamId;
    const bracket = Object.fromEntries(top.bracket.map((b) => [b.index, id]));
    // Its conference title too, so the automatic bid puts it in the field in every season.
    const titles = { [team(id).conference!]: id };
    const lab = seasonLab(season, { ...opts, locks: { ...filled, titles, bracket } });
    expect(labCard(season, lab)!.champion).toBe(`National champion: ${team(id).name}`);
  });

  it("has no card when the playoff isn't simulated", () => {
    // Too few conferences for a field.
    expect(labCard(season, seasonLab(season, { ...opts, conferences: ["ACC"] }))).toBeNull();
  });
});
