// Everything the explorer page shows for one team, from one shared simulation.
import { seasonOutlook, type TeamOutlook } from "./outlook";
import { teamPath, type PathOptions, type TeamPath } from "./paths";
import type { Season } from "./season";
import { simulateSeason } from "./sim";
import { pathTree, type PathTree } from "./tree";

export type Exploration = { outlook: TeamOutlook[]; path: TeamPath; tree: PathTree };

export function explore(season: Season, opts: PathOptions): Exploration {
  const sim = simulateSeason(season, { iterations: opts.iterations, seed: opts.seed, locks: opts.locks });
  return {
    outlook: seasonOutlook(season, opts, sim).teams,
    path: teamPath(season, opts, sim),
    tree: pathTree(season, opts, sim),
  };
}
