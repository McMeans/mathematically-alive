// Server side of the one-page view: base (no what-if) numbers for a team, handed to the client Explorer.
import { Explorer, type ConferenceList, type TeamInfo } from "./explorer/Explorer";
import { asOf, baseExplore, baseOutlooks, conferenceOf, conferenceTeams, season, through } from "./season";

export function ExplorerPage({ teamId }: { teamId: number }) {
  const conference = conferenceOf(teamId);
  if (conference === null) throw new Error(`Team ${teamId} is not in a supported conference`);
  const base = baseExplore(teamId, conference);
  const names = Object.fromEntries(season.teams.map((t) => [t.id, t.name]));

  const info = (c: string): TeamInfo[] => conferenceTeams(c).map((t) => ({ id: t.id, name: t.name, color: t.color, altColor: t.altColor }));
  const teams = info(conference);
  // Every supported conference for the team picker; the team's own uses this page's numbers.
  const conferences: ConferenceList[] = baseOutlooks.map((b) => ({
    conference: b.conference,
    teams: info(b.conference),
    outlook: b.conference === conference ? base.outlook : b.outlook.teams,
  }));
  return (
    <Explorer
      key={teamId}
      teamId={teamId}
      conference={conference}
      teams={teams}
      conferences={conferences}
      names={names}
      asOf={asOf}
      through={through}
      initial={base}
    />
  );
}
