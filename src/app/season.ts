// Server-side season data and the base (no what-if) computation, shared by pages.
import { seasonOutlook, teamPath, type Season } from "@/core";
import data from "./data/season.json";

import { CONFERENCE, ITERATIONS, SEED } from "./config";

export { CONFERENCE };

export const season = data as Season;
export const accTeams = season.teams.filter((t) => t.conference === CONFERENCE);

export const baseOutlook = seasonOutlook(season, { conference: CONFERENCE, iterations: ITERATIONS, seed: SEED });

export const basePath = (teamId: number) =>
  teamPath(season, { conference: CONFERENCE, teamId, iterations: ITERATIONS, seed: SEED });
