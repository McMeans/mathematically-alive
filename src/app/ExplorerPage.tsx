// Server side of the one-page view: base (no what-if) numbers for a team, handed to the client Explorer.
import { Explorer, type GameInfo, type TeamInfo } from "./explorer/Explorer";
import { accTeams, asOf, baseExplore, season } from "./season";

export function ExplorerPage({ teamId }: { teamId: number }) {
  const base = baseExplore(teamId);
  const { tree } = base;
  const names = Object.fromEntries(season.teams.map((t) => [t.id, t.name]));
  const toInfo = (g: (typeof season.games)[number]): GameInfo => ({ id: g.id, homeId: g.homeId, awayId: g.awayId, week: g.week, start: g.start });

  const own = season.games.filter((g) => !g.completed && (g.homeId === teamId || g.awayId === teamId)).map(toInfo);
  // Frozen for this team: every other conference game that matters now or in one of its scenarios, from the run with no locks.
  const kickoff = new Map(season.games.map((g) => [g.id, Date.parse(g.start) || 0]));
  const help = [...tree.help].sort((a, b) => kickoff.get(a.gameId)! - kickoff.get(b.gameId)! || a.gameId - b.gameId);

  const teams: TeamInfo[] = accTeams.map((t) => ({ id: t.id, name: t.name, color: t.color, altColor: t.altColor }));
  return (
    <Explorer
      key={teamId}
      teamId={teamId}
      teams={teams}
      names={names}
      own={own}
      help={help}
      asOf={asOf}
      initial={base}
    />
  );
}
