// Season Lab: pick any game left, or a playoff game, and see the field, bracket and ranking follow. The no-picks
// view is built at build time; picks run in the Lab worker.
import type { Metadata } from "next";
import Link from "next/link";
import { conferenceShort, formatOdds, gameWinProbability } from "@/core";
import { Logo } from "@/app/Logo";
import { asOf, baseLab, season, supportedTeams, through } from "@/app/season";
import { Lab, type LabGame } from "./Lab";

export const metadata: Metadata = {
  title: "Season Lab · Mathematically Alive",
  description: "Play out the rest of the college football season and watch the projected playoff field, bracket and ranking follow.",
};

// The national run stays on the server: it is large and the page only shows what the Lab words.
const initial = { summary: baseLab.summary, picks: baseLab.picks, open: baseLab.open, bigGames: baseLab.bigGames, playoff: baseLab.playoff, conferences: baseLab.conferences, ranking: baseLab.ranking, changes: null };
const names = Object.fromEntries(season.teams.map((t) => [t.id, t.name]));
const conferenceOfTeam = new Map(season.teams.map((t) => [t.id, t.conference]));

// Games still to play between two known teams, title games aside (they're decided by the standings).
const games: LabGame[] = season.games
  .filter((g) => !g.completed && !g.titleGame && names[g.homeId] && names[g.awayId])
  .sort((a, b) => a.week - b.week || a.start.localeCompare(b.start) || a.id - b.id)
  .map((g) => {
    const p = gameWinProbability(season, g);
    const home = conferenceOfTeam.get(g.homeId) ?? null;
    return {
      id: g.id, week: g.week, homeId: g.homeId, awayId: g.awayId, neutral: g.neutralSite,
      group: g.conferenceGame && home ? conferenceShort(home) : "Nonconference",
      conferences: [conferenceOfTeam.get(g.homeId), conferenceOfTeam.get(g.awayId)].filter((c): c is string => !!c).map(conferenceShort),
      homeOdds: formatOdds(p), awayOdds: formatOdds(1 - p),
    };
  });

export default function LabPage() {
  const teams = supportedTeams.map((t) => ({ id: t.id, name: t.name })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between gap-3 border-b border-ink-muted/25 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <Logo size={32} decorative />
          <span className="font-display text-lg font-bold tracking-tight sm:text-xl">Mathematically Alive</span>
        </Link>
        <span title={asOf} className="text-sm text-ink-muted">{through}</span>
      </header>
      <Lab initial={initial} games={games} names={names} teams={teams} paged={supportedTeams.map((t) => t.id)} />
    </div>
  );
}
