// Season outlook for one conference: how likely each team is to reach the
// conference championship game, win it, and (experimentally) make the playoff.
import { gameWinProbability, mix, mulberry32, simulateSeason, type SimResult } from "./sim";
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
  record: TeamRecord;
  expectedWins: number;
  expectedConferenceWins: number;
  /** Fraction of iterations the team plays in the conference championship game. */
  titleGame: number;
  /** Fraction of iterations the team wins the conference championship game. */
  champion: number;
  /** EXPERIMENTAL rough estimate of making the playoff; see PLAYOFF_FIELD. */
  playoff: number;
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

/** `shared`: a simulation of the same season, iterations, seed and locks to reuse. */
export function seasonOutlook(season: Season, opts: OutlookOptions, shared?: SimResult): SeasonOutlook {
  const { conference, iterations, seed } = opts;
  const data = conferenceData(season, conference);
  if (data.ids.size < 2) throw new Error(`${conference} has fewer than two teams`);

  const sim = shared ?? simulateSeason(season, { iterations, seed, locks: opts.locks });
  const gameIndex = new Map<number, number>(season.games.map((g, i) => [g.id, i]));
  const fbs = season.teams.filter((t) => t.classification === "fbs");
  const ratingOf = new Map(season.teams.map((t) => [t.id, t.rating ?? MISSING_RATING]));
  const inConf = [...data.ids];

  // Title-game win probability on a neutral site, per ordered pair, computed lazily.
  const neutral = new Map<number, number>();
  const tgProb = (a: number, b: number): number => {
    const key = a * 4294967296 + b;
    let p = neutral.get(key);
    if (p === undefined) {
      const g: Game = {
        id: -1, week: 0, start: "", neutralSite: true, conferenceGame: false, homeId: a, awayId: b,
        homePoints: null, awayPoints: null, completed: false, spread: null,
      };
      p = gameWinProbability(season, g);
      neutral.set(key, p);
    }
    return p;
  };

  // Tiebreak draws and the title-game roll come from fresh streams seeded per
  // iteration (never a shared stream), so iteration k's draws don't depend on
  // how many draws earlier iterations used and what-if runs stay paired.
  const titleGame = new Map<number, number>(inConf.map((id) => [id, 0]));
  const champion = new Map<number, number>(inConf.map((id) => [id, 0]));
  const playoff = new Map<number, number>(fbs.map((t) => [t.id, 0]));
  const score = new Map<number, number>();
  const w = new Map<number, number>();
  const l = new Map<number, number>();

  sim.forEachIteration((iteration, winnerAt) => {
    const rand = mulberry32(mix(seed, iteration, 1));
    const winnerOf = (g: Game): number => winnerAt(gameIndex.get(g.id)!);
    const [a, b] = championshipFromData(data, conference, winnerOf, { draw: rand });
    titleGame.set(a, titleGame.get(a)! + 1);
    titleGame.set(b, titleGame.get(b)! + 1);
    const champ = mulberry32(mix(seed, iteration, 2))() < tgProb(a, b) ? a : b;
    champion.set(champ, champion.get(champ)! + 1);

    w.clear();
    l.clear();
    for (let i = 0; i < season.games.length; i++) {
      const g = season.games[i];
      const win = winnerAt(i);
      const lose = win === g.homeId ? g.awayId : g.homeId;
      w.set(win, (w.get(win) ?? 0) + 1);
      l.set(lose, (l.get(lose) ?? 0) + 1);
    }
    // The title game is itself a game; its result counts toward the ordering.
    w.set(champ, (w.get(champ) ?? 0) + 1);
    const loser = champ === a ? b : a;
    l.set(loser, (l.get(loser) ?? 0) + 1);

    score.clear();
    for (const t of fbs) {
      score.set(t.id, (w.get(t.id) ?? 0) - 1.5 * (l.get(t.id) ?? 0) + ratingOf.get(t.id)! / 10);
    }
    const ranked = fbs.map((t) => t.id).sort((x, y) => score.get(y)! - score.get(x)! || x - y);
    const inField = new Set(ranked.slice(0, PLAYOFF_FIELD));
    inField.add(champ);
    for (const id of inField) playoff.set(id, (playoff.get(id) ?? 0) + 1);
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
      record: teamRecord(season, id),
      expectedWins: sim.teams[id].expectedWins,
      expectedConferenceWins: sim.teams[id].expectedConferenceWins,
      titleGame: titleGame.get(id)! / n,
      champion: champion.get(id)! / n,
      playoff: (playoff.get(id) ?? 0) / n,
      status: statusOf(titleGame.get(id)! / n, id),
    })),
  };
}
