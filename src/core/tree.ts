// A branching view of a team's next few games: for each win/loss combination,
// how likely it is and what it does to the team's conference title-game odds.
// Uses the same simulated seasons and title-game draw as teamPath, so the root
// odds equal teamPath's titleGame for the same seed and locks.
import type { PathOptions } from "./paths";
import { teamRecord } from "./season";
import type { Game, Season } from "./season";
import { mix, mulberry32, simulateSeason } from "./sim";
import { championshipFromData, conferenceData } from "./tiebreak";

export type TreeOptions = PathOptions & {
  /** How many of the team's next unplayed games to branch on. Default 3. */
  depth?: number;
};

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
  /** Final overall record ("10-2"), only on leaves when the tree covers every remaining game of the team. */
  record: string | null;
  /** On the most likely path: at each level the child with the higher reach (ties: the win). */
  likely: boolean;
  children: TreeNode[];
};

export type PathTree = { titleGame: number; root: TreeNode };

const DEFAULT_DEPTH = 3;
const MAX_DEPTH = 12;
const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

export function pathTree(season: Season, opts: TreeOptions): PathTree {
  const { conference, teamId, iterations, seed } = opts;
  const data = conferenceData(season, conference);
  if (data.ids.size < 2) throw new Error(`${conference} has fewer than two teams`);
  if (!data.ids.has(teamId)) throw new Error(`team ${teamId} is not in ${conference}`);
  const wanted = opts.depth ?? DEFAULT_DEPTH;
  if (!Number.isInteger(wanted) || wanted < 0) throw new RangeError("depth must be a non-negative integer");

  const sim = simulateSeason(season, { iterations, seed, locks: opts.locks });
  const gameIndex = new Map<number, number>(season.games.map((g, i) => [g.id, i]));
  const name = (id: number): string => season.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;

  const own = season.games
    .map((g, i) => ({ g, i }))
    .filter(({ g }) => !g.completed && (g.homeId === teamId || g.awayId === teamId))
    .sort((x, y) => (Date.parse(x.g.start) || 0) - (Date.parse(y.g.start) || 0) || x.g.week - y.g.week || x.i - y.i);
  const levels = own.slice(0, Math.min(wanted, MAX_DEPTH));
  const depth = levels.length;

  // Bucket index: bit (depth-1-k) is 1 when the team loses level k, so a win sorts before a loss
  // and every prefix covers one contiguous range of buckets.
  const size = 1 << depth;
  const count = new Float64Array(size);
  const inTitle = new Float64Array(size);
  let total = 0;
  sim.forEachIteration((iteration, winnerAt) => {
    let b = 0;
    for (let k = 0; k < depth; k++) if (winnerAt(levels[k].i) !== teamId) b |= 1 << (depth - 1 - k);
    const rand = mulberry32(mix(seed, iteration, 1));
    const [x, y] = championshipFromData(data, conference, (g: Game) => winnerAt(gameIndex.get(g.id)!), { draw: rand });
    count[b]++;
    if (x === teamId || y === teamId) inTitle[b]++;
    total++;
  });

  const minSample = Math.max(30, Math.ceil(sim.iterations * 0.01));
  const sum = (arr: Float64Array, lo: number, hi: number): number => {
    let s = 0;
    for (let b = lo; b < hi; b++) s += arr[b];
    return s;
  };
  const covered = depth === own.length;
  const base = teamRecord(season, teamId);

  const make = (level: number, prefix: number, wins: number, extra: Partial<TreeNode>): TreeNode => {
    const lo = prefix << (depth - level);
    const hi = (prefix + 1) << (depth - level);
    const n = sum(count, lo, hi);
    const t = sum(inTitle, lo, hi);
    const leaf = level === depth;
    return {
      label: "Today", detail: "", ...extra,
      reach: n / total,
      odds: n >= minSample ? t / n : null,
      record: leaf && level > 0 && covered ? `${base.wins + wins}-${base.losses + level - wins}` : null,
      likely: false,
      children: [],
    };
  };

  const build = (level: number, prefix: number, wins: number, node: TreeNode): TreeNode => {
    if (level === depth) return node;
    const { g } = levels[level];
    const opp = name(g.homeId === teamId ? g.awayId : g.homeId);
    const d = new Date(g.start);
    const date = Number.isNaN(d.getTime()) ? `week ${g.week}` : DATE_FORMAT.format(d);
    const site = g.neutralSite ? "neutral" : g.homeId === teamId ? "home" : "away";
    const detail = `${date} · ${site}`;
    const win = build(level + 1, prefix << 1, wins + 1,
      make(level + 1, prefix << 1, wins + 1, { gameId: g.id, win: true, label: `Beat ${opp}`, detail }));
    const loss = build(level + 1, (prefix << 1) | 1, wins,
      make(level + 1, (prefix << 1) | 1, wins, { gameId: g.id, win: false, label: `Lose to ${opp}`, detail }));
    node.children = [win, loss];
    return node;
  };

  const root = build(0, 0, 0, make(0, 0, 0, {}));
  root.likely = true;
  for (let node = root; node.children.length > 0; ) {
    const [w, l] = node.children;
    node = l.reach > w.reach ? l : w;
    node.likely = true;
  }
  return { titleGame: sum(inTitle, 0, size) / total, root };
}
