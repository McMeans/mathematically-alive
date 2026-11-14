// Live ranking: the College Football Playoff committee's latest ranking, moved only by results since it came out.
//
// Each team starts from an anchored score set by the place the latest ranking put it (`anchorAt`; its top 25 in the
// committee's order, every other team below in the stand-in's order, committee.ts), so with no new results the order
// is the committee's. Results since then move it, by weights fitted on how the committee's
// rankings moved from one release to any later one in 2014-2025 (scripts/fit-movement.ts):
// - each win and loss, a win counting for less by a Group of Six team (the committee rarely lifts them far) or by a
//   team with two losses or more;
// - how surprising each result was (an upset moves a team more than an expected result);
// - winning a power conference's title game.
// A game with no result (unplayed and not picked) moves nothing: this is where the committee stands on the results
// so far. The national simulation (national.ts) scores each simulated season the same way, with the noise the fit
// implies, and its average order is the projected ranking.
import { COMMITTEE_WEIGHTS as W } from "./committee-weights";
import { MOVEMENT_WEIGHTS as M } from "./movement-weights";
import { powerConferences, teamRating, titleGameIndex } from "./committee";
import { gameWinProbability } from "./sim";
import { isArmyNavy, type CommitteeRelease, type Game, type Season } from "./season";

/** The pieces the live ranking and the simulation share. Not part of the public API. */
export type LiveModel = {
  /** The committee ranking it is anchored to; null before the first one (the stand-in alone then). */
  release: CommitteeRelease | null;
  /** FBS teams, in the season's team order (the simulation's FBS indexes). */
  fbsIds: number[];
  /** Each FBS team's anchored score (times its fitted weight), by FBS index. */
  anchor: Float64Array;
  /** Wins and losses the anchor ranking saw, by FBS index. */
  seenWins: Int32Array;
  seenLosses: Int32Array;
  /** 1 for a Group of Six team (not in a power conference, and not Notre Dame), by FBS index. */
  g6: Uint8Array;
  /** 1 for a power conference's champion the anchor ranking already saw, by FBS index. */
  seenChampion: Uint8Array;
  /** FBS team ids in the anchor's order: the committee's ranked teams, then the rest. */
  order: number[];
  /** Per `season.games` index: whether it counts toward the ranking at all (Army-Navy doesn't: it comes after selection). */
  counts: boolean[];
  /** Per `season.games` index: whether the anchor ranking saw its result (completed before the ranking's week). */
  seen: boolean[];
  /** Per `season.games` index: the home team's chance of winning. */
  home: Float64Array;
};

/**
 * A place's anchored score, before its fitted weight: minus the square root of the place (1 is first). Places near the
 * top sit further apart than places lower down, as in the committee's rankings, so a result moves a team past fewer
 * teams near the top. Of the spacings tried (the stand-in's own scores, log, square root, linear), it ordered the
 * committee's later rankings best (scripts/fit-movement.ts).
 */
export const anchorAt = (place: number): number => -Math.sqrt(place + 1);

/**
 * The highest place the committee has given a team with this many losses, 2014-2025 (every weekly ranking in
 * fixtures/cfp-<year>.json): with 3 losses #7 (2017 Auburn, 10-3), with 4 #13 (2017 Stanford, 9-4), and with 5 or
 * more, none ranked; #20 here. A linear score can't hold that line, so the ranking enforces it.
 */
export const highestPlace = (losses: number): number => (losses <= 2 ? 1 : losses === 3 ? 7 : losses === 4 ? 13 : 20);

/**
 * Reorders `order` (best first) in place so no team sits above the highest place its losses allow (`highestPlace`):
 * each place goes to the best team below that may hold it, the teams it passes each moving down one. A place no team
 * below may hold keeps its team.
 */
export function holdCeilings<T extends number>(order: { length: number; [k: number]: T }, losses: (x: T) => number): void {
  const n = Math.min(order.length, 20);
  for (let p = 0; p < n; p++) {
    if (highestPlace(losses(order[p])) - 1 <= p) continue;
    let q = p + 1;
    while (q < order.length && highestPlace(losses(order[q])) - 1 > p) q++;
    if (q === order.length) continue;
    const x = order[q];
    for (let r = q; r > p; r--) order[r] = order[r - 1];
    order[p] = x;
  }
}

/** How surprising a result was: the chance the loser had. Added to the winner's surprise, taken off the loser's. */
export const resultPoints = (homeChance: number, homeWon: boolean): number => (homeWon ? 1 - homeChance : homeChance);

/** The moved score, past the anchor: new wins and losses, surprise, and a new power-conference title. */
export const movedScore = (m: LiveModel, k: number, newWins: number, newLosses: number, surprise: number, champion: boolean): number =>
  m.anchor[k] + (M.wins + M.g6Wins * m.g6[k] + (m.seenLosses[k] + newLosses >= 2 ? M.lossyWins : 0)) * newWins + M.losses * newLosses +
  M.upset * surprise + (champion && !m.seenChampion[k] ? M.champion : 0);

/** Power-conference teams, plus Notre Dame, which the committee ranks as one. */
export function powerTeam(season: Season, id: number): boolean {
  const t = season.teams.find((x) => x.id === id);
  return !!t && (powerConferences(season.year).includes(t.conference ?? "") || t.name === "Notre Dame");
}

/** Not part of the public API. */
export function liveModel(season: Season): LiveModel {
  const release = (season.committeeRankings ?? []).at(-1) ?? null;
  const byId = new Map(season.teams.map((t) => [t.id, t]));
  const fbsIds = season.teams.filter((t) => t.classification === "fbs").map((t) => t.id);
  const fbsIndex = new Map(fbsIds.map((id, k) => [id, k]));
  const games = season.games;
  const counts = games.map((g) => !isArmyNavy(byId.get(g.homeId)?.name, byId.get(g.awayId)?.name));
  const seen = games.map((g, i) => counts[i] && g.completed && release !== null && (release.postseason || g.week < release.week));
  const home = Float64Array.from(games, (g) => gameWinProbability(season, g));

  // The stand-in's score on what the ranking saw: record and champions then, rating, and the whole schedule's strength.
  const F = fbsIds.length;
  const seenWins = new Int32Array(F);
  const seenLosses = new Int32Array(F);
  const oppSum = new Float64Array(F);
  const oppCount = new Float64Array(F);
  games.forEach((g, i) => {
    if (!counts[i]) return;
    const h = fbsIndex.get(g.homeId) ?? -1;
    const a = fbsIndex.get(g.awayId) ?? -1;
    if (h >= 0) { oppSum[h] += teamRating(byId.get(g.awayId)); oppCount[h]++; }
    if (a >= 0) { oppSum[a] += teamRating(byId.get(g.homeId)); oppCount[a]++; }
    if (!seen[i]) return;
    const homeWon = g.homePoints! > g.awayPoints!;
    const [w, l] = homeWon ? [h, a] : [a, h];
    if (w >= 0) seenWins[w]++;
    if (l >= 0) seenLosses[l]++;
  });
  const champions = new Set(powerChampions(season, (i) => seen[i]));
  const seenChampion = Uint8Array.from(fbsIds, (id) => (champions.has(id) ? 1 : 0));
  const score = Float64Array.from(fbsIds, (id, k) =>
    W.wins * seenWins[k] + W.losses * seenLosses[k] + W.rating * teamRating(byId.get(id)) +
    W.strength * (oppCount[k] === 0 ? 0 : oppSum[k] / oppCount[k]) + W.champion * seenChampion[k]);

  const byScore = fbsIds.map((_, k) => k).sort((x, y) => score[y] - score[x] || fbsIds[x] - fbsIds[y]);
  const ranked = (release?.teamIds ?? []).filter((id) => fbsIndex.has(id));
  const inRanking = new Set(ranked);
  const order = [...ranked, ...byScore.map((k) => fbsIds[k]).filter((id) => !inRanking.has(id))];
  const anchor = new Float64Array(F);
  order.forEach((id, p) => { anchor[fbsIndex.get(id)!] = M.anchor * anchorAt(p); });
  const g6 = Uint8Array.from(fbsIds, (id) => (powerTeam(season, id) ? 0 : 1));
  return { release, fbsIds, anchor, seenWins, seenLosses, g6, seenChampion, order, counts, seen, home };
}

/** Winners of the power conferences' title games that `has` says have a result, by `season.games` index. */
function powerChampions(season: Season, has: (gameIndex: number) => boolean, winner = (g: Game) => (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId)): number[] {
  return powerConferences(season.year).flatMap((c) => {
    const ids = new Set(season.teams.filter((t) => t.conference === c).map((t) => t.id));
    const i = titleGameIndex(season, ids);
    return i >= 0 && has(i) ? [winner(season.games[i])] : [];
  });
}

export type LiveRankingOptions = {
  /** Picked results: game id -> id of the team that wins it. A completed game keeps its real result. */
  locks?: Record<number, number>;
  /**
   * Picked conference title games whose game isn't in the data with a result: the winner, and the team it beat
   * (null when the matchup isn't known). The winner gets a win (and a power conference's title), the loser a loss.
   */
  titles?: readonly { winner: number; loser: number | null }[];
};

export type LiveRanked = {
  teamId: number;
  /** 1 is best. */
  rank: number;
  /** Its place in the committee's latest ranking; null when that ranking left it out (or there is none yet). */
  committeeRank: number | null;
  /** Places it moved from the anchor (the committee's order, then the stand-in's): positive is up. */
  change: number;
};

export type LiveRanking = {
  /** The committee ranking it starts from; null before the first one, when it is the stand-in's alone. */
  release: CommitteeRelease | null;
  /** Every FBS team, best first. */
  teams: LiveRanked[];
};

/**
 * The committee's latest ranking, moved by the results since it came out. A real result moves a team as the fit
 * says (live.ts's header). A picked one moves it by how much it beat what was expected, while few games are picked,
 * shading to its full result as the picks fill the season. So with no picks this is where the committee stands now; a
 * pick never gains a team ground just because the teams around it haven't been picked yet; and a season picked in
 * full is ranked on its whole record. Teams the committee didn't rank are placed below its ranked ones by the stand-in.
 */
export function liveRanking(season: Season, opts: LiveRankingOptions = {}): LiveRanking {
  const m = liveModel(season);
  const locks = opts.locks ?? {};
  const byId = new Map(season.teams.map((t) => [t.id, t]));
  const fbsIndex = new Map(m.fbsIds.map((id, k) => [id, k]));
  const games = season.games;
  const power = new Set(powerConferences(season.year));
  const powerTitle = new Set(powerConferences(season.year).map((c) =>
    titleGameIndex(season, new Set(season.teams.filter((t) => t.conference === c).map((t) => t.id)))).filter((i) => i >= 0));
  const delta = new Float64Array(m.fbsIds.length);
  // What a team gains from a result: a win (less for a Group of Six team), how surprising it was, and a new power title.
  // `lossy`: teams with two or more losses once the decided results are in (filled in below, before any gain is used).
  const lossy = new Uint8Array(m.fbsIds.length);
  const winGain = (k: number, pWin: number, title: boolean) =>
    M.wins + M.g6Wins * m.g6[k] + (lossy[k] ? M.lossyWins : 0) + M.upset * (1 - pWin) + (title && !m.seenChampion[k] ? M.champion : 0);
  const lossGain = (pWin: number) => M.losses - M.upset * pWin;
  // A picked result counts as it happened, less what was expected of it (`discount` times its expected gain): with few
  // picks, nearly all of it, so a pick moves a team only by how much it beat the odds and unpicked teams aren't left
  // behind; with every game picked, none, so the season's whole record counts as the committee counts it at the end.
  // In between, in proportion to the share of games still open.
  type Result = { winner: number; loser: number | null; pWin: number; real: boolean; title: boolean };
  const results: Result[] = [];
  let open = 0, picked = 0;
  const decided = games.map(() => false);
  games.forEach((g, i) => {
    if (!m.counts[i] || m.seen[i]) return;
    if (!g.completed) open++;
    const pick = locks[g.id];
    const won = g.completed ? (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId) : pick === g.homeId || pick === g.awayId ? pick : null;
    if (won === null) return;
    if (!g.completed) picked++;
    decided[i] = true;
    const homeWon = won === g.homeId;
    results.push({ winner: won, loser: homeWon ? g.awayId : g.homeId, pWin: homeWon ? m.home[i] : 1 - m.home[i], real: g.completed, title: powerTitle.has(i) });
  });
  for (const { winner, loser } of opts.titles ?? []) {
    const conference = byId.get(winner)?.conference;
    if (!conference) continue;
    const i = titleGameIndex(season, new Set(season.teams.filter((t) => t.conference === conference).map((t) => t.id)));
    if (i >= 0 && (decided[i] || m.seen[i])) continue;
    // A title game in the data is already counted open above; one not in the data is one more game. Picked either way.
    if (i < 0 || !m.counts[i]) open++;
    picked++;
    const pWin = loser === null ? 0.5 : gameWinProbability(season, { id: -1, week: 0, start: "", neutralSite: true, conferenceGame: true, homeId: winner, awayId: loser, homePoints: null, awayPoints: null, completed: false, spread: null });
    results.push({ winner, loser, pWin, real: false, title: power.has(conference) });
  }
  const discount = open === 0 ? 0 : 1 - picked / open;
  const newLosses = new Int32Array(m.fbsIds.length);
  for (const r of results) { const l = r.loser === null ? -1 : fbsIndex.get(r.loser) ?? -1; if (l >= 0) newLosses[l]++; }
  m.fbsIds.forEach((_, k) => { lossy[k] = m.seenLosses[k] + newLosses[k] >= 2 ? 1 : 0; });
  for (const { winner, loser, pWin, real, title } of results) {
    const w = fbsIndex.get(winner) ?? -1;
    const l = loser === null ? -1 : fbsIndex.get(loser) ?? -1;
    const cut = real ? 0 : discount;
    if (w >= 0) {
      const win = winGain(w, pWin, title);
      delta[w] += win - cut * (pWin * win + (1 - pWin) * lossGain(pWin));
    }
    if (l >= 0) {
      const pL = 1 - pWin;
      const loss = lossGain(pL);
      delta[l] += loss - cut * (pL * winGain(l, pL, title) + (1 - pL) * loss);
    }
  }

  const anchorPlace = new Map(m.order.map((id, p) => [id, p]));
  const score = Float64Array.from(m.fbsIds, (_, k) => m.anchor[k] + delta[k]);
  const sorted = m.fbsIds.map((_, k) => k)
    // Scores within rounding of each other are a tie (the anchor's scores are sums of floats), which the anchor's order breaks.
    .sort((x, y) => (Math.abs(score[y] - score[x]) > 1e-9 ? score[y] - score[x] : anchorPlace.get(m.fbsIds[x])! - anchorPlace.get(m.fbsIds[y])!));
  // Losses for the ceiling: what the ranking saw plus every decided result since.
  holdCeilings(sorted, (k) => m.seenLosses[k] + newLosses[k]);
  const committee = new Map((m.release?.teamIds ?? []).map((id, p) => [id, p + 1]));
  return {
    release: m.release,
    teams: sorted.map((k, p) => {
      const teamId = m.fbsIds[k];
      return { teamId, rank: p + 1, committeeRank: committee.get(teamId) ?? null, change: anchorPlace.get(teamId)! - p };
    }),
  };
}

/** The live ranking's top 25 by team, as shown by a name ("#16"). */
export function liveRanks(season: Season, opts: LiveRankingOptions = {}): Record<number, string> {
  // Before the committee's first ranking, no team has a rank to show.
  if (!season.committeeRankings?.length) return {};
  return Object.fromEntries(liveRanking(season, opts).teams.slice(0, 25).map((t) => [t.teamId, `#${t.rank}`]));
}
