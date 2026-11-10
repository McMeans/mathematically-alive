// Re-runs the odds with locked game results off the main thread.
import { explore, exploreIndependent, simulateNational, type Exploration, type IndependentExploration, type NationalResult, type Season } from "@/core";
import { ITERATIONS, SEED, SUPPORTED_CONFERENCES } from "./config";
import data from "./data/season.json";

/** A conference team's page (`conference`), or an independent's (`conference` null). */
export type SimRequest = { id: number; conference: string | null; teamId: number; locks: Record<number, number>; titles?: Record<string, number> };
export type SimResponse =
  | (Omit<Exploration, "national"> & { id: number; independent: false })
  | (Omit<IndependentExploration, "national"> & { id: number; independent: true });

const season = data as Season;
// The last run's national simulation: the next what-if copies the title races its changed locks don't touch.
let last: NationalResult | undefined;
// Warm it up while the page is read, so even the first what-if replays only the title races its lock touches.
setTimeout(() => {
  last ??= simulateNational(season, { iterations: ITERATIONS, seed: SEED, conferences: SUPPORTED_CONFERENCES });
}, 0);

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const { id, conference, teamId, locks, titles } = e.data;
  if (conference === null) {
    const { national, ...r } = exploreIndependent(season, { iterations: ITERATIONS, seed: SEED, teamId, locks, reuse: last });
    last = national;
    self.postMessage({ id, independent: true, ...r } satisfies SimResponse);
    return;
  }
  const { national, ...r } = explore(season, { conference, iterations: ITERATIONS, seed: SEED, teamId, locks, titleLocks: titles, reuse: last });
  last = national ?? last;
  self.postMessage({ id, independent: false, ...r } satisfies SimResponse);
};
