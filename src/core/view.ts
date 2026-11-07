// What the national view shows (phase 5): the projected playoff field and bracket, each spot's odds, the bubble, and
// which results elsewhere move one team's playoff odds. All wording lives here so black-box tests can check it.
import type { NationalResult } from "./national";
import { formatFine, formatOdds } from "./paths";
import { bracketGames } from "./playoff";
import type { Season } from "./season";
import type { SimResult } from "./sim";
import { OVERALL, isClear } from "./signal";

export type FieldSpot = {
  seed: number;
  teamId: number;
  /** Share of seasons it makes the field at all. */
  field: number;
  /** Share of seasons it is exactly this seed. */
  atSeed: number;
  bye: number;
  champion: number;
  /** "In 92% · seed 3 in 31%" */
  text: string;
};

export type BracketSide = { teamId: number; seed: number } | { winnerOf: number };

export type BracketGame = {
  index: number;
  round: "First round" | "Quarterfinal" | "Semifinal" | "Final";
  a: BracketSide;
  b: BracketSide;
  /** "At the higher seed" or "Neutral site". */
  site: string;
};

export type BubbleTeam = { teamId: number; field: number; text: string };

export type NationalView = {
  teams: 4 | 12;
  /** The projected field, seed 1 first. */
  field: FieldSpot[];
  bracket: BracketGame[];
  /** The likeliest teams outside the projected field, best odds first. */
  bubble: BubbleTeam[];
  /** "Projected from 20,000 simulated seasons." */
  note: string;
};

/**
 * The projected field: the teams with the best field odds, as many as the format takes, ordered by their average
 * seed in the seasons they get in. Null when the national run has no playoff.
 */
export function nationalView(national: NationalResult, opts: { bubble?: number } = {}): NationalView | null {
  if (!national.playoff) return null;
  const withOdds = national.teams.filter((t) => t.playoff !== null && t.playoff.field > 0);
  const T = national.teams.find((t) => t.playoff)!.playoff!.seeds.length as 4 | 12;
  const byField = [...withOdds].sort((a, b) => b.playoff!.field - a.playoff!.field || a.teamId - b.teamId);
  const meanSeed = (p: NonNullable<(typeof withOdds)[number]["playoff"]>) =>
    p.seeds.reduce((s, x, k) => s + x * (k + 1), 0) / p.field;
  const inField = byField.slice(0, T).sort((a, b) => meanSeed(a.playoff!) - meanSeed(b.playoff!) || a.teamId - b.teamId);
  const field: FieldSpot[] = inField.map((t, k) => {
    const p = t.playoff!;
    return {
      seed: k + 1, teamId: t.teamId, field: p.field, atSeed: p.seeds[k], bye: p.bye, champion: p.champion,
      text: `In ${formatOdds(p.field)} · seed ${k + 1} in ${formatOdds(p.seeds[k])}`,
    };
  });
  const bubble = byField.slice(T, T + (opts.bubble ?? 6)).map((t) => ({
    teamId: t.teamId, field: t.playoff!.field, text: `In ${formatFine(t.playoff!.field)}`,
  }));
  const games = bracketGames(T);
  const side = (x: number): BracketSide => (x >= 0 ? { teamId: field[x].teamId, seed: x + 1 } : { winnerOf: ~x });
  const roundOf = (g: number): BracketGame["round"] => {
    if (g === games.length - 1) return "Final";
    if (T === 4) return "Semifinal";
    return g < 4 ? "First round" : g < 8 ? "Quarterfinal" : "Semifinal";
  };
  const bracket = games.map(([a, b, home], index) => ({
    index, round: roundOf(index), a: side(a), b: side(b), site: home ? "At the higher seed" : "Neutral site",
  }));
  return { teams: T, field, bracket, bubble, note: `Projected from ${national.iterations.toLocaleString("en-US")} simulated seasons. Modelled odds, not a prediction of the committee.` };
}

export type PlayoffSignal = {
  gameId: number;
  homeId: number;
  awayId: number;
  /** The team's playoff-field odds in the seasons the home or away team wins this game. */
  oddsIfHomeWins: number;
  oddsIfAwayWins: number;
  swing: number;
  /** The side whose win helps. */
  rooting: number;
  /** "Root for Utah over BYU: 34% if Utah wins, 22% if BYU does." */
  text: string;
};

/**
 * Unplayed games not involving the team that clearly move its playoff odds (the OVERALL bar in signal.ts), biggest
 * swing first. `sim` must be the season simulation `national` was run on (same iterations, seed and locks).
 */
export function playoffSignals(season: Season, sim: SimResult, national: NationalResult, teamId: number, max = 8): PlayoffSignal[] {
  if (!national.playoff || sim.iterations !== national.iterations) return [];
  const n = sim.iterations;
  const candidates = season.games
    .map((g, index) => ({ g, index }))
    .filter(({ g }) => !g.completed && g.homeId !== teamId && g.awayId !== teamId);
  if (candidates.length === 0) return [];
  const homeWon = new Uint8Array(n * candidates.length);
  sim.forEachIteration((it, winnerOf) => {
    candidates.forEach(({ g, index }, k) => {
      if (winnerOf(index) === g.homeId) homeWon[it * candidates.length + k] = 1;
    });
  });
  const inField = new Uint8Array(n);
  national.forEachIteration((it, s) => {
    if (s.field?.includes(teamId)) inField[it] = 1;
  });
  const name = (id: number) => season.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;
  const out: PlayoffSignal[] = [];
  candidates.forEach(({ g }, k) => {
    let hn = 0, hIn = 0, aIn = 0;
    for (let it = 0; it < n; it++) {
      if (homeWon[it * candidates.length + k]) { hn++; hIn += inField[it]; } else aIn += inField[it];
    }
    const an = n - hn;
    if (!isClear(hn, hIn, an, aIn, OVERALL)) return;
    const oddsIfHomeWins = hIn / hn, oddsIfAwayWins = aIn / an;
    const [good, bad, pGood, pBad] = oddsIfHomeWins >= oddsIfAwayWins
      ? [g.homeId, g.awayId, oddsIfHomeWins, oddsIfAwayWins] : [g.awayId, g.homeId, oddsIfAwayWins, oddsIfHomeWins];
    out.push({
      gameId: g.id, homeId: g.homeId, awayId: g.awayId, oddsIfHomeWins, oddsIfAwayWins,
      swing: Math.abs(oddsIfHomeWins - oddsIfAwayWins), rooting: good,
      text: `Root for ${name(good)} over ${name(bad)}: ${formatFine(pGood)} if ${name(good)} wins, ${formatFine(pBad)} if ${name(bad)} does.`,
    });
  });
  out.sort((x, y) => y.swing - x.swing || x.gameId - y.gameId);
  return out.slice(0, max);
}
