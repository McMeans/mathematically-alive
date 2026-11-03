// Server side of the one-page view: base (no what-if) numbers for a team, handed to the client Explorer.
import { Explorer, type TeamInfo } from "./explorer/Explorer";
import { asOf, baseExplore, conferenceOf, conferenceTeams, season } from "./season";

export function ExplorerPage({ teamId }: { teamId: number }) {
  const conference = conferenceOf(teamId);
  if (conference === null) throw new Error(`Team ${teamId} is not in a supported conference`);
  const base = baseExplore(teamId, conference);
  const names = Object.fromEntries(season.teams.map((t) => [t.id, t.name]));

  const teams: TeamInfo[] = conferenceTeams(conference).map((t) => ({ id: t.id, name: t.name, color: t.color, altColor: t.altColor }));
  return (
    <Explorer
      key={teamId}
      teamId={teamId}
      conference={conference}
      teams={teams}
      names={names}
      asOf={asOf}
      initial={base}
    />
  );
}
