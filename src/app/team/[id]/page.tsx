import Link from "next/link";
import { notFound } from "next/navigation";
import { Logo } from "@/app/Logo";
import { accTeams, baseOutlook, basePath, season } from "@/app/season";
import { TeamView, type GameInfo } from "./TeamView";

export function generateStaticParams() {
  return accTeams.map((t) => ({ id: String(t.id) }));
}

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const teamId = Number((await params).id);
  const team = accTeams.find((t) => t.id === teamId);
  if (!team) notFound();
  const path = basePath(teamId);
  const outlook = baseOutlook.teams.find((o) => o.teamId === teamId)!;

  const names = Object.fromEntries(season.teams.map((t) => [t.id, t.name]));
  const wanted = new Set(path.keyGames.map((k) => k.gameId));
  const games: GameInfo[] = season.games
    .filter((g) => !g.completed && (wanted.has(g.id) || g.homeId === teamId || g.awayId === teamId))
    .map((g) => ({ id: g.id, homeId: g.homeId, awayId: g.awayId, week: g.week, start: g.start }));

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
      <Link href="/" className="mb-6 inline-flex items-center gap-2 text-sm text-ink-soft hover:text-navy">
        <Logo size={28} decorative /> <span>mathematically alive</span> <span aria-hidden>/ ACC</span>
      </Link>
      <TeamView
        teamId={teamId}
        teamName={team.name}
        color={team.color}
        names={names}
        games={games}
        initialPath={path}
        initialOutlook={outlook}
      />
    </main>
  );
}
