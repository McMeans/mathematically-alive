// Live ranking: the College Football Playoff committee's latest ranking, moved only by results since it came out.
//
// The committee stand-in (committee.ts) scores every FBS team on record, rating, strength of schedule and a
// power-conference title. Here each team also gets a fixed offset, set so that on the results the latest ranking
// saw, the scores put the teams in the committee's order: its top 25 first, then the rest in the stand-in's order
// (an estimate, below the 25 it ranked). Results since then move the scores:
// - the team's own record (each win and loss, weighted as the stand-in weighs them);
// - its rating, by how surprising each result was: a win counts RESULT_POINTS times the chance it had of losing,
//   a loss the same times the chance it had of winning (an upset moves a team more than an expected result);
// - its strength of schedule, by the same rating changes of every team it plays: losing to a team that then keeps
//   losing looks a little worse.
// A game with no result (unplayed and not picked) moves nothing, so with no new results this is the committee's ranking.
// The national simulation (national.ts) ranks each simulated season the same way, so the playoff field starts from it.
import { COMMITTEE_WEIGHTS as W } from "./committee-weights";
import { powerConferences, teamRating, titleGameIndex } from "./committee";
import { gameWinProbability } from "./sim";
import { isArmyNavy, type CommitteeRelease, type Game, type Season } from "./season";

/**
 * Rating points a result moves a team by, times how surprising it was (the chance it had of going the other way).
 * Kept small: on 2014-2025's weekly rankings, predicting each next ranking from the one before plus the week's
 * results, 0 matched the committee's order best (94.3% of top-25 pairs), 3 nearly as well (94.0%), 6 and up worse.
 */
export const RESULT_POINTS = 3;
/**
 * Spread of each simulated season's ranking noise when the ranking is anchored to the committee's, as a share of the
 * stand-in's own (fitted on how far the committee strays from the model). Smaller: the anchor already holds what the
 * committee thinks of the results so far, so only the results still to come leave room for it to disagree.
 */
export const ANCHORED_NOISE = 0.5;

/** The pieces the live ranking and the simulation share. Not part of the public API. */
export type LiveModel = {
  /** The committee ranking it is anchored to; null before the first one (the stand-in alone then). */
  release: CommitteeRelease | null;
  /** FBS teams, in the season's team order (the simulation's FBS indexes). */
  fbsIds: number[];
  /** Points added to each FBS team's stand-in score, by FBS index. */
  offset: Float64Array;
  /** FBS team ids in the anchor's order: the committee's ranked teams, then the rest. */
  order: number[];
  /** Per `season.games` index: whether it counts toward the ranking at all (Army-Navy doesn't: it comes after selection). */
  counts: boolean[];
  /** Per `season.games` index: whether the anchor ranking saw its result (completed before the ranking's week). */
  seen: boolean[];
  /** Per `season.games` index: the home team's chance of winning. */
  home: Float64Array;
};

/** How far a result moves the winner's rating up and the loser's down: RESULT_POINTS times the loser's chance. */
export const resultPoints = (homeChance: number, homeWon: boolean): number => RESULT_POINTS * (homeWon ? 1 - homeChance : homeChance);

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
  const wins = new Float64Array(F);
  const losses = new Float64Array(F);
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
    if (w >= 0) wins[w]++;
    if (l >= 0) losses[l]++;
  });
  const champions = new Set(powerChampions(season, (i) => seen[i]));
  const score = Float64Array.from(fbsIds, (id, k) =>
    W.wins * wins[k] + W.losses * losses[k] + W.rating * teamRating(byId.get(id)) +
    W.strength * (oppCount[k] === 0 ? 0 : oppSum[k] / oppCount[k]) + W.champion * (champions.has(id) ? 1 : 0));

  const byScore = fbsIds.map((_, k) => k).sort((x, y) => score[y] - score[x] || fbsIds[x] - fbsIds[y]);
  const ranked = (release?.teamIds ?? []).filter((id) => fbsIndex.has(id));
  const inRanking = new Set(ranked);
  const order = [...ranked, ...byScore.map((k) => fbsIds[k]).filter((id) => !inRanking.has(id))];
  // Each team takes the score the stand-in gives that place, so the gaps between places stay the model's.
  const offset = new Float64Array(F);
  order.forEach((id, p) => {
    const k = fbsIndex.get(id)!;
    offset[k] = score[byScore[p]] - score[k];
  });
  return { release, fbsIds, offset, order, counts, seen, home };
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
   * Picked conference champions. Each gets the power-conference champion's credit (if its conference is one) and,
   * when its title game isn't in the data with a result, a win.
   */
  champions?: readonly number[];
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
 * The committee's latest ranking, moved by the results since it came out: the real ones and any picked ones. Games
 * with neither move nothing. Teams the committee didn't rank are placed below its ranked ones by the stand-in.
 */
export function liveRanking(season: Season, opts: LiveRankingOptions = {}): LiveRanking {
  const m = liveModel(season);
  const locks = opts.locks ?? {};
  const byId = new Map(season.teams.map((t) => [t.id, t]));
  const fbsIndex = new Map(m.fbsIds.map((id, k) => [id, k]));
  const F = m.fbsIds.length;
  const games = season.games;
  // Each counted game's winner, when it has one: its real result, else a pick.
  const winners = games.map((g, i) => {
    if (!m.counts[i]) return null;
    if (g.completed) return g.homePoints! > g.awayPoints! ? g.homeId : g.awayId;
    const pick = locks[g.id];
    return pick === g.homeId || pick === g.awayId ? pick : null;
  });

  const wins = new Float64Array(F);
  const losses = new Float64Array(F);
  const moved = new Map<number, number>();
  const oppSum = new Float64Array(F);
  const oppCount = new Float64Array(F);
  const opponents: number[][] = m.fbsIds.map(() => []);
  games.forEach((g, i) => {
    if (!m.counts[i]) return;
    const h = fbsIndex.get(g.homeId) ?? -1;
    const a = fbsIndex.get(g.awayId) ?? -1;
    if (h >= 0) { oppSum[h] += teamRating(byId.get(g.awayId)); oppCount[h]++; opponents[h].push(g.awayId); }
    if (a >= 0) { oppSum[a] += teamRating(byId.get(g.homeId)); oppCount[a]++; opponents[a].push(g.homeId); }
    const won = winners[i];
    if (won === null) return;
    const [w, l] = won === g.homeId ? [h, a] : [a, h];
    if (w >= 0) wins[w]++;
    if (l >= 0) losses[l]++;
    if (m.seen[i]) return;
    const pts = resultPoints(m.home[i], won === g.homeId);
    const lost = won === g.homeId ? g.awayId : g.homeId;
    moved.set(won, (moved.get(won) ?? 0) + pts);
    moved.set(lost, (moved.get(lost) ?? 0) - pts);
  });

  const champions = new Set(powerChampions(season, (i) => winners[i] !== null, (g) => winners[games.indexOf(g)]!));
  const power = new Set(powerConferences(season.year));
  for (const id of opts.champions ?? []) {
    const k = fbsIndex.get(id);
    const conference = byId.get(id)?.conference;
    if (k === undefined || !conference) continue;
    if (power.has(conference)) champions.add(id);
    const i = titleGameIndex(season, new Set(season.teams.filter((t) => t.conference === conference).map((t) => t.id)));
    if (i < 0 || winners[i] === null) wins[k]++;
  }

  const anchorPlace = new Map(m.order.map((id, p) => [id, p]));
  const score = Float64Array.from(m.fbsIds, (id, k) => {
    const oppMoved = opponents[k].reduce((s, o) => s + (moved.get(o) ?? 0), 0);
    return m.offset[k] + W.wins * wins[k] + W.losses * losses[k] + W.rating * (teamRating(byId.get(id)) + (moved.get(id) ?? 0)) +
      W.strength * (oppCount[k] === 0 ? 0 : (oppSum[k] + oppMoved) / oppCount[k]) + W.champion * (champions.has(id) ? 1 : 0);
  });
  const sorted = m.fbsIds.map((_, k) => k)
    // Scores within rounding of each other are a tie (the offsets are sums of floats), which the anchor's order breaks.
    .sort((x, y) => (Math.abs(score[y] - score[x]) > 1e-9 ? score[y] - score[x] : anchorPlace.get(m.fbsIds[x])! - anchorPlace.get(m.fbsIds[y])!));
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
