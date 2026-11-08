// The Season Lab's simulations and link codec, off the main thread (the codec needs the whole season, which only
// this worker loads). Each pick runs twice: a quick pass for numbers right away, then the full run. A newer pick
// skips the full run of an older one.
import { decodeLabLocks, decodeLocks, encodeLabLocks, fillLabLocks, seasonLab, type LabFill, type LabLocks, type NationalResult, type Season, type SeasonLab } from "@/core";
import { ITERATIONS, QUICK_ITERATIONS, SEED, SUPPORTED_CONFERENCES } from "./config";
import data from "./data/season.json";

export type LabView = Omit<SeasonLab, "national">;
export type LabRequest =
  | { kind: "run"; id: number; locks: LabLocks }
  /** A link's picks: the Lab's own (`picks`), or a team page's game picks (`games`). */
  | { kind: "open"; id: number; picks: string | null; games: string | null }
  /** Pick every open game: favourites, or one season drawn from a seed. */
  | { kind: "fill"; id: number; locks: LabLocks; how: LabFill };
export type LabResponse =
  | { kind: "result"; id: number; final: boolean; view: LabView; code: string }
  | { kind: "opened"; id: number; locks: LabLocks; note: string }
  | { kind: "filled"; id: number; locks: LabLocks }
  | { kind: "error"; id: number };

const season = data as Season;
const base = { iterations: ITERATIONS, seed: SEED, conferences: SUPPORTED_CONFERENCES };
// The latest run at each size (none until the first pick: a visit without picks simulates nothing here): the next pick copies the title races its changed picks don't touch.
let quick: NationalResult | undefined;
let full: NationalResult | undefined;
let newest = 0;

function run(locks: LabLocks, iterations: number, reuse: NationalResult | undefined) {
  const { national, ...view } = seasonLab(season, { ...base, iterations, locks, reuse });
  return { national, view };
}

self.onmessage = async (e: MessageEvent<LabRequest>) => {
  const req = e.data;
  newest = Math.max(newest, req.id);
  try {
    if (req.kind === "open") {
      const lab = decodeLabLocks(season, req.picks ?? "");
      const games = decodeLocks(req.games, season.games.filter((g) => !g.completed));
      const locks = { ...lab.locks, games: { ...lab.locks.games, ...games } };
      self.postMessage({ kind: "opened", id: req.id, locks, note: lab.note } satisfies LabResponse);
      return;
    }
    if (req.kind === "fill") {
      self.postMessage({ kind: "filled", id: req.id, locks: fillLabLocks(season, req.locks, req.how) } satisfies LabResponse);
      return;
    }
    const code = encodeLabLocks(season, req.locks);
    const q = run(req.locks, QUICK_ITERATIONS, quick);
    quick = q.national;
    self.postMessage({ kind: "result", id: req.id, final: false, view: q.view, code } satisfies LabResponse);
    await new Promise((r) => setTimeout(r, 0)); // let a newer pick arrive
    if (req.id !== newest) return;
    const f = run(req.locks, ITERATIONS, full);
    full = f.national;
    self.postMessage({ kind: "result", id: req.id, final: true, view: f.view, code } satisfies LabResponse);
  } catch {
    self.postMessage({ kind: "error", id: req.id } satisfies LabResponse);
  }
};
