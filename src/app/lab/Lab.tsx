"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { BracketGame, BracketSide, LabBigGame, LabConference, LabFill, LabLocks } from "@/core";
import type { LabRequest, LabResponse, LabView } from "@/app/lab.worker";
import { ShareButton } from "@/app/explorer/Share";

/** The address to share: a link with its own preview image (`/lab/s/<code>`) once there are picks. */
function labLink(): string {
  const code = new URLSearchParams(window.location.search).get("picks");
  return code ? `${window.location.origin}/lab/s/${encodeURIComponent(code)}` : window.location.href;
}

/** A game still to play, with the model's odds for each side. */
export type LabGame = {
  id: number; week: number; homeId: number; awayId: number; neutral: boolean;
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
  /** Teams with a page, for the team filter, by name. */
  teams: { id: number; name: string }[];
  paged: number[];
};

const none = (): LabLocks => ({ games: {}, titles: {}, bracket: {} });
const count = (l: LabLocks) => Object.keys(l.games).length + Object.keys(l.titles).length + Object.keys(l.bracket).length;
const DEBOUNCE_MS = 250;

/** Picks, the worker and the address bar. */
function useLab(initial: LabView) {
  const [locks, setLocks] = useState<LabLocks>(none);
  const [history, setHistory] = useState<LabLocks[]>([]);
  const [view, setView] = useState<LabView>(initial);
  const [refining, setRefining] = useState(false);
  const [failed, setFailed] = useState(false);
  const [note, setNote] = useState("");
  const worker = useRef<Worker | null>(null);
  const latest = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The picks as of the last change, for the worker's reply to a shared link (its handler sees only the first render).
  const current = useRef<LabLocks>(none());
  const opening = useRef(0);

  function setAddress(code: string | null) {
    const url = new URL(window.location.href);
    url.searchParams.delete("games");
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
      setRefining(false);
      setFailed(false);
      setAddress(null);
      return;
    }
    setRefining(true);
    setFailed(false);
    timer.current = setTimeout(() => worker.current?.postMessage({ kind: "run", id, locks: next } satisfies LabRequest), DEBOUNCE_MS);
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
        setAddress(r.code);
        if (r.final) setRefining(false);
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
    // A shared link: the Lab's own picks (`?picks=`), or a team page's game picks (`?games=`).
    const params = new URLSearchParams(window.location.search);
    const picks = params.get("picks");
    const games = params.get("games");
    if (picks !== null || games !== null) {
      opening.current = ++latest.current;
      w.postMessage({ kind: "open", id: opening.current, picks, games } satisfies LabRequest);
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
  /** Pick every open game, through the worker (it has the season). */
  function fill(how: LabFill) {
    clearTimeout(timer.current);
    setRefining(true);
    worker.current?.postMessage({ kind: "fill", id: ++latest.current, locks: current.current, how } satisfies LabRequest);
  }
  /** Pick a conference's title-game winner; picking the current one clears it. */
  function pickTitle(conference: string, winner: number) {
    const titles = { ...locks.titles };
    if (titles[conference] === winner) delete titles[conference];
    else titles[conference] = winner;
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
  /** Pick a game's winner; picking the current one clears it. */
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
  function pickBracket(bracket: BracketGame[], index: number, winner: number) {
    const picks = { ...locks.bracket };
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
    update({ ...locks, bracket: picks });
  }
  const status = failed ? "Couldn’t update. Showing the last result." : refining ? "Refining…" : "";
  return { locks, view, status, note, canUndo: history.length > 0, pickGame, pickTitle, pickBracket, fill, undo, reset: () => update(none()) };
}

type Tab = "games" | "conferences" | "playoff";
const TABS: { id: Tab; label: string }[] = [{ id: "games", label: "Games" }, { id: "conferences", label: "Conferences" }, { id: "playoff", label: "Playoff" }];
const WIDE = "(min-width: 768px)";
/** Whether both panels show side by side (Tailwind's `md`), so the tabs are hidden. False on the server. */
function useWide() {
  return useSyncExternalStore(
    (on) => { const m = window.matchMedia(WIDE); m.addEventListener("change", on); return () => m.removeEventListener("change", on); },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

export function Lab({ initial, games, names, teams, paged }: Props) {
  const { locks, view, status, note, canUndo, pickGame, pickTitle, pickBracket, fill, undo, reset } = useLab(initial);
  const [tab, setTab] = useState<Tab>("games");
  // Side by side there are no tabs, so the panels aren't tab panels.
  const wide = useWide();
  const panel = (t: Tab) => (wide ? {} : { role: "tabpanel", "aria-labelledby": `lab-tab-${t}` });
  const pagedSet = useMemo(() => new Set(paged), [paged]);
  const name = (id: number) => names[id] ?? `Team ${id}`;
  const picks = count(locks);

  return (
    <main className="mx-auto max-w-6xl p-4 md:p-6">
      <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
        Season Lab
        <span className="rounded border border-ink-muted/50 px-1 text-[10px] font-semibold leading-4 text-ink-muted">Beta</span>
      </h1>
      <p className="mt-1 text-sm text-ink-soft">Pick any game left, or let the model play it. The field, bracket and ranking follow.</p>

      <div className="sticky top-0 z-20 -mx-4 mt-3 flex flex-wrap items-center gap-2 border-b border-ink-muted/25 bg-white px-4 py-2 md:static md:mx-0 md:rounded-lg md:border md:px-3">
        <span className="text-sm font-semibold text-navy">{view.summary}</span>
        <span aria-live="polite" className="text-xs text-ink-muted">{status}</span>
        <span className="ml-auto flex items-center gap-2">
          <button type="button" onClick={undo} disabled={!canUndo} className="press h-8 rounded-full border border-ink-muted/40 px-3 text-xs font-bold text-navy hover:bg-mist disabled:opacity-40">Undo</button>
          <button type="button" onClick={reset} disabled={picks === 0} className="press h-8 rounded-full border border-ink-muted/40 px-3 text-xs font-bold text-navy hover:bg-mist disabled:opacity-40">Reset</button>
          <ShareButton small link={labLink} />
        </span>
      </div>
      {note && <p role="status" className="mt-2 rounded-md bg-mist px-3 py-2 text-sm text-ink-soft">{note}</p>}
      {view.changes && (view.changes.headline || view.changes.movers.length > 0) && (
        <section aria-labelledby="lab-changes" className="mt-3 rounded-lg border border-ink-muted/25 px-3 py-2">
          <h2 id="lab-changes" className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Last change</h2>
          {view.changes.headline && <p className="mt-1 text-sm font-semibold text-navy">{view.changes.headline}</p>}
          {view.changes.movers.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-soft">
              {view.changes.movers.map((m) => <li key={m.teamId}>{m.text}</li>)}
            </ul>
          )}
        </section>
      )}

      <div role="tablist" aria-label="Season Lab" className="mt-4 flex gap-1 md:hidden">
        {TABS.map((t) => (
          <button key={t.id} id={`lab-tab-${t.id}`} role="tab" type="button" aria-controls={`lab-panel-${t.id}`} aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`press h-9 flex-1 rounded-full text-sm font-bold ${tab === t.id ? "bg-navy text-white" : "bg-mist text-navy"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div id="lab-panel-games" {...panel("games")} className={tab === "games" ? "" : "hidden md:block"}>
          <Games games={games} picked={locks.games} name={name} teams={teams} onPick={pickGame} open={view.open} onFill={fill} big={view.bigGames} />
        </div>
        <div className="space-y-8">
          <div id="lab-panel-conferences" {...panel("conferences")} className={tab === "conferences" ? "" : "hidden md:block"}>
            <Conferences conferences={view.conferences} name={name} paged={pagedSet} onPick={pickTitle} />
          </div>
          <div id="lab-panel-playoff" {...panel("playoff")} className={tab === "playoff" ? "" : "hidden md:block"}>
            <Playoff view={view} picked={locks.bracket} name={name} paged={pagedSet} onPick={(g, w) => view.playoff && pickBracket(view.playoff.bracket, g, w)} />
          </div>
        </div>
      </div>
    </main>
  );
}

function Games({ games, picked, name, teams, onPick, open, onFill, big }: {
  games: LabGame[]; picked: Record<number, number>; name: (id: number) => string;
  teams: { id: number; name: string }[]; onPick: (gameId: number, winner: number) => void;
  /** Games neither final nor picked. */
  open: number; onFill: (how: LabFill) => void;
  /** The open games that move the field most. */
  big: LabBigGame[];
}) {
  const [team, setTeam] = useState<number | null>(null);
  const [bigOnly, setBigOnly] = useState(false);
  const swing = useMemo(() => new Map(big.map((g) => [g.gameId, g.text])), [big]);
  const [conference, setConference] = useState<string | null>(null);
  const conferences = useMemo(() => [...new Set(games.flatMap((g) => g.conferences))].sort(), [games]);
  const shown = games.filter((g) => (!bigOnly || swing.has(g.id)) && (team === null || g.homeId === team || g.awayId === team) && (conference === null || g.conferences.includes(conference)));
  const weeks = shown.reduce<Map<number, Map<string, LabGame[]>>>((acc, g) => {
    const w = acc.get(g.week) ?? acc.set(g.week, new Map()).get(g.week)!;
    (w.get(g.group) ?? w.set(g.group, []).get(g.group)!).push(g);
    return acc;
  }, new Map());

  return (
    <section aria-labelledby="lab-games">
      <h2 id="lab-games" className="font-display text-lg font-bold">Games left</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        <label className="flex items-center gap-1 text-xs font-semibold text-ink-muted">
          Team
          <select value={team ?? ""} onChange={(e) => setTeam(e.target.value ? Number(e.target.value) : null)}
            className="h-8 rounded-md border border-ink-muted/40 bg-white px-2 text-sm text-navy">
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs font-semibold text-ink-muted">
          Conference
          <select value={conference ?? ""} onChange={(e) => setConference(e.target.value || null)}
            className="h-8 rounded-md border border-ink-muted/40 bg-white px-2 text-sm text-navy">
            <option value="">All</option>
            {conferences.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {(big.length > 0 || bigOnly) && (
          <button type="button" aria-pressed={bigOnly} onClick={() => setBigOnly((b) => !b)} title="The open games that move the playoff field most"
            className={`press h-8 rounded-full border px-3 text-xs font-bold ${bigOnly ? "border-navy bg-navy text-white" : "border-ink-muted/40 text-navy hover:bg-mist"}`}>Big games</button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" disabled={open === 0} onClick={() => onFill("favorites")}
          className="press h-8 rounded-full border border-ink-muted/40 px-3 text-xs font-bold text-navy hover:bg-mist disabled:opacity-40">Favorites win the rest</button>
        <button type="button" disabled={open === 0} onClick={() => onFill({ seed: Math.floor(Math.random() * 2 ** 31) })}
          className="press h-8 rounded-full border border-ink-muted/40 px-3 text-xs font-bold text-navy hover:bg-mist disabled:opacity-40">Fill the rest</button>
      </div>
      {shown.length === 0 && <p className="mt-3 text-sm text-ink-muted">{bigOnly && big.length === 0 ? "No open game moves the field much." : "No games left for this filter."}</p>}
      {[...weeks].map(([week, groups]) => (
        <div key={week} className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Week {week}</h3>
          {[...groups].map(([group, list]) => (
            <div key={group} className="mt-2">
              <h4 className="text-xs font-semibold text-ink-soft">{group}</h4>
              <ul className="mt-1 space-y-1">
                {list.map((g) => (
                  <li key={g.id} className="rounded-md bg-mist p-1 text-sm">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
                      <PickButton label={name(g.awayId)} odds={g.awayOdds} on={picked[g.id] === g.awayId} off={picked[g.id] === g.homeId} onClick={() => onPick(g.id, g.awayId)} />
                      <span className="px-1 text-xs text-ink-muted">{g.neutral ? "vs" : "at"}</span>
                      <PickButton label={name(g.homeId)} odds={g.homeOdds} on={picked[g.id] === g.homeId} off={picked[g.id] === g.awayId} onClick={() => onPick(g.id, g.homeId)} />
                    </div>
                    {swing.has(g.id) && <p className="px-2 pt-0.5 text-xs text-ink-muted">{swing.get(g.id)}</p>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

/** One side of a pickable game: picked (navy), beaten (faded) or open (the model's odds). */
function PickButton({ label, odds, on, off, onClick }: { label: string; odds?: string; on: boolean; off: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} title={on ? "Picked to win. Tap again to clear." : `Pick ${label} to win`}
      className={`press flex min-h-9 min-w-0 items-center justify-between gap-2 rounded px-2 text-left ${on ? "bg-navy text-white" : off ? "bg-white/60 text-ink-muted line-through" : "bg-white text-navy hover:ring-1 hover:ring-navy/30"}`}>
      <span className="truncate font-semibold">{label}</span>
      {odds && !on && !off && <span className="shrink-0 text-xs text-ink-muted">{odds}</span>}
    </button>
  );
}

/** Each conference's standings with picks, and its title game: the race's odds, or the decided matchup (pickable). */
function Conferences({ conferences, name, paged, onPick }: {
  conferences: LabConference[]; name: (id: number) => string; paged: Set<number>;
  onPick: (conference: string, winner: number) => void;
}) {
  return (
    <section aria-labelledby="lab-conferences" className="space-y-6">
      <h2 id="lab-conferences" className="font-display text-lg font-bold">Conference title races</h2>
      {conferences.map((c) => {
        const odds = new Map(c.teams.map((t) => [t.teamId, t.text]));
        const m = c.matchup;
        return (
          <div key={c.conference}>
            <h3 className="text-sm font-bold text-navy">{c.name}</h3>
            {m && <>
              <p className="mt-1 text-sm text-ink-soft">{m.text}</p>
              {m.exact && (
                <div className="mt-1 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1 rounded-md bg-mist p-1 text-sm">
                  <PickButton label={name(m.teams[0])} on={c.picked === m.teams[0]} off={c.picked === m.teams[1]} onClick={() => onPick(c.conference, m.teams[0])} />
                  <span className="px-1 text-xs text-ink-muted">vs</span>
                  <PickButton label={name(m.teams[1])} on={c.picked === m.teams[1]} off={c.picked === m.teams[0]} onClick={() => onPick(c.conference, m.teams[1])} />
                </div>
              )}
            </>}
            <ol className="mt-2 divide-y divide-ink-muted/15 rounded-lg bg-mist">
              {c.standings.map((s) => (
                <li key={s.teamId} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-sm">
                  <span className="min-w-0"><LabTeam id={s.teamId} name={name} paged={paged} /> <span className="text-ink-soft">{s.text}</span></span>
                  {odds.has(s.teamId) && <span className="text-right text-xs text-ink-soft">{odds.get(s.teamId)}</span>}
                </li>
              ))}
            </ol>
          </div>
        );
      })}
    </section>
  );
}

/** A team's name, linked to its page when it has one. */
function LabTeam({ id, name, paged }: { id: number; name: (id: number) => string; paged: Set<number> }) {
  return paged.has(id) ? <Link href={`/team/${id}`} className="font-bold text-navy hover:underline">{name(id)}</Link> : <span className="font-bold text-navy">{name(id)}</span>;
}

function Playoff({ view, picked, name, paged, onPick }: {
  view: LabView; picked: Record<number, number>; name: (id: number) => string; paged: Set<number>;
  onPick: (gameIndex: number, winner: number) => void;
}) {
  const p = view.playoff;
  return (
    <div className="space-y-8">
      {p && <>
        <section aria-labelledby="lab-field">
          <h2 id="lab-field" className="font-display text-lg font-bold">{p.heading}</h2>
          <p className="mt-1 text-xs text-ink-muted">{p.note}</p>
          <ol className="mt-2 divide-y divide-ink-muted/15 rounded-lg bg-mist">
            {p.field.map((s) => (
              <li key={s.teamId} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                <span><span className="mr-2 inline-block w-5 text-right text-ink-muted">{s.seed}</span><LabTeam id={s.teamId} name={name} paged={paged} /></span>
                <span className="text-right text-ink-soft">{s.text}</span>
              </li>
            ))}
          </ol>
          {p.bubble.length > 0 && <>
            <h3 className="mt-4 text-sm font-bold text-navy">On the bubble</h3>
            <ul className="mt-1 divide-y divide-ink-muted/15 rounded-lg border border-ink-muted/25">
              {p.bubble.map((b) => (
                <li key={b.teamId} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                  <LabTeam id={b.teamId} name={name} paged={paged} />
                  <span className="text-right text-ink-soft">{b.text}</span>
                </li>
              ))}
            </ul>
          </>}
        </section>
        <Bracket games={p.bracket} heading={p.bracketHeading} picked={picked} name={name} onPick={onPick} />
      </>}
      <section aria-labelledby="lab-ranking">
        <h2 id="lab-ranking" className="font-display text-lg font-bold">Projected ranking</h2>
        <p className="mt-1 text-xs text-ink-muted">A model of the committee, not the committee.</p>
        <ol className="mt-2 divide-y divide-ink-muted/15 rounded-lg bg-mist">
          {view.ranking.map((r) => (
            <li key={r.teamId} className="flex items-baseline justify-between gap-3 px-3 py-1.5 text-sm">
              <span className="min-w-0"><span className="mr-2 inline-block w-5 text-right text-ink-muted">{r.rank}</span><LabTeam id={r.teamId} name={name} paged={paged} />
                <span className="block pl-7 text-xs text-ink-muted">{r.reason}</span></span>
              <span className="text-right text-xs text-ink-soft">{r.text}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/**
 * The bracket, pickable once both sides of a game are known: a seeded team, or a game already picked. A pick stands
 * only in the seasons that team plays in that game.
 */
function Bracket({ games, heading, picked, name, onPick }: {
  games: BracketGame[]; heading: string; picked: Record<number, number>; name: (id: number) => string;
  onPick: (gameIndex: number, winner: number) => void;
}) {
  const known = (s: BracketSide): { teamId: number; seed: number | null } | null =>
    "teamId" in s ? s : picked[s.winnerOf] !== undefined ? { teamId: picked[s.winnerOf], seed: null } : null;
  const rounds = games.reduce<Record<string, BracketGame[]>>((acc, g) => ((acc[g.round] ??= []).push(g), acc), {});
  return (
    <section aria-labelledby="lab-bracket">
      <h2 id="lab-bracket" className="font-display text-lg font-bold">{heading}</h2>
      <p className="mt-1 text-xs text-ink-muted">Pick a winner once both teams are set.</p>
      <div className="mt-2 space-y-4">
        {Object.entries(rounds).map(([round, list]) => (
          <div key={round}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{round}</h3>
            <ul className="mt-1 grid gap-2 sm:grid-cols-2">
              {list.map((g) => {
                const a = known(g.a);
                const b = known(g.b);
                const pick = picked[g.index];
                const side = (s: BracketSide, k: typeof a, other: typeof a) => {
                  if (!k) return <p className="px-2 py-1 text-ink-muted">Winner of game {(s as { winnerOf: number }).winnerOf + 1}</p>;
                  const label = `${k.seed !== null ? `${k.seed} ` : ""}${name(k.teamId)}`;
                  if (g.result || !other) return <p className="px-2 py-1 font-semibold text-navy">{label}</p>;
                  return <PickButton label={label} on={pick === k.teamId} off={pick === other.teamId} onClick={() => onPick(g.index, k.teamId)} />;
                };
                return (
                  <li key={g.index} className="space-y-1 rounded-md bg-mist p-1 text-sm">
                    <p className="px-2 text-xs text-ink-muted">Game {g.index + 1} · {g.site}</p>
                    {side(g.a, a, b)}
                    {side(g.b, b, a)}
                    {g.result && <p className="px-2 text-xs font-semibold text-ink-soft">{g.result}</p>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
