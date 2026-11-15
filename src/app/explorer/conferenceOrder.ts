// Not a client module, so server components (the not-found page) can use it too.
import { conferenceShort } from "@/core";

/** The one order conferences are listed in, everywhere (team sheet tabs, the Lab's chips), by short name. */
export const CONFERENCE_ORDER = ["ACC", "Big Ten", "SEC", "Big 12", "American", "Pac 12", "MW", "SBC", "MAC", "CUSA", "Independents"] as const;

/** Conferences (CFBD names) in `CONFERENCE_ORDER`; any not listed come last, by name. */
export function inConferenceOrder<T extends { conference: string }>(items: readonly T[]): T[] {
  const rank = (c: string) => {
    const at = (CONFERENCE_ORDER as readonly string[]).indexOf(conferenceShort(c));
    return at === -1 ? CONFERENCE_ORDER.length : at;
  };
  return [...items].sort((a, b) => rank(a.conference) - rank(b.conference) || a.conference.localeCompare(b.conference));
}
