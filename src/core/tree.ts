// A branching view of a team's remaining conference games: for each win/loss
// combination, how likely it is and what it does to the team's conference
// title-game odds. A branch stops as soon as its outcome is settled (in or out in
// every simulated season that goes that way) or too rare to call, so every
// scenario is covered without drawing branches that can't change anything.
//
// Non-conference games aren't branched on: the title game is decided by
// conference results alone, so they can't move these odds. The season view lists them.
//
// Also lists "help from elsewhere": every other remaining conference game, with
// the team's odds for each result, and whether it clearly matters now or in one
// of the team's own-result scenarios (for example "if Louisville wins out").
//
// Uses the same simulated seasons and title-game draw as teamPath, so the root
// odds equal teamPath's titleGame for the same seed and locks.
import { seasonOutlook, type TeamOutlook } from "./outlook";
import { formatFine, formatOdds, formatSideOdds, formatTitleOdds, mustWinConference, type PathOptions, type PathStatus } from "./paths";
import { teamRecord } from "./season";
import type { Game, Season } from "./season";
import { FAINT, OVERALL, SCENARIO, isClear } from "./signal";
import { gameWinProbability, mix, mulberry32, simulateSeason, type SimResult } from "./sim";
import { likeliestWayIn, trimWay, type WayIn } from "./likeliest";
import { provenStatus, type ProvenStatus } from "./proof";
import { championshipFromData, conferenceData, countsNonConference, luckSteps } from "./tiebreak";

export type TreeOptions = PathOptions & {
  /** How many of the team's next unplayed conference games to branch on. Default: all of them (at most 12). */
  depth?: number;
};

/**
 * How a branch ends when it stops early or reaches the team's last game:
 * "in" / "out": made / missed the title game in every simulated season that went this way;
 * "rare": too few simulated seasons went this way to give odds;
 * "never": a locked result rules this branch out.
 */
export type TreeOutcome = "in" | "out" | "rare" | "never";

export type TreeNode = {
  /** The game this node decides; absent on the root. */
  gameId?: number;
  /** True if the team wins this game on this branch. */
  win?: boolean;
  /** "Beat Wake Forest" / "Lose to Wake Forest"; "Today" on the root. */
  label: string;
  /** "Nov 7 · away" (America/New_York date, home/away/neutral); "" on the root. */
  detail: string;
  /** Fraction of all simulated seasons that follow this branch (root = 1). */
  reach: number;
  /** Title-game odds given this branch; null if too few seasons reached it. */
  odds: number | null;
  /** Null while the branch is open (odds strictly between 0 and 1). */
  outcome: TreeOutcome | null;
  /** What to show in place of the odds: "In", "Out", "Rare", "—" (never), or the odds ("42%"). */
  verdict: string;
  /** A sentence explaining a settled or rare branch; null on open branches. */
  note: string | null;
  /** Remaining conference games below this node that the tree doesn't branch on because the outcome is settled. */
  rest: number;
  /** Final conference record ("6-2 ACC") on open leaves after the team's last conference game, when the tree covers all of them. */
  record: string | null;
  /** On the most likely path: at each level the child with the higher reach (ties: the win). */
  likely: boolean;
  children: TreeNode[];
};

/** A remaining conference game the team isn't in, and what each result does to the team's odds. */
export type HelpGame = {
  gameId: number;
  homeId: number;
  awayId: number;
  /** "Duke at Wake Forest" ("vs" at a neutral site). */
  label: string;
  /** "Nov 28" (America/New_York), or "week 13" when the date is unknown. */
  detail: string;
  /** The team's title-game odds if the home team wins; null if too few seasons went that way. */
  oddsIfHomeWins: number | null;
  oddsIfAwayWins: number | null;
  /** Gap between the two (0 when either is null). */
  swing: number;
  /** The result clearly moves the team's odds right now (at least 1 point and clear of sampling noise). */
  now: boolean;
  /** The result moves the team's odds at all, past sampling noise: a lower bar than `now`, with no minimum size. */
  leans: boolean;
  /**
   * The team's own-result scenario where this game swings the odds most, when that's clearly
   * bigger than now (at least 5 points more and clear of sampling noise). Null otherwise.
   */
  scenario: {
    /** "if Louisville wins out", "if SMU loses only to Syracuse", "if Virginia Tech beats SMU". */
    when: string;
    oddsIfHomeWins: number;
    oddsIfAwayWins: number;
    swing: number;
    /** "Matters more if Louisville wins out: 41% with a Duke win, 7% with a Wake Forest win." */
    line: string;
  } | null;
  /** Team to root for: the winner that gives the better odds (in the scenario when it only matters there); null if it doesn't matter. */
  rooting: number | null;
  /** Proven effect of each result: "in" clinches the title-game spot, "out" eliminates the team; null otherwise. */
  ifHomeWins: "in" | "out" | null;
  ifAwayWins: "in" | "out" | null;
};

/**
 * The most probable combination of remaining conference results that puts the team in the title game,
 * found exactly (not sampled), keeping only the results its spot depends on.
 */
export type Likeliest = {
  /** The team's own results first, then results elsewhere; every one is needed given the others. */
  picks: { gameId: number; winner: number }[];
  /** The picks the card names: the team's own results and the non-favorites elsewhere (not favorites winning). */
  named: { gameId: number; winner: number }[];
  /** Chance every picked result happens: their game odds multiplied, as if independent (see `WayIn.chance`). */
  chance: number;
  /** Picked results that go against the likelier side. */
  upsets: number;
  /** True when the picks get the team in only if it also wins the ranking tiebreak. */
  needsTiebreak: boolean;
  /** With `needsTiebreak`, how often the team gets in with the picks locked (from a simulation); else null. */
  tiebreak: number | null;
  /** Chance the whole way happens: `chance`, times `tiebreak` when there is one. */
  overall: number;
  /** "Likeliest way in (4% chance): Virginia beats Duke; and Miami beats Pitt." The chance is `overall`. */
  line: string;
  /**
   * Card title: "What Virginia needs". The card lays out the likeliest way in, one sufficient way and not
   * the only one, so its `scope` line says so.
   */
  title: string;
  /** "On its likeliest way in". */
  scope: string;
  /** One line for the card when it's minimized: "Win out, Duke and Miami each lose twice". */
  summary: string;
  /** The team's own results: "Beat Duke", "Lose to Miami". */
  own: string[];
  /** Results elsewhere that aren't the favorite winning: "Miami over Pitt". */
  needs: string[];
  /** "Favorites win the other 11 games it needs", or null. */
  favorites: string | null;
  /** "With these results Virginia gets in about 40% of the time, depending on the ranking tiebreak.", or null. The Big 12 note names total wins too; the SEC note, the scoring margin tiebreak. */
  note: string | null;
  /** The team's part: "Win all 4 left", "Win 3 of 4 left". */
  ownJob: string;
  /** The same, short, under the team's name on the card: "wins all 4", "wins both", "wins 3 of 4", "2 wins, 1 loss". */
  ownSummary: string;
  /**
   * The team's games left, in kickoff order: the opponent, the team's chance to win, and the result the way
   * needs ("win", "lose", or null when either will do).
   */
  ownGames: { opponent: string; winChance: number; result: "win" | "lose" | null }[];
  /** Chance the team gets its own results in the picks. */
  ownChance: number;
  /** Teams the picks need to lose a game they're favored in, most losses first. */
  rivals: Rival[];
  /** The picks by week, in order, with the team's odds once each week goes this way. */
  weeks: WayWeek[];
};

export type Rival = {
  teamId: number;
  team: string;
  /** Losses the picks give it, out of `left` games still to play (not counting the team's own game with it). */
  needs: number;
  left: number;
  /** The exact results the picks need: "Loses to Virginia Tech and Stanford", "Loses to Duke, beats Wake Forest". */
  line: string;
  /**
   * Its games left: the opponent, the chance of that upset (the rival losing), and the result the picks
   * need from it: "lose", "win" (another rival has to lose it), or null when either result will do.
   */
  games: { opponent: string; chance: number; result: "lose" | "win" | null }[];
  /** Chance it gets every result the picks need from it. */
  chance: number;
  /** The results it needs, counted: "2 losses, 2 wins", "2 losses, 2 either way", "1 loss". */
  summary: string;
};

export type WayWeek = {
  /** "Nov 7" */
  label: string;
  /** The team's own pick that week, "Beat Clemson", or null. */
  own: string | null;
  /** Named results elsewhere that week (not a favorite winning), with their chances. */
  root: { what: string; chance: number }[];
  /** "Favorites win 2 others", or null. */
  favorites: string | null;
  /** Team's odds once every pick through this week happens; null when too few simulated seasons go this way. */
  after: number | null;
  /** `after` for display: "In", "12%", "<1%", or "—" when unknown. */
  afterLabel: string;
};

export type Impact = "big" | "some" | "small";
// Impact is the gap between the two sides' odds, relative to the team's odds now (floored at 2%, so a
// long shot's noise doesn't read as big): at least half of it is big, a fifth some, anything else small.
// Search nodes for proving the picks alone settle the team. More than one game side gets: when it works, every other proof is skipped.
const ROOT_BUDGET = 150_000;
// Search nodes the rest of a tree's proofs share (branches, game sides, locked games). A team its proofs can't
// settle would otherwise spend a full budget on every one for nothing (Penn State, 2026: 2 million nodes, 40 s).
// Once these run out, the rest show their odds (">99%", "<1%") instead of In or Out. Above every ACC, Big 12 and
// SEC page on 2026 data (the most, Auburn: 212,000).
const TREE_POOL = 250_000;
const IMPACT_FLOOR = 0.02;
const BIG = 0.5;
const SOME = 0.2;

/** One week of the rest of the season, for picking results week by week. */
export type SeasonWeek = {
  week: number;
  /** "Nov 7": the team's game that week, else the first game. */
  label: string;
  /** The team's own conference game that week, with its odds if it wins or loses; null on a bye. */
  own: {
    gameId: number;
    opponentId: number;
    opponent: string;
    site: "home" | "away" | "neutral";
    /** Title-game odds as if that result were picked: the same simulated seasons with only this game changed. */
    oddsIfWin: number;
    oddsIfLose: number;
    /** For display: "In", "Out", "12%" or "0.4%"; what picking that result would show. */
    ifWin: string;
    ifLose: string;
    /** The team's playoff odds (EXPERIMENTAL) as if that result were picked ("41%"); null when it must win the conference (`mustWinConference`), so only the title matters. */
    cfpIfWin: string | null;
    cfpIfLose: string | null;
    /** "58% to win", from the game itself, so a locked pick still shows it. */
    winChance: string;
  } | null;
  /** The team's conference game that week when it's already final; null otherwise. */
  played: { gameId: number; opponent: string; site: "home" | "away" | "neutral"; won: boolean; score: string } | null;
  /**
   * The team's non-conference game that week: on the schedule, but not in the conference standings
   * (it feeds the ranking used to break a tie, and in the Big 12 the total-wins step too).
   * `won` and `score` once it's final, else null.
   * `ifWin`/`ifLose`: the team's playoff odds (EXPERIMENTAL) as if that result were picked, for display ("36%"); null once it's final.
   * `titleIfWin`/`titleIfLose`: its title-game odds the same way, where the conference's tiebreak counts non-conference
   * results (the Big 12's total wins); null elsewhere (the result reaches the title race only through the ranking) or once final.
   * `winChance`: "97% to win", locked or not; null once it's final.
   */
  nonConference: {
    gameId: number; opponentId: number; opponent: string; site: "home" | "away" | "neutral"; date: string; won: boolean | null; score: string | null;
    ifWin: string | null; ifLose: string | null; titleIfWin: string | null; titleIfLose: string | null; winChance: string | null;
  } | null;
  /**
   * Every game elsewhere that week: locked ones first, then those that matter, then the rest, biggest swing first.
   * `ifHome`/`ifAway`: the team's odds if that side wins, for display.
   * `homeWinChance`/`awayWinChance`: each side's chance to win the game itself ("62% to win"), locked or not.
   */
  games: {
    gameId: number; homeId: number; awayId: number; home: string; away: string; ifHome: string; ifAway: string; swing: number;
    homeWinChance: string; awayWinChance: string;
    /** The winner the likeliest way in names here, when that side is also the one that helps the team more; else null. */
    likely: number | null;
    /** Locked, changes the team's odds (now or in a scenario), or needed by the likeliest way in. */
    matters: boolean;
    /** The side whose win raises the team's odds, or null when it can't be told (or it's locked). */
    helps: number | null;
    /** How much picking `helps` moves the team's odds, relative to its odds now: "big", "some", "small", or null. */
    impact: Impact | null;
  }[];
  /** Games elsewhere that week that don't change the team's odds. */
  quiet: number;
};

export type PathTree = {
  titleGame: number;
  /** The rest of the season by week. */
  weeks: SeasonWeek[];
  root: TreeNode;
  /** Names the team's remaining games that aren't in the tree and why; null when the tree covers them all. */
  footnote: string | null;
  /**
   * Every remaining unlocked conference game the team isn't in: first those that matter now
   * (biggest first), then those that matter only in a scenario (biggest first), then the rest by kickoff.
   */
  help: HelpGame[];
  /** One line about the help list, covering the games that don't matter. */
  helpNote: string;
  /**
   * Null when the team is proven in or out, when no combination of results gets it in, or (rarely) when the
   * search runs out of budget before it finds any way in.
   */
  likeliest: Likeliest | null;
};

const MAX_DEPTH = 12;
// Seasons of the shared sample replayed, with one game flipped, for the other side of each locked game.
const SWAP_ITERATIONS = 2_000;
// Seasons simulated to put a chance on the ranking tiebreak a likeliest way in needs.
const TIEBREAK_ITERATIONS = 2_000;
// How much likelier a way through the ranking tiebreak has to be than a sure way to be shown instead.
const TIEBREAK_EDGE = 1.5;
// Search nodes for a swapped pick's first, quick proof.
const QUICK_BUDGET = 3_000;
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

const when = (g: Game): string => {
  const d = new Date(g.start);
  return Number.isNaN(d.getTime()) ? `week ${g.week}` : DATE_FORMAT.format(d);
};
const list = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

type Step = { opp: string; win: boolean };
type Peak = Omit<NonNullable<HelpGame["scenario"]>, "line">;

/**
 * `shared`: a simulation of the same season, iterations, seed and locks to reuse.
 * `outlook`: the conference's outlook from that same simulation, to reuse.
 */
export function pathTree(season: Season, opts: TreeOptions, shared?: SimResult, outlook?: TeamOutlook[]): PathTree {
  const { conference, teamId, iterations, seed } = opts;
  const data = conferenceData(season, conference);
  if (data.ids.size < 2) throw new Error(`${conference} has fewer than two teams`);
  if (!data.ids.has(teamId)) throw new Error(`team ${teamId} is not in ${conference}`);
  const wanted = opts.depth ?? MAX_DEPTH;
  if (!Number.isInteger(wanted) || wanted < 0) throw new RangeError("depth must be a non-negative integer");

  const sim = shared ?? simulateSeason(season, { iterations, seed, locks: opts.locks });
  const gameIndex = new Map<number, number>(season.games.map((g, i) => [g.id, i]));
  const name = (id: number): string => season.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;
  const team = name(teamId);
  const confGames = new Set(data.games);

  const indexed = season.games.map((g, i) => ({ g, i }));
  const byKickoff = (x: (typeof indexed)[number], y: (typeof indexed)[number]) =>
    (Date.parse(x.g.start) || 0) - (Date.parse(y.g.start) || 0) || x.g.week - y.g.week || x.i - y.i;
  const ownAll = indexed.filter(({ g }) => !g.completed && (g.homeId === teamId || g.awayId === teamId)).sort(byKickoff);
  const ownConf = ownAll.filter(({ g }) => confGames.has(g));
  const levels = ownConf.slice(0, Math.min(wanted, MAX_DEPTH));
  const depth = levels.length;
  const others = indexed
    .filter(({ g }) => confGames.has(g) && !g.completed && g.homeId !== teamId && g.awayId !== teamId && !(opts.locks && g.id in opts.locks))
    .sort(byKickoff);

  // Bucket index: bit (depth-1-k) is 1 when the team loses level k, so a win sorts before a loss
  // and every prefix covers one contiguous range of buckets.
  const size = 1 << depth;
  const H = others.length;
  const count = new Float64Array(size);
  const inTitle = new Float64Array(size);
  // Per other game h and bucket b (index h * size + b): seasons where its home team won,
  // and how many of those, and of its away wins, sent the team to the title game.
  const homeN = new Float64Array(H * size);
  const homeIn = new Float64Array(H * size);
  const awayIn = new Float64Array(H * size);
  let total = 0;
  const reachedAt = new Uint8Array(sim.iterations);
  sim.forEachIteration((iteration, winnerAt, teams) => {
    let b = 0;
    for (let k = 0; k < depth; k++) if (winnerAt(levels[k].i) !== teamId) b |= 1 << (depth - 1 - k);
    const rand = mulberry32(mix(seed, iteration, 1));
    const [x, y] = championshipFromData(data, (g: Game) => winnerAt(gameIndex.get(g.id)!), { draw: rand, rank: teams.rank });
    const reached = x === teamId || y === teamId;
    if (reached) reachedAt[iteration] = 1;
    count[b]++;
    if (reached) inTitle[b]++;
    for (let h = 0; h < H; h++) {
      const { g, i } = others[h];
      if (winnerAt(i) === g.homeId) {
        homeN[h * size + b]++;
        if (reached) homeIn[h * size + b]++;
      } else if (reached) awayIn[h * size + b]++;
    }
    total++;
  });

  const minSample = Math.max(30, Math.ceil(sim.iterations * 0.01));
  const sum = (arr: Float64Array, lo: number, hi: number, off = 0): number => {
    let s = 0;
    for (let b = lo; b < hi; b++) s += arr[off + b];
    return s;
  };
  const covered = depth === ownConf.length;
  const base = teamRecord(season, teamId);

  // Per other game: the open scenario (tree node below the root) where it clearly swings the odds most.
  const peaks: (Peak | null)[] = others.map(() => null);
  const scenarioText = (path: Step[]): string => {
    const wins = path.filter((p) => p.win).map((p) => p.opp);
    const losses = path.filter((p) => !p.win).map((p) => p.opp);
    if (path.length === depth && covered) {
      return losses.length === 0 ? `if ${team} wins out` : `if ${team} loses only to ${list(losses)}`;
    }
    const parts = [wins.length ? `beats ${list(wins)}` : "", losses.length ? `loses to ${list(losses)}` : ""];
    return `if ${team} ${parts.filter(Boolean).join(" and ")}`;
  };
  const considerScenario = (lo: number, hi: number, path: Step[]) => {
    const n = sum(count, lo, hi);
    for (let h = 0; h < H; h++) {
      const off = h * size;
      const hn = sum(homeN, lo, hi, off);
      const an = n - hn;
      if (hn < minSample || an < minSample) continue;
      const hIn = sum(homeIn, lo, hi, off);
      const aIn = sum(awayIn, lo, hi, off);
      if (!isClear(hn, hIn, an, aIn, SCENARIO)) continue;
      const swing = Math.abs(hIn / hn - aIn / an);
      const prev = peaks[h];
      if (prev && prev.swing >= swing) continue;
      peaks[h] = { when: scenarioText(path), oddsIfHomeWins: hIn / hn, oddsIfAwayWins: aIn / an, swing };
    }
  };

  // Proofs are the slow part, and the same lock sets come up more than once (a branch of the tree and its game in the
  // week list, a game side and its verdict). Once the locks alone settle the team, adding more can't change that (swapping one can).
  const proofs = new Map<string, ProvenStatus>();
  const pool = { left: TREE_POOL };
  const baseKey = Object.entries(opts.locks ?? {}).sort().join();
  const proven = (locks: Record<number, number>): ProvenStatus => {
    const base = proofs.get(baseKey);
    const more = Object.entries(opts.locks ?? {}).every(([id, w]) => locks[Number(id)] === w);
    if (more && base !== undefined && base !== "open") return base;
    const key = Object.entries(locks).sort().join();
    let s = proofs.get(key);
    if (s === undefined) {
      s = key === baseKey ? provenStatus(season, conference, teamId, locks, ROOT_BUDGET) : provenStatus(season, conference, teamId, locks, undefined, pool);
      proofs.set(key, s);
    }
    return s;
  };

  const prefixLocks = (path: Step[]): Record<number, number> => {
    const l: Record<number, number> = { ...opts.locks };
    path.forEach((p, k) => {
      const g = levels[k].g;
      l[g.id] = p.win ? teamId : g.homeId === teamId ? g.awayId : g.homeId;
    });
    return l;
  };
  const settle = (node: TreeNode, level: number, path: Step[]): TreeNode => {
    const rest = depth - level;
    const left = rest > 0 ? ` ${rest === 1 ? "The last game" : `The last ${rest} games`} can't change that.` : "";
    const stop = (outcome: TreeOutcome, verdict: string, note: string): TreeNode => ({ ...node, outcome, verdict, note, rest });
    if (node.reach === 0) return stop("never", "—", "A locked result rules this out.");
    if (node.odds === null) return level === 0 ? node : stop("rare", "Rare", "Too few simulated seasons go this way to put odds on it.");
    const proof = node.odds === 1 || node.odds === 0 ? proven(prefixLocks(path)) : "open";
    if (proof === "open" && node.odds === 1) return { ...node, verdict: ">99%" };
    if (proof === "open" && node.odds === 0) return { ...node, verdict: "<1%" };
    if (node.odds === 1) return stop("in", "In", `In the title game whatever else happens.${left}`);
    if (node.odds === 0) return stop("out", "Out", `Can't make the title game from here: no combination of other results gets there.${left}`);
    return node;
  };

  const build = (level: number, prefix: number, wins: number, extra: Partial<TreeNode>, path: Step[]): TreeNode => {
    const lo = prefix << (depth - level);
    const hi = (prefix + 1) << (depth - level);
    const n = sum(count, lo, hi);
    const odds = n >= minSample ? sum(inTitle, lo, hi) / n : null;
    const last = level === depth;
    const node = settle({
      label: "Today", detail: "", ...extra,
      reach: n / total,
      odds,
      outcome: null,
      verdict: odds === null ? "—" : formatOdds(odds),
      note: null,
      rest: 0,
      record: last && level > 0 && covered
        ? `${base.conferenceWins + wins}-${base.conferenceLosses + level - wins} ${conference}`
        : null,
      likely: false,
      children: [],
    }, level, path);
    // A settled root still shows the team's games, so the tree never disappears.
    if (node.outcome !== null && level > 0) return node;
    if (level > 0) considerScenario(lo, hi, path);
    if (last) return node;

    const { g } = levels[level];
    const opp = name(g.homeId === teamId ? g.awayId : g.homeId);
    const site = g.neutralSite ? "neutral" : g.homeId === teamId ? "home" : "away";
    const detail = `${when(g)} · ${site}`;
    node.children = [
      build(level + 1, prefix << 1, wins + 1, { gameId: g.id, win: true, label: `Beat ${opp}`, detail }, [...path, { opp, win: true }]),
      build(level + 1, (prefix << 1) | 1, wins, { gameId: g.id, win: false, label: `Lose to ${opp}`, detail }, [...path, { opp, win: false }]),
    ];
    return node;
  };

  const root = build(0, 0, 0, {}, []);
  root.likely = true;
  for (let node = root; node.children.length > 0; ) {
    const [w, l] = node.children;
    node = l.reach > w.reach ? l : w;
    node.likely = true;
  }

  const titleGame = sum(inTitle, 0, size) / total;
  const help = helpGames(others.map(({ g }) => g), (h) => {
    const off = h * size;
    const hn = sum(homeN, 0, size, off);
    return { hn, hIn: sum(homeIn, 0, size, off), an: total - hn, aIn: sum(awayIn, 0, size, off) };
  }, peaks, minSample, name);
  for (const h of help) {
    const proveIf = (p: number | null, winner: number): "in" | "out" | null => {
      if (p !== 0 && p !== 1) return null;
      const s = proven({ ...opts.locks, [h.gameId]: winner });
      return s === "clinched" ? "in" : s === "eliminated" ? "out" : null;
    };
    h.ifHomeWins = proveIf(h.oddsIfHomeWins, h.homeId);
    h.ifAwayWins = proveIf(h.oddsIfAwayWins, h.awayId);
  }

  /** The team's title-game odds with these locks, from a fresh simulation of `n` seasons. */
  const simulatedOdds = (locks: Record<number, number>, n: number): number => {
    let hit = 0;
    simulateSeason(season, { iterations: n, seed, locks }).forEachIteration((it, winnerAt, teams) => {
      const [x, y] = championshipFromData(data, (g: Game) => winnerAt(gameIndex.get(g.id)!), { draw: mulberry32(mix(seed, it, 1)), rank: teams.rank });
      if (x === teamId || y === teamId) hit++;
    });
    return hit / n;
  };

  // Likeliest way in: the most probable combination of remaining results that gets the team in,
  // found exactly, trimmed to the results its spot depends on. Own games first, then the rest by importance.
  let likeliest: Likeliest | null = null;
  if (root.outcome === null) {
    const unlocked = (g: Game) => !(opts.locks && g.id in opts.locks);
    const choices = [
      ...ownConf.filter(({ g }) => unlocked(g)).map(({ g }) => g),
      ...help.map((h) => others.find(({ g }) => g.id === h.gameId)!.g),
    ].map((g) => ({ g, pHome: gameWinProbability(season, g) }));
    // Two candidates: a way in however the tiebreaks go, and one that leans on the ranking tiebreak. That one
    // is worth its results' chance times how often the team gets in with them locked, from a small simulation.
    // It's shown only when clearly likelier: the simulation also counts seasons the sure way covers.
    const locks = opts.locks ?? {};
    const starts = likelyStarts(sim, reachedAt, choices, gameIndex);
    const sure = likeliestWayIn(data, teamId, locks, choices, false, starts);
    const lucky = likeliestWayIn(data, teamId, locks, choices, true, starts);
    const tiebreakOdds = (w: WayIn) =>
      simulatedOdds({ ...locks, ...Object.fromEntries(w.picks.map((p) => [p.gameId, p.winner])) }, Math.min(TIEBREAK_ITERATIONS, iterations));
    // Compare on a quick trim of each, then trim only the one shown in full.
    const sureQuick = sure && trimWay(data, teamId, locks, choices, sure, true);
    const luckyQuick = lucky && trimWay(data, teamId, locks, choices, lucky, true);
    // A way that's no likelier even before its tiebreak can't beat the sure way.
    const q = luckyQuick && (!sureQuick || luckyQuick.chance > sureQuick.chance) ? tiebreakOdds(luckyQuick) : 0;
    const luckyWins = luckyQuick !== null && (!sureQuick || luckyQuick.chance * q > TIEBREAK_EDGE * sureQuick.chance);
    const found = luckyWins ? lucky : sure;
    const way = found && trimWay(data, teamId, locks, choices, found);
    const tiebreak = way && luckyWins ? tiebreakOdds(way) : null;
    if (way) {
      const overall = way.chance * (tiebreak ?? 1);
      const often = tiebreak === 0 ? "rarely" : `${tiebreak! < 0.01 ? "under 1%" : `about ${formatOdds(tiebreak!)}`} of the time`;
      // Name the team's own results and the upsets elsewhere; favorites winning elsewhere are counted.
      const own: string[] = [];
      const elsewhere: string[] = [];
      const ownItems: string[] = [];
      const needs: string[] = [];
      let favorites = 0;
      const named: Likeliest["picks"] = [];
      const pHome = new Map(choices.map(({ g, pHome }) => [g.id, pHome]));
      for (const { gameId, winner } of way.picks) {
        const g = season.games.find((x) => x.id === gameId)!;
        const loser = winner === g.homeId ? g.awayId : g.homeId;
        const p = winner === g.homeId ? pHome.get(gameId)! : 1 - pHome.get(gameId)!;
        if (winner === teamId) { own.push(`beats ${name(loser)}`); ownItems.push(`Beat ${name(loser)}`); }
        else if (loser === teamId) { own.push(`loses to ${name(winner)}`); ownItems.push(`Lose to ${name(winner)}`); }
        // A toss-up is named too (1e-9 absorbs the normal approximation's error at a spread of 0).
        else if (p < 0.5 + 1e-9) { elsewhere.push(`${name(winner)} beats ${name(loser)}`); needs.push(`${name(winner)} over ${name(loser)}`); }
        else { favorites++; continue; }
        named.push({ gameId, winner });
      }
      if (favorites > 0) elsewhere.push(elsewhere.length ? `the favorites win ${favorites} other game${favorites === 1 ? "" : "s"}` : `the favorites win ${favorites} game${favorites === 1 ? "" : "s"} elsewhere`);
      const parts = [own.length ? `${team} ${list(own)}` : "", elsewhere.length ? list(elsewhere) : ""].filter(Boolean);
      const what = parts.length ? parts.join("; and ") : `${team} needs nothing more`;
      const note = tiebreak === null ? null : `With these results ${team} gets in ${often}, depending on ${luckSteps(data)}.`;
      const card = wayParts(way, choices, teamId, name, sim, reachedAt, minSample, gameIndex);
      likeliest = {
        picks: way.picks,
        named,
        chance: way.chance,
        upsets: way.upsets,
        needsTiebreak: tiebreak !== null,
        tiebreak,
        overall,
        line: `Likeliest way in (${formatOdds(overall)} chance): ${what}.${note ? ` ${note}` : ""}`,
        title: `What ${team} needs`,
        scope: "On its likeliest way in",
        own: ownItems,
        needs,
        favorites: favorites > 0 ? `Favorites win the other ${favorites} game${favorites === 1 ? "" : "s"} it needs` : null,
        note,
        ...card,
        summary: waySummary(card, favorites),
      };
    }
  }

  // The season week by week: the team's own game with its odds either way, and the games elsewhere that matter.
  // A locked game elsewhere: its other side can't come from the sample as it stands (every season has the lock).
  // A quick proof first; otherwise flip that one game in the first SWAP_ITERATIONS simulated seasons, as a pick
  // of the other side would (a lock changes only its own game's draw), with the full proof only when that is all
  // one way. Every locked game gets a value, however many there are.
  const settled = (st: ProvenStatus) => (st === "clinched" ? "In" : st === "eliminated" ? "Out" : null);
  const swappedShown = new Map<number, string>();
  const toFlip: { g: Game; gi: number; other: number }[] = [];
  for (const g of data.games) {
    const locked = opts.locks?.[g.id];
    if (locked === undefined || g.completed || g.homeId === teamId || g.awayId === teamId) continue;
    const other = locked === g.homeId ? g.awayId : g.homeId;
    const quick = settled(provenStatus(season, conference, teamId, { ...opts.locks, [g.id]: other }, QUICK_BUDGET));
    if (quick) swappedShown.set(g.id, quick);
    else toFlip.push({ g, gi: gameIndex.get(g.id)!, other });
  }
  if (toFlip.length > 0) {
    const hits = new Int32Array(toFlip.length);
    const n = Math.min(SWAP_ITERATIONS, sim.iterations);
    sim.forEachIteration((it, winnerAt, teams) => {
      if (it >= n) return;
      toFlip.forEach(({ g, gi, other }, k) => {
        const flipped = (x: Game): number => (x.id === g.id ? other : winnerAt(gameIndex.get(x.id)!));
        const [x, y] = championshipFromData(data, flipped, { draw: mulberry32(mix(seed, it, 1)), rank: (id) => teams.rankIf(id, gi) });
        if (x === teamId || y === teamId) hits[k]++;
      });
    });
    toFlip.forEach(({ g, other }, k) => {
      const p = hits[k] / n;
      swappedShown.set(g.id, p > 0 && p < 1 ? formatFine(p) : settled(proven({ ...opts.locks, [g.id]: other })) ?? (p === 0 ? "<0.1%" : ">99%"));
    });
  }
  const swapped = (gameId: number): string => swappedShown.get(gameId)!;
  const proofOf = (gameId: number, winner: number) => proven({ ...opts.locks, [gameId]: winner });
  const verdict = (odds: number | null, gameId: number, winner: number): string => {
    if (odds === 1 || odds === 0) {
      const s = proofOf(gameId, winner);
      if (s === "clinched") return "In";
      if (s === "eliminated") return "Out";
      // Not proven: never shown as a flat 0% or 100%.
      return odds === 0 ? "<0.1%" : ">99%";
    }
    return odds === null ? "—" : formatFine(odds);
  };
  // Games the likeliest way in needs show in their week even when the sample is too thin to flag them.
  const likelyIds = new Set((likeliest?.picks ?? []).map((p) => p.gameId));
  const namedWinner = new Map((likeliest?.named ?? []).map((p) => [p.gameId, p.winner]));
  const helpById = new Map(help.map((h) => [h.gameId, h]));
  const byWeek = new Map<number, SeasonWeek>();
  const weekOf = (g: Game): SeasonWeek => {
    let w = byWeek.get(g.week);
    if (!w) byWeek.set(g.week, (w = { week: g.week, label: when(g), own: null, played: null, nonConference: null, games: [], quiet: 0 }));
    return w;
  };
  // Title-game and playoff odds as if each of the team's own results were picked, and its chance to win each game.
  const me = (outlook ?? seasonOutlook(season, opts, sim).teams).find((o) => o.teamId === teamId)!;
  const ifPicked = new Map(me.games.map((x) => [x.gameId, x]));
  // Playoff odds are never proven, so they never show a flat 0% or 100%, whatever the title-game status.
  const playoffOdds = (p: number) => formatSideOdds(p, "alive");
  // Kept when the game is locked, so a pick still shows how likely that result was.
  const winChance = (g: Game): string => {
    const pHome = gameWinProbability(season, g);
    return `${formatOdds(g.homeId === teamId ? pHome : 1 - pHome)} to win`;
  };
  levels.forEach(({ g }) => {
    const w = weekOf(g);
    const opp = g.homeId === teamId ? g.awayId : g.homeId;
    const f = ifPicked.get(g.id)!;
    w.label = when(g);
    w.own = {
      gameId: g.id, opponentId: opp, opponent: name(opp), site: g.neutralSite ? "neutral" : g.homeId === teamId ? "home" : "away",
      oddsIfWin: f.titleIfWin, oddsIfLose: f.titleIfLose,
      ifWin: verdict(f.titleIfWin, g.id, teamId),
      ifLose: verdict(f.titleIfLose, g.id, opp),
      cfpIfWin: mustWinConference(me) ? null : playoffOdds(f.playoffIfWin),
      cfpIfLose: mustWinConference(me) ? null : playoffOdds(f.playoffIfLose),
      winChance: winChance(g),
    };
  });
  for (const g of data.games) {
    if (g.completed || g.homeId === teamId || g.awayId === teamId) continue;
    const w = weekOf(g);
    const locked = opts.locks?.[g.id];
    const h = helpById.get(g.id);
    const pHome = gameWinProbability(season, g);
    const chances = { homeWinChance: `${formatOdds(pHome)} to win`, awayWinChance: `${formatOdds(1 - pHome)} to win` };
    if (locked !== undefined) {
      const mine = formatTitleOdds(titleGame, statusOf(root.outcome));
      w.games.push({ gameId: g.id, homeId: g.homeId, awayId: g.awayId, home: name(g.homeId), away: name(g.awayId),
        ifHome: locked === g.homeId ? mine : swapped(g.id), ifAway: locked === g.awayId ? mine : swapped(g.id), swing: Infinity, likely: null, matters: true, helps: null, impact: null, ...chances });
    } else if (h) {
      const side = (odds: number | null, proof: "in" | "out" | null) =>
        odds === null && proof === null ? "—" : formatTitleOdds(odds ?? 0, statusOf(proof));
      const matters = h.now || h.scenario !== null || likelyIds.has(g.id);
      if (!matters) w.quiet++;
      w.games.push({ gameId: g.id, homeId: g.homeId, awayId: g.awayId, home: name(g.homeId), away: name(g.awayId),
        ifHome: side(h.oddsIfHomeWins, h.ifHomeWins), ifAway: side(h.oddsIfAwayWins, h.ifAwayWins), swing: h.swing,
        likely: likelySide(namedWinner.get(g.id), g, h), matters, ...helpsSide(g, h, titleGame), ...chances });
    }
  }
  // A week still being played can hold the team's game already final: show the result, not a bye.
  for (const g of data.games) {
    const w = byWeek.get(g.week);
    if (!w || !g.completed || (g.homeId !== teamId && g.awayId !== teamId)) continue;
    const home = g.homeId === teamId;
    const mine = home ? g.homePoints! : g.awayPoints!;
    const theirs = home ? g.awayPoints! : g.homePoints!;
    w.label = when(g);
    w.played = {
      gameId: g.id, opponent: name(home ? g.awayId : g.homeId), site: g.neutralSite ? "neutral" : home ? "home" : "away",
      won: mine > theirs, score: `${mine}-${theirs}`,
    };
  }
  for (const g of season.games) {
    const w = byWeek.get(g.week);
    if (!w || g.conferenceGame || (g.homeId !== teamId && g.awayId !== teamId)) continue;
    const home = g.homeId === teamId;
    const mine = home ? g.homePoints : g.awayPoints;
    const theirs = home ? g.awayPoints : g.homePoints;
    const final = g.completed && mine != null && theirs != null;
    if (!w.own && !w.played) w.label = when(g);
    const opp = home ? g.awayId : g.homeId;
    const f = ifPicked.get(g.id);
    const ifWin = f ? playoffOdds(f.playoffIfWin) : null;
    const ifLose = f ? playoffOdds(f.playoffIfLose) : null;
    const counts = f !== undefined && countsNonConference(data);
    w.nonConference = {
      gameId: g.id, opponentId: opp, opponent: name(opp), site: g.neutralSite ? "neutral" : home ? "home" : "away", date: when(g),
      won: final ? mine > theirs : null, score: final ? `${mine}-${theirs}` : null,
      ifWin, ifLose,
      titleIfWin: counts ? verdict(f.titleIfWin, g.id, teamId) : null,
      titleIfLose: counts ? verdict(f.titleIfLose, g.id, opp) : null,
      winChance: final ? null : winChance(g),
    };
  }
  for (const w of byWeek.values()) w.games.sort((a, b) => Number(b.matters) - Number(a.matters) || b.swing - a.swing || a.gameId - b.gameId);
  const weeks = [...byWeek.values()].sort((a, b) => a.week - b.week);

  return {
    titleGame,
    root,
    weeks,
    footnote: footnote(ownConf.length - depth, depth, conference),
    help,
    likeliest,
    helpNote: helpNote(help, root.outcome === "in" ? "clinched" : root.outcome === "out" ? "eliminated" : "open", team, conference),
  };
}

const tier = (x: HelpGame): number => (x.now ? 0 : x.scenario ? 1 : 2);

function helpGames(
  games: Game[],
  counts: (h: number) => { hn: number; hIn: number; an: number; aIn: number },
  peaks: (Peak | null)[],
  minSample: number,
  name: (id: number) => string,
): HelpGame[] {
  const help = games.map((g, h): HelpGame => {
    const { hn, hIn, an, aIn } = counts(h);
    const oddsIfHomeWins = hn >= minSample ? hIn / hn : null;
    const oddsIfAwayWins = an >= minSample ? aIn / an : null;
    const both = oddsIfHomeWins !== null && oddsIfAwayWins !== null;
    const swing = both ? Math.abs(oddsIfHomeWins - oddsIfAwayWins) : 0;
    const now = both && isClear(hn, hIn, an, aIn, OVERALL);
    const peak = peaks[h];
    const scenario = peak && peak.swing >= swing + SCENARIO.minSwing
      ? {
        ...peak,
        line: `Matters more ${peak.when}: ${formatOdds(peak.oddsIfHomeWins)} with a ${name(g.homeId)} win, ${formatOdds(peak.oddsIfAwayWins)} with a ${name(g.awayId)} win.`,
      }
      : null;
    const from = now ? [oddsIfHomeWins!, oddsIfAwayWins!] : scenario ? [scenario.oddsIfHomeWins, scenario.oddsIfAwayWins] : null;
    return {
      gameId: g.id, homeId: g.homeId, awayId: g.awayId,
      label: `${name(g.awayId)} ${g.neutralSite ? "vs" : "at"} ${name(g.homeId)}`,
      detail: when(g),
      oddsIfHomeWins, oddsIfAwayWins, swing, now, leans: both && isClear(hn, hIn, an, aIn, FAINT), scenario,
      rooting: from === null ? null : from[0] >= from[1] ? g.homeId : g.awayId,
      ifHomeWins: null, ifAwayWins: null,
    };
  });
  const order = new Map(games.map((g, h) => [g.id, h]));
  const weight = (x: HelpGame) => (x.now ? x.swing : x.scenario ? x.scenario.swing : 0);
  return help.sort((x, y) => tier(x) - tier(y) || weight(y) - weight(x) || order.get(x.gameId)! - order.get(y.gameId)!);
}

// Simulated seasons the likeliest-way search starts from.
const STARTS = 40;

/** The likeliest simulated seasons in which the team got in, as winners of `choices`: a good start for the exact search. */
function likelyStarts(sim: SimResult, reachedAt: Uint8Array, choices: { g: Game; pHome: number }[], gameIndex: Map<number, number>): number[][] {
  const at = choices.map(({ g }) => gameIndex.get(g.id)!);
  const logP = choices.map(({ pHome }) => [Math.log(Math.max(pHome, 1e-12)), Math.log(Math.max(1 - pHome, 1e-12))]);
  const top: { score: number; winners: number[] }[] = [];
  sim.forEachIteration((it, winnerAt) => {
    if (!reachedAt[it]) return;
    let score = 0;
    choices.forEach(({ g }, k) => { score += logP[k][winnerAt(at[k]) === g.homeId ? 0 : 1]; });
    if (top.length === STARTS && score <= top[STARTS - 1].score) return;
    top.push({ score, winners: at.map((i) => winnerAt(i)) });
    top.sort((a, b) => b.score - a.score);
    if (top.length > STARTS) top.pop();
  });
  return top.map((t) => t.winners);
}

/** The card's breakdown of a way in: the team's own job, rival loss counts, and a week-by-week script. */
function wayParts(
  way: WayIn,
  choices: { g: Game; pHome: number }[],
  teamId: number,
  name: (id: number) => string,
  sim: SimResult,
  reachedAt: Uint8Array,
  minSample: number,
  gameIndex: Map<number, number>,
): Pick<Likeliest, "ownJob" | "ownSummary" | "ownGames" | "ownChance" | "rivals" | "weeks"> {
  const byId = new Map(choices.map((c) => [c.g.id, c]));
  const chanceOf = (gameId: number, winner: number) => {
    const { g, pHome } = byId.get(gameId)!;
    return winner === g.homeId ? pHome : 1 - pHome;
  };
  const picks = way.picks.map((p) => ({ ...p, g: byId.get(p.gameId)!.g, i: gameIndex.get(p.gameId)!, p: chanceOf(p.gameId, p.winner) }));
  const loserOf = (x: (typeof picks)[number]) => (x.winner === x.g.homeId ? x.g.awayId : x.g.homeId);
  const isOwn = (g: Game) => g.homeId === teamId || g.awayId === teamId;

  const ownLeft = choices.filter(({ g }) => isOwn(g)).length;
  const ownPicks = picks.filter((x) => isOwn(x.g));
  const ownWins = ownPicks.filter((x) => x.winner === teamId).length;
  // A way can need the team to lose (a tiebreak quirk); say so rather than "Win 0 of 3", and name both when it
  // needs some of each.
  const ownLosses = ownPicks.length - ownWins;
  const ownEither = ownLeft - ownPicks.length;
  const [verb, did] = ownWins > 0 ? ["Win", ownWins] : ["Lose", ownLosses];
  const mixed = ownWins > 0 && ownLosses > 0;
  const ownJob = ownPicks.length === 0
    ? "Its own results don't matter on this way in"
    : mixed ? `Win ${ownWins} and lose ${ownLosses} of ${ownLeft} left`
    : did === ownLeft ? (ownLeft === 1 ? `${verb} its last game` : `${verb} all ${ownLeft} left`) : `${verb} ${did} of ${ownLeft} left`;
  const ownSummary = ownPicks.length === 0
    ? "either way"
    : mixed ? [count(ownWins, "win", "wins"), count(ownLosses, "loss", "losses"), ownEither ? `${ownEither} either way` : ""].filter(Boolean).join(", ")
    : `${verb.toLowerCase()}s ${did === ownLeft ? (ownLeft === 1 ? "its last game" : ownLeft === 2 ? "both" : `all ${ownLeft}`) : `${did} of ${ownLeft}`}`;
  const ownChance = ownPicks.reduce((a, x) => a * x.p, 1);
  const byKickoff = (a: Game, b: Game) => (Date.parse(a.start) || 0) - (Date.parse(b.start) || 0) || a.week - b.week || a.id - b.id;
  const ownPicked = new Map(ownPicks.map((x) => [x.gameId, x.winner]));
  const ownGames = choices.filter(({ g }) => isOwn(g)).sort((a, b) => byKickoff(a.g, b.g)).map(({ g }) => {
    const w = ownPicked.get(g.id);
    return { opponent: name(g.homeId === teamId ? g.awayId : g.homeId), winChance: chanceOf(g.id, teamId), result: w === undefined ? null : w === teamId ? ("win" as const) : ("lose" as const) };
  });

  // Rivals: teams the picks need to lose at least one game they're favored in. Count every loss the picks give them.
  const losses = new Map<number, number>();
  const upset = new Set<number>();
  for (const x of picks) {
    if (isOwn(x.g)) continue;
    losses.set(loserOf(x), (losses.get(loserOf(x)) ?? 0) + 1);
    if (x.p < 0.5 + 1e-9) upset.add(loserOf(x));
  }
  // Each game says exactly what the picks need: picking "any 2 of 3" would be wrong whenever the way
  // needs a particular loss, or needs the rival to win a game another rival has to lose.
  const pickedWinner = new Map(picks.map((x) => [x.gameId, x.winner]));
  const rivals: Rival[] = [...losses].filter(([id]) => upset.has(id)).map(([id, needs]) => {
    const games = choices
      .filter(({ g }) => !isOwn(g) && (g.homeId === id || g.awayId === id))
      .sort((a, b) => byKickoff(a.g, b.g))
      .map(({ g }) => {
        const opp = g.homeId === id ? g.awayId : g.homeId;
        const w = pickedWinner.get(g.id);
        return { opponent: name(opp), chance: chanceOf(g.id, opp), result: w === undefined ? null : w === id ? ("win" as const) : ("lose" as const) };
      });
    const chance = games.reduce((a, g) => a * (g.result === "lose" ? g.chance : g.result === "win" ? 1 - g.chance : 1), 1);
    const lost = games.filter((g) => g.result === "lose").map((g) => g.opponent);
    const won = games.filter((g) => g.result === "win").map((g) => g.opponent);
    const line = [`Loses to ${list(lost)}`, won.length ? `beats ${list(won)}` : ""].filter(Boolean).join(", ");
    const either = games.length - lost.length - won.length;
    const summary = [count(lost.length, "loss", "losses"), won.length ? count(won.length, "win", "wins") : "", either ? `${either} either way` : ""].filter(Boolean).join(", ");
    return { teamId: id, team: name(id), needs, left: games.length, line, games, chance, summary };
  }).sort((a, b) => b.needs - a.needs || a.chance - b.chance || a.team.localeCompare(b.team));

  // Weeks in kickoff order; each holds the picks played that week.
  const weekOf = new Map<number, typeof picks>();
  for (const x of [...picks].sort((a, b) => (Date.parse(a.g.start) || 0) - (Date.parse(b.g.start) || 0) || a.g.week - b.g.week)) {
    const list = weekOf.get(x.g.week) ?? [];
    list.push(x);
    weekOf.set(x.g.week, list);
  }
  const groups = [...weekOf.values()];
  // Odds after each week: among simulated seasons matching every pick through it, the share that get in.
  const n = new Float64Array(groups.length);
  const hit = new Float64Array(groups.length);
  sim.forEachIteration((it, winnerAt) => {
    for (let w = 0; w < groups.length; w++) {
      if (!groups[w].every((x) => winnerAt(x.i) === x.winner)) break;
      n[w]++;
      if (reachedAt[it]) hit[w]++;
    }
  });
  const weeks: WayWeek[] = groups.map((list, w) => {
    const own = list.find((x) => isOwn(x.g));
    const rest = list.filter((x) => !isOwn(x.g));
    const named = rest.filter((x) => x.p < 0.5 + 1e-9);
    const fav = rest.length - named.length;
    const last = w === groups.length - 1;
    const after = last && !way.needsTiebreak ? 1 : n[w] >= minSample ? hit[w] / n[w] : null;
    return {
      label: when((own ?? list[0]).g),
      own: own ? (own.winner === teamId ? `Beat ${name(loserOf(own))}` : `Lose to ${name(own.winner)}`) : null,
      root: named.map((x) => ({ what: `${name(x.winner)} over ${name(loserOf(x))}`, chance: x.p })),
      favorites: fav > 0 ? `Favorites win ${fav === 1 ? "1 other" : `${fav} others`}` : null,
      after,
      afterLabel: after === null ? "—" : after === 1 ? "In" : after === 0 ? "<1%" : formatOdds(after),
    };
  });
  return { ownJob, ownSummary, ownGames, ownChance, rivals, weeks };
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

/** The way in one line: the team's part, then the rivals by how many losses each needs. "Win out, Duke and Miami each lose twice". */
function waySummary(parts: Pick<Likeliest, "ownGames" | "rivals">, favorites: number): string {
  const left = parts.ownGames.length;
  const wins = parts.ownGames.filter((g) => g.result === "win").length;
  const losses = parts.ownGames.filter((g) => g.result === "lose").length;
  const out: string[] = [];
  if (wins > 0 && losses > 0) out.push(`win ${wins} and lose ${losses} of ${left}`);
  else if (wins > 0) out.push(wins === left ? "win out" : `win ${wins} of ${left}`);
  else if (losses > 0) out.push(losses === left ? "lose out" : `lose ${losses} of ${left}`);
  const byLosses = new Map<number, string[]>();
  for (const r of parts.rivals) byLosses.set(r.needs, [...(byLosses.get(r.needs) ?? []), r.team]);
  for (const [n, teams] of [...byLosses].sort((a, b) => b[0] - a[0])) {
    out.push(teams.length === 1 ? `${teams[0]} loses ${times(n)}` : `${list(teams)} each lose ${times(n)}`);
  }
  // A way always picks something (a team with nothing left to need is in, with no way to show), so with no
  // own result and no rival named, what's left is favorites winning.
  if (out.length === 0) out.push(`the favorites win the ${favorites === 1 ? "game" : `${favorites} games`} it needs`);
  const line = out.join(", ");
  return line[0].toUpperCase() + line.slice(1);
}

/** Which side of a game elsewhere helps the team, and how much, however little. Nothing when neither side does (or the sample can't tell). */
function helpsSide(g: Game, h: HelpGame, now: number): { helps: number | null; impact: Impact | null } {
  const a = h.oddsIfHomeWins;
  const b = h.oddsIfAwayWins;
  if (a === null || b === null) return { helps: null, impact: null };
  // A proof settles it even when the sample can't tell the sides apart: "In" beats ">99%", "<0.1%" beats "Out".
  const sure = (p: "in" | "out" | null) => (p === "in" ? 1 : p === "out" ? -1 : 0);
  const proven = sure(h.ifHomeWins) - sure(h.ifAwayWins);
  // The same side as `rooting`: today's odds when they clearly differ, else the scenario's, else today's faint lean.
  const fromScenario = h.scenario ? Math.sign(h.scenario.oddsIfHomeWins - h.scenario.oddsIfAwayWins) : 0;
  const edge = proven !== 0 ? Math.sign(proven) : h.now ? Math.sign(a - b) : h.scenario ? fromScenario : h.leans ? Math.sign(a - b) : 0;
  if (edge === 0) return { helps: null, impact: null };
  const rel = Math.abs(a - b) / Math.max(now, IMPACT_FLOOR);
  return { helps: edge > 0 ? g.homeId : g.awayId, impact: rel >= BIG ? "big" : rel >= SOME ? "some" : "small" };
}

/** A named pick's winner, kept only when the odds agree it's the better side for the team (or can't say). */
function likelySide(winner: number | undefined, g: Game, h: HelpGame): number | null {
  if (winner === undefined) return null;
  const mine = winner === g.homeId ? h.oddsIfHomeWins : h.oddsIfAwayWins;
  const theirs = winner === g.homeId ? h.oddsIfAwayWins : h.oddsIfHomeWins;
  return mine === null || theirs === null || mine >= theirs ? winner : null;
}

function helpNote(help: HelpGame[], status: string, team: string, conference: string): string {
  if (help.length === 0) return `No other ${conference} games are left to play.`;
  if (status !== "open") {
    return `${team} is ${status === "clinched" ? "in" : "out"} whatever happens, so no result elsewhere changes that.`;
  }
  const quiet = help.filter((x) => tier(x) === 2).length;
  if (quiet === help.length) {
    return `Nothing else moves the needle: none of the other ${plural(quiet, `${conference} game`, `${conference} games`)} clearly changes ${team}'s odds.`;
  }
  if (quiet === 0) return `Every other ${conference} game left can change ${team}'s odds.`;
  return quiet === 1
    ? `The other ${conference} game left doesn't clearly change ${team}'s odds.`
    : `The other ${quiet} ${conference} games don't clearly change ${team}'s odds.`;
}

function footnote(cut: number, depth: number, conference: string): string | null {
  if (cut <= 0) return null;
  return `The tree stops after ${plural(depth, "game", "games")}; ${plural(cut, `later ${conference} game isn't`, `later ${conference} games aren't`)} shown.`;
}

/** A proven outcome as a title-game status for the odds wording: only "in" and "out" are proven. */
function statusOf(outcome: TreeOutcome | "in" | "out" | null): PathStatus {
  return outcome === "in" ? "clinched" : outcome === "out" ? "eliminated" : "alive";
}
