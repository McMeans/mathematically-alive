// A shared Lab link's picks, run once per link on the server: a quick run, the size of the Lab's first pass. Loads
// the season itself rather than `@/app/season`, which runs the full no-picks simulations on import.
import { decodeLabLocks, labCard, seasonLab, type Season } from "@/core";
import { QUICK_ITERATIONS, SEED, SUPPORTED_CONFERENCES } from "@/app/config";
import data from "@/app/data/season.json";

const season = data as Season;
const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const last = Math.max(...season.games.filter((g) => g.completed).map((g) => Date.parse(g.start)).filter((t) => !Number.isNaN(t)));
export const through = Number.isFinite(last) ? `Through ${dayFormat.format(new Date(last))}` : "";

const cards = new Map<string, ReturnType<typeof labCard>>();
/** The share card for a link's picks (`?picks=` code). */
export function sharedCard(code: string) {
  if (!cards.has(code)) {
    const { locks } = decodeLabLocks(season, code);
    const lab = seasonLab(season, { iterations: QUICK_ITERATIONS, seed: SEED, conferences: SUPPORTED_CONFERENCES, locks });
    if (cards.size > 200) cards.clear();
    cards.set(code, labCard(season, lab));
  }
  return cards.get(code)!;
}
