// National simulation, stages 2 to 5 (docs/plan-national.md, phase 4), one pass per simulated season on top of
// the regular season that simulateSeason plays out (stage 1):
// 2. Conference title games: each simulated conference's rules (rules.ts) pick its two teams, and the game is
//    played at a neutral site with the season's simulated ratings, or taken from the data once it is scheduled.
// 3. Committee stand-in ranking (committee.ts) of every FBS team, from the season's simulated record, rating and
//    schedule, the title games included, with each team's score drawn once per season around the fitted model.
// 4. Playoff field (playoff.ts): the season's format picks and seeds the field from that ranking and the champions.
// 5. Bracket: each game at the season's simulated ratings, home field for the higher seed where the format gives it.
// Every draw comes from a stream hashed from (seed, iteration, conference, team or bracket game), so a lock changes only its own
// game's draw and what-if runs stay paired with the base run.
import { COMMITTEE_WEIGHTS as W } from "./committee-weights";
import { powerConferences, teamRating, titleGameIndex, type CommitteeFeatures } from "./committee";
import { announcedField, bracketGames, championsNeeded, fieldPicker, findFormat, playoffRun, type AnnouncedField, type PlayoffRun } from "./playoff";
import { holdCeilings, liveModel, movedScore, resultPoints } from "./live";
import { isArmyNavy, type Game, type Season } from "./season";
import { HOME_FIELD } from "./odds";
import { COMMITTEE_SALT, PLAYOFF_SALT, mix, naturalResults, neutralOdds, seasonDraws, simulateSeason, tiebreakDraw, titleRoll, type IterationTeams, type NaturalResults, type SimResult } from "./sim";
import { pairKey } from "./steps";
import { championshipFromData, conferenceData, type ConferenceData } from "./tiebreak";

export type NationalOptions = {
  iterations: number;
  seed: number;
  /** Forced results: game id -> id of the team that wins it. */
  locks?: Record<number, number>;
  /**
   * Forced title-game winners: conference -> the team that wins its title game, in the seasons that team plays in it.
   * A title game already final in the data keeps its real result. Each conference must be simulated, each team a member.
   */
  titleLocks?: Record<string, number>;
  /**
   * Forced playoff winners: bracket game index (`NationalView.bracket`) -> the team that wins it, in the seasons that
   * team plays in it. A playoff game already final keeps its real result.
   */
  bracketLocks?: Record<number, number>;
  /** Conferences whose title games are simulated. Each needs tiebreak rules for the season. */
  conferences: readonly string[];
  /**
   * A team whose own unplayed games get playoff-field odds as if each were picked either way (`NationalResult.games`).
   * Each is the base season replayed with only that game's result changed, so it matches what locking it shows.
   */
  teamId?: number;
  /**
   * An earlier run of the same season, seed and iterations, with any locks. Title races it simulated that no lock
   * differing between the two runs touches (a differing locked game's teams aren't in them) are copied from it
   * instead of played again: the same draws give the same games. When nothing differs and no `teamId` is asked for,
   * the earlier run itself comes back. Seasons in which every lock that differs comes out the way the earlier run
   * played it (the same draws give the same season) are copied whole. Anything else is ignored.
   */
  reuse?: NationalResult;
  /**
   * With `reuse` (a run of the same season, seed, iterations and conferences, in the same order) and only locks added
   * to its own: simulate nothing, and give the odds over its seasons in which each added lock's result came out that
   * way on its own (the same seasons the full run plays there). Each is weighed by 1 over the chance its added results
   * had, given the season's rating shifts, so the seasons kept count as the full run's do and the picked teams' odds
   * aren't tilted toward the seasons they were strong. It counts the first 8,000 such seasons at most, so it stays
   * quick. `iterations` is how many seasons it counts, and
   * `forEachIteration` replays them, unweighted, under their own iteration numbers. Without such a run, with a lock it
   * had that this one changes or drops, with no season kept, or with a `teamId` it didn't follow, the run is
   * simulated in full.
   */
  estimate?: boolean;
};

export type NationalTeam = {
  teamId: number;
  conference: string | null;
  /** Share of seasons it plays in its conference's title game; null when that game isn't simulated. */
  titleGame: number | null;
  /** Share of seasons it wins its conference's title game; null when that game isn't simulated. */
  champion: number | null;
  /** Its average place in the committee stand-in ranking (1 is best). */
  meanRank: number;
  /** Shares of seasons it finishes in the stand-in's top 4, top 12 and top 25. */
  top4: number;
  top12: number;
  top25: number;
  /** Its playoff odds; null when the playoff isn't simulated (see NationalResult.playoff). */
  playoff: NationalPlayoff | null;
  /**
   * What the stand-in ranked it on, averaged over the simulated seasons: wins and losses (title game included),
   * rating, strength of schedule, and `champion`, the share of seasons it is a power-conference champion.
   */
  profile: CommitteeFeatures;
};

/** One team's playoff odds: shares of simulated seasons. */
export type NationalPlayoff = {
  /** In the field. */
  field: number;
  /** A first-round bye (seeds 1-4 of a 12-team field). */
  bye: number;
  /** seeds[s - 1]: the share of seasons it is seed s. */
  seeds: number[];
  /** Plays in a quarterfinal (a bye or a first-round win); null in a four-team format. */
  quarterfinal: number | null;
  semifinal: number;
  final: number;
  /** Wins the national title. */
  champion: number;
  /** Once the committee has announced the field (`announcedField`): its seed and its playoff so far. Null before. */
  run: PlayoffRun | null;
};

/** One simulated season after stages 2 and 3. Valid only during the forEachIteration callback. */
export type NationalSeason = {
  /** The conference's title-game teams, [seed 1, seed 2]. */
  titleGame(conference: string): readonly [number, number];
  champion(conference: string): number;
  /** Every FBS team, the stand-in's order, best first. */
  ranking: readonly number[];
  /** The playoff field, seed 1 first; null when the playoff isn't simulated. */
  field: readonly number[] | null;
  /** The national champion; null when the playoff isn't simulated. */
  playoffChampion: number | null;
};

export type NationalResult = {
  iterations: number;
  conferences: readonly string[];
  /**
   * Whether stages 4 and 5 ran. They need the champions the season's format uses: none in a four-team season, the
   * power conferences' from 2026 (all of them must be in `conferences`). The 2024-2025 formats need every
   * conference's champion, and Group of Six title games aren't simulated, so those seasons get no playoff; nor does
   * a season with no format.
   */
  playoff: boolean;
  /**
   * The field the committee announced, once the data has it (`announcedField`): every simulated season uses it, and
   * the playoff games already final decide their games in the bracket. Null before (the field is simulated), and
   * when the playoff isn't simulated.
   */
  announced: AnnouncedField | null;
  /** Every FBS team, the stand-in's average order (best mean rank first). */
  teams: NationalTeam[];
  /**
   * For `NationalOptions.teamId` only (empty otherwise, or with no playoff): each of its unplayed games in schedule
   * order, with its shares of seasons in the playoff field and (null when its conference's title game isn't
   * simulated) in that title game if it wins or loses that game.
   */
  games: { gameId: number; fieldIfWin: number; fieldIfLose: number; titleIfWin: number | null; titleIfLose: number | null }[];
  /**
   * Each regular-season game still to play (with no playoff, none), in schedule data order: `home`, the share of
   * seasons the home team wins it, and `spots`, how many places in the field differ on average between the seasons
   * it wins and the seasons it loses (half the summed change in every team's field odds, each less the change
   * sampling alone would show). 0 for a game one side always wins (a locked game).
   */
  swings: { gameId: number; home: number; spots: number }[];
  /**
   * Replay every simulated season's title games and ranking. `iteration` is the season's number in the run, 0 to
   * the run's size less 1 (an estimate's seasons keep the numbers they had in the run they came from).
   */
  forEachIteration(cb: (iteration: number, season: NationalSeason) => void): void;
};

/** Most seasons an estimate counts: the first ones kept (any seasons are a fair sample), so it stays quick. */
const ESTIMATE_SEASONS = 8000;

/**
 * What a later run needs to reuse a run's seasons (NationalOptions.reuse): per season, the title games ([seed 1,
 * seed 2, champion] per race) and each one's natural champion (as if no title game were locked), the ranking, the
 * field, the bracket's winners and each one's natural winner (as if no playoff game were locked), the focus team's
 * games the other way (bit 0: in the field, bit 1: in the title game), and every game's natural result.
 */
type Reusable = {
  season: Season; seed: number; iterations: number; conferences: readonly string[]; locks: Record<number, number>;
  titleLocks: Record<string, number>; bracketLocks: Record<number, number>; titles: Int32Array; rankings: Uint16Array; focus: boolean;
  focusId: number | null; natTitle: Int32Array; fields: Int32Array; slots: Int32Array; natSlots: Int32Array; champs: Int32Array;
  own: Uint8Array; ownGames: number[]; natural: NaturalResults };
const reusable = new WeakMap<NationalResult, Reusable>();

/** Whether an earlier run is this one: same season, seed, iterations, conferences (any order) and locks, and no focus team. */
function sameRun(season: Season, opts: NationalOptions, conferences: readonly string[], r: Reusable | undefined): boolean {
  if (!r || r.season !== season || r.seed !== opts.seed || r.iterations !== opts.iterations || r.focus) return false;
  if ([...r.conferences].sort().join() !== [...conferences].sort().join()) return false;
  return sameKeys(opts.locks ?? {}, r.locks) && sameKeys(opts.titleLocks ?? {}, r.titleLocks) && sameKeys(opts.bracketLocks ?? {}, r.bracketLocks);
}

/** Whether two lock maps force the same results. */
const sameKeys = (x: Record<string | number, number>, y: Record<string | number, number>): boolean =>
  [...new Set([...Object.keys(x), ...Object.keys(y)])].every((k) => x[k] === y[k]);

/** Per race, where to copy the earlier run's title games from (its titles at (iteration * stride + at) * 3), or null to play them. */
function reusedTitles(season: Season, opts: NationalOptions, n: number, races: TitleRace[]): ({ titles: Int32Array; natTitle: Int32Array; stride: number; at: number } | null)[] {
  const r = opts.reuse && reusable.get(opts.reuse);
  const locks = opts.locks ?? {};
  if (!r || r.season !== season || r.seed !== opts.seed || r.iterations !== n) return races.map(() => null);
  const touched = new Set<number>();
  const byId = new Map(season.games.map((g) => [g.id, g]));
  for (const id of new Set([...Object.keys(locks), ...Object.keys(r.locks)].map(Number))) {
    if (locks[id] === r.locks[id]) continue;
    // simulateSeason has already rejected a lock on a game the season doesn't have.
    const g = byId.get(id)!;
    touched.add(g.homeId);
    touched.add(g.awayId);
  }
  const titleLocks = opts.titleLocks ?? {};
  return races.map((race) => {
    const at = r.conferences.indexOf(race.conference);
    return at < 0 || titleLocks[race.conference] !== r.titleLocks[race.conference] || [...touched].some((id) => race.data.ids.has(id)) ? null : { titles: r.titles, natTitle: r.natTitle, stride: r.conferences.length, at };
  });
}

/** One conference's title race, set up once per simulation. Not part of the public API. */
export type TitleRace = {
  conference: string;
  data: ConferenceData;
  /** The title game in `season.games`, once the data has it, else null. */
  game: Game | null;
  odds: (a: number, b: number, shiftA: number, shiftB: number) => number;
};

/** Not part of the public API. Throws for a conference with no tiebreak rules for the season. */
export function titleRace(season: Season, conference: string): TitleRace {
  const data = conferenceData(season, conference);
  const i = titleGameIndex(season, data.ids);
  return { conference, data, game: i < 0 ? null : season.games[i], odds: neutralOdds(season) };
}

/** The data's title game, when it is between `a` and `b` (the teams the rules picked). */
const gameBetween = (race: TitleRace, a: number, b: number): Game | null => {
  const g = race.game;
  return g && ((g.homeId === a && g.awayId === b) || (g.homeId === b && g.awayId === a)) ? g : null;
};

/**
 * Stage 2 for one conference in one simulated season: [seed 1, seed 2, champion]. The rules pick the teams. When
 * the data has the title game between those two and it is final, its result decides. Otherwise a forced winner
 * (`locked`) in the game wins it; then the data's game (locked or simulated) decides, or else a neutral-site game at
 * the season's simulated ratings. Not part of the public API.
 */
export function playTitleGame(
  race: TitleRace,
  seed: number,
  iteration: number,
  winnerOf: (game: Game) => number,
  rank: (teamId: number) => number,
  shift: (teamId: number) => number,
  locked?: number,
): [number, number, number] {
  const [a, b] = championshipFromData(race.data, winnerOf, { draw: tiebreakDraw(seed, iteration, race.conference), rank });
  const g = gameBetween(race, a, b);
  if (g?.completed) return [a, b, winnerOf(g)];
  if (locked === a || locked === b) return [a, b, locked];
  if (g) return [a, b, winnerOf(g)];
  return [a, b, titleRoll(seed, iteration, race.conference) < race.odds(a, b, shift(a), shift(b)) ? a : b];
}

/** The title game between `a` and `b` as if no title game were locked: the data's game, or the season's roll. */
const naturalTitle = (race: TitleRace, seed: number, iteration: number, a: number, b: number, winnerOf: (game: Game) => number, shift: (teamId: number) => number): number => {
  const g = gameBetween(race, a, b);
  if (g) return winnerOf(g);
  return titleRoll(seed, iteration, race.conference) < race.odds(a, b, shift(a), shift(b)) ? a : b;
};

/** Simulate the season, every listed conference's title game, and the committee stand-in ranking. */
export function simulateNational(season: Season, opts: NationalOptions, shared?: SimResult): NationalResult {
  const { iterations, seed } = opts;
  const conferences = [...new Set(opts.conferences)];
  // Nothing differs from the earlier run (no focus team asked for): it is this run.
  if (opts.reuse && opts.teamId === undefined && sameRun(season, opts, conferences, reusable.get(opts.reuse))) return opts.reuse;
  const races = conferences.map((c) => titleRace(season, c));
  const titleLocks = opts.titleLocks ?? {};
  for (const [c, id] of Object.entries(titleLocks)) {
    const race = races.find((r) => r.conference === c);
    if (!race) throw new Error(`${c}'s title game isn't simulated, so it can't be locked`);
    if (!race.data.ids.has(id)) throw new Error(`team ${id} is not in ${c}`);
  }
  const bracketLocks = opts.bracketLocks ?? {};
  const locks = opts.locks ?? {};
  const n = shared?.iterations ?? iterations;
  const C = races.length;
  const power = new Set(powerConferences(season.year));
  const format = findFormat(season.year);
  const needs = format ? championsNeeded(format) : "all";
  const playoff = needs === "none" || (needs === "power" && [...power].every((c) => conferences.includes(c)));
  const announced = playoff ? announcedField(season) : null;
  const pick = !playoff ? () => [] : announced ? () => announced.seeds : fieldPicker(season);
  // Playoff games already final, by their two teams: they decide their games in the bracket.
  const finals = new Map((announced ? season.playoffGames ?? [] : []).filter((g) => g.completed).map((g) => [pairKey(g.homeId, g.awayId), g]));
  const T = format?.teams ?? 12;
  const bracket = bracketGames(T);
  const B = bracket.length;
  for (const k of Object.keys(bracketLocks)) {
    const g = Number(k);
    if (!Number.isInteger(g) || g < 0 || g >= B) throw new Error(`bracket game ${k} doesn't exist`);
  }
  const odds = neutralOdds(season);

  const byId = new Map(season.teams.map((t) => [t.id, t]));
  const fbs = season.teams.filter((t) => t.classification === "fbs");
  const F = fbs.length;
  const fbsIds = Int32Array.from(fbs, (t) => t.id);
  const fbsIndex = new Map<number, number>(fbs.map((t, k) => [t.id, k]));
  const idx = (id: number): number => fbsIndex.get(id) ?? -1;
  const games = season.games;
  const gameIndex = new Map<number, number>(games.map((g, i) => [g.id, i]));
  // The focus team's unplayed games (season.games indexes), with field counts by its result: [win, lose].
  const focus = opts.teamId !== undefined && fbsIndex.has(opts.teamId) && playoff ? opts.teamId : null;
  const own = focus === null ? [] : games.flatMap((g, i) =>
    !g.completed && (g.homeId === focus || g.awayId === focus) ? [{ i, field: [0, 0], title: [0, 0] }] : []);

  // The earlier run, when its seasons line up with this run's: same season, seed, size and conferences in order.
  const prior = opts.reuse ? reusable.get(opts.reuse) : undefined;
  const basis = prior && prior.season === season && prior.seed === seed && prior.iterations === n && prior.conferences.join() === conferences.join() ? prior : undefined;
  // Its focus team's games the other way can be copied too when it followed the same team.
  const ownKept = basis !== undefined && basis.focusId === focus && basis.ownGames.join() === own.map((o) => o.i).join();
  const lockSide = (id: number, l: Record<number, number>): number => {
    const i = gameIndex.get(id);
    if (i === undefined) throw new Error(`lock for unknown game ${id}`);
    return l[id] === undefined ? -1 : l[id] === games[i].homeId ? 1 : 0;
  };
  // Which of the earlier run's seasons this run plays the same: every lock that differs comes out the way it went there.
  const kept = new Uint8Array(basis ? n : 0);
  let keptCount = 0;
  // Whether every lock that differs is new here (the earlier run left those results free): only then can an estimate
  // weigh the seasons it keeps back to what the full run plays (`weightOf`).
  let onlyAdded = false;
  let weightOf: (it: number) => number = () => 1;
  if (basis) {
    const nat = basis.natural;
    const changed = [...new Set([...Object.keys(locks), ...Object.keys(basis.locks)].map(Number))]
      .filter((id) => locks[id] !== basis.locks[id])
      .map((id) => ({ i: gameIndex.get(id) ?? -1, now: lockSide(id, locks), was: lockSide(id, basis.locks) }));
    const titled = races.flatMap((r, c) => (titleLocks[r.conference] !== basis.titleLocks[r.conference] ? [{ c, race: r, lock: titleLocks[r.conference] }] : []));
    const bracketed = [...new Set([...Object.keys(bracketLocks), ...Object.keys(basis.bracketLocks)].map(Number))]
      .filter((g) => bracketLocks[g] !== basis.bracketLocks[g]).sort((x, y) => x - y);
    onlyAdded = changed.every((c) => c.was < 0) && titled.every(({ race }) => basis.titleLocks[race.conference] === undefined)
      && bracketed.every((g) => basis.bracketLocks[g] === undefined);
    // A kept season is one where each new lock's result came out that way on its own: likelier in seasons whose
    // rating shifts favoured it. Weighing each by 1 over that chance (given the season's shifts) puts the seasons kept
    // back in the proportions every season has, which the full run plays, the lock forced.
    const draws = seasonDraws(season, seed);
    weightOf = (it) => {
      let chance = 1;
      for (const { i, now } of changed) {
        const home = draws.homeChance(it, i);
        chance *= now === 1 ? home : 1 - home;
      }
      for (const { c, race, lock } of titled) {
        const at = (it * C + c) * 3;
        const [a, b] = [basis.titles[at], basis.titles[at + 1]];
        if (lock !== a && lock !== b) continue;
        const g = gameBetween(race, a, b);
        if (g?.completed) continue;
        const gi = g ? gameIndex.get(g.id)! : -1;
        // A title game in the data plays as a game: its own lock, if any, settles it.
        if (g && locks[g.id] !== undefined) continue;
        const other = lock === a ? b : a;
        chance *= g ? (lock === g.homeId ? draws.homeChance(it, gi) : 1 - draws.homeChance(it, gi)) : race.odds(lock, other, draws.shift(it, lock), draws.shift(it, other));
      }
      for (const g of bracketed) {
        const [x, y, hosted] = bracket[g];
        const a = x >= 0 ? basis.fields[it * T + x] : basis.slots[it * B + ~x];
        const b = y >= 0 ? basis.fields[it * T + y] : basis.slots[it * B + ~y];
        const lock = bracketLocks[g];
        if (finals.has(pairKey(a, b)) || (lock !== a && lock !== b)) continue;
        const aWins = odds(a, b, draws.shift(it, a), draws.shift(it, b), hosted ? HOME_FIELD : 0);
        chance *= lock === a ? aWins : 1 - aWins;
      }
      return 1 / Math.max(chance, 1e-9);
    };
    for (let it = 0; it < n; it++) {
      let same = true;
      for (const { i, now, was } of changed) {
        const natHome = (nat.bits[it * nat.stride + (i >> 3)] >> (i & 7)) & 1;
        if ((now >= 0 ? now : natHome) !== (was >= 0 ? was : natHome)) { same = false; break; }
      }
      for (let j = 0; same && j < titled.length; j++) {
        const { c, race, lock } = titled[j];
        const at = (it * C + c) * 3;
        const [a, b, ch] = [basis.titles[at], basis.titles[at + 1], basis.titles[at + 2]];
        if (gameBetween(race, a, b)?.completed) continue;
        if ((lock === a || lock === b ? lock : basis.natTitle[it * C + c]) !== ch) same = false;
      }
      if (same && playoff && bracketed.length > 0) {
        const slot = (x: number): number => (x >= 0 ? basis.fields[it * T + x] : basis.slots[it * B + ~x]);
        for (const g of bracketed) {
          const [x, y] = bracket[g];
          const a = slot(x), b = slot(y);
          if (finals.has(pairKey(a, b))) continue;
          const lock = bracketLocks[g];
          if ((lock === a || lock === b ? lock : basis.natSlots[it * B + g]) !== basis.slots[it * B + g]) { same = false; break; }
        }
      }
      if (same) { kept[it] = 1; keptCount++; }
    }
  }
  // An estimate: the earlier run's seasons these locks don't change, with nothing simulated.
  const estimating = opts.estimate === true && basis !== undefined && onlyAdded && keptCount > 0 && (focus === null || ownKept) && shared === undefined;
  if (estimating) for (const id of Object.keys(locks)) if (games[gameIndex.get(Number(id)) ?? 0]?.completed) throw new Error(`game ${id} is already final and can't be locked`);
  const sim = estimating ? null : shared ?? simulateSeason(season, { iterations, seed, locks: opts.locks });
  const natural = sim ? naturalResults(sim)! : basis!.natural;
  // Each game's locked side here (1 home, 0 away), or -1: a season's result is its lock, else its natural one.
  const side = new Int8Array(games.length).fill(-1);
  for (const id of Object.keys(locks)) side[gameIndex.get(Number(id))!] = lockSide(Number(id), locks);

  // Army-Navy is played the week after the field is picked, so it counts in none of the records the stand-in ranks on.
  const name = new Map(season.teams.map((t) => [t.id, t.name]));
  const late = games.map((g) => isArmyNavy(name.get(g.homeId), name.get(g.awayId)));
  const home = Int32Array.from(games, (g, i) => (late[i] ? -1 : idx(g.homeId)));
  const away = Int32Array.from(games, (g, i) => (late[i] ? -1 : idx(g.awayId)));
  const unplayed = Int32Array.from(games.flatMap((g, i) => (g.completed ? [] : [i])));
  const homeOf = Int32Array.from(games, (g) => g.homeId);
  const rating = Float64Array.from(fbs, (t) => teamRating(t));
  // Strength of schedule: opponents' ratings summed over the season's games, and how many.
  const oppSum = new Float64Array(F);
  const oppCount = new Int32Array(F);
  games.forEach((g, i) => {
    const h = home[i];
    const a = away[i];
    if (h >= 0) { oppSum[h] += teamRating(byId.get(g.awayId)); oppCount[h]++; }
    if (a >= 0) { oppSum[a] += teamRating(byId.get(g.homeId)); oppCount[a]++; }
  });
  // Stage 3 starts from the committee's latest ranking when there is one (live.ts): each team's anchored score puts
  // the teams in its order on the results it saw, and results since then move it (`moved` holds each team's surprise,
  // by season.teams index).
  const live = liveModel(season);
  const anchored = live.release !== null;
  const allIndex = new Map<number, number>(season.teams.map((t, j) => [t.id, j]));
  const allOf = Int32Array.from(fbsIds, (id) => allIndex.get(id)!);
  const moved = new Float64Array(season.teams.length);
  const playedBy: number[][] = season.teams.map(() => []);
  games.forEach((g, i) => {
    const h = home[i];
    const a = away[i];
    if (h >= 0) playedBy[allIndex.get(g.awayId)!].push(h);
    if (a >= 0) playedBy[allIndex.get(g.homeId)!].push(a);
  });
  // Games whose results move ratings: every counted game the ranking didn't see.
  const fresh = Int32Array.from(anchored ? games.flatMap((_, i) => (live.counts[i] && !live.seen[i] ? [i] : [])) : []);
  const baseW = new Int32Array(F);
  const baseL = new Int32Array(F);
  games.forEach((g, i) => {
    if (!g.completed) return;
    const homeWon = g.homePoints! > g.awayPoints!;
    const win = homeWon ? home[i] : away[i];
    const lose = homeWon ? away[i] : home[i];
    if (win >= 0) baseW[win]++;
    if (lose >= 0) baseL[lose]++;
  });

  const w = new Int32Array(F);
  const l = new Int32Array(F);
  // Strength of schedule adds the title game to the regular season's (oppSum, oppCount); kept apart so a what-if
  // replay can take a title game back out exactly.
  const titleSos = new Float64Array(F);
  const titleN = new Int32Array(F);
  const champ = new Uint8Array(F);
  const score = new Float64Array(F);
  const order = new Uint16Array(F);
  // Stored per iteration, for forEachIteration and for later runs (Reusable): the ranking (FBS indexes), each race's
  // [seed 1, seed 2, champion] and natural champion, the field, the bracket's winners and natural winners, the
  // champion, and the focus team's games the other way.
  const rankings = new Uint16Array(n * F);
  const titles = new Int32Array(n * C * 3);
  const natTitle = new Int32Array(n * C);
  const copied = estimating ? races.map(() => null) : reusedTitles(season, opts, n, races);
  // The earlier run's ranking, as each season's starting order: nearly sorted already, so the sort is close to linear.
  const startOrder = prior && prior.season === season && prior.iterations === n ? prior.rankings : null;
  const rankSum = new Float64Array(F);
  // The stand-in's features summed over seasons (NationalTeam.profile).
  const winSum = new Float64Array(F);
  const lossSum = new Float64Array(F);
  // Strength of schedule: each team's regular season's, and the seasons' title games' changes to it, summed.
  const regularSos = Float64Array.from(oppSum, (x, k) => (oppCount[k] === 0 ? 0 : x / oppCount[k]));
  const sosMoved = new Float64Array(F);
  const champSum = new Float64Array(F);
  // Regular-season games still to play, for `swings`.
  const open = Int32Array.from([...unplayed].filter((i) => !games[i].titleGame));
  const top = [new Float64Array(F), new Float64Array(F), new Float64Array(F)];
  const cuts = [4, 12, 25];
  const rankIds = new Int32Array(F);
  const fields = new Int32Array(playoff ? n * T : 0);
  const playoffChamps = new Int32Array(playoff ? n : 0);
  const slots = new Int32Array(playoff ? n * B : 0);
  const natSlots = new Int32Array(playoff ? n * B : 0);
  const ownBits = new Uint8Array(n * own.length);
  // Counted in seasons, each weighing `weight` (1, but for an estimate's seasons).
  const seedCount = new Float64Array(F * T);
  const inField = new Float64Array(F);
  const reached = [new Float64Array(F), new Float64Array(F), new Float64Array(F), new Float64Array(F)]; // QF, SF, final, title
  let weight = 1;
  const roundOf = (g: number): number => (g === B - 1 ? 2 : T === 4 || g >= 8 ? 1 : g >= 4 ? 0 : -1);
  const inTitle = new Map<number, number>();
  const won = new Map<number, number>();
  for (const r of races) for (const id of r.data.ids) { inTitle.set(id, 0); won.set(id, 0); }

  const focusRace = focus === null ? -1 : races.findIndex((r) => r.data.ids.has(focus));
  const raceOf = (id: number): number => races.findIndex((r) => r.data.ids.has(id));
  const gumbel = new Float64Array(F);
  // committeeScore, inlined: this runs for every FBS team in every simulated season.
  // The live ranking's score (live.ts) on the season's results, plus the standard Gumbel noise its fit implies.
  const anchoredScore = (k: number): number =>
    movedScore(live, k, w[k] - live.seenWins[k], l[k] - live.seenLosses[k], moved[allOf[k]], champ[k] === 1) + gumbel[k];
  const scoreOf = (k: number, shift: (id: number) => number): number => anchored ? anchoredScore(k) :
    W.wins * w[k] + W.losses * l[k] + W.rating * (rating[k] + shift(fbsIds[k])) +
    W.strength * (oppCount[k] + titleN[k] === 0 ? 0 : (oppSum[k] + titleSos[k]) / (oppCount[k] + titleN[k])) + W.champion * champ[k] + gumbel[k];
  // Insertion sort, best first (ties to the lower team id): about twice as fast as a comparator sort at this size,
  // and close to linear when `ord` starts nearly sorted (a what-if replay starts from the season's order).
  const sortBy = (ord: Uint16Array, sc: Float64Array) => {
    for (let i = 1; i < F; i++) {
      const v = ord[i];
      const sv = sc[v];
      let j = i - 1;
      while (j >= 0 && (sc[ord[j]] < sv || (sc[ord[j]] === sv && fbsIds[ord[j]] > fbsIds[v]))) {
        ord[j + 1] = ord[j];
        j--;
      }
      ord[j + 1] = v;
    }
  };
  /** Credits a title game ([a, b, champion] of race c) to the season's records, strength of schedule and champion flags. */
  const creditTitle = (c: number, a: number, b: number, ch: number, sign = 1) => {
    const race = races[c];
    const ci = idx(ch);
    const li = idx(ch === a ? b : a);
    if (ci >= 0 && power.has(race.conference)) champ[ci] = sign > 0 ? 1 : 0;
    // A title game already in the data was counted with the season's games.
    if (gameBetween(race, a, b)) return;
    if (ci >= 0) { w[ci] += sign; titleSos[ci] += sign * teamRating(byId.get(ch === a ? b : a)); titleN[ci] += sign; }
    if (li >= 0) { l[li] += sign; titleSos[li] += sign * teamRating(byId.get(ch)); titleN[li] += sign; }
  };
  const uncredit = (c: number, a: number, b: number, ch: number) => creditTitle(c, a, b, ch, -1);
  const fscore = new Float64Array(F);
  const forder = new Uint16Array(F);
  const fIds = new Int32Array(F);
  const field: number[] = new Array<number>(playoff ? T : 0);

  /**
   * One season: played (`copy` false), or copied from the earlier run (`basis`), which played it the same; then
   * counted. `homeWins` says whether game i (into `season.games`) went to its home team. `teams` is null only for an
   * estimate, which copies every season it counts and never scores.
   */
  const season1 = (it: number, homeWins: (gameIndex: number) => boolean, winnerAt: (gameIndex: number) => number, teams: IterationTeams | null, copy: boolean) => {
    const winnerOf = (g: Game): number => winnerAt(gameIndex.get(g.id)!);
    w.set(baseW);
    l.set(baseL);
    for (let j = 0; j < unplayed.length; j++) {
      const i = unplayed[j];
      const h = homeWins(i);
      const win = h ? home[i] : away[i];
      const lose = h ? away[i] : home[i];
      if (win >= 0) w[win]++;
      if (lose >= 0) l[lose]++;
    }
    titleSos.fill(0);
    titleN.fill(0);
    champ.fill(0);
    // A copied season is scored only when the focus team's games the other way must be played again.
    const scoring = !copy || (own.length > 0 && !ownKept);
    if (anchored && scoring) {
      moved.fill(0);
      for (let j = 0; j < fresh.length; j++) {
        const i = fresh[j];
        const g = games[i];
        const h = homeWins(i);
        const pts = resultPoints(live.home[i], h);
        moved[allIndex.get(h ? g.homeId : g.awayId)!] += pts;
        moved[allIndex.get(h ? g.awayId : g.homeId)!] -= pts;
      }
    }

    // Stage 2.
    for (let c = 0; c < C; c++) {
      let a: number, b: number, ch: number, nat: number;
      if (copy) {
        const at = (it * C + c) * 3;
        [a, b, ch] = [basis!.titles[at], basis!.titles[at + 1], basis!.titles[at + 2]];
        nat = basis!.natTitle[it * C + c];
      } else {
        const from = copied[c];
        if (from) {
          const at = (it * from.stride + from.at) * 3;
          [a, b, ch] = [from.titles[at], from.titles[at + 1], from.titles[at + 2]];
          nat = from.natTitle[it * from.stride + from.at];
        } else {
          [a, b, ch] = playTitleGame(races[c], seed, it, winnerOf, teams!.rank, teams!.shift, titleLocks[races[c].conference]);
          nat = naturalTitle(races[c], seed, it, a, b, winnerOf, teams!.shift);
        }
      }
      titles[(it * C + c) * 3] = a;
      titles[(it * C + c) * 3 + 1] = b;
      titles[(it * C + c) * 3 + 2] = ch;
      natTitle[it * C + c] = nat;
      inTitle.set(a, inTitle.get(a)! + weight);
      inTitle.set(b, inTitle.get(b)! + weight);
      won.set(ch, won.get(ch)! + weight);
      creditTitle(c, a, b, ch);
    }

    // Stage 3: the committee stand-in's score plus standard Gumbel noise, so any two teams are ordered with the
    // pair odds the model was fitted on.
    if (scoring) {
      for (let k = 0; k < F; k++) {
        const u = (mix(seed, it, COMMITTEE_SALT + k) + 0.5) / 4294967296;
        gumbel[k] = -Math.log(-Math.log(u));
        score[k] = scoreOf(k, teams!.shift);
      }
    }
    for (let k = 0; k < F; k++) {
      winSum[k] += w[k] * weight;
      lossSum[k] += l[k] * weight;
      champSum[k] += champ[k] * weight;
    }
    // Strength of schedule moves only for teams in a title game not in the data: the rest add their regular season's.
    for (let c = 0; c < C; c++) {
      const at = (it * C + c) * 3;
      for (let x = 0; x < 2; x++) {
        const k = idx(titles[at + x]);
        if (k >= 0 && titleN[k] > 0) sosMoved[k] += ((oppSum[k] + titleSos[k]) / (oppCount[k] + titleN[k]) - regularSos[k]) * weight;
      }
    }
    if (copy) order.set(basis!.rankings.subarray(it * F, (it + 1) * F));
    else {
      if (startOrder) order.set(startOrder.subarray(it * F, (it + 1) * F));
      else for (let k = 0; k < F; k++) order[k] = k;
      sortBy(order, score);
      holdCeilings(order, (k) => l[k]);
    }
    rankings.set(order, it * F);
    for (let p = 0; p < F; p++) rankSum[order[p]] += (p + 1) * weight;
    for (let q = 0; q < cuts.length; q++) for (let p = 0; p < Math.min(cuts[q], F); p++) top[q][order[p]] += weight;
    if (!playoff) return;

    // Stage 4.
    if (copy) for (let s = 0; s < T; s++) field[s] = basis!.fields[it * T + s];
    else {
      for (let p = 0; p < F; p++) rankIds[p] = fbsIds[order[p]];
      const picked = pick(rankIds, (id) => champ[idx(id)] === 1);
      for (let s = 0; s < T; s++) field[s] = picked[s];
    }
    fields.set(field, it * T);
    field.forEach((id, s) => {
      const k = idx(id);
      seedCount[k * T + s] += weight;
      inField[k] += weight;
      if (T === 12 && s < 4) reached[0][k] += weight;
    });

    // The focus team's games the other way, one at a time, everything else in the season unchanged: stage 2 again
    // only for the title races the game's two teams are in, then stages 3 and 4. Copied when the earlier run
    // followed the same team.
    own.forEach((o, j) => {
      const g = games[o.i];
      const was = homeWins(o.i) ? g.homeId : g.awayId;
      const side = was === focus ? 0 : 1;
      o.field[side] += field.includes(focus!) ? weight : 0;
      if (focusRace >= 0) {
        const at = (it * C + focusRace) * 3;
        o.title[side] += titles[at] === focus || titles[at + 1] === focus ? weight : 0;
      }
      let bits: number;
      if (copy && ownKept) bits = basis!.own[it * own.length + j];
      else {
        const other = was === g.homeId ? g.awayId : g.homeId;
        const flipped = (x: Game): number => (x.id === g.id ? other : winnerOf(x));
        // Only the flipped game's two teams and the touched races' title-game teams can score differently.
        fscore.set(score);
        const changed: number[] = [was, other];
        // Army-Navy counts in no record, so flipping it changes none: its odds come out the same either way.
        const swap = (k: number, dw: number, dl: number) => { if (k >= 0 && !late[o.i]) { w[k] += dw; l[k] += dl; } };
        const wi = idx(was);
        const oi = idx(other);
        // Take the touched races' title games back out of the season's records, flip the game, play them again.
        const touched = [raceOf(was), raceOf(other)].filter((c, k, all) => c >= 0 && all.indexOf(c) === k);
        for (const c of touched) {
          const at = (it * C + c) * 3;
          changed.push(titles[at], titles[at + 1]);
          uncredit(c, titles[at], titles[at + 1], titles[at + 2]);
        }
        swap(wi, -1, 1);
        swap(oi, 1, -1);
        // The flipped result moves both teams' ratings the other way, and with them their opponents' schedules.
        const flipMoved = anchored && live.counts[o.i] && !live.seen[o.i];
        const before = flipMoved ? resultPoints(live.home[o.i], was === g.homeId) : 0;
        const after = flipMoved ? resultPoints(live.home[o.i], other === g.homeId) : 0;
        const wa = allIndex.get(was)!;
        const oa = allIndex.get(other)!;
        if (flipMoved) {
          moved[wa] -= before + after;
          moved[oa] += before + after;
          for (const k of playedBy[wa]) changed.push(fbsIds[k]);
          for (const k of playedBy[oa]) changed.push(fbsIds[k]);
        }
        const replayed = touched.map((c) => {
          const r = playTitleGame(races[c], seed, it, flipped, (id) => teams!.rankIf(id, o.i), teams!.shift, titleLocks[races[c].conference]);
          creditTitle(c, r[0], r[1], r[2]);
          changed.push(r[0], r[1]);
          return r;
        });
        for (const id of changed) {
          const k = idx(id);
          if (k >= 0) fscore[k] = scoreOf(k, teams!.shift);
        }
        forder.set(order);
        sortBy(forder, fscore);
        holdCeilings(forder, (k) => l[k]);
        for (let p = 0; p < F; p++) fIds[p] = fbsIds[forder[p]];
        const makes = pick(fIds, (id) => champ[idx(id)] === 1).includes(focus!);
        // Put the season back as it was.
        touched.forEach((c, k) => uncredit(c, replayed[k][0], replayed[k][1], replayed[k][2]));
        swap(wi, 1, -1);
        swap(oi, -1, 1);
        if (flipMoved) {
          moved[wa] += before + after;
          moved[oa] -= before + after;
        }
        for (const c of touched) {
          const at = (it * C + c) * 3;
          creditTitle(c, titles[at], titles[at + 1], titles[at + 2]);
        }
        const r = focusRace >= 0 ? replayed[touched.indexOf(focusRace)] : null;
        bits = (makes ? 1 : 0) | (r && (r[0] === focus || r[1] === focus) ? 2 : 0);
      }
      ownBits[it * own.length + j] = bits;
      o.field[1 - side] += (bits & 1) * weight;
      if (focusRace >= 0) o.title[1 - side] += ((bits >> 1) & 1) * weight;
    });

    // Stage 5.
    for (let g = 0; g < B; g++) {
      const [x, y, hosted] = bracket[g];
      const a = x >= 0 ? field[x] : slots[it * B + ~x];
      const b = y >= 0 ? field[y] : slots[it * B + ~y];
      let win: number, nat: number;
      if (copy) {
        win = basis!.slots[it * B + g];
        nat = basis!.natSlots[it * B + g];
      } else {
        const u = (mix(seed, it, PLAYOFF_SALT + g) + 0.5) / 4294967296;
        const real = finals.get(pairKey(a, b));
        const forced = bracketLocks[g];
        nat = real ? (real.homePoints! > real.awayPoints! ? real.homeId : real.awayId)
          : u < odds(a, b, teams!.shift(a), teams!.shift(b), hosted ? HOME_FIELD : 0) ? a : b;
        win = real ? nat : forced === a || forced === b ? forced : nat;
      }
      slots[it * B + g] = win;
      natSlots[it * B + g] = nat;
      // Rounds reached: a first-round win is a quarterfinal (byes were counted with the seeds); semifinals and the
      // final count both teams.
      const r = roundOf(g);
      if (r < 0) reached[0][idx(win)] += weight;
      else if (r > 0) { reached[r][idx(a)] += weight; reached[r][idx(b)] += weight; }
    }
    const champion = slots[it * B + B - 1];
    playoffChamps[it] = champion;
    reached[3][idx(champion)] += weight;
  };

  // The seasons counted, in order: every one, or for an estimate the earlier run's seasons kept, with their weights.
  const counted: number[] = [];
  const weights: number[] = [];
  if (sim) {
    sim.forEachIteration((it, winnerAt, teams) => {
      counted.push(it);
      season1(it, (i) => winnerAt(i) === homeOf[i], winnerAt, teams, basis !== undefined && kept[it] === 1);
    });
  } else {
    // An estimate's results: each game locked here goes that way; every other game its natural way (the same
    // results the earlier run had in the seasons kept).
    let at = 0;
    const homeWins = (i: number): boolean => (side[i] >= 0 ? side[i] : (natural.bits[at + (i >> 3)] >> (i & 7)) & 1) === 1;
    const winnerAt = (i: number): number => (homeWins(i) ? games[i].homeId : games[i].awayId);
    for (let it = 0; it < n && counted.length < ESTIMATE_SEASONS; it++) {
      if (kept[it] !== 1) continue;
      counted.push(it);
      weight = weightOf(it);
      weights.push(weight);
      at = it * natural.stride;
      season1(it, homeWins, winnerAt, null, true);
    }
  }
  // What each share is out of: the seasons counted, or for an estimate their weights.
  const m = sim ? counted.length : weights.reduce((sum, x) => sum + x, 0);

  const playoffOdds = (k: number): NationalPlayoff => {
    const seeds = Array.from({ length: T }, (_, s) => seedCount[k * T + s] / m);
    return {
      field: inField[k] / m,
      bye: T === 12 ? seeds.slice(0, 4).reduce((sum, x) => sum + x, 0) : 0,
      seeds,
      quarterfinal: T === 12 ? reached[0][k] / m : null,
      semifinal: reached[1][k] / m,
      final: reached[2][k] / m,
      champion: reached[3][k] / m,
      run: announced ? playoffRun(season, announced.seeds, fbsIds[k]) : null,
    };
  };
  const simulatedTeams = new Set(races.flatMap((r) => [...r.data.ids]));
  const teamsOut: NationalTeam[] = fbs.map((t, k) => {
    const simulated = simulatedTeams.has(t.id);
    return {
      teamId: t.id,
      conference: t.conference,
      titleGame: simulated ? inTitle.get(t.id)! / m : null,
      champion: simulated ? won.get(t.id)! / m : null,
      meanRank: rankSum[k] / m,
      top4: top[0][k] / m,
      top12: top[1][k] / m,
      top25: top[2][k] / m,
      playoff: playoff ? playoffOdds(k) : null,
      profile: { wins: winSum[k] / m, losses: lossSum[k] / m, rating: rating[k], strength: regularSos[k] + sosMoved[k] / m, champion: champSum[k] / m },
    };
  });
  teamsOut.sort((a, b) => a.meanRank - b.meanRank || a.teamId - b.teamId);

  let current = 0;
  const raceIndex = (conference: string): number => {
    const c = conferences.indexOf(conference);
    if (c < 0) throw new Error(`${conference}'s title game isn't simulated`);
    return c;
  };
  const ranking: number[] = new Array<number>(F);
  const view: NationalSeason = {
    titleGame: (conference) => {
      const at = (current * C + raceIndex(conference)) * 3;
      return [titles[at], titles[at + 1]];
    },
    champion: (conference) => titles[(current * C + raceIndex(conference)) * 3 + 2],
    ranking,
    field: null,
    playoffChampion: null,
  };
  const fieldView: number[] = new Array<number>(playoff ? T : 0);
  let swingsMemo: NationalResult["swings"] | undefined;
  const swingsOf = (): NationalResult["swings"] => {
    if (!playoff) return [];
    // Per open game: seasons the home team wins it, and of those, seasons each team is in the field.
    const homeWon = new Float64Array(open.length);
    const homeField = new Float64Array(open.length * F);
    const fieldIdx = new Int32Array(T);
    for (const [c, it] of counted.entries()) {
      const wt = sim ? 1 : weights[c];
      const at = it * natural.stride;
      for (let s = 0; s < T; s++) fieldIdx[s] = idx(fields[it * T + s]);
      for (let j = 0; j < open.length; j++) {
        const i = open[j];
        if ((side[i] >= 0 ? side[i] : (natural.bits[at + (i >> 3)] >> (i & 7)) & 1) === 0) continue;
        homeWon[j] += wt;
        for (let s = 0; s < T; s++) homeField[j * F + fieldIdx[s]] += wt;
      }
    }
    return Array.from(open, (i, j) => {
      const h = homeWon[j];
      let sum = 0;
      if (h > 0 && h < m) {
        for (let k = 0; k < F; k++) {
          if (inField[k] === 0) continue;
          const fh = homeField[j * F + k] / h;
          const fa = (inField[k] - homeField[j * F + k]) / (m - h);
          // Less the change sampling alone would show (the mean of |noise| for a true change of 0), so a lopsided
          // game's few seasons on one side don't read as a big swing.
          const noise = Math.sqrt((2 / Math.PI) * (fh * (1 - fh) / h + fa * (1 - fa) / (m - h)));
          sum += Math.max(0, Math.abs(fh - fa) - noise);
        }
      }
      return { gameId: games[i].id, home: h / m, spots: sum / 2 };
    });
  };
  const result: NationalResult = {
    iterations: counted.length,
    conferences,
    playoff,
    announced,
    teams: teamsOut,
    games: own.map((o) => ({
      gameId: games[o.i].id, fieldIfWin: o.field[0] / m, fieldIfLose: o.field[1] / m,
      titleIfWin: focusRace < 0 ? null : o.title[0] / m, titleIfLose: focusRace < 0 ? null : o.title[1] / m,
    })),
    // Worked out when first read (the Lab's big games), from the seasons kept: each game's result is its lock, or
    // its natural result.
    get swings() {
      swingsMemo ??= swingsOf();
      return swingsMemo;
    },
    forEachIteration(cb) {
      for (const it of counted) {
        current = it;
        for (let p = 0; p < F; p++) ranking[p] = fbs[rankings[it * F + p]].id;
        if (playoff) {
          for (let s = 0; s < T; s++) fieldView[s] = fields[it * T + s];
          view.field = fieldView;
          view.playoffChampion = playoffChamps[it];
        }
        cb(it, view);
      }
    },
  };
  // An estimate holds only some seasons, so a later run can't take the rest from it.
  if (sim) {
    reusable.set(result, { season, seed, iterations: n, conferences, locks: { ...locks },
      titleLocks: { ...titleLocks }, bracketLocks: { ...bracketLocks }, titles, rankings, focus: opts.teamId !== undefined,
      focusId: focus, natTitle, fields, slots, natSlots, champs: playoffChamps, own: ownBits, ownGames: own.map((o) => o.i), natural });
  }
  return result;
}
