// Team-list rows, made on the server for every conference and the independents (no "use client": pages call these).
import { INDEPENDENTS, formatChance, formatPlayoff, formatRecord, type IndependentOutlook, type TeamOutlook } from "@/core";
import type { ListRow } from "./Explorer";

/** The playoff side of a list row: In or Out once the field is announced, barred teams out. */
const playoffSide = (o: Pick<TeamOutlook, "playoff" | "cfp" | "postseasonBan"> & { autoBid?: boolean }, status: TeamOutlook["status"]) => {
  const out = o.postseasonBan || o.cfp?.run?.seed === null;
  const inField = o.cfp?.run != null && o.cfp.run.seed !== null;
  return { playoff: formatPlayoff(o.playoff, o.cfp, o.postseasonBan ? "eliminated" : status, o.autoBid), playoffKey: out ? -1 : inField ? 2 : o.playoff, playoffOut: out };
};

/**
 * A conference's teams for the team list. Title-game odds: proven in above everything, proven out below everything,
 * so a team still alive at 0% in the sample ("<0.1%") stays above every team that's out.
 */
export const conferenceRows = (conference: string, outlook: TeamOutlook[]): ListRow[] =>
  outlook.map((o) => ({
    teamId: o.teamId, record: formatRecord(o.record, conference), ...playoffSide(o, o.status),
    title: formatChance(o.titleGame, o.status), titleKey: o.status === "clinched" ? 2 : o.status === "eliminated" ? -1 : o.titleGame, titleOut: o.status === "eliminated",
  }));

/** The independents for the team list: playoff odds only (they have no title game). */
export const independentRows = (outlook: IndependentOutlook[]): ListRow[] =>
  outlook.map((o) => ({ teamId: o.teamId, record: formatRecord(o.record, INDEPENDENTS), ...playoffSide(o, "alive"), title: null, titleKey: -1, titleOut: true }));
