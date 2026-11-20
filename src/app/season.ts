// Server-side season data and the base (no what-if) computation, shared by pages.
import { INDEPENDENTS, explore, exploreIndependent, independentOutlook, pathTree, seasonLab, seasonOutlook, simulateNational, simulateSeason, type Season, type TeamOutlook } from "@/core";
import data from "./data/season.json";

import { ITERATIONS, SEED, SUPPORTED_CONFERENCES } from "./config";

export const season = data as Season;

// The base (no what-if) season and national run, once per build process: every page copies its title races from it.
const baseSim = simulateSeason(season, { iterations: ITERATIONS, seed: SEED });
const baseNational = simulateNational(season, { iterations: ITERATIONS, seed: SEED, conferences: SUPPORTED_CONFERENCES }, baseSim);

/** Every FBS independent's playoff odds, for the team list. */
export const baseIndependents = independentOutlook(season, { iterations: ITERATIONS, seed: SEED, reuse: baseNational }, baseSim).teams;
const independentIds = new Set(baseIndependents.map((o) => o.teamId));

/** Teams in a supported conference, and the FBS independents: the ones with a page. */
export const supportedTeams = season.teams.filter((t) => independentIds.has(t.id) || (t.conference !== null && SUPPORTED_CONFERENCES.includes(t.conference)));

/** The supported conference a team plays in (INDEPENDENTS for an independent), or null if it has no page. */
export function conferenceOf(teamId: number): string | null {
  if (independentIds.has(teamId)) return INDEPENDENTS;
  return supportedTeams.find((t) => t.id === teamId)?.conference ?? null;
}

/** Teams in one conference (or the independents), in data order. */
export const conferenceTeams = (conference: string) =>
  conference === INDEPENDENTS ? season.teams.filter((t) => independentIds.has(t.id)) : season.teams.filter((t) => t.conference === conference);

/** Team list odds for every supported conference, for pages without a selected team. */
export const baseOutlooks = SUPPORTED_CONFERENCES.map((conference) => {
  const { iterations, teams } = seasonOutlook(season, { conference, iterations: ITERATIONS, seed: SEED, reuse: baseNational }, baseSim);
  return { conference, outlook: { iterations, teams } };
});

/**
 * One team's line of `baseExplore(...).outlook`, without building its whole path tree: the conference outlook, with the
 * team's status from the tree's root proof (`explore` does the same). The share images use it, so a build process that
 * draws a team's image doesn't also build the tree its page needs.
 */
export const baseTeamOutlook = (teamId: number, conference: string) => {
  const teams = baseOutlooks.find((b) => b.conference === conference)!.outlook.teams;
  const root = pathTree(season, { conference, teamId, iterations: ITERATIONS, seed: SEED, reuse: baseNational, depth: 0 }, baseSim, teams).root;
  const me = teams.find((o) => o.teamId === teamId)!;
  const status: TeamOutlook["status"] | null = root.outcome === "in" ? "clinched" : root.outcome === "out" ? "eliminated" : null;
  return status ? { ...me, status } : me;
};

/** Outlook, path and tree for one team from one shared simulation in its conference, with no locks (no national run: not serializable). */
// Kept per team, so a process that renders a team twice (a page and its metadata, say) builds the tree once.
const explored = new Map<number, ReturnType<typeof exploreTeam>>();
const exploreTeam = (teamId: number, conference: string) => {
  const { outlook, path, tree, playoffGames, board } = explore(season, { conference, teamId, iterations: ITERATIONS, seed: SEED, reuse: baseNational });
  return { outlook, path, tree, playoffGames, board };
};
export const baseExplore = (teamId: number, conference: string) => {
  const hit = explored.get(teamId);
  if (hit) return hit;
  const r = exploreTeam(teamId, conference);
  explored.set(teamId, r);
  return r;
};

/** An independent's odds, games and results elsewhere, with no locks (no national run: not serializable). */
export const baseExploreIndependent = (teamId: number) => {
  const { outlook, games, playoffGames, board } = exploreIndependent(season, { teamId, iterations: ITERATIONS, seed: SEED, reuse: baseNational });
  return { outlook, games, playoffGames, board };
};

export { asOf, through } from "./dates";

/** The Season Lab with no picks, from the base national run. */
export const baseLab = seasonLab(season, { iterations: ITERATIONS, seed: SEED, conferences: SUPPORTED_CONFERENCES, reuse: baseNational });
