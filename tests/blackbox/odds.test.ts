import { describe, expect, it } from "vitest";
import { winProbability } from "@/core";

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
