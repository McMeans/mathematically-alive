import { describe, expect, it } from "vitest";
import { formatSideOdds, formatTitleOdds, winProbability } from "@/core";

describe("winProbability", () => {
  it("gives a pick'em game even odds", () => {
    expect(winProbability(0)).toBeCloseTo(0.5, 6);
  });

  it("favors the home side when it is giving points", () => {
    expect(winProbability(-7)).toBeGreaterThan(0.6);
    expect(winProbability(-7)).toBeLessThan(0.75);
  });

  it("is symmetric between favorite and underdog", () => {
    expect(winProbability(-10) + winProbability(10)).toBeCloseTo(1, 6);
  });

  it("rejects a non-finite spread or non-positive sd", () => {
    expect(() => winProbability(Number.NaN)).toThrow(RangeError);
    expect(() => winProbability(3, 0)).toThrow(RangeError);
  });
});

describe("odds wording for a team", () => {
  it("shows title-game odds as In or Out only when proven, and never a flat 0% or 100% otherwise", () => {
    expect(formatTitleOdds(1, "clinched")).toBe("In");
    expect(formatTitleOdds(0, "eliminated")).toBe("Out");
    expect(formatTitleOdds(1, "alive")).toBe(">99%");
    expect(formatTitleOdds(0, "alive")).toBe("<0.1%");
    expect(formatTitleOdds(0.004, "alive")).toBe("0.4%");
    expect(formatTitleOdds(0.53, "alive")).toBe("53%");
  });

  it("shows other odds as 100% only once the team is in, and 0% only once it's out", () => {
    expect(formatSideOdds(1, "clinched")).toBe("100%");
    expect(formatSideOdds(1, "alive")).toBe(">99%");
    expect(formatSideOdds(0, "eliminated")).toBe("0%");
    expect(formatSideOdds(0, "alive")).toBe("<0.1%");
    expect(formatSideOdds(0, "clinched")).toBe("<0.1%");
    expect(formatSideOdds(0.21, "alive")).toBe("21%");
  });
});
