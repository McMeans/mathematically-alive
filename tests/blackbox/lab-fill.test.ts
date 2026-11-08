import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fillLabLocks, gameWinProbability, seasonFromCfbd, seasonLab, type CfbdSnapshot, type Game, type Season } from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const POWER = ["ACC", "Big 12", "SEC", "Big Ten"];
const base = { iterations: 50, seed: 11, conferences: POWER };
const open = season.games.filter((g) => !g.completed && !g.titleGame);

// A tiny made-up MAC: L 4-0; A and B meet in the last open game, each 2-1 otherwise; X and Y below. A rates higher.
function mac(): Season & { id: (n: string) => number; last: Game } {
  const names = ["L", "A", "B", "X", "Y"];
  const teams = names.map((name, i) => ({
    id: i + 1, name, abbreviation: null, conference: "Mid-American",
    classification: "fbs" as const, color: null, altColor: null, rating: name === "A" ? 10 : 0,
  }));
  const id = (n: string) => teams.find((t) => t.name === n)!.id;
  let next = 0;
  const game = (h: string, a: string, winner?: string): Game => ({
    id: next++, week: 1, start: "2026-11-07T18:00:00Z", neutralSite: false, conferenceGame: true,
    homeId: id(h), awayId: id(a),
    homePoints: winner === undefined ? null : winner === h ? 21 : 14,
    awayPoints: winner === undefined ? null : winner === a ? 21 : 14,
    completed: winner !== undefined, spread: null,
  });
  const played: [string, string][] = [["L", "A"], ["L", "B"], ["L", "X"], ["L", "Y"], ["A", "X"], ["A", "Y"], ["B", "X"], ["Y", "B"]];
  const games = [...played.map(([w, l]) => game(w, l, w)), game("B", "A")];
  return { year: 2026, fetchedAt: "", teams, games, id, last: games[games.length - 1] };
}

describe("season lab: filling the rest", () => {
  it("the same seed and picks give the same season, and a different seed a different one", () => {
    const pick = { games: { [open[0].id]: open[0].awayId } };
    const a = fillLabLocks(season, pick, { seed: 3 });
    expect(fillLabLocks(season, pick, { seed: 3 })).toEqual(a);
    expect(fillLabLocks(season, pick, { seed: 4 }).games).not.toEqual(a.games);
    // Every open game is picked, and the pick already made stays.
    expect(Object.keys(a.games)).toHaveLength(open.length);
    expect(a.games[open[0].id]).toBe(open[0].awayId);
  });

  it("favourites win every open game when asked", () => {
    const { games } = fillLabLocks(season, {}, "favorites");
    for (const g of open) expect(games[g.id]).toBe(gameWinProbability(season, g) >= 0.5 ? g.homeId : g.awayId);
  });

  it("a seeded fill lets underdogs win some games", () => {
    const { games } = fillLabLocks(season, {}, { seed: 1 });
    const upsets = open.filter((g) => games[g.id] !== (gameWinProbability(season, g) >= 0.5 ? g.homeId : g.awayId));
    expect(upsets.length).toBeGreaterThan(0);
    expect(upsets.length).toBeLessThan(open.length / 2);
  });

  it("with every game picked, the summary says so and each conference names its title game", () => {
    const lab = seasonLab(season, { ...base, locks: fillLabLocks(season, {}, { seed: 2 }) });
    expect(lab.open).toBe(0);
    expect(lab.summary).toBe(`${open.length} picks · every game picked · 50 simulated seasons`);
    for (const c of lab.conferences) {
      expect(c.matchup).not.toBeNull();
      expect(c.standings.every((s) => s.open === 0)).toBe(true);
      // An exact matchup's teams play the title game in every simulated season.
      if (c.matchup!.exact) for (const id of c.matchup!.teams) expect(c.teams.find((t) => t.teamId === id)!.titleGame).toBe(1);
    }
  });
});

describe("season lab: conference standings with picks", () => {
  it("with games left, standings count final and picked games, and there's no title game yet", () => {
    const free = seasonLab(season, base);
    const sec = free.conferences.find((c) => c.conference === "SEC")!;
    expect(free.open).toBe(open.length);
    expect(sec.matchup).toBeNull();
    expect(sec.standings.some((s) => s.open > 0)).toBe(true);
    expect(sec.standings[0].text).toMatch(/^\d+-\d+( · \d+ open)?$/);
    // Picking a team's open conference game moves it from open to a win.
    const g = open.find((x) => x.conferenceGame && x.homeId === sec.standings[0].teamId)!;
    const picked = seasonLab(season, { ...base, locks: { games: { [g.id]: g.homeId } }, reuse: free.national });
    const before = sec.standings.find((s) => s.teamId === g.homeId)!;
    const after = picked.conferences.find((c) => c.conference === "SEC")!.standings.find((s) => s.teamId === g.homeId)!;
    expect([after.wins, after.open]).toEqual([before.wins + 1, before.open - 1]);
  });

  // The made-up MAC before its last game: L 4-0, A 2-1, Y 1-2, B 1-2 (beat X, lost to Y), X 0-3; A and B still meet.
  const s = mac();
  const opts = { iterations: 20, seed: 1, conferences: ["Mid-American"] };

  it("a pick on a game already final is ignored in the standings, the matchup and the pick count", () => {
    // A link from before A beat X, picking X: the real result stands.
    const final = s.games.find((g) => g.homeId === s.id("A") && g.awayId === s.id("X"))!;
    const lab = seasonLab(s, { ...opts, locks: { games: { [final.id]: s.id("X"), [s.last.id]: s.id("A") } } });
    expect(lab.picks).toBe(1);
    expect(lab.conferences[0].standings.map((r) => r.text)).toEqual(["4-0", "3-1", "1-2", "1-3", "0-3"]);
    expect(lab.conferences[0].matchup!.teams).toEqual([s.id("L"), s.id("A")]);
  });

  it("picking the last game in a made-up conference names the title game, settled by record", () => {
    expect(seasonLab(s, opts).conferences[0].matchup).toBeNull();
    const c = seasonLab(s, { ...opts, locks: { games: { [s.last.id]: s.id("A") } } }).conferences[0];
    expect(c.matchup).toEqual({ teams: [s.id("L"), s.id("A")], exact: true, steps: [], text: "L vs. A, decided by record." });
    expect(c.standings.map((r) => r.text)).toEqual(["4-0", "3-1", "1-2", "1-3", "0-3"]);
    expect(c.teams.find((t) => t.teamId === s.id("A"))!.titleGame).toBe(1);
  });

  it("a title pick for a team the picks put out of the title game is dropped and not counted", () => {
    const lab = seasonLab(s, { ...opts, locks: { games: { [s.last.id]: s.id("B") }, titles: { "Mid-American": s.id("A") } } });
    expect(lab.picks).toBe(1);
    expect(lab.conferences[0].picked).toBeNull();
    // A pick for a team in the game stands.
    const kept = seasonLab(s, { ...opts, locks: { games: { [s.last.id]: s.id("B") }, titles: { "Mid-American": s.id("B") } } });
    expect([kept.picks, kept.conferences[0].picked]).toEqual([2, s.id("B")]);
  });

  it("a conference whose rules count non-conference results has no matchup while one is open", () => {
    // Every game picked but one Big 12 member's non-conference game, made unplayed here: total wins could still move.
    const big12 = new Set(season.teams.filter((t) => t.conference === "Big 12").map((t) => t.id));
    const nonConf = season.games.find((g) => g.completed && !g.conferenceGame && (big12.has(g.homeId) || big12.has(g.awayId)))!;
    const s2: Season = { ...season, games: season.games.map((g) => (g === nonConf ? { ...g, completed: false, homePoints: null, awayPoints: null } : g)) };
    const all = fillLabLocks(s2, {}, "favorites");
    delete all.games[nonConf.id];
    const lab = seasonLab(s2, { ...base, locks: all });
    expect(lab.conferences.find((c) => c.conference === "Big 12")!.matchup).toBeNull();
    expect(lab.conferences.find((c) => c.conference === "SEC")!.matchup).not.toBeNull();
  });

  it("a tie for second settled by head-to-head names that step", () => {
    // B beats A: both 2-2, and B won the meeting.
    const c = seasonLab(s, { ...opts, locks: { games: { [s.last.id]: s.id("B") } } }).conferences[0];
    expect(c.matchup).toEqual({ teams: [s.id("L"), s.id("B")], exact: true, steps: ["head-to-head"], text: "L vs. B, decided by tiebreak: head-to-head." });
  });

  it("a tie only the ranking stand-in can break isn't called exact", () => {
    // A and B never meet and both go 2-1 against L, X and Y (B beat Y here); X and Y meet last.
    const t: Season = {
      ...s,
      games: [
        ...s.games.filter((g) => g.id !== s.last.id).map((g) => (g.homeId === s.id("Y") && g.awayId === s.id("B") ? { ...g, homeId: s.id("B"), awayId: s.id("Y") } : g)),
        { ...s.last, homeId: s.id("X"), awayId: s.id("Y") },
      ],
    };
    const c = seasonLab(t, { ...opts, locks: { games: { [s.last.id]: s.id("X") } } }).conferences[0];
    expect(c.matchup!.exact).toBe(false);
    expect(c.matchup!.steps).toContain("ranking");
    expect(c.matchup!.text).toBe("Comes down to the ranking tiebreak, which picks can't settle. The odds below are simulated.");
  });
});
