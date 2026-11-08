import { describe, expect, it } from "vitest";
import { decodeLocks, encodeLocks } from "@/core";
import type { Game } from "@/core";

function game(id: number, home: number, away: number, completed = false): Game {
  return {
    id, week: 1, start: "2026-11-14T18:00:00Z", neutralSite: false, conferenceGame: true, homeId: home, awayId: away,
    homePoints: completed ? 21 : null, awayPoints: completed ? 14 : null, completed, spread: null,
  };
}
const games = [game(401, 1, 2), game(402, 3, 4), game(300, 1, 3, true)];

describe("shareable what-ifs", () => {
  it("a link of picks gives back the same picks", () => {
    const locks = { 402: 4, 401: 1 };
    expect(decodeLocks(encodeLocks(locks), games)).toEqual(locks);
  });

  it("the same picks always make the same link, whatever order they were made in", () => {
    expect(encodeLocks({ 402: 4, 401: 1 })).toBe("401-1.402-4");
    expect(encodeLocks({ 401: 1, 402: 4 })).toBe("401-1.402-4");
  });

  it("no picks make an empty link, and an empty or missing link locks nothing", () => {
    expect(encodeLocks({})).toBe("");
    expect(decodeLocks("", games)).toEqual({});
    expect(decodeLocks(null, games)).toEqual({});
    expect(decodeLocks(undefined, games)).toEqual({});
  });

  it("an old or edited link drops picks it can't trust and keeps the rest", () => {
    // 300 is already played, 999 isn't on the schedule, 5 isn't in game 402, "x" isn't a pick.
    expect(decodeLocks("401-2.300-1.999-1.402-5.x.402", games)).toEqual({ 401: 2 });
  });
});
