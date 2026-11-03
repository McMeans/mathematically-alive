"use client";
// The selected team's conference, and the odds labels worded for it, for every explorer component.
import { createContext, useContext, useMemo } from "react";
import { oddsLabels, type OddsLabels } from "@/core";

const ConferenceContext = createContext<string | null>(null);
export const ConferenceProvider = ConferenceContext.Provider;

export function useConference(): { conference: string; labels: OddsLabels } {
  const conference = useContext(ConferenceContext);
  if (conference === null) throw new Error("useConference needs a ConferenceProvider");
  return useMemo(() => ({ conference, labels: oddsLabels(conference) }), [conference]);
}
