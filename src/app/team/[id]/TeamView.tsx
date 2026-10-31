"use client";
import { useEffect, useRef, useState } from "react";
import { formatOdds, type TeamOutlook, type TeamPath } from "@/core";
import type { SimRequest, SimResponse } from "@/app/sim.worker";

export type GameInfo = { id: number; homeId: number; awayId: number; week: number; start: string };

type Props = {
  teamId: number;
  teamName: string;
  color: string | null;
  names: Record<number, string>;
  games: GameInfo[];
  initialPath: TeamPath;
  initialOutlook: TeamOutlook;
};

const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const when = (g: GameInfo) => (Number.isNaN(Date.parse(g.start)) ? `Week ${g.week}` : dateFmt.format(new Date(g.start)));

export function TeamView({ teamId, teamName, color, names, games, initialPath, initialOutlook }: Props) {
  const [locks, setLocks] = useState<Record<number, number>>({});
  const [result, setResult] = useState({ path: initialPath, outlook: initialOutlook });
  const [busy, setBusy] = useState(false);
  const worker = useRef<Worker | null>(null);
  const latest = useRef(0);

  useEffect(() => {
    const w = new Worker(new URL("../../sim.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<SimResponse>) => {
      if (e.data.id !== latest.current) return; // a newer request is in flight
      setResult({ path: e.data.path, outlook: e.data.outlook });
      setBusy(false);
    };
    worker.current = w;
    return () => w.terminate();
  }, []);

  function update(next: Record<number, number>) {
    setLocks(next);
    if (Object.keys(next).length === 0) {
      latest.current++; // drop any pending result
      setResult({ path: initialPath, outlook: initialOutlook });
      setBusy(false);
      return;
    }
    setBusy(true);
    worker.current?.postMessage({ id: ++latest.current, teamId, locks: next } satisfies SimRequest);
  }

  const { path, outlook } = result;
  const nameOf = (id: number) => names[id] ?? `Team ${id}`;
  const gameById = new Map(games.map((g) => [g.id, g]));
  const own = games.filter((g) => g.homeId === teamId || g.awayId === teamId);
  const keyGames = path.keyGames.map((k) => gameById.get(k.gameId)).filter((g): g is GameInfo => !!g && !own.includes(g));
  const whatIf = [...own, ...keyGames];
  const pill = path.status === "alive" ? "Alive" : path.summary;

  return (
    <div>
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-5xl" style={{ borderLeft: `6px solid ${color ?? "#14213D"}`, paddingLeft: 12 }}>
        {teamName}
      </h1>
      <p className="mt-3">
        <span className={`inline-block rounded-full px-3 py-1 text-sm font-bold text-white ${path.status === "eliminated" ? "bg-ink-soft" : "bg-turf"}`}>
          {pill}
        </span>
        <span className="ml-3 text-sm text-ink-soft">
          {outlook.record.wins}-{outlook.record.losses} ({outlook.record.conferenceWins}-{outlook.record.conferenceLosses} ACC)
        </span>
      </p>

      <div aria-live="polite" className={busy ? "opacity-60" : ""}>
        {busy && <p className="mt-3 text-sm text-ink-muted" role="status">Recalculating…</p>}
        <h2 className="sr-only">Odds</h2>
        <dl className="mt-5 grid grid-cols-3 gap-2 sm:gap-3">
          <Odds label="ACC title game" value={outlook.titleGame} className="text-turf" />
          <Odds label="Champion" value={outlook.champion} className="text-turf" />
          <Odds label="Playoff (experimental)" value={outlook.playoff} className="text-navy" />
        </dl>

        <h2 className="mt-8 font-display text-xl font-bold">What has to happen</h2>
        <p className="mt-2 text-ink-soft">{path.summary}</p>
        {path.steps.length > 0 && (
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-ink-soft">
            {path.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        )}

        {path.keyGames.length > 0 && (
          <>
            <h2 className="mt-8 font-display text-xl font-bold">Key games</h2>
            <ul className="mt-3 space-y-2">
              {path.keyGames.map((k) => {
                const g = gameById.get(k.gameId);
                return (
                  <li key={k.gameId} className="rounded-lg bg-mist p-3">
                    <p className="font-bold">
                      {nameOf(k.awayId)} at {nameOf(k.homeId)}
                      {g && <span className="font-normal text-ink-muted"> · {when(g)}</span>}
                    </p>
                    <p className="text-sm text-ink-soft">
                      <span className="font-bold text-marker-text">Root for {nameOf(k.rooting)}</span>: title-game odds{" "}
                      {formatOdds(k.oddsIfAwayWins)} if {nameOf(k.awayId)} wins, {formatOdds(k.oddsIfHomeWins)} if {nameOf(k.homeId)} wins.
                    </p>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <section className="mt-8 rounded-lg border border-ink-muted/30 p-4" aria-labelledby="whatif">
        <div className="flex items-center justify-between gap-2">
          <h2 id="whatif" className="font-display text-xl font-bold">What-if</h2>
          <button
            type="button"
            onClick={() => update({})}
            disabled={Object.keys(locks).length === 0}
            className="rounded-md border border-navy px-3 py-1 text-sm font-bold text-navy disabled:opacity-40"
          >
            Reset
          </button>
        </div>
        {whatIf.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">No games left to play.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {whatIf.map((g) => (
              <li key={g.id}>
                <fieldset>
                  <legend className="text-sm font-bold">
                    {nameOf(g.awayId)} at {nameOf(g.homeId)} <span className="font-normal text-ink-muted">· {when(g)}</span>
                  </legend>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(
                      [
                        ["Sim", undefined],
                        [`${nameOf(g.homeId)} wins`, g.homeId],
                        [`${nameOf(g.awayId)} wins`, g.awayId],
                      ] as const
                    ).map(([label, winner]) => (
                      <label
                        key={label}
                        className="cursor-pointer rounded-md border border-navy px-2 py-1 text-sm has-checked:bg-navy has-checked:text-white has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-navy"
                      >
                        <input
                          type="radio"
                          name={`game-${g.id}`}
                          className="sr-only"
                          checked={locks[g.id] === winner}
                          onChange={() => {
                            const next = { ...locks };
                            if (winner === undefined) delete next[g.id];
                            else next[g.id] = winner;
                            update(next);
                          }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Odds({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className="rounded-lg bg-mist p-3">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className={`text-2xl font-bold sm:text-3xl ${className}`}>{formatOdds(value)}</dd>
    </div>
  );
}
