"use client";
import Link from "next/link";
import { useId, useState } from "react";
import { INDEPENDENTS, conferenceName, conferenceShort } from "@/core";
import { type ConferenceList } from "./Explorer";
import { TeamLogo } from "./Board";
import { useConference } from "./conference";

export function TeamList({ conferences, names, selectedId, onSelect }: {
  conferences: ConferenceList[];
  names: Record<number, string>;
  selectedId: number;
  /** Called on a plain click, before navigation, so the row can switch at once. */
  onSelect?: (id: number) => void;
}) {
  const { conference } = useConference();
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(conference);
  // Sorted by playoff odds unless the title-game column is picked; independents have no title game.
  const [by, setBy] = useState<"playoff" | "title">("playoff");
  // Rendered twice (desktop column and phone sheet), so the label needs a per-copy id.
  const searchId = useId();
  const query = q.trim().toLowerCase();
  // A search looks through every conference; otherwise the chosen tab. Either way one list, best odds first in the
  // sorting column, ties alphabetical.
  const titles = query !== "" || shown !== INDEPENDENTS;
  const sortTitle = titles && by === "title";
  const rows = conferences
    .filter((c) => query !== "" || c.conference === shown)
    .flatMap((c) => {
      const byId = new Map(c.teams.map((t) => [t.id, t]));
      return c.rows
        .filter((o) => byId.get(o.teamId)!.name.toLowerCase().includes(query))
        .map((o) => ({ t: byId.get(o.teamId)!, o }));
    })
    .sort((a, b) => (sortTitle ? b.o.titleKey - a.o.titleKey : b.o.playoffKey - a.o.playoffKey) || names[a.t.id].localeCompare(names[b.t.id]));
  return (
    <div className="text-board-text">
      {/* Conferences, search and column labels stay put while the list scrolls under them. */}
      <div className="sticky top-0 z-10 border-b border-board-line bg-board-deep">
        {conferences.length > 1 && (
          // Every FBS conference plus the independents: short names, the full name on hover.
          <div role="group" aria-label="Conference" className="flex flex-wrap gap-1 px-3 pt-3">
            {conferences.map((c) => (
              <button
                key={c.conference}
                type="button"
                aria-pressed={query === "" && c.conference === shown}
                title={conferenceName(c.conference)}
                onClick={() => { setShown(c.conference); setQ(""); }}
                className="cond min-h-9 whitespace-nowrap rounded-[2px] border border-board-line px-2.5 text-[15px] font-bold tracking-[0.03em] text-board-muted hover:border-board-muted hover:text-white aria-pressed:border-plate aria-pressed:bg-plate aria-pressed:text-plate-ink md:min-h-7"
              >
                {conferenceShort(c.conference)}
              </button>
            ))}
          </div>
        )}
        <div className="p-3">
          <label htmlFor={searchId} className="sr-only">Find a team</label>
          <span className="flex min-h-11 items-center gap-2 rounded-[3px] border border-board-line bg-white/[0.06] px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-lamp focus-within:border-board-muted md:min-h-10">
            <svg viewBox="0 0 20 20" aria-hidden className="h-4 w-4 shrink-0 text-board-muted"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13 13l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <input
              id={searchId}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={conferences.length > 1 ? "Find a team in any conference" : "Find a team"}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-board-muted"
            />
          </span>
        </div>
        <div className="cond flex items-end gap-2 px-3 pb-1.5 text-xs font-bold tracking-[0.08em] text-board-muted">
          <span className="flex-1">{query === "" ? conferenceName(shown) : "All conferences"}</span>
          {(["playoff", "title"] as const).filter((c) => c === "playoff" || titles).map((c) => {
            const on = c === "title" ? sortTitle : !sortTitle;
            return (
              <button key={c} type="button" aria-pressed={on} onClick={() => setBy(c)} title={`Sort by ${c === "title" ? "title-game" : "playoff"} odds`}
                className={`cond flex w-14 items-center justify-end gap-0.5 text-right leading-tight tracking-[0.08em] hover:text-white ${on ? "text-lamp" : ""}`}>
                {c === "title" ? "Title game" : "Playoff"}
                {on && <svg aria-hidden viewBox="0 0 12 12" className="h-2.5 w-2.5 shrink-0"><path d="M2.5 4.5 6 8 9.5 4.5" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="square" /></svg>}
              </button>
            );
          })}
        </div>
      </div>
      <ul className="py-1">
        {rows.map(({ t, o }) => {
          const id = t.id;
          const selected = id === selectedId;
          return (
            <li key={id}>
              <Link
                href={`/team/${id}`}
                aria-current={selected ? "page" : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  onSelect?.(id);
                }}
                className={`flex min-h-11 items-center gap-2.5 px-3 py-1.5 ${selected ? "bg-lamp/10 shadow-[inset_3px_0_0_var(--color-lamp)]" : "hover:bg-white/[0.05]"}`}
              >
                <TeamLogo id={id} size="22px" />
                <span className="min-w-0 flex-1">
                  <span className={`cond block truncate text-[17px] font-bold leading-5 ${selected ? "text-lamp" : "text-white"}`}>{t.name}</span>
                  <span className="block text-[11px] leading-4 text-board-muted">{o.record}</span>
                </span>
                <span className={`plate w-14 text-right text-[19px] ${selected ? "text-lamp" : o.playoffOut ? "text-board-muted" : sortTitle ? "text-board-text" : "text-white"}`}>
                  {o.playoff}
                </span>
                {titles && (
                  <span className={`plate w-14 text-right text-[19px] ${selected ? "text-lamp" : o.titleOut ? "text-board-muted" : sortTitle ? "text-white" : "text-board-text"}`}>
                    {o.title ?? "—"}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
        {rows.length === 0 && <li className="px-3 py-2 text-sm text-board-muted">No match</li>}
      </ul>
    </div>
  );
}
