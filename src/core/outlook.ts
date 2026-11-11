// Season outlook for one conference: how likely each team is to reach the
// conference championship game, win it, and (experimentally) make the playoff.
import { powerConferences } from "./committee";
import { playTitleGame, simulateNational, titleRace, type NationalPlayoff, type NationalResult } from "./national";
import { championsNeeded, findFormat } from "./playoff";
import { hasTiebreakRules } from "./rules";
import { simulateSeason, type SimResult } from "./sim";
import { titleResult } from "./paths";
import { provenStatus } from "./proof";
import { teamRecord } from "./season";
import type { Game, Season, TeamRecord } from "./season";

export type OutlookOptions = {
  conference: string;
  iterations: number;
  seed: number;
  /** Forced results: game id -> id of the team that wins it. */
  locks?: Record<number, number>;
  /** A conference team whose own unplayed games get odds as if each were picked either way (`TeamOutlook.games`). */
  teamId?: number;
  /** An earlier national run to copy untouched title races from (`NationalOptions.reuse`). */
  reuse?: NationalResult;
  /** Forced title-game winners, for the national run (`NationalOptions.titleLocks`). */
  titleLocks?: Record<string, number>;
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
  /**
   * Fraction of iterations the team makes the playoff (EXPERIMENTAL). From the national simulation (`cfp`) when the
   * season can run one; otherwise a rough estimate, see PLAYOFF_FIELD.
   */
  playoff: number;
  /** Its full playoff odds from the national simulation; null when the season can't run one (then `playoff` is the estimate). */
  cfp: NationalPlayoff | null;
  /** Fraction of iterations the team makes the playoff without winning the conference (EXPERIMENTAL, like `playoff`). 0 means its only way in is the title. */
  atLarge: number;
  /**
   * For `OutlookOptions.teamId` only (empty for every other team): each of its unplayed games, conference or
   * not, in schedule order, with its title-game and playoff odds if it wins or loses that game. These are the
   * odds picking that result would show: every simulated season is replayed with only that game changed.
   */
  games: { gameId: number; titleIfWin: number; titleIfLose: number; playoffIfWin: number; playoffIfLose: number }[];
  /** Proven over every combination of remaining results: "clinched" / "eliminated" a title-game spot, else "alive". */
  status: "clinched" | "alive" | "eliminated";
  /**
   * The season's format has a Group of Six bid (2026 on: the highest-ranked Group of Six team, champion or not) and
   * the team is in a Group of Six conference, so its conference title is no automatic bid.
   */
  groupOfSix: boolean;
  /** Barred from the postseason this season (`Team.postseasonBan`): no title game, no playoff. */
  postseasonBan: boolean;
  /**
   * Its conference title game once final, if it played in it: whether it won, and "Beat Virginia 27-20 in the ACC
   * title game". Null otherwise.
   */
  titleResult: { won: boolean; text: string } | null;
};

export type SeasonOutlook = {
  iterations: number;
  teams: TeamOutlook[];
  /** The national run the playoff odds came from; null when they are the estimate. Pass it as `reuse` for a what-if. */
  national: NationalResult | null;
};

/**
 * EXPERIMENTAL playoff model, not the committee's. The conference champion
 * always gets in (auto bid). Any other team gets in when it ranks in the top
 * PLAYOFF_FIELD among all FBS teams by: wins - 1.5 * losses + rating / 10.
 */
const PLAYOFF_FIELD = 11;
const MISSING_RATING = 0;

/**
 * Whether the season can run the national simulation for `conference`: it has a playoff format whose field needs
 * at most the power conferences' champions, and every power conference has tiebreak rules and teams in the data.
 * `conference` itself has rules (titleRace has checked). Not part of the public API.
 */
export function nationalReady(season: Season): boolean {
  const format = findFormat(season.year);
  if (!format || championsNeeded(format) === "all") return false;
  const power = powerConferences(season.year);
  const count = (c: string) => season.teams.filter((t) => t.conference === c).length;
  return power.every((c) => hasTiebreakRules(c, season.year) && count(c) >= 2);
}

/**
 * The conferences whose title games the national run plays: the earlier run's (`reuse`) when they cover the power
 * conferences and this one, so it can be reused whole; otherwise the power conferences plus this one (none for an
 * independent). Not part of the public API.
 */
export function nationalConferences(season: Season, conference: string | null, reuse?: NationalResult): readonly string[] {
  const need = [...new Set([...powerConferences(season.year), ...(conference === null ? [] : [conference])])];
  return reuse && need.every((c) => reuse.conferences.includes(c)) ? reuse.conferences : need;
}

/** `shared`: a simulation of the same season, iterations, seed and locks to reuse. */
export function seasonOutlook(season: Season, opts: OutlookOptions, shared?: SimResult): SeasonOutlook {
  const { conference, iterations, seed } = opts;
  const race = titleRace(season, conference);
  const { data } = race;

  const sim = shared ?? simulateSeason(season, { iterations, seed, locks: opts.locks });
  // The playoff odds: the national simulation over the same simulated seasons when the season can run one.
  const national: NationalResult | null = nationalReady(season)
    ? simulateNational(season, { iterations, seed, locks: opts.locks, titleLocks: opts.titleLocks, conferences: nationalConferences(season, conference, opts.reuse), teamId: opts.teamId, reuse: opts.reuse }, sim)
    : null;
  const format = findFormat(season.year);
  const groupOfSix = format?.autoBids === "power4G6" && !powerConferences(season.year).includes(conference);
  const estimate = national === null;
  const gameIndex = new Map<number, number>(season.games.map((g, i) => [g.id, i]));
  const fbs = season.teams.filter((t) => t.classification === "fbs");
  const barred = new Set(season.teams.filter((t) => t.postseasonBan).map((t) => t.id));
  // Playoff spots for a non-FBS champion (not in the FBS arrays).
  const outside = new Map<number, number>();
  const inConf = [...data.ids];

  // Tiebreak draws and the title-game roll come from fresh streams seeded per iteration and conference (never a
  // shared stream), so iteration k's draws don't depend on how many draws earlier iterations used, what-if runs
  // stay paired, and the title game is the one the national simulation plays (playTitleGame).
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
  // The focus team's unplayed games, with title-game and playoff counts by its result: [win, lose].
  const focus = opts.teamId !== undefined && data.ids.has(opts.teamId) ? opts.teamId : null;
  const fk = focus === null ? -1 : idx(focus);
  const own = focus === null ? [] : season.games.flatMap((g, i) =>
    !g.completed && (g.homeId === focus || g.awayId === focus) ? [{ i, title: [0, 0], playoff: [0, 0] }] : []);
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
  /** Whether the focus team makes the playoff, from `w`/`l` before the title game and that game's result. */
  const focusMakes = (champ: number, loser: number): boolean => {
    if (champ === focus) return true;
    if (fk < 0) return false;
    const ci = idx(champ);
    const li = idx(loser);
    const score = (k: number) => w[k] + (k === ci ? 1 : 0) - 1.5 * (l[k] + (k === li ? 1 : 0)) + tenth[k];
    const mine = score(fk);
    let before = 0;
    for (let k = 0; k < F && before < PLAYOFF_FIELD; k++) if (k !== fk && ahead(score(k), k, mine, fk)) before++;
    return before < PLAYOFF_FIELD;
  };

  // With the national run, it has played this conference's title games (the same ones, from the same streams) and
  // the focus team's what-ifs already.
  if (estimate) sim.forEachIteration((iteration, winnerAt, teams) => {
    const winnerOf = (g: Game): number => winnerAt(gameIndex.get(g.id)!);
    const [a, b, champ] = playTitleGame(race, seed, iteration, winnerOf, teams.rank, teams.shift);
    titleGame.set(a, titleGame.get(a)! + 1);
    titleGame.set(b, titleGame.get(b)! + 1);
    champion.set(champ, champion.get(champ)! + 1);

    if (!based) {
      season.games.forEach((g, i) => { if (g.completed) tally(baseW, baseL, i, winnerAt(i)); });
      based = true;
    }
    w.set(baseW);
    l.set(baseL);
    for (let j = 0; j < unplayed.length; j++) tally(w, l, unplayed[j], winnerAt(unplayed[j]));

    // Each of the focus team's games the other way, the rest of the season unchanged: what a pick of that
    // result would show, since a lock changes only its own game's draw.
    if (own.length > 0) {
      const inTitle = a === focus || b === focus ? 1 : 0;
      const makes = focusMakes(champ, champ === a ? b : a) ? 1 : 0;
      for (const o of own) {
        const g = season.games[o.i];
        const won = winnerAt(o.i);
        const other = won === g.homeId ? g.awayId : g.homeId;
        const wi = idx(won);
        const oi = idx(other);
        if (wi >= 0) { w[wi]--; l[wi]++; }
        if (oi >= 0) { l[oi]--; w[oi]++; }
        const flipped = (x: Game): number => (x.id === g.id ? other : winnerOf(x));
        const [a2, b2, champ2] = playTitleGame(race, seed, iteration, flipped, (id) => teams.rankIf(id, o.i), teams.shift);
        const side = won === focus ? 0 : 1;
        o.title[side] += inTitle;
        o.playoff[side] += makes;
        o.title[1 - side] += a2 === focus || b2 === focus ? 1 : 0;
        o.playoff[1 - side] += focusMakes(champ2, champ2 === a2 ? b2 : a2) ? 1 : 0;
        if (wi >= 0) { w[wi]++; l[wi]--; }
        if (oi >= 0) { l[oi]++; w[oi]--; }
      }
    }
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
    for (let k = 0; k < filled; k++) {
      playoff[top[k]]++;
      if (top[k] === champIdx) champIn = true;
      else atLarge[top[k]]++;
    }
    if (!champIn) {
      if (champIdx >= 0) playoff[champIdx]++;
      else outside.set(champ, (outside.get(champ) ?? 0) + 1);
    }
  });

  const n = sim.iterations;
  if (national) {
    for (const t of national.teams) {
      if (!data.ids.has(t.teamId)) continue;
      titleGame.set(t.teamId, Math.round(t.titleGame! * n));
      champion.set(t.teamId, Math.round(t.champion! * n));
    }
    // Field shares from the national run; at large: in the field without winning the conference.
    national.forEachIteration((_, ns) => {
      const ch = ns.champion(conference);
      for (const id of ns.field!) {
        const k = fbsIndex.get(id);
        if (k !== undefined && id !== ch && data.ids.has(id)) atLarge[k]++;
      }
    });
  }
  const fieldIf = new Map(national?.games.map((x) => [x.gameId, x]) ?? []);
  const cfpOf = new Map(national?.teams.map((t) => [t.teamId, t.playoff!]) ?? []);
  const statusOf = (p: number, id: number): TeamOutlook["status"] => {
    if (p !== 0 && p !== 1) return "alive";
    const s = provenStatus(season, conference, id, opts.locks);
    return s === "open" ? "alive" : s;
  };
  return {
    iterations: n,
    national,
    teams: inConf.map((id) => ({
      teamId: id,
      record: teamRecord(season, id, opts.locks),
      expectedWins: sim.teams[id].expectedWins,
      expectedConferenceWins: sim.teams[id].expectedConferenceWins,
      titleGame: titleGame.get(id)! / n,
      champion: champion.get(id)! / n,
      playoff: national ? (cfpOf.get(id)?.field ?? 0) : (fbsIndex.has(id) ? playoff[fbsIndex.get(id)!] : (outside.get(id) ?? 0)) / n,
      cfp: cfpOf.get(id) ?? null,
      atLarge: fbsIndex.has(id) ? atLarge[fbsIndex.get(id)!] / n : 0,
      games: id !== focus ? [] : own.map((o) => ({
        gameId: season.games[o.i].id,
        titleIfWin: fieldIf.get(season.games[o.i].id)?.titleIfWin ?? o.title[0] / n,
        titleIfLose: fieldIf.get(season.games[o.i].id)?.titleIfLose ?? o.title[1] / n, playoffIfWin: fieldIf.get(season.games[o.i].id)?.fieldIfWin ?? o.playoff[0] / n,
        playoffIfLose: fieldIf.get(season.games[o.i].id)?.fieldIfLose ?? o.playoff[1] / n,
      })),
      status: statusOf(titleGame.get(id)! / n, id),
      groupOfSix,
      postseasonBan: barred.has(id),
      titleResult: titleResult(season, conference, data.decided, id),
    })),
  };
}
