import { describe, expect, it } from "vitest";
import { teamMatch } from "@/core";

const TEAMS = [
  { name: "Virginia", abbr: "UVA" },
  { name: "Virginia Tech", abbr: "VT" },
  { name: "West Virginia", abbr: "WVU" },
  { name: "Texas A&M", abbr: "TA&M" },
  { name: "Utah", abbr: "UTAH" },
];
/** The teams a search finds, best fit first (ties by name), as the site bar lists them. */
const search = (q: string) => TEAMS
  .flatMap((t) => { const m = teamMatch(q, t.name, t.abbr); return m === null ? [] : [{ name: t.name, m }]; })
  .sort((a, b) => a.m - b.m || a.name.localeCompare(b.name))
  .map((t) => t.name);

describe("team search", () => {
  it("finds a team by its abbreviation, whatever the case", () => {
    expect(search("uva")).toEqual(["Virginia"]);
    expect(search("UVA")).toEqual(["Virginia"]);
    expect(search("  wvu ")).toEqual(["West Virginia"]);
  });

  it("ranks an exact abbreviation above names that merely start with the search", () => {
    // "UTAH" is Utah's abbreviation exactly; nothing else starts with it, but an exact abbreviation still comes first.
    expect(teamMatch("utah", "Utah", "UTAH")).toBe(0);
    expect(search("vt")).toEqual(["Virginia Tech"]);
  });

  it("puts names that start with the search before ones that only contain a word starting with it", () => {
    expect(search("virginia")).toEqual(["Virginia", "Virginia Tech", "West Virginia"]);
    expect(search("tech")).toEqual(["Virginia Tech"]);
  });

  it("finds a name by a word inside it, and by any part of it last", () => {
    expect(teamMatch("tech", "Virginia Tech", "VT")).toBe(2);
    expect(teamMatch("ta&", "Texas A&M", "TA&M")).toBe(2);
    expect(teamMatch("xas", "Texas A&M", "TA&M")).toBe(3);
  });

  it("finds nothing for an empty search or one that fits no team", () => {
    expect(search("")).toEqual([]);
    expect(search("   ")).toEqual([]);
    expect(search("zzz")).toEqual([]);
    expect(teamMatch("uva", "Virginia")).toBeNull();
  });
});
