// Server side of the one-page view: base (no what-if) numbers for a team, handed to the client Explorer.
import { Explorer, type GameInfo, type HelpGame, type TeamInfo } from "./explorer/Explorer";
import { accTeams, baseOutlook, basePath, baseTree, lastWeek, season } from "./season";

export function ExplorerPage({ teamId }: { teamId: number }) {
  const path = basePath(teamId);
  const names = Object.fromEntries(season.teams.map((t) => [t.id, t.name]));
  const toInfo = (g: (typeof season.games)[number]): GameInfo => ({ id: g.id, homeId: g.homeId, awayId: g.awayId, week: g.week, start: g.start });
  const gameById = new Map(season.games.map((g) => [g.id, g]));

  const own = season.games.filter((g) => !g.completed && (g.homeId === teamId || g.awayId === teamId)).map(toInfo);
  // Frozen for this team: the biggest games elsewhere, from the run with no locks.
  const help: HelpGame[] = path.keyGames
    .filter((k) => k.homeId !== teamId && k.awayId !== teamId)
    .slice(0, 3)
    .map((k) => ({ ...toInfo(gameById.get(k.gameId)!), oddsIfHome: k.oddsIfHomeWins, oddsIfAway: k.oddsIfAwayWins }));

  const teams: TeamInfo[] = accTeams.map((t) => ({ id: t.id, name: t.name, color: t.color }));
  return (
    <Explorer
      key={teamId}
      teamId={teamId}
      teams={teams}
      names={names}
      own={own}
      help={help}
      year={season.year}
      lastWeek={lastWeek}
      initial={{ outlook: baseOutlook.teams, path, tree: baseTree(teamId) }}
    />
  );
}
