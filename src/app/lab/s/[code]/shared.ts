// A shared Lab link's picks, run once per link on the server: a small run (the card needs only the field's order and
// the favourite), and only so many a minute. Loads the season itself rather than `@/app/season`, which runs the full
// no-picks simulations on import.
import { decodeLabLocks, encodeLabLocks, labCard, seasonLab, type LabCard, type Season } from "@/core";
import { SEED, SUPPORTED_CONFERENCES } from "@/app/config";
import data from "@/app/data/season.json";

const season = data as Season;
// Every open game, title and bracket pick fits well under this; anything longer isn't a Lab link.
const MAX_CODE = 2048;
const KEEP = 200;
const ITERATIONS = 500;
// Uncached runs allowed per minute in one server instance; past that a link gets the plain preview, with no run.
const PER_MINUTE = 30;
let windowStart = 0;
let runs = 0;
const cards = new Map<string, LabCard | null>();

/**
 * The share card for a link's picks (`?picks=` code).
 *
 * - Undefined: the code is too long to be a Lab link (404).
 * - Null: the plain preview, with no run. For a malformed code or picks that no longer fit the season (the Lab explains
 *   those), and when this instance has used its runs for the minute (not cached, so the card fills in later).
 * - Otherwise the card, cached by the picks' own encoding: every code for one set of picks (a version 1 link, a padded
 *   one) shares one run. Picks that have since gone final are dropped, and the link still works.
 */
export function sharedCard(code: string): LabCard | null | undefined {
  if (code.length > MAX_CODE) return undefined;
  const { locks, dropped } = decodeLabLocks(season, code);
  if (dropped > 0) return null;
  const key = encodeLabLocks(season, locks);
  if (cards.has(key)) {
    const card = cards.get(key)!;
    cards.delete(key); // most recent last
    cards.set(key, card);
    return card;
  }
  const now = Date.now();
  if (now - windowStart >= 60_000) { windowStart = now; runs = 0; }
  if (++runs > PER_MINUTE) return null;
  const card = labCard(season, seasonLab(season, { iterations: ITERATIONS, seed: SEED, conferences: SUPPORTED_CONFERENCES, locks }));
  if (cards.size >= KEEP) cards.delete(cards.keys().next().value!);
  cards.set(key, card);
  return card;
}
