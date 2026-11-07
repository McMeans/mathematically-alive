// Each conference's title-game tiebreak rules, per season, as config for the engine in tiebreak.ts. Every entry
// cites its source document. A conference or season with no entry is an error, never another conference's rules.

import {
  commonOpponents,
  draw,
  headToHead,
  opponentsWinPct,
  overallWinPct,
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
  /**
   * Members (by team name) who can't play in the title game, such as a team moving up to FBS. Their games still
   * count for everyone else's record and every tiebreak step; they are just never picked.
   */
  ineligible?: readonly string[];
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

// The full 2024 PDF this release links to is offline (assets.contentstack.io answers 412, nextgen.bigten.org is
// paused) and no 2026 document is published. The step order and wording come from the release itself; the rest
// follows secondary sources (cfb.app, CBS Sports, NBC, playoffstatus.com) and the Big Ten's 2025 title-game
// scenarios, which show two teams level at the top both clinching ("open" spots) and a three-way tie reduced to
// two going back to head-to-head. Not confirmed by the document: whether opponents level on record count as one
// group (assumed, as the Big 12 states); that a team that lost to all the others isn't dropped (no source
// mentions it, unlike the SEC); and that a tie of three or more cut down to a smaller group starts over at
// head-to-head (shown for two teams left; cfb.app's paraphrase has three or more go on to the next step).
const BIG_TEN: TiebreakRules = {
  conference: "Big Ten",
  seasons: [2026],
  source: "Step order from Big Ten Announces New Football Tiebreaking Procedures, Aug. 26, 2024 (the latest published): https://bigten.org/fb/article/blt6104802d94ebe1ab/; details from secondary sources (see SPEC.md)",
  steps: [
    headToHead({ record: "games", lostToAll: false }),
    commonOpponents(),
    placedCommonOpponent({ level: "group" }),
    opponentsWinPct(),
    ranking({ restart: false }),
    draw(),
  ],
  spots: "open",
  drop: "restart",
  gameCountTies: false,
  luckSteps: "the ranking tiebreak",
};

// Two-team and more-than-two-team procedures are the same steps here: head-to-head (all tied teams played each
// other: their combined record; otherwise one that beat all the others is in), common opponents, the SportSource
// Analytics Team Rating Score (the ranking stand-in), common opponents by order of finish ("with ties broken": level
// opponents placed by head-to-head), then the combined conference win pct of conference opponents, then a draw.
// "Two teams superior after any step" both go ("open" spots). The page doesn't say what a step that cuts a tie down
// does next; like the other conferences, the teams left start over. Sacramento State, a football-only member from
// 2026, can't play for the title in its first two seasons (ESPN, Feb. 2026).
const MAC: TiebreakRules = {
  conference: "Mid-American",
  seasons: [2026],
  source: "MAC Football Championship Tiebreaker (getsomemaction.com, 2025-26): https://getsomemaction.com/sports/2025/11/12/FB_1112255434.aspx",
  steps: [
    headToHead({ record: "games", lostToAll: false }),
    commonOpponents(),
    ranking({ restart: true }),
    placedCommonOpponent({ level: "head-to-head" }),
    scheduleStrength(),
    draw(),
  ],
  spots: "open",
  drop: "restart",
  gameCountTies: false,
  luckSteps: "the ranking tiebreak",
  ineligible: ["Sacramento State"],
};

// Two-team and multi-team ties use the same six steps: head-to-head (all tied teams played each other: their combined
// record; otherwise one that beat all the others is in), common opponents, record against common opponents by
// order of finish (a tied group "evaluated collectively"), the average computer ranking of SP+, SportSource, ESPN
// SOR and KPI (the ranking stand-in), the combined conference win pct of all conference opponents, then a coin toss.
// The top two by win pct play ("open" spots); "if at any point the tie is broken in a multiple team tie, the
// remaining teams will begin the process again at step #1". Not modeled: section C, which ties a team short a
// postponed game with the leaders when it is within one win and level on losses. Delaware and Missouri State, in
// their second FBS season, are eligible in 2026.
const CUSA: TiebreakRules = {
  conference: "Conference USA",
  seasons: [2026],
  source: "CUSA Football Championship Game Tiebreaker Policy (conferenceusa.com, Sept. 2024, the latest published): https://s3.amazonaws.com/sidearm.sites/conferenceusa.com/documents/2024/9/19/CUSA_FB_Championship_Game_Tiebreaker_Policy.pdf",
  steps: [
    headToHead({ record: "games", lostToAll: false }),
    commonOpponents(),
    placedCommonOpponent({ level: "group" }),
    ranking({ restart: true }),
    scheduleStrength(),
    draw(),
  ],
  spots: "open",
  drop: "restart",
  gameCountTies: false,
  luckSteps: "the ranking tiebreak",
};

// Two-team and multi-team ties use the same six steps: head-to-head (two teams: their game; three or more: the mini
// round-robin when all played each other, otherwise one that beat all the others is in), the CFP ranking of Nov. 21
// for a ranked team that wins on the final weekend, else a composite of selected computer rankings (both modelled by
// the ranking stand-in), overall win pct with at most one FCS win counted, record against the next highest placed
// team down the standings (lower teams level on win pct as one position; a position some tied team didn't play in
// full is skipped), win pct against common conference opponents, then a coin toss or drawing. A multi-team tie goes
// on "until one or more teams gain an advantage", and the two highest-ranked go when the ranking step decides, so
// spots are "open". Teams ineligible for a bowl under NCAA or Mountain West rules can't play; the NCAA made teams
// moving up to FBS eligible at once from 2026 (D-I Cabinet, June 24, 2026), so North Dakota State is eligible.
const MOUNTAIN_WEST: TiebreakRules = {
  conference: "Mountain West",
  seasons: [2026],
  source: "Mountain West Football Championship Tiebreaking Procedures, Aug. 1, 2023 (the latest published): https://storage.googleapis.com/themw-com/2023/09/ec9093ac-2023-mw-football-championship-tiebreakers-final.pdf",
  steps: [
    headToHead({ record: "games", lostToAll: false }),
    ranking({ restart: true }),
    overallWinPct({ belowFbs: 1 }),
    placedCommonOpponent({ level: "group", whole: true }),
    commonOpponents(),
    draw(),
  ],
  spots: "open",
  drop: "restart",
  gameCountTies: false,
  luckSteps: "the ranking tiebreak and overall win pct",
};

const RULES: readonly TiebreakRules[] = [ACC, BIG_12, SEC, BIG_TEN, MAC, CUSA, MOUNTAIN_WEST];

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
