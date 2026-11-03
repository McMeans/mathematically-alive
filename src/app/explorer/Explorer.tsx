"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatOdds, formatRecord, type PathTree, type TeamOutlook, type TeamPath } from "@/core";
import { CONFERENCE } from "@/app/config";
import type { SimRequest, SimResponse } from "@/app/sim.worker";
import { Logo } from "@/app/Logo";
import { WayCard } from "./WayIn";
import { byOdds, SeasonWeeks, WhatIf } from "./Season";
import { StatTiles, TeamList } from "./Panels";

export type GameInfo = { id: number; homeId: number; awayId: number; week: number; start: string };
export type TeamInfo = { id: number; name: string; color: string | null; altColor: string | null };
export type Result = { outlook: TeamOutlook[]; path: TeamPath; tree: PathTree };
export type Locks = Record<number, number>;

type Props = {
  teamId: number;
  teams: TeamInfo[];
  names: Record<number, string>;
  asOf: string;
  initial: Result;
};

export const NAVY = "#14213D";
export const pct = (p: number | null) => (p === null ? "—" : formatOdds(p));
export const oddsTone = (p: number | null) => (p === null ? "text-navy" : p >= 0.5 ? "text-turf" : p < 0.1 ? "text-marker-text" : "text-navy");

export function Explorer({ teamId, teams, names, asOf, initial }: Props) {
  const [locks, setLocks] = useState<Locks>({});
  const [result, setResult] = useState<Result>(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState(false);
  const pickerRef = useRef<HTMLButtonElement>(null);
  // Phones: fold the odds tiles into one row once scrolled. The gap between the two thresholds stops
  // the bar flickering as its own height change nudges the scroll position.
  const [condensed, setCondensed] = useState(false);
  useEffect(() => {
    const onScroll = () => setCondensed((c) => (c ? window.scrollY > 40 : window.scrollY > 160));
    onScroll(); // the browser may restore a scrolled position on reload
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!sheet) return;
    // The picker is hidden from xl up; close the popup if the window widens past it.
    const wide = window.matchMedia("(min-width: 80rem)");
    const onWide = () => wide.matches && setSheet(false);
    wide.addEventListener("change", onWide);
    const close = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSheet(false);
      pickerRef.current?.focus();
    };
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("keydown", close);
      wide.removeEventListener("change", onWide);
    };
  }, [sheet]);
  // The team just clicked in the list, while its page loads (this component remounts per team).
  const [going, setGoing] = useState<number | null>(null);
  // The likeliest-way-in picks currently locked by the button (they stay locked while the live tree changes).
  const [wayPicks, setWayPicks] = useState<{ gameId: number; winner: number }[] | null>(null);
  const worker = useRef<Worker | null>(null);
  // The next team's page remounts this component; if it never arrives (failed load, back button), drop the overlay.
  useEffect(() => {
    if (going === null) return;
    const clear = () => setGoing(null);
    const timer = setTimeout(clear, 10_000);
    window.addEventListener("popstate", clear);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("popstate", clear);
    };
  }, [going]);
  const latest = useRef(0);

  useEffect(() => {
    const w = new Worker(new URL("../sim.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<SimResponse>) => {
      if (e.data.id !== latest.current) return; // a newer request is in flight
      setResult({ outlook: e.data.outlook, path: e.data.path, tree: e.data.tree });
      setBusy(false);
    };
    w.onerror = w.onmessageerror = () => {
      setBusy(false);
      setFailed(true);
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

  function update(next: Locks) {
    setLocks(next);
    if (Object.keys(next).length === 0) {
      latest.current++; // drop any pending result
      setWayPicks(null);
      setResult(initial);
      setBusy(false);
      setFailed(false);
      return;
    }
    setBusy(true);
    setFailed(false);
    worker.current?.postMessage({ id: ++latest.current, teamId, locks: next } satisfies SimRequest);
  }

  /** Lock a game to a winner; a missing winner (or the current one, when toggling) clears it. */
  function pick(gameId: number, winner: number | undefined) {
    const next = { ...locks };
    if (winner === undefined || next[gameId] === winner) delete next[gameId];
    else next[gameId] = winner;
    update(next);
  }

  const { outlook, path, tree } = result;
  const me = outlook.find((o) => o.teamId === teamId)!;
  const team = teams.find((t) => t.id === teamId)!;
  // Best odds first, by the odds the list shows (today's, before any picks).
  const order = useMemo(() => [...initial.outlook].sort(byOdds(names)).map((o) => o.teamId), [initial, names]);
  const hasLocks = Object.keys(locks).length > 0;
  const likeliest = tree.likeliest;
  // Outline only what the card names: the team's own results and the non-favorites it needs.
  const likely = useMemo(() => new Map((likeliest?.named ?? []).map((p) => [p.gameId, p.winner])), [likeliest]);
  const wayOn = wayPicks !== null && wayPicks.every((p) => locks[p.gameId] === p.winner);
  function toggleWay() {
    if (wayOn) {
      const next = { ...locks };
      for (const p of wayPicks!) delete next[p.gameId];
      setWayPicks(null);
      update(next);
    } else if (likeliest) {
      setWayPicks(likeliest.picks);
      update({ ...locks, ...Object.fromEntries(likeliest.picks.map((p) => [p.gameId, p.winner])) });
    }
  }
  const status = busy ? "Updating…" : failed ? "Couldn’t update. Showing the last result." : "";

  const list = (
    <TeamList
      teams={teams}
      order={order}
      outlook={initial.outlook}
      selectedId={going ?? teamId}
      onSelect={(id) => {
        if (id !== teamId) setGoing(id);
        setSheet(false);
      }}
    />
  );

  return (
    <div className="flex min-h-dvh flex-col md:h-dvh md:overflow-hidden">
      {/* On phones the page scrolls as one, so the header, team picker and odds stay pinned on top. */}
      <div className="sticky top-0 z-30 bg-white md:static">
        <header className="flex items-center justify-between gap-3 border-b border-ink-muted/25 px-4 py-3">
          <div className="flex items-center gap-2">
            <Logo size={32} decorative />
            <h1 className="font-display text-lg font-bold tracking-tight sm:text-xl">Mathematically Alive</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-navy px-3 py-1 text-sm font-bold text-white">{CONFERENCE}</span>
            <span className="hidden text-sm text-ink-muted sm:inline">
              {asOf}
            </span>
          </div>
        </header>

        {/* Below xl the team list collapses into this picker, leaving the weeks room to breathe. */}
        <div className="xl:hidden">
          <div className="relative border-b border-ink-muted/25 px-4 py-2 md:px-6">
            <div className="flex items-center gap-2">
              <button
                type="button"
                ref={pickerRef}
                aria-expanded={sheet}
                aria-controls="team-sheet"
                onClick={() => setSheet(!sheet)}
                className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-lg bg-mist px-3 text-left text-sm font-bold transition-colors hover:bg-navy/10"
              >
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: team.color ?? NAVY }} />
                <span className="min-w-0 flex-1 truncate">
                  {team.name} <span className="font-normal text-ink-soft">· {formatRecord(me.record, CONFERENCE)}</span>
                </span>
                <span className="hidden text-xs font-normal text-ink-muted sm:inline">Change team</span>
                <span aria-hidden className={`text-ink-muted transition-transform duration-200 ${sheet ? "rotate-180" : ""}`}>▾</span>
              </button>
              {hasLocks && (
                // On phones Reset rides in the pinned bar; wider screens have it in the summary column.
                <button type="button" onClick={() => update({})} className="press flex min-h-10 shrink-0 animate-rise items-center gap-1.5 rounded-full bg-marker-text px-3 text-sm font-bold text-white hover:bg-marker md:hidden">
                  <span aria-hidden>↺</span> Reset
                </button>
              )}
            </div>
            {sheet && (
              <>
                {/* Clicking anywhere outside the popup closes it. */}
                <button type="button" aria-label="Close team list" tabIndex={-1} onClick={() => { setSheet(false); pickerRef.current?.focus(); }} className="fixed inset-0 z-20 cursor-default" />
                <div
                  id="team-sheet"
                  className="scroll-thin absolute inset-x-4 top-full z-30 mt-1 max-h-[60dvh] origin-top animate-pop overflow-y-auto rounded-lg border border-ink-muted/25 bg-white shadow-lg md:inset-x-6 md:max-w-sm"
                >
                  {list}
                </div>
              </>
            )}
          </div>
          <div className={`border-b border-ink-muted/25 px-4 transition-[padding] duration-200 md:hidden ${condensed ? "py-2" : "py-3"}`}>
            <StatTiles outlook={me} ifWinOut={path.ifWinOut} compact condensed={condensed} />
          </div>
        </div>
      </div>

      {/* On desktop the page is one screen tall and each column scrolls on its own. */}
      <div className="grid flex-1 md:min-h-0 md:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[260px_minmax(0,1fr)_340px]">
        <nav aria-label={`${CONFERENCE} teams`} className="scroll-thin hidden border-r border-ink-muted/25 xl:block xl:overflow-y-auto">
          {list}
        </nav>

        <main aria-busy={going !== null} className="scroll-thin relative min-w-0 p-4 md:overflow-y-auto md:p-6">
          {going !== null && <Loading name={teams.find((t) => t.id === going)?.name} />}
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-xl font-bold">
              Play out the season
            </h2>
            <div className="flex items-center gap-3">
              <span role="status" className={`text-xs ${failed ? "text-marker-text" : "text-ink-muted"}`}>{status}</span>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!likeliest && !wayOn}
              aria-pressed={wayOn}
              onClick={toggleWay}
              className="min-h-11 rounded-full border border-marker px-3 text-sm font-bold text-marker-text disabled:opacity-40 aria-pressed:bg-marker aria-pressed:text-white md:min-h-8"
            >
              Fill in the likeliest way
            </button>
          </div>
          {!wayOn && likeliest && <WayCard way={likeliest} teamName={team.name} />}

          <div className={`transition-opacity duration-200 ${busy ? "opacity-70" : ""}`}>
            <SeasonWeeks weeks={tree.weeks} base={initial.tree.weeks} teamId={teamId} locks={locks} likely={likely} onPick={pick} />
            {tree.footnote && <p className="mt-2 text-xs text-ink-muted">{tree.footnote}</p>}
          </div>
        </main>

        <aside aria-label="Summary" aria-busy={going !== null} className={`scroll-thin relative hidden min-h-0 border-l border-ink-muted/25 md:flex md:flex-col md:overflow-y-auto tall:md:overflow-hidden transition-opacity duration-200 ${busy ? "opacity-70" : ""}`}>
          {going !== null && <Loading />}
          <WhatIf
            team={team}
            me={me}
            outlook={outlook}
            today={initial.outlook.find((o) => o.teamId === teamId)!}
            locks={locks}
            weeks={tree.weeks}
            names={names}
            teamId={teamId}
            onPick={pick}
            onReset={() => update({})}
          />
        </aside>
      </div>
    </div>
  );
}

/** Covers a column while the next team's page loads. */
function Loading({ name }: { name?: string }) {
  return (
    // Sticks to the top of the column, so it covers what's on screen however far the column is scrolled.
    <div className="sticky top-0 z-10 -mx-4 -mt-4 h-0 md:-mx-6 md:-mt-6">
      <div className="flex h-dvh justify-center bg-white/75 pt-24">
        <div role="status" className="flex h-fit items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-bold text-navy shadow">
          <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-navy/25 border-t-navy" />
          {name ? `Loading ${name}…` : <span className="sr-only">Loading</span>}
        </div>
      </div>
    </div>
  );
}
