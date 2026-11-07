// Server-side season data and the base (no what-if) computation, shared by pages.
import { explore, nationalView, seasonOutlook, simulateNational, simulateSeason, type Season } from "@/core";
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

// The base (no what-if) season and national run, once per build process: every page copies its title races from it.
const baseSim = simulateSeason(season, { iterations: ITERATIONS, seed: SEED });
const baseNational = simulateNational(season, { iterations: ITERATIONS, seed: SEED, conferences: SUPPORTED_CONFERENCES }, baseSim);

/** Team list odds for every supported conference, for pages without a selected team. */
export const baseOutlooks = SUPPORTED_CONFERENCES.map((conference) => {
  const { iterations, teams } = seasonOutlook(season, { conference, iterations: ITERATIONS, seed: SEED, reuse: baseNational }, baseSim);
  return { conference, outlook: { iterations, teams } };
});

/** Outlook, path and tree for one team from one shared simulation in its conference, with no locks (no national run: not serializable). */
export const baseExplore = (teamId: number, conference: string) => {
  const { outlook, path, tree, playoffGames } = explore(season, { conference, teamId, iterations: ITERATIONS, seed: SEED, reuse: baseNational });
  return { outlook, path, tree, playoffGames };
};

const asOfFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
/** "As of Oct 30, 2026, 3:04 PM EDT": when the data was fetched, else now. Shown on hover. */
export const asOf = `As of ${asOfFormat.format(Number.isNaN(Date.parse(season.fetchedAt)) ? new Date() : new Date(season.fetchedAt))}`;

const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const lastPlayed = Math.max(...season.games.filter((g) => g.completed).map((g) => Date.parse(g.start)).filter((t) => !Number.isNaN(t)));
/** "Through Oct 31": the day of the latest final game, Eastern time; the fetch time when no game is final. */
export const through = Number.isFinite(lastPlayed) ? `Through ${dayFormat.format(new Date(lastPlayed))}` : asOf;

/** The projected playoff field, bracket and bubble from the base national run; null when the season has no playoff run. */
export const baseNationalView = nationalView(baseNational);
