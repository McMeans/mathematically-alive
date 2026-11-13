"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  conferenceName, conferenceShort, decodeLocks, encodeLocks, formatChampion, formatOdds, formatPlayoff, formatRecord, formatTitleOdds, oddsLabels, playoffDetail, statusTags, type StatusTag,
  type BoardHelpGame, type HelpGroup, type IndependentGame, type IndependentOutlook, type Locks, type PathTree, type PlayoffSignal, type SeasonWeek, type TeamBoard, type TeamOutlook, type TeamPath,
} from "@/core";
import type { SimRequest, SimResponse } from "@/app/sim.worker";
import { SiteBar } from "@/app/SiteBar";
import { ShareButton } from "./Share";
import { ITERATIONS } from "@/app/config";
import { TeamList } from "./Panels";
import { BestShotCard, ConferenceRace, RanksContext, Heading, HelpElsewhere, IndependentWeeks, PlayoffRaceCard, TeamLogo, WeekByWeek, WhatItTakes, YourPicks } from "./Board";
import { ConferenceProvider } from "./conference";

export type GameInfo = { id: number; homeId: number; awayId: number; week: number; start: string };
export type TeamInfo = { id: number; name: string; color: string | null; altColor: string | null };
/** One team in the team picker: its record and odds as shown, `key` to sort by (higher first), `out` to grey it. */
/**
 * A team in the team list: its playoff odds and its title-game odds (null for an independent), each with a sort key
 * (proven in above everything, proven out below) and whether it's out.
 */
export type ListRow = {
  teamId: number; record: string;
  playoff: string; playoffKey: number; playoffOut: boolean;
  title: string | null; titleKey: number; titleOut: boolean;
};
/** One conference (or the independents) in the team picker: its teams and their odds today. */
export type ConferenceList = { conference: string; teams: TeamInfo[]; rows: ListRow[] };
export type Result = { outlook: TeamOutlook[]; path: TeamPath; tree: PathTree; playoffGames: PlayoffSignal[]; board: TeamBoard | null };
export type IndependentResult = { outlook: IndependentOutlook[]; games: IndependentGame[]; playoffGames: PlayoffSignal[]; board: TeamBoard | null };
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
  /** This week's committee ranking by team: "#16". */
  ranks: Record<number, string>;
  asOf: string;
  /** "Through Oct 31", shown in the header; `asOf` is its tooltip. */
  through: string;
  /** Every game left in the season, to check the picks in a shared link. */
  openGames: OpenGame[];
};

/**
 * The Season Lab with this page's picks (game results, and a title-game winner as `title=<conference>~<team>`), and the
 * team to follow there (`team`).
 */
const labHref = (locks: Locks, teamId: number, titles: Titles = {}) => {
  const q = new URLSearchParams({ team: String(teamId) });
  const games = encodeLocks(locks);
  if (games) q.set("games", games);
  const [title] = Object.entries(titles);
  if (title) q.set("title", `${title[0]}~${title[1]}`);
  return `/lab?${q.toString()}`;
};
/** Title-game picks: conference -> the team that wins it. */
type Titles = Record<string, number>;
export const pct = (p: number | null) => (p === null ? "—" : formatOdds(p));

/**
 * Picks and the what-if worker. `conference` null: an independent's page. `read` takes the worker's answer for this
 * kind of page (null for the other kind, which can't happen).
 */
function useWhatIf<R>(initial: R, initialRanks: Record<number, string>, conference: string | null, teamId: number, openGames: OpenGame[], read: (r: SimResponse) => R | null,
  /** Checks a new result against the title picks: returns the title picks to keep when some no longer stand, else null. */
  check?: (r: R, titles: Titles) => Titles | null) {
  const [locks, setLocks] = useState<Locks>({});
  const [titles, setTitles] = useState<Titles>({});
  const [result, setResult] = useState<R>(initial);
  // Ranks by name: the committee's latest with no picks, then moved by the picks (the worker's live ranking).
  const [ranks, setRanks] = useState(initialRanks);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const worker = useRef<Worker | null>(null);
  const latest = useRef(0);
  const reader = useRef(read);
  const checker = useRef(check);
  // The picks as of the last change, for the worker's reply (its handler sees only the first render).
  const latestPicks = useRef<{ locks: Locks; titles: Titles }>({ locks: {}, titles: {} });
  useEffect(() => {
    const w = new Worker(new URL("../sim.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<SimResponse>) => {
      if (e.data.id !== latest.current) return; // a newer request is in flight
      const r = reader.current(e.data);
      if (r !== null) {
        setResult(r);
        setRanks(e.data.ranks);
        const keep = checker.current?.(r, latestPicks.current.titles);
        if (keep) {
          update(latestPicks.current.locks, keep);
          return;
        }
      }
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

  function update(next: Locks, nextTitles: Titles = latestPicks.current.titles) {
    latestPicks.current = { locks: next, titles: nextTitles };
    setLocks(next);
    setTitles(nextTitles);
    // Keep the address bar a link to these picks, without adding history entries.
    const url = new URL(window.location.href);
    const text = encodeLocks(next);
    if (text) url.searchParams.set("picks", text);
    else url.searchParams.delete("picks");
    window.history.replaceState(window.history.state, "", url);
    if (Object.keys(next).length === 0 && Object.keys(nextTitles).length === 0) {
      latest.current++; // drop any pending result
      setResult(initial);
      setRanks(initialRanks);
      setBusy(false);
      setFailed(false);
      return;
    }
    setBusy(true);
    setFailed(false);
    worker.current?.postMessage({ id: ++latest.current, conference, teamId, locks: next, titles: nextTitles } satisfies SimRequest);
  }

  /** Lock a game to a winner; a missing winner (or the current one, when toggling) clears it. */
  function pick(gameId: number, winner: number | undefined) {
    const next = { ...locks };
    if (winner === undefined || next[gameId] === winner) delete next[gameId];
    else next[gameId] = winner;
    update(next);
  }
  const status = busy ? "Updating…" : failed ? "Couldn’t update. Showing the last result." : "";
  /** Pick a conference's title-game winner; undefined clears it. */
  function pickTitle(conf: string, winner: number | undefined) {
    const next = { ...titles };
    if (winner === undefined) delete next[conf];
    else next[conf] = winner;
    update(locks, next);
  }
  return { locks, titles, result, ranks, busy, failed, status, update, pick, pickTitle };
}

/** Every pick on the page, worded for the rail. Ids: "g<game id>" for a game, "t<conference>" for a title game. */
function pickList(locks: Locks, titles: Titles, weeks: SeasonWeek[], board: TeamBoard | null, games: OpenGame[], names: Record<number, string>, teamId: number) {
  const when = new Map<number, string>();
  for (const w of weeks) {
    if (w.own) when.set(w.own.gameId, w.label);
    if (w.nonConference) when.set(w.nonConference.gameId, w.nonConference.date);
    for (const g of w.games) when.set(g.gameId, w.label);
  }
  for (const grp of board?.help ?? []) for (const g of grp.games) when.set(g.gameId, g.date);
  const byId = new Map(games.map((g) => [g.id, g]));
  const out = Object.entries(locks).map(([id, winner]) => {
    const g = byId.get(Number(id));
    const loser = g ? (g.homeId === winner ? g.awayId : g.homeId) : null;
    const what = winner === teamId ? `Beat ${loser !== null ? names[loser] : "opponent"}` : loser === teamId ? `Lose to ${names[winner]}` : `${names[winner]} over ${loser !== null ? names[loser] : "opponent"}`;
    return { id: `g${id}`, what, when: when.get(Number(id)) ?? "" };
  });
  for (const [c, w] of Object.entries(titles)) out.push({ id: `t${c}`, what: `${names[w]} wins the ${conferenceName(c)}`, when: "Title game" });
  return out;
}

/** A game picked from help from elsewhere, with the card it was on: it stays shown while it's picked. */
type Kept = Record<number, { group: Omit<HelpGroup, "games">; game: BoardHelpGame; at: number }>;

/** Picking a game elsewhere locks it, so it no longer swings the odds and drops out of the board: keep it shown. */
function keepPicked(board: TeamBoard | null, kept: Kept, locks: Locks): TeamBoard | null {
  if (!board) return board;
  const help = board.help.map((g) => ({ ...g, games: [...g.games] }));
  const shown = new Set(help.flatMap((g) => g.games.map((x) => x.gameId)));
  for (const [id, k] of Object.entries(kept)) {
    if (locks[Number(id)] === undefined || shown.has(Number(id))) continue;
    const g = help.find((x) => x.teamId === k.group.teamId);
    if (g) g.games.splice(Math.min(k.at, g.games.length), 0, k.game);
    else help.push({ ...k.group, games: [k.game] });
  }
  return { ...board, help };
}

/** Remember a help game when it's picked, forget it when it's cleared. */
function track(board: TeamBoard | null, kept: Kept, gameId: number, winner: number | undefined): Kept {
  const next = { ...kept };
  if (winner === undefined) {
    delete next[gameId];
    return next;
  }
  for (const g of board?.help ?? []) {
    const at = g.games.findIndex((x) => x.gameId === gameId);
    if (at >= 0) next[gameId] = { group: { teamId: g.teamId, team: g.team, record: g.record, title: g.title }, game: g.games[at], at };
  }
  return next;
}

/** A conference team's page. */
export function Explorer({ initial, ...common }: Common & { initial: Result }) {
  const { teamId, conference, teams, names } = common;
  // A title-game pick stands while its matchup is the same two teams (in either order); then it clears, with a note.
  const titleKey = useRef<string | null>(null);
  const [note, setNote] = useState("");
  const { locks, titles, result, ranks, busy, failed, status, update, pick, pickTitle } = useWhatIf<Result>(initial, common.ranks, conference, teamId, common.openGames, (r) =>
    r.independent ? null : { outlook: r.outlook, path: r.path, tree: r.tree, playoffGames: r.playoffGames, board: r.board },
  (r, t) => {
    if (t[conference] === undefined) return null;
    const w = r.board?.titleWeek;
    if (w?.mine && (titleKey.current === null || w.key === titleKey.current)) return null;
    titleKey.current = null;
    setNote(`${conferenceName(conference)} title pick cleared: the matchup changed.`);
    const keep = { ...t };
    delete keep[conference];
    return keep;
  });
  // The likeliest-way-in picks currently locked by the button (they stay locked while the live tree changes).
  const [wayPicks, setWayPicks] = useState<{ gameId: number; winner: number }[] | null>(null);
  const { outlook, tree, board } = result;
  const me = outlook.find((o) => o.teamId === teamId)!;
  const team = teams.find((t) => t.id === teamId)!;
  const labels = oddsLabels(conference);
  const likeliest = tree.likeliest;
  const wayOn = wayPicks !== null && wayPicks.every((p) => locks[p.gameId] === p.winner);
  const titlePick = titles[conference] ?? null;
  const week = board?.titleWeek ?? null;
  const [kept, setKept] = useState<Kept>({});
  const reset = () => { setWayPicks(null); setKept({}); titleKey.current = null; setNote(""); update({}, {}); };
  function onPick(gameId: number, winner: number | undefined) { setNote(""); pick(gameId, winner); }
  function onHelpPick(gameId: number, winner: number | undefined) { setKept((k) => track(board, k, gameId, winner)); onPick(gameId, winner); }
  const helpBoard = keepPicked(board, kept, locks);
  const shot = board?.bestShot ?? null;
  const shotLocks = shot ? { ...locks, ...Object.fromEntries((likeliest?.picks ?? []).map((p) => [p.gameId, p.winner])) } : locks;
  function onTitle(winner: number | undefined) {
    setNote("");
    titleKey.current = winner === undefined ? null : week?.key ?? null;
    pickTitle(conference, winner);
  }
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
  const lab = labHref(locks, teamId, titles);
  const picks = pickList(locks, titles, tree.weeks, board, common.openGames, names, teamId);
  function remove(id: string) {
    if (id.startsWith("t")) {
      titleKey.current = null;
      pickTitle(id.slice(1), undefined);
    } else onPick(Number(id.slice(1)), undefined);
  }
  const short = conferenceShort(conference);
  const numLabels = { titleGame: "Title game", playoff: labels.playoff, projected: labels.projected, projectedNote: labels.projectedNote };
  return (
    <Frame
      {...common}
      ranks={ranks}
      record={formatRecord(me.record, conference)}
      tags={statusTags(me, `${conferenceShort(conference)} title game`)}
      picks={picks.length}
      lab={lab}
      onReset={reset}
      busy={busy}
      status={status}
      failed={failed}
      scores={[
        { value: formatPlayoff(me.playoff, me.cfp, me.status, me.autoBid), label: `${labels.playoff}*`, lead: true, detail: playoffDetail(me) },
        { value: formatTitleOdds(me.titleGame, me.status), label: `${short} title game` },
        { value: formatChampion(me), label: labels.champion },
      ]}
      main={
        <>
          {board && board.records.length > 0 && <WhatItTakes board={board} />}
          <section aria-labelledby="weeks">
            <Heading id="weeks" sub={`${team.name}’s playoff and ${short} title-game odds after each of its own results. Tap one to lock it.`}>Week by week</Heading>
            {note && <p role="status" className="mb-2 text-sm font-semibold text-lamp-ink">{note}</p>}
            <WeekByWeek weeks={tree.weeks} outlook={me} board={board} teamId={teamId} team={team.name} names={names} locks={locks} onPick={onPick}
              title={titlePick} onTitle={onTitle} labels={numLabels} />
            {tree.footnote && <p className="mt-2 text-xs text-ink-muted">{tree.footnote}</p>}
          </section>
          {helpBoard && helpBoard.help.length > 0 && <HelpElsewhere board={helpBoard} locks={locks} onPick={onHelpPick} labels={numLabels} />}
          {shot && <BestShotCard shot={shot} locks={locks} filled={wayOn} onFill={toggleWay} lab={labHref(shotLocks, teamId, titles)} />}
        </>
      }
      rail={
        <>
          {board?.race && <PlayoffRaceCard race={board.race} lab={labHref(locks, teamId, titles)} />}
          <ConferenceRace outlook={outlook} names={names} teamId={teamId} label={`${conferenceName(conference)} race`} sub="Title-game odds" />
          <YourPicks picks={picks} lab={lab} onRemove={remove} onReset={reset} />
          <p className="text-xs text-ink-muted">* Playoff odds are our own estimate, not the committee. Odds from {ITERATIONS.toLocaleString("en-US")} simulated seasons; “In” and “Out” are proven.</p>
        </>
      }
    />
  );
}

/** An FBS independent's page: no conference, so no title game; its own games and the playoff. */
export function IndependentExplorer({ initial, ...common }: Common & { initial: IndependentResult }) {
  const { teamId, teams, names } = common;
  const { locks, result, ranks, busy, failed, status, update, pick } = useWhatIf<IndependentResult>(initial, common.ranks, null, teamId, common.openGames, (r) =>
    r.independent ? { outlook: r.outlook, games: r.games, playoffGames: r.playoffGames, board: r.board } : null);
  const me = result.outlook.find((o) => o.teamId === teamId)!;
  const team = teams.find((t) => t.id === teamId)!;
  const board = result.board;
  const lab = labHref(locks, teamId);
  const picks = pickList(locks, {}, [], board, common.openGames, names, teamId);
  const numLabels = { titleGame: "Title game", playoff: "Playoff" };
  const [kept, setKept] = useState<Kept>({});
  function onHelpPick(gameId: number, winner: number | undefined) { setKept((k) => track(board, k, gameId, winner)); pick(gameId, winner); }
  const helpBoard = keepPicked(board, kept, locks);
  return (
    <Frame
      {...common}
      ranks={ranks}
      record={formatRecord(me.record, common.conference)}
      tags={statusTags(me, null)}
      picks={picks.length}
      lab={lab}
      onReset={() => { setKept({}); update({}); }}
      busy={busy}
      status={status}
      failed={failed}
      scores={[{ value: formatPlayoff(me.playoff, me.cfp, me.postseasonBan ? "eliminated" : "alive"), label: "Playoff*", lead: true, detail: playoffDetail(me) }]}
      main={
        <>
          {board && board.records.length > 0 && <WhatItTakes board={board} />}
          <section aria-labelledby="weeks">
            <Heading id="weeks" sub={`${team.name}’s playoff odds after each of its results. Tap one to lock it.`}>Week by week</Heading>
            <IndependentWeeks games={result.games} board={board} teamId={teamId} team={team.name} locks={locks} onPick={pick} labels={numLabels} />
          </section>
          {helpBoard && helpBoard.help.length > 0 && <HelpElsewhere board={helpBoard} locks={locks} onPick={onHelpPick} labels={numLabels} />}
        </>
      }
      rail={
        <>
          {board?.race && <PlayoffRaceCard race={board.race} lab={lab} />}
          <YourPicks picks={picks} lab={lab} onRemove={(id) => pick(Number(id.slice(1)), undefined)} onReset={() => update({})} />
          <p className="text-xs text-ink-muted">* Playoff odds are our own estimate, not the committee.</p>
        </>
      }
    />
  );
}

type Score = { value: string; label: string; lead?: boolean; detail?: { label: string; value: string }[] };

function Frame({ teamId, conference, teams, conferences, names, ranks, through, asOf, record, tags, picks, lab, onReset, busy, failed, status, scores, main, rail }: Common & {
  /** The team's record: "6-3 (5-2 ACC)". */
  record: string;
  /** One per goal: "Playoff · Needs a miracle", "ACC title game · Out". */
  tags: StatusTag[];
  /** How many picks are on the page. */
  picks: number;
  /** The Season Lab link, carrying the picks and the team. */
  lab: string;
  onReset: () => void;
  busy: boolean;
  failed: boolean;
  status: string;
  /** The header's numbers, the lead one first. */
  scores: Score[];
  main: ReactNode;
  rail: ReactNode;
}) {
  const [sheet, setSheet] = useState(false);
  const pickerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!sheet) return;
    const close = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSheet(false);
      pickerRef.current?.focus();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [sheet]);
  // The team just clicked in the list, while its page loads (this component remounts per team).
  const [going, setGoing] = useState<number | null>(null);
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
  const openLab = (
    <><span className="sm:hidden">Lab</span><span className="hidden sm:inline">Open picks in Lab</span>{picks > 0 && <span className="font-sans text-xs font-semibold normal-case tracking-normal text-board-muted"> · {picks} pick{picks === 1 ? "" : "s"}</span>} <span aria-hidden className="text-lamp">→</span></>
  );
  // The page's own actions, the same on every screen, on the board: the Lab (outlined), Share (the cream plate), and
  // Reset, lit amber once there are picks to clear.
  const reset = (
    <button type="button" onClick={onReset} disabled={picks === 0} aria-label="Reset picks"
      className={`cond flex h-9 items-center gap-1.5 rounded-[3px] border px-2.5 text-base font-bold tracking-[0.05em] transition-colors sm:px-3 ${picks > 0 ? "border-lamp bg-lamp text-plate-ink hover:bg-[#f5c056]" : "border-board-line text-board-muted opacity-50"}`}>
      <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10a6 6 0 1 0 1.8-4.3" /><path d="M4 3.5V7h3.5" /></svg>
      <span className="hidden sm:inline">Reset</span>
    </button>
  );

  return (
    <ConferenceProvider value={conference}>
      <RanksContext.Provider value={ranks}>
      <div className="flex min-h-dvh flex-col md:h-dvh md:overflow-hidden">
        <header className="board-dots sticky top-0 z-30 text-board-text md:static">
          <SiteBar current="teams" teams={`/team/${teamId}`} lab={lab} through={through} asOf={asOf} find={conferences.flatMap((c) => c.teams)} />
          {/* Phones stack the header: picker, tags, the numbers, then the actions. From md the picker column sits beside the numbers. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 pb-3 pt-2.5 md:flex-nowrap md:gap-8 md:px-6 md:pb-5 md:pt-4">
            <div className="contents md:relative md:flex md:min-w-0 md:flex-col md:items-start md:gap-2.5">
              {/* The team picker: the name in a field, like a select, with the chevron in its own cell. */}
              <button type="button" ref={pickerRef} aria-expanded={sheet} aria-controls="team-sheet" aria-label={`${team.name}: change team`} onClick={() => setSheet(!sheet)}
                className={`order-1 flex min-w-0 max-w-full items-stretch rounded-[3px] border md:order-none bg-white/[0.04] text-left transition-colors hover:border-board-muted hover:bg-white/[0.07] ${sheet ? "border-board-muted" : "border-board-line"}`}>
                <span className="cond flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-2xl font-extrabold leading-none text-white md:px-3 md:py-2 md:text-[40px]">
                  <TeamLogo id={teamId} size="1.1em" />
                  <span className="truncate">{team.name}</span>
                </span>
                <span className="flex items-center border-l border-board-line px-2 text-board-text md:px-3">
                  <svg aria-hidden viewBox="0 0 12 12" className={`h-4 w-4 transition-transform md:h-5 md:w-5 ${sheet ? "rotate-180" : ""}`}><path d="M2.5 4.5 6 8 9.5 4.5" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="square" /></svg>
                </span>
              </button>
              <span className="order-2 -mt-1 flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs text-board-muted md:order-none md:w-auto md:text-sm">
                {record}
                {tags.map((t) => (
                  <span key={t.label} className={`cond whitespace-nowrap rounded-[2px] border px-1.5 text-xs font-extrabold tracking-[0.1em] ${t.live ? "border-lamp text-lamp" : "border-board-line text-board-muted"}`}>{t.label}</span>
                ))}
              </span>
              <div className="order-4 flex w-full flex-wrap items-center gap-2 md:order-none md:w-auto">
                <Link href={lab} className="cond flex h-9 items-center gap-1.5 rounded-[3px] border border-board-line px-3 text-base font-bold tracking-[0.05em] text-white hover:border-lamp">{openLab}</Link>
                <ShareButton board label="Share" />
                {reset}
              </div>
              {sheet && (
                <>
                  <button type="button" aria-label="Close team list" tabIndex={-1} onClick={() => { setSheet(false); pickerRef.current?.focus(); }} className="fixed inset-0 z-20 cursor-default" />
                  <div id="team-sheet" className="scroll-thin absolute left-4 top-full md:left-0 z-30 mt-2 max-h-[min(70dvh,34rem)] w-[min(24rem,calc(100vw-2rem))] origin-top animate-pop overflow-y-auto rounded-md border border-board-line bg-board-deep shadow-[0_12px_32px_rgba(10,36,26,0.4),0_2px_6px_rgba(10,36,26,0.3)]">
                    <TeamList conferences={conferences} names={names} selectedId={going ?? teamId} onSelect={(id) => { if (id !== teamId) setGoing(id); setSheet(false); }} />
                  </div>
                </>
              )}
            </div>
            <div className="order-3 flex w-full shrink-0 items-start justify-between gap-2.5 md:order-none md:ml-auto md:w-auto md:justify-start md:gap-5">
              {scores.map((s) => (
                <div key={s.label} className="text-center">
                  <div key={s.value} className={`plate plate-hang text-white ${s.lead ? "text-[32px] md:text-[56px]" : "text-[22px] md:text-4xl"}`}>{s.value}</div>
                  <span className={`cond mt-1 block max-w-[5.5em] text-[11px] font-semibold tracking-[0.02em] md:max-w-none md:text-sm md:tracking-[0.08em] ${s.lead ? "text-white" : "text-board-muted"}`}>{s.label}</span>
                  {s.detail && s.detail.length > 0 && (
                    <span className="mt-0.5 hidden text-xs text-board-muted md:block">{s.detail.map((d) => <span key={d.label}>{d.label} <b className="font-semibold text-white">{d.value}</b></span>).reduce<ReactNode[]>((acc, x, k) => (k ? [...acc, " · ", x] : [x]), [])}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </header>

        {/* On desktop the page is one screen tall and each column scrolls on its own. */}
        <div className="grid flex-1 md:min-h-0 md:grid-cols-[minmax(0,1fr)_300px]">
          <main aria-busy={going !== null || busy} className={`scroll-thin relative min-w-0 p-4 transition-opacity duration-200 md:overflow-y-auto md:p-6 ${busy ? "opacity-80" : ""}`}>
            {going !== null && <Loading name={names[going]} />}
            {status && <p role="status" className={`mb-2 text-xs ${failed ? "text-hurt" : "text-ink-muted"}`}>{status}</p>}
            {main}
          </main>
          <aside aria-label="Summary" className="scroll-thin border-t border-rule bg-paper p-4 pb-10 md:overflow-y-auto md:border-l md:border-t-0 md:px-5 md:py-6">
            {rail}
          </aside>
        </div>
      </div>
      </RanksContext.Provider>
    </ConferenceProvider>
  );
}

/** Covers a column while the next team's page loads. */
function Loading({ name }: { name?: string }) {
  return (
    // Sticks to the top of the column, so it covers what's on screen however far the column is scrolled.
    <div className="sticky top-0 z-10 -mx-4 -mt-4 h-0 md:-mx-6 md:-mt-6">
      <div className="flex h-dvh justify-center bg-ground/75 pt-24">
        {/* A small board: three lamps light in turn, then the team's name in board lettering. */}
        <div role="status" className="board-dots cond flex h-fit items-center gap-3 rounded px-4 py-2.5 text-[15px] font-bold tracking-wide text-board-text shadow-lg">
          <span aria-hidden className="chase flex gap-1.5">
            <span />
            <span />
            <span />
          </span>
          {name ? `Loading ${name}…` : <span className="sr-only">Loading</span>}
        </div>
      </div>
    </div>
  );
}
