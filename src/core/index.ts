// Public API of the simulation core. Everything the app, scripts and MCP
// server use goes through here, and black-box tests import only this file.
export { winProbability } from "./odds";
export { seasonFromCfbd, teamRecord } from "./season";
export type {
  CfbdGame,
  CfbdLines,
  CfbdRating,
  CfbdSnapshot,
  CfbdTeam,
  Classification,
  Game,
  TeamRecord,
  Season,
  Team,
} from "./season";
export { championshipParticipants, conferenceStandings } from "./tiebreak";
export type { ConferenceStanding, TiebreakOptions } from "./tiebreak";
export { gameWinProbability, simulateSeason } from "./sim";
export type { OddsOptions, SimOptions, SimResult, TeamSimStats } from "./sim";
export { seasonOutlook } from "./outlook";
export type { OutlookOptions, SeasonOutlook, TeamOutlook } from "./outlook";
export { formatChance, formatFine, formatOdds, formatRecord, formatSideOdds, formatTitleOdds, oddsLabels, teamPath } from "./paths";
export { explore } from "./explore";
export type { Exploration } from "./explore";
export type { KeyGame, OddsLabels, PathOptions, PathStatus, TeamPath } from "./paths";
export { pathTree } from "./tree";
export type { HelpGame, Impact, Likeliest, PathTree, Rival, SeasonWeek, TreeNode, TreeOptions, TreeOutcome, WayWeek } from "./tree";
