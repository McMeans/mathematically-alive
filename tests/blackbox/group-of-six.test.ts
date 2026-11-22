import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  mustWinConference, oddsLabels, pathTree, playoffRoute, playoffSignals, seasonFromCfbd, seasonLab, seasonOutlook, simulateNational, simulateSeason,
  type CfbdSnapshot,
} from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const CONFERENCES = ["ACC", "Big 12", "SEC", "Big Ten", "Mid-American", "Conference USA", "Mountain West", "American Athletic", "Pac-12", "Sun Belt"];
const N = 200;
const SEED = 7;
const mac = new Set(season.teams.filter((t) => t.conference === "Mid-American").map((t) => t.id));
const members = (c: string) => new Set(season.teams.filter((t) => t.conference === c).map((t) => t.id));

describe("Group of Six conferences in the national simulation (all six: the MAC, CUSA, the Mountain West, the American, the Pac-12 and the Sun Belt)", { timeout: 120_000 }, () => {
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

  for (const [conference, label] of [["Conference USA", "CUSA"], ["Mountain West", "Mountain West"], ["American Athletic", "American"], ["Pac-12", "Pac 12"], ["Sun Belt", "Sun Belt"]]) {
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

  it("Army-Navy, played after the field is picked, changes no simulated ranking or field", () => {
    const id = (n: string) => season.teams.find((t) => t.name === n)!.id;
    const game = season.games.find((g) => [g.homeId, g.awayId].sort().join() === [id("Army"), id("Navy")].sort().join())!;
    const runs = [id("Army"), id("Navy")].map((winner) => {
      const r = simulateNational(season, { iterations: 50, seed: SEED, conferences: CONFERENCES, locks: { [game.id]: winner } });
      const out: { ranking: number[]; field: number[] | null; titles: (readonly number[])[] }[] = [];
      r.forEachIteration((_, s) => out.push({ ranking: [...s.ranking], field: s.field && [...s.field], titles: CONFERENCES.map((c) => s.titleGame(c)) }));
      return out;
    });
    expect(runs[0].length).toBe(50);
    expect(runs[0][0].field).toHaveLength(12);
    expect(runs[0]).toEqual(runs[1]);
  });

  it("Army's pick of Army-Navy shows its odds unchanged either way", () => {
    // Army rated as a top team here, so it has real playoff and title odds to compare.
    const strong = { ...season, teams: season.teams.map((t) => (t.name === "Army" ? { ...t, rating: 30 } : t)) };
    const army = strong.teams.find((t) => t.name === "Army")!.id;
    const navy = strong.teams.find((t) => t.name === "Navy")!.id;
    const game = strong.games.find((g) => [g.homeId, g.awayId].includes(army) && [g.homeId, g.awayId].includes(navy))!;
    const r = simulateNational(strong, { iterations: 100, seed: SEED, conferences: CONFERENCES, teamId: army });
    const t = r.teams.find((x) => x.teamId === army)!;
    expect(t.playoff!.field).toBeGreaterThan(0.1);
    expect(t.titleGame).toBeGreaterThan(0.1);
    const pick = r.games.find((g) => g.gameId === game.id)!;
    expect([pick.fieldIfWin, pick.fieldIfLose]).toEqual([t.playoff!.field, t.playoff!.field]);
    expect([pick.titleIfWin, pick.titleIfLose]).toEqual([t.titleGame, t.titleGame]);
  });

  it("the Sun Belt's title game is its East champion against its West champion, every season", () => {
    const east = new Set(["App State", "Coastal Carolina", "Georgia Southern", "Georgia State", "James Madison", "Marshall", "Old Dominion"]
      .map((n) => season.teams.find((t) => t.name === n && t.conference === "Sun Belt")!.id));
    expect(east.size).toBe(7);
    national.forEachIteration((_, s) => {
      const [a, b] = s.titleGame("Sun Belt");
      expect(east.has(a)).not.toBe(east.has(b));
    });
  });

  it("Boise State's projected flex game counts toward the playoff, not toward the Pac-12 title game", () => {
    const boise = season.teams.find((t) => t.name === "Boise State")!.id;
    const flex = season.games.find((g) => g.week === 13 && [g.homeId, g.awayId].includes(boise))!;
    expect(flex.conferenceGame).toBe(false);
    expect(season.teams.find((t) => t.id === flex.homeId)!.name).toBe("Colorado State");
    const r = simulateNational(season, { iterations: 100, seed: SEED, conferences: CONFERENCES, teamId: boise });
    const t = r.teams.find((x) => x.teamId === boise)!;
    expect(t.titleGame).toBeGreaterThan(0.1);
    const pick = r.games.find((g) => g.gameId === flex.id)!;
    expect(pick.fieldIfWin).toBeGreaterThan(pick.fieldIfLose);
    expect([pick.titleIfWin, pick.titleIfLose]).toEqual([t.titleGame, t.titleGame]);
  });

  it("Boise State's week-by-week shows its projected flex game in week 13, tagged, with its playoff odds either way", () => {
    const boise = season.teams.find((t) => t.name === "Boise State")!.id;
    const tree = pathTree(season, { conference: "Pac-12", teamId: boise, iterations: N, seed: SEED, depth: 0 });
    const week = tree.weeks.find((w) => w.week === 13)!;
    expect(week.label).toBe("Nov 28");
    expect(week.nonConference).toMatchObject({ opponent: "Colorado State", site: "away", date: "Nov 28", projected: true, won: null, titleIfWin: null });
    expect(week.nonConference!.ifWin).not.toBeNull();
    // A game the data has is never tagged.
    for (const w of tree.weeks) if (w.week !== 13 && w.nonConference) expect(w.nonConference.projected).toBe(false);
    expect(oddsLabels("Pac-12")).toMatchObject({ projected: "Unlisted", projectedNote: "A matchup the league announced that the schedule data doesn't list yet." });
  });

  it("a projected flex game among results elsewhere for the playoff says it's projected", () => {
    const sim = simulateSeason(season, { iterations: 2000, seed: SEED });
    const run = simulateNational(season, { iterations: 2000, seed: SEED, conferences: CONFERENCES }, sim);
    const newMexico = season.teams.find((t) => t.name === "New Mexico")!.id;
    const signals = playoffSignals(season, sim, run, newMexico, 30);
    const flex = signals.find((g) => g.projected)!;
    expect(flex.text).toMatch(/^Root for Colorado State over Boise State: .* A matchup the league announced that the schedule data doesn't list yet\.$/);
    for (const g of signals.filter((x) => !x.projected)) expect(g.text).not.toMatch(/projected/);
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

describe("the Season Lab's bubbles and automatic bids", { timeout: 120_000 }, () => {
  const POWER = new Set(["ACC", "Big 12", "SEC", "Big Ten"]);
  const groupOfSix = (id: number) => {
    const t = season.teams.find((x) => x.id === id)!;
    return t.classification === "fbs" && t.conference !== null && !POWER.has(t.conference) && t.conference !== "FBS Independents";
  };
  const opts = { iterations: 50, seed: 3, conferences: [...POWER] };
  const lab = seasonLab(season, opts);
  const playoff = lab.playoff!;
  const field = playoff.field.map((f) => f.teamId);
  const g6Holder = (p: typeof playoff) => p.field.find((f) => f.tag === "G6")?.teamId;

  it("marks each automatic bid on its seed: a power champion by its conference, the best-placed Group of Six team in the field as G6", () => {
    const SHORT: Record<string, string> = { "Big Ten": "B1G", "Big 12": "B12", SEC: "SEC", ACC: "ACC" };
    for (const f of playoff.field) {
      const champion = lab.champions[f.teamId];
      if (champion !== undefined) expect(f.tag).toBe(SHORT[champion]);
    }
    const order = lab.liveAll.map((t) => t.teamId);
    expect(g6Holder(playoff)).toBe(order.find((id) => field.includes(id) && groupOfSix(id) && lab.champions[id] === undefined));
    expect(playoff.field.filter((f) => f.tag === "G6")).toHaveLength(1);
    expect(playoff.field.some((f) => f.tag === null)).toBe(true);
  });

  it("splits the bubble in two: the next teams out at large, and the best-placed Group of Six teams out for the bid", () => {
    expect(playoff.bubbleTitle).toBe("At-large bubble");
    expect(playoff.bubbleNote).toBe("Next in line for an at-large spot.");
    const race = playoff.g6!;
    expect(race.title).toBe("Group of Six bubble");
    expect(race.note).toBe("Next in line for the Group of Six bid.");
    const order = lab.liveAll.map((t) => t.teamId);
    expect(race.teams.map((t) => t.teamId)).toEqual(order.filter((id) => groupOfSix(id) && !field.includes(id)).slice(0, 4));
    for (const t of race.teams) expect(t.text).toMatch(/^In .+%$/);
  });

  it("picking the bid holder to lose its remaining games hands the G6 mark to another Group of Six team", () => {
    const leader = g6Holder(playoff)!;
    const losses = Object.fromEntries(season.games.filter((g) => !g.completed && !g.titleGame && (g.homeId === leader || g.awayId === leader))
      .map((g) => [g.id, g.homeId === leader ? g.awayId : g.homeId]));
    expect(Object.keys(losses).length).toBeGreaterThan(0);
    const picked = seasonLab(season, { ...opts, locks: { games: losses, titles: {}, bracket: {} } }).playoff!;
    const next = g6Holder(picked);
    expect(next).toBeDefined();
    expect(next).not.toBe(leader);
    expect(groupOfSix(next!)).toBe(true);
  });
});
