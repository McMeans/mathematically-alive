"use client";
import { useState } from "react";
import { formatOdds, type Likeliest } from "@/core";

const RIVALS_SHOWN = 4;
const PILL = "press flex min-h-11 shrink-0 items-center rounded-full px-3 text-xs font-bold md:min-h-8";
const sub = "text-xs font-semibold text-ink-muted";

// One color per kind of result, the same on every row: a win the way needs is green, a loss it needs teal,
// and a game that can go either way a dashed outline.
type Result = "win" | "lose" | null;
const CHIP: Record<"win" | "lose" | "either", string> = {
  win: "bg-turf/15 font-semibold text-turf-ink",
  lose: "bg-teal/15 font-semibold text-teal-ink",
  either: "border border-dashed border-ink-muted/60 text-ink-muted",
};
const VERB = { win: "beats", lose: "loses to", either: "either way" } as const;

type Game = { opponent: string; result: Result; chance: number };

/** A row's games grouped by result, in that order: losses, wins, either way. `chance` is the chance of the needed result. */
function Groups({ games }: { games: Game[] }) {
  const groups = (["lose", "win", "either"] as const)
    .map((k) => ({ k, games: games.filter((g) => (g.result ?? "either") === k) }))
    .filter((x) => x.games.length > 0);
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {groups.map(({ k, games }) => (
        <span key={k} className="flex flex-wrap items-center gap-1">
          <span className="text-xs text-ink-soft">{VERB[k]}</span>
          {games.map((g, i) => (
            <span key={`${g.opponent}-${i}`} className={`rounded-md px-2 py-0.5 text-xs ${CHIP[k]}`}>
              {g.opponent}
              {k !== "either" && <span className="ml-1 font-normal text-ink-soft">{formatOdds(g.chance)}</span>}
            </span>
          ))}
        </span>
      ))}
    </span>
  );
}

function Row({ team, summary, chance, games }: { team: string; summary: string; chance: number; games: Game[] }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-lg bg-white px-3 py-2 md:grid-cols-[10rem_minmax(0,1fr)_3rem]">
      <span className="flex items-baseline gap-2 md:flex-col md:gap-0.5">
        <span className="text-sm font-bold text-navy">{team}</span>
        <span className="text-xs text-ink-muted">{summary}</span>
      </span>
      <span className="text-right text-sm font-bold text-navy md:order-last" title="Chance it gets all of those results">{formatOdds(chance)}</span>
      <span className="col-span-2 md:col-span-1"><Groups games={games} /></span>
    </div>
  );
}

/**
 * What the team needs, from its likeliest way in: its own results, then the help it needs from each rival.
 * "Fill in the likeliest way" picks every result on the board; then the card shrinks to a bar with Undo.
 * It can also be minimized by hand. `way` is null only while filled in, when the tree with those picks may
 * have no way left to show.
 */
export function WayCard({ way, team, filled, picks, onToggle }: { way: Likeliest | null; team: string; filled: boolean; picks: number; onToggle: () => void }) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState(true);
  if (filled)
    return (
      <section aria-label="Likeliest way in" className="mt-2 flex max-w-3xl animate-rise items-center justify-between gap-3 rounded-xl bg-mist py-1 pl-4 pr-1">
        <p className="text-sm text-navy">
          <span className="font-display font-bold">Likeliest way filled in</span>
          <span className="text-ink-muted"> · {picks} pick{picks === 1 ? "" : "s"} on the board</span>
        </p>
        <button type="button" onClick={onToggle} className={`${PILL} border border-ink-muted/40 bg-white text-navy hover:bg-mist`}>Undo</button>
      </section>
    );
  if (!way) return null;
  const fill = (
    <button type="button" onClick={onToggle} className={`${PILL} justify-center bg-marker text-white hover:bg-marker-text`}>Fill in the likeliest way</button>
  );
  const toggle = (
    <button type="button" aria-expanded={open} aria-label={open ? "Minimize" : "Expand"} onClick={() => setOpen(!open)}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted hover:bg-white md:h-8 md:w-8">
      <svg aria-hidden viewBox="0 0 16 16" className={`h-4 w-4 transition-transform ${open ? "" : "rotate-180"}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10l4-4 4 4" /></svg>
    </button>
  );
  if (!open)
    return (
      <section aria-label={way.title} className="mt-2 flex max-w-3xl items-center justify-between gap-2 rounded-xl bg-mist py-1 pl-4 pr-1">
        <p className="min-w-0 truncate text-sm">
          <span className="font-display font-bold text-navy">{way.title}</span>
          <span className="text-ink-muted"> · {way.summary}</span>
        </p>
        <span className="flex items-center gap-1">{fill}{toggle}</span>
      </section>
    );
  const rivals = all ? way.rivals : way.rivals.slice(0, RIVALS_SHOWN);
  const own: Game[] = way.ownGames.map((g) => ({ opponent: g.opponent, result: g.result, chance: g.result === "lose" ? 1 - g.winChance : g.winChance }));
  const footer = [way.favorites && `${way.favorites}.`, way.note].filter(Boolean).join(" ");
  return (
    <section aria-label={way.title} className="mt-2 flex max-w-3xl animate-rise flex-col gap-3 rounded-xl bg-mist p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 pt-1">
          <h3 className="font-display text-base font-bold text-navy">{way.title}</h3>
          <p className="text-xs text-ink-muted">{way.scope}</p>
        </div>
        <span className="flex items-center gap-1"><span className="hidden md:flex">{fill}</span>{toggle}</span>
      </div>

      {own.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className={`px-1 ${sub}`}>Its own part</span>
          <Row team={team} summary={way.ownSummary} chance={way.ownChance} games={own} />
        </div>
      )}

      {rivals.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className={`px-1 ${sub}`}>Help from elsewhere</span>
          {rivals.map((r) => (
            <Row key={r.teamId} team={r.team} summary={r.summary} chance={r.chance}
              games={r.games.map((g) => ({ opponent: g.opponent, result: g.result, chance: g.result === "win" ? 1 - g.chance : g.chance }))} />
          ))}
          {way.rivals.length > RIVALS_SHOWN && (
            <button type="button" onClick={() => setAll(!all)} className="self-start px-1 text-xs font-bold text-navy underline">
              {all ? "Show fewer" : `${way.rivals.length - RIVALS_SHOWN} more team${way.rivals.length - RIVALS_SHOWN === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-xs text-ink-soft">
        <span className="flex flex-wrap gap-3" aria-hidden>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-teal/30" />loses to</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-turf/30" />beats</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border border-dashed border-ink-muted/60" />either way</span>
        </span>
        {footer && <span className="text-ink-muted">{footer}</span>}
      </div>
      {/* On a phone the button spans the card's foot, leaving the title its own line. */}
      <div className="flex flex-col md:hidden">{fill}</div>
    </section>
  );
}
