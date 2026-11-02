// Server side of the one-page view: base (no what-if) numbers for a team, handed to the client Explorer.
import { Explorer, type TeamInfo } from "./explorer/Explorer";
import { accTeams, asOf, baseExplore, season } from "./season";

export function ExplorerPage({ teamId }: { teamId: number }) {
  const base = baseExplore(teamId);
  const names = Object.fromEntries(season.teams.map((t) => [t.id, t.name]));

  const teams: TeamInfo[] = accTeams.map((t) => ({ id: t.id, name: t.name, color: t.color, altColor: t.altColor }));
  return (
    <Explorer
      key={teamId}
      teamId={teamId}
      teams={teams}
      names={names}
      asOf={asOf}
      initial={base}
    />
  );
}
