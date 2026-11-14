// What the national view shows (phase 5): the projected playoff field and bracket, each spot's odds, the bubble, and
// which results elsewhere move one team's playoff odds. All wording lives here so black-box tests can check it.
import type { NationalResult } from "./national";
import { PROJECTED_NOTE, formatFine, formatOdds } from "./paths";
import { bracketGames, playoffField } from "./playoff";
import type { Season } from "./season";
import { HOME_FIELD } from "./odds";
import { mix, mulberry32, neutralOdds, type SimResult } from "./sim";
import { OVERALL, isClear } from "./signal";
import { pairKey } from "./steps";

export type FieldSpot = {
  seed: number;
  teamId: number;
  /** Share of seasons it makes the field at all. */
  field: number;
  /** Share of seasons it is exactly this seed. */
  atSeed: number;
  bye: number;
  champion: number;
  /**
   * "In 92% · seed 3 in 31%"; once the field is announced, "National title 23%", "First-round bye · national title
   * 31%" (before its first game), "Beat Ohio State 24-14 in the
   * quarterfinal · national title 41%", "Lost to Miami 24-14 in the quarterfinal" or "Won the national title, 27-21
   * over Miami".
   */
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
  /** Once played (the announced field's real game): "Indiana 38, Alabama 3", the winner first. Null before. */
  result: string | null;
};

export type BubbleTeam = { teamId: number; field: number; text: string };

export type NationalView = {
  teams: 4 | 12;
  /** Whether the field is the one the committee announced (`NationalResult.announced`), not a projection. */
  announced: boolean;
  /** "Projected playoff field", or "Playoff field" once announced. */
  heading: string;
  /** "Projected bracket", or "Bracket" once the field is announced. */
  bracketHeading: string;
  /** The projected field (the announced one once it is), seed 1 first. */
  field: FieldSpot[];
  bracket: BracketGame[];
  /** The likeliest teams outside the projected field, best odds first; empty once the field is announced. */
  bubble: BubbleTeam[];
  /** "Projected from 20,000 simulated seasons. …", or what the announced field's odds come from. */
  note: string;
};

/**
 * The projected field: the teams with the best field odds, as many as the format takes, ordered by their average
 * seed in the seasons they get in. Once the committee has announced the field (`NationalResult.announced`), that
 * field instead, each team's run so far, and the bracket's results from `opts.season`'s playoff games (needed for
 * results and team names in them). Null when the
 * national run has no playoff.
 */
export function nationalView(national: NationalResult, opts: {
  bubble?: number;
  season?: Season;
  /**
   * Seed the projected field from this ranking instead (best first, every FBS team) with these conference champions,
   * under the season's format (`playoffField`; needs `season`). Each spot keeps its simulated odds; the bubble is the
   * next teams in the ranking. Ignored once the field is announced.
   */
  ranking?: { order: readonly number[]; champions: readonly number[] };
} = {}): NationalView | null {
  if (!national.playoff) return null;
  const T = national.teams.find((t) => t.playoff)!.playoff!.seeds.length as 4 | 12;
  const games = bracketGames(T);
  const roundOf = (g: number): BracketGame["round"] => {
    if (g === games.length - 1) return "Final";
    if (T === 4) return "Semifinal";
    return g < 4 ? "First round" : g < 8 ? "Quarterfinal" : "Semifinal";
  };
  const iterations = national.iterations.toLocaleString("en-US");
  if (national.announced) return announcedView(national, opts.season, T, games, roundOf, iterations);

  if (opts.ranking && opts.season) return rankedView(national, opts.season, opts.ranking, T, games, roundOf, iterations, opts.bubble ?? 6);

  const withOdds = national.teams.filter((t) => t.playoff !== null && t.playoff.field > 0);
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
  const side = (x: number): BracketSide => (x >= 0 ? { teamId: field[x].teamId, seed: x + 1 } : { winnerOf: ~x });
  const bracket = games.map(([a, b, home], index) => ({
    index, round: roundOf(index), a: side(a), b: side(b), site: home ? "At the higher seed" : "Neutral site", result: null,
  }));
  return {
    teams: T, announced: false, heading: "Projected playoff field", bracketHeading: "Projected bracket", field, bracket, bubble,
    note: `Projected from ${iterations} simulated seasons. Modelled odds, not a prediction of the committee.`,
  };
}

/** The field the format picks from a ranking, its bracket, and the next teams in the ranking as the bubble. */
function rankedView(
  national: NationalResult, season: Season, ranking: { order: readonly number[]; champions: readonly number[] }, T: 4 | 12,
  games: ReturnType<typeof bracketGames>, roundOf: (g: number) => BracketGame["round"], iterations: string, bubbleSize: number,
): NationalView {
  const seeds = playoffField(season, ranking.order, ranking.champions);
  const byId = new Map(national.teams.map((t) => [t.teamId, t]));
  const field: FieldSpot[] = seeds.map((id, k) => {
    const p = byId.get(id)?.playoff;
    const [inOdds, atSeed] = [p?.field ?? 0, p?.seeds[k] ?? 0];
    return {
      seed: k + 1, teamId: id, field: inOdds, atSeed, bye: p?.bye ?? 0, champion: p?.champion ?? 0,
      text: `In ${formatOdds(inOdds)} · seed ${k + 1} in ${formatOdds(atSeed)}`,
    };
  });
  const seeded = new Set(seeds);
  const bubble = ranking.order.filter((id) => !seeded.has(id)).slice(0, bubbleSize).map((id) => {
    const odds = byId.get(id)?.playoff?.field ?? 0;
    return { teamId: id, field: odds, text: `In ${formatFine(odds)}` };
  });
  const side = (x: number): BracketSide => (x >= 0 ? { teamId: field[x].teamId, seed: x + 1 } : { winnerOf: ~x });
  const bracket = games.map(([a, b, home], index) => ({
    index, round: roundOf(index), a: side(a), b: side(b), site: home ? "At the higher seed" : "Neutral site", result: null,
  }));
  return {
    teams: T, announced: false, heading: "Projected playoff field", bracketHeading: "Projected bracket", field, bracket, bubble,
    note: `Seeded from the committee's latest ranking, moved by results since and your picks. Each power conference's champion is its picked one, else whichever of its two likeliest title-game teams wins that game more often. Chances in from ${iterations} simulated seasons, every game played out: a seed is where things stand, the chance how often it holds.`,
  };
}

/** The announced field and its bracket, each game's result once played and each team's run so far. */
function announcedView(
  national: NationalResult, season: Season | undefined, T: 4 | 12, games: ReturnType<typeof bracketGames>,
  roundOf: (g: number) => BracketGame["round"], iterations: string,
): NationalView {
  const seeds = national.announced!.seeds;
  const byId = new Map(national.teams.map((t) => [t.teamId, t]));
  const field: FieldSpot[] = seeds.map((id, k) => {
    const p = byId.get(id)?.playoff ?? null;
    const run = p?.run ?? null;
    const odds = `national title ${formatFine(p?.champion ?? 0)}`;
    const tail = run?.text.includes(": ") ? run.text.slice(run.text.indexOf(": ") + 2) : "";
    const bye = T === 12 && k < 4;
    // Before its first game, a bye team's run says so: "First-round bye · national title 23%".
    const said = tail !== "" ? tail[0].toUpperCase() + tail.slice(1) : run?.state === "in" && bye ? "First-round bye" : "";
    const text = run?.state === "in" ? (said ? `${said} · ${odds}` : odds[0].toUpperCase() + odds.slice(1)) : said;
    return { seed: k + 1, teamId: id, field: 1, atSeed: 1, bye: bye ? 1 : 0, champion: p?.champion ?? 0, text };
  });
  // The bracket as played: each game's two teams once the games feeding it are final, its result once it is.
  const name = (id: number) => season?.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;
  const seedOf = new Map(seeds.map((id, k) => [id, k + 1]));
  const finals = new Map((season?.playoffGames ?? []).filter((g) => g.completed).map((g) => [pairKey(g.homeId, g.awayId), g]));
  const winners: (number | null)[] = [];
  const bracket: BracketGame[] = games.map(([x, y, home], index) => {
    const team = (v: number): number | null => (v >= 0 ? seeds[v] : winners[~v]);
    const [a, b] = [team(x), team(y)];
    const real = a !== null && b !== null ? finals.get(pairKey(a, b)) : undefined;
    const winner = real ? (real.homePoints! > real.awayPoints! ? real.homeId : real.awayId) : null;
    winners.push(winner);
    const side = (id: number | null, v: number): BracketSide => (id !== null ? { teamId: id, seed: seedOf.get(id)! } : { winnerOf: ~v });
    const result = real && winner !== null
      ? `${name(winner)} ${Math.max(real.homePoints!, real.awayPoints!)}, ${name(winner === real.homeId ? real.awayId : real.homeId)} ${Math.min(real.homePoints!, real.awayPoints!)}`
      : null;
    return { index, round: roundOf(index), a: side(a, x), b: side(b, y), site: home ? "At the higher seed" : "Neutral site", result };
  });
  return {
    teams: T, announced: true, heading: "Playoff field", bracketHeading: "Bracket", field, bracket, bubble: [],
    note: `The field and seeds the committee announced, with the results so far. National-title odds from ${iterations} simulated playoffs: modelled, not a prediction.`,
  };
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
  /** "Root for Utah over BYU: 34% if Utah wins, 22% if BYU does.", plus " A projected matchup, not yet confirmed." for one. */
  text: string;
  /** A matchup the conference projected but hasn't confirmed (the Pac-12's flex week). */
  projected: boolean;
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
      text: `Root for ${name(good)} over ${name(bad)}: ${formatFine(pGood)} if ${name(good)} wins, ${formatFine(pBad)} if ${name(bad)} does.${g.projected ? ` ${PROJECTED_NOTE}.` : ""}`,
      projected: g.projected === true,
    });
  });
  out.sort((x, y) => y.swing - x.swing || x.gameId - y.gameId);
  return out.slice(0, max);
}

/**
 * Plays out a bracket's open games: one draw from each game's odds, `picked` winners kept, a first-round game at the
 * higher seed's home and every later one at a neutral site. Returns every game's winner by index; a game with an
 * unknown side is skipped. It doesn't read `result`: for a bracket with games already played, pass their winners in
 * `picked`.
 */
export function simulateBracket(season: Season, games: BracketGame[], picked: Record<number, number>, seed: number): Record<number, number> {
  const odds = neutralOdds(season);
  const out: Record<number, number> = { ...picked };
  const rand = mulberry32(mix(seed, 2, 0x8b4c));
  const team = (s: BracketSide) => ("teamId" in s ? s : out[s.winnerOf] !== undefined ? { teamId: out[s.winnerOf], seed: seedOf.get(out[s.winnerOf]) ?? 99 } : null);
  const seedOf = new Map(games.flatMap((g) => [g.a, g.b]).flatMap((s) => ("teamId" in s ? [[s.teamId, s.seed] as const] : [])));
  for (const g of [...games].sort((x, y) => x.index - y.index)) {
    const a = team(g.a), b = team(g.b);
    if (!a || !b) continue;
    if (out[g.index] === a.teamId || out[g.index] === b.teamId) continue;
    const [hi, lo] = a.seed <= b.seed ? [a, b] : [b, a];
    const p = odds(hi.teamId, lo.teamId, 0, 0, g.site === "Neutral site" ? 0 : HOME_FIELD);
    out[g.index] = rand() < p ? hi.teamId : lo.teamId;
  }
  return out;
}
