// Committee stand-in: a ranking of FBS teams meant to order them the way the College Football Playoff selection
// committee does. A modelled ranking, not the committee's: a linear score on record, rating, strength of schedule
// and a power-conference title, with weights fitted to past committee rankings (scripts/fit-committee.ts, on the
// fixtures scripts/fetch-cfp.ts makes). Higher scores rank higher.
import { COMMITTEE_WEIGHTS } from "./committee-weights";
import { findTitleGame, type Game, type Season, type Team } from "./season";

/** What the score weighs. `champion` is 1 for a power-conference champion, else 0. */
export type CommitteeFeatures = {
  wins: number;
  losses: number;
  /** The team's rating (SP+, points per game above average). */
  rating: number;
  /** Strength of schedule: the average rating of the opponents it played. */
  strength: number;
  champion: number;
};

export type CommitteeWeights = CommitteeFeatures;

export type CommitteeTeam = Omit<CommitteeFeatures, "champion"> & {
  teamId: number;
  /** 1 is best. */
  rank: number;
  score: number;
  champion: boolean;
};

export type CommitteeOptions = {
  /** Count only games of this week or earlier (a ranking released during the season). Default: every completed game. */
  throughWeek?: number;
  /**
   * The power-conference champions. Default: the winner of each power conference's title game, when it has been
   * played (and is within `throughWeek`). Conferences without a title game (the Big 12 in 2014-2016) get none.
   */
  champions?: readonly number[];
};

/**
 * The conferences whose champions get the stand-in's champion weight: the power conferences of that season (the
 * Pac-12 until it lost all but two members after 2023). Group of Six champions are ranked on record, rating and
 * schedule alone: the weight was fitted to power-conference titles.
 */
export const powerConferences = (year: number): readonly string[] =>
  year <= 2023 ? ["ACC", "Big 12", "Big Ten", "Pac-12", "SEC"] : ["ACC", "Big 12", "Big Ten", "SEC"];

/** Missing ratings, as the simulation counts them: 0 for FBS teams, -10 below FBS. */
export const teamRating = (t: Team | undefined): number => t?.rating ?? (t?.classification === "fbs" ? 0 : -10);

export const committeeScore = (f: CommitteeFeatures, w: CommitteeWeights = COMMITTEE_WEIGHTS): number =>
  w.wins * f.wins + w.losses * f.losses + w.rating * f.rating + w.strength * f.strength + w.champion * f.champion;

/**
 * The conference's title game in the data, as an index into `season.games`, or -1: the game `seasonFromCfbd` marked
 * (`Game.titleGame`), or, in a season built some other way with none marked, the one `findTitleGame` finds.
 */
export function titleGameIndex(season: Season, ids: ReadonlySet<number>): number {
  const marked = season.games.findIndex((g) => g.titleGame === true && ids.has(g.homeId) && ids.has(g.awayId));
  if (marked >= 0) return marked;
  if (season.games.some((g) => g.titleGame === true)) return -1;
  return findTitleGame(season.year, new Map(season.teams.map((t) => [t.id, t])), season.games, ids);
}

const winnerOf = (g: Game): number => (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId);

/**
 * Every FBS team in the stand-in's order, best first, from completed games (through `throughWeek` if given).
 * Ties in score go to the lower team id, so the order is unique.
 */
export function committeeRanking(season: Season, opts: CommitteeOptions = {}): CommitteeTeam[] {
  const through = opts.throughWeek ?? Infinity;
  const played = season.games.filter((g) => g.completed && g.week <= through);
  const byId = new Map(season.teams.map((t) => [t.id, t]));
  const champions = new Set(opts.champions ?? powerConferences(season.year).flatMap((c) => {
    const ids = new Set(season.teams.filter((t) => t.conference === c).map((t) => t.id));
    const i = titleGameIndex(season, ids);
    const g = i < 0 ? null : season.games[i];
    return g && g.completed && g.week <= through ? [winnerOf(g)] : [];
  }));

  const rows = season.teams.filter((t) => t.classification === "fbs").map((t) => {
    let wins = 0;
    let losses = 0;
    let opp = 0;
    for (const g of played) {
      if (g.homeId !== t.id && g.awayId !== t.id) continue;
      if (winnerOf(g) === t.id) wins++;
      else losses++;
      opp += teamRating(byId.get(g.homeId === t.id ? g.awayId : g.homeId));
    }
    const f: CommitteeFeatures = {
      wins, losses, rating: teamRating(t), strength: wins + losses === 0 ? 0 : opp / (wins + losses), champion: champions.has(t.id) ? 1 : 0,
    };
    return { teamId: t.id, f, score: committeeScore(f) };
  });
  rows.sort((a, b) => b.score - a.score || a.teamId - b.teamId);
  return rows.map(({ teamId, f, score }, k) => ({ teamId, rank: k + 1, score, ...f, champion: f.champion === 1 }));
}
