// Server side of the one-page view: base (no what-if) numbers for a team, handed to the client Explorer.
import { INDEPENDENTS } from "@/core";
import { Explorer, IndependentExplorer, type ConferenceList, type TeamInfo } from "./explorer/Explorer";
import { conferenceRows, independentRows } from "./explorer/rows";
import { asOf, baseExplore, baseExploreIndependent, baseIndependents, baseOutlooks, conferenceOf, conferenceTeams, season, through } from "./season";

export function ExplorerPage({ teamId }: { teamId: number }) {
  const conference = conferenceOf(teamId);
  if (conference === null) throw new Error(`Team ${teamId} is not in a supported conference or an independent`);
  const names = Object.fromEntries(season.teams.map((t) => [t.id, t.name]));
  const info = (c: string): TeamInfo[] => conferenceTeams(c).map((t) => ({ id: t.id, name: t.name, color: t.color, altColor: t.altColor }));
  const teams = info(conference);
  const common = { teamId, conference, teams, names, asOf, through };

  if (conference === INDEPENDENTS) {
    const base = baseExploreIndependent(teamId);
    // Every supported conference, then the independents, for the team picker; the team's own list uses this page's numbers.
    const conferences: ConferenceList[] = [
      ...baseOutlooks.map((b) => ({ conference: b.conference, teams: info(b.conference), rows: conferenceRows(b.conference, b.outlook.teams) })),
      { conference: INDEPENDENTS, teams, rows: independentRows(base.outlook) },
    ];
    return <IndependentExplorer key={teamId} {...common} conferences={conferences} initial={base} />;
  }

  const base = baseExplore(teamId, conference);
  const conferences: ConferenceList[] = [
    ...baseOutlooks.map((b) => ({
      conference: b.conference,
      teams: info(b.conference),
      rows: conferenceRows(b.conference, b.conference === conference ? base.outlook : b.outlook.teams),
    })),
    { conference: INDEPENDENTS, teams: info(INDEPENDENTS), rows: independentRows(baseIndependents) },
  ];
  return <Explorer key={teamId} {...common} conferences={conferences} initial={base} />;
}
