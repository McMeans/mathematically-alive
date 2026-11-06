// Checks a season snapshot before the app is built from it.
import { hasTiebreakRules } from "./rules";
import type { Season } from "./season";

export type SnapshotCheck = {
  /** Problems that must stop the build, each a full sentence. */
  errors: string[];
  /** FBS conferences in the snapshot that the app doesn't cover, sorted, with independents as "FBS Independents". */
  notSupported: string[];
};

/**
 * Whether the app can be built from `season` for the `supported` conferences: each needs a full conference schedule
 * (every member plays a conference game against another member) and tiebreak rules for the season. Every other FBS
 * conference in the snapshot is listed as not supported, so a build says what it leaves out.
 */
export function checkSnapshot(season: Season, supported: readonly string[]): SnapshotCheck {
  const errors: string[] = [];
  const fbs = season.teams.filter((t) => t.classification === "fbs");
  if (fbs.length === 0) errors.push(`The ${season.year} snapshot has no FBS teams.`);

  const conferenceOf = new Map(season.teams.map((t) => [t.id, t.conference]));
  const playsMember = (id: number, c: string) =>
    season.games.some(
      (g) => g.conferenceGame && (g.homeId === id || g.awayId === id) && conferenceOf.get(g.homeId) === c && conferenceOf.get(g.awayId) === c,
    );
  const noSchedule = supported.filter((c) => {
    const members = fbs.filter((t) => t.conference === c);
    return members.length === 0 || !members.every((t) => playsMember(t.id, c));
  });
  if (noSchedule.length > 0) errors.push(`No full schedule for ${list(noSchedule)} in the ${season.year} snapshot.`);

  const noRules = supported.filter((c) => !hasTiebreakRules(c, season.year));
  if (noRules.length > 0) errors.push(`No tiebreak rules for ${list(noRules)} in ${season.year}.`);

  const covered = new Set(supported);
  const notSupported = [...new Set(fbs.map((t) => t.conference ?? "FBS Independents"))]
    .filter((c) => !covered.has(c))
    .sort();
  return { errors, notSupported };
}

const list = (names: string[]): string => names.join(", ");
