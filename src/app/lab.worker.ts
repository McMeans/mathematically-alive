// The Season Lab's simulations and link codec, off the main thread (the codec needs the whole season, which only
// this worker loads). Each pick runs twice: a quick pass for numbers right away, then the full run. A newer pick
// skips the full run of an older one.
import { decodeLabLocks, decodeLocks, encodeLabLocks, fillLabLocks, labChanges, seasonLab, type LabChanges, type LabFill, type LabLocks, type NationalResult, type Season, type SeasonLab } from "@/core";
import { ITERATIONS, QUICK_ITERATIONS, SEED, SUPPORTED_CONFERENCES } from "./config";
import data from "./data/season.json";

/** What the page shows. `changes`: what the last pick changed, from the quick runs (null before any). */
export type LabView = Omit<SeasonLab, "national"> & { changes: LabChanges | null };
export type LabRequest =
  | { kind: "run"; id: number; locks: LabLocks }
  /** A link's picks: the Lab's own (`picks`), or a team page's game picks (`games`). */
  | { kind: "open"; id: number; picks: string | null; games: string | null }
  /** Pick every open game: favourites, or one season drawn from a seed. */
  | { kind: "fill"; id: number; locks: LabLocks; how: LabFill }
  /** Back to no picks (the page shows its own no-picks view): the next pick's changes are against no picks. */
  | { kind: "reset"; id: number };
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
// The last quick run, what the next pick's change log compares against (the same size and seed, so seasons line up).
let shown: SeasonLab | undefined;

function run(locks: LabLocks, iterations: number, reuse: NationalResult | undefined) {
  return seasonLab(season, { ...base, iterations, locks, reuse });
}
const strip = (lab: SeasonLab, changes: LabChanges | null): LabView => ({
  summary: lab.summary, picks: lab.picks, open: lab.open, playoff: lab.playoff, conferences: lab.conferences,
  ranking: lab.ranking, bigGames: lab.bigGames, changes,
});

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
    if (req.kind === "reset") {
      shown = undefined;
      return;
    }
    if (req.kind === "fill") {
      self.postMessage({ kind: "filled", id: req.id, locks: fillLabLocks(season, req.locks, req.how) } satisfies LabResponse);
      return;
    }
    const code = encodeLabLocks(season, req.locks);
    const before = shown ?? run({ games: {}, titles: {}, bracket: {} }, QUICK_ITERATIONS, quick);
    const q = run(req.locks, QUICK_ITERATIONS, quick ?? before.national);
    quick = q.national;
    shown = q;
    const changes = labChanges(season, before, q);
    self.postMessage({ kind: "result", id: req.id, final: false, view: strip(q, changes), code } satisfies LabResponse);
    await new Promise((r) => setTimeout(r, 0)); // let a newer pick arrive
    if (req.id !== newest) return;
    const f = run(req.locks, ITERATIONS, full);
    full = f.national;
    self.postMessage({ kind: "result", id: req.id, final: true, view: strip(f, changes), code } satisfies LabResponse);
  } catch {
    self.postMessage({ kind: "error", id: req.id } satisfies LabResponse);
  }
};
