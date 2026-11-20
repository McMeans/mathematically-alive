import { type Game, type Season } from "@/core";

// Shared by the Sun Belt test files: a made-up season over the real member names.
export const SBC = "Sun Belt";
export const EAST = ["App State", "Coastal Carolina", "Georgia Southern", "Georgia State", "James Madison", "Marshall", "Old Dominion"];
export const WEST = ["Arkansas State", "Louisiana", "Louisiana Tech", "South Alabama", "Southern Miss", "Troy", "UL Monroe"];

// The fourteen members by the names the data uses (divisions are configured by name), plus Tulane (FBS) and Nicholls
// (FCS) outside. Only the games a case needs are listed: [winner, loser], conference games unless both aren't members.
// `open` games are unplayed. `ratings` stand in for the CFP ranking and the computer composite.
export function build(games: [string, string][], ratings: Record<string, number> = {}, open: ([string, string] | [string, string, number])[] = []): Season & { id: (n: string) => number } {
  const names = [...EAST, ...WEST, "Tulane", "Nicholls"];
  const teams = names.map((name, i) => ({
    id: i + 1, name, abbreviation: null, conference: name === "Tulane" ? "American Athletic" : name === "Nicholls" ? "Southland" : SBC,
    classification: name === "Nicholls" ? ("fcs" as const) : ("fbs" as const), color: null, altColor: null, rating: ratings[name] ?? 0,
  }));
  const id = (n: string) => teams.find((t) => t.name === n)!.id;
  const member = (n: string) => EAST.includes(n) || WEST.includes(n);
  const game = (home: string, away: string, winner: string | null, i: number, spread: number | null = null): Game => ({
    id: i, week: 5 + (i % 8), start: "2026-11-07T18:00:00Z", neutralSite: false, conferenceGame: member(home) && member(away),
    homeId: id(home), awayId: id(away),
    homePoints: winner === null ? null : winner === home ? 21 : 14, awayPoints: winner === null ? null : winner === away ? 21 : 14,
    completed: winner !== null, spread,
  });
  return {
    year: 2026, fetchedAt: "", teams, id,
    games: [...games.map(([w, l], i) => game(w, l, w, i)), ...open.map(([h, a, spread], i) => game(h, a, null, games.length + i, spread ?? null))],
  };
}
export const played = (g: Game) => (g.homePoints! > g.awayPoints! ? g.homeId : g.awayId);
