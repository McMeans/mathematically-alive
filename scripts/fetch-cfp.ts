// Fetch College Football Playoff committee rankings, with the season they ranked, and write
// fixtures/cfp-<year>.json: the data the committee stand-in (src/core/committee.ts) is fitted to and tested on.
// Usage: pnpm cfp [first year] [last year]; defaults 2014 (the first CFP season) to the season being played.
// Needs CFBD_API_KEY (from .env.local). Makes 4 API calls per year. Each file is a trimmed CFBD snapshot (only the
// fields seasonFromCfbd reads, no betting lines) plus every committee ranking of that season.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CfbdGame, CfbdRating, CfbdSnapshot, CfbdTeam } from "../src/core";

const API = "https://api.collegefootballdata.com";
const POLL = "Playoff Committee Rankings";

type CfbdPollWeek = { week: number; polls: { poll: string; ranks: { rank: number; teamId: number; school: string }[] }[] };

async function main() {
  const key = process.env.CFBD_API_KEY;
  if (!key) throw new Error("CFBD_API_KEY is not set. Add it to .env.local.");
  const now = new Date();
  const current = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const first = Number(process.argv[2] ?? 2014);
  const last = Number(process.argv[3] ?? current);
  if (!Number.isInteger(first) || !Number.isInteger(last) || first > last) throw new Error("Usage: pnpm cfp [first year] [last year]");

  const get = async <T>(route: string): Promise<T> => {
    const res = await fetch(`${API}/${route}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`CFBD ${route}: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  };

  await mkdir("fixtures", { recursive: true });
  for (let year = first; year <= last; year++) {
    const [teams, games, ratings, polls] = await Promise.all([
      get<CfbdTeam[]>(`teams/fbs?year=${year}`),
      get<CfbdGame[]>(`games?year=${year}&seasonType=regular&classification=fbs`),
      get<CfbdRating[]>(`ratings/sp?year=${year}`),
      get<CfbdPollWeek[]>(`rankings?year=${year}&seasonType=regular`),
    ]);
    const rankings = polls
      .flatMap((w) => w.polls.filter((p) => p.poll === POLL).map((p) => ({
        week: w.week,
        ranks: [...p.ranks].sort((a, b) => a.rank - b.rank).map((r) => ({ rank: r.rank, teamId: r.teamId })),
      })))
      .sort((a, b) => a.week - b.week);
    if (rankings.length === 0) throw new Error(`No ${POLL} for ${year}.`);

    const snapshot: CfbdSnapshot = {
      year,
      fetchedAt: new Date().toISOString(),
      teams: teams.map((t) => ({ id: t.id, school: t.school, conference: t.conference ?? null, classification: t.classification ?? null }))
        .sort((a, b) => a.id - b.id),
      games: games.map((g) => ({
        id: g.id, week: g.week, startDate: g.startDate, completed: g.completed, neutralSite: g.neutralSite, conferenceGame: g.conferenceGame,
        homeId: g.homeId, homeTeam: g.homeTeam, homeConference: g.homeConference ?? null, homeClassification: g.homeClassification ?? null,
        homePoints: g.homePoints ?? null,
        awayId: g.awayId, awayTeam: g.awayTeam, awayConference: g.awayConference ?? null, awayClassification: g.awayClassification ?? null,
        awayPoints: g.awayPoints ?? null,
      })).sort((a, b) => a.id - b.id),
      lines: [],
      ratings: ratings.filter((r) => typeof r.rating === "number").map((r) => ({ team: r.team, rating: r.rating }))
        .sort((a, b) => a.team.localeCompare(b.team)),
    };
    const out = path.join("fixtures", `cfp-${year}.json`);
    await writeFile(out, `${JSON.stringify({ snapshot, rankings })}\n`);
    console.log(`${out}: ${snapshot.games.length} games, ${rankings.length} rankings (weeks ${rankings.map((r) => r.week).join(", ")})`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
