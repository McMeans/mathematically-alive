// Build src/app/data/season.json (gitignored) for the app: a Season made from
// the newest raw snapshot in data/, or from the committed fixture when there is
// none (CI, fresh clones), so `next build` never needs an API key.
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { seasonFromCfbd, type CfbdSnapshot } from "../src/core";

function source(): string {
  const raws = existsSync("data")
    ? readdirSync("data").filter((f) => /^season-\d{4}\.json$/.test(f)).sort()
    : [];
  if (raws.length > 0) return path.join("data", raws[raws.length - 1]);
  const fixtures = readdirSync("fixtures").filter((f) => /^acc-\d{4}\.json$/.test(f)).sort();
  if (fixtures.length === 0) throw new Error("No data/season-<year>.json and no fixtures/acc-<year>.json to fall back to.");
  return path.join("fixtures", fixtures[fixtures.length - 1]);
}

async function main() {
  const from = source();
  const season = seasonFromCfbd(JSON.parse(await readFile(from, "utf8")) as CfbdSnapshot);
  const out = path.join("src", "app", "data", "season.json");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(season));
  console.log(`${out} <- ${from}: ${season.teams.length} teams, ${season.games.length} games`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
