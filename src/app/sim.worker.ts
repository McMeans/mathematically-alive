// Re-runs the odds with locked game results off the main thread.
import { pathTree, seasonOutlook, teamPath, type PathTree, type Season, type TeamOutlook, type TeamPath } from "@/core";
import { CONFERENCE, ITERATIONS, SEED } from "./config";
import data from "./data/season.json";

export type SimRequest = { id: number; teamId: number; locks: Record<number, number> };
export type SimResponse = { id: number; outlook: TeamOutlook[]; path: TeamPath; tree: PathTree };

const season = data as Season;
const opts = { conference: CONFERENCE, iterations: ITERATIONS, seed: SEED };

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const { id, teamId, locks } = e.data;
  const path = teamPath(season, { ...opts, teamId, locks });
  const tree = pathTree(season, { ...opts, teamId, locks });
  const outlook = seasonOutlook(season, { ...opts, locks }).teams;
  self.postMessage({ id, outlook, path, tree } satisfies SimResponse);
};
