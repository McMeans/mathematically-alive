// Re-runs the odds with locked game results off the main thread.
import { explore, simulateNational, type Exploration, type NationalResult, type Season } from "@/core";
import { ITERATIONS, SEED, SUPPORTED_CONFERENCES } from "./config";
import data from "./data/season.json";

export type SimRequest = { id: number; conference: string; teamId: number; locks: Record<number, number> };
export type SimResponse = Omit<Exploration, "national"> & { id: number };

const season = data as Season;
// The last run's national simulation: the next what-if copies the title races its changed locks don't touch.
let last: NationalResult | undefined;
// Warm it up while the page is read, so even the first what-if replays only the title races its lock touches.
setTimeout(() => {
  last ??= simulateNational(season, { iterations: ITERATIONS, seed: SEED, conferences: SUPPORTED_CONFERENCES });
}, 0);

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const { id, conference, teamId, locks } = e.data;
  const { national, ...r } = explore(season, { conference, iterations: ITERATIONS, seed: SEED, teamId, locks, reuse: last });
  last = national ?? undefined;
  self.postMessage({ id, ...r } satisfies SimResponse);
};
