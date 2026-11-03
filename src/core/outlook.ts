// Season outlook for one conference: how likely each team is to reach the
// conference championship game, win it, and (experimentally) make the playoff.
import { mix, mulberry32, neutralOdds, simulateSeason, type SimResult } from "./sim";
import { provenStatus } from "./proof";
import { teamRecord } from "./season";
import type { Game, Season, TeamRecord } from "./season";
import { championshipFromData, conferenceData } from "./tiebreak";

export type OutlookOptions = {
  conference: string;
  iterations: number;
  seed: number;
  /** Forced results: game id -> id of the team that wins it. */
  locks?: Record<number, number>;
};

export type TeamOutlook = {
  teamId: number;
  /** Record so far, counting locked results as played. */
  record: TeamRecord;
  expectedWins: number;
  expectedConferenceWins: number;
  /** Fraction of iterations the team plays in the conference championship game. */
  titleGame: number;
  /** Fraction of iterations the team wins the conference championship game. */
  champion: number;
  /** EXPERIMENTAL rough estimate of making the playoff; see PLAYOFF_FIELD. */
  playoff: number;
  /** Fraction of iterations the team makes the playoff without winning the conference (EXPERIMENTAL, like `playoff`). 0 means its only way in is the title. */
  atLarge: number;
  /**
   * Playoff odds by the result of each of the team's unplayed games (conference or not), in schedule order.
   * Null when too few simulated seasons go that way (always so for a locked game's other side), except for
   * a non-conference game of a team that never gets in at large: its playoff odds either way.
   */
  games: { gameId: number; ifWin: number | null; ifLose: number | null }[];
  /** Proven over every combination of remaining results: "clinched" / "eliminated" a title-game spot, else "alive". */
  status: "clinched" | "alive" | "eliminated";
};

export type SeasonOutlook = { iterations: number; teams: TeamOutlook[] };

/**
 * EXPERIMENTAL playoff model, not the committee's. The conference champion
 * always gets in (auto bid). Any other team gets in when it ranks in the top
 * PLAYOFF_FIELD among all FBS teams by: wins - 1.5 * losses + rating / 10.
 */
const PLAYOFF_FIELD = 11;
const MISSING_RATING = 0;
// Simulated seasons a non-conference result needs before its playoff odds are shown.
const MIN_SAMPLE = 30;

/** `shared`: a simulation of the same season, iterations, seed and locks to reuse. */
export function seasonOutlook(season: Season, opts: OutlookOptions, shared?: SimResult): SeasonOutlook {
  const { conference, iterations, seed } = opts;
  const data = conferenceData(season, conference);
  if (data.ids.size < 2) throw new Error(`${conference} has fewer than two teams`);

  const sim = shared ?? simulateSeason(season, { iterations, seed, locks: opts.locks });
  const gameIndex = new Map<number, number>(season.games.map((g, i) => [g.id, i]));
  const fbs = season.teams.filter((t) => t.classification === "fbs");
  // Playoff spots for a non-FBS champion (not in the FBS arrays).
  const outside = new Map<number, number>();
  const inConf = [...data.ids];

  const titleOdds = neutralOdds(season);
  // Tiebreak draws and the title-game roll come from fresh streams seeded per
  // iteration (never a shared stream), so iteration k's draws don't depend on
  // how many draws earlier iterations used and what-if runs stay paired.
  const titleGame = new Map<number, number>(inConf.map((id) => [id, 0]));
  const champion = new Map<number, number>(inConf.map((id) => [id, 0]));
  // Playoff ordering, by FBS team index. Completed games are the same in every iteration, so their
  // wins and losses are counted once; each iteration adds only the unplayed games.
  const F = fbs.length;
  const fbsIndex = new Map<number, number>(fbs.map((t, k) => [t.id, k]));
  const tenth = Float64Array.from(fbs, (t) => (t.rating ?? MISSING_RATING) / 10);
  const fbsIdOf = Int32Array.from(fbs, (t) => t.id);
  const idx = (id: number): number => fbsIndex.get(id) ?? -1;
  const gameHome = Int32Array.from(season.games, (g) => idx(g.homeId));
  const gameAway = Int32Array.from(season.games, (g) => idx(g.awayId));
  const unplayed = Int32Array.from(season.games.flatMap((g, i) => (g.completed ? [] : [i])));
  const baseW = new Int32Array(F);
  const baseL = new Int32Array(F);
  let based = false;
  const w = new Int32Array(F);
  const l = new Int32Array(F);
  const playoff = new Float64Array(F);
  const atLarge = new Float64Array(F);
  const made = new Uint8Array(F);
  // Each conference team's unplayed games: [FBS index, game index, team id] and playoff counts by result.
  const track = inConf.flatMap((id) => season.games.flatMap((g, i) =>
    !g.completed && (g.homeId === id || g.awayId === id) ? [{ id, k: idx(id), i, winN: 0, winIn: 0, loseN: 0, loseIn: 0 }] : []));
  const top = new Int32Array(PLAYOFF_FIELD);
  const topScore = new Float64Array(PLAYOFF_FIELD);
  /** Credit one game's winner and loser (by FBS index, -1 for non-FBS). */
  const tally = (W: Int32Array, L: Int32Array, i: number, winnerId: number) => {
    const homeWon = winnerId === season.games[i].homeId;
    const win = homeWon ? gameHome[i] : gameAway[i];
    const lose = homeWon ? gameAway[i] : gameHome[i];
    if (win >= 0) W[win]++;
    if (lose >= 0) L[lose]++;
  };
  // Strict order (score high first, then team id low first), so the top PLAYOFF_FIELD is unique.
  const ahead = (sa: number, a: number, sb: number, b: number) => sa > sb || (sa === sb && fbsIdOf[a] < fbsIdOf[b]);

  sim.forEachIteration((iteration, winnerAt, teams) => {
    const rand = mulberry32(mix(seed, iteration, 1));
    const winnerOf = (g: Game): number => winnerAt(gameIndex.get(g.id)!);
    const [a, b] = championshipFromData(data, conference, winnerOf, { draw: rand, rank: teams.rank });
    titleGame.set(a, titleGame.get(a)! + 1);
    titleGame.set(b, titleGame.get(b)! + 1);
    const champ = mulberry32(mix(seed, iteration, 2))() < titleOdds(a, b, teams.shift(a), teams.shift(b)) ? a : b;
    champion.set(champ, champion.get(champ)! + 1);

    if (!based) {
      season.games.forEach((g, i) => { if (g.completed) tally(baseW, baseL, i, winnerAt(i)); });
      based = true;
    }
    w.set(baseW);
    l.set(baseL);
    for (let j = 0; j < unplayed.length; j++) tally(w, l, unplayed[j], winnerAt(unplayed[j]));
    // The title game is itself a game; its result counts toward the ordering.
    const champIdx = idx(champ);
    const loserIdx = idx(champ === a ? b : a);
    if (champIdx >= 0) w[champIdx]++;
    if (loserIdx >= 0) l[loserIdx]++;

    // Top PLAYOFF_FIELD by score, kept sorted by insertion (same set as sorting every team).
    let filled = 0;
    for (let k = 0; k < F; k++) {
      const sc = w[k] - 1.5 * l[k] + tenth[k];
      if (filled === PLAYOFF_FIELD && !ahead(sc, k, topScore[filled - 1], top[filled - 1])) continue;
      let at = filled < PLAYOFF_FIELD ? filled++ : filled - 1;
      while (at > 0 && ahead(sc, k, topScore[at - 1], top[at - 1])) {
        top[at] = top[at - 1];
        topScore[at] = topScore[at - 1];
        at--;
      }
      top[at] = k;
      topScore[at] = sc;
    }
    let champIn = false;
    made.fill(0);
    for (let k = 0; k < filled; k++) {
      playoff[top[k]]++;
      made[top[k]] = 1;
      if (top[k] === champIdx) champIn = true;
      else atLarge[top[k]]++;
    }
    if (champIdx >= 0) made[champIdx] = 1;
    for (const t of track) {
      const inIt = t.k >= 0 && made[t.k] === 1 ? 1 : t.id === champ ? 1 : 0;
      if (winnerAt(t.i) === t.id) { t.winN++; t.winIn += inIt; }
      else { t.loseN++; t.loseIn += inIt; }
    }
    if (!champIn) {
      if (champIdx >= 0) playoff[champIdx]++;
      else outside.set(champ, (outside.get(champ) ?? 0) + 1);
    }
  });

  const n = sim.iterations;
  const statusOf = (p: number, id: number): TeamOutlook["status"] => {
    if (p !== 0 && p !== 1) return "alive";
    const s = provenStatus(season, conference, id, opts.locks);
    return s === "open" ? "alive" : s;
  };
  return {
    iterations: n,
    teams: inConf.map((id) => ({
      teamId: id,
      record: teamRecord(season, id, opts.locks),
      expectedWins: sim.teams[id].expectedWins,
      expectedConferenceWins: sim.teams[id].expectedConferenceWins,
      titleGame: titleGame.get(id)! / n,
      champion: champion.get(id)! / n,
      playoff: (fbsIndex.has(id) ? playoff[fbsIndex.get(id)!] : (outside.get(id) ?? 0)) / n,
      atLarge: fbsIndex.has(id) ? atLarge[fbsIndex.get(id)!] / n : 0,
      games: track.filter((t) => t.id === id).map((t) => {
        // Never in at large: the title is its only way in, so a non-conference result can't change it.
        // (Split by result, the odds would still differ: a team rated up that season wins both.)
        const only = !season.games[t.i].conferenceGame && (!fbsIndex.has(id) || atLarge[fbsIndex.get(id)!] === 0);
        const all = (fbsIndex.has(id) ? playoff[fbsIndex.get(id)!] : (outside.get(id) ?? 0)) / n;
        return {
          gameId: season.games[t.i].id,
          ifWin: only ? all : t.winN >= MIN_SAMPLE ? t.winIn / t.winN : null,
          ifLose: only ? all : t.loseN >= MIN_SAMPLE ? t.loseIn / t.loseN : null,
        };
      }),
      status: statusOf(titleGame.get(id)! / n, id),
    })),
  };
}
