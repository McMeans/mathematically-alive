"use client";
import Link from "next/link";
import { useId, useState } from "react";
import { INDEPENDENTS, conferenceName, conferenceShort, teamMatch } from "@/core";
import { type ConferenceList } from "./Explorer";
import { TeamLogo } from "./Board";
import { inConferenceOrder, useConference } from "./conference";

/** The conference switcher's "every team" choice. */
const ALL = "";

export function TeamList({ conferences, names, abbreviations, selectedId, onSelect }: {
  conferences: ConferenceList[];
  names: Record<number, string>;
  /** Short names ("UVA"), so a search finds them too. */
  abbreviations: Record<number, string>;
  selectedId: number;
  /** Called on a plain click, before navigation, so the row can switch at once. */
  onSelect?: (id: number) => void;
}) {
  const { conference } = useConference();
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(conference);
  // Sorted by playoff odds unless the title-game column or team name is picked; independents have no title game.
  const [by, setBy] = useState<"name" | "playoff" | "title">("playoff");
  // Rendered twice (desktop column and phone sheet), so the label needs a per-copy id.
  const searchId = useId();
  const query = q.trim().toLowerCase();
  // A search looks through every conference; otherwise the chosen tab. Either way one list, best odds first in the
  // sorting column, then the other column, then alphabetical; or alphabetical alone when sorting by name.
  // "All" (picked, or any search) lists every FBS team with playoff odds only: title-game odds don't compare across
  // conferences. Independents have no title game either.
  const all = query !== "" || shown === ALL;
  const titles = !all && shown !== INDEPENDENTS;
  const sortTitle = titles && by === "title";
  const sortName = by === "name";
  const sortPlayoff = !sortTitle && !sortName;
  const rows = conferences
    .filter((c) => all || c.conference === shown)
    .flatMap((c) => {
      const byId = new Map(c.teams.map((t) => [t.id, t]));
      return c.rows
        .filter((o) => query === "" || teamMatch(query, byId.get(o.teamId)!.name, abbreviations[o.teamId]) !== null)
        .map((o) => ({ t: byId.get(o.teamId)!, o }));
    })
    .sort((a, b) => {
      const playoff = b.o.playoffKey - a.o.playoffKey;
      const title = b.o.titleKey - a.o.titleKey;
      const name = names[a.t.id].localeCompare(names[b.t.id]);
      if (sortName) return name;
      return (sortTitle ? title || playoff : playoff || title) || name;
    });
  return (
    <div className="text-board-text">
      {/* Conferences, search and column labels stay put while the list scrolls under them. */}
      <div className="sticky top-0 z-10 border-b border-board-line bg-board-deep">
        <div className="flex gap-2 p-3 pb-2">
          {conferences.length > 1 && (
            // A native select, so phones get the OS picker; laid invisibly over the short name and a chevron. A search
            // spans every conference, so it reads "All" until a conference is picked again.
            <span className="relative flex min-h-11 shrink-0 items-center gap-1.5 rounded-[3px] border border-board-line bg-white/[0.06] px-3 hover:border-board-muted focus-within:border-board-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-lamp lg:min-h-10">
              <span aria-hidden className="cond pointer-events-none text-[15px] font-bold tracking-[0.04em] text-white">
                {all ? "All" : conferenceShort(shown)}
              </span>
              <svg aria-hidden viewBox="0 0 12 12" className="pointer-events-none h-2.5 w-2.5 shrink-0 text-lamp"><path d="M2.5 4.5 6 8 9.5 4.5" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="square" /></svg>
              <select
                aria-label="Conference"
                value={all ? ALL : shown}
                onChange={(e) => { setShown(e.target.value); setQ(""); }}
                className="absolute inset-0 cursor-pointer opacity-0"
              >
                <option value={ALL}>All teams</option>
                {inConferenceOrder(conferences).map((c) => (
                  <option key={c.conference} value={c.conference}>{conferenceName(c.conference)}</option>
                ))}
              </select>
            </span>
          )}
          <label htmlFor={searchId} className="sr-only">Find a team</label>
          <span className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-[3px] border border-board-line bg-white/[0.06] px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-lamp focus-within:border-board-muted lg:min-h-10">
            <svg viewBox="0 0 20 20" aria-hidden className="h-4 w-4 shrink-0 text-board-muted"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13 13l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            <input
              id={searchId}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a team"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-board-muted"
            />
          </span>
        </div>
        <div className="cond flex items-end gap-2 px-3 pb-1.5 text-xs font-bold tracking-[0.08em] text-board-muted">
          <SortButton on={sortName} onClick={() => setBy("name")} title="Sort by team name, A to Z" className="w-auto justify-start text-left">Team</SortButton>
          <span className="flex-1" />
          <SortButton on={sortPlayoff} onClick={() => setBy("playoff")} title="Sort by playoff odds">Playoff</SortButton>
          {titles && <SortButton on={sortTitle} onClick={() => setBy("title")} title="Sort by title-game odds">Title game</SortButton>}
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

/** A sortable column label in the team list: lit amber with a down arrow when it's the sort. */
function SortButton({ on, onClick, title, className = "w-14", children }: {
  on: boolean; onClick: () => void; title: string; className?: string; children: React.ReactNode;
}) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} title={title}
      className={`cond flex min-h-11 items-center justify-end gap-0.5 text-right leading-tight tracking-[0.08em] hover:text-white lg:min-h-0 ${className} ${on ? "text-lamp" : ""}`}>
      {children}
      {/* A stemmed arrow, so it doesn't read as the conference dropdown's chevron. */}
      {on && <svg aria-hidden viewBox="0 0 12 12" className="h-2.5 w-2.5 shrink-0"><path d="M6 1.5v8M2.5 6.5 6 10l3.5-3.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="square" /></svg>}
    </button>
  );
}
