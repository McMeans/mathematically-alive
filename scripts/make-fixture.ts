// Cut one conference out of a raw season snapshot and write fixtures/<conference>-<year>.json
// (e.g. acc-2025.json, big-12-2025.json).
// Usage: pnpm fixture [year] [conference]. Reads data/season-<year>.json, fetching it first
// (5 API calls, needs CFBD_API_KEY) if it is missing. Defaults: 2025, "ACC".
// `pnpm fixture 2025 national` writes fixtures/national-2025.json instead: every FBS game of the season, postseason
// included, trimmed to the fields seasonFromCfbd reads, with the ratings and the committee's rankings (no betting
// lines). It is what the end-to-end postseason tests run on.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CfbdGame, CfbdSnapshot } from "../src/core";

const year = Number(process.argv[2] ?? 2025);
const conference = process.argv[3] ?? "ACC";
const slug = conference.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const raw = path.join("data", `season-${year}.json`);

async function main() {
  if (!existsSync(raw)) {
    execFileSync("node_modules/.bin/tsx", ["--env-file-if-exists=.env.local", "scripts/fetch-season.ts", String(year)], {
      stdio: "inherit",
    });
  }
  const snap = JSON.parse(await readFile(raw, "utf8")) as CfbdSnapshot;
  if (conference === "national") return national(snap);

  const members = new Set(snap.teams.filter((t) => t.conference === conference).map((t) => t.id));
  if (members.size === 0) throw new Error(`No ${conference} teams in ${raw}.`);
  const games = snap.games.filter((g) => members.has(g.homeId) || members.has(g.awayId));
  const keep = new Set<number>(members);
  for (const g of games) {
    keep.add(g.homeId);
    keep.add(g.awayId);
  }
  const teams = snap.teams.filter((t) => keep.has(t.id));
  const names = new Set(teams.map((t) => t.school));
  const gameIds = new Set(games.map((g) => g.id));
  const subset: CfbdSnapshot = {
    year: snap.year,
    fetchedAt: snap.fetchedAt,
    teams,
    games,
    lines: snap.lines.filter((l) => gameIds.has(l.id)),
    ratings: snap.ratings.filter((r) => names.has(r.team)),
    rankings: snap.rankings ?? [],
  };

  const out = path.join("fixtures", `${slug}-${year}.json`);
  await mkdir("fixtures", { recursive: true });
  await writeFile(out, JSON.stringify(subset) + "\n");
  console.log(`${out}: ${members.size} ${conference} teams, ${teams.length} teams, ${games.length} games`);
}

/** The whole season, trimmed: only the fields seasonFromCfbd reads, no betting lines. */
async function national(snap: CfbdSnapshot) {
  const game = (g: CfbdGame): CfbdGame => ({
    id: g.id, week: g.week, seasonType: g.seasonType ?? null, startDate: g.startDate, completed: g.completed, neutralSite: g.neutralSite,
    conferenceGame: g.conferenceGame, notes: g.notes ?? null, playoff: g.playoff ?? null,
    homeId: g.homeId, homeTeam: g.homeTeam, homeConference: g.homeConference ?? null, homeClassification: g.homeClassification ?? null, homePoints: g.homePoints ?? null,
    awayId: g.awayId, awayTeam: g.awayTeam, awayConference: g.awayConference ?? null, awayClassification: g.awayClassification ?? null, awayPoints: g.awayPoints ?? null,
  });
  const subset: CfbdSnapshot = {
    year: snap.year,
    fetchedAt: snap.fetchedAt,
    teams: snap.teams.map((t) => ({ id: t.id, school: t.school, conference: t.conference ?? null, classification: t.classification ?? null })),
    games: snap.games.map(game),
    lines: [],
    ratings: snap.ratings.filter((r) => typeof r.rating === "number").map((r) => ({ team: r.team, rating: r.rating })),
    rankings: snap.rankings ?? [],
  };
  const out = path.join("fixtures", `national-${snap.year}.json`);
  await mkdir("fixtures", { recursive: true });
  await writeFile(out, JSON.stringify(subset) + "\n");
  console.log(`${out}: ${subset.teams.length} teams, ${subset.games.length} games, ${subset.rankings!.length} committee rankings`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
