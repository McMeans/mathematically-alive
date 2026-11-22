// The Season Lab's simulations and link codec, off the main thread (the codec needs the whole season, which only
// this worker loads). Each pick answers twice: an estimate at once (the last full run's seasons the pick doesn't
// change), then the full run, which copies those seasons and plays the rest. A newer pick skips an older one's full run.
import { decodeLabBracket, decodeLabLocks, decodeLocks, decodeTitlePick, encodeLabLocks, fillLabLocks, labChanges, labHeld, labTeamOdds, seasonLab, simulateBracket, type BracketGame, type LabBracketPicks, type LabChanges, type LabFill, type LabHeld, type LabLocks, type LabTeamOdds, type Season, type SeasonLab } from "@/core";
import { ITERATIONS, SEED, SUPPORTED_CONFERENCES } from "./config";

/** Fewest seasons an estimate counts to be shown: fewer and the full run's numbers come alone. */
const MIN_ESTIMATE = 2000;
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
  /** `held`: on an estimate, the odds the pick barely moved (`labHeld`), which the page keeps as shown. */
  | { kind: "result"; id: number; final: boolean; view: LabView; code: string; held?: LabHeld }
  /** `bracket`: the link's filled-in bracket, checked against the season (null when it has none, or it doesn't fit). */
  | { kind: "opened"; id: number; locks: LabLocks; note: string; bracket: LabBracketPicks | null }
  | { kind: "filled"; id: number; locks: LabLocks }
  | { kind: "bracketed"; id: number; key: string; picks: Record<number, number> }
  | { kind: "error"; id: number };

const season = data as Season;
const base = { iterations: ITERATIONS, seed: SEED, conferences: SUPPORTED_CONFERENCES };
const none = (): LabLocks => ({ games: {}, titles: {}, bracket: {} });
/**
 * The last few full runs, newest first (each about 14 MB), with their picks and link code. A pick's estimate starts
 * from the closest one with only picks it keeps; its full run copies the seasons it doesn't change. Going back to picks
 * one of them has (an undo, a pick taken back) shows it again at once.
 */
const fulls: { lab: SeasonLab; locks: LabLocks; code: string }[] = [];
const KEEP_RUNS = 3;
function remember(lab: SeasonLab, locks: LabLocks, code: string) {
  const at = fulls.findIndex((f) => f.code === code);
  if (at >= 0) fulls.splice(at, 1);
  fulls.unshift({ lab, locks, code });
  fulls.length = Math.min(fulls.length, KEEP_RUNS);
}
const latestFull = () => {
  if (fulls.length === 0) remember(run(none()), none(), "");
  return fulls[0];
};
// Run the no-picks season while the page is read, so even the first pick shows its estimate at once.
setTimeout(latestFull, 0);
/** Whether every pick in `a` is in `b`, the same way. */
const within = (a: LabLocks, b: LabLocks) =>
  (["games", "titles", "bracket"] as const).every((k) => Object.entries(a[k]).every(([id, w]) => (b[k] as Record<string, number>)[id] === w));
const size = (l: LabLocks) => Object.keys(l.games).length + Object.keys(l.titles).length + Object.keys(l.bracket).length;
let newest = 0;
// A shared link's picks aren't the visitor's last change: its first run shows none.
let opened = false;

function run(locks: LabLocks, opts: { reuse?: SeasonLab; estimate?: boolean } = {}) {
  return seasonLab(season, { ...base, locks, reuse: opts.reuse?.national, estimate: opts.estimate });
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
    await new Promise((r) => setTimeout(r, 0)); // let a newer pick arrive
    if (req.id !== newest) return;
    const code = encodeLabLocks(season, req.locks);
    const before = latestFull();
    const done = (lab: SeasonLab) => {
      remember(lab, req.locks, code);
      const changes = opened ? null : labChanges(season, before.lab, lab);
      opened = false;
      self.postMessage({ kind: "result", id: req.id, final: true, view: strip(lab, changes, req.focus), code } satisfies LabResponse);
    };
    // Picks a recent full run has: that run, exact, at once.
    const again = fulls.find((f) => f.code === code);
    if (again) return done(again.lab);
    // The estimate: the closest recent run with only picks this one keeps, its seasons the new picks don't change,
    // weighed, with nothing simulated. Without such a run it simulates in full: that is the answer.
    const from = fulls.filter((f) => within(f.locks, req.locks)).sort((x, y) => size(y.locks) - size(x.locks))[0] ?? before;
    const est = run(req.locks, { reuse: from.lab, estimate: true });
    if (est.national.iterations === ITERATIONS) return done(est);
    // Too few seasons kept (a link's or a fill's many picks) say little: the full run's numbers come alone.
    if (est.national.iterations >= MIN_ESTIMATE) {
      // The change log waits for the full run: an estimate's smaller sample could name a team the full run doesn't.
      self.postMessage({ kind: "result", id: req.id, final: false, view: strip(est, null, req.focus), code, held: labHeld(before.lab, est) } satisfies LabResponse);
    }
    await new Promise((r) => setTimeout(r, 0)); // let a newer pick arrive
    if (req.id !== newest) return;
    done(run(req.locks, { reuse: from.lab }));
  } catch {
    self.postMessage({ kind: "error", id: req.id } satisfies LabResponse);
  }
};
