// Pull one season from CollegeFootballData and write data/season-<year>.json.
// Usage: npm run data [-- <year>]. Needs CFBD_API_KEY (read from .env.local).
// Makes 4 API calls per run.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CfbdSnapshot } from "../src/core";

const API = "https://api.collegefootballdata.com";

async function main() {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error("CFBD_API_KEY is not set. Add it to .env.local.");
  const year = Number(process.argv[2] ?? new Date().getFullYear());

  const get = async <T>(route: string): Promise<T> => {
    const res = await fetch(`${API}/${route}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`CFBD ${route}: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  };

  const [teams, games, lines, ratings] = await Promise.all([
    get<CfbdSnapshot["teams"]>(`teams/fbs?year=${year}`),
    get<CfbdSnapshot["games"]>(`games?year=${year}&seasonType=regular&classification=fbs`),
    get<CfbdSnapshot["lines"]>(`lines?year=${year}&seasonType=regular`),
    get<CfbdSnapshot["ratings"]>(`ratings/sp?year=${year}`),
  ]);

  const season: CfbdSnapshot = { year, fetchedAt: new Date().toISOString(), teams, games, lines, ratings };
  const out = path.join("data", `season-${year}.json`);
  await mkdir("data", { recursive: true });
  await writeFile(out, JSON.stringify(season));

  console.log(`${out}: ${teams.length} teams, ${games.length} games (raw CFBD snapshot)`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
