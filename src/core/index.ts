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
export { conferenceName, conferenceShort, formatChampion, formatChance, formatFine, formatOdds, formatPlayoff, formatRecord, formatSideOdds, formatTitleOdds, mustWinConference, oddsLabels, playoffDetail, playoffRoute, goalStatus, statusTags, teamPath, type StatusTag } from "./paths";
export { explore } from "./explore";
export { committeeRanks, oneIn } from "./board";
export type { BestShot, HelpGame as BoardHelpGame, HelpGroup, HelpSide, OwnChance, PlayoffRace, RaceItem, ShotStep, RaceRow, RecordOdds, TeamBoard, TitleWeek, WayIn } from "./board";
export { decodeLabLocks, decodeTitlePick, encodeLabLocks, fillLabLocks, labCard, labChanges, labOddsChange, labTeamOdds, seasonLab } from "./lab";
export type { DecodedLabLocks, LabBigGame, LabCard, LabCardSeed, LabChanges, LabConference, LabFill, LabFinal, LabMover, LabLocks, LabOptions, LabRanked, LabStanding, LabTeamOdds, LabTitleMatchup, LabTitleTeam, SeasonLab } from "./lab";
export type { Exploration } from "./explore";
export type { KeyGame, OddsLabels, PathOptions, PathStatus, TeamPath } from "./paths";
export { pathTree } from "./tree";
export type { HelpGame, Impact, Likeliest, PathTree, Rival, SeasonWeek, TreeNode, TreeOptions, TreeOutcome, WayWeek } from "./tree";
export { committeeRanking } from "./committee";
export type { CommitteeFeatures, CommitteeOptions, CommitteeTeam, CommitteeWeights } from "./committee";
export { liveRanking, liveRanks } from "./live";
export type { LiveRanked, LiveRanking, LiveRankingOptions } from "./live";
export { simulateNational } from "./national";
export type { NationalOptions, NationalPlayoff, NationalResult, NationalSeason, NationalTeam } from "./national";
export { announcedField, playoffField, playoffFormat } from "./playoff";
export type { AnnouncedField, PlayoffFormat, PlayoffRun } from "./playoff";
export { nationalView, playoffSignals, simulateBracket } from "./view";
export { INDEPENDENTS, exploreIndependent, independentOutlook } from "./independent";
export type { IndependentExploration, IndependentGame, IndependentOptions, IndependentOutlook } from "./independent";
export type { BracketGame, BracketSide, BubbleTeam, FieldSpot, NationalView, PlayoffSignal } from "./view";
export { decodeLocks, encodeLocks } from "./share";
export type { Locks } from "./share";
