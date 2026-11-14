import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seasonFromCfbd, seasonLab, type CfbdSnapshot } from "@/core";

const season = seasonFromCfbd((JSON.parse(readFileSync("fixtures/cfp-2026.json", "utf8")) as { snapshot: CfbdSnapshot }).snapshot);
const lab = seasonLab(season, { iterations: 200, seed: 7, conferences: ["SEC", "Big Ten"] });
const fbs = season.teams.filter((t) => t.classification === "fbs");

describe("season lab: the whole projected ranking", () => {
  it("ranks every FBS team once, 1 to N, in order", () => {
    expect(lab.liveAll).toHaveLength(fbs.length);
    expect(new Set(lab.liveAll.map((r) => r.teamId))).toEqual(new Set(fbs.map((t) => t.id)));
    expect(lab.liveAll.map((r) => r.rank)).toEqual(fbs.map((_, k) => k + 1));
  });

  it("starts with the same top 25 the Lab shows", () => {
    expect(lab.liveAll.slice(0, 25)).toEqual(lab.live);
  });

  it("labels the whole ranking as our projection, with its size", () => {
    expect(lab.allLabel).toBe(`All ${fbs.length} (projection)`);
  });

  it("labels the fold-back control with the top size", () => {
    expect(lab.topLabel).toBe("Top 25");
  });

  it("a shorter top list is still the head of the whole ranking", () => {
    const ten = seasonLab(season, { iterations: 200, seed: 7, conferences: ["SEC", "Big Ten"], top: 10, reuse: lab.national });
    expect(ten.live).toHaveLength(10);
    expect(ten.liveAll).toHaveLength(fbs.length);
    expect(ten.liveAll.slice(0, 10)).toEqual(ten.live);
    expect(ten.topLabel).toBe("Top 10");
  });

  it("every team past 25 has a record to show", () => {
    for (const r of lab.liveAll) expect(lab.records[r.teamId]).toMatch(/^\d+-\d+/);
  });
});
