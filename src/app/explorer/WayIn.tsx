"use client";
import { useState } from "react";
import { formatOdds, type Likeliest } from "@/core";

const label = "text-[11px] font-semibold uppercase tracking-wide text-ink-muted";
const RIVALS_SHOWN = 4;
// A rival's game: a loss the way needs, a win it needs (another rival losing), or either result.
const RESULT_LOOK = { lose: "bg-marker font-semibold text-white", win: "bg-white font-semibold text-navy ring-1 ring-inset ring-navy/30", either: "bg-mist text-ink-muted" };

/** The likeliest way in, as counts: the team's own job, then how many games each rival has to lose. */
export function WayCard({ way, teamName }: { way: Likeliest; teamName: string }) {
  const [all, setAll] = useState(false);
  const rivals = all ? way.rivals : way.rivals.slice(0, RIVALS_SHOWN);
  const footer = [way.favorites && `${way.favorites}.`, way.note].filter(Boolean).join(" ");
  return (
    <section aria-label="Likeliest way in" className="mt-2 flex max-w-3xl animate-rise flex-col gap-3 rounded-xl bg-mist p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-display text-base text-navy">What {teamName} needs</h3>
        <p className="text-xs text-ink-muted">
          All of it together: <span className="font-bold text-navy">{way.heading}</span>
        </p>
      </div>

      {way.own.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-turf/10 px-3 py-2">
          <div className="flex flex-col">
            <span className={`${label} text-turf`}>Its own job</span>
            <span className="text-sm font-bold text-navy">{way.ownJob}</span>
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {way.own.map((x) => (
              <li key={x} className="rounded-md bg-turf px-2 py-1 text-xs font-semibold text-white">{x}</li>
            ))}
          </ul>
          <span className="text-xs text-ink-soft">{formatOdds(way.ownChance)} to happen</span>
        </div>
      )}

      {rivals.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className={`px-1 ${label}`}>Has to lose</span>
          {rivals.map((r) => (
            <div key={r.teamId} className="rounded-lg bg-white px-2.5 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-sm">
                  <span className="font-bold text-navy">{r.team}</span>{" "}
                  <span className="font-semibold text-marker-text">{r.line}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2" title="Chance it gets all of those results">
                  <span className="h-1.5 w-12 rounded-full bg-navy/10">
                    <span className="block h-1.5 rounded-full bg-marker" style={{ width: `${Math.max(8, Math.round(r.chance * 100))}%` }} />
                  </span>
                  <span className="w-9 text-right text-sm font-bold text-navy">{formatOdds(r.chance)}</span>
                </span>
              </div>
              <ul aria-label={`${r.team}'s games left: what this way needs from each, and the chance of an upset`} className="mt-1 flex flex-wrap gap-1">
                {r.games.map((g) => (
                  <li key={g.opponent} className={`rounded-md px-1.5 py-0.5 text-[11px] ${RESULT_LOOK[g.result ?? "either"]}`}>
                    {g.result === "lose" ? "loses to" : g.result === "win" ? "beats" : "vs"} {g.opponent}{" "}
                    <span className={g.result === "lose" ? "text-white/80" : "text-ink-muted"}>
                      {g.result === null ? "either way" : formatOdds(g.result === "win" ? 1 - g.chance : g.chance)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {way.rivals.length > RIVALS_SHOWN && (
            <button type="button" onClick={() => setAll(!all)} className="self-start px-2 text-xs font-bold text-navy underline">
              {all ? "Show fewer" : `${way.rivals.length - RIVALS_SHOWN} more`}
            </button>
          )}
        </div>
      )}

      {footer && <p className="text-xs text-ink-muted">{footer}</p>}
    </section>
  );
}
