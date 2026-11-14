import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fillLabLocks, labChanges, seasonFromCfbd, seasonLab, simulateNational, type CfbdSnapshot } from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const opts = { iterations: 2000, seed: 11, conferences: ["ACC", "Big 12", "SEC", "Big Ten"] };
const base = seasonLab(season, opts);
const name = (id: number) => season.teams.find((t) => t.id === id)!.name;
// The biggest game, picked for its underdog.
const big = season.games.find((g) => g.id === base.bigGames[0].gameId)!;
const underdog = base.national.swings.find((s) => s.gameId === big.id)!.home >= 0.5 ? big.awayId : big.homeId;
const home0 = (id: number) => base.national.swings.find((s) => s.gameId === id)!.home;
const favourite = underdog === big.homeId ? big.awayId : big.homeId;
const upset = seasonLab(season, { ...opts, locks: { games: { [big.id]: underdog } }, reuse: base.national });

describe("season lab: what a pick changed", () => {
  it("the change log names the team that entered the field after a pick, and the team that left", () => {
    const { headline, movers } = labChanges(season, base, upset);
    const before = new Set(base.playoff!.field.map((s) => s.teamId));
    const after = new Set(upset.playoff!.field.map((s) => s.teamId));
    const entered = upset.playoff!.field.filter((s) => !before.has(s.teamId));
    const left = base.playoff!.field.filter((s) => !after.has(s.teamId));
    expect(entered.length).toBeGreaterThan(0);
    for (const s of entered) expect(headline).toContain(`${name(s.teamId)} in at ${s.seed}`);
    for (const s of left) expect(headline).toContain(`${name(s.teamId)} out`);
    // The beaten favourite's playoff odds fall, and it is among the movers.
    const fav = movers.find((m) => m.teamId === favourite)!;
    expect(fav.what).toBe("field");
    expect(fav.after).toBeLessThan(fav.before);
    expect(fav.text).toMatch(new RegExp(`^${name(favourite)}: playoff \\d+% → \\d+%$`));
    expect(movers.length).toBeLessThanOrEqual(5);
    for (let k = 1; k < movers.length; k++) expect(Math.abs(movers[k].after - movers[k].before)).toBeLessThanOrEqual(Math.abs(movers[k - 1].after - movers[k - 1].before));
  });

  it("a pick that reorders the field without changing it names the seed moves", () => {
    // The first big game whose either result only reshuffles seeds.
    const field = (l: typeof base) => l.playoff!.field.map((x) => x.teamId).sort().join();
    let found: typeof base | undefined;
    for (const b of base.bigGames) {
      const g = season.games.find((x) => x.id === b.gameId)!;
      for (const w of [g.homeId, g.awayId]) {
        const l = seasonLab(season, { ...opts, locks: { games: { [g.id]: w } }, reuse: base.national });
        if (!found && field(l) === field(base) && l.playoff!.field.some((x, k) => x.teamId !== base.playoff!.field[k].teamId)) found = l;
      }
      if (found) break;
    }
    if (!found) throw new Error("no pick only reshuffles seeds");
    const was = new Map(base.playoff!.field.map((x) => [x.teamId, x.seed]));
    const moves = labChanges(season, base, found).headline.replace(/\.$/, "").split(", ");
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.length).toBeLessThanOrEqual(2);
    for (const m of moves) {
      const s = found.playoff!.field.find((x) => m.startsWith(`${name(x.teamId)} `))!;
      expect(m).toBe(`${name(s.teamId)} ${s.seed < was.get(s.teamId)! ? "up" : "down"} to ${s.seed}`);
    }
  }, 30_000);

  it("comparing a run with itself changes nothing", () => {
    expect(labChanges(season, base, base)).toEqual({ headline: "No change to the projected field.", movers: [] });
  });

  it("with no playoff simulated, the change log has no headline and follows title-game odds", () => {
    const acc = { ...opts, conferences: ["ACC"] };
    const a = seasonLab(season, acc);
    const g = season.games.find((x) => !x.completed && x.conferenceGame && season.teams.find((t) => t.id === x.homeId)?.conference === "ACC")!;
    const b = seasonLab(season, { ...acc, locks: { games: { [g.id]: g.awayId } } });
    const { headline, movers } = labChanges(season, a, b);
    expect(headline).toBe("");
    expect(movers.every((m) => m.what === "title game" && m.text.includes(": title game "))).toBe(true);
    expect(a.bigGames).toEqual([]);
  });
});

describe("season lab: ranking reasons and big games", () => {
  it("every ranked team carries its average record and what lifts it", () => {
    for (const r of base.ranking) {
      expect(r.reason).toMatch(/^About \d+-\d+( · .+)?$/);
      // The record adds up to the team's average games played, rounded.
      const [w, l] = r.reason.slice(6).split(" ")[0].split("-").map(Number);
      const p = base.national.teams.find((t) => t.teamId === r.teamId)!.profile;
      expect(w + l).toBe(Math.round(p.wins + p.losses));
    }
    // The top team's record lifts it above the listed average.
    expect(base.ranking[0].reason).toContain("strong record");
    // Rating and schedule lift some teams.
    expect(base.ranking.some((r) => r.reason.includes("strong team rating"))).toBe(true);
    expect(base.ranking.some((r) => r.reason.includes("tough schedule"))).toBe(true);
    // A likely power-conference champion in the list says so.
    expect(base.ranking.some((r) => /(SEC|Big Ten|Big 12|ACC) title in \d+%/.test(r.reason))).toBe(true);
    const top = base.national.teams[0].profile;
    expect(top.wins + top.losses).toBeGreaterThanOrEqual(12);
  });

  it("big games are the open games that move the field most, and a picked game drops out", () => {
    expect(base.bigGames.length).toBeGreaterThan(0);
    expect(base.bigGames.length).toBeLessThanOrEqual(15);
    for (let k = 0; k < base.bigGames.length; k++) {
      const g = base.bigGames[k];
      expect(g.spots).toBeGreaterThanOrEqual(0.1);
      if (k > 0) expect(g.spots).toBeLessThanOrEqual(base.bigGames[k - 1].spots);
      expect(g.text).toBe(`Swings about ${g.spots.toFixed(1)} ${g.spots.toFixed(1) === "1.0" ? "spot" : "spots"} in the field`);
      expect(season.games.find((x) => x.id === g.gameId)!.completed).toBe(false);
      // Neither side wins it more than 90% of the time.
      const home = base.national.swings.find((x) => x.gameId === g.gameId)!.home;
      expect(home).toBeGreaterThanOrEqual(0.1);
      expect(home).toBeLessThanOrEqual(0.9);
    }
    expect(upset.bigGames.some((g) => g.gameId === big.id)).toBe(false);
    expect(upset.national.swings.find((s) => s.gameId === big.id)!.spots).toBe(0);
  });

  it("with one game left open, its swing matches the field odds with it locked each way", () => {
    // Every other game picked: only this game, the title games and the ranking's noise vary, so the field odds in
    // the seasons the home team wins match a run with the home team locked in (within sampling error).
    // The biggest game closest to a toss-up, so both sides have plenty of seasons.
    const g = season.games.find((x) => x.id === [...base.bigGames].sort((p, q) => Math.abs(home0(p.gameId) - 0.5) - Math.abs(home0(q.gameId) - 0.5))[0].gameId)!;
    const rest = fillLabLocks(season, {}, "favorites").games;
    delete rest[g.id];
    const run = (games: Record<number, number>) => simulateNational(season, { ...opts, iterations: 5000, locks: games });
    const open = run(rest);
    const home = run({ ...rest, [g.id]: g.homeId });
    const away = run({ ...rest, [g.id]: g.awayId });
    const field = (r: typeof open) => new Map(r.teams.map((t) => [t.teamId, t.playoff!.field]));
    const h = field(home);
    const a = field(away);
    const expected = [...h.keys()].reduce((sum, id) => sum + Math.abs(h.get(id)! - a.get(id)!), 0) / 2;
    const swing = open.swings.find((x) => x.gameId === g.id)!;
    expect(swing.home).toBeCloseTo(home0(g.id), 1);
    expect(expected).toBeGreaterThan(0.1);
    expect(Math.abs(swing.spots - expected)).toBeLessThan(0.05);
    // Every other game is locked: none swings.
    expect(open.swings.filter((x) => x.gameId !== g.id).every((x) => x.spots === 0)).toBe(true);
  }, 30_000);

  it("a team's profile averages its picked record plus its title game", () => {
    const all = fillLabLocks(season, {}, "favorites").games;
    const r = simulateNational(season, { ...opts, locks: all });
    const record = (id: number) => {
      let w = 0;
      let l = 0;
      for (const g of season.games) {
        if (g.titleGame || (g.homeId !== id && g.awayId !== id)) continue;
        const win = g.completed ? (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId) : all[g.id];
        if (win === id) w++;
        else l++;
      }
      return [w, l];
    };
    for (const t of r.teams.slice(0, 25)) {
      const [w, l] = record(t.teamId);
      // A title game adds a win for the champion and a loss for the other team, in the seasons it plays.
      const title = t.titleGame ?? 0;
      const champ = t.champion ?? 0;
      expect(t.profile.wins).toBeCloseTo(w + champ, 6);
      expect(t.profile.losses).toBeCloseTo(l + title - champ, 6);
      expect(t.profile.champion).toBeCloseTo(t.conference && opts.conferences.includes(t.conference) ? champ : 0, 6);
    }
  });
});
