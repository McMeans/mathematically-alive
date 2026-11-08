// Conference championship game participants under the conference's tiebreak rules (rules.ts), plus a plain
// standings table. Pure: callers supply the winner of every unplayed game, so a simulator can call this once per
// iteration.
//
// One engine for every conference: teams are ordered by conference win pct, and a tie is resolved by the rules'
// steps (steps.ts) for the spots still open. Each step either can't tell the tied teams apart (go on to the next
// step), or names the teams at the top of its order:
// - one alone at the top is placed, and the rest start over for any spot left;
// - several at the top that fit the open spots are all in, seeded by starting over among them;
// - otherwise those at the top start over (from the first step, or the next one, as the step says) and the rest
//   are out of this tie.
// With `spots: "one"` a tie is resolved for one spot at a time, and the rest are re-tied from scratch after each.
// Rules with a two-team procedure (`twoTeam`) use it whenever two teams are tied, including a bigger tie cut to two.

import { countsNonConference as needsNonConference, tiebreakRules, type TiebreakRules } from "./rules";
import { titleGameIndex } from "./committee";
import type { Game, Season } from "./season";
import { comparePct, isTitleGame, pairKey, winnerIn, type Context, type Members, type Row, type Step } from "./steps";

export type ConferenceStanding = {
  teamId: number;
  wins: number;
  losses: number;
  /** wins / (wins + losses); 0 when no games were played. */
  pct: number;
};

export type TiebreakOptions = {
  /** Uniform random draw in [0, 1), used only when every other step ties. Told how many teams it picks among. */
  draw: (count: number) => number;
  /** Higher is better. Stands in for the SportSource Team Success Ranking. Defaults to the team's rating. */
  rank?: (teamId: number) => number;
};

/** Per-conference data that doesn't change between simulated seasons, with the conference's rules. */
export type ConferenceData = Members & {
  rules: TiebreakRules;
  /** Members who can play in the title game: all but those barred from the postseason (`Team.postseasonBan`). */
  eligible: ReadonlySet<number>;
  /**
   * The title game the data marks (`Game.titleGame`), once every conference game is final: CFBD lists it when the matchup is set, so its
   * two teams play, whatever the tiebreak would say (the real ranking or coin toss can differ from the stand-in's).
   * Null before.
   */
  decided: Game | null;
};

/** Conferences whose tiebreak counts non-conference results (the Big 12's total-wins step). Not part of the public API. */
export const countsNonConference = (data: ConferenceData): boolean => needsNonConference(data.rules);

/** The tiebreak steps a team's way in can still hinge on once its results are set, as the likeliest-way note names them. Not part of the public API. */
export const luckSteps = (data: ConferenceData): string => data.rules.luckSteps;

function members(season: Season, conference: string): Members {
  const ids = new Set(season.teams.filter((t) => t.conference === conference).map((t) => t.id));
  const games = season.games.filter((g) => g.conferenceGame && ids.has(g.homeId) && ids.has(g.awayId));
  const pairs = new Map<number, Game[]>();
  for (const g of games) {
    const k = pairKey(g.homeId, g.awayId);
    const list = pairs.get(k);
    if (list) list.push(g);
    else pairs.set(k, [g]);
  }
  const schedule = new Map<number, Game[]>([...ids].map((id) => [id, []]));
  for (const g of season.games) {
    schedule.get(g.homeId)?.push(g);
    schedule.get(g.awayId)?.push(g);
  }
  // The title game comes after the tiebreak, so it needn't be played yet.
  const scored = [...schedule.values()].every((list) => list.every((g) => g.completed || isTitleGame({ ids }, g)));
  return {
    ids, games, pairs, schedule, scored, divisionOf: null,
    ratings: new Map(season.teams.map((t) => [t.id, t.rating])),
    classes: new Map(season.teams.map((t) => [t.id, t.classification])),
  };
}

/** Not part of the public API. Throws for a conference of fewer than two teams, or one with no rules for the season. */
export function conferenceData(season: Season, conference: string): ConferenceData {
  const data = members(season, conference);
  if (data.ids.size < 2) throw new Error(`${conference} has fewer than two teams`);
  const rules = tiebreakRules(conference, season.year);
  const eligible = new Set(season.teams.filter((t) => data.ids.has(t.id) && !t.postseasonBan).map((t) => t.id));
  const divisionOf = rules.divisions ? divisionsOf(season, data.ids, conference, rules.divisions) : null;
  // Barred members' games still count for everyone's record and every tiebreak step; they are just never picked.
  if (divisionOf) {
    for (const d of new Set(divisionOf.values())) {
      if (![...eligible].some((id) => divisionOf.get(id) === d)) throw new Error(`${conference}'s ${d} division has no team eligible for the postseason`);
    }
  } else if (eligible.size < 2) throw new Error(`${conference} has fewer than two teams eligible for the postseason`);
  // Only a title game the data marks (seasonFromCfbd), never one guessed in a season built some other way.
  const i = titleGameIndex(season, data.ids);
  const decided = i >= 0 && season.games[i].titleGame === true && data.games.every((g) => g.completed) ? season.games[i] : null;
  return { ...data, rules, eligible, divisionOf, decided };
}

/** Each member's division. Throws when a member is in no division, or a listed school isn't a member. */
function divisionsOf(season: Season, ids: Set<number>, conference: string, divisions: Readonly<Record<string, readonly string[]>>): Map<number, string> {
  const out = new Map<number, string>();
  for (const [division, names] of Object.entries(divisions)) {
    for (const name of names) {
      const t = season.teams.find((x) => x.name === name && ids.has(x.id));
      if (!t) throw new Error(`${name}, in ${conference}'s ${division} division, isn't a ${conference} member in ${season.year}`);
      out.set(t.id, division);
    }
  }
  const missing = season.teams.filter((t) => ids.has(t.id) && !out.has(t.id)).map((t) => t.name);
  if (missing.length > 0) throw new Error(`${missing.join(", ")} in no ${conference} division`);
  return out;
}

/**
 * The teams a team competes with for a title-game spot, itself included (its division, or the whole conference), and
 * how many spots they compete for (1 or 2). A member barred from the postseason takes no spot, so it is no rival.
 * Not part of the public API.
 */
export function race(data: ConferenceData, teamId: number): { rivals: number[]; spots: number } {
  const d = data.divisionOf;
  const rivals = [...data.ids].filter((id) => id === teamId || data.eligible.has(id));
  if (!d) return { rivals, spots: 2 };
  return { rivals: rivals.filter((id) => d.get(id) === d.get(teamId)), spots: 1 };
}

function rows(data: Members, winnerOf: (game: Game) => number): Row[] {
  const byId = new Map<number, Row>();
  for (const id of data.ids) byId.set(id, { teamId: id, wins: 0, losses: 0, games: 0 });
  for (const g of data.games) {
    const w = winnerIn(g, winnerOf);
    const l = w === g.homeId ? g.awayId : g.homeId;
    byId.get(w)!.wins++;
    byId.get(l)!.losses++;
  }
  for (const r of byId.values()) r.games = r.wins + r.losses;
  return [...byId.values()];
}

/** Teams in the conference, best conference record first. */
export function conferenceStandings(
  season: Season,
  conference: string,
  winnerOf: (game: Game) => number,
): ConferenceStanding[] {
  return rows(members(season, conference), winnerOf)
    .sort((a, b) => comparePct(b, a) || b.wins - a.wins || a.losses - b.losses || a.teamId - b.teamId)
    .map(({ teamId, wins, losses, games }) => ({ teamId, wins, losses, pct: games === 0 ? 0 : wins / games }));
}

/**
 * The two teams that play for the conference title: [seed 1, seed 2]. `winnerOf` gives the winner of every
 * conference game, played or not; where the rules count non-conference results (the Big 12's total wins) it is
 * also asked about unplayed non-conference games. Throws for a conference with no rules for the season.
 */
export function championshipParticipants(
  season: Season,
  conference: string,
  winnerOf: (game: Game) => number,
  opts: TiebreakOptions,
): [number, number] {
  return rulesPick(conferenceData(season, conference), winnerOf, opts);
}

const searchedSteps = new WeakMap<readonly Step[], readonly (Step | null)[]>();
/** A list of steps as proofs run it: steps that count non-conference results skipped (null). */
const conferenceSteps = (list: readonly Step[]): readonly (Step | null)[] => {
  let steps = searchedSteps.get(list);
  if (!steps) {
    steps = list.map((s) => (s.nonConference ? null : s));
    searchedSteps.set(list, steps);
  }
  return steps;
};

/** A tie's outcome: the teams placed, best seed first, or (rules with `drop: "retie"`) a team out of the race. */
type Outcome = { placed: number[] } | { drop: number };

type PickOptions = TiebreakOptions & {
  /** False: skip steps that need non-conference results (the Big 12's total wins), leaving them to `rank`. */
  allGames?: boolean;
  /** Collects the name of every step that told tied teams apart, in the order they ran. */
  trace?: string[];
};

/**
 * The title game's two teams, [seed 1, seed 2]: the data's title game once it decides (`ConferenceData.decided`),
 * seeded as the rules seed them when they pick the same two (else the home team first); otherwise the rules' pick,
 * as championshipParticipants. Not part of the public API.
 */
export function championshipFromData(data: ConferenceData, winnerOf: (game: Game) => number, opts: PickOptions): [number, number] {
  const g = data.decided;
  if (!g) return rulesPick(data, winnerOf, opts);
  const [a, b] = rulesPick(data, winnerOf, opts);
  return (a === g.homeId && b === g.awayId) || (a === g.awayId && b === g.homeId) ? [a, b] : [g.homeId, g.awayId];
}

export type DecidedTitleGame = {
  /** [seed 1, seed 2]. */
  teams: [number, number];
  /** The tiebreak steps that told tied teams apart, first to last, each once; empty when records alone decided. */
  steps: string[];
};

/**
 * The title game's two teams when every result the rules look at is set by `winnerOf` (`set` says which games
 * are), with the steps that decided: null while a game the rules count is still open. Not part of the public API.
 */
export function decidedTitleGame(data: ConferenceData, set: (game: Game) => boolean, winnerOf: (game: Game) => number, opts: TiebreakOptions): DecidedTitleGame | null {
  const open = (g: Game) => !g.completed && !set(g);
  if (data.games.some(open)) return null;
  if (countsNonConference(data) && [...data.ids].some((id) => data.schedule.get(id)!.some((g) => !isTitleGame(data, g) && open(g)))) return null;
  const trace: string[] = [];
  const teams = championshipFromData(data, winnerOf, { ...opts, trace });
  return { teams, steps: [...new Set(trace)] };
}

/** The two teams the rules pick, [seed 1, seed 2]. */
function rulesPick(data: ConferenceData, winnerOf: (game: Game) => number, opts: PickOptions): [number, number] {
  const { rules } = data;
  const table = rows(data, winnerOf);
  const ctx: Context = {
    data, winnerOf, draw: opts.draw,
    rank: opts.rank ?? ((id: number) => data.ratings.get(id) ?? -Infinity),
    rowOf: new Map(table.map((r) => [r.teamId, r])),
  };
  const run = (list: readonly Step[]): readonly (Step | null)[] => (opts.allGames === false ? conferenceSteps(list) : list);
  const multi = run(rules.steps);
  const twoSpot = rules.twoTeam ? run(rules.twoTeam.spot) : multi;
  const twoSeed = rules.twoTeam ? run(rules.twoTeam.seed) : multi;
  /** The steps for a tie of `n` teams; `seeding`: all of them are in, only their order is open. */
  const stepsFor = (n: number, seeding: boolean) => (n !== 2 ? multi : seeding ? twoSeed : twoSpot);

  /** Choose `spots` of the tied teams `ids`, trying steps from `from` on (`seeding`: ordering teams already in). */
  const pick = (ids: number[], spots: number, from: number, seeding = false): Outcome => {
    if (ids.length <= spots) return seed(ids);
    const steps = stepsFor(ids.length, seeding);
    for (let i = from; i < steps.length; i++) {
      const step = steps[i];
      if (step === null) continue;
      const r = step.run(ids, ctx, spots);
      if (r === null) continue;
      opts.trace?.push(step.name);
      if ("picked" in r) return { placed: r.picked };
      if ("drop" in r) return rules.drop === "retie" ? r : pick(ids.filter((id) => id !== r.drop), spots, 0, seeding);
      const { top } = r;
      if (top.length < spots) {
        // All of them are in; the rest start over for the spots left.
        const first = seed(top);
        if ("drop" in first) return first;
        const rest = pick(ids.filter((id) => !top.includes(id)), spots - top.length, 0);
        return "drop" in rest ? rest : { placed: [...first.placed, ...rest.placed] };
      }
      // A tie cut to two goes to the two-team procedure, from its first step, unless it is the same list.
      const restart = step.restart && rules.cut !== "continue";
      return pick(top, spots, restart || stepsFor(top.length, seeding) !== steps ? 0 : i + 1, seeding);
    }
    throw new Error(`${rules.conference}'s last tiebreak step didn't decide`);
  };

  /** Every one of `ids` is in: order them best-first by placing one at a time. */
  const seed = (ids: number[]): { placed: number[] } => {
    const out: number[] = [];
    const tail: number[] = [];
    let rest = ids;
    while (rest.length > 1) {
      const r = pick(rest, 1, 0, true);
      const id = "drop" in r ? r.drop : r.placed[0];
      if ("drop" in r) tail.unshift(id);
      else out.push(id);
      rest = rest.filter((x) => x !== id);
    }
    return { placed: [...out, ...rest, ...tail] };
  };

  /** "Tied teams": the best pct, plus (the game-count rule) teams with a different game count matching wins or losses. */
  const tiedTeams = (cands: Row[]): Row[] => {
    let best = cands[0];
    for (const r of cands) if (comparePct(r, best) > 0) best = r;
    const top = cands.filter((r) => comparePct(r, best) === 0);
    if (!rules.gameCountTies) return top;
    const extra = cands.filter(
      (r) => !top.includes(r) && top.some((t) => t.games !== r.games && (t.wins === r.wins || t.losses === r.losses)),
    );
    return [...top, ...extra];
  };

  if (data.divisionOf) {
    // Each division's champion: the best conference win pct there, a tie broken among those teams for one spot.
    const divisionOf = data.divisionOf;
    const champions = [...new Set(divisionOf.values())].map((d) => {
      const group = tiedTeams(table.filter((r) => divisionOf.get(r.teamId) === d && data.eligible.has(r.teamId))).map((r) => r.teamId);
      if (group.length === 1) return group[0];
      const r = pick(group, 1, 0);
      if ("drop" in r) throw new Error(`${rules.conference}'s tiebreak can't drop a team out of a division race`);
      return r.placed[0];
    });
    if (champions.length !== 2) throw new Error(`${rules.conference} needs two divisions, not ${champions.length}`);
    const [a, b] = champions.map((id) => ctx.rowOf.get(id)!);
    const c = comparePct(a, b);
    if (c !== 0) return c > 0 ? [a.teamId, b.teamId] : [b.teamId, a.teamId];
    const [first, second] = seed([a.teamId, b.teamId]).placed;
    return [first, second];
  }

  const result: number[] = [];
  let slots = 2;
  let cands = table.filter((r) => data.eligible.has(r.teamId));
  while (slots > 0 && cands.length > 0) {
    const tied = tiedTeams(cands);
    if (tied.length <= slots) {
      // All in, each pct level in order.
      const levels = [...tied].sort((a, b) => comparePct(b, a));
      for (let i = 0; i < levels.length; ) {
        let j = i;
        while (j < levels.length && comparePct(levels[j], levels[i]) === 0) j++;
        result.push(...seed(levels.slice(i, j).map((r) => r.teamId)).placed);
        i = j;
      }
      slots -= tied.length;
      cands = cands.filter((r) => !tied.includes(r));
      continue;
    }
    // Break starting with the highest win pct.
    const best = tied[0];
    const group = tied.filter((r) => comparePct(r, best) === 0).map((r) => r.teamId);
    const r = pick(group, rules.spots === "open" ? slots : 1, 0);
    const gone = "drop" in r ? [r.drop] : r.placed;
    if ("placed" in r) {
      result.push(...r.placed);
      slots -= r.placed.length;
    }
    cands = cands.filter((c) => !gone.includes(c.teamId));
  }
  return [result[0], result[1]];
}
