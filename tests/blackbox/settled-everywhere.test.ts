// Once a team's title-game spot is proven, every title-game number on its page says so: "In" or "Out", never ">99%"
// or "<0.1%" beside a header that already reads In or Out.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { explore, seasonFromCfbd, seasonLab, type CfbdSnapshot, type Exploration, type Season } from "@/core";

// Every FBS game of 2026 through week 9, from fixtures/cfp-2026.json.
const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const id = (s: Season, name: string) => s.teams.find((t) => t.name === name)!.id;
const N = 600;

/** Every title-game odds text the page shows for the team, from the board and the week-by-week list. */
function titleTexts(e: Exploration): string[] {
  const out: string[] = [];
  for (const r of e.board!.records) if (r.titleGameText !== null) out.push(r.titleGameText);
  for (const g of e.board!.help) for (const x of g.games) for (const s of x.sides) if (s.titleGameText !== null) out.push(s.titleGameText);
  for (const w of e.tree.weeks) {
    if (w.own) out.push(...[w.own.ifWin, w.own.ifLose].filter((x): x is string => x !== null));
    if (w.nonConference) out.push(...[w.nonConference.titleIfWin, w.nonConference.titleIfLose].filter((x): x is string => x !== null));
  }
  return out;
}

describe("a proven title-game spot reads the same everywhere on the page", { timeout: 120_000 }, () => {
  it("a team proven out shows Out for every title-game number, not <0.1%", () => {
    const fsu = explore(season, { conference: "ACC", teamId: id(season, "Florida State"), iterations: N, seed: 7 });
    expect(fsu.outlook.find((o) => o.teamId === id(season, "Florida State"))!.status).toBe("eliminated");
    const texts = titleTexts(fsu);
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).toBe("Out");
  });

  it("a team proven in shows In for every title-game number, not >99%", () => {
    // Lock every ACC game left but one of Miami's: Miami wins its own, home teams win the rest.
    const MIA = id(season, "Miami");
    const acc = season.games.filter((g) => !g.completed && g.conferenceGame && !g.titleGame && season.teams.find((t) => t.id === g.homeId)?.conference === "ACC");
    const mine = acc.filter((g) => g.homeId === MIA || g.awayId === MIA);
    const open = mine.at(-1)!;
    const locks: Record<number, number> = {};
    for (const g of acc) if (g.id !== open.id) locks[g.id] = g.homeId === MIA || g.awayId === MIA ? MIA : g.homeId;
    const mia = explore(season, { conference: "ACC", teamId: MIA, iterations: N, seed: 7, locks });
    expect(mia.outlook.find((o) => o.teamId === MIA)!.status).toBe("clinched");
    const texts = titleTexts(mia);
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).toBe("In");
  });
});

describe("the Season Lab's conference races agree with the proofs", { timeout: 120_000 }, () => {
  it("a team the picks prove into its title game reads 100% in the races, not >99%", () => {
    const MIA = id(season, "Miami");
    const acc = season.games.filter((g) => !g.completed && g.conferenceGame && !g.titleGame && season.teams.find((t) => t.id === g.homeId)?.conference === "ACC");
    const open = acc.filter((g) => g.homeId === MIA || g.awayId === MIA).at(-1)!;
    const games: Record<number, number> = {};
    for (const g of acc) if (g.id !== open.id) games[g.id] = g.homeId === MIA || g.awayId === MIA ? MIA : g.homeId;
    // Picks that settle Miami's spot but leave the other ACC spot to a game still open, so the matchup isn't set.
    const conferences = ["ACC", "Big 12", "SEC", "Big Ten"];
    const lab = seasonLab(season, { iterations: N, seed: 7, conferences, locks: { games, titles: {}, bracket: {} } });
    const row = lab.conferences.find((c) => c.conference === "ACC")!.teams.find((t) => t.teamId === MIA)!;
    expect(row.titleGame).toBe(1);
    expect(row.titleGameText).toBe("100%");
  });
});
