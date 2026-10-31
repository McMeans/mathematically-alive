"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatOdds, type PathTree, type TeamOutlook, type TeamPath } from "@/core";
import type { SimRequest, SimResponse } from "@/app/sim.worker";
import { Logo } from "@/app/Logo";
import { HelpList } from "./HelpList";
import { Drill, TreeView } from "./Tree";
import { Stats, StatTiles, TeamList } from "./Panels";

export type GameInfo = { id: number; homeId: number; awayId: number; week: number; start: string };
export type HelpGame = GameInfo & { oddsIfHome: number; oddsIfAway: number };
export type TeamInfo = { id: number; name: string; color: string | null };
export type Result = { outlook: TeamOutlook[]; path: TeamPath; tree: PathTree };
export type Locks = Record<number, number>;

type Props = {
  teamId: number;
  teams: TeamInfo[];
  names: Record<number, string>;
  /** The team's own unplayed games. */
  own: GameInfo[];
  /** Frozen for this team: top non-own key games from the run with no locks. */
  help: HelpGame[];
  year: number;
  lastWeek: number;
  initial: Result;
};

export const NAVY = "#14213D";
export const pct = (p: number | null) => (p === null ? "—" : formatOdds(p));
export const oddsTone = (p: number | null) => (p === null ? "text-navy" : p >= 0.5 ? "text-turf" : p < 0.1 ? "text-marker-text" : "text-navy");

export function Explorer({ teamId, teams, names, own, help, year, lastWeek, initial }: Props) {
  const [locks, setLocks] = useState<Locks>({});
  const [result, setResult] = useState<Result>(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState(false);
  const worker = useRef<Worker | null>(null);
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
  const oppOf = (gameId: number) => {
    const g = own.find((x) => x.id === gameId)!;
    return g.homeId === teamId ? g.awayId : g.homeId;
  };
  // Row order is fixed by the no-lock odds so rows don't jump when a lock changes the numbers.
  const order = useMemo(() => {
    const rank = new Map(initial.outlook.map((o) => [o.teamId, o.titleGame]));
    return teams.map((t) => t.id).sort((a, b) => rank.get(b)! - rank.get(a)! || a - b);
  }, [initial, teams]);
  const hasLocks = Object.keys(locks).length > 0;
  const status = busy ? "Updating…" : failed ? "Couldn’t update. Showing the last result." : "";

  const list = (
    <TeamList teams={teams} order={order} outlook={outlook} selectedId={teamId} />
  );
  const help3 = (
    <HelpList help={help} names={names} locks={locks} path={path} baseTitle={initial.path.titleGame} onPick={pick} />
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-ink-muted/25 px-4 py-3">
        <div className="flex items-center gap-2">
          <Logo size={32} decorative />
          <h1 className="font-display text-lg font-bold tracking-tight sm:text-xl">Mathematically Alive</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-navy px-3 py-1 text-sm font-bold text-white">ACC</span>
          <span className="hidden text-sm text-ink-muted sm:inline">
            {year} · after Week {lastWeek}
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

      <div className="grid flex-1 md:grid-cols-[260px_minmax(0,1fr)_340px]">
        <nav aria-label="ACC teams" className="hidden border-r border-ink-muted/25 md:block">
          {list}
        </nav>

        <main className="min-w-0 p-4 md:p-6">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-display text-xl font-bold">
              <span className="hidden md:inline">Paths to the title game</span>
              <span className="md:hidden">Path to the title game</span>
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

          <div className={`transition-opacity ${busy ? "opacity-70" : ""}`}>
            <div className="hidden md:block">
              <p className="text-sm text-ink-muted">Click a branch to lock it</p>
              <TreeView tree={tree} locks={locks} teamId={teamId} oppOf={oppOf} onPick={pick} />
            </div>
            <div className="md:hidden">
              <Drill tree={tree} locks={locks} teamId={teamId} oppOf={oppOf} onPick={pick} onUnlock={(ids) => {
                const next = { ...locks };
                for (const id of ids) delete next[id];
                update(next);
              }} />
            </div>

            <h2 className="mt-8 font-display text-xl font-bold">Help from elsewhere</h2>
            {help.length === 0 ? <p className="mt-2 text-sm text-ink-muted">Nothing else moves the needle.</p> : help3}
          </div>
        </main>

        <aside aria-label="Summary" className={`hidden border-l border-ink-muted/25 p-6 md:block ${busy ? "opacity-70" : ""}`}>
          <Stats team={team} outlook={outlook} me={me} path={path} teamId={teamId} own={own} names={names} />
        </aside>
      </div>
    </div>
  );
}
