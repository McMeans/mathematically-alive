"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatOdds, type PathTree, type TeamOutlook, type TeamPath } from "@/core";
import type { SimRequest, SimResponse } from "@/app/sim.worker";
import { Logo } from "@/app/Logo";
import { WayCard } from "./WayIn";
import { SeasonWeeks, WhatIf } from "./Season";
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
  // Row order is fixed by the no-lock odds so rows don't jump when a lock changes the numbers.
  const order = useMemo(() => {
    const rank = new Map(initial.outlook.map((o) => [o.teamId, o.titleGame]));
    return teams.map((t) => t.id).sort((a, b) => rank.get(b)! - rank.get(a)! || a - b);
  }, [initial, teams]);
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
      <header className="flex items-center justify-between gap-3 border-b border-ink-muted/25 px-4 py-3">
        <div className="flex items-center gap-2">
          <Logo size={32} decorative />
          <h1 className="font-display text-lg font-bold tracking-tight sm:text-xl">Mathematically Alive</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-navy px-3 py-1 text-sm font-bold text-white">ACC</span>
          <span className="hidden text-sm text-ink-muted sm:inline">
            {asOf}
          </span>
        </div>
      </header>

      <div className="md:hidden">
        <div className="border-b border-ink-muted/25 p-4">
          <button
            type="button"
            aria-expanded={sheet}
            aria-controls="team-sheet"
            onClick={() => setSheet(!sheet)}
            className="flex min-h-11 w-full items-center gap-2 rounded-lg bg-mist px-3 text-left font-bold"
          >
            <span aria-hidden className="h-3 w-3 rounded-full" style={{ background: team.color ?? NAVY }} />
            <span className="flex-1">
              {team.name} <span className="font-normal text-ink-soft">· {me.record.wins}-{me.record.losses}</span>
            </span>
            <span aria-hidden>{sheet ? "▴" : "▾"}</span>
          </button>
          {sheet && (
            <div id="team-sheet" className="mt-2 max-h-[60dvh] overflow-y-auto rounded-lg border border-ink-muted/25">
              {list}
            </div>
          )}
        </div>
        <div className="p-4 pb-0">
          <StatTiles outlook={me} ifWinOut={path.ifWinOut} compact />
        </div>
      </div>

      {/* On desktop the page is one screen tall and each column scrolls on its own. */}
      <div className="grid flex-1 md:min-h-0 md:grid-cols-[260px_minmax(0,1fr)_340px]">
        <nav aria-label="ACC teams" className="scroll-thin hidden border-r border-ink-muted/25 md:block md:overflow-y-auto">
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
              {hasLocks && (
                <button type="button" onClick={() => update({})} className="min-h-11 text-sm font-bold text-navy underline md:min-h-0">
                  Reset
                </button>
              )}
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

          <div className={`transition-opacity ${busy ? "opacity-70" : ""}`}>
            <SeasonWeeks weeks={tree.weeks} base={initial.tree.weeks} teamId={teamId} locks={locks} likely={likely} onPick={pick} />
            {tree.footnote && <p className="mt-2 text-xs text-ink-muted">{tree.footnote}</p>}
          </div>
        </main>

        <aside aria-label="Summary" aria-busy={going !== null} className={`scroll-thin relative hidden border-l border-ink-muted/25 p-6 md:block md:overflow-y-auto ${busy ? "opacity-70" : ""}`}>
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
