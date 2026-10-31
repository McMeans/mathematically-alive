// Cut the ACC out of a raw season snapshot and write fixtures/acc-<year>.json.
// Usage: pnpm fixture [year]. Reads data/season-<year>.json, fetching it first
// (4 API calls, needs CFBD_API_KEY) if it is missing. Default year 2025.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CfbdSnapshot } from "../src/core";

const year = Number(process.argv[2] ?? 2025);
const raw = path.join("data", `season-${year}.json`);

async function main() {
  if (!existsSync(raw)) {
    execFileSync("node_modules/.bin/tsx", ["--env-file-if-exists=.env.local", "scripts/fetch-season.ts", String(year)], {
      stdio: "inherit",
    });
  }
  const snap = JSON.parse(await readFile(raw, "utf8")) as CfbdSnapshot;

  const acc = new Set(snap.teams.filter((t) => t.conference === "ACC").map((t) => t.id));
  const games = snap.games.filter((g) => acc.has(g.homeId) || acc.has(g.awayId));
  const keep = new Set<number>(acc);
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

  const out = path.join("fixtures", `acc-${year}.json`);
  await mkdir("fixtures", { recursive: true });
  await writeFile(out, JSON.stringify(subset) + "\n");
  console.log(`${out}: ${acc.size} ACC teams, ${teams.length} teams, ${games.length} games`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
