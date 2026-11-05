// Conference championship game participants under each conference's tiebreaker
// policy, plus a plain standings table. Pure: callers supply the winner of every
// unplayed game, so a simulator can call this once per iteration.
//
// Policies:
// - "Big 12": the Big 12 Football Tiebreaking Procedures (2024 season document,
//   the latest published): head-to-head, common opponents, next highest placed
//   common opponent, conference strength of schedule, total wins, SportSource
//   ranking, coin toss.
// - "SEC": Southeastern Conference Official Football Tiebreakers (SEC Football Tiebreakers Final 10.29.24, the
//   document the SEC's tiebreaker page, https://www.secsports.com/fbtiebreaker, publishes for the 16-team,
//   no-division format):
//   https://storage.googleapis.com/secsports-prod/upload/2024/10/29/f6fc7cd9-3031-4357-8754-80bfa4b9c4c0.pdf
//   Head-to-head, common opponents, highest placed common opponent, cumulative conference win pct of
//   conference opponents, capped relative scoring margin, random draw.
// - Every other conference: the ACC tiebreaker policy (July 2026).

import type { Classification, Game, Season } from "./season";

export type ConferenceStanding = {
  teamId: number;
  wins: number;
  losses: number;
  /** wins / (wins + losses); 0 when no games were played. */
  pct: number;
};

export type TiebreakOptions = {
  /** Uniform random draw in [0, 1), used only when every other step ties. Told how many teams it picks among. */
  draw: (count: number) => number;
  /** Higher is better. Stands in for the SportSource Team Success Ranking. Defaults to the team's rating. */
  rank?: (teamId: number) => number;
};

type Row = ConferenceStanding & { games: number };

/** Per-conference data that doesn't change between simulated seasons. */
export type ConferenceData = {
  ids: Set<number>;
  games: Game[];
  /** Conference games between each pair of teams, keyed by pairKey. */
  pairs: Map<number, Game[]>;
  ratings: Map<number, number | null>;
  /** Every game each team plays, conference or not, for the Big 12's total-wins step. */
  schedule: Map<number, Game[]>;
  classes: Map<number, Classification>;
  /** Every regular-season game of every member has a final score, so the SEC's scoring-margin step can be worked out. */
  scored: boolean;
};

/** Conferences whose tiebreak counts non-conference results (the Big 12's total-wins step). Not part of the public API. */
export const countsNonConference = (conference: string): boolean => conference === "Big 12";

/** The tiebreak steps a team's way in can still hinge on once its results are set, as the likeliest-way note names them. Not part of the public API. */
export const luckSteps = (conference: string): string =>
  conference === "Big 12" ? "total wins and the ranking tiebreak" : conference === "SEC" ? "the scoring margin tiebreak" : "the ranking tiebreak";

const pairKey = (a: number, b: number): number => (a < b ? a * 4294967296 + b : b * 4294967296 + a);

export function conferenceData(season: Season, conference: string): ConferenceData {
  const ids = new Set(season.teams.filter((t) => t.conference === conference).map((t) => t.id));
  const games = season.games.filter((g) => g.conferenceGame && ids.has(g.homeId) && ids.has(g.awayId));
  const pairs = new Map<number, Game[]>();
  for (const g of games) {
    const k = pairKey(g.homeId, g.awayId);
    const list = pairs.get(k);
    if (list) list.push(g);
    else pairs.set(k, [g]);
  }
  const schedule = new Map<number, Game[]>([...ids].map((id) => [id, []]));
  for (const g of season.games) {
    schedule.get(g.homeId)?.push(g);
    schedule.get(g.awayId)?.push(g);
  }
  // A non-conference game between two members is the title game, which comes after the tiebreak.
  const titleGame = (g: Game) => !g.conferenceGame && ids.has(g.homeId) && ids.has(g.awayId);
  const scored = [...schedule.values()].every((list) => list.every((g) => g.completed || titleGame(g)));
  return {
    ids, games, pairs, schedule, scored,
    ratings: new Map(season.teams.map((t) => [t.id, t.rating])),
    classes: new Map(season.teams.map((t) => [t.id, t.classification])),
  };
}

function winnerIn(g: Game, winnerOf: (game: Game) => number): number {
  const w = winnerOf(g);
  if (w !== g.homeId && w !== g.awayId) throw new Error(`winnerOf returned team ${w}, who is not in game ${g.id}`);
  return w;
}

function rows(data: ConferenceData, winnerOf: (game: Game) => number): Row[] {
  const { ids, games } = data;
  const byId = new Map<number, Row>();
  for (const id of ids) byId.set(id, { teamId: id, wins: 0, losses: 0, pct: 0, games: 0 });
  for (const g of games) {
    const w = winnerIn(g, winnerOf);
    const l = w === g.homeId ? g.awayId : g.homeId;
    byId.get(w)!.wins++;
    byId.get(l)!.losses++;
  }
  for (const r of byId.values()) {
    r.games = r.wins + r.losses;
    r.pct = r.games === 0 ? 0 : r.wins / r.games;
  }
  return [...byId.values()];
}

/** Teams in the conference, best conference record first. */
export function conferenceStandings(
  season: Season,
  conference: string,
  winnerOf: (game: Game) => number,
): ConferenceStanding[] {
  return rows(conferenceData(season, conference), winnerOf)
    .sort((a, b) => b.pct - a.pct || b.wins - a.wins || a.losses - b.losses || a.teamId - b.teamId)
    .map(({ teamId, wins, losses, pct }) => ({ teamId, wins, losses, pct }));
}

/**
 * The two teams that play for the conference title: [seed 1, seed 2]. `winnerOf` gives the winner of every
 * conference game, played or not; for the Big 12 it is also asked about unplayed non-conference games, which
 * count toward the total-wins step.
 */
export function championshipParticipants(
  season: Season,
  conference: string,
  winnerOf: (game: Game) => number,
  opts: TiebreakOptions,
): [number, number] {
  return championshipFromData(conferenceData(season, conference), conference, winnerOf, opts);
}

/** Same as championshipParticipants with the per-conference data precomputed. Not part of the public API. */
export function championshipFromData(
  data: ConferenceData,
  conference: string,
  winnerOf: (game: Game) => number,
  opts: TiebreakOptions & {
    /** False: skip steps that need non-conference results (the Big 12's total wins), leaving them to `rank`. */
    allGames?: boolean;
  },
): [number, number] {
  if (data.ids.size < 2) throw new Error(`${conference} has fewer than two teams`);
  const table = rows(data, winnerOf);
  const rank = opts.rank ?? ((id: number) => data.ratings.get(id) ?? -Infinity);

  // net head-to-head result of a over b among conference games: >0 a won more.
  const h2h = (a: number, b: number): number => {
    let net = 0;
    for (const g of data.pairs.get(pairKey(a, b)) ?? []) net += winnerIn(g, winnerOf) === a ? 1 : -1;
    return net;
  };
  const played = (a: number, b: number): boolean => data.pairs.has(pairKey(a, b));

  const best = <T>(items: T[], score: (x: T) => number): T[] => {
    const top = Math.max(...items.map(score));
    return items.filter((x) => score(x) === top);
  };
  const pickByRankThenDraw = (ids: number[]): number => {
    const top = best(ids, rank);
    return top.length === 1 ? top[0] : top[Math.floor(opts.draw(top.length) * top.length)];
  };

  /** Break a tie among 2+ teams of equal pct under the ACC policy: place one team, or eliminate one. */
  const accBreak = (ids: number[]): { placed?: number; eliminated?: number } => {
    if (ids.length === 2) {
      const [a, b] = ids;
      const net = h2h(a, b);
      if (net !== 0) return { placed: net > 0 ? a : b };
      return { placed: pickByRankThenDraw(ids) };
    }
    const roundRobin = ids.every((a) => ids.every((b) => a === b || played(a, b)));
    if (roundRobin) {
      const record = (id: number) => {
        let w = 0;
        let l = 0;
        for (const o of ids) {
          if (o === id) continue;
          const n = h2h(id, o);
          if (n > 0) w++;
          else if (n < 0) l++;
        }
        return w + l === 0 ? 0 : w / (w + l);
      };
      const top = best(ids, record);
      // Head-to-head cut the tie down: start over among the teams left (two left go back to the two-team steps).
      if (top.length === 1) return { placed: top[0] };
      return top.length < ids.length ? accBreak(top) : { placed: pickByRankThenDraw(top) };
    }
    const beatsAll = ids.filter((a) => ids.every((b) => a === b || h2h(a, b) > 0));
    if (beatsAll.length === 1) return { placed: beatsAll[0] };
    const lostToAll = ids.filter((a) => ids.every((b) => a === b || h2h(a, b) < 0));
    if (lostToAll.length === 1) return { eliminated: lostToAll[0] };
    return { placed: pickByRankThenDraw(ids) };
  };

  const big12 = countsNonConference(conference);
  const rowOf = new Map(table.map((r) => [r.teamId, r]));
  const pctOf = new Map(table.map((r) => [r.teamId, r.pct]));
  /** Wins and losses of `id` in conference games against `opps`. */
  const recordVs = (id: number, opps: Iterable<number>): [number, number] => {
    let w = 0;
    let l = 0;
    for (const o of opps) {
      for (const g of data.pairs.get(pairKey(id, o)) ?? []) {
        if (winnerIn(g, winnerOf) === id) w++;
        else l++;
      }
    }
    return [w, l];
  };
  const pctVs = (id: number, opps: number[]): number => {
    const [w, l] = recordVs(id, opps);
    return w + l === 0 ? 0 : w / (w + l);
  };
  /** Strength of conference schedule: combined conference win pct of the team's conference opponents, per game. */
  const sos = (id: number): number => {
    let w = 0;
    let n = 0;
    for (const o of data.ids) {
      if (o === id) continue;
      const times = data.pairs.get(pairKey(id, o))?.length ?? 0;
      if (times === 0) continue;
      const r = rowOf.get(o)!;
      w += times * r.wins;
      n += times * r.games;
    }
    return n === 0 ? 0 : w / n;
  };
  /** Wins in the regular season, at most one of them over a team below FBS. */
  const totalWins = (id: number): number => {
    let wins = 0;
    let lower = 0;
    for (const g of data.schedule.get(id)!) {
      const w = g.completed ? (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId) : winnerIn(g, winnerOf);
      if (w !== id) continue;
      const opp = g.homeId === id ? g.awayId : g.homeId;
      // An opponent missing from the season's teams counts as below FBS, the conservative reading (at most one such
      // win counts). seasonFromCfbd adds every opponent with its classification, so this doesn't happen on real data.
      if (data.classes.get(opp) === "fbs") wins++;
      else if (lower++ === 0) wins++;
    }
    return wins;
  };

  /**
   * Break a tie among 2+ teams of equal pct under the Big 12 policy: the first step that tells the teams apart
   * seeds its one best team, or, when several share the best mark, starts over among those (two left go back
   * to the two-team steps).
   */
  const big12Break = (ids: number[]): { placed: number } => {
    const decide = (score: (id: number) => number): { placed: number } | null => {
      const top = best(ids, score);
      if (top.length === ids.length) return null;
      return top.length === 1 ? { placed: top[0] } : big12Break(top);
    };
    // a. Head-to-head: two teams by their games; more only when all played each other (record among them), else a
    //    team that beat every other one.
    if (ids.length === 2) {
      const net = h2h(ids[0], ids[1]);
      if (net !== 0) return { placed: net > 0 ? ids[0] : ids[1] };
    } else if (ids.every((a) => ids.every((b) => a === b || played(a, b)))) {
      const r = decide((id) => pctVs(id, ids.filter((o) => o !== id)));
      if (r) return r;
    } else {
      const beatsAll = ids.filter((a) => ids.every((b) => a === b || h2h(a, b) > 0));
      if (beatsAll.length === 1) return { placed: beatsAll[0] };
    }
    // b. Common conference opponents: those every tied team played.
    const common = [...data.ids].filter((o) => !ids.includes(o) && ids.every((id) => played(id, o)));
    const viaCommon = decide((id) => pctVs(id, common));
    if (viaCommon) return viaCommon;
    // c. The next highest placed common opponent, down the standings; a group tied there counts as one.
    for (const level of [...new Set(common.map((o) => pctOf.get(o)!))].sort((a, b) => b - a)) {
      const group = common.filter((o) => pctOf.get(o) === level);
      const r = decide((id) => pctVs(id, group));
      if (r) return r;
    }
    // d. Strength of conference schedule.
    const viaSos = decide(sos);
    if (viaSos) return viaSos;
    // e. Total wins, when every game's result is known.
    if (opts.allGames !== false) {
      const r = decide(totalWins);
      if (r) return r;
    }
    // f. SportSource ranking, then g. coin toss.
    return { placed: pickByRankThenDraw(ids) };
  };
  const breakTie = (ids: number[]): { placed?: number; eliminated?: number } => (big12 ? big12Break(ids) : accBreak(ids));

  const allPlayed = (ids: number[]): boolean => ids.every((a) => ids.every((b) => a === b || played(a, b)));
  const beatsAll = (ids: number[]): number[] => ids.filter((a) => ids.every((b) => a === b || h2h(a, b) > 0));
  const lostToAll = (ids: number[]): number[] => ids.filter((a) => ids.every((b) => a === b || h2h(a, b) < 0));
  const amongThem = (ids: number[]) => (id: number) => pctVs(id, ids.filter((o) => o !== id));

  /**
   * SEC standings order of teams level on conference win pct, as the highest-placed-opponent step reads it: the
   * tie is broken by head-to-head only, and teams it can't separate stay together as one group.
   */
  const h2hTiers = (group: number[]): number[][] => {
    if (group.length === 1) return [group];
    let top: number[] = [];
    if (allPlayed(group)) top = best(group, amongThem(group));
    else if (beatsAll(group).length === 1) top = beatsAll(group);
    else if (lostToAll(group).length === 1) top = group.filter((id) => id !== lostToAll(group)[0]);
    if (top.length === 0 || top.length === group.length) return [group];
    return [...h2hTiers(top), ...h2hTiers(group.filter((id) => !top.includes(id)))];
  };
  // Every member's game count divides this, so a sum of win pcts is a whole number of 1/lcm steps.
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const lcm = table.reduce((m, r) => (r.games === 0 ? m : (m * r.games) / gcd(m, r.games)), 1);
  /**
   * SEC step D: the average conference win pct of the team's conference opponents. Worked out in whole numbers and
   * divided once, so averages equal as fractions come out equal (a float sum can round them apart).
   */
  const opponentPct = (id: number): number => {
    let sum = 0;
    let n = 0;
    for (const o of data.ids) {
      const times = data.pairs.get(pairKey(id, o))?.length ?? 0;
      const r = rowOf.get(o)!;
      if (r.games > 0) sum += (times * r.wins * lcm) / r.games;
      n += times;
    }
    return n === 0 ? 0 : sum / (n * lcm);
  };
  /** Regular-season points scored and allowed per game, for SEC step E (the title game left out). */
  const averages = (id: number): { scored: number; allowed: number } => {
    let pf = 0;
    let pa = 0;
    let n = 0;
    for (const g of data.schedule.get(id)!) {
      if (!g.conferenceGame && data.ids.has(g.homeId) && data.ids.has(g.awayId)) continue;
      const home = g.homeId === id;
      pf += home ? g.homePoints! : g.awayPoints!;
      pa += home ? g.awayPoints! : g.homePoints!;
      n++;
    }
    return { scored: pf / n, allowed: pa / n };
  };
  /**
   * SEC step E, capped relative scoring margin (Appendix A): per conference game, points scored over what the
   * opponent allows on average (capped at 200%) less points allowed over what it scores on average; averaged.
   */
  const scoringMargin = (id: number): number => {
    let sum = 0;
    let n = 0;
    for (const o of data.ids) {
      for (const g of data.pairs.get(pairKey(id, o)) ?? []) {
        const home = g.homeId === id;
        const opp = averages(o);
        const offense = Math.min(2, (home ? g.homePoints! : g.awayPoints!) / opp.allowed);
        const defense = (home ? g.awayPoints! : g.homePoints!) / opp.scored;
        sum += offense - defense;
        n++;
      }
    }
    return n === 0 ? 0 : sum / n;
  };

  /**
   * Choose `slots` of 2+ teams level on conference win pct under the SEC procedures, best seed first. Each step
   * ranks the teams: one alone at the top is in (with two spots open, the rest start over for the second); two at
   * the top with two spots are both in; otherwise the teams at the top start over and the rest are out.
   */
  const secPick = (ids: number[], slots: number): number[] => {
    if (ids.length === slots && slots === 1) return ids;
    if (ids.length === slots) {
      // Both are in; the two-team steps seed them.
      const first = secPick(ids, 1)[0];
      return [first, ids.find((id) => id !== first)!];
    }
    const take = (top: number[]): number[] =>
      top.length === 1 && slots === 2 ? [top[0], ...secPick(ids.filter((id) => id !== top[0]), 1)] : secPick(top, slots);
    const split = (score: (id: number) => number): number[] | null => {
      const top = best(ids, score);
      return top.length === ids.length ? null : take(top);
    };
    // A. Head-to-head: the record among them when all played each other; else a team that beat all the others is
    //    in, or one that lost to all the others is out.
    if (allPlayed(ids)) {
      const r = split(amongThem(ids));
      if (r) return r;
    } else if (beatsAll(ids).length === 1) {
      return take(beatsAll(ids));
    } else if (lostToAll(ids).length === 1) {
      return secPick(ids.filter((id) => id !== lostToAll(ids)[0]), slots);
    }
    // B. Record against common conference opponents (those every tied team played).
    const common = [...data.ids].filter((o) => !ids.includes(o) && ids.every((id) => played(id, o)));
    const viaCommon = split((id) => pctVs(id, common));
    if (viaCommon) return viaCommon;
    // C. Record against the highest placed common opponent, down the standings. Opponents level there are told
    //    apart by head-to-head only; those it can't separate count as one, and only the common ones count.
    const others = [...data.ids].filter((o) => !ids.includes(o));
    for (const level of [...new Set(others.map((o) => pctOf.get(o)!))].sort((a, b) => b - a)) {
      for (const tier of h2hTiers(others.filter((o) => pctOf.get(o) === level))) {
        const group = tier.filter((o) => common.includes(o));
        if (group.length === 0) continue;
        const r = split((id) => pctVs(id, group));
        if (r) return r;
      }
    }
    // D. Cumulative conference win pct of all conference opponents.
    const viaOpponents = split(opponentPct);
    if (viaOpponents) return viaOpponents;
    // E. Capped relative scoring margin once every score is in; until then the ranking stands in for it (it moves
    //    with results the same way, and proofs count it as luck).
    const viaMargin = split(data.scored ? scoringMargin : rank);
    if (viaMargin) return viaMargin;
    // F. Random draw: one name per open spot, the first name drawn seeded first.
    const drawn: number[] = [];
    let pool = ids;
    while (drawn.length < slots) {
      drawn.push(pool[Math.floor(opts.draw(pool.length) * pool.length)]);
      pool = pool.filter((id) => id !== drawn[drawn.length - 1]);
    }
    return drawn;
  };

  /** Order teams of equal pct best-first by repeated tie-breaking. */
  const orderEqual = (ids: number[]): number[] => {
    const out: number[] = [];
    const tail: number[] = [];
    let rest = ids;
    while (rest.length > 1) {
      const r = breakTie(rest);
      if (r.placed !== undefined) {
        out.push(r.placed);
        rest = rest.filter((x) => x !== r.placed);
      } else {
        tail.unshift(r.eliminated!);
        rest = rest.filter((x) => x !== r.eliminated);
      }
    }
    return [...out, ...rest, ...tail];
  };

  /** "Tied Teams": best pct, plus (ACC) alternate-game-count teams matching wins or losses. */
  const tiedTeams = (cands: Row[]): Row[] => {
    const top = best(cands, (r) => r.pct);
    const topSet = new Set(top);
    const extra = big12 ? [] : cands.filter(
      (r) =>
        !topSet.has(r) &&
        top.some((t) => t.games !== r.games && (t.wins === r.wins || t.losses === r.losses)),
    );
    return [...top, ...extra];
  };

  if (conference === "SEC") {
    const levels = [...new Set(table.map((r) => r.pct))].sort((a, b) => b - a);
    const at = (p: number) => table.filter((r) => r.pct === p).map((r) => r.teamId);
    const top = at(levels[0]);
    const [a, b] = top.length >= 2 ? secPick(top, 2) : [top[0], ...secPick(at(levels[1]), 1)];
    return [a, b];
  }

  const result: number[] = [];
  let slots = 2;
  let cands = table;
  while (slots > 0 && cands.length > 0) {
    const tied = tiedTeams(cands);
    if (tied.length <= slots) {
      const levels = [...new Set(tied.map((r) => r.pct))].sort((a, b) => b - a);
      for (const p of levels) result.push(...orderEqual(tied.filter((r) => r.pct === p).map((r) => r.teamId)));
      slots -= tied.length;
      const gone = new Set(tied);
      cands = cands.filter((r) => !gone.has(r));
      continue;
    }
    // Break starting with the highest win pct, working downward.
    const group = tied.filter((r) => r.pct === Math.max(...tied.map((t) => t.pct))).map((r) => r.teamId);
    const r = group.length === 1 ? { placed: group[0] } : breakTie(group);
    const id = (r.placed ?? r.eliminated)!;
    if (r.placed !== undefined) {
      result.push(id);
      slots--;
    }
    cands = cands.filter((c) => c.teamId !== id);
  }
  return [result[0], result[1]];
}
