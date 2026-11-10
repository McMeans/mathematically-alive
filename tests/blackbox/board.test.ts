import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { INDEPENDENTS, committeeRanks, explore, exploreIndependent, formatSideOdds, oneIn, seasonFromCfbd, type CfbdSnapshot, type PlayoffRace, type RaceItem, type RaceRow, type Season } from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const byName = (s: Season, name: string) => s.teams.find((t) => t.name === name)!.id;
const N = 600;
const base = { conference: "ACC", iterations: N, seed: 7 };
const LOU = byName(season, "Louisville");
const run = (extra: Partial<Parameters<typeof explore>[1]> = {}) => explore(season, { ...base, teamId: LOU, ...extra });
const r = run();
const board = r.board!;
const me = r.outlook.find((o) => o.teamId === LOU)!;
const pct = (s: string) => Number.parseFloat(s.replace(/[<>%]/g, ""));

describe("odds by final record", () => {
  it("lists every record the team can still finish with, best first, and their shares add up to every season", () => {
    expect(board.recordsNote).toBe("Playoff odds by final record.");
    const wins = board.records.map((x) => x.wins);
    expect(wins).toEqual([...wins].sort((a, b) => b - a));
    expect(board.records.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 6);
    for (const x of board.records) {
      expect(x.record).toBe(`${x.wins}-${x.losses}`);
      expect(x.likely).toMatch(/^(\d+%|<1%|>99%) likely$/);
    }
  });

  it("names the best record left as winning out", () => {
    expect(board.records[0].label).toBe(`${board.records[0].record} · win out`);
    for (const x of board.records.slice(1)) expect(x.label).toBe(x.record);
  });

  it("winning out gives better playoff and title-game odds than the worst record", () => {
    const best = board.records[0], worst = board.records.at(-1)!;
    expect(best.playoff).toBeGreaterThanOrEqual(worst.playoff);
    expect(best.titleGame!).toBeGreaterThanOrEqual(worst.titleGame!);
  });

  it("never shows a flat 0% for a team still alive", () => {
    for (const x of board.records) {
      expect(x.playoffText).not.toBe("0%");
      expect(x.titleGameText).not.toBe("0%");
    }
  });
});

describe("ways into the playoff", () => {
  it("a power-conference team can get in as champion or at-large, and the two add up to its playoff odds", () => {
    const labels = board.ways.map((w) => w.label);
    expect(labels).toContain("Win the ACC");
    const sum = board.ways.reduce((s, w) => s + w.odds, 0);
    expect(sum).toBeCloseTo(me.playoff, 6);
  });

  it("the champion's way says the champion gets a spot", () => {
    expect(board.ways.find((w) => w.label === "Win the ACC")!.text).toBe("The champion gets a spot.");
  });

  it("the at-large way names the record it mostly comes at", () => {
    const at = board.ways.find((w) => w.label === "At-large");
    if (at) expect(at.text).toMatch(/^(Almost only|Mostly) at \d+-\d+\.$|^At \d+-\d+ or \d+-\d+\.$/);
  });
});

describe("help from elsewhere", { timeout: 60_000 }, () => {
  it("groups games by the team to root against, the side to root for first with the better playoff odds", () => {
    expect(board.help.length).toBeGreaterThan(0);
    for (const g of board.help) {
      expect(g.title).toBe(`Root against ${g.team}`);
      expect(g.record).toMatch(/^\d+-\d+ \(\d+-\d+ \S.*\)$|^\d+-\d+$/);
      for (const game of g.games) {
        const [good, bad] = game.sides;
        expect(good.root).toBe(true);
        expect(bad.root).toBe(false);
        expect(bad.teamId).toBe(g.teamId);
        expect(good.playoff).toBeGreaterThan(bad.playoff);
        expect(good.label).toMatch(/ wins$/);
        expect(good.chance).toMatch(/^(\d+%|<1%|>99%) chance$/);
        expect(game.opponentId).toBe(good.teamId);
        expect([good.teamId, bad.teamId]).not.toContain(LOU);
      }
    }
  });

  it("says what each side does to the team's playoff odds today, in points of the odds as shown: a gain for the side to root for", () => {
    const shown = (p: number) => Number(formatSideOdds(p, "alive").replace(/[<>%]/g, ""));
    const today = shown(me.playoff);
    for (const g of board.help) for (const game of g.games) for (const side of game.sides) {
      expect(side.playoffText).toBe(formatSideOdds(side.playoff, "alive"));
      const d = Math.round((shown(side.playoff) - today) * 10) / 10;
      expect(side.playoffChange).toBe(d > 0 ? `+${d}` : d < 0 ? `−${-d}` : null);
    }
    const [good, bad] = board.help[0].games[0].sides;
    expect(good.playoffChange).toMatch(/^\+\d+(\.\d)?$/);
    if (bad.playoffChange !== null) expect(bad.playoffChange).toMatch(/^−\d+(\.\d)?$/);
  });

  it("says how the games were chosen, and that the rest barely matter", () => {
    expect(board.helpNote).toContain("Louisville’s playoff odds by more than a point");
    expect(board.quiet).toBe("Every other game moves Louisville’s odds by less than a point.");
  });

  it("locking the side to root for raises the team's playoff odds", () => {
    const game = board.help[0].games[0];
    const after = run({ locks: { [game.gameId]: game.sides[0].teamId } }).outlook.find((o) => o.teamId === LOU)!;
    expect(after.playoff).toBeGreaterThan(me.playoff);
  });
});

describe("the title game", { timeout: 60_000 }, () => {
  it("names the likeliest matchup, likelier team first", () => {
    const t = board.titleWeek!;
    expect(t.label).toBe("ACC title game");
    const [a, b] = t.teams;
    expect(t.key).toBe([a, b].sort((x, y) => x - y).join("|"));
    const share = (id: number) => r.outlook.find((o) => o.teamId === id)!.titleGame;
    expect(share(a)).toBeGreaterThanOrEqual(share(b));
    expect(t.line).toMatch(/^Likeliest matchup: .+ vs .+\.$/);
  });

  it("gives the team its side of the game only once it is in the likeliest matchup", () => {
    const t = board.titleWeek!;
    if (!t.teams.includes(LOU)) {
      expect(t.mine).toBeNull();
      expect(t.waiting).toBe("Louisville gets a pick here once your picks put it in that matchup.");
    } else expect(t.waiting).toBeNull();
    // Louisville wins every game left: it should reach the likeliest matchup.
    const wins = Object.fromEntries(season.games.filter((g) => !g.completed && (g.homeId === LOU || g.awayId === LOU)).map((g) => [g.id, LOU]));
    const t2 = run({ locks: wins }).board!.titleWeek!;
    if (t2.teams.includes(LOU)) {
      expect(t2.mine!.opponentId).toBe(t2.teams.find((x) => x !== LOU));
      expect(t2.mine!.winText).toMatch(/chance if they meet$|^Too few/);
      expect(pct(t2.mine!.ifWin)).toBeGreaterThanOrEqual(pct(t2.mine!.ifLose));
    }
  });

  it("a picked title-game win puts the team's playoff odds at its title-game odds or better", () => {
    const after = run({ titleLocks: { ACC: LOU } }).outlook.find((o) => o.teamId === LOU)!;
    expect(after.champion).toBeCloseTo(after.titleGame, 6);
    expect(after.playoff).toBeGreaterThanOrEqual(after.titleGame - 1e-9);
    expect(after.playoff).toBeGreaterThan(me.playoff);
  });
});

describe("the team's own games", () => {
  it("lists each game left with the two sides' chances, adding to 100", () => {
    const left = season.games.filter((g) => !g.completed && (g.homeId === LOU || g.awayId === LOU)).map((g) => g.id);
    expect(board.own.map((o) => o.gameId)).toEqual(left);
    for (const o of board.own) {
      expect(o.win).toMatch(/ chance$/);
      const sum = pct(o.win) + pct(o.lose);
      expect(sum).toBeGreaterThanOrEqual(99);
      expect(sum).toBeLessThanOrEqual(101);
    }
  });
});

describe("the playoff race", { timeout: 60_000 }, () => {
  const teams = (race: PlayoffRace) => race.items.filter((x): x is RaceRow => x.kind === "team");
  // The ACC team likeliest to make the field, and the least likely.
  const byOdds = [...r.outlook].sort((a, b) => b.playoff - a.playoff);
  const top = explore(season, { ...base, teamId: byOdds[0].teamId }).board!.race!;
  const bottom = explore(season, { ...base, teamId: byOdds.at(-1)!.teamId }).board!.race!;
  const races = [board.race!, top, bottom];

  it("names the card and its columns", () => {
    expect(board.race!.note).toBe("Projected seeds and final ranking");
    expect(board.race!.columns).toEqual(["Seed", "Team", "Proj.", "Field"]);
  });

  it("shows the page's team once, the field by seed and then the teams out by projected rank", () => {
    for (const race of races) {
      const rows = teams(race);
      expect(rows.filter((x) => x.me)).toHaveLength(1);
      const seeded = rows.filter((x) => x.seed !== null), out = rows.filter((x) => x.seed === null);
      expect(rows.slice(0, seeded.length)).toEqual(seeded);
      for (let k = 1; k < seeded.length; k++) expect(seeded[k].seed!).toBeGreaterThan(seeded[k - 1].seed!);
      for (let k = 1; k < out.length; k++) expect(out[k].projected).toBeGreaterThan(out[k - 1].projected);
      for (const x of rows) {
        expect(x.text).toMatch(/%|In|Out/);
        expect(x.projected).toBeGreaterThan(0);
      }
    }
  });

  it("seeds the field straight by projected rank, with automatic bids below the last at-large team marked", () => {
    for (const race of races) {
      const seeded = teams(race).filter((x) => x.seed !== null);
      for (let k = 1; k < seeded.length; k++) expect(seeded[k].projected).toBeGreaterThan(seeded[k - 1].projected);
      for (const x of teams(race)) {
        if (x.tag !== null) expect(["ACC", "B1G", "SEC", "B12", "G6", "ND"]).toContain(x.tag);
        if (x.seed === null) expect(x.tag).toBeNull();
        if (x.under) expect(x.tag).not.toBeNull();
      }
      // Under the cut, only bids ranked below the last team above it, then the teams out.
      const cut = race.items.findIndex((x) => x.kind === "cut");
      if (cut < 0) continue;
      expect(race.items[cut]).toEqual({ kind: "cut", label: "Last at-large" });
      const aboveCut = race.items.slice(0, cut).filter((x): x is RaceRow => x.kind === "team");
      const lastIn = aboveCut.at(-1)!;
      for (const x of race.items.slice(cut + 1)) {
        if (x.kind !== "team" || x.seed === null) continue;
        expect(x.under).toBe(true);
        expect(x.projected).toBeGreaterThan(lastIn.projected);
      }
    }
  });

  it("gives the Group of Six bid to one team at most", () => {
    for (const race of races) expect(teams(race).filter((x) => x.tag === "G6").length).toBeLessThanOrEqual(1);
  });

  it("puts the teams out under a Next in line heading, after the cut", () => {
    for (const race of races) {
      const next = race.items.findIndex((x) => x.kind === "next");
      const firstOut = race.items.findIndex((x) => x.kind === "team" && x.seed === null);
      if (firstOut < 0) continue;
      expect(race.items[next]).toEqual({ kind: "next", label: "Next in line" });
      expect(next).toBeLessThan(firstOut);
      expect(race.items.findIndex((x) => x.kind === "cut")).toBeLessThan(next);
    }
  });

  it("shows two seeds either side of a team well inside the field, with no cut", () => {
    const rows = teams(top);
    const me = rows.find((x) => x.me)!;
    expect(me.seed).not.toBeNull();
    if (top.items.some((x) => x.kind === "cut")) return;
    expect(rows).toHaveLength(5);
    expect(rows.every((x) => x.seed !== null)).toBe(true);
    const bye = top.items.findIndex((x) => x.kind === "bye");
    if (bye >= 0) {
      expect(top.items[bye]).toEqual({ kind: "bye", label: "First-round byes" });
      expect((top.items[bye - 1] as RaceRow).seed).toBe(4);
    }
  });

  it("shows a far-off team after a gap, below the bubble", () => {
    const rows = teams(bottom);
    const me = rows.at(-1)!;
    expect(me.me).toBe(true);
    expect(me.seed).toBeNull();
    expect(bottom.items.at(-2)).toEqual({ kind: "gap" });
    expect(bottom.items.some((x) => x.kind === "cut")).toBe(true);
    expect(rows.filter((x) => x.seed === null && !x.me).length).toBeGreaterThanOrEqual(2);
  });

  it("moves with the picks: locking the team's games won raises its projected rank", () => {
    const own = board.own.map((g) => g.gameId);
    const locks = Object.fromEntries(own.map((id) => [id, LOU]));
    const after = teams(run({ locks }).board!.race!).find((x) => x.me)!;
    const before = teams(board.race!).find((x) => x.me)!;
    expect(after.projected).toBeLessThanOrEqual(before.projected);
    expect(after.field).toBeGreaterThanOrEqual(before.field);
  });
});

describe("the playoff race on a Group of Six page", { timeout: 60_000 }, () => {
  const rowsOf = (items: RaceItem[]) => items.filter((x): x is RaceRow => x.kind === "team");
  // The MAC teams likeliest and least likely to make the field.
  const mac = { ...base, conference: "Mid-American" };
  const byOdds = [...explore(season, { ...mac, teamId: season.teams.find((t) => t.conference === "Mid-American")!.id }).outlook].sort((a, b) => b.playoff - a.playoff);
  const top = explore(season, { ...mac, teamId: byOdds[0].teamId }).board!.race!;
  const far = explore(season, { ...mac, teamId: byOdds.at(-1)!.teamId }).board!.race!;

  it("a power team's page has no Group of Six block", () => {
    expect(board.race!.g6).toBeNull();
    expect(board.race!.title).toBeNull();
  });

  it("leads with the race for the bid: Group of Six teams by projected rank, the top one over the bid line", () => {
    for (const race of [top, far]) {
      expect(race.g6!.title).toBe("Group of Six bid");
      expect(race.g6!.items[1]).toEqual({ kind: "bid", label: "Top G6 gets the bid" });
      const rows = rowsOf(race.g6!.items);
      for (let k = 1; k < rows.length; k++) expect(rows[k].projected).toBeGreaterThan(rows[k - 1].projected);
      // Only the top one holds the bid; any other in the field got there at large.
      if (rows[0].seed !== null) expect(rows[0].tag).toBe("G6");
      for (const x of rows.slice(1)) expect(x.tag).toBeNull();
      expect([...rows, ...rowsOf(race.items)].filter((x) => x.me)).toHaveLength(1);
    }
  });

  it("lists the first four, or the first three, a gap and a far-down page's team", () => {
    const rows = rowsOf(far.g6!.items);
    expect(rows).toHaveLength(4);
    expect(rows.at(-1)!.me).toBe(true);
    expect(far.g6!.items.at(-2)).toEqual({ kind: "gap" });
    expect(rows.slice(0, 3).some((x) => x.me)).toBe(false);
  });

  it("puts the at-large line under it: the last team in at large, the cut, the first team out", () => {
    for (const race of [top, far]) {
      expect(race.title).toBe("At-large line");
      const cut = race.items.findIndex((x) => x.kind === "cut");
      expect(race.items[cut]).toEqual({ kind: "cut", label: "Last at-large" });
      const above = rowsOf(race.items.slice(0, cut)), below = rowsOf(race.items.slice(cut + 1));
      expect(above.length).toBeLessThanOrEqual(1);
      expect(below.length).toBeLessThanOrEqual(1);
      for (const x of above) expect(x.seed).not.toBeNull();
      for (const x of below) expect(x.seed).toBeNull();
    }
  });
});

describe("an independent's board", () => {
  const ND = season.teams.find((t) => t.conference === INDEPENDENTS || t.name === "Notre Dame")!.id;
  const b = exploreIndependent(season, { iterations: N, seed: 7, teamId: ND }).board!;
  it("has odds by record and help from elsewhere, but no title game or conference way in", () => {
    expect(b.records.length).toBeGreaterThan(0);
    for (const x of b.records) {
      expect(x.titleGame).toBeNull();
      expect(x.titleGameText).toBeNull();
    }
    expect(b.titleWeek).toBeNull();
    expect(b.ways).toEqual([]);
    for (const g of b.help) for (const game of g.games) for (const s of game.sides) expect(s.titleGame).toBeNull();
  });
});

describe("the best shot", { timeout: 60_000 }, () => {
  const shot = board.bestShot!;
  const way = r.tree.likeliest!;
  const ladder = shot.steps.filter((s) => s.kind === "step" || s.kind === "rest");

  it("names its goal, the ACC title game, and sums up the way in one line", () => {
    expect(shot.title).toBe("Way into the ACC title game");
    expect(shot.sub).toBe("The likeliest results that put Louisville in it. Each row adds to the rows above.");
    expect(shot.headline).toBe(way.summary);
    expect(shot.columns).toEqual(["After", "Title game", "Playoff"]);
    expect(shot.fill).toBe("Fill in this path");
    expect(shot.left).toBe("Your picks leave this path.");
  });

  it("starts from today's odds, then the team's own results, then results elsewhere", () => {
    const [today, first] = shot.steps;
    expect(today).toMatchObject({ kind: "today", text: "Today", detail: "", titleAdd: null, playoffAdd: null, results: [] });
    expect(today.titleGame).toBe(`${Math.round(me.titleGame * 100)}%`);
    expect(today.playoff).toBe(`${Math.round(me.playoff * 100)}%`);
    expect(first.text).toBe(`Louisville ${way.ownSummary}`);
    expect(first.detail).toMatch(/^(\d+%|<1%|>99%) likely$/);
  });

  it("splits every result of the way among its steps, each result once", () => {
    const ids = ladder.flatMap((s) => s.results.map((x) => x.gameId));
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(way.picks.map((p) => p.gameId).sort());
    const rest = ladder.find((s) => s.kind === "rest");
    if (rest) {
      expect(rest.text).toBe("Favorites win the rest");
      expect(rest.detail).toBe(`${rest.results.length} ${rest.results.length === 1 ? "game" : "games"}`);
    }
  });

  it("each step's odds count the seasons where it and every step above it happen, and say what it added", () => {
    const n = (s: string) => (s === "In" ? 100 : pct(s));
    let before = shot.steps[0];
    for (const s of ladder) {
      if (s.titleGame !== "—" && before.titleGame !== "—") {
        const d = Math.round(n(s.titleGame)) - Math.round(n(before.titleGame));
        expect(s.titleAdd).toBe(d > 0 ? `+${d}` : d < 0 ? `−${-d}` : null);
      }
      before = s;
    }
    // The whole way clinches the title game, so the last step's title-game odds are at or near certain.
    const last = ladder.at(-1)!;
    if (last.titleGame !== "—") expect(n(last.titleGame)).toBeGreaterThanOrEqual(90);
    // Narrowing to seasons where the team wins out can only help its title-game odds.
    if (ladder[0].titleGame !== "—") expect(n(ladder[0].titleGame)).toBeGreaterThanOrEqual(Math.round(me.titleGame * 100));
  });

  it("ends with winning the title game, against its likeliest opponent on this path", () => {
    const end = shot.steps.at(-1)!;
    if (end.kind === "title") {
      expect(end.text).toBe("Louisville wins the title game");
      expect(end.titleGame).toBe("Won");
      expect(end.detail).toMatch(/^vs .+ · (\d+%|<1%|>99%) chance$/);
      expect(end.results).toEqual([]);
      // The ACC champion gets an automatic bid.
      expect(end.playoff).toBe("In");
    }
  });

  it("says how often all of it happens, and that the ACC champion gets a spot", () => {
    const lead = way.note ? `${way.note} ` : "";
    expect(shot.note.startsWith(lead)).toBe(true);
    expect(shot.note.slice(lead.length)).toMatch(/^All of it happens (in about 1 in \d+ seasons|in fewer than 1 in 100 seasons|in \d+% of seasons)\. The champion gets a playoff spot\.$/);
  });

  it("a team with no likeliest way in left has no best shot", () => {
    const duke = explore(season, { ...base, teamId: byName(season, "Duke") });
    expect(duke.board!.bestShot === null).toBe(duke.tree.likeliest === null || duke.tree.likeliest.picks.length === 0);
  });
});

describe("odds as one in N", () => {
  it("reads a long shot as one in N, and an even or better chance as a percent", () => {
    expect(oneIn(0.2)).toBe("1 in 5");
    expect(oneIn(0.034)).toBe("1 in 29");
    expect(oneIn(0.004)).toBe("<1 in 100");
    expect(oneIn(0.6)).toBe("60%");
  });
});

describe("committee ranks", () => {
  it("tags each team with its place in the latest committee ranking", () => {
    const [a, b, c] = season.teams.map((t) => t.id);
    const ranked = { ...season, committeeRankings: [{ week: 10, postseason: false, teamIds: [a, b] }, { week: 11, postseason: false, teamIds: [b, a, c] }] };
    expect(committeeRanks(ranked)).toEqual({ [b]: "#1", [a]: "#2", [c]: "#3" });
  });

  it("has none before the committee's first ranking", () => {
    expect(committeeRanks({ ...season, committeeRankings: [] })).toEqual({});
    expect(committeeRanks({ ...season, committeeRankings: undefined })).toEqual({});
  });
});
