"use client";
// The Season Lab, design B: the stadium board. Header with what the last pick changed; the playoff field, the games
// left and the conference races side by side (tabs on phones); a pinned team followed as you pick.
import Link from "next/link";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { conferenceShort, encodeLocks, labOddsChange, type BracketGame, type BracketSide, type LabConference, type LabFill, type LabLocks, type LabTeamOdds } from "@/core";
import type { LabRequest, LabResponse, LabView } from "@/app/lab.worker";
import { ShareButton } from "@/app/explorer/Share";
import { TeamLogo } from "@/app/explorer/Board";
import { SiteBar } from "@/app/SiteBar";

/** The address to share: a link with its own preview image (`/lab/s/<code>`) once there are picks. */
function labLink(): string {
  const code = new URLSearchParams(window.location.search).get("picks");
  return code ? `${window.location.origin}/lab/s/${encodeURIComponent(code)}` : window.location.href;
}

/** A game still to play, with the model's odds for each side. */
export type LabGame = {
  id: number; week: number;
  /** The week's first game day: "Nov 14". */
  date: string;
  homeId: number; awayId: number; neutral: boolean;
  /** "SEC" for a conference game, "Nonconference" otherwise. */
  group: string;
  /** Short names of both teams' conferences, for the conference filter. */
  conferences: string[];
  homeOdds: string; awayOdds: string;
};

type Props = {
  initial: LabView;
  games: LabGame[];
  names: Record<number, string>;
  /** Short names, for phones. */
  abbrs: Record<number, string>;
  /** Teams with a page, by name. */
  teams: { id: number; name: string }[];
  paged: number[];
  /** The current ranking's top 25 by team ("#16"): the committee's latest, moved only by real results. Picks never change it. */
  ranks: Record<number, string>;
  /** Each team with a page: its odds with no picks. */
  baseOdds: Record<number, LabTeamOdds>;
  through: string;
  asOf: string;
};

const none = (): LabLocks => ({ games: {}, titles: {}, bracket: {} });
const count = (l: LabLocks) => Object.keys(l.games).length + Object.keys(l.titles).length + Object.keys(l.bracket).length;
const DEBOUNCE_MS = 250;

/** Picks, the worker, the address bar and the pinned team. */
function useLab(initial: LabView) {
  const [locks, setLocks] = useState<LabLocks>(none);
  const [history, setHistory] = useState<LabLocks[]>([]);
  const [view, setView] = useState<LabView>(initial);
  const [refining, setRefining] = useState(false);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");
  const [focus, setFocusState] = useState<number | null>(null);
  const worker = useRef<Worker | null>(null);
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The picks as of the last change, for the worker's replies (its handler sees only the first render).
  const current = useRef<LabLocks>(none());
  const focusRef = useRef<number | null>(null);
  const opening = useRef(0);
  // Each title pick's matchup when it was made: it stands while the conference's two teams stay the same two.
  const titleKeys = useRef<Record<string, string>>({});
  /** Title picks from a link: their matchup is the one under the link's picks, known once those picks' run finishes. */
  const linkTitles = useRef<Set<string>>(new Set());
  const finals = useRef<LabConference[]>(initial.conferences);

  function setAddress(code: string | null) {
    const url = new URL(window.location.href);
    url.searchParams.delete("games");
    url.searchParams.delete("title");
    if (code) url.searchParams.set("picks", code);
    else url.searchParams.delete("picks");
    window.history.replaceState(window.history.state, "", url);
  }

  function run(next: LabLocks) {
    clearTimeout(timer.current);
    const id = ++latest.current;
    if (count(next) === 0) {
      worker.current?.postMessage({ kind: "reset", id } satisfies LabRequest);
      setView(initial);
      finals.current = initial.conferences;
      setRefining(false);
      setFailed(false);
      setAddress(null);
      return;
    }
    setRefining(true);
    setFailed(false);
    timer.current = setTimeout(() => worker.current?.postMessage({ kind: "run", id, locks: next, focus: focusRef.current } satisfies LabRequest), DEBOUNCE_MS);
  }

  useEffect(() => {
    const w = new Worker(new URL("../lab.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<LabResponse>) => {
      const r = e.data;
      if (r.kind === "opened") {
        // A pick made before the link was read wins over the link's pick for the same game.
        const mine = latest.current !== opening.current;
        const l = current.current;
        const next = mine
          ? { games: { ...r.locks.games, ...l.games }, titles: { ...r.locks.titles, ...l.titles }, bracket: { ...r.locks.bracket, ...l.bracket } }
          : r.locks;
        setNote(r.note);
        for (const c of Object.keys(next.titles)) if (titleKeys.current[c] === undefined) linkTitles.current.add(c);
        current.current = next;
        setLocks(next);
        run(next);
        return;
      }
      if (r.kind === "filled") {
        // Only the latest request's fill: a pick made while it was on its way wins.
        if (r.id === latest.current) update(r.locks);
        return;
      }
      if (r.id !== latest.current) return; // a newer pick is on its way
      if (r.kind === "result") {
        setView(r.view);
        finals.current = r.view.conferences;
        setAddress(r.code);
        if (r.final) {
          setRefining(false);
          for (const c of linkTitles.current) {
            const f = r.view.conferences.find((x) => x.conference === c)?.final;
            if (f) titleKeys.current[c] = f.key;
          }
          linkTitles.current.clear();
        }
        // A title pick whose matchup changed no longer stands: clear it, and say so.
        const cleared = Object.keys(current.current.titles).filter((c) => {
          const key = titleKeys.current[c];
          const f = r.view.conferences.find((x) => x.conference === c)?.final;
          return key !== undefined && f !== undefined && f !== null && f.key !== key;
        });
        if (r.final && cleared.length > 0) {
          const titles = { ...current.current.titles };
          for (const c of cleared) { delete titles[c]; delete titleKeys.current[c]; }
          update({ ...current.current, titles });
          setNote(`${cleared.map((c) => r.view.conferences.find((x) => x.conference === c)!.name).join(" and ")} title pick cleared: the matchup changed.`);
        }
      } else {
        setRefining(false);
        setFailed(true);
      }
    };
    w.onerror = w.onmessageerror = () => {
      setRefining(false);
      setFailed(true);
    };
    worker.current = w;
    // A shared link: the Lab's own picks (`?picks=`), or a team page's (`?games=`, `?title=ACC~97`, and `?team=` to pin).
    const params = new URLSearchParams(window.location.search);
    const picks = params.get("picks");
    const games = params.get("games");
    const title = params.get("title"); // checked in the worker: a stale or hand-edited pick is dropped
    const team = Number(params.get("team"));
    if (Number.isInteger(team) && team > 0) {
      focusRef.current = team;
      queueMicrotask(() => setFocusState(team));
    }
    if (picks !== null || games !== null || title !== null) {
      opening.current = ++latest.current;
      w.postMessage({ kind: "open", id: opening.current, picks, games, title } satisfies LabRequest);
    }
    return () => { clearTimeout(timer.current); w.terminate(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on load: the worker and a shared link's picks
  }, []);

  function update(next: LabLocks) {
    // The picks before this change, from the ref: a fill arrives in the worker handler, which sees only the first render.
    const prev = current.current;
    setHistory((h) => [...h.slice(-49), prev]);
    current.current = next;
    setLocks(next);
    setNote("");
    run(next);
  }
  function fill(how: LabFill) {
    clearTimeout(timer.current);
    setRefining(true);
    worker.current?.postMessage({ kind: "fill", id: ++latest.current, locks: current.current, how } satisfies LabRequest);
  }
  /** Pick a conference's title-game winner; picking the current one clears it. Remembers the matchup it was made in. */
  function pickTitle(conference: string, winner: number) {
    const titles = { ...locks.titles };
    if (titles[conference] === winner) {
      delete titles[conference];
      delete titleKeys.current[conference];
    } else {
      titles[conference] = winner;
      const f = view.conferences.find((c) => c.conference === conference)?.final;
      if (f) titleKeys.current[conference] = f.key;
    }
    update({ ...locks, titles });
  }
  function undo() {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setNote("");
    current.current = prev;
    setLocks(prev);
    run(prev);
  }
  function pickGame(gameId: number, winner: number) {
    const games = { ...locks.games };
    if (games[gameId] === winner) delete games[gameId];
    else games[gameId] = winner;
    update({ ...locks, games });
  }
  /**
   * Pick a bracket game's winner; picking the current one clears it. Changing or clearing a pick also clears the
   * later picks that team was carried into, which no longer have it in their game.
   */
  // Bracket picks are the visitor's own fill-in of the projected bracket: shown only, never run, so the field and
  // seeds stay put. They belong to the bracket they were made on, and drop when other picks reseed it.
  const bracketKey = JSON.stringify(view.playoff?.bracket.map((g) => [g.a, g.b]) ?? []);
  const [bracketState, setBracketState] = useState<{ key: string; picks: Record<number, number> }>({ key: "", picks: {} });
  const bracketPicks = bracketState.key === bracketKey ? bracketState.picks : {};
  function pickBracket(bracket: BracketGame[], index: number, winner: number) {
    const picks = { ...bracketPicks };
    const old = picks[index];
    if (old === winner) delete picks[index];
    else picks[index] = winner;
    if (old !== undefined) {
      const queue = [index];
      while (queue.length > 0) {
        const from = queue.shift()!;
        for (const g of bracket) {
          const fed = [g.a, g.b].some((s) => "winnerOf" in s && s.winnerOf === from);
          if (fed && picks[g.index] === old) {
            delete picks[g.index];
            queue.push(g.index);
          }
        }
      }
    }
    setBracketState({ key: bracketKey, picks });
  }
  /** Pin a team (null unpins); with picks on the board, its odds come from a fresh run. */
  function pin(team: number | null) {
    focusRef.current = team;
    setFocusState(team);
    if (team !== null && count(current.current) > 0) run(current.current);
  }
  const status = failed ? "Couldn’t update. Showing the last result." : refining ? "Refining…" : "";
  return { locks, view, status, refining, note, focus, canUndo: history.length > 0, pickGame, pickTitle, pickBracket, bracketPicks, fill, undo, pin,
    resetBracket: () => setBracketState({ key: "", picks: {} }),
    reset: () => { setBracketState({ key: "", picks: {} }); update(none()); } };
}

type Tab = "field" | "games" | "races";
type FieldView = "seeds" | "bracket" | "top25";

const PIN_ICON = <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5"><path d="M6 1.5h4l-.6 4.2 2.6 2.6v1.2H8.6V15H7.4V9.5H4V8.3l2.6-2.6z" fill="currentColor" /></svg>;

export function Lab({ initial, games, names, abbrs, teams, paged, ranks, baseOdds, through, asOf }: Props) {
  const { locks, view, status, refining, note, focus, canUndo, pickGame, pickTitle, pickBracket, bracketPicks, fill, undo, pin, reset, resetBracket } = useLab(initial);
  const [tab, setTab] = useState<Tab>("field");
  const [fieldView, setFieldView] = useState<FieldView>("seeds");
  const [lastPinned, setLastPinned] = useState<number | null>(null);
  const pagedSet = useMemo(() => new Set(paged), [paged]);
  const name = (id: number) => names[id] ?? `Team ${id}`;
  const picks = count(locks);
  const before = focus !== null ? baseOdds[focus] ?? null : null;
  const now = focus === null ? null : picks === 0 ? before : view.focus?.teamId === focus ? view.focus : before;
  const headline = note || view.changes?.headline || "";
  const teamPage = focus === null ? "/" : `/team/${focus}${Object.keys(locks.games).length ? `?picks=${encodeLocks(locks.games)}` : ""}`;
  const unpin = () => { setLastPinned(focus); pin(null); };
  const focusConference = focus === null ? null : view.conferences.find((c) => c.standings.some((s) => s.teamId === focus))?.conference ?? null;

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh lg:overflow-hidden">
      <header className="board-dots sticky top-0 z-30 text-board-text lg:static">
        <SiteBar current="lab" teams={focus !== null ? teamPage : "/"} lab="/lab" through={through} asOf={asOf} find={teams} />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 px-3.5 py-2.5 md:px-6 md:py-3.5">
          <div className="hidden xl:block">
            <h1 className="cond flex items-center gap-2.5 text-4xl font-extrabold leading-none text-white">Season Lab <Beta /></h1>
            <p className="mt-1 text-[13px] text-board-muted">Play out the rest of the season.</p>
          </div>
          <div aria-live="polite" className={`order-5 min-w-0 flex-[1_0_100%] md:order-none md:flex-1 ${headline ? "" : "hidden md:block"} border-t border-board-line pt-2 md:border-0 md:pt-0`}>
            {headline ? (
              <>
                <small className="cond block text-xs font-bold tracking-[0.1em] text-board-muted">{note ? "Note" : "Last pick"}</small>
                <b className="cond block text-lg font-bold leading-tight tracking-[0.03em] text-lamp md:text-2xl">{headline}</b>
              </>
            ) : <span className="text-[15px] text-board-muted">Pick a game, or fill the rest.</span>}
          </div>
          <div className="flex min-w-0 flex-1 items-center gap-2.5 md:flex-none">
            <span key={picks} className="plate plate-hang text-[30px] text-white md:text-[40px]">{picks}</span>
            <span className="cond text-sm font-bold leading-tight tracking-[0.06em] text-board-muted">
              Picks
              <span className={`block font-sans text-xs font-medium normal-case tracking-normal ${refining ? "text-lamp" : "hidden md:block"}`}>{status || view.summary.split(" · ").at(-1)}</span>
            </span>
          </div>
          <div className="flex gap-1.5">
            <BoardButton onClick={undo} disabled={!canUndo}>Undo</BoardButton>
            <BoardButton onClick={reset} disabled={picks === 0 && Object.keys(bracketPicks).length === 0}>Reset</BoardButton>
            <ShareButton board label="Share" link={labLink} className={picks === 0 ? "opacity-55" : ""} />
          </div>
        </div>
        {focus !== null && now && before && (
          <div className="hidden items-center gap-5 border-t border-board-line bg-board-deep px-6 py-1.5 md:flex">
            <span className="cond flex items-center gap-1.5 text-lg font-extrabold text-white"><span className="text-lamp">{PIN_ICON}</span><TeamLogo id={focus} /> {name(focus)}</span>
            <PinOdds label="Playoff" before={before.playoffText} after={now.playoffText} up={(now.playoff ?? 0) > (before.playoff ?? 0)} />
            {now.titleGame !== null && <PinOdds label="Title game" before={before.titleGameText} after={now.titleGameText} up={(now.titleGame ?? 0) > (before.titleGame ?? 0)} />}
            <span className="flex-1" />
            <Link href={teamPage} className="whitespace-nowrap text-[13px] font-semibold text-board-text hover:text-white">{name(focus)}’s page <span className="text-lamp">→</span></Link>
            <button type="button" onClick={unpin} aria-label={`Unpin ${name(focus)}`} className="flex h-[30px] w-[30px] items-center justify-center rounded-[3px] text-board-muted hover:bg-white/[0.07] hover:text-white">
              <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </div>
        )}
        <div role="tablist" aria-label="Season Lab" className="flex gap-1.5 bg-ground px-3.5 pb-2 pt-2.5 lg:hidden">
          {(["field", "games", "races"] as const).map((t) => (
            <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => { setTab(t); window.scrollTo(0, 0); }}
              className={`cond h-11 flex-1 rounded-[3px] border text-base font-bold tracking-[0.04em] ${tab === t ? "border-board bg-board text-white" : "border-rule bg-white text-ink-soft"}`}>
              {t === "field" ? "Field" : t === "games" ? "Games" : "Races"}
            </button>
          ))}
        </div>
      </header>

      <div className={`grid flex-1 grid-cols-[minmax(0,1fr)] lg:min-h-0 lg:grid-cols-[minmax(320px,380px)_minmax(0,1fr)_300px] ${focus !== null ? "pb-24 md:pb-0" : ""}`}>
        <section aria-labelledby="field-h" className={`scroll-thin bg-paper p-3.5 pb-10 md:p-5 lg:block lg:overflow-y-auto lg:border-r lg:border-rule ${tab === "field" ? "" : "hidden"}`}>
          <Field view={view} ranks={ranks} fieldView={fieldView} setFieldView={setFieldView} name={name} abbr={(id) => abbrs[id] ?? name(id)} focus={focus} focusOdds={now}
            picked={bracketPicks} onPick={(g, w) => view.playoff && pickBracket(view.playoff.bracket, g, w)} onResetBracket={resetBracket} />
        </section>
        <section aria-labelledby="games-h" className={`scroll-thin p-3.5 pb-10 md:p-5 lg:block lg:overflow-y-auto ${tab === "games" ? "" : "hidden"}`}>
          <MarksContext.Provider value={ranks}>
          <Games games={games} picked={locks.games} titles={locks.titles} conferences={view.conferences} name={name} abbr={(id) => abbrs[id] ?? name(id)}
            onPick={pickGame} onTitle={pickTitle} open={view.open} onFill={fill} big={view.bigGames} focus={focus} focusConference={focusConference}
            onPin={lastPinned !== null && focus === null ? () => pin(lastPinned) : null} pinName={lastPinned !== null ? name(lastPinned) : ""} teams={teams} />
          </MarksContext.Provider>
        </section>
        <section aria-labelledby="races-h" className={`scroll-thin bg-paper p-3.5 pb-10 md:p-5 lg:block lg:overflow-y-auto lg:border-l lg:border-rule ${tab === "races" ? "" : "hidden"}`}>
          <MarksContext.Provider value={ranks}>
            <Races conferences={view.conferences} name={name} paged={pagedSet} focus={focus} />
          </MarksContext.Provider>
        </section>
      </div>

      {focus !== null && now && before && (
        <Dock team={focus} name={name(focus)} abbr={abbrs[focus] ?? name(focus)} before={before} now={now} teamPage={teamPage} onUnpin={unpin} />
      )}
    </div>
  );
}

const Beta = () => <span className="cond rounded-[2px] border border-current px-1.5 text-[11px] font-bold leading-[15px] tracking-[0.06em] text-board-muted">Beta</span>;

function BoardButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className="cond h-9 rounded-[3px] border border-board-line px-3 text-base font-bold tracking-[0.05em] text-white hover:border-board-muted disabled:opacity-40 md:h-[38px] md:px-3.5">
      {children}
    </button>
  );
}

function PinOdds({ label, before, after, up }: { label: string; before: string; after: string; up: boolean }) {
  return (
    <span className="cond flex items-baseline gap-1.5 whitespace-nowrap text-[19px] font-extrabold text-white">
      <small className="text-xs font-bold tracking-[0.08em] text-board-muted">{label}</small>
      {before === after ? <b>{after}</b> : <><s className="text-[15px] font-bold text-board-muted">{before}</s><span aria-hidden className="text-[13px] text-board-muted">→</span><b className={up ? "text-lamp" : "text-[#f08a7e]"}>{after}</b></>}
    </span>
  );
}

/** Phones: the pinned team as a ticket docked at the bottom, in thumb reach; it opens upward. */
function Dock({ team, name, abbr, before, now, teamPage, onUnpin }: { team: number; name: string; abbr: string; before: LabTeamOdds; now: LabTeamOdds; teamPage: string; onUnpin: () => void }) {
  const [open, setOpen] = useState(false);
  const shown = `${now.playoffText}|${now.titleGameText}`;
  const [flash, setFlash] = useState(shown);
  const bump = flash !== shown;
  useEffect(() => {
    if (!bump) return;
    const t = setTimeout(() => setFlash(shown), 900);
    return () => clearTimeout(t);
  }, [bump, shown]);
  const delta = (a: number | null, b: number | null) => labOddsChange(a, b);
  const dp = delta(before.playoff, now.playoff), dt = delta(before.titleGame, now.titleGame);
  return (
    <div className="fixed inset-x-2.5 bottom-[calc(10px+env(safe-area-inset-bottom))] z-40 overflow-hidden rounded-md bg-board text-white shadow-[0_8px_24px_rgba(10,36,26,0.35),0_1px_3px_rgba(10,36,26,0.3)] md:hidden">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`flex min-h-14 w-full items-center gap-2.5 px-3 py-2 text-left ${bump ? "bump" : ""}`}>
        <span className="text-lamp">{PIN_ICON}</span>
        <TeamLogo id={team} size="24px" />
        <span className="cond text-lg font-extrabold">{abbr}</span>
        <DockNum label="Playoff" value={now.playoffText} delta={dp} />
        {now.titleGame !== null && <DockNum label="Title game" value={now.titleGameText} delta={dt} />}
        <svg viewBox="0 0 16 16" aria-hidden className={`ml-auto h-[18px] w-[18px] text-board-muted transition-transform ${open ? "" : "rotate-180"}`}><path d="M4 10l4-4 4 4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="border-t border-board-line px-3 pb-3">
          <p className="my-2.5 text-[13px] text-board-text">{name} before your picks: playoff {before.playoffText}{before.titleGame !== null && `, title game ${before.titleGameText}`}.</p>
          <div className="flex gap-2">
            <Link href={teamPage} className="cond flex h-11 flex-1 items-center justify-center rounded-[3px] border border-board-line text-base font-bold tracking-[0.04em]">{name}’s page <span className="ml-1.5 text-lamp">→</span></Link>
            <button type="button" onClick={onUnpin} className="cond h-11 flex-1 rounded-[3px] border border-board-line text-base font-bold tracking-[0.04em]">Unpin</button>
          </div>
        </div>
      )}
    </div>
  );
}

function DockNum({ label, value, delta }: { label: string; value: string; delta: string | null }) {
  return (
    <span className="ml-1.5 grid grid-cols-[auto_auto] items-baseline gap-x-1">
      <small className="cond col-span-2 text-[11px] font-bold tracking-[0.08em] text-board-muted">{label}</small>
      <b className="plate text-[22px]">{value}</b>
      {delta && <em className={`cond text-sm font-bold not-italic ${delta.startsWith("+") ? "text-lamp" : "text-[#f08a7e]"}`}>{delta}</em>}
    </span>
  );
}

/** A heading for one of the three panes. */
function PaneHeading({ id, children, right }: { id: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2.5">
      <h2 id={id} className="cond text-[26px] font-extrabold leading-tight">{children}</h2>
      {right}
    </div>
  );
}

function Seg<T extends string>({ options, value, onChange, label }: { options: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex gap-1">
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}
          className={`cond h-10 flex-1 whitespace-nowrap rounded-[2px] border px-3 text-[15px] font-bold tracking-[0.04em] md:h-[34px] ${value === o.id ? "border-board bg-board text-white" : "border-rule bg-white text-ink-soft"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The projected field (seeds), its bracket, or the projected top 25. */
function Field({ view, ranks, fieldView, setFieldView, name, abbr, focus, focusOdds, picked, onPick, onResetBracket }: {
  view: LabView; ranks: Record<number, string>; fieldView: FieldView; setFieldView: (v: FieldView) => void; name: (id: number) => string; abbr: (id: number) => string;
  focus: number | null; focusOdds: LabTeamOdds | null; picked: Record<number, number>; onPick: (gameIndex: number, winner: number) => void; onResetBracket: () => void;
}) {
  const p = view.playoff;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const inField = new Set(p?.field.map((s) => s.teamId) ?? []);
  const onBubble = new Set(p?.bubble.map((b) => b.teamId) ?? []);
  return (
    <>
      <PaneHeading id="field-h" right={
        <div className="w-full">
          <Seg label="Show" value={fieldView} onChange={setFieldView} options={[{ id: "seeds", label: "Seeds" }, { id: "bracket", label: "Bracket" }, { id: "top25", label: "Top 25" }]} />
        </div>
      }>{p?.heading ?? "Playoff field"}</PaneHeading>
      <p className="mb-3 text-[13px] text-ink-muted"><span className="cond mr-1 rounded-[2px] border border-current px-1.5 text-[11px] font-bold tracking-[0.06em]">Beta</span>Modelled, not the committee.</p>
      {fieldView === "seeds" && p && (
        <>
          <div className="rounded bg-board-deep py-1.5 text-board-text">
            <p className="cond flex justify-between px-3.5 pb-1 pt-1.5 text-xs font-bold tracking-[0.08em] text-board-muted">Byes<span>Chance in</span></p>
            {p.field.map((s, k) => (
              <div key={s.teamId}>
                {k === 4 && <><div className="mx-3.5 my-1.5 h-px bg-board-line" /><p className="cond px-3.5 pb-1 text-xs font-bold tracking-[0.08em] text-board-muted">First round</p></>}
                <FieldRow seed={s.seed} lit={k < 4} id={s.teamId} rank={ranks[s.teamId]} name={name(s.teamId)} odds={pct(s.field)} me={s.teamId === focus} />
              </div>
            ))}
          </div>
          {p.bubble.length > 0 && (
            <>
              <h3 className="cond mb-2 mt-4 text-[17px] font-extrabold">On the bubble</h3>
              <div className="rounded bg-board-deep py-1.5">
                {p.bubble.map((b) => <FieldRow key={b.teamId} id={b.teamId} rank={ranks[b.teamId]} name={name(b.teamId)} odds={pct(b.field)} me={b.teamId === focus} />)}
                {focus !== null && focusOdds && !inField.has(focus) && !onBubble.has(focus) && (
                  <div className="mt-1 border-t border-dashed border-board-line pt-1">
                    <FieldRow id={focus} rank={ranks[focus]} name={name(focus)} odds={focusOdds.playoffText} me tag="Pinned" />
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}
      {fieldView === "bracket" && p && <Bracket games={p.bracket} picked={picked} abbr={abbr} name={name} onPick={onPick} onReset={onResetBracket} />}
      {fieldView === "top25" && (
        <>
          <p className="mb-2 text-[13px] text-ink-muted">The committee&rsquo;s latest ranking, moved by results since and your picks. Arrows show the move from the current ranking. Amber numbers are in the field.</p>
          <div className="rounded bg-board-deep py-1.5">
            {view.live.map((r) => (
              <FieldRow key={r.teamId} seed={r.rank} lit={inField.has(r.teamId)} id={r.teamId} name={name(r.teamId)} me={r.teamId === focus}
                odds={r.change > 0 ? `▲${r.change}` : r.change < 0 ? `▼${-r.change}` : ""} tone={r.change > 0 ? "text-root" : "text-drop"}
                tag={r.committeeRank === null ? "Unranked" : undefined} />
            ))}
          </div>
        </>
      )}
      {!p && <p className="text-sm text-ink-muted">This season&rsquo;s playoff isn&rsquo;t simulated.</p>}
    </>
  );
}

function FieldRow({ seed, lit, id, rank, name, odds, me, tag, tone }: { seed?: number; lit?: boolean; id: number; rank?: string; name: string; odds: string; me?: boolean; tag?: string; tone?: string }) {
  return (
    <div className={`grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-2.5 px-3.5 py-1.5 ${me ? "bg-lamp/10" : ""}`}>
      <span className={`plate text-center text-[22px] ${lit ? "text-lamp" : "text-board-muted"}`}>{seed ?? ""}</span>
      <span className="cond flex min-w-0 items-center gap-1.5 truncate text-[19px] font-bold text-white">
        <TeamLogo id={id} /> <span className="truncate">{rank && <span className="mr-1 text-[0.74em] font-bold text-board-muted">{rank}</span>}{name}</span>
        {tag && <i className="ml-1 font-sans text-[11px] font-semibold not-italic tracking-[0.06em] text-lamp">{tag}</i>}
      </span>
      <span className={`plate text-[22px] ${tone ?? (me ? "text-lamp" : "text-white")}`}>{odds}</span>
    </div>
  );
}

/**
 * The bracket, a column per round, each game level with the games that feed it: a first-round game beside the
 * quarterfinal its winner plays in, a semifinal centred on its two quarterfinals. Any known team can be picked to win,
 * even before its opponent is.
 */
function Bracket({ games, picked, abbr, name, onPick, onReset }: {
  games: BracketGame[]; picked: Record<number, number>; abbr: (id: number) => string; name: (id: number) => string;
  onPick: (gameIndex: number, winner: number) => void; onReset: () => void;
}) {
  // A picked winner carries its seed into the next round.
  const seedOf = new Map(games.flatMap((g) => [g.a, g.b]).flatMap((s) => ("teamId" in s ? [[s.teamId, s.seed] as const] : [])));
  const known = (s: BracketSide): { teamId: number; seed: number | null } | null =>
    "teamId" in s ? s : picked[s.winnerOf] !== undefined ? { teamId: picked[s.winnerOf], seed: seedOf.get(picked[s.winnerOf]) ?? null } : null;
  const byIndex = new Map(games.map((g) => [g.index, g]));
  // An open slot names the two teams that could fill it: "ALA/BOIS".
  const feed = (s: BracketSide) => {
    if ("teamId" in s) return "";
    const g = byIndex.get(s.winnerOf);
    const a = g && known(g.a), b = g && known(g.b);
    return a && b ? `${abbr(a.teamId)}/${abbr(b.teamId)}` : "TBD";
  };
  const rounds = [...new Set(games.map((g) => g.round))];
  // Rows, walked down from the final: a game fed by two games spans their rows; one with a team already in it (a
  // first-round bye) takes one row, and the game feeding its other side sits in that same row.
  const place = new Map<number, { row: number; span: number }>();
  let rows = 0;
  const walk = (g: BracketGame): { row: number; span: number } => {
    const feeders = [g.a, g.b].flatMap((s) => ("winnerOf" in s ? [byIndex.get(s.winnerOf)!] : []));
    let at: { row: number; span: number };
    if (feeders.length === 2) {
      const [x, y] = feeders.map(walk);
      at = { row: x.row, span: y.row + y.span - x.row };
    } else {
      at = { row: rows++, span: 1 };
      for (const f of feeders) place.set(f.index, at);
    }
    place.set(g.index, at);
    return at;
  };
  walk(games[games.length - 1]);
  const champion = picked[games[games.length - 1].index] as number | undefined;
  const slot = (g: BracketGame, k: ReturnType<typeof known>, s: BracketSide, other: ReturnType<typeof known>) => {
    if (!k) return <div className="flex h-7 min-w-0 items-center justify-center truncate rounded-[3px] border border-dashed border-board-line px-0.5 text-[10.5px] text-board-muted">{feed(s)}</div>;
    const on = picked[g.index] === k.teamId;
    const label = <><span className={`w-3.5 shrink-0 text-center text-[11px] ${on ? "text-plate-ink/70" : "text-board-muted"}`}>{k.seed ?? ""}</span><TeamLogo id={k.teamId} dark={!on} size="14px" /><b className="truncate">{abbr(k.teamId)}</b></>;
    const base = "cond flex h-7 min-w-0 items-center gap-1 rounded-[3px] border px-0.5 text-[13px] font-bold";
    if (g.result) return <div className={`${base} border-board-line text-white`}>{label}</div>;
    const off = other !== null && picked[g.index] === other.teamId;
    return (
      <button type="button" aria-pressed={on} onClick={() => onPick(g.index, k.teamId)} title={on ? "Picked. Tap again to clear." : `Pick ${abbr(k.teamId)} to win`}
        className={`${base} text-left ${on ? "border-lamp bg-lamp text-plate-ink" : off ? "border-board-line text-white opacity-40 line-through" : "border-board-line bg-white/[0.04] text-white hover:border-board-muted"}`}>
        {label}
      </button>
    );
  };
  return (
    <div className="scroll-thin -mx-1 overflow-x-auto rounded bg-board-deep p-2">
      <div className="grid gap-x-1.5 gap-y-2.5" style={{ gridTemplateColumns: `repeat(${rounds.length}, minmax(4.25rem, 1fr))`, gridTemplateRows: `auto repeat(${rows}, auto)` }}>
        {rounds.map((r, c) => <p key={r} className="cond truncate text-[11px] font-bold tracking-[0.06em] text-board-muted" style={{ gridColumn: c + 1, gridRow: 1 }}>{r}</p>)}
        {games.map((g) => {
          const at = place.get(g.index)!;
          const a = known(g.a), b = known(g.b);
          return (
            <div key={g.index} className="flex flex-col justify-center gap-1" style={{ gridColumn: rounds.indexOf(g.round) + 1, gridRow: `${at.row + 2} / span ${at.span}` }}>
              {slot(g, a, g.a, b)}
              {slot(g, b, g.b, a)}
              {g.result && <p className="text-[11px] text-board-muted">{g.result}</p>}
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 flex items-center gap-2 border-t border-board-line pt-2.5">
        {champion !== undefined ? (
          <p className="cond flex min-w-0 items-center gap-1.5 text-base font-bold text-white">
            <span className="text-xs tracking-[0.08em] text-board-muted">Your champion</span>
            <TeamLogo id={champion} size="18px" />
            <span className="truncate">{seedOf.get(champion) !== undefined && <span className="mr-1 text-board-muted">{seedOf.get(champion)}</span>}{name(champion)}</span>
          </p>
        ) : (
          <p className="text-[13px] text-board-muted">{Object.keys(picked).length > 0 ? "Pick the final to crown a champion." : "Tap a team to move it on. Shown only: the odds don’t change."}</p>
        )}
        <button type="button" onClick={onReset} disabled={Object.keys(picked).length === 0}
          className="cond ml-auto h-7 shrink-0 rounded-[3px] border border-board-line px-2.5 text-[13px] font-bold tracking-[0.05em] text-board-text hover:border-board-muted disabled:opacity-40">
          Reset bracket
        </button>
      </div>
    </div>
  );
}

/** The mark on a pick: a heavy check with square ends, no ring, in the color of the text around it. */
function PickMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" role="img" aria-label="Picked" className={`h-[1em] w-[1em] shrink-0 ${className}`}>
      <path d="M3 8.6 6.4 12 13 4.6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" />
    </svg>
  );
}

const CHIP_ORDER = ["ACC", "Big Ten", "SEC", "Big 12", "American", "Pac 12", "MW", "SBC", "MAC", "CUSA", "Independents"];

/** The games left, by week, filtered; then each conference's title game between its likeliest two teams. */
function Games({ games, picked, titles, conferences, name, abbr, onPick, onTitle, open, onFill, big, focus, focusConference, onPin, pinName, teams }: {
  games: LabGame[]; picked: Record<number, number>; titles: Record<string, number>; conferences: LabConference[];
  name: (id: number) => string; abbr: (id: number) => string;
  onPick: (gameId: number, winner: number) => void; onTitle: (conference: string, winner: number) => void;
  open: number; onFill: (how: LabFill) => void; big: LabView["bigGames"];
  focus: number | null; focusConference: string | null; onPin: (() => void) | null; pinName: string;
  teams: { id: number; name: string }[];
}) {
  const [scope, setScope] = useState<"big" | "all">(big.length > 0 ? "big" : "all");
  const [conf, setConf] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const [find, setFind] = useState("");
  const [menu, setMenu] = useState(false);
  // A picked game no longer swings the field, so it leaves the run's big games. Once a game has been a big game it
  // stays one here, picked, unpicked or filled, so picking a winner never takes it off the list.
  const [kept, setKept] = useState<Set<number>>(() => new Set(big.map((g) => g.gameId)));
  const [seenBig, setSeenBig] = useState(big);
  if (big !== seenBig) {
    setSeenBig(big);
    setKept((k) => (big.every((g) => k.has(g.gameId)) ? k : new Set([...k, ...big.map((g) => g.gameId)])));
  }
  const isBig = (id: number) => kept.has(id);
  const bigCount = useMemo(() => games.filter((g) => kept.has(g.id)).length, [games, kept]);
  const pick = onPick;
  const chips = useMemo(() => {
    const present = new Set(games.flatMap((g) => g.conferences));
    return [...CHIP_ORDER.filter((c) => present.has(c)), ...[...present].filter((c) => !CHIP_ORDER.includes(c)).sort()];
  }, [games]);
  const pinned = focus !== null && mine;
  const q = find.trim().toLowerCase();
  const matches = (id: number) => name(id).toLowerCase().includes(q);
  const shown = games.filter((g) => (pinned ? g.homeId === focus || g.awayId === focus
    : (scope === "all" || isBig(g.id)) && (conf === null || g.conferences.includes(conf))) && (!q || matches(g.homeId) || matches(g.awayId)));
  const weeks = shown.reduce<Map<number, { date: string; groups: Map<string, LabGame[]> }>>((acc, g) => {
    const w = acc.get(g.week) ?? acc.set(g.week, { date: g.date, groups: new Map() }).get(g.week)!;
    (w.groups.get(g.group) ?? w.groups.set(g.group, []).get(g.group)!).push(g);
    return acc;
  }, new Map());
  const finals = conferences.filter((c) => c.final && (pinned ? c.conference === focusConference : conf === null || conferenceShortOf(c) === conf)
    && (!q || c.final.teams.some((id) => matches(id))));
  const team = (g: LabGame, id: number, odds: string, other: number, home: boolean) => (
    <TeamButton key={id} id={id} name={name(id)} abbr={abbr(id)} odds={odds} home={home} on={picked[g.id] === id} lost={picked[g.id] === other}
      onClick={() => pick(g.id, id)} />
  );
  return (
    <>
      <PaneHeading id="games-h" right={
        <Seg label="Which games" value={pinned ? ("none" as "big") : scope} onChange={(v) => { setScope(v); setMine(false); }} options={[
          { id: "big", label: <>Big games <i className="ml-1 font-sans text-xs not-italic opacity-80">{bigCount}</i></> },
          { id: "all", label: <>All <i className="ml-1 font-sans text-xs not-italic opacity-80">{games.length}</i></> },
        ]} />
      }>Games left</PaneHeading>
      <div className="mb-2.5 flex gap-2">
        <div className="relative">
          <button type="button" aria-expanded={menu} disabled={open === 0} onClick={() => setMenu(!menu)}
            className="cond flex h-[42px] items-center gap-1.5 rounded-[3px] bg-board px-3.5 text-[17px] font-bold tracking-[0.05em] text-white hover:bg-board-deep disabled:opacity-40">
            Fill the rest <span aria-hidden className="text-xs">▾</span>
          </button>
          {menu && (
            <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded border border-rule bg-white p-1 shadow-[0_8px_20px_rgba(21,32,27,0.18)]">
              <button type="button" onClick={() => { setMenu(false); onFill("favorites"); }} className="block w-full rounded-[2px] px-2.5 py-2 text-left hover:bg-ground">
                <b className="block font-semibold">Favorites win</b><span className="text-[13px] text-ink-muted">The likelier side wins every game left.</span>
              </button>
              <button type="button" onClick={() => { setMenu(false); onFill({ seed: Math.floor(Math.random() * 2 ** 31) }); }} className="block w-full rounded-[2px] px-2.5 py-2 text-left hover:bg-ground">
                <b className="block font-semibold">One possible season</b><span className="text-[13px] text-ink-muted">Each game drawn from its odds.</span>
              </button>
            </div>
          )}
        </div>
        <label className="flex h-[42px] min-w-0 flex-1 items-center gap-2 rounded-[3px] border border-rule bg-white px-3 text-ink-muted focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-lamp focus-within:border-ink-muted">
          <svg viewBox="0 0 20 20" aria-hidden className="h-4 w-4 shrink-0"><circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M13 13l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <span className="sr-only">Find a team</span>
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a team" list="lab-teams" className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted" />
          <datalist id="lab-teams">{teams.map((t) => <option key={t.id} value={t.name} />)}</datalist>
        </label>
      </div>
      <div className="scroll-thin mb-1 flex gap-1.5 overflow-x-auto pb-0.5 [mask-image:linear-gradient(to_right,#000_88%,transparent)] md:[mask-image:none]">
        <Chip on={!pinned && conf === null} onClick={() => { setConf(null); setMine(false); }}>All</Chip>
        {focus !== null && (
          <Chip on={pinned} lamp onClick={() => setMine(!mine)}><TeamLogo id={focus} dark={false} size="16px" /> {name(focus)}&rsquo;s games</Chip>
        )}
        {focus === null && onPin && <Chip lamp on={false} onClick={onPin}>{PIN_ICON} Pin {pinName}</Chip>}
        {chips.map((c) => <Chip key={c} on={!pinned && conf === c} onClick={() => { setConf(c); setMine(false); }}>{c}</Chip>)}
      </div>
      {scope === "all" && !pinned && <p className="mt-2 flex items-center gap-2 text-[13px] text-ink-muted"><span className="h-3.5 w-[18px] rounded-[3px] border-2 border-lamp" />Amber outline: a big game, one that moves the field most</p>}
      {pinned && <p className="mt-2 text-[13px] text-ink-muted">{name(focus!)}&rsquo;s games left, and its conference title game.</p>}
      {shown.length === 0 && finals.length === 0 && <p className="mt-3 text-sm text-ink-muted">{scope === "big" && bigCount === 0 ? "No open game moves the field much." : "No games left for this filter."}</p>}
      {[...weeks].map(([week, w]) => (
        <div key={week}>
          <p className="cond mb-2 mt-5 flex items-baseline gap-2.5"><b className="text-[19px] font-extrabold">Week {week}</b><span className="text-[15px] font-bold tracking-[0.04em] text-ink-muted">{w.date}</span></p>
          {[...w.groups].map(([group, list]) => (
            <div key={group}>
              {(conf === null || pinned) && <p className="cond mb-1.5 mt-3 text-sm font-bold tracking-[0.05em] text-ink-muted">{group}</p>}
              <div className="rounded bg-board-deep py-0.5">
                {list.map((g) => (
                  <div key={g.id} className={`grid grid-cols-[minmax(0,1fr)_18px_minmax(0,1fr)] items-center px-1 py-1 md:grid-cols-[minmax(0,1fr)_26px_minmax(0,1fr)] md:px-1.5 ${scope === "all" && !pinned && isBig(g.id) ? "big" : ""} ${focus !== null && !pinned && (g.homeId === focus || g.awayId === focus) ? "bg-lamp/10" : ""}`}>
                    {team(g, g.awayId, g.awayOdds, g.homeId, false)}
                    <span className="text-center text-xs text-board-muted">{g.neutral ? "vs" : "at"}</span>
                    {team(g, g.homeId, g.homeOdds, g.awayId, true)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
      {finals.length > 0 && (
        <div>
          <p className="cond mb-1 mt-5 flex items-baseline gap-2.5"><b className="text-[19px] font-extrabold">Championship week</b></p>
          <p className="mb-2 text-[13px] text-ink-muted">The two likeliest teams in each title game, with each one&rsquo;s chance to win if they meet. A pick clears if the matchup changes.</p>
          <div className="rounded bg-board-deep py-0.5">
            {finals.map((c) => {
              const f = c.final!;
              return (
                <div key={c.conference} className="grid grid-cols-[minmax(0,1fr)_18px_minmax(0,1fr)] items-center px-1 py-1 md:grid-cols-[minmax(0,1fr)_26px_minmax(0,1fr)] md:px-1.5">
                  <span className="cond col-span-3 px-1 pb-0.5 pt-1 text-xs font-bold tracking-[0.1em] text-board-muted">{c.name}</span>
                  {f.teams.map((id, k) => (
                    <div key={id} className={k === 1 ? "col-start-3" : ""}>
                      <TeamButton id={id} name={name(id)} abbr={abbr(id)} odds={f.texts[k]} home={k === 1} on={titles[c.conference] === id}
                        lost={titles[c.conference] === f.teams[1 - k]} onClick={() => onTitle(c.conference, id)} />
                    </div>
                  ))}
                  <span className="col-start-2 row-start-2 text-center text-xs text-board-muted">vs</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

/** The conference's short name, as the chips (and `LabGame.conferences`) use it: "MW", "SBC". */
const conferenceShortOf = (c: LabConference) => conferenceShort(c.conference);

function Chip({ on, lamp, onClick, children }: { on: boolean; lamp?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`cond flex h-9 shrink-0 items-center gap-1.5 rounded-[2px] border px-2.5 text-[15px] font-bold tracking-[0.03em] md:h-7 ${
        on ? (lamp ? "border-lamp bg-lamp text-plate-ink" : "border-board bg-board text-white") : lamp ? "border-lamp bg-white text-ink" : "border-rule bg-white text-ink-soft"}`}>
      {children}
    </button>
  );
}

/** The current rank by team ("#16"), for the games and races. Picks never change it. */
const MarksContext = createContext<Record<number, string>>({});

/** The team's current rank before its name ("#16"), when it has one. Picks never change it. */
function Rank({ id }: { id: number }) {
  const rank = useContext(MarksContext)[id];
  return rank ? <span className="mr-1 text-[0.74em] font-bold opacity-70">{rank}</span> : null;
}

/** One side of a game: the team and its odds; picked fills amber and shows the pick mark; the beaten side fades. */
function TeamButton({ id, name, abbr, odds, home, on, lost, onClick }: { id: number; name: string; abbr: string; odds: string; home: boolean; on: boolean; lost: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} title={on ? "Picked. Tap again to clear." : `Pick ${name} to win`}
      className={`press flex min-h-11 w-full min-w-0 items-center justify-between gap-2 rounded-[3px] border px-2 py-1.5 text-left md:min-h-0 md:px-2.5 ${home ? "flex-row-reverse text-right" : ""} ${
        on ? "border-lamp bg-lamp text-plate-ink" : `border-board-line bg-white/[0.04] text-white hover:border-board-muted [.big_&]:border-2 [.big_&]:border-lamp ${lost ? "opacity-40" : ""}`}`}>
      <b className={`cond flex min-w-0 items-center gap-1.5 text-base font-bold md:text-lg ${home ? "flex-row-reverse" : ""} ${lost ? "line-through" : ""}`}>
        <TeamLogo id={id} dark={!on} />
        <span className="truncate md:hidden"><Rank id={id} />{abbr}</span>
        <span className="hidden truncate md:inline"><Rank id={id} />{name}</span>
      </b>
      {on ? <span className="shrink-0 text-[19px] text-plate-ink md:text-[21px]"><PickMark /></span>
        : <span className="plate shrink-0 text-[15px] text-board-muted md:text-[17px]">{odds}</span>}
    </button>
  );
}

/** Each conference's title race: the two likeliest, and its standings on a tap. */
function Races({ conferences, name, paged, focus }: { conferences: LabConference[]; name: (id: number) => string; paged: Set<number>; focus: number | null }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  return (
    <>
      <PaneHeading id="races-h">Conference races</PaneHeading>
      <p className="-mt-1 mb-3 text-[13px] text-ink-muted">Title-game odds. Tap for standings.</p>
      <div className="flex flex-col gap-2">
        {conferences.map((c) => {
          const isOpen = open.has(c.conference);
          const odds = new Map(c.teams.map((t) => [t.teamId, t]));
          const lead = c.teams.slice(0, 2);
          // The pinned team and the picked title-game winner join the two leaders when they aren't already there.
          const extra = [focus, c.picked].filter((id, k, all): id is number => id !== null && all.indexOf(id) === k && !lead.some((t) => t.teamId === id))
            .flatMap((id) => odds.get(id) ?? []);
          const pct = (x: number) => (x > 0 && x < 0.01 ? "<1%" : `${Math.round(x * 100)}%`);
          return (
            <div key={c.conference} className="rounded bg-board-deep text-board-text">
              <button type="button" aria-expanded={isOpen} onClick={() => setOpen((s) => { const n = new Set(s); if (n.has(c.conference)) n.delete(c.conference); else n.add(c.conference); return n; })}
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-1 px-3 py-2 text-left">
                <span className="col-span-2 flex items-center gap-2">
                  <span className="cond text-[13px] font-bold tracking-[0.08em] text-board-muted">{c.name}</span>
                  <svg aria-hidden viewBox="0 0 12 12" className={`ml-auto h-3 w-3 text-board-muted transition-transform ${isOpen ? "rotate-180" : ""}`}><path d="M2.5 4.5 6 8 9.5 4.5" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="square" /></svg>
                </span>
                {[...lead, ...extra].map((t, k) => (
                  <span key={t.teamId} className="contents">
                    <span className={`cond flex min-w-0 items-center gap-1.5 truncate text-[17px] font-bold ${t.teamId === focus ? "text-lamp" : k === 0 ? "text-white" : "text-board-text"}`}><TeamLogo id={t.teamId} /> <span className="truncate"><Rank id={t.teamId} />{name(t.teamId)}</span>
                      {t.teamId === c.picked && <span className="shrink-0 text-[15px] text-lamp"><PickMark /></span>}</span>
                    <span className={`plate text-right text-[17px] ${t.teamId === focus ? "text-lamp" : k === 0 ? "text-white" : "text-board-text"}`}>{pct(t.titleGame)}</span>
                  </span>
                ))}
              </button>
              {isOpen && (
                <div className="border-t border-board-line px-3 pb-2.5 pt-1.5 text-sm">
                  {c.matchup && <p className="mb-1.5 text-[13px] text-board-muted">{c.matchup.text}</p>}
                  <table className="w-full border-collapse">
                    <thead><tr className="text-left text-[11px] text-board-muted"><th className="font-semibold">Team</th><th className="text-right font-semibold">Title game</th><th className="text-right font-semibold">Wins it</th></tr></thead>
                    <tbody>
                      {c.standings.map((s) => {
                        const t = odds.get(s.teamId);
                        return (
                          <tr key={s.teamId} className={`border-t border-board-line ${s.teamId === focus ? "text-lamp" : ""}`}>
                            <td className="py-1">
                              {paged.has(s.teamId) ? <Link href={`/team/${s.teamId}`} className="font-semibold text-white hover:underline">{name(s.teamId)}</Link> : <span className="font-semibold text-white">{name(s.teamId)}</span>}
                              <i className="block text-xs not-italic text-board-muted">{s.text}</i>
                            </td>
                            <td className="text-right">{t ? pct(t.titleGame) : "—"}</td>
                            <td className="text-right">{t ? pct(t.champion) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
