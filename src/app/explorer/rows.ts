// Team-list rows, made on the server for every conference and the independents (no "use client": pages call these).
import { INDEPENDENTS, formatChance, formatRecord, formatSideOdds, type IndependentOutlook, type TeamOutlook } from "@/core";
import type { ListRow } from "./Explorer";

/**
 * A conference's teams for the team list, by title-game odds: proven in above everything, proven out below
 * everything, so a team still alive at 0% in the sample ("<0.1%") stays above every team that's out.
 */
export const conferenceRows = (conference: string, outlook: TeamOutlook[]): ListRow[] =>
  outlook.map((o) => ({
    teamId: o.teamId, record: formatRecord(o.record, conference), odds: formatChance(o.titleGame, o.status),
    key: o.status === "clinched" ? 2 : o.status === "eliminated" ? -1 : o.titleGame, out: o.status === "eliminated",
  }));

/** The independents for the team list, by playoff odds (they have no title game). */
export const independentRows = (outlook: IndependentOutlook[]): ListRow[] =>
  outlook.map((o) => ({
    teamId: o.teamId, record: formatRecord(o.record, INDEPENDENTS), odds: formatSideOdds(o.playoff, o.postseasonBan ? "eliminated" : "alive"),
    key: o.postseasonBan ? -1 : o.playoff, out: o.postseasonBan,
  }));
