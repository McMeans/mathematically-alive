// Season Lab: pick any game left, or a playoff game, and see the field, bracket and ranking follow. The no-picks
// view is built at build time; picks run in the Lab worker.
import type { Metadata } from "next";
import { conferenceShort, formatOdds, gameWinProbability, labTeamOdds, liveRanks } from "@/core";
import { asOf, baseLab, season, supportedTeams, through } from "@/app/season";
import { Lab, type LabGame } from "./Lab";

export const metadata: Metadata = {
  title: "Season Lab · Mathematically Alive",
  description: "Play out the rest of the college football season and watch the projected playoff field, bracket and ranking follow.",
};

// The national run stays on the server: it is large and the page only shows what the Lab words.
const initial = { summary: baseLab.summary, picks: baseLab.picks, open: baseLab.open, bigGames: baseLab.bigGames, playoff: baseLab.playoff, conferences: baseLab.conferences, ranking: baseLab.ranking, live: baseLab.live, records: baseLab.records, changes: null, focus: null };
const names = Object.fromEntries(season.teams.map((t) => [t.id, t.name]));
/** Short names where space is tight (phones): the abbreviation, else the first four letters. */
const abbrs = Object.fromEntries(season.teams.map((t) => [t.id, t.abbreviation ?? t.name.slice(0, 4).toUpperCase()]));
/** Each team with a page: its odds with no picks, for following a pinned team before any pick. */
const baseOdds = Object.fromEntries(supportedTeams.flatMap((t) => { const o = labTeamOdds(baseLab.national, t.id); return o ? [[t.id, o]] : []; }));
const DATE = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
/** Each week's date: the day most of its games are played (the Saturday, not a midweek game). */
const weekDates: Record<number, string> = (() => {
  const days = new Map<number, Map<string, number>>();
  for (const g of season.games) {
    if (g.completed || g.titleGame) continue;
    const d = DATE.format(new Date(g.start));
    const w = days.get(g.week) ?? days.set(g.week, new Map()).get(g.week)!;
    w.set(d, (w.get(d) ?? 0) + 1);
  }
  return Object.fromEntries([...days].map(([week, w]) => [week, [...w].sort((a, b) => b[1] - a[1])[0][0]]));
})();
const conferenceOfTeam = new Map(season.teams.map((t) => [t.id, t.conference]));

// Games still to play between two known teams, title games aside (they're decided by the standings).
const games: LabGame[] = season.games
  .filter((g) => !g.completed && !g.titleGame && names[g.homeId] && names[g.awayId])
  .sort((a, b) => a.week - b.week || a.start.localeCompare(b.start) || a.id - b.id)
  .map((g) => {
    const p = gameWinProbability(season, g);
    const home = conferenceOfTeam.get(g.homeId) ?? null;
    return {
      id: g.id, week: g.week, date: weekDates[g.week], homeId: g.homeId, awayId: g.awayId, neutral: g.neutralSite,
      // A flex-week game between two members (the Pac-12's week 13) is outside the standings but still the league's.
      group: home && home !== "FBS Independents" && (g.conferenceGame || home === conferenceOfTeam.get(g.awayId)) ? conferenceShort(home) : "Nonconference",
      conferences: [conferenceOfTeam.get(g.homeId), conferenceOfTeam.get(g.awayId)].filter((c): c is string => !!c).map(conferenceShort),
      homeOdds: formatOdds(p), awayOdds: formatOdds(1 - p),
    };
  });

export default function LabPage() {
  const teams = supportedTeams.map((t) => ({ id: t.id, name: t.name })).sort((a, b) => a.name.localeCompare(b.name));
  return <Lab initial={initial} games={games} names={names} abbrs={abbrs} teams={teams} paged={supportedTeams.map((t) => t.id)} ranks={liveRanks(season)} baseOdds={baseOdds} through={through} asOf={asOf} />;
}
