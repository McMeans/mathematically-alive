// Build src/app/data/season.json (gitignored) for the app: a Season made from
// the newest raw snapshot in data/, or from the committed fixtures when there is
// none (CI, fresh clones), so `next build` never needs an API key.
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { seasonFromCfbd, type CfbdSnapshot } from "../src/core";

/** The newest raw snapshot in data/, or else every committed fixture for the newest fixture year. */
function sources(): string[] {
  const raws = existsSync("data")
    ? readdirSync("data").filter((f) => /^season-\d{4}\.json$/.test(f)).sort()
    : [];
  if (raws.length > 0) return [path.join("data", raws[raws.length - 1])];
  const fixtures = readdirSync("fixtures").filter((f) => /^[a-z0-9-]+-\d{4}\.json$/.test(f));
  if (fixtures.length === 0) throw new Error("No data/season-<year>.json and no fixtures/<conference>-<year>.json to fall back to.");
  const year = (f: string) => Number(f.match(/(\d{4})\.json$/)![1]);
  const newest = Math.max(...fixtures.map(year));
  return fixtures.filter((f) => year(f) === newest).sort().map((f) => path.join("fixtures", f));
}

/** One snapshot from several conference fixtures of the same season; a team or game in two of them is kept once. */
function merge(snaps: CfbdSnapshot[]): CfbdSnapshot {
  const byKey = <T>(lists: T[][], key: (x: T) => string | number): T[] => [...new Map(lists.flat().map((x) => [key(x), x])).values()];
  return {
    year: snaps[0].year,
    fetchedAt: snaps.map((s) => s.fetchedAt).sort()[0],
    teams: byKey(snaps.map((s) => s.teams), (t) => t.id),
    games: byKey(snaps.map((s) => s.games), (g) => g.id),
    lines: byKey(snaps.map((s) => s.lines), (l) => l.id),
    ratings: byKey(snaps.map((s) => s.ratings), (r) => r.team),
  };
}

async function main() {
  const from = sources();
  const snaps = await Promise.all(from.map(async (f) => JSON.parse(await readFile(f, "utf8")) as CfbdSnapshot));
  const season = seasonFromCfbd(merge(snaps));
  const out = path.join("src", "app", "data", "season.json");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(season));
  console.log(`${out} <- ${from.join(", ")}: ${season.teams.length} teams, ${season.games.length} games`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
