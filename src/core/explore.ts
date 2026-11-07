// Everything the explorer page shows for one team, from one shared simulation.
import type { NationalResult } from "./national";
import { seasonOutlook, type TeamOutlook } from "./outlook";
import { teamPath, type PathOptions, type TeamPath } from "./paths";
import type { Season } from "./season";
import { simulateSeason } from "./sim";
import { pathTree, type PathTree } from "./tree";

export type Exploration = {
  outlook: TeamOutlook[];
  path: TeamPath;
  tree: PathTree;
  /** The national run behind the playoff odds (null when they are the estimate): pass it as `reuse` to the next what-if. Not serializable. */
  national: NationalResult | null;
};

export function explore(season: Season, opts: PathOptions): Exploration {
  const sim = simulateSeason(season, { iterations: opts.iterations, seed: opts.seed, locks: opts.locks });
  const { teams, national } = seasonOutlook(season, opts, sim);
  const tree = pathTree(season, opts, sim, teams);
  // The tree proves the team's own spot with a bigger budget than the outlook gives each team; use what it found.
  const status: TeamOutlook["status"] | null = tree.root.outcome === "in" ? "clinched" : tree.root.outcome === "out" ? "eliminated" : null;
  const outlook = teams.map((o) => (o.teamId === opts.teamId && status ? { ...o, status } : o));
  return { outlook, path: teamPath(season, opts, sim), tree, national };
}
