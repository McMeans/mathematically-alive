// A branching view of a team's remaining conference games: for each win/loss
// combination, how likely it is and what it does to the team's conference
// title-game odds. A branch stops as soon as its outcome is settled (in or out in
// every simulated season that goes that way) or too rare to call, so every
// scenario is covered without drawing branches that can't change anything.
//
// Non-conference games aren't branched on: the title game is decided by
// conference results alone, so they can't move these odds. The footnote names them.
//
// Also lists "help from elsewhere": every other remaining conference game, with
// the team's odds for each result, and whether it clearly matters now or in one
// of the team's own-result scenarios (for example "if Louisville wins out").
//
// Uses the same simulated seasons and title-game draw as teamPath, so the root
// odds equal teamPath's titleGame for the same seed and locks.
import { formatOdds, type PathOptions } from "./paths";
import { teamRecord } from "./season";
import type { Game, Season } from "./season";
import { OVERALL, SCENARIO, isClear } from "./signal";
import { mix, mulberry32, simulateSeason, type SimResult } from "./sim";
import { provenStatus } from "./proof";
import { championshipFromData, conferenceData } from "./tiebreak";

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

/** The single most common full scenario among simulated seasons where the team makes the title game. */
export type Likeliest = {
  /** The team's own conference results, then the results elsewhere that clearly matter now. */
  picks: { gameId: number; winner: number }[];
  /** Fraction of all simulated seasons that play out exactly this way (on these games). */
  share: number;
  /** "Likeliest way in (4% of simulated seasons): Virginia beats ..., and Duke beats Wake Forest." */
  line: string;
};

export type PathTree = {
  titleGame: number;
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
  /** Null when the team is proven in or out, or never made the title game in the sample. */
  likeliest: Likeliest | null;
};

const MAX_DEPTH = 12;
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

/** `shared`: a simulation of the same season, iterations, seed and locks to reuse. */
export function pathTree(season: Season, opts: TreeOptions, shared?: SimResult): PathTree {
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
  const bucketAt = new Int32Array(sim.iterations);
  sim.forEachIteration((iteration, winnerAt) => {
    let b = 0;
    for (let k = 0; k < depth; k++) if (winnerAt(levels[k].i) !== teamId) b |= 1 << (depth - 1 - k);
    const rand = mulberry32(mix(seed, iteration, 1));
    const [x, y] = championshipFromData(data, conference, (g: Game) => winnerAt(gameIndex.get(g.id)!), { draw: rand });
    const reached = x === teamId || y === teamId;
    if (reached) reachedAt[iteration] = 1;
    bucketAt[iteration] = b;
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
    const proof = node.odds === 1 || node.odds === 0 ? provenStatus(season, conference, teamId, prefixLocks(path)) : "open";
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
    if (node.outcome !== null) return node;
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
      const s = provenStatus(season, conference, teamId, { ...opts.locks, [h.gameId]: winner });
      return s === "clinched" ? "in" : s === "eliminated" ? "out" : null;
    };
    h.ifHomeWins = proveIf(h.oddsIfHomeWins, h.homeId);
    h.ifAwayWins = proveIf(h.oddsIfAwayWins, h.awayId);
  }

  // Likeliest way in: the most common (own results + results elsewhere that matter now) among seasons that reach.
  let likeliest: Likeliest | null = null;
  if (root.outcome === null && sum(inTitle, 0, size) > 0) {
    const loud = others.map((o, h) => ({ ...o, h })).filter(({ g }) => help.find((x) => x.gameId === g.id)!.now);
    const counts = new Map<string, number>();
    sim.forEachIteration((it, winnerAt) => {
      if (!reachedAt[it]) return;
      const key = `${bucketAt[it]}|${loud.map(({ g, i }) => (winnerAt(i) === g.homeId ? 1 : 0)).join("")}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    let best = "";
    let bestN = 0;
    for (const [k, n] of counts) if (n > bestN || (n === bestN && k < best)) [best, bestN] = [k, n];
    if (bestN > 0) {
      const [b, bits] = best.split("|");
      const picks: Likeliest["picks"] = [];
      const own: string[] = [];
      levels.forEach(({ g }, k) => {
        const won = ((Number(b) >> (depth - 1 - k)) & 1) === 0;
        const opp = g.homeId === teamId ? g.awayId : g.homeId;
        picks.push({ gameId: g.id, winner: won ? teamId : opp });
        own.push(`${won ? "beats" : "loses to"} ${name(opp)}`);
      });
      const elsewhere = loud.map(({ g }, j) => {
        const w = bits[j] === "1" ? g.homeId : g.awayId;
        picks.push({ gameId: g.id, winner: w });
        return `${name(w)} beats ${name(w === g.homeId ? g.awayId : g.homeId)}`;
      });
      const share = bestN / total;
      const parts = [own.length ? `${team} ${list(own)}` : "", elsewhere.length ? list(elsewhere) : ""].filter(Boolean);
      likeliest = { picks, share, line: `Likeliest way in (${formatOdds(share)} of simulated seasons): ${parts.join("; and ")}.` };
    }
  }

  return {
    titleGame,
    root,
    footnote: footnote(ownAll.filter(({ g }) => !confGames.has(g)).map(({ g }) => g), ownConf.length - depth, depth, teamId, conference, name),
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
      oddsIfHomeWins, oddsIfAwayWins, swing, now, scenario,
      rooting: from === null ? null : from[0] >= from[1] ? g.homeId : g.awayId,
      ifHomeWins: null, ifAwayWins: null,
    };
  });
  const order = new Map(games.map((g, h) => [g.id, h]));
  const weight = (x: HelpGame) => (x.now ? x.swing : x.scenario ? x.scenario.swing : 0);
  return help.sort((x, y) => tier(x) - tier(y) || weight(y) - weight(x) || order.get(x.gameId)! - order.get(y.gameId)!);
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

function footnote(
  nonConf: Game[], cut: number, depth: number, teamId: number, conference: string, name: (id: number) => string,
): string | null {
  const notes: string[] = [];
  if (nonConf.length > 0) {
    const games = nonConf.map((g) => `${name(g.homeId === teamId ? g.awayId : g.homeId)} (${when(g)})`);
    notes.push(`Not in the tree: ${list(games)}. Non-conference results don't change the ${conference} title-game race.`);
  }
  if (cut > 0) {
    notes.push(`The tree stops after ${plural(depth, "game", "games")}; ${plural(cut, `later ${conference} game isn't`, `later ${conference} games aren't`)} shown.`);
  }
  return notes.length ? notes.join(" ") : null;
}
