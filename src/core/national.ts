// National simulation, stages 2 and 3 (docs/plan-national.md, phase 4), one pass per simulated season on top of
// the regular season that simulateSeason plays out (stage 1):
// 2. Conference title games: each simulated conference's rules (rules.ts) pick its two teams, and the game is
//    played at a neutral site with the season's simulated ratings, or taken from the data once it is scheduled.
// 3. Committee stand-in ranking (committee.ts) of every FBS team, from the season's simulated record, rating and
//    schedule, the title games included, with each team's score drawn once per season around the fitted model.
// Every draw comes from a stream hashed from (seed, iteration, conference or team), so a lock changes only its own
// game's draw and what-if runs stay paired with the base run.
import { COMMITTEE_WEIGHTS as W } from "./committee-weights";
import { powerConferences, teamRating, titleGameIndex } from "./committee";
import type { Game, Season } from "./season";
import { COMMITTEE_SALT, mix, neutralOdds, simulateSeason, tiebreakDraw, titleRoll, type SimResult } from "./sim";
import { championshipFromData, conferenceData, type ConferenceData } from "./tiebreak";

export type NationalOptions = {
  iterations: number;
  seed: number;
  /** Forced results: game id -> id of the team that wins it. */
  locks?: Record<number, number>;
  /** Conferences whose title games are simulated. Each needs tiebreak rules for the season. */
  conferences: readonly string[];
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
};

/** One simulated season after stages 2 and 3. Valid only during the forEachIteration callback. */
export type NationalSeason = {
  /** The conference's title-game teams, [seed 1, seed 2]. */
  titleGame(conference: string): readonly [number, number];
  champion(conference: string): number;
  /** Every FBS team, the stand-in's order, best first. */
  ranking: readonly number[];
};

export type NationalResult = {
  iterations: number;
  conferences: readonly string[];
  /** Every FBS team, the stand-in's average order (best mean rank first). */
  teams: NationalTeam[];
  /** Replay every simulated season's title games and ranking. */
  forEachIteration(cb: (iteration: number, season: NationalSeason) => void): void;
};

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

/**
 * Stage 2 for one conference in one simulated season: [seed 1, seed 2, champion]. The rules pick the teams. When
 * the data has the title game between those two, its result (final, locked or simulated) decides; otherwise a
 * neutral-site game at the season's simulated ratings. Not part of the public API.
 */
export function playTitleGame(
  race: TitleRace,
  seed: number,
  iteration: number,
  winnerOf: (game: Game) => number,
  rank: (teamId: number) => number,
  shift: (teamId: number) => number,
): [number, number, number] {
  const [a, b] = championshipFromData(race.data, winnerOf, { draw: tiebreakDraw(seed, iteration, race.conference), rank });
  const g = race.game;
  if (g && ((g.homeId === a && g.awayId === b) || (g.homeId === b && g.awayId === a))) return [a, b, winnerOf(g)];
  return [a, b, titleRoll(seed, iteration, race.conference) < race.odds(a, b, shift(a), shift(b)) ? a : b];
}

/** Simulate the season, every listed conference's title game, and the committee stand-in ranking. */
export function simulateNational(season: Season, opts: NationalOptions, shared?: SimResult): NationalResult {
  const { iterations, seed } = opts;
  const conferences = [...new Set(opts.conferences)];
  const races = conferences.map((c) => titleRace(season, c));
  const sim = shared ?? simulateSeason(season, { iterations, seed, locks: opts.locks });
  const n = sim.iterations;
  const C = races.length;
  const power = new Set(powerConferences(season.year));

  const byId = new Map(season.teams.map((t) => [t.id, t]));
  const fbs = season.teams.filter((t) => t.classification === "fbs");
  const F = fbs.length;
  const fbsIds = Int32Array.from(fbs, (t) => t.id);
  const fbsIndex = new Map<number, number>(fbs.map((t, k) => [t.id, k]));
  const idx = (id: number): number => fbsIndex.get(id) ?? -1;
  const games = season.games;
  const gameIndex = new Map<number, number>(games.map((g, i) => [g.id, i]));
  const home = Int32Array.from(games, (g) => idx(g.homeId));
  const away = Int32Array.from(games, (g) => idx(g.awayId));
  const unplayed = Int32Array.from(games.flatMap((g, i) => (g.completed ? [] : [i])));
  const rating = Float64Array.from(fbs, (t) => teamRating(t));
  // Strength of schedule: opponents' ratings summed over the season's games, and how many.
  const oppSum = new Float64Array(F);
  const oppCount = new Int32Array(F);
  for (const g of games) {
    const h = idx(g.homeId);
    const a = idx(g.awayId);
    if (h >= 0) { oppSum[h] += teamRating(byId.get(g.awayId)); oppCount[h]++; }
    if (a >= 0) { oppSum[a] += teamRating(byId.get(g.homeId)); oppCount[a]++; }
  }
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
  const sos = new Float64Array(F);
  const sosN = new Int32Array(F);
  const champ = new Uint8Array(F);
  const score = new Float64Array(F);
  const order = new Uint16Array(F);
  // Stored per iteration for forEachIteration: the ranking (FBS indexes) and each race's [seed 1, seed 2, champion].
  const rankings = new Uint16Array(n * F);
  const titles = new Int32Array(n * C * 3);
  const rankSum = new Float64Array(F);
  const top = [new Uint32Array(F), new Uint32Array(F), new Uint32Array(F)];
  const cuts = [4, 12, 25];
  const inTitle = new Map<number, number>();
  const won = new Map<number, number>();
  for (const r of races) for (const id of r.data.ids) { inTitle.set(id, 0); won.set(id, 0); }

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
    sos.set(oppSum);
    sosN.set(oppCount);
    champ.fill(0);

    // Stage 2.
    for (let c = 0; c < C; c++) {
      const race = races[c];
      const [a, b, ch] = playTitleGame(race, seed, it, winnerOf, teams.rank, teams.shift);
      titles.set([a, b, ch], (it * C + c) * 3);
      inTitle.set(a, inTitle.get(a)! + 1);
      inTitle.set(b, inTitle.get(b)! + 1);
      won.set(ch, won.get(ch)! + 1);
      const ci = idx(ch);
      const li = idx(ch === a ? b : a);
      if (ci >= 0 && power.has(race.conference)) champ[ci] = 1;
      // A title game already in the data was counted with the season's games.
      if (race.game && ((race.game.homeId === a && race.game.awayId === b) || (race.game.homeId === b && race.game.awayId === a))) continue;
      if (ci >= 0) { w[ci]++; sos[ci] += teamRating(byId.get(ch === a ? b : a)); sosN[ci]++; }
      if (li >= 0) { l[li]++; sos[li] += teamRating(byId.get(ch)); sosN[li]++; }
    }

    // Stage 3: the committee stand-in's score plus standard Gumbel noise, so any two teams are ordered with the
    // pair odds the model was fitted on.
    for (let k = 0; k < F; k++) {
      const u = (mix(seed, it, COMMITTEE_SALT + k) + 0.5) / 4294967296;
      // committeeScore, inlined: this runs for every FBS team in every simulated season.
      score[k] = W.wins * w[k] + W.losses * l[k] + W.rating * (rating[k] + teams.shift(fbsIds[k])) +
        W.strength * (sosN[k] === 0 ? 0 : sos[k] / sosN[k]) + W.champion * champ[k] - Math.log(-Math.log(u));
      order[k] = k;
    }
    // Insertion sort, best first (ties to the lower team id): about twice as fast as a comparator sort at this size.
    for (let i = 1; i < F; i++) {
      const v = order[i];
      const sv = score[v];
      let j = i - 1;
      while (j >= 0 && (score[order[j]] < sv || (score[order[j]] === sv && fbsIds[order[j]] > fbsIds[v]))) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = v;
    }
    rankings.set(order, it * F);
    for (let p = 0; p < F; p++) {
      const k = order[p];
      rankSum[k] += p + 1;
      for (let q = 0; q < cuts.length; q++) if (p < cuts[q]) top[q][k]++;
    }
  });

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
  };
  return {
    iterations: n,
    conferences,
    teams: teamsOut,
    forEachIteration(cb) {
      for (current = 0; current < n; current++) {
        for (let p = 0; p < F; p++) ranking[p] = fbs[rankings[current * F + p]].id;
        cb(current, view);
      }
    },
  };
}
