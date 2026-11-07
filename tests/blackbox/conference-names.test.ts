import { describe, expect, it } from "vitest";
import { conferenceName, conferenceShort, formatRecord, oddsLabels } from "@/core";

describe("conference names the site shows", () => {
  it("uses the site's names, with short forms where space is tight", () => {
    expect([conferenceName("Mid-American"), conferenceName("Pac-12"), conferenceName("Sun Belt"), conferenceName("American Athletic"), conferenceName("Conference USA"), conferenceName("Mountain West")])
      .toEqual(["MAC", "Pac 12", "Sun Belt", "American", "CUSA", "Mountain West"]);
    expect([conferenceShort("Sun Belt"), conferenceShort("Mountain West"), conferenceShort("Mid-American")]).toEqual(["SBC", "MW", "MAC"]);
    expect([conferenceName("ACC"), conferenceShort("Big Ten")]).toEqual(["ACC", "Big Ten"]);
  });

  it("odds labels and records name the MAC as MAC", () => {
    const l = oddsLabels("Mid-American");
    expect([l.champion, l.mustWin, l.conferenceRecord, l.conference]).toEqual(["Win MAC", "Must win MAC", "MAC record, counting your picks", "MAC"]);
    expect(oddsLabels("Mountain West").conference).toBe("MW");
    expect(formatRecord({ wins: 6, losses: 2, conferenceWins: 4, conferenceLosses: 1 }, "Mountain West")).toBe("6-2 (4-1 MW)");
  });
});
