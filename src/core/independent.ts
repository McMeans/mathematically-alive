// FBS independents (Notre Dame, UConn): no conference, so no title game. What a page shows for one is its playoff
// odds from the national simulation and its own remaining games, each with the odds as if it were picked either way.
import type { NationalPlayoff, NationalResult } from "./national";
import { simulateNational } from "./national";
import { nationalConferences, nationalReady } from "./outlook";
import { BARRED, formatOdds, formatSideOdds } from "./paths";
import { findFormat } from "./playoff";
import { INDEPENDENTS, teamRecord, type Game, type Season, type TeamRecord } from "./season";
import { gameWinProbability, simulateSeason, type SimResult } from "./sim";
import { playoffSignals, type PlayoffSignal } from "./view";

export { INDEPENDENTS };

export type IndependentOptions = {
  iterations: number;
  seed: number;
  /** Forced results: game id -> id of the team that wins it. */
  locks?: Record<number, number>;
  /** An independent whose own unplayed games get odds as if each were picked either way (`IndependentOutlook.games`). */
  teamId?: number;
  /** An earlier national run to copy untouched title races from (`NationalOptions.reuse`). */
  reuse?: NationalResult;
};

export type IndependentOutlook = {
  teamId: number;
  /** Record so far, counting locked results as played. */
  record: TeamRecord;
  expectedWins: number;
  /** Share of simulated seasons it makes the playoff field. */
  playoff: number;
  /** Its full playoff odds: field, bye, seeds, rounds, national title. */
  cfp: NationalPlayoff;
  /** How it gets in, in a sentence without its period; once the field is announced, its seed and playoff so far (`PlayoffRun.text`). */
  route: string;
  /** Barred from the postseason this season (`Team.postseasonBan`). */
  postseasonBan: boolean;
  /**
   * For `IndependentOptions.teamId` only (empty for every other team): each of its unplayed games in schedule order,
   * with its playoff odds if it wins or loses that game (every simulated season replayed with only that game changed).
   */
  games: { gameId: number; playoffIfWin: number; playoffIfLose: number }[];
};

/** One of the team's remaining games, for picking a result. */
export type IndependentGame = {
  gameId: number;
  week: number;
  /** "Nov 14". */
  date: string;
  opponentId: number;
  opponent: string;
  site: "home" | "away" | "neutral";
  /** Playoff odds as if that result were picked, for display ("41%"); what picking it would show. */
  ifWin: string;
  ifLose: string;
  /** "58% to win", from the game itself, so a locked pick still shows it. */
  winChance: string;
  /** A matchup not yet confirmed (`Game.projected`). */
  projected: boolean;
};

export type IndependentExploration = {
  /** Every FBS independent, the team's own odds among them. */
  outlook: IndependentOutlook[];
  /** The team's unplayed games, in schedule order. */
  games: IndependentGame[];
  /** Results elsewhere that clearly move its playoff odds. */
  playoffGames: PlayoffSignal[];
  /** The national run behind the odds: pass it as `reuse` to the next what-if. Not serializable. */
  national: NationalResult;
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const when = (g: Game): string => {
  const d = new Date(g.start);
  return Number.isNaN(d.getTime()) ? `week ${g.week}` : DATE_FORMAT.format(d);
};

/** The season's FBS independents, by name. */
const independents = (season: Season) =>
  season.teams.filter((t) => t.classification === "fbs" && (t.conference === null || t.conference === INDEPENDENTS)).sort((a, b) => a.name.localeCompare(b.name));

/**
 * Every FBS independent's playoff odds. Throws when the season can't run the national simulation (no format, or one
 * that needs every conference's champion). `shared`: a simulation of the same season, iterations, seed and locks.
 */
export function independentOutlook(season: Season, opts: IndependentOptions, shared?: SimResult): { iterations: number; teams: IndependentOutlook[]; national: NationalResult } {
  if (!nationalReady(season)) throw new Error(`No national simulation for ${season.year}, so no playoff odds for independents`);
  const { iterations, seed } = opts;
  const sim = shared ?? simulateSeason(season, { iterations, seed, locks: opts.locks });
  const national = simulateNational(season, {
    iterations, seed, locks: opts.locks, teamId: opts.teamId, reuse: opts.reuse, conferences: nationalConferences(season, null, opts.reuse),
  }, sim);
  const odds = new Map(national.teams.map((t) => [t.teamId, t.playoff!]));
  const autoBid = findFormat(season.year)?.autoBids === "power4G6";
  return {
    iterations: sim.iterations,
    national,
    teams: independents(season).map((t) => ({
      teamId: t.id,
      record: teamRecord(season, t.id, opts.locks),
      expectedWins: sim.teams[t.id].expectedWins,
      playoff: odds.get(t.id)!.field,
      cfp: odds.get(t.id)!,
      route: t.postseasonBan ? BARRED
        : odds.get(t.id)!.run ? odds.get(t.id)!.run!.text
        : autoBid && t.name === "Notre Dame" ? "No conference to win: gets in with a top-12 finish in the final ranking (an automatic bid), else at large"
        : "No conference to win: gets in at large",
      postseasonBan: t.postseasonBan === true,
      games: t.id !== opts.teamId ? [] : national.games.map((x) => ({ gameId: x.gameId, playoffIfWin: x.fieldIfWin, playoffIfLose: x.fieldIfLose })),
    })),
  };
}

/** Everything an independent's page shows, from one shared simulation. Throws for a team that isn't an FBS independent. */
export function exploreIndependent(season: Season, opts: IndependentOptions & { teamId: number }): IndependentExploration {
  const { teamId } = opts;
  if (!independents(season).some((t) => t.id === teamId)) throw new Error(`team ${teamId} is not an FBS independent`);
  const sim = simulateSeason(season, { iterations: opts.iterations, seed: opts.seed, locks: opts.locks });
  const { teams, national } = independentOutlook(season, opts, sim);
  const me = teams.find((t) => t.teamId === teamId)!;
  const ifPicked = new Map(me.games.map((x) => [x.gameId, x]));
  const name = (id: number) => season.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;
  // Never proven either way, so never a flat 0% or 100%, unless it is barred.
  const show = (p: number) => formatSideOdds(p, me.postseasonBan ? "eliminated" : "alive");
  const games = season.games
    .filter((g) => !g.completed && (g.homeId === teamId || g.awayId === teamId))
    .map((g): IndependentGame => {
      const home = g.homeId === teamId;
      const opp = home ? g.awayId : g.homeId;
      const f = ifPicked.get(g.id)!;
      const pHome = gameWinProbability(season, g);
      return {
        gameId: g.id, week: g.week, date: when(g), opponentId: opp, opponent: name(opp),
        site: g.neutralSite ? "neutral" : home ? "home" : "away",
        ifWin: show(f.playoffIfWin), ifLose: show(f.playoffIfLose),
        winChance: `${formatOdds(home ? pHome : 1 - pHome)} to win`,
        projected: g.projected === true,
      };
    });
  return { outlook: teams, games, playoffGames: playoffSignals(season, sim, national, teamId), national };
}
