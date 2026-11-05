// Each conference's title-game tiebreak rules, per season, as config for the engine in tiebreak.ts. Every entry
// cites its source document. A conference or season with no entry is an error, never another conference's rules.

import {
  commonOpponents,
  draw,
  headToHead,
  opponentsWinPct,
  placedCommonOpponent,
  ranking,
  scheduleStrength,
  scoringMargin,
  totalWins,
  type Step,
} from "./steps";

export type TiebreakRules = {
  conference: string;
  /** Seasons these rules cover. */
  seasons: readonly number[];
  /** The official document, by name and, where one is published, URL. */
  source: string;
  /** In order; the last one always decides. */
  steps: readonly Step[];
  /**
   * "open": a tie is resolved for every open spot at once (a step's top teams fill the spots when they fit,
   * otherwise they start over and the rest are out). "one": one team is placed at a time and the rest are
   * re-tied from scratch.
   */
  spots: "open" | "one";
  /**
   * A team a step drops: "restart" leaves it out of this tie and starts over among the rest; "retie" takes it out
   * of the race and re-ties everyone left from scratch, game-count rule included.
   */
  drop: "restart" | "retie";
  /**
   * The ACC's game-count rule: teams with a different number of conference games are tied with the teams at the
   * best win pct when their wins or losses match. Proofs' shortcuts consult it too.
   */
  gameCountTies: boolean;
  /** The steps a way in can still hinge on once its results are set, as the likeliest-way note names them. */
  luckSteps: string;
};

const ACC: TiebreakRules = {
  conference: "ACC",
  seasons: [2026],
  source: "ACC football championship game tiebreaker policy, July 2026 (theacc.com)",
  steps: [headToHead({ record: "opponents", lostToAll: true }), ranking({ restart: false }), draw()],
  spots: "one",
  drop: "retie",
  gameCountTies: true,
  luckSteps: "the ranking tiebreak",
};

const BIG_12: TiebreakRules = {
  conference: "Big 12",
  seasons: [2026],
  source: "Big 12 Football Tiebreaking Procedures, 2024 season (the latest published): https://s3.amazonaws.com/big12sports.com/documents/2025/11/4/Big_12_Football_2024_Tiebreaker_Policy.pdf",
  steps: [
    headToHead({ record: "games", lostToAll: false }),
    commonOpponents(),
    placedCommonOpponent({ level: "group" }),
    scheduleStrength(),
    totalWins({ belowFbs: 1 }),
    ranking({ restart: false }),
    draw(),
  ],
  spots: "one",
  drop: "restart",
  gameCountTies: false,
  luckSteps: "total wins and the ranking tiebreak",
};

const SEC: TiebreakRules = {
  conference: "SEC",
  seasons: [2026],
  source: "SEC Football Tiebreakers Final 10.29.24: https://storage.googleapis.com/secsports-prod/upload/2024/10/29/f6fc7cd9-3031-4357-8754-80bfa4b9c4c0.pdf",
  steps: [
    headToHead({ record: "games", lostToAll: true }),
    commonOpponents(),
    placedCommonOpponent({ level: "head-to-head" }),
    opponentsWinPct(),
    scoringMargin({ cap: 2 }),
    draw(),
  ],
  spots: "open",
  drop: "restart",
  gameCountTies: false,
  luckSteps: "the scoring margin tiebreak",
};

const RULES: readonly TiebreakRules[] = [ACC, BIG_12, SEC];

/** Is there a tiebreak config for the conference in that season? */
export const hasTiebreakRules = (conference: string, season: number): boolean =>
  RULES.some((r) => r.conference === conference && r.seasons.includes(season));

/** The conference's rules for that season; throws when there are none. */
export function tiebreakRules(conference: string, season: number): TiebreakRules {
  const rules = RULES.find((r) => r.conference === conference && r.seasons.includes(season));
  if (!rules) throw new Error(`No tiebreak rules for ${conference} in ${season}`);
  return rules;
}

/** The rules count non-conference results (a total-wins step). */
export const countsNonConference = (rules: TiebreakRules): boolean => rules.steps.some((s) => s.nonConference === true);
