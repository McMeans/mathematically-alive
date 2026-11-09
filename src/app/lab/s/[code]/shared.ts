// A shared Lab link's picks, run once per link on the server: a quick run, the size of the Lab's first pass. Loads
// the season itself rather than `@/app/season`, which runs the full no-picks simulations on import.
import { decodeLabLocks, encodeLabLocks, labCard, seasonLab, type LabCard, type Season } from "@/core";
import { QUICK_ITERATIONS, SEED, SUPPORTED_CONFERENCES } from "@/app/config";
import data from "@/app/data/season.json";

const season = data as Season;
// Every open game, title and bracket pick fits well under this; anything longer isn't a Lab link.
const MAX_CODE = 2048;
const KEEP = 200;
const cards = new Map<string, LabCard | null>();

/**
 * The share card for a link's picks (`?picks=` code), or undefined for a code that isn't one: too long, malformed,
 * with picks that don't fit the season, or not as the Lab writes it (so one set of picks has one link, and one run).
 * Links whose picks have since gone final still work.
 */
export function sharedCard(code: string): LabCard | null | undefined {
  if (cards.has(code)) {
    const card = cards.get(code)!;
    cards.delete(code); // most recent last
    cards.set(code, card);
    return card;
  }
  if (code.length > MAX_CODE) return undefined;
  const { locks, dropped, settled } = decodeLabLocks(season, code);
  if (dropped > 0) return undefined;
  if (settled === 0 && encodeLabLocks(season, locks) !== code) return undefined;
  const card = labCard(season, seasonLab(season, { iterations: QUICK_ITERATIONS, seed: SEED, conferences: SUPPORTED_CONFERENCES, locks }));
  if (cards.size >= KEEP) cards.delete(cards.keys().next().value!);
  cards.set(code, card);
  return card;
}
