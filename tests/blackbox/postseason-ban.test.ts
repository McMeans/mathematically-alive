import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  championshipParticipants, explore, playoffRoute, seasonFromCfbd, seasonOutlook, simulateNational, teamPath, type CfbdSnapshot, type Game, type Season,
} from "@/core";

// Tiny made-up MACs. Teams are named by letter; `barred` marks a team barred from the postseason (`postseasonBan`).
type Spec = { name: string; rating?: number; barred?: boolean };
function build(specs: Spec[], conf: [string, string][], open: [string, string][] = []): Season & { id: (n: string) => number } {
  let nextId = 0;
  const teams = specs.map((s, i) => ({
    id: i + 1, name: s.name, abbreviation: null, conference: "Mid-American",
    classification: "fbs" as const, color: null, altColor: null, rating: s.rating ?? 0,
    ...(s.barred ? { postseasonBan: true } : {}),
  }));
  const id = (n: string) => teams.find((t) => t.name === n)!.id;
  const game = (home: number, away: number, winner: number | undefined): Game => ({
    id: nextId++, week: 1, start: "2026-11-07T18:00:00Z", neutralSite: false, conferenceGame: true,
    homeId: home, awayId: away,
    homePoints: winner === undefined ? null : winner === home ? 21 : 14,
    awayPoints: winner === undefined ? null : winner === away ? 21 : 14,
    completed: winner !== undefined, spread: null,
  });
  const games = [...conf.map(([w, l]) => game(id(w), id(l), id(w))), ...open.map(([h, a]) => game(id(h), id(a), undefined))];
  return { year: 2026, fetchedAt: "", teams, games, id };
}
const played = (g: Game) => (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId);
const pair = (s: Season) => championshipParticipants(s, "Mid-American", played, { draw: () => 0 });

describe("a team barred from the postseason", () => {
  it("no FBS team is barred in 2026", () => {
    const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
    expect(season.teams.filter((t) => t.postseasonBan)).toEqual([]);
  });

  it("can't play for its conference title, whatever its record; its games still count for everyone else", () => {
    // X (barred) 3-0; A 2-1, B 1-2, C 0-3.
    const s = build([{ name: "X", barred: true }, { name: "A" }, { name: "B" }, { name: "C" }],
      [["X", "A"], ["X", "B"], ["X", "C"], ["A", "B"], ["A", "C"], ["B", "C"]]);
    expect(pair(s)).toEqual([s.id("A"), s.id("B")]);
  });

  it("a conference needs two teams that can play", () => {
    const s = build([{ name: "X", barred: true }, { name: "A" }], [["X", "A"]]);
    expect(() => pair(s)).toThrow("Mid-American has fewer than two teams eligible for the postseason");
  });

  it("ahead in the standings, it doesn't stop a clinch, and is itself eliminated, with wording that says why", () => {
    // X (barred) 2-0, A 2-1, B 1-1 with D left, C 1-2, D 0-2. Only B can still reach A's 2-1, so A is in for sure;
    // counting X as a rival, it wouldn't be.
    const s = build([{ name: "X", rating: 20, barred: true }, { name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }],
      [["X", "A"], ["X", "B"], ["A", "C"], ["A", "D"], ["B", "C"], ["C", "D"]], [["B", "D"]]);
    const o = seasonOutlook(s, { conference: "Mid-American", iterations: 200, seed: 3 });
    const of = (n: string) => o.teams.find((t) => t.teamId === s.id(n))!;
    expect(of("A").titleGame).toBe(1);
    expect(of("A").status).toBe("clinched");
    expect(of("A").postseasonBan).toBe(false);
    expect(of("X").titleGame).toBe(0);
    expect(of("X").status).toBe("eliminated");
    expect(of("X").postseasonBan).toBe(true);
    expect(playoffRoute(of("X"))).toBe("Barred from the postseason this season: no title game, no playoff");
    const path = teamPath(s, { conference: "Mid-American", teamId: s.id("X"), iterations: 200, seed: 3 });
    expect(path.status).toBe("eliminated");
    expect(path.summary).toBe("X is barred from the postseason this season, so it can't play in the MAC title game.");
  });

  it("a team with a barred leader and one rival ahead still has a likeliest way in", () => {
    // X (barred) 3-0 and B 2-0 are both ahead of A's best (2-1), but only B takes a spot. A's way in starts with
    // beating B; counting X as a rival, A would have no way in at all.
    const s = build(
      [{ name: "X", rating: 20, barred: true }, { name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }],
      [["X", "C"], ["X", "D"], ["X", "E"], ["B", "D"], ["B", "E"], ["D", "A"]],
      [["A", "B"], ["B", "C"], ["A", "C"]],
    );
    const r = explore(s, { conference: "Mid-American", teamId: s.id("A"), iterations: 400, seed: 5 });
    expect(r.outlook.find((o) => o.teamId === s.id("A"))!.status).toBe("alive");
    const picks = new Map(r.tree.likeliest!.picks.map((p) => [p.gameId, p.winner]));
    const game = (h: string, a: string) => s.games.find((g) => g.homeId === s.id(h) && g.awayId === s.id(a))!.id;
    expect(picks.get(game("A", "B"))).toBe(s.id("A"));
    // X's own page: out, and no way in.
    const x = explore(s, { conference: "Mid-American", teamId: s.id("X"), iterations: 400, seed: 5 });
    expect(x.tree.root.outcome).toBe("out");
    expect(x.tree.likeliest).toBeNull();
  });

  it("clinched with a barred leader and two rivals who can't both pass it", () => {
    // X (barred) 4-0 and A 3-1 are done. B and F are 2-0 and play each other: the winner finishes ahead of A, the
    // loser behind. Either can get in, but A is in whatever happens; counting X as one of the two teams ahead of A,
    // a 4-0 X plus a 3-0 winner would leave A out.
    const s = build(
      [{ name: "X", barred: true }, ...["A", "B", "F", "C", "D", "E"].map((name) => ({ name }))],
      [["X", "A"], ["X", "C"], ["X", "D"], ["X", "E"],
        ["A", "C"], ["A", "D"], ["A", "E"], ["B", "C"], ["B", "D"], ["F", "D"], ["F", "E"]],
      [["B", "F"]],
    );
    const o = seasonOutlook(s, { conference: "Mid-American", iterations: 200, seed: 3 });
    const of = (n: string) => o.teams.find((t) => t.teamId === s.id(n))!.status;
    expect(of("A")).toBe("clinched");
    expect([of("B"), of("F")]).toEqual(["alive", "alive"]);
  });

  it("not eliminated when its only way in needs the eligible leader to win every game, with a barred team above", () => {
    // X (barred) 1-0 and A 4-1 are done. C1-C6 are 3-0 and each plays B: a C that wins finishes 4-0, above A; one
    // that loses finishes 3-1, below. A gets in only if B beats all six. Proofs that took X for a team that takes a
    // spot would leave B no room above A and call A eliminated.
    const cs = ["C1", "C2", "C3", "C4", "C5", "C6"];
    const fillers = ["F1", "F2", "F3", "F4"];
    const s = build(
      [{ name: "X", barred: true }, { name: "A" }, { name: "B" }, ...[...cs, ...fillers].map((name) => ({ name }))],
      [["X", "A"], ...fillers.map((f): [string, string] => ["A", f]),
        ...cs.flatMap((c) => fillers.slice(0, 3).map((f): [string, string] => [c, f]))],
      cs.map((c): [string, string] => ["B", c]),
    );
    const o = seasonOutlook(s, { conference: "Mid-American", iterations: 200, seed: 3 });
    expect(o.teams.find((t) => t.teamId === s.id("A"))!.status).not.toBe("eliminated");
  });
});

// The Sun Belt's divisions by the names the data uses; a few members are enough for each case.
const SBC = "Sun Belt";
const EAST = ["App State", "Coastal Carolina", "Georgia Southern", "Georgia State", "James Madison", "Marshall", "Old Dominion"];
const WEST = ["Arkansas State", "Louisiana", "Louisiana Tech", "South Alabama", "Southern Miss", "Troy", "UL Monroe"];
function sunBelt(barred: string[], games: [string, string][], open: [string, string][] = []): Season & { id: (n: string) => number } {
  const teams = [...EAST, ...WEST].map((name, i) => ({
    id: i + 1, name, abbreviation: null, conference: SBC, classification: "fbs" as const, color: null, altColor: null, rating: 0,
    ...(barred.includes(name) ? { postseasonBan: true } : {}),
  }));
  const id = (n: string) => teams.find((t) => t.name === n)!.id;
  const game = (home: string, away: string, winner: string | null, i: number): Game => ({
    id: i, week: 5, start: "2026-11-07T18:00:00Z", neutralSite: false, conferenceGame: true, homeId: id(home), awayId: id(away),
    homePoints: winner === null ? null : winner === home ? 21 : 14, awayPoints: winner === null ? null : winner === away ? 21 : 14,
    completed: winner !== null, spread: null,
  });
  return {
    year: 2026, fetchedAt: "", teams, id,
    games: [...games.map(([w, l], i) => game(w, l, w, i)), ...open.map(([h, a], i) => game(h, a, null, games.length + i))],
  };
}

describe("a barred team in a conference with divisions", () => {
  it("can't win its division: the best eligible record there plays", () => {
    // Troy (barred) 3-0 leads the West; Louisiana 2-1 is next. James Madison 2-1 leads the East.
    const s = sunBelt(["Troy"], [["Troy", "Louisiana"], ["Troy", "UL Monroe"], ["Troy", "James Madison"],
      ["Louisiana", "South Alabama"], ["Louisiana", "App State"], ["James Madison", "Marshall"], ["James Madison", "Old Dominion"]]);
    const p = championshipParticipants(s, SBC, played, { draw: () => 0 });
    expect(new Set(p)).toEqual(new Set([s.id("Louisiana"), s.id("James Madison")]));
  });

  it("a barred division leader doesn't keep the team behind it out", () => {
    // Troy (barred) 3-0 leads the West; Louisiana 2-0 is done. South Alabama and Southern Miss, 0-1, play each
    // other, and the winner can reach only 1-1. Louisiana is in whatever happens; counting Troy, it would be out.
    const s = sunBelt(["Troy"], [["Troy", "South Alabama"], ["Troy", "Southern Miss"], ["Troy", "UL Monroe"],
      ["Louisiana", "Arkansas State"], ["Louisiana", "Louisiana Tech"]], [["South Alabama", "Southern Miss"]]);
    const o = seasonOutlook(s, { conference: SBC, iterations: 200, seed: 3 });
    const of = (n: string) => o.teams.find((t) => t.teamId === s.id(n))!;
    expect(of("Troy").status).toBe("eliminated");
    expect(of("Louisiana").titleGame).toBe(1);
    expect(of("Louisiana").status).toBe("clinched");
  });

  it("a division with no team that can play is an error", () => {
    const s = sunBelt(WEST, [["Troy", "Louisiana"]]);
    expect(() => championshipParticipants(s, SBC, played, { draw: () => 0 })).toThrow("Sun Belt's West division has no team eligible for the postseason");
  });
});

describe("a barred team in the national simulation", () => {
  const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
  const POWER = ["ACC", "Big 12", "SEC", "Big Ten"];
  const base = simulateNational(season, { iterations: 200, seed: 7, conferences: POWER });
  // The team likeliest to make the field, barred.
  const top = [...base.teams].sort((a, b) => b.playoff!.field - a.playoff!.field)[0];
  const banned: Season = { ...season, teams: season.teams.map((t) => (t.id === top.teamId ? { ...t, postseasonBan: true } : t)) };
  const r = simulateNational(banned, { iterations: 200, seed: 7, conferences: POWER });

  it("never plays in its title game or the playoff, but is still ranked", () => {
    const t = r.teams.find((x) => x.teamId === top.teamId)!;
    expect(top.playoff!.field).toBeGreaterThan(0.5);
    expect(t.playoff!.field).toBe(0);
    if (t.titleGame !== null) expect(t.titleGame).toBe(0);
    expect(t.meanRank).toBeLessThan(30);
    r.forEachIteration((_, s) => expect(s.field).toHaveLength(12));
  });
});
