// Cut one conference out of a raw season snapshot and write fixtures/<conference>-<year>.json
// (e.g. acc-2025.json, big-12-2025.json).
// Usage: pnpm fixture [year] [conference]. Reads data/season-<year>.json, fetching it first
// (4 API calls, needs CFBD_API_KEY) if it is missing. Defaults: 2025, "ACC".
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CfbdSnapshot } from "../src/core";

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
  };

  const out = path.join("fixtures", `${slug}-${year}.json`);
  await mkdir("fixtures", { recursive: true });
  await writeFile(out, JSON.stringify(subset) + "\n");
  console.log(`${out}: ${members.size} ${conference} teams, ${teams.length} teams, ${games.length} games`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
