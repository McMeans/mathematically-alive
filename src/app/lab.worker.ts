// The Season Lab's simulations and link codec, off the main thread (the codec needs the whole season, which only
// this worker loads). Each pick runs twice: a quick pass for numbers right away, then the full run. A newer pick
// skips the full run of an older one.
import { decodeLabBracket, decodeLabLocks, decodeLocks, decodeTitlePick, encodeLabLocks, fillLabLocks, labChanges, labHeld, labTeamOdds, seasonLab, simulateBracket, type BracketGame, type LabBracketPicks, type LabChanges, type LabFill, type LabHeld, type LabLocks, type LabTeamOdds, type NationalResult, type Season, type SeasonLab } from "@/core";
import { ITERATIONS, QUICK_ITERATIONS, SEED, SUPPORTED_CONFERENCES } from "./config";
import data from "./data/season.json";

/**
 * What the page shows. `changes`: what the last pick changed, from the quick runs (null before any). `focus`: the
 * pinned team's odds in this run (null when none is pinned).
 */
// Big games are the no-picks list the page is built with (`Props.bigGames`), so runs don't send their own.
export type LabView = Omit<SeasonLab, "national" | "locks" | "bigGames"> & { changes: LabChanges | null; focus: LabTeamOdds | null };
export type LabRequest =
  | { kind: "run"; id: number; locks: LabLocks; focus: number | null }
  /**
   * A link's picks: the Lab's own (`picks`, and `bracket`, a filled-in bracket shown but never run), or a team page's
   * game picks (`games`) and title-game pick (`title`, `<conference>~<team>`).
   */
  | { kind: "open"; id: number; picks: string | null; games: string | null; title: string | null; bracket: string | null }
  /** Pick every open game: favourites, or one season drawn from a seed. */
  | { kind: "fill"; id: number; locks: LabLocks; how: LabFill }
  /** Play out the bracket's open games once; `picked` winners kept. Answered with `bracketed`. */
  | { kind: "bracket"; id: number; games: BracketGame[]; picked: Record<number, number>; seed: number }
  /** Back to no picks (the page shows its own no-picks view): the next pick's changes are against no picks. */
  | { kind: "reset"; id: number };
export type LabResponse =
  /** `held`: on a quick run, the odds the pick barely moved (`labHeld`), which the page keeps as shown. */
  | { kind: "result"; id: number; final: boolean; view: LabView; code: string; held?: LabHeld }
  /** `bracket`: the link's filled-in bracket, checked against the season (null when it has none, or it doesn't fit). */
  | { kind: "opened"; id: number; locks: LabLocks; note: string; bracket: LabBracketPicks | null }
  | { kind: "filled"; id: number; locks: LabLocks }
  | { kind: "bracketed"; id: number; key: string; picks: Record<number, number> }
  | { kind: "error"; id: number };

const season = data as Season;
const base = { iterations: ITERATIONS, seed: SEED, conferences: SUPPORTED_CONFERENCES };
// The latest run at each size (none until the first pick: a visit without picks simulates nothing here): the next pick copies the title races its changed picks don't touch.
let quick: NationalResult | undefined;
let full: NationalResult | undefined;
let newest = 0;
// The last quick run, what the next pick's change log compares against (the same size and seed, so seasons line up).
let shown: SeasonLab | undefined;
// A shared link's picks aren't the visitor's last change: its first run shows none.
let opened = false;

function run(locks: LabLocks, iterations: number, reuse: NationalResult | undefined) {
  return seasonLab(season, { ...base, iterations, locks, reuse });
}
const strip = (lab: SeasonLab, changes: LabChanges | null, focus: number | null): LabView => ({
  summary: lab.summary, fieldTexts: lab.fieldTexts, loaded: lab.loaded, picks: lab.picks, open: lab.open, playoff: lab.playoff, champions: lab.champions, conferences: lab.conferences,
  ranking: lab.ranking, live: lab.live, liveAll: lab.liveAll, allLabel: lab.allLabel, topLabel: lab.topLabel, backLabel: lab.backLabel, records: lab.records, changes, focus: focus === null ? null : labTeamOdds(season, lab, focus),
});

self.onmessage = async (e: MessageEvent<LabRequest>) => {
  const req = e.data;
  if (req.kind !== "bracket") newest = Math.max(newest, req.id);
  try {
    if (req.kind === "open") {
      const lab = decodeLabLocks(season, req.picks ?? "");
      const games = decodeLocks(req.games, season.games.filter((g) => !g.completed));
      const locks = { ...lab.locks, games: { ...lab.locks.games, ...games }, titles: { ...lab.locks.titles, ...decodeTitlePick(season, req.title) } };
      opened = true;
      self.postMessage({ kind: "opened", id: req.id, locks, note: lab.note, bracket: decodeLabBracket(season, req.bracket) } satisfies LabResponse);
      return;
    }
    if (req.kind === "reset") {
      shown = undefined;
      opened = false; // a link with no usable picks never runs: the next pick is the visitor's own
      return;
    }
    if (req.kind === "bracket") {
      const key = JSON.stringify(req.games.map((g) => [g.a, g.b]));
      self.postMessage({ kind: "bracketed", id: req.id, key, picks: simulateBracket(season, req.games, req.picked, req.seed) } satisfies LabResponse);
      return;
    }
    if (req.kind === "fill") {
      self.postMessage({ kind: "filled", id: req.id, locks: fillLabLocks(season, req.locks, req.how, SUPPORTED_CONFERENCES) } satisfies LabResponse);
      return;
    }
    const code = encodeLabLocks(season, req.locks);
    const before = shown ?? run({ games: {}, titles: {}, bracket: {} }, QUICK_ITERATIONS, quick);
    const q = run(req.locks, QUICK_ITERATIONS, quick ?? before.national);
    quick = q.national;
    shown = q;
    const changes = opened ? null : labChanges(season, before, q);
    opened = false;
    const held = labHeld(before, q);
    self.postMessage({ kind: "result", id: req.id, final: false, view: strip(q, changes, req.focus), code, held } satisfies LabResponse);
    await new Promise((r) => setTimeout(r, 0)); // let a newer pick arrive
    if (req.id !== newest) return;
    const f = run(req.locks, ITERATIONS, full);
    full = f.national;
    self.postMessage({ kind: "result", id: req.id, final: true, view: strip(f, changes, req.focus), code } satisfies LabResponse);
  } catch {
    self.postMessage({ kind: "error", id: req.id } satisfies LabResponse);
  }
};
