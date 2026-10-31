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
export { formatOdds, teamPath } from "./paths";
export type { KeyGame, PathOptions, PathStatus, TeamPath } from "./paths";
