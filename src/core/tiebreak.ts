// Conference championship game participants under the ACC tiebreaker policy
// (July 2026), plus a plain standings table. Pure: callers supply the winner
// of every conference game, so a simulator can call this once per iteration.

import type { Game, Season } from "./season";

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
};

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
  return { ids, games, pairs, ratings: new Map(season.teams.map((t) => [t.id, t.rating])) };
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

/** The two teams that play for the conference title: [seed 1, seed 2]. */
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
  opts: TiebreakOptions,
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

  /** Break a tie among 2+ teams of equal pct: place one team, or eliminate one. */
  const breakTie = (ids: number[]): { placed?: number; eliminated?: number } => {
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
      return { placed: top.length === 1 ? top[0] : pickByRankThenDraw(top) };
    }
    const beatsAll = ids.filter((a) => ids.every((b) => a === b || h2h(a, b) > 0));
    if (beatsAll.length === 1) return { placed: beatsAll[0] };
    const lostToAll = ids.filter((a) => ids.every((b) => a === b || h2h(a, b) < 0));
    if (lostToAll.length === 1) return { eliminated: lostToAll[0] };
    return { placed: pickByRankThenDraw(ids) };
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

  /** "Tied Teams": best pct, plus alternate-game-count teams matching wins or losses. */
  const tiedTeams = (cands: Row[]): Row[] => {
    const top = best(cands, (r) => r.pct);
    const topSet = new Set(top);
    const extra = cands.filter(
      (r) =>
        !topSet.has(r) &&
        top.some((t) => t.games !== r.games && (t.wins === r.wins || t.losses === r.losses)),
    );
    return [...top, ...extra];
  };

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
