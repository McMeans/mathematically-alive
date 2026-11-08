"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  conferenceName, decodeLocks, encodeLocks, formatOdds, formatRecord,
  type IndependentGame, type IndependentOutlook, type Locks, type PathTree, type PlayoffSignal, type TeamOutlook, type TeamPath,
} from "@/core";
import type { SimRequest, SimResponse } from "@/app/sim.worker";
import { Logo } from "@/app/Logo";
import { WayCard } from "./WayIn";
import { IndependentGames, IndependentWhatIf, SeasonWeeks, WhatIf } from "./Season";
import { IndependentTiles, PlayoffElsewhere, StatTiles, TeamList } from "./Panels";
import { ConferenceProvider } from "./conference";
import { ShareButton } from "./Share";

export type GameInfo = { id: number; homeId: number; awayId: number; week: number; start: string };
export type TeamInfo = { id: number; name: string; color: string | null; altColor: string | null };
/** One team in the team picker: its record and odds as shown, `key` to sort by (higher first), `out` to grey it. */
export type ListRow = { teamId: number; record: string; odds: string; key: number; out: boolean };
/** One conference (or the independents) in the team picker: its teams and their odds today. */
export type ConferenceList = { conference: string; teams: TeamInfo[]; rows: ListRow[] };
export type Result = { outlook: TeamOutlook[]; path: TeamPath; tree: PathTree; playoffGames: PlayoffSignal[] };
export type IndependentResult = { outlook: IndependentOutlook[]; games: IndependentGame[]; playoffGames: PlayoffSignal[] };
export type { Locks };
/** A game still to play, so a shared link's picks can be checked against it. */
export type OpenGame = { id: number; homeId: number; awayId: number };

/** What every team page shares: the header, the team picker and the frame around the page's own columns. */
type Common = {
  teamId: number;
  conference: string;
  teams: TeamInfo[];
  conferences: ConferenceList[];
  names: Record<number, string>;
  asOf: string;
  /** "Through Oct 31", shown in the header; `asOf` is its tooltip. */
  through: string;
  /** Every game left in the season, to check the picks in a shared link. */
  openGames: OpenGame[];
};

export const NAVY = "#14213D";
/** The Season Lab, carrying this page's picks over. */
const labHref = (locks: Locks) => (Object.keys(locks).length > 0 ? `/lab?games=${encodeLocks(locks)}` : "/lab");
export const pct = (p: number | null) => (p === null ? "—" : formatOdds(p));

/**
 * Picks and the what-if worker. `conference` null: an independent's page. `read` takes the worker's answer for this
 * kind of page (null for the other kind, which can't happen).
 */
function useWhatIf<R>(initial: R, conference: string | null, teamId: number, openGames: OpenGame[], read: (r: SimResponse) => R | null) {
  const [locks, setLocks] = useState<Locks>({});
  const [result, setResult] = useState<R>(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const worker = useRef<Worker | null>(null);
  const latest = useRef(0);
  const reader = useRef(read);
  useEffect(() => {
    const w = new Worker(new URL("../sim.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<SimResponse>) => {
      if (e.data.id !== latest.current) return; // a newer request is in flight
      const r = reader.current(e.data);
      if (r !== null) setResult(r);
      setBusy(false);
    };
    w.onerror = w.onmessageerror = () => {
      setBusy(false);
      setFailed(true);
    };
    worker.current = w;
    // A shared link's picks ("?picks=401-12.402-30") load as the starting what-if.
    const text = new URLSearchParams(window.location.search).get("picks");
    const shared = decodeLocks(text, openGames);
    if (Object.keys(shared).length > 0) update(shared);
    else if (text !== null) {
      // Nothing in the link survived: drop the param so the address bar doesn't claim picks the page isn't showing.
      const url = new URL(window.location.href);
      url.searchParams.delete("picks");
      window.history.replaceState(window.history.state, "", url);
    }
    return () => w.terminate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on load: the worker and a shared link's picks
  }, []);

  function update(next: Locks) {
    setLocks(next);
    // Keep the address bar a link to these picks, without adding history entries.
    const url = new URL(window.location.href);
    const text = encodeLocks(next);
    if (text) url.searchParams.set("picks", text);
    else url.searchParams.delete("picks");
    window.history.replaceState(window.history.state, "", url);
    if (Object.keys(next).length === 0) {
      latest.current++; // drop any pending result
      setResult(initial);
      setBusy(false);
      setFailed(false);
      return;
    }
    setBusy(true);
    setFailed(false);
    worker.current?.postMessage({ id: ++latest.current, conference, teamId, locks: next } satisfies SimRequest);
  }

  /** Lock a game to a winner; a missing winner (or the current one, when toggling) clears it. */
  function pick(gameId: number, winner: number | undefined) {
    const next = { ...locks };
    if (winner === undefined || next[gameId] === winner) delete next[gameId];
    else next[gameId] = winner;
    update(next);
  }
  const status = busy ? "Updating…" : failed ? "Couldn’t update. Showing the last result." : "";
  return { locks, result, busy, failed, status, update, pick };
}

/** A conference team's page. */
export function Explorer({ initial, ...common }: Common & { initial: Result }) {
  const { teamId, conference, teams } = common;
  const { locks, result, busy, failed, status, update, pick } = useWhatIf<Result>(initial, conference, teamId, common.openGames, (r) =>
    r.independent ? null : { outlook: r.outlook, path: r.path, tree: r.tree, playoffGames: r.playoffGames });
  // The likeliest-way-in picks currently locked by the button (they stay locked while the live tree changes).
  const [wayPicks, setWayPicks] = useState<{ gameId: number; winner: number }[] | null>(null);
  const { outlook, path, tree } = result;
  const me = outlook.find((o) => o.teamId === teamId)!;
  const team = teams.find((t) => t.id === teamId)!;
  const likeliest = tree.likeliest;
  // Outline only what the card names: the team's own results and the non-favorites it needs.
  const likely = useMemo(() => new Map((likeliest?.named ?? []).map((p) => [p.gameId, p.winner])), [likeliest]);
  const wayOn = wayPicks !== null && wayPicks.every((p) => locks[p.gameId] === p.winner);
  const reset = () => { setWayPicks(null); update({}); };
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
  return (
    <Frame
      {...common}
      record={formatRecord(me.record, conference)}
      hasLocks={Object.keys(locks).length > 0}
      lab={labHref(locks)}
      onReset={reset}
      busy={busy}
      failed={failed}
      status={status}
      tiles={(condensed) => <StatTiles outlook={me} ifWinOut={path.ifWinOut} compact condensed={condensed} />}
      main={
        <>
          {(wayOn || likeliest) && <WayCard way={likeliest} team={team.name} filled={wayOn} picks={wayPicks?.length ?? 0} onToggle={toggleWay} />}
          <div className={`transition-opacity duration-200 ${busy ? "opacity-70" : ""}`}>
            <SeasonWeeks weeks={tree.weeks} base={initial.tree.weeks} teamId={teamId} locks={locks} likely={likely} onPick={pick} />
            {tree.footnote && <p className="mt-2 text-xs text-ink-muted">{tree.footnote}</p>}
            <PlayoffElsewhere games={result.playoffGames} />
          </div>
        </>
      }
      aside={
        <WhatIf
          team={team}
          me={me}
          outlook={outlook}
          today={initial.outlook.find((o) => o.teamId === teamId)!}
          locks={locks}
          weeks={tree.weeks}
          names={common.names}
          teamId={teamId}
          onPick={pick}
          onReset={reset}
        />
      }
    />
  );
}

/** An FBS independent's page: no conference, so no title game; its own games and the playoff. */
export function IndependentExplorer({ initial, ...common }: Common & { initial: IndependentResult }) {
  const { teamId, teams } = common;
  const { locks, result, busy, failed, status, update, pick } = useWhatIf<IndependentResult>(initial, null, teamId, common.openGames, (r) =>
    r.independent ? { outlook: r.outlook, games: r.games, playoffGames: r.playoffGames } : null);
  const me = result.outlook.find((o) => o.teamId === teamId)!;
  const team = teams.find((t) => t.id === teamId)!;
  return (
    <Frame
      {...common}
      record={formatRecord(me.record, common.conference)}
      hasLocks={Object.keys(locks).length > 0}
      lab={labHref(locks)}
      onReset={() => update({})}
      busy={busy}
      failed={failed}
      status={status}
      tiles={(condensed) => <IndependentTiles outlook={me} condensed={condensed} />}
      main={
        <div className={`transition-opacity duration-200 ${busy ? "opacity-70" : ""}`}>
          <IndependentGames games={result.games} teamId={teamId} locks={locks} onPick={pick} />
          <PlayoffElsewhere games={result.playoffGames} />
        </div>
      }
      aside={
        <IndependentWhatIf
          team={team}
          me={me}
          today={initial.outlook.find((o) => o.teamId === teamId)!}
          locks={locks}
          games={result.games}
          teamId={teamId}
          onPick={pick}
          onReset={() => update({})}
        />
      }
    />
  );
}

function Frame({ teamId, conference, teams, conferences, names, asOf, through, record, hasLocks, lab, onReset, busy, failed, status, tiles, main, aside }: Common & {
  /** The team's record as the picker shows it. */
  record: string;
  hasLocks: boolean;
  /** The Season Lab link, carrying the picks. */
  lab: string;
  onReset: () => void;
  busy: boolean;
  failed: boolean;
  status: string;
  /** The odds tiles pinned on phones; `condensed` once the page has scrolled. */
  tiles: (condensed: boolean) => ReactNode;
  main: ReactNode;
  aside: ReactNode;
}) {
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
  const team = teams.find((t) => t.id === teamId)!;

  const list = (
    <TeamList
      conferences={conferences}
      names={names}
      selectedId={going ?? teamId}
      onSelect={(id) => {
        if (id !== teamId) setGoing(id);
        setSheet(false);
      }}
    />
  );

  return (
    <ConferenceProvider value={conference}>
      <div className="flex min-h-dvh flex-col md:h-dvh md:overflow-hidden">
        {/* On phones the page scrolls as one, so the header, team picker and odds stay pinned on top. */}
        <div className="sticky top-0 z-30 bg-white md:static">
          <header className="flex items-center justify-between gap-3 border-b border-ink-muted/25 px-4 py-3">
            <div className="flex items-center gap-2">
              <Logo size={32} decorative />
              <h1 className="font-display text-lg font-bold tracking-tight sm:text-xl">Mathematically Alive</h1>
            </div>
            <div className="flex items-center gap-3">
              <Link href={lab} className="text-sm font-bold text-navy underline-offset-2 hover:underline">Season Lab</Link>
              <span className="rounded-full bg-navy px-3 py-1 text-sm font-bold text-white">{conferenceName(conference)}</span>
              <span title={asOf} className="hidden text-sm text-ink-muted sm:inline">
                {through}
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
                    {team.name} <span className="font-normal text-ink-soft">· {record}</span>
                  </span>
                  <span className="hidden text-xs font-normal text-ink-muted sm:inline">Change team</span>
                  <span aria-hidden className={`text-ink-muted transition-transform duration-200 ${sheet ? "rotate-180" : ""}`}>▾</span>
                </button>
                {hasLocks && <ShareButton className="md:hidden" />}
                {hasLocks && (
                  // On phones Share and Reset ride in the pinned bar; wider screens have them in the summary column.
                  <button type="button" onClick={onReset} className="press flex min-h-10 shrink-0 animate-rise items-center gap-1.5 rounded-full border border-ink-muted/40 bg-white px-3 text-sm font-bold text-navy hover:bg-mist md:hidden">
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
              {tiles(condensed)}
            </div>
          </div>
        </div>

        {/* On desktop the page is one screen tall and each column scrolls on its own. */}
        <div className="grid flex-1 md:min-h-0 md:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[260px_minmax(0,1fr)_340px]">
          <nav aria-label="Teams" className="scroll-thin hidden border-r border-ink-muted/25 xl:block xl:overflow-y-auto">
            {list}
          </nav>

          <main aria-busy={going !== null} className="scroll-thin relative min-w-0 p-4 md:overflow-y-auto md:p-6">
            {going !== null && <Loading name={names[going]} />}
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="font-display text-xl font-bold">
                Play out the season
              </h2>
              <div className="flex items-center gap-3">
                <span role="status" className={`text-xs ${failed ? "text-red-700" : "text-ink-muted"}`}>{status}</span>
              </div>
            </div>
            {main}
          </main>

          <aside aria-label="Summary" aria-busy={going !== null} className={`scroll-thin relative hidden min-h-0 border-l border-ink-muted/25 md:flex md:flex-col md:overflow-y-auto tall:md:overflow-hidden transition-opacity duration-200 ${busy ? "opacity-70" : ""}`}>
            {going !== null && <Loading />}
            {aside}
          </aside>
        </div>
      </div>
    </ConferenceProvider>
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
