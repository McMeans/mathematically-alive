// When the season data runs through, for page headers and share images. Light: no simulation on import.
import type { Season } from "@/core";
import data from "./data/season.json";

const season = data as Season;

const asOfFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
/** "As of Oct 30, 2026, 3:04 PM EDT": when the data was fetched, else now. Shown on hover. */
export const asOf = `As of ${asOfFormat.format(Number.isNaN(Date.parse(season.fetchedAt)) ? new Date() : new Date(season.fetchedAt))}`;

const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const lastPlayed = Math.max(...season.games.filter((g) => g.completed).map((g) => Date.parse(g.start)).filter((t) => !Number.isNaN(t)));
/** "Through Oct 31": the day of the latest final game, Eastern time; the fetch time when no game is final. */
export const through = Number.isFinite(lastPlayed) ? `Through ${dayFormat.format(new Date(lastPlayed))}` : asOf;
