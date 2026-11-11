// Live ranking: the College Football Playoff committee's latest ranking, moved only by results since it came out.
//
// Each team starts from an anchored score: the committee stand-in's score (committee.ts) at the place the latest
// ranking put it (its top 25 in the committee's order, every other team below in the stand-in's order), so with no
// new results the order is the committee's. Results since then move it, by weights fitted on how the committee's
// rankings moved from one release to any later one in 2014-2025 (scripts/fit-movement.ts):
// - each win and loss, a win by a Group of Six team counting for less (the committee rarely lifts them far);
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

/** How surprising a result was: the chance the loser had. Added to the winner's surprise, taken off the loser's. */
export const resultPoints = (homeChance: number, homeWon: boolean): number => (homeWon ? 1 - homeChance : homeChance);

/** The moved score, past the anchor: new wins and losses, surprise, and a new power-conference title. */
export const movedScore = (m: LiveModel, k: number, newWins: number, newLosses: number, surprise: number, champion: boolean): number =>
  m.anchor[k] + M.wins * newWins + M.losses * newLosses + M.g6Wins * m.g6[k] * newWins + M.upset * surprise +
  (champion && !m.seenChampion[k] ? M.champion : 0);

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
  // Each team takes the score the stand-in gives that place, so the gaps between places stay the model's.
  const anchor = new Float64Array(F);
  order.forEach((id, p) => { anchor[fbsIndex.get(id)!] = M.anchor * score[byScore[p]]; });
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
  const surprise = new Float64Array(F);
  games.forEach((g, i) => {
    const won = winners[i];
    if (won === null || m.seen[i]) return;
    const w = fbsIndex.get(won) ?? -1;
    const l = fbsIndex.get(won === g.homeId ? g.awayId : g.homeId) ?? -1;
    const pts = resultPoints(m.home[i], won === g.homeId);
    if (w >= 0) { wins[w]++; surprise[w] += pts; }
    if (l >= 0) { losses[l]++; surprise[l] -= pts; }
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
  const score = Float64Array.from(m.fbsIds, (id, k) => movedScore(m, k, wins[k], losses[k], surprise[k], champions.has(id)));
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
