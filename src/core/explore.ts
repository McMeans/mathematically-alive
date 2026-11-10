// Everything the explorer page shows for one team, from one shared simulation.
import type { NationalResult } from "./national";
import { seasonOutlook, type TeamOutlook } from "./outlook";
import { teamPath, type PathOptions, type TeamPath } from "./paths";
import type { Season } from "./season";
import { simulateSeason } from "./sim";
import { pathTree, type PathTree } from "./tree";
import { playoffSignals, type PlayoffSignal } from "./view";
import { teamBoard, type TeamBoard } from "./board";

export type Exploration = {
  outlook: TeamOutlook[];
  path: TeamPath;
  tree: PathTree;
  /** Results elsewhere that clearly move the team's playoff odds (empty without a national run). */
  playoffGames: PlayoffSignal[];
  /** The page's board: odds by final record, ways in, help from elsewhere, the title game, the playoff race. Null without a national run. */
  board: TeamBoard | null;
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
  const playoffGames = national ? playoffSignals(season, sim, national, opts.teamId) : [];
  const board = national ? teamBoard(season, sim, national, opts.teamId, opts.conference, opts.locks, tree.likeliest) : null;
  return { outlook, path: teamPath(season, opts, sim), tree, playoffGames, board, national };
}
