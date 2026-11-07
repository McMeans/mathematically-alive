// Each conference's title-game tiebreak rules, per season, as config for the engine in tiebreak.ts. Every entry
// cites its source document. A conference or season with no entry is an error, never another conference's rules.

import {
  commonOpponents,
  divisionWinPct,
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
   * A separate procedure for two teams (the Pac-12's), in place of `steps` whenever two are tied: `spot` when they
   * are tied for one spot, `seed` when both are in and only their order is open. Each list's last step always
   * decides.
   */
  twoTeam?: { spot: readonly Step[]; seed: readonly Step[] };
  /**
   * Divisions, by school name as the data spells it (the Sun Belt's). Each division's champion plays: the best
   * conference win pct in the division, ties broken by `steps` among that division's teams. The champion with the
   * better conference win pct is seeded first, a tie broken by `twoTeam.seed` (or `steps`).
   */
  divisions?: Readonly<Record<string, readonly string[]>>;
  /**
   * After a step cuts a tie down, the teams at the top start over from the first step as each step says
   * ("restart", the default), or go on to the next step ("continue": the Sun Belt's "the remaining teams will
   * continue down the tiebreaker").
   */
  cut?: "restart" | "continue";
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
// does next; like the other conferences, the teams left start over. Sacramento State, a football-only member new to
// FBS in 2026, can play for the title: the NCAA made teams moving up eligible at once (D-I Cabinet, June 24, 2026),
// lifting the two-season wait announced when it joined.
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

// Two-team (10.5) and multi-team (10.6) ties use the same five steps: head-to-head (two teams: their game; three or
// more: the mini round-robin when all played each other, otherwise one that beat all the others is in), the CFP
// ranking going into the final weekend for a ranked team that doesn't lose that weekend, else a composite of
// selected computer metrics (SP+, SportSource TR116 SOR, ESPN SOR, KPI), both modelled by the ranking stand-in, then
// win pct against all common conference opponents, overall win pct (conference and non-conference, no cap on FCS
// wins), then a coin toss or drawing. "The highest-ranked team or teams" go when the ranking decides, so spots are
// "open"; "if only two teams remain tied after any step", the two-team procedure starts over. Army-Navy isn't one of
// the eight conference games and is played after the title game, so it counts in neither the standings nor the
// overall record (see seasonFromCfbd). Not modelled: 10.4, the unbalanced-schedule rule (seven conference games to
// be eligible, head-to-head over win pct for a team short a game that beat every team it tied with in the loss
// column); "exempt games", left out of overall win pct, are counted.
const AMERICAN: TiebreakRules = {
  conference: "American Athletic",
  seasons: [2026],
  source: "American Conference Football Tiebreakers, 2025 (25_FB_Tiebreakers.pdf, Section 10: Conference Champion Determination; the latest published), linked from https://theamerican.org/news/2025/11/23/FOOTBALL_Tiebreaker.aspx",
  steps: [
    headToHead({ record: "games", lostToAll: false }),
    ranking({ restart: true }),
    commonOpponents(),
    overallWinPct({ belowFbs: Infinity }),
    draw(),
  ],
  spots: "open",
  drop: "restart",
  gameCountTies: false,
  luckSteps: "the ranking tiebreak and overall win pct",
};

// A seven-game round robin (weeks 5-12); the week-13 flex games don't count in the standings (seasonFromCfbd), and
// the title-game teams are set after week 12. Separate procedures for two teams and for more:
// - Two teams tied for first both play, the head-to-head winner seeded first. Two tied for second: win pct against
//   the next-highest-placed common opponent (a group of teams level in the standings counted as one), win pct
//   against common conference opponents, the CFP ranking the Tuesday before week 13, then the SportSource Team Rating
//   Score after the last conference weekend (both the ranking stand-in), then a coin toss. Head-to-head isn't a step.
// - Three or more: head-to-head win pct among them (only when all played each other; otherwise the next step), win
//   pct against common conference opponents, the next-highest-placed common opponent (as above), the combined
//   conference win pct of conference opponents, the SportSource score, then a coin toss. "Once one team gains an
//   advantage and is seeded, the remaining teams will restart" ("one" spot at a time), and "if the process reduces
//   the tie to two teams, the two-team procedure will then be applied".
// Not modelled: the host (the title game is at the higher seed's home).
const PAC_12: TiebreakRules = {
  conference: "Pac-12",
  seasons: [2026],
  source: "Pac-12 Football Championship Game Tiebreakers, in Pac-12 announces commercial and operational updates ahead of its 2026 football season kickoff, Sept. 3, 2026: https://pac-12.com/news/2026/9/3/pac-12-announces-commercial-and-operational-updates-ahead-of-its-2026-football-season-kickoff.aspx",
  steps: [
    headToHead({ record: "games", lostToAll: false, beatAll: false }),
    commonOpponents(),
    placedCommonOpponent({ level: "group" }),
    scheduleStrength(),
    ranking({ restart: true }),
    draw(),
  ],
  twoTeam: {
    spot: [placedCommonOpponent({ level: "group" }), commonOpponents(), ranking({ restart: true }), draw()],
    seed: [
      headToHead({ record: "games", lostToAll: false, beatAll: false }),
      placedCommonOpponent({ level: "group" }),
      commonOpponents(),
      ranking({ restart: true }),
      draw(),
    ],
  },
  spots: "one",
  drop: "restart",
  gameCountTies: false,
  luckSteps: "the ranking tiebreak",
};

// Two seven-team divisions; each team plays its division and two teams from the other. Each division champion (the
// best win pct in all conference games) plays. Two-team and three-or-more ties use the same steps: head-to-head (two:
// their game; more: win pct in games among them, and a division's teams all play each other), win pct in division
// games, win pct against the next-highest team in the final division standings and on down (a level group counted
// collectively), win pct against common non-divisional conference opponents, the CFP ranking for a ranked team that
// wins on the final weekend, else a composite of computer rankings (both the ranking stand-in), overall win pct
// against FBS teams, then a coin toss or lot. A tie of three or more cut down doesn't start over: "if one team falls
// out of contention ... the remaining teams will continue down the tiebreaker" (cut "continue"). The host is the
// champion with the better conference win pct; level, head-to-head, then the rankings (the seed order). Not modelled:
// the ineligible-champion rule (no member is barred in 2026).
const SUN_BELT_STEPS = [
  headToHead({ record: "games", lostToAll: false }),
  divisionWinPct(),
  placedCommonOpponent({ level: "group", division: true }),
  commonOpponents({ nonDivision: true }),
  ranking({ restart: true }),
  overallWinPct({ belowFbs: 0, fbsOnly: true }),
  draw(),
];
const SUN_BELT: TiebreakRules = {
  conference: "Sun Belt",
  seasons: [2026],
  source: "Sun Belt Football Tie-Breaking Procedures (sunbeltsports.org, with Louisiana Tech in the West, the 2026 alignment): https://sunbeltsports.org/sports/2018/8/30/FB_Tie-Breakers.aspx",
  steps: SUN_BELT_STEPS,
  twoTeam: {
    spot: SUN_BELT_STEPS,
    seed: [headToHead({ record: "games", lostToAll: false }), ranking({ restart: false }), draw()],
  },
  divisions: {
    East: ["App State", "Coastal Carolina", "Georgia Southern", "Georgia State", "James Madison", "Marshall", "Old Dominion"],
    West: ["Arkansas State", "Louisiana", "Louisiana Tech", "South Alabama", "Southern Miss", "Troy", "UL Monroe"],
  },
  cut: "continue",
  spots: "one",
  drop: "restart",
  gameCountTies: false,
  luckSteps: "the ranking tiebreak and overall win pct",
};

const RULES: readonly TiebreakRules[] = [ACC, BIG_12, SEC, BIG_TEN, MAC, CUSA, MOUNTAIN_WEST, AMERICAN, PAC_12, SUN_BELT];

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
export const countsNonConference = (rules: TiebreakRules): boolean =>
  [rules.steps, rules.twoTeam?.spot ?? [], rules.twoTeam?.seed ?? []].some((list) => list.some((s) => s.nonConference === true));
