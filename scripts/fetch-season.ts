// Pull one season, every FBS game, from CollegeFootballData and write data/season-<year>.json: the national
// snapshot the app is built from. Usage: pnpm data [year]; the year defaults to the season being played (in
// January, last year's). Needs CFBD_API_KEY (from .env.local, or the environment in the scheduled refresh).
// Makes 5 API calls per run: teams, every game (regular season and postseason, so the title games and, once the field
// is announced, the playoff games with their seeds), betting lines, SP+ ratings and the polls (only the committee's is
// kept). Written one record per line, so a refresh's diff shows what changed.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { COMMITTEE_POLL, checkFetch, type CfbdSnapshot } from "../src/core";

const API = "https://api.collegefootballdata.com";

async function main() {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error("CFBD_API_KEY is not set. Add it to .env.local.");
  const now = new Date();
  const year = Number(process.argv[2] || (now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear()));
  if (!Number.isInteger(year)) throw new Error(`Not a season year: ${process.argv[2]}`);

  const get = async <T>(route: string): Promise<T> => {
    const res = await fetch(`${API}/${route}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`CFBD ${route}: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  };

  const [teams, games, lines, ratings, polls] = await Promise.all([
    get<CfbdSnapshot["teams"]>(`teams/fbs?year=${year}`),
    get<CfbdSnapshot["games"]>(`games?year=${year}&seasonType=both&classification=fbs`),
    get<CfbdSnapshot["lines"]>(`lines?year=${year}&seasonType=both`),
    get<CfbdSnapshot["ratings"]>(`ratings/sp?year=${year}`),
    get<NonNullable<CfbdSnapshot["rankings"]>>(`rankings?year=${year}&seasonType=both`),
  ]);
  // Only the committee's ranking is read (the field when the bracket rows don't name every seed yet).
  const rankings = polls
    .map((w) => ({ ...w, polls: w.polls.filter((p) => p.poll === COMMITTEE_POLL) }))
    .filter((w) => w.polls.length > 0);

  const season: CfbdSnapshot = { year, fetchedAt: new Date().toISOString(), teams, games, lines, ratings, rankings };
  const out = path.join("data", `season-${year}.json`);
  // A partial response would still build; refuse it rather than replace a fuller snapshot.
  const previous = existsSync(out) ? (JSON.parse(await readFile(out, "utf8")) as CfbdSnapshot) : null;
  const errors = checkFetch(season, previous);
  if (errors.length > 0) throw new Error(`${errors.join(" ")} ${out} was left as it was.`);
  await mkdir("data", { recursive: true });
  await writeFile(out, oneRecordPerLine(season));

  console.log(`${out}: ${teams.length} teams, ${games.length} games, ${rankings.length} committee rankings (raw CFBD snapshot)`);
}

/** JSON with each team, game, line, rating and committee ranking on its own line, in a fixed order. */
function oneRecordPerLine(snap: CfbdSnapshot): string {
  const list = <T>(rows: T[], key: (r: T) => string | number) =>
    `[\n${[...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)).map((r) => JSON.stringify(r)).join(",\n")}\n]`;
  return `{"year":${snap.year},"fetchedAt":${JSON.stringify(snap.fetchedAt)},
"teams":${list(snap.teams, (t) => t.id)},
"games":${list(snap.games, (g) => g.id)},
"lines":${list(snap.lines, (l) => l.id)},
"ratings":${list(snap.ratings, (r) => r.team)},
"rankings":${list(snap.rankings ?? [], (w) => `${w.seasonType === "postseason" ? 1 : 0}-${String(w.week).padStart(2, "0")}`)}}
`;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
