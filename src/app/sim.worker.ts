// Re-runs the odds with locked game results off the main thread.
import { seasonOutlook, teamPath, type Season, type TeamOutlook, type TeamPath } from "@/core";
import data from "./data/season.json";

export type SimRequest = { id: number; teamId: number; locks: Record<number, number> };
export type SimResponse = { id: number; path: TeamPath; outlook: TeamOutlook };

const season = data as Season;
const opts = { conference: "ACC", iterations: 5000, seed: 2026 };

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const { id, teamId, locks } = e.data;
  const path = teamPath(season, { ...opts, teamId, locks });
  const outlook = seasonOutlook(season, { ...opts, locks }).teams.find((t) => t.teamId === teamId)!;
  self.postMessage({ id, path, outlook } satisfies SimResponse);
};
