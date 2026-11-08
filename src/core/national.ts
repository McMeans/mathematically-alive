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
import { powerConferences, teamRating, titleGameIndex } from "./committee";
import { announcedField, bracketGames, championsNeeded, fieldPicker, findFormat, playoffRun, type AnnouncedField, type PlayoffRun } from "./playoff";
import { isArmyNavy, type Game, type Season } from "./season";
import { HOME_FIELD } from "./odds";
import { COMMITTEE_SALT, PLAYOFF_SALT, mix, neutralOdds, simulateSeason, tiebreakDraw, titleRoll, type SimResult } from "./sim";
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
   * the earlier run itself comes back. Anything else is ignored.
   */
  reuse?: NationalResult;
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
  /** Replay every simulated season's title games and ranking. */
  forEachIteration(cb: (iteration: number, season: NationalSeason) => void): void;
};

/** What a later run needs to reuse a run's title games (NationalOptions.reuse). */
type Reusable = {
  season: Season; seed: number; iterations: number; conferences: readonly string[]; locks: Record<number, number>;
  titleLocks: Record<string, number>; bracketLocks: Record<number, number>; titles: Int32Array; rankings: Uint16Array; focus: boolean };
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
function reusedTitles(season: Season, opts: NationalOptions, n: number, races: TitleRace[]): ({ titles: Int32Array; stride: number; at: number } | null)[] {
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
    return at < 0 || titleLocks[race.conference] !== r.titleLocks[race.conference] || [...touched].some((id) => race.data.ids.has(id)) ? null : { titles: r.titles, stride: r.conferences.length, at };
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
  const sim = shared ?? simulateSeason(season, { iterations, seed, locks: opts.locks });
  const n = sim.iterations;
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
  for (const k of Object.keys(bracketLocks)) {
    const g = Number(k);
    if (!Number.isInteger(g) || g < 0 || g >= bracket.length) throw new Error(`bracket game ${k} doesn't exist`);
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
  // Army-Navy is played the week after the field is picked, so it counts in none of the records the stand-in ranks on.
  const name = new Map(season.teams.map((t) => [t.id, t.name]));
  const late = games.map((g) => isArmyNavy(name.get(g.homeId), name.get(g.awayId)));
  const home = Int32Array.from(games, (g, i) => (late[i] ? -1 : idx(g.homeId)));
  const away = Int32Array.from(games, (g, i) => (late[i] ? -1 : idx(g.awayId)));
  const unplayed = Int32Array.from(games.flatMap((g, i) => (g.completed ? [] : [i])));
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
  // Stored per iteration for forEachIteration: the ranking (FBS indexes) and each race's [seed 1, seed 2, champion].
  const rankings = new Uint16Array(n * F);
  const titles = new Int32Array(n * C * 3);
  const copied = reusedTitles(season, opts, n, races);
  // The earlier run's ranking, as each season's starting order: nearly sorted already, so the sort is close to linear.
  const prior = opts.reuse && reusable.get(opts.reuse);
  const startOrder = prior && prior.season === season && prior.iterations === n ? prior.rankings : null;
  const rankSum = new Float64Array(F);
  const top = [new Uint32Array(F), new Uint32Array(F), new Uint32Array(F)];
  const cuts = [4, 12, 25];
  const rankIds = new Int32Array(F);
  const fields = new Int32Array(playoff ? n * T : 0);
  const playoffChamps = new Int32Array(playoff ? n : 0);
  const seedCount = new Uint32Array(F * T);
  const inField = new Uint32Array(F);
  const reached = [new Uint32Array(F), new Uint32Array(F), new Uint32Array(F), new Uint32Array(F)]; // QF, SF, final, title
  const roundOf = (g: number): number => (g === bracket.length - 1 ? 2 : T === 4 || g >= 8 ? 1 : g >= 4 ? 0 : -1);
  const slot = new Int32Array(bracket.length);
  const inTitle = new Map<number, number>();
  const won = new Map<number, number>();
  for (const r of races) for (const id of r.data.ids) { inTitle.set(id, 0); won.set(id, 0); }

  // The focus team's unplayed games (season.games indexes), with field counts by its result: [win, lose].
  const focus = opts.teamId !== undefined && fbsIndex.has(opts.teamId) && playoff ? opts.teamId : null;
  const own = focus === null ? [] : games.flatMap((g, i) =>
    !g.completed && (g.homeId === focus || g.awayId === focus) ? [{ i, field: [0, 0], title: [0, 0] }] : []);
  const focusRace = focus === null ? -1 : races.findIndex((r) => r.data.ids.has(focus));
  const raceOf = (id: number): number => races.findIndex((r) => r.data.ids.has(id));
  const gumbel = new Float64Array(F);
  // committeeScore, inlined: this runs for every FBS team in every simulated season.
  const scoreOf = (k: number, shift: (id: number) => number): number =>
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

  sim.forEachIteration((it, winnerAt, teams) => {
    const winnerOf = (g: Game): number => winnerAt(gameIndex.get(g.id)!);
    w.set(baseW);
    l.set(baseL);
    for (let j = 0; j < unplayed.length; j++) {
      const i = unplayed[j];
      const homeWon = winnerAt(i) === games[i].homeId;
      const win = homeWon ? home[i] : away[i];
      const lose = homeWon ? away[i] : home[i];
      if (win >= 0) w[win]++;
      if (lose >= 0) l[lose]++;
    }
    titleSos.fill(0);
    titleN.fill(0);
    champ.fill(0);

    // Stage 2.
    for (let c = 0; c < C; c++) {
      const from = copied[c];
      const at = from ? (it * from.stride + from.at) * 3 : 0;
      const [a, b, ch] = from ? [from.titles[at], from.titles[at + 1], from.titles[at + 2]] : playTitleGame(races[c], seed, it, winnerOf, teams.rank, teams.shift, titleLocks[races[c].conference]);
      titles.set([a, b, ch], (it * C + c) * 3);
      inTitle.set(a, inTitle.get(a)! + 1);
      inTitle.set(b, inTitle.get(b)! + 1);
      won.set(ch, won.get(ch)! + 1);
      creditTitle(c, a, b, ch);
    }

    // Stage 3: the committee stand-in's score plus standard Gumbel noise, so any two teams are ordered with the
    // pair odds the model was fitted on.
    for (let k = 0; k < F; k++) {
      const u = (mix(seed, it, COMMITTEE_SALT + k) + 0.5) / 4294967296;
      gumbel[k] = -Math.log(-Math.log(u));
      if (!startOrder) order[k] = k;
    }
    if (startOrder) order.set(startOrder.subarray(it * F, (it + 1) * F));
    for (let k = 0; k < F; k++) score[k] = scoreOf(k, teams.shift);
    sortBy(order, score);
    rankings.set(order, it * F);
    for (let p = 0; p < F; p++) {
      const k = order[p];
      rankSum[k] += p + 1;
      for (let q = 0; q < cuts.length; q++) if (p < cuts[q]) top[q][k]++;
    }
    if (!playoff) return;

    // Stage 4.
    for (let p = 0; p < F; p++) rankIds[p] = fbsIds[order[p]];
    const field = pick(rankIds, (id) => champ[idx(id)] === 1);
    fields.set(field, it * T);
    field.forEach((id, s) => {
      const k = idx(id);
      seedCount[k * T + s]++;
      inField[k]++;
      if (T === 12 && s < 4) reached[0][k]++;
    });

    // The focus team's games the other way, one at a time, everything else in the season unchanged: stage 2 again
    // only for the title races the game's two teams are in, then stages 3 and 4.
    for (const o of own) {
      const g = games[o.i];
      const was = winnerAt(o.i);
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
      const touched = [raceOf(was), raceOf(other)].filter((c, j, all) => c >= 0 && all.indexOf(c) === j);
      for (const c of touched) {
        const at = (it * C + c) * 3;
        changed.push(titles[at], titles[at + 1]);
        uncredit(c, titles[at], titles[at + 1], titles[at + 2]);
      }
      swap(wi, -1, 1);
      swap(oi, 1, -1);
      const replayed = touched.map((c) => {
        const r = playTitleGame(races[c], seed, it, flipped, (id) => teams.rankIf(id, o.i), teams.shift, titleLocks[races[c].conference]);
        creditTitle(c, r[0], r[1], r[2]);
        changed.push(r[0], r[1]);
        return r;
      });
      for (const id of changed) {
        const k = idx(id);
        if (k >= 0) fscore[k] = scoreOf(k, teams.shift);
      }
      forder.set(order);
      sortBy(forder, fscore);
      for (let p = 0; p < F; p++) fIds[p] = fbsIds[forder[p]];
      const makes = pick(fIds, (id) => champ[idx(id)] === 1).includes(focus!);
      // Put the season back as it was.
      touched.forEach((c, j) => uncredit(c, replayed[j][0], replayed[j][1], replayed[j][2]));
      swap(wi, 1, -1);
      swap(oi, -1, 1);
      for (const c of touched) {
        const at = (it * C + c) * 3;
        creditTitle(c, titles[at], titles[at + 1], titles[at + 2]);
      }
      const side = was === focus ? 0 : 1;
      o.field[side] += field.includes(focus!) ? 1 : 0;
      o.field[1 - side] += makes ? 1 : 0;
      if (focusRace >= 0) {
        const at = (it * C + focusRace) * 3;
        const r = replayed[touched.indexOf(focusRace)];
        o.title[side] += titles[at] === focus || titles[at + 1] === focus ? 1 : 0;
        o.title[1 - side] += r[0] === focus || r[1] === focus ? 1 : 0;
      }
    }
    // Stage 5.
    for (let g = 0; g < bracket.length; g++) {
      const [x, y, hosted] = bracket[g];
      const a = x >= 0 ? field[x] : slot[~x];
      const b = y >= 0 ? field[y] : slot[~y];
      const u = (mix(seed, it, PLAYOFF_SALT + g) + 0.5) / 4294967296;
      const real = finals.get(pairKey(a, b));
      const forced = bracketLocks[g];
      const win = real ? (real.homePoints! > real.awayPoints! ? real.homeId : real.awayId)
        : forced === a || forced === b ? forced
        : u < odds(a, b, teams.shift(a), teams.shift(b), hosted ? HOME_FIELD : 0) ? a : b;
      slot[g] = win;
      // Rounds reached: a first-round win is a quarterfinal (byes were counted with the seeds); semifinals and the
      // final count both teams.
      const r = roundOf(g);
      if (r < 0) reached[0][idx(win)]++;
      else if (r > 0) { reached[r][idx(a)]++; reached[r][idx(b)]++; }
    }
    const champion = slot[bracket.length - 1];
    playoffChamps[it] = champion;
    reached[3][idx(champion)]++;
  });

  const playoffOdds = (k: number): NationalPlayoff => {
    const seeds = Array.from({ length: T }, (_, s) => seedCount[k * T + s] / n);
    return {
      field: inField[k] / n,
      bye: T === 12 ? seeds.slice(0, 4).reduce((sum, x) => sum + x, 0) : 0,
      seeds,
      quarterfinal: T === 12 ? reached[0][k] / n : null,
      semifinal: reached[1][k] / n,
      final: reached[2][k] / n,
      champion: reached[3][k] / n,
      run: announced ? playoffRun(season, announced.seeds, fbsIds[k]) : null,
    };
  };
  const simulatedTeams = new Set(races.flatMap((r) => [...r.data.ids]));
  const teamsOut: NationalTeam[] = fbs.map((t, k) => {
    const simulated = simulatedTeams.has(t.id);
    return {
      teamId: t.id,
      conference: t.conference,
      titleGame: simulated ? inTitle.get(t.id)! / n : null,
      champion: simulated ? won.get(t.id)! / n : null,
      meanRank: rankSum[k] / n,
      top4: top[0][k] / n,
      top12: top[1][k] / n,
      top25: top[2][k] / n,
      playoff: playoff ? playoffOdds(k) : null,
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
  const result: NationalResult = {
    iterations: n,
    conferences,
    playoff,
    announced,
    teams: teamsOut,
    games: own.map((o) => ({
      gameId: games[o.i].id, fieldIfWin: o.field[0] / n, fieldIfLose: o.field[1] / n,
      titleIfWin: focusRace < 0 ? null : o.title[0] / n, titleIfLose: focusRace < 0 ? null : o.title[1] / n,
    })),
    forEachIteration(cb) {
      for (current = 0; current < n; current++) {
        for (let p = 0; p < F; p++) ranking[p] = fbs[rankings[current * F + p]].id;
        if (playoff) {
          for (let s = 0; s < T; s++) fieldView[s] = fields[current * T + s];
          view.field = fieldView;
          view.playoffChampion = playoffChamps[current];
        }
        cb(current, view);
      }
    },
  };
  reusable.set(result, { season, seed, iterations: n, conferences, locks: { ...(opts.locks ?? {}) },
    titleLocks: { ...titleLocks }, bracketLocks: { ...bracketLocks }, titles, rankings, focus: opts.teamId !== undefined });
  return result;
}
