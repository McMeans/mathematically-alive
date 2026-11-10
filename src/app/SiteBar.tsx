"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Logo } from "@/app/Logo";
import { TeamLogo } from "@/app/explorer/Board";

/** A team a search can open. */
export type FindTeam = { id: number; name: string };

/**
 * The top bar, the same on every page: the mark, Teams and Season Lab (the current one lit as a cream plate), a team
 * search when `find` lists the teams, and how current the data is. Conferences live in the team picker, not here.
 */
export function SiteBar({ current, teams, lab, through, asOf, find }: {
  current: "teams" | "lab";
  /** Where Teams goes (the team last looked at, with its picks), and Season Lab. */
  teams: string;
  lab: string;
  through: string;
  asOf: string;
  /** Every team with a page, for the search. */
  find?: FindTeam[];
}) {
  const item = "cond flex h-7 items-center rounded-[2px] px-2.5 text-[15px] font-bold tracking-[0.04em]";
  const link = (href: string, label: string, on: boolean) =>
    on ? <span aria-current="page" className={`${item} bg-plate text-plate-ink`}>{label}</span>
      : <Link href={href} className={`${item} text-board-muted hover:text-white`}>{label}</Link>;
  return (
    <div className="relative flex h-11 items-center gap-3 border-b border-board-line px-3.5 md:h-12 md:px-6">
      <Link href="/" className="flex shrink-0 items-center gap-2 text-white" aria-label="Mathematically Alive">
        <Logo size={24} decorative />
        <span className="cond hidden text-[19px] font-bold tracking-[0.04em] md:inline">Mathematically Alive</span>
      </Link>
      <nav aria-label="Site" className="flex gap-0.5 sm:ml-3">
        {link(teams, "Teams", current === "teams")}
        {link(lab, "Season Lab", current === "lab")}
      </nav>
      <div className="ml-auto flex items-center gap-4">
        {find && find.length > 0 && <TeamSearch teams={find} />}
        <span title={asOf} className="hidden text-[13px] text-board-muted md:inline">{through}</span>
      </div>
    </div>
  );
}

const MAX_RESULTS = 8;

/** "Find a team": type to list matching teams (names starting with the words first), Enter opens the first. */
function TeamSearch({ teams }: { teams: FindTeam[] }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const query = q.trim().toLowerCase();
  const matches = query === "" ? [] : teams
    .filter((t) => t.name.toLowerCase().includes(query))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(query)) - Number(!b.name.toLowerCase().startsWith(query)) || a.name.localeCompare(b.name))
    .slice(0, MAX_RESULTS);
  const go = (id: number) => { setQ(""); setOpen(false); inputRef.current?.blur(); router.push(`/team/${id}`); };
  const shown = open && matches.length > 0;
  return (
    <div className="relative">
      {/* Phones: a search button that opens the field across the bar. */}
      <button type="button" aria-label="Find a team" onClick={() => { setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()); }}
        className={`flex h-8 w-8 items-center justify-center rounded-[3px] border border-board-line text-board-muted sm:hidden ${open ? "invisible" : ""}`}>
        <SearchIcon />
      </button>
      <label className={`${open ? "fixed inset-x-3 top-1.5 z-40 flex" : "hidden"} h-8 items-center gap-2 rounded-[3px] border border-board-line bg-board-deep px-2.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-lamp focus-within:border-board-muted sm:static sm:flex sm:w-52 sm:bg-white/[0.06]`}>
        <span className="sr-only">Find a team</span>
        <SearchIcon />
        <input ref={inputRef} type="search" value={q} placeholder="Find a team" autoComplete="off"
          role="combobox" aria-expanded={shown} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={shown ? `${listId}-${active}` : undefined}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setQ(""); setOpen(false); inputRef.current?.blur(); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, matches.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === "Enter" && matches[active]) go(matches[active].id);
          }}
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-board-muted" />
      </label>
      {shown && (
        <ul id={listId} role="listbox" className="fixed inset-x-3 top-11 z-40 overflow-hidden rounded-md border border-board-line bg-board-deep py-1 shadow-[0_12px_32px_rgba(10,36,26,0.4)] sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-1.5 sm:w-64">
          {matches.map((t, k) => (
            <li key={t.id} id={`${listId}-${k}`} role="option" aria-selected={k === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go(t.id)} onMouseEnter={() => setActive(k)}
                className={`cond flex min-h-10 w-full items-center gap-2.5 px-3 text-left text-base font-bold text-white ${k === active ? "bg-white/[0.07]" : ""}`}>
                <TeamLogo id={t.id} size="20px" />
                <span className="truncate">{t.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SearchIcon() {
  return <svg viewBox="0 0 20 20" aria-hidden className="h-4 w-4 shrink-0 text-board-muted"><path d="M8.5 3a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11ZM13 13l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" /></svg>;
}
