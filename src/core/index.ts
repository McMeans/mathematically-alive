// Public API of the simulation core. Everything the app, scripts and MCP
// server use goes through here, and black-box tests import only this file.
export { winProbability } from "./odds";
export { COMMITTEE_POLL, seasonFromCfbd, teamRecord } from "./season";
export type {
  CfbdGame,
  CfbdLines,
  CfbdPlayoff,
  CfbdPollWeek,
  CommitteeRelease,
  PlayoffGame,
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
export { hasTiebreakRules } from "./rules";
export { checkFetch, checkSnapshot } from "./snapshot";
export type { SnapshotCheck } from "./snapshot";
export type { ConferenceStanding, TiebreakOptions } from "./tiebreak";
export { gameWinProbability, simulateSeason } from "./sim";
export type { OddsOptions, SimOptions, SimResult, TeamSimStats } from "./sim";
export { seasonOutlook } from "./outlook";
export type { OutlookOptions, SeasonOutlook, TeamOutlook } from "./outlook";
export { conferenceName, conferenceShort, formatChampion, formatChance, formatFine, formatOdds, formatPlayoff, formatRecord, formatSideOdds, formatTitleOdds, mustWinConference, oddsLabels, playoffDetail, playoffRoute, teamPath } from "./paths";
export { explore } from "./explore";
export { decodeLabLocks, encodeLabLocks, fillLabLocks, seasonLab } from "./lab";
export type { DecodedLabLocks, LabConference, LabFill, LabLocks, LabOptions, LabRanked, LabStanding, LabTitleMatchup, LabTitleTeam, SeasonLab } from "./lab";
export type { Exploration } from "./explore";
export type { KeyGame, OddsLabels, PathOptions, PathStatus, TeamPath } from "./paths";
export { pathTree } from "./tree";
export type { HelpGame, Impact, Likeliest, PathTree, Rival, SeasonWeek, TreeNode, TreeOptions, TreeOutcome, WayWeek } from "./tree";
export { committeeRanking } from "./committee";
export type { CommitteeFeatures, CommitteeOptions, CommitteeTeam, CommitteeWeights } from "./committee";
export { simulateNational } from "./national";
export type { NationalOptions, NationalPlayoff, NationalResult, NationalSeason, NationalTeam } from "./national";
export { announcedField, playoffField, playoffFormat } from "./playoff";
export type { AnnouncedField, PlayoffFormat, PlayoffRun } from "./playoff";
export { nationalView, playoffSignals } from "./view";
export { INDEPENDENTS, exploreIndependent, independentOutlook } from "./independent";
export type { IndependentExploration, IndependentGame, IndependentOptions, IndependentOutlook } from "./independent";
export type { BracketGame, BracketSide, BubbleTeam, FieldSpot, NationalView, PlayoffSignal } from "./view";
export { decodeLocks, encodeLocks } from "./share";
export type { Locks } from "./share";
