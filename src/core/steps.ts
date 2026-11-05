// The tiebreak step library. Each step looks at teams level on conference win pct and either names the ones
// at the top of its order (a split), drops one team, picks the teams outright (the draw), or can't tell them
// apart. The resolver in tiebreak.ts decides what a split means for the open spots.
//
// Exact arithmetic: any score that can tie as a fraction is kept as whole numbers (a fraction compared by cross
// multiplication), so two scores equal as fractions always compare equal. A float sum can round them apart.

import type { Classification, Game } from "./season";

export type Row = { teamId: number; wins: number; losses: number; games: number };

/** Per-conference data that doesn't change between simulated seasons. */
export type Members = {
  ids: Set<number>;
  /** Conference games between members. */
  games: Game[];
  /** Conference games between each pair of teams, keyed by pairKey. */
  pairs: Map<number, Game[]>;
  ratings: Map<number, number | null>;
  /** Every game each team plays, conference or not. */
  schedule: Map<number, Game[]>;
  classes: Map<number, Classification>;
  /** Every regular-season game of every member has a final score, so a scoring-margin step can be worked out. */
  scored: boolean;
};

/** What a step works with for one season's results. */
export type Context = {
  data: Members;
  winnerOf: (game: Game) => number;
  /** Higher is better: the ranking stand-in. */
  rank: (teamId: number) => number;
  draw: (count: number) => number;
  rowOf: Map<number, Row>;
};

export type StepResult =
  /** The teams at the top of the step's order, fewer than all of them. */
  | { top: number[] }
  /** One team is out of this tie. */
  | { drop: number }
  /** The teams for the open spots, best seed first (the draw). */
  | { picked: number[] }
  | null;

export type Step = {
  name: string;
  run: (ids: number[], ctx: Context, spots: number) => StepResult;
  /** After a split, the teams at the top start over from the first step (true) or go on to the next step (false). */
  restart: boolean;
  /** Counts non-conference results. Proofs search conference games only, so they skip it and count it as luck. */
  nonConference?: boolean;
};

export const pairKey = (a: number, b: number): number => (a < b ? a * 4294967296 + b : b * 4294967296 + a);

/** A fraction of whole numbers, denominator above 0. */
type Frac = readonly [number, number];
const frac = (n: number, d: number): Frac => (d === 0 ? [0, 1] : [n, d]);
const cmpFrac = (a: Frac, b: Frac): number => a[0] * b[1] - b[0] * a[1];

/** The teams with the highest score, by `cmp`. */
export function topBy<T>(ids: number[], score: (id: number) => T, cmp: (a: T, b: T) => number): number[] {
  const scores = ids.map(score);
  let best = scores[0];
  for (const s of scores) if (cmp(s, best) > 0) best = s;
  return ids.filter((_, i) => cmp(scores[i], best) === 0);
}
export const topByFrac = (ids: number[], score: (id: number) => Frac): number[] => topBy(ids, score, cmpFrac);
const cmpNum = (a: number, b: number): number => (a > b ? 1 : a < b ? -1 : 0);
const split = (ids: number[], top: number[]): StepResult => (top.length === ids.length ? null : { top });

export function winnerIn(g: Game, winnerOf: (game: Game) => number): number {
  const w = winnerOf(g);
  if (w !== g.homeId && w !== g.awayId) throw new Error(`winnerOf returned team ${w}, who is not in game ${g.id}`);
  return w;
}

/** Compare two teams' conference win pcts exactly (no games counts as 0). */
export const comparePct = (a: Row, b: Row): number => a.wins * (b.games || 1) - b.wins * (a.games || 1);

const played = (ctx: Context, a: number, b: number): boolean => ctx.data.pairs.has(pairKey(a, b));
/** Net head-to-head result of a over b in conference games: above 0, a won more. */
const h2h = (ctx: Context, a: number, b: number): number => {
  let net = 0;
  for (const g of ctx.data.pairs.get(pairKey(a, b)) ?? []) net += winnerIn(g, ctx.winnerOf) === a ? 1 : -1;
  return net;
};
const allPlayed = (ctx: Context, ids: number[]): boolean => ids.every((a) => ids.every((b) => a === b || played(ctx, a, b)));
const beatsAll = (ctx: Context, ids: number[]): number[] => ids.filter((a) => ids.every((b) => a === b || h2h(ctx, a, b) > 0));
const lostToAll = (ctx: Context, ids: number[]): number[] => ids.filter((a) => ids.every((b) => a === b || h2h(ctx, a, b) < 0));

/** Win pct of `id` in conference games against `opps`. */
const pctVs = (ctx: Context, id: number, opps: Iterable<number>): Frac => {
  let w = 0;
  let n = 0;
  for (const o of opps) {
    for (const g of ctx.data.pairs.get(pairKey(id, o)) ?? []) {
      if (winnerIn(g, ctx.winnerOf) === id) w++;
      n++;
    }
  }
  return frac(w, n);
};
const amongThem = (ctx: Context, ids: number[]) => (id: number): Frac => pctVs(ctx, id, ids.filter((o) => o !== id));
/** Win pct of `id` against the other tied teams, counting each opponent once by its net result. */
const byOpponent = (ctx: Context, ids: number[]) => (id: number): Frac => {
  let w = 0;
  let l = 0;
  for (const o of ids) {
    if (o === id) continue;
    const n = h2h(ctx, id, o);
    if (n > 0) w++;
    else if (n < 0) l++;
  }
  return frac(w, w + l);
};
/** Opponents every tied team played in conference. */
const commonOf = (ctx: Context, ids: number[]): number[] =>
  [...ctx.data.ids].filter((o) => !ids.includes(o) && ids.every((id) => played(ctx, id, o)));

/**
 * Head-to-head. Teams who all played each other: the record among them, by games or by opponent (each
 * opponent counted once by the net result). Otherwise a team that beat every other tied team is at the top,
 * and with `lostToAll`, a team that lost to every other one is dropped.
 */
export function headToHead(opts: { record: "games" | "opponents"; lostToAll: boolean }): Step {
  return {
    name: "head-to-head",
    restart: true,
    run(ids, ctx) {
      if (allPlayed(ctx, ids)) return split(ids, topByFrac(ids, opts.record === "games" ? amongThem(ctx, ids) : byOpponent(ctx, ids)));
      const beat = beatsAll(ctx, ids);
      if (beat.length === 1) return { top: beat };
      if (opts.lostToAll) {
        const lost = lostToAll(ctx, ids);
        if (lost.length === 1) return { drop: lost[0] };
      }
      return null;
    },
  };
}

/** Win pct against common conference opponents (those every tied team played). */
export function commonOpponents(): Step {
  return {
    name: "common opponents",
    restart: true,
    run: (ids, ctx) => split(ids, topByFrac(ids, (id) => pctVs(ctx, id, commonOf(ctx, ids)))),
  };
}

/**
 * Win pct against the highest placed common opponent, then the next, down the standings. Opponents level on
 * conference win pct either count as one group, or (`level: "head-to-head"`) are placed by head-to-head alone,
 * those it can't separate counting as one group. Only common opponents in a group count.
 */
export function placedCommonOpponent(opts: { level: "group" | "head-to-head" }): Step {
  /** Teams level on win pct in standings order by head-to-head only; teams it can't separate stay as one group. */
  const tiers = (ctx: Context, group: number[]): number[][] => {
    if (group.length === 1) return [group];
    let top: number[] = [];
    if (allPlayed(ctx, group)) top = topByFrac(group, amongThem(ctx, group));
    else if (beatsAll(ctx, group).length === 1) top = beatsAll(ctx, group);
    else if (lostToAll(ctx, group).length === 1) top = group.filter((id) => id !== lostToAll(ctx, group)[0]);
    if (top.length === 0 || top.length === group.length) return [group];
    return [...tiers(ctx, top), ...tiers(ctx, group.filter((id) => !top.includes(id)))];
  };
  return {
    name: "highest placed common opponent",
    restart: true,
    run(ids, ctx) {
      const common = commonOf(ctx, ids);
      const others = [...ctx.data.ids].filter((o) => !ids.includes(o)).map((o) => ctx.rowOf.get(o)!);
      others.sort((a, b) => comparePct(b, a));
      for (let i = 0; i < others.length; ) {
        let j = i;
        while (j < others.length && comparePct(others[j], others[i]) === 0) j++;
        const level = others.slice(i, j).map((r) => r.teamId);
        i = j;
        for (const tier of opts.level === "group" ? [level] : tiers(ctx, level)) {
          const group = tier.filter((o) => common.includes(o));
          if (group.length === 0) continue;
          const r = split(ids, topByFrac(ids, (id) => pctVs(ctx, id, group)));
          if (r) return r;
        }
      }
      return null;
    },
  };
}

/** Strength of conference schedule: the combined conference win pct of the team's conference opponents, per game. */
export function scheduleStrength(): Step {
  return {
    name: "strength of schedule",
    restart: true,
    run: (ids, ctx) =>
      split(ids, topByFrac(ids, (id) => {
        let w = 0;
        let n = 0;
        for (const o of ctx.data.ids) {
          const times = ctx.data.pairs.get(pairKey(id, o))?.length ?? 0;
          if (o === id || times === 0) continue;
          const r = ctx.rowOf.get(o)!;
          w += times * r.wins;
          n += times * r.games;
        }
        return frac(w, n);
      })),
  };
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** The average of the conference win pcts of the team's conference opponents, one per game. */
export function opponentsWinPct(): Step {
  return {
    name: "opponents' win pct",
    restart: true,
    run(ids, ctx) {
      // Every member's game count divides this, so each win pct is a whole number of 1/lcm steps.
      let lcm = 1;
      for (const r of ctx.rowOf.values()) if (r.games > 0) lcm = (lcm * r.games) / gcd(lcm, r.games);
      return split(ids, topByFrac(ids, (id) => {
        let sum = 0;
        let n = 0;
        for (const o of ctx.data.ids) {
          const times = ctx.data.pairs.get(pairKey(id, o))?.length ?? 0;
          const r = ctx.rowOf.get(o)!;
          if (r.games > 0) sum += (times * r.wins * lcm) / r.games;
          n += times;
        }
        return frac(sum, n * lcm);
      }));
    },
  };
}

/** The title game is a non-conference game between two members in the data; it comes after the tiebreak. */
export const isTitleGame = (data: Pick<Members, "ids">, g: Game): boolean => !g.conferenceGame && data.ids.has(g.homeId) && data.ids.has(g.awayId);

/** Regular-season wins, at most `belowFbs` of them over teams below FBS. The title game is left out. */
export function totalWins(opts: { belowFbs: number }): Step {
  return {
    name: "total wins",
    restart: true,
    nonConference: true,
    run: (ids, ctx) =>
      split(ids, topBy(ids, (id) => {
        let wins = 0;
        let lower = 0;
        for (const g of ctx.data.schedule.get(id)!) {
          if (isTitleGame(ctx.data, g)) continue;
          const w = g.completed ? (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId) : winnerIn(g, ctx.winnerOf);
          if (w !== id) continue;
          const opp = g.homeId === id ? g.awayId : g.homeId;
          // An opponent missing from the season's teams counts as below FBS, the conservative reading. seasonFromCfbd
          // adds every opponent with its classification, so this doesn't happen on real data.
          if (ctx.data.classes.get(opp) === "fbs") wins++;
          else if (lower++ < opts.belowFbs) wins++;
        }
        return wins;
      }, cmpNum)),
  };
}

type Big = readonly [bigint, bigint];
const ZERO = BigInt(0);
const ONE = BigInt(1);
const addBig = (a: Big, b: Big): Big => [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
const minBig = (a: Big, b: Big): Big => (a[0] * b[1] <= b[0] * a[1] ? a : b);

/**
 * Capped relative scoring margin: per conference game, points scored over what the opponent allows per game
 * (capped at `cap`), less points allowed over what the opponent scores per game; averaged over the team's
 * conference games. Per-game averages are over the regular season, the title game left out. Needs every score
 * in; until then the ranking stands in for it (it moves with results the same way, and proofs count it as luck).
 * An opponent that never scored or never allowed a point (not seen in FBS data) counts as one point.
 */
export function scoringMargin(opts: { cap: number }): Step {
  return {
    name: "scoring margin",
    restart: true,
    run(ids, ctx) {
      if (!ctx.data.scored) return split(ids, topBy(ids, ctx.rank, cmpNum));
      const totals = new Map<number, { pf: bigint; pa: bigint; n: bigint }>();
      const totalsOf = (id: number) => {
        let t = totals.get(id);
        if (t) return t;
        let pf = 0;
        let pa = 0;
        let n = 0;
        for (const g of ctx.data.schedule.get(id)!) {
          if (isTitleGame(ctx.data, g)) continue;
          const home = g.homeId === id;
          pf += home ? g.homePoints! : g.awayPoints!;
          pa += home ? g.awayPoints! : g.homePoints!;
          n++;
        }
        t = { pf: BigInt(Math.max(pf, 1)), pa: BigInt(Math.max(pa, 1)), n: BigInt(n) };
        totals.set(id, t);
        return t;
      };
      const cap: Big = [BigInt(opts.cap), ONE];
      const margin = (id: number): Big => {
        let sum: Big = [ZERO, ONE];
        let n = ZERO;
        for (const o of ctx.data.ids) {
          for (const g of ctx.data.pairs.get(pairKey(id, o)) ?? []) {
            const home = g.homeId === id;
            const t = totalsOf(o);
            const offense = minBig(cap, [BigInt(home ? g.homePoints! : g.awayPoints!) * t.n, t.pa]);
            const defense: Big = [-BigInt(home ? g.awayPoints! : g.homePoints!) * t.n, t.pf];
            sum = addBig(sum, addBig(offense, defense));
            n += ONE;
          }
        }
        return n === ZERO ? [ZERO, ONE] : [sum[0], sum[1] * n];
      };
      return split(ids, topBy(ids, margin, (a, b) => {
        const d = a[0] * b[1] - b[0] * a[1];
        return d > ZERO ? 1 : d < ZERO ? -1 : 0;
      }));
    },
  };
}

/** The ranking stand-in. `restart: false`: teams level at the top go on to the next step (the draw). */
export function ranking(opts: { restart: boolean }): Step {
  return {
    name: "ranking",
    restart: opts.restart,
    run: (ids, ctx) => split(ids, topBy(ids, ctx.rank, cmpNum)),
  };
}

/** A seeded random draw: one name per open spot, the first name drawn seeded first. Always decides. */
export function draw(): Step {
  return {
    name: "draw",
    restart: false,
    run(ids, ctx, spots) {
      const picked: number[] = [];
      let pool = ids;
      while (picked.length < spots) {
        const id = pool[Math.floor(ctx.draw(pool.length) * pool.length)];
        picked.push(id);
        pool = pool.filter((x) => x !== id);
      }
      return { picked };
    },
  };
}
