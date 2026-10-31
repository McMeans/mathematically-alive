// Server-side season data and the base (no what-if) computation, shared by pages.
import { explore, seasonOutlook, type Season } from "@/core";
import data from "./data/season.json";

import { CONFERENCE, ITERATIONS, SEED } from "./config";

export { CONFERENCE };

export const season = data as Season;
export const accTeams = season.teams.filter((t) => t.conference === CONFERENCE);

/** Team list odds for pages without a selected team. */
export const baseOutlook = seasonOutlook(season, { conference: CONFERENCE, iterations: ITERATIONS, seed: SEED });

/** Outlook, path and tree for one team from one shared simulation, with no locks. */
export const baseExplore = (teamId: number) =>
  explore(season, { conference: CONFERENCE, teamId, iterations: ITERATIONS, seed: SEED });

const asOfFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
/** "As of Oct 30, 2026, 3:04 PM EDT": when the data was fetched, else now. */
export const asOf = `As of ${asOfFormat.format(Number.isNaN(Date.parse(season.fetchedAt)) ? new Date() : new Date(season.fetchedAt))}`;
