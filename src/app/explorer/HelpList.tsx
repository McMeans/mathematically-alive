"use client";
import type { HelpGame, PathTree } from "@/core";
import type { Locks } from "./Explorer";

const points = (d: number) => Math.round(d * 100);
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

type Props = {
  /** Frozen for this team: the games that matter, in the no-lock order, so rows never jump or vanish. */
  help: HelpGame[];
  /** The no-lock run's tree: fallback numbers for locked games, and the note about games left off. */
  base: PathTree;
  /** The current (locked) run's tree: live numbers. */
  live: PathTree;
  names: Record<number, string>;
  locks: Locks;
  onPick: (gameId: number, winner: number | undefined) => void;
};

export function HelpList({ help, base, live, names, locks, onPick }: Props) {
  // Order never changes (by date); which rows show comes from the live run, so rows only come and go when a lock changes.
  const liveOf = (id: number) => live.help.find((k) => k.gameId === id);
  const matters = (g: HelpGame) => {
    const cur = liveOf(g.gameId);
    return cur ? cur.now || cur.scenario !== null || cur.ifHomeWins !== null || cur.ifAwayWins !== null : locks[g.gameId] !== undefined;
  };
  const rows = help.filter(matters);
  if (rows.length === 0) return <p className="mt-2 text-sm text-ink-muted">{live.helpNote}</p>;
  return (
    <>
      <ul className="mt-3 space-y-3">
        {rows.map((g) => {
          // Live odds vs the current odds; a locked game drops out of the live list, so fall back to the frozen ones.
          const cur = liveOf(g.gameId);
          const src = cur ?? g;
          const ref = cur ? live.titleGame : base.titleGame;
          const delta = (p: number | null) => (p === null ? null : points(p - ref));
          const sel = locks[g.gameId];
          const seg = (label: string, d: number | null, winner: number | undefined, proven: "in" | "out" | null = null) => {
            const on = sel === winner;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={on}
                onClick={() => onPick(g.gameId, winner)}
                className={`min-h-11 flex-1 px-2 py-1 text-center text-sm leading-tight focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-navy ${on ? "rounded-md bg-white font-bold shadow" : ""}`}
              >
                {label}
                {proven ? (
                  <span className={`ml-1 font-bold ${proven === "in" ? "text-turf" : "text-marker-text"}`}>{proven === "in" ? "In" : "Out"}</span>
                ) : d !== null && (
                  <span className={`ml-1 font-bold tabular-nums ${d > 0 ? "text-turf" : d < 0 ? "text-marker-text" : "text-ink-muted"}`}>{signed(d)}</span>
                )}
              </button>
            );
          };
          const home = names[g.homeId] ?? `Team ${g.homeId}`;
          const away = names[g.awayId] ?? `Team ${g.awayId}`;
          const line = cur ? cur.scenario?.line : sel === undefined ? g.scenario?.line : undefined;
          return (
            <li key={g.gameId}>
              <p className="text-xs text-ink-muted">{g.detail}</p>
              <div role="group" aria-label={g.label} className="mt-1 flex rounded-lg bg-mist p-1">
                {seg(home, delta(src.oddsIfHomeWins), g.homeId, cur?.ifHomeWins ?? null)}
                {seg("Either", null, undefined)}
                {seg(away, delta(src.oddsIfAwayWins), g.awayId, cur?.ifAwayWins ?? null)}
              </div>
              {line && <p className="mt-1 text-xs text-ink-soft">{line}</p>}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-ink-muted">{live.helpNote}</p>
    </>
  );
}
