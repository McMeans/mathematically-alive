import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeLabBracket, encodeLabBracket, fillLabLocks, labCard, labShareCode, readLabShareCode, seasonFromCfbd, seasonLab, type CfbdSnapshot, type LabBracketPicks } from "@/core";

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
    // The link preview: no picks reads as the projection.
    expect(card.title).toBe("Projected playoff field · Season Lab");
    expect(card.description).toBe(`No picks. ${card.champion}.`);
  });

  it("tags each seed that is its conference's projected champion", () => {
    const card = labCard(season, base)!;
    const tagged = card.field.filter((s) => s.tag !== null);
    expect(tagged.length).toBeGreaterThan(0);
    for (const s of tagged) expect(s.tag).toMatch(/^([A-Za-z0-9 ]+ champ|G6 bid)$/);
    for (const s of card.field) {
      const conf = base.champions[s.teamId];
      if (conf) expect(s.tag).toMatch(/ champ$/);
      else expect([null, "G6 bid"]).toContain(s.tag);
    }
    // A power conference's champion is in the field, so each of the four simulated conferences has a tagged seed.
    for (const c of opts.conferences) expect(card.field.some((s) => base.champions[s.teamId] === c)).toBe(true);
  });

  it("tags the best-seeded Group of Six team as the G6 bid, and only one", () => {
    // In this projection Boise State (Pac-12, outside the 2026 power conferences) is the field's only Group of Six team.
    const card = labCard(season, base)!;
    const g6 = card.field.filter((s) => s.tag === "G6 bid");
    expect(g6.map((s) => [s.seed, s.name])).toEqual([[12, "Boise State"]]);
    // Power-conference at-large teams carry no tag.
    expect(card.field.filter((s) => s.tag === null).map((s) => s.name)).toEqual(["Indiana", "Kentucky", "Texas", "LSU", "BYU", "Alabama", "USC"]);
  });

  it("counts picks, and says so once every game is picked", () => {
    const g = season.games.find((x) => !x.completed && !x.titleGame)!;
    const one = seasonLab(season, { ...opts, locks: { games: { [g.id]: g.homeId } }, reuse: base.national });
    expect(labCard(season, one)!.picks).toBe("1 pick");
    expect(labCard(season, one)!.title).toBe("Playoff picks · Season Lab");
    expect(labCard(season, one)!.description).toMatch(/^1 pick\. Title favorite: .+, \d+%\.$/);
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

describe("season lab: a filled-in bracket on the share card", () => {
  const seeds = [...base.playoff!.field].sort((a, b) => a.seed - b.seed).map((s) => s.teamId);
  const games = base.playoff!.bracket;
  /** Every game picked for the side listed first: a known seed, or the winner of the game feeding it. */
  const chalk = (upTo = games.length): LabBracketPicks => {
    const picks: Record<number, number> = {};
    for (const g of games.slice(0, upTo)) picks[g.index] = "teamId" in g.a ? g.a.teamId : picks[g.a.winnerOf];
    return { seeds, picks };
  };

  it("a bracket's picks survive the trip through a link", () => {
    const full = chalk();
    expect(decodeLabBracket(season, encodeLabBracket(full))).toEqual(full);
    expect(decodeLabBracket(season, encodeLabBracket({ seeds, picks: {} }))).toEqual({ seeds, picks: {} });
  });

  it("drops a bracket from a link that doesn't fit the season", () => {
    expect(decodeLabBracket(season, null)).toBeNull();
    expect(decodeLabBracket(season, "not a bracket!")).toBeNull();
    // Too few seeds for the 12-team format.
    expect(decodeLabBracket(season, encodeLabBracket({ seeds: seeds.slice(0, 4), picks: {} }))).toBeNull();
    // A team the season doesn't have.
    expect(decodeLabBracket(season, encodeLabBracket({ seeds: [...seeds.slice(0, 11), 999_999_999], picks: {} }))).toBeNull();
    // The 1 seed picked to win a first-round game it has a bye from.
    const first = games.find((g) => g.round === "First round")!;
    expect(decodeLabBracket(season, encodeLabBracket({ seeds, picks: { [first.index]: seeds[0] } }))).toBeNull();
    // A quarterfinal winner from a first-round game nobody has picked yet.
    const quarter = games.find((g) => g.round === "Quarterfinal" && "winnerOf" in g.b)!;
    const fed = games[(quarter.b as { winnerOf: number }).winnerOf];
    const unpicked = "teamId" in fed.a ? fed.a.teamId : 0;
    expect(decodeLabBracket(season, encodeLabBracket({ seeds, picks: { [quarter.index]: unpicked } }))).toBeNull();
    // A winner that isn't in the bracket can't be written at all.
    expect(() => encodeLabBracket({ seeds, picks: { 0: 999_999_999 } })).toThrow();
  });

  it("a fully picked bracket shows every game and names my champion", () => {
    const full = chalk();
    const card = labCard(season, base, full)!;
    const champ = full.picks[games.length - 1];
    expect(card.heading).toBe("My playoff bracket");
    expect(card.title).toBe("My playoff bracket · Season Lab");
    expect(card.champion).toBe(`My champion: ${team(champ).name}`);
    expect(card.description).toBe(`Every playoff game picked. My champion: ${team(champ).name}.`);
    expect(card.bracket!.picked).toBe("Every playoff game picked");
    expect(card.bracket!.champion).toEqual({ seed: seeds.indexOf(champ) + 1, teamId: champ, name: team(champ).name, abbr: team(champ).abbreviation ?? team(champ).name });
    expect(card.bracket!.games.map((g) => g.round)).toEqual(games.map((g) => g.round));
    for (const g of card.bracket!.games) {
      const real = games[g.index];
      expect(g.feeders).toEqual([real.a, real.b].flatMap((x) => ("winnerOf" in x ? [x.winnerOf] : [])));
      expect(g.winner).toBe(full.picks[g.index]);
      expect([g.a?.teamId, g.b?.teamId]).toContain(g.winner);
    }
    // Shown only: the bracket moves nothing else on the card.
    expect(card.field).toEqual(labCard(season, base)!.field);
  });

  it("a part-picked bracket counts its picks, leaves unknown sides open and keeps the title favourite", () => {
    const part = chalk(3);
    const card = labCard(season, base, part)!;
    expect(card.bracket!.picked).toBe(`3 of ${games.length} playoff games picked`);
    expect(card.bracket!.champion).toBeNull();
    expect(card.champion).toBe(labCard(season, base)!.champion);
    expect(card.description).toBe(`3 of ${games.length} playoff games picked. ${card.champion}.`);
    // The final's sides wait on picks not yet made.
    expect(card.bracket!.games.at(-1)).toMatchObject({ a: null, b: null, winner: null });
    // A quarterfinal fed by a picked first-round game shows that winner.
    const fedQuarter = card.bracket!.games.find((g) => g.round === "Quarterfinal" && g.b !== null && g.b.teamId === part.picks[0]);
    expect(fedQuarter).toBeDefined();
  });

  it("a bracket with no picks leaves the card as the projected field", () => {
    expect(labCard(season, base, { seeds, picks: {} })).toEqual(labCard(season, base));
    expect(labCard(season, base)!.bracket).toBeNull();
  });

  it("a shared link carries the picks code and the bracket code together", () => {
    expect(labShareCode("AgAB", "AQwB")).toBe("AgAB~AQwB");
    expect(readLabShareCode("AgAB~AQwB")).toEqual({ picks: "AgAB", bracket: "AQwB" });
    expect(labShareCode("AgAB", null)).toBe("AgAB");
    expect(readLabShareCode("AgAB")).toEqual({ picks: "AgAB", bracket: null });
    // A bracket with no other picks.
    expect(labShareCode(null, "AQwB")).toBe("~AQwB");
    expect(readLabShareCode("~AQwB")).toEqual({ picks: "", bracket: "AQwB" });
    expect(readLabShareCode("AgAB~")).toEqual({ picks: "AgAB", bracket: null });
  });
});
