// Server-side season data and the base (no what-if) computation, shared by pages.
import { explore, seasonOutlook, type Season } from "@/core";
import data from "./data/season.json";

import { ITERATIONS, SEED, SUPPORTED_CONFERENCES } from "./config";

export const season = data as Season;

/** Teams in a supported conference: the ones with a page. */
export const supportedTeams = season.teams.filter((t) => t.conference !== null && SUPPORTED_CONFERENCES.includes(t.conference));

/** The supported conference a team plays in, or null if it has no page. */
export function conferenceOf(teamId: number): string | null {
  return supportedTeams.find((t) => t.id === teamId)?.conference ?? null;
}

/** Teams in one conference, in data order. */
export const conferenceTeams = (conference: string) => season.teams.filter((t) => t.conference === conference);

/** Team list odds for every supported conference, for pages without a selected team. */
export const baseOutlooks = SUPPORTED_CONFERENCES.map((conference) => ({
  conference,
  outlook: seasonOutlook(season, { conference, iterations: ITERATIONS, seed: SEED }),
}));

/** Outlook, path and tree for one team from one shared simulation in its conference, with no locks. */
export const baseExplore = (teamId: number, conference: string) =>
  explore(season, { conference, teamId, iterations: ITERATIONS, seed: SEED });

const asOfFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
/** "As of Oct 30, 2026, 3:04 PM EDT": when the data was fetched, else now. Shown on hover. */
export const asOf = `As of ${asOfFormat.format(Number.isNaN(Date.parse(season.fetchedAt)) ? new Date() : new Date(season.fetchedAt))}`;

const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const lastPlayed = Math.max(...season.games.filter((g) => g.completed).map((g) => Date.parse(g.start)).filter((t) => !Number.isNaN(t)));
/** "Through Oct 31": the day of the latest final game, Eastern time; the fetch time when no game is final. */
export const through = Number.isFinite(lastPlayed) ? `Through ${dayFormat.format(new Date(lastPlayed))}` : asOf;
