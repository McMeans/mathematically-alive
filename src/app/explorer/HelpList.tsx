"use client";
import type { TeamPath } from "@/core";
import type { HelpGame, Locks } from "./Explorer";

const dateFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const when = (g: HelpGame) => (Number.isNaN(Date.parse(g.start)) ? `Week ${g.week}` : dateFmt.format(new Date(g.start)));
const points = (d: number) => Math.round(d * 100);
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");

type Props = {
  help: HelpGame[];
  names: Record<number, string>;
  locks: Locks;
  path: TeamPath;
  /** Title-game odds with no locks, for games whose live numbers are gone (locked games). */
  baseTitle: number;
  onPick: (gameId: number, winner: number | undefined) => void;
};

export function HelpList({ help, names, locks, path, baseTitle, onPick }: Props) {
  return (
    <ul className="mt-3 space-y-3">
      {help.map((g) => {
        const live = path.keyGames.find((k) => k.gameId === g.id);
        // Live conditional odds vs the current odds; a locked game has no live entry, so fall back to the frozen ones.
        const dHome = points(live ? live.oddsIfHomeWins - path.titleGame : g.oddsIfHome - baseTitle);
        const dAway = points(live ? live.oddsIfAwayWins - path.titleGame : g.oddsIfAway - baseTitle);
        const sel = locks[g.id];
        const seg = (label: string, delta: number | null, winner: number | undefined) => {
          const on = sel === winner;
          return (
            <button
              key={label}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(g.id, winner)}
              className={`min-h-11 flex-1 px-2 py-1 text-center text-sm leading-tight focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-navy ${on ? "rounded-md bg-white font-bold shadow" : ""}`}
            >
              {label}
              {delta !== null && (
                <span className={`ml-1 font-bold tabular-nums ${delta > 0 ? "text-turf" : delta < 0 ? "text-marker-text" : "text-ink-muted"}`}>{signed(delta)}</span>
              )}
            </button>
          );
        };
        const home = names[g.homeId] ?? `Team ${g.homeId}`;
        const away = names[g.awayId] ?? `Team ${g.awayId}`;
        return (
          <li key={g.id}>
            <p className="text-xs text-ink-muted">{when(g)}</p>
            <div role="group" aria-label={`${away} at ${home}`} className="mt-1 flex rounded-lg bg-mist p-1">
              {seg(home, dHome, g.homeId)}
              {seg("Either", null, undefined)}
              {seg(away, dAway, g.awayId)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
