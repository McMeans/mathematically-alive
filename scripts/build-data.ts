// Build src/app/data/season.json (gitignored) for the app: a Season made from the newest national snapshot,
// data/season-<year>.json. The snapshot is committed (the scheduled refresh in .github/workflows/refresh-data.yml
// updates it), so `next build` and CI never need an API key. Fixtures are for tests only.
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { SUPPORTED_CONFERENCES } from "../src/app/config";
import { INDEPENDENTS, checkSnapshot, seasonFromCfbd, type CfbdSnapshot } from "../src/core";

/** The newest data/season-<year>.json. */
function source(): string {
  const raws = existsSync("data") ? readdirSync("data").filter((f) => /^season-\d{4}\.json$/.test(f)).sort() : [];
  if (raws.length === 0) throw new Error("No data/season-<year>.json. Run `pnpm data` (needs CFBD_API_KEY).");
  return path.join("data", raws[raws.length - 1]);
}

async function main() {
  const from = source();
  const season = seasonFromCfbd(JSON.parse(await readFile(from, "utf8")) as CfbdSnapshot);
  const { errors, notSupported } = checkSnapshot(season, [...SUPPORTED_CONFERENCES, INDEPENDENTS]);
  if (errors.length > 0) {
    throw new Error(`${from}: ${errors.join(" ")} Refresh the snapshot, add rules from the conference's official document, or take the conference out of SUPPORTED_CONFERENCES.`);
  }
  const out = path.join("src", "app", "data", "season.json");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(season));
  console.log(`${out} <- ${from}: ${season.teams.length} teams, ${season.games.length} games`);
  if (notSupported.length > 0) console.log(`Not supported yet: ${notSupported.join(", ")}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
