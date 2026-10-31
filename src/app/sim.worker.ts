// Re-runs the odds with locked game results off the main thread.
import { explore, type Exploration, type Season } from "@/core";
import { CONFERENCE, ITERATIONS, SEED } from "./config";
import data from "./data/season.json";

export type SimRequest = { id: number; teamId: number; locks: Record<number, number> };
export type SimResponse = Exploration & { id: number };

const season = data as Season;

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const { id, teamId, locks } = e.data;
  const r = explore(season, { conference: CONFERENCE, iterations: ITERATIONS, seed: SEED, teamId, locks });
  self.postMessage({ id, ...r } satisfies SimResponse);
};
