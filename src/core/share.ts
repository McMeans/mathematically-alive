// Locked what-ifs in a link: "?picks=401-12.402-30" means game 401 won by team 12, game 402 by team 30.
import type { Game } from "./season";

/** Locked results, game id to the winning team's id. */
export type Locks = Record<number, number>;

/** The locks as link text: picks sorted by game id, so the same picks always give the same link. */
export function encodeLocks(locks: Locks): string {
  return Object.entries(locks)
    .map(([g, w]) => [Number(g), w] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([g, w]) => `${g}-${w}`)
    .join(".");
}

/**
 * Link text back to locks. A link can be old or hand-edited, so a pick is kept only when its game is in the season,
 * not yet played, and the winner is one of its two teams. Anything else is dropped, never guessed. `completed` may be
 * left off a list holding only unplayed games. A game picked twice keeps its last pick.
 */
export function decodeLocks(text: string | null | undefined, games: readonly (Pick<Game, "id" | "homeId" | "awayId"> & { completed?: boolean })[]): Locks {
  const locks: Locks = {};
  if (!text) return locks;
  const byId = new Map(games.map((g) => [g.id, g]));
  for (const part of text.split(".")) {
    const m = /^([1-9]\d{0,14})-([1-9]\d{0,14})$/.exec(part.trim()); // canonical ids only: no leading zeros
    if (!m) continue;
    const game = byId.get(Number(m[1]));
    const winner = Number(m[2]);
    if (!game || game.completed || (winner !== game.homeId && winner !== game.awayId)) continue;
    locks[game.id] = winner;
  }
  return locks;
}
