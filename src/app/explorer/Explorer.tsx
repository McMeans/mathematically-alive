"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  conferenceName, conferenceShort, decodeLocks, encodeLocks, formatChampion, formatPlayoff, formatRecord, formatTitleOdds, oddsLabels, playoffDetail, titleGameOutLine,
  type BoardHelpGame, type HelpGroup, type IndependentGame, type IndependentOutlook, type Locks, type PathTree, type PlayoffSignal, type TeamBoard, type TeamOutlook, type TeamPath,
} from "@/core";
import type { SimRequest, SimResponse } from "@/app/sim.worker";
import { SiteBar } from "@/app/SiteBar";
import { BoardButton } from "@/app/BoardButton";
import { Lit } from "@/app/Lit";
import { ShareButton } from "./Share";
import { ITERATIONS } from "@/app/config";
import { TeamList } from "./Panels";
import { AbbreviationsContext, BestShotCard, ConferenceRace, RanksContext, Heading, HelpElsewhere, IndependentWeeks, PlayoffRaceCard, TeamLogo, WeekByWeek, WhatItTakes, YourPicks } from "./Board";
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
/** An unplayed game: its teams and kickoff (ISO), for decoding shared picks and dating them. */
export type OpenGame = { id: number; homeId: number; awayId: number; start: string };

/** What every team page shares: the header, the team picker and the frame around the page's own columns. */
type Common = {
  teamId: number;
  conference: string;
  teams: TeamInfo[];
  conferences: ConferenceList[];
  names: Record<number, string>;
  /** Every team's abbreviation ("FIU"), for narrow buttons and columns; a team without one is missing. */
  abbreviations: Record<number, string>;
  /** This week's committee ranking by team: "#16". */
  ranks: Record<number, string>;
  asOf: string;
  /** "Through Oct 31", shown in the header; `asOf` is its tooltip. */
  through: string;
  /** Every game left in the season, to check the picks in a shared link. */
  openGames: OpenGame[];
};

/** "Data through Nov 10." from the header's "Through Nov 10". */
const dataNote = (through: string) => `Data ${through.charAt(0).toLowerCase()}${through.slice(1)}.`;

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

/**
 * Picks and the what-if worker. `conference` null: an independent's page. `read` takes the worker's answer for this
 * kind of page (null for the other kind, which can't happen).
 */
function useWhatIf<R>(initial: R, initialRanks: Record<number, string>, conference: string | null, teamId: number, openGames: OpenGame[], read: (r: SimResponse) => R | null,
  /** Checks a new result against the title picks: returns the title picks to keep when some no longer stand, else null. */
  check?: (r: R, titles: Titles) => Titles | null) {
  const [locks, setLocks] = useState<Locks>({});
  const [titles, setTitles] = useState<Titles>({});
  // The picks before each change (the last 50), for Undo.
  const [history, setHistory] = useState<{ locks: Locks; titles: Titles }[]>([]);
  const [result, setResult] = useState<R>(initial);
  // Ranks by name: the current ranking (the committee's latest, moved by real results only). Picks never change it.
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
          update(latestPicks.current.locks, keep, false);
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
    if (Object.keys(shared).length > 0) update(shared, {}, false);
    else if (text !== null) {
      // Nothing in the link survived: drop the param so the address bar doesn't claim picks the page isn't showing.
      const url = new URL(window.location.href);
      url.searchParams.delete("picks");
      window.history.replaceState(window.history.state, "", url);
    }
    return () => w.terminate();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on load: the worker and a shared link's picks
  }, []);

  /** `record` false: not a change of the visitor's own (a link's picks, a title pick the new result undid), so no Undo step. */
  function update(next: Locks, nextTitles: Titles = latestPicks.current.titles, record = true) {
    if (record) {
      const prev = latestPicks.current;
      setHistory((h) => [...h.slice(-49), prev]);
    }
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
  /** Back to the picks before the last change. */
  function undo() {
    const prev = history.at(-1);
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    update(prev.locks, prev.titles, false);
  }
  return { locks, titles, result, ranks, busy, failed, status, update, pick, pickTitle, undo, canUndo: history.length > 0 };
}

const PICK_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });

/** Every pick on the page, worded for the rail. */
export type RailPick = {
  id: string; what: string; when: string; winner: number; loser: number | null;
  /** A title-game pick: the conference it wins ("SEC"). */
  wins?: string;
};
/** Every pick on the page, worded for the rail. Ids: "g<game id>" for a game, "t<conference>" for a title game. */
function pickList(locks: Locks, titles: Titles, games: OpenGame[], names: Record<number, string>, teamId: number) {
  const byId = new Map(games.map((g) => [g.id, g]));
  const out = Object.entries(locks).map(([id, winner]): RailPick => {
    const g = byId.get(Number(id));
    const loser = g ? (g.homeId === winner ? g.awayId : g.homeId) : null;
    const what = winner === teamId ? `Beat ${loser !== null ? names[loser] : "opponent"}` : loser === teamId ? `Lose to ${names[winner]}` : `${names[winner]} over ${loser !== null ? names[loser] : "opponent"}`;
    // Each pick dated by its own kickoff, Eastern, as the boards date games: a week's label is only its first game's day.
    const start = g ? new Date(g.start) : null;
    return { id: `g${id}`, what, when: start && !Number.isNaN(start.getTime()) ? PICK_DAY.format(start) : "", winner, loser };
  });
  for (const [c, w] of Object.entries(titles)) out.push({ id: `t${c}`, what: `${names[w]} wins the ${conferenceName(c)}`, when: "Title game", winner: w, loser: null, wins: conferenceShort(c) });
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

/**
 * Remember a help game when it's picked. Clearing it doesn't forget it (only a picked one shows), so Undo can bring the
 * pick back where it was.
 */
function track(board: TeamBoard | null, kept: Kept, gameId: number, winner: number | undefined): Kept {
  if (winner === undefined) return kept;
  const next = { ...kept };
  for (const g of board?.help ?? []) {
    const at = g.games.findIndex((x) => x.gameId === gameId);
    if (at >= 0) next[gameId] = { group: { teamId: g.teamId, team: g.team, record: g.record, title: g.title }, game: g.games[at], at };
  }
  return next;
}

/** A conference team's page. */
export function Explorer({ initial, ...common }: Common & { initial: Result }) {
  const { teamId, conference, teams, names, through } = common;
  // A title-game pick stands while its matchup is the same two teams (in either order); then it clears, with a note.
  const titleKey = useRef<string | null>(null);
  const [note, setNote] = useState("");
  const { locks, titles, result, ranks, busy, failed, status, update, pick, pickTitle, undo, canUndo } = useWhatIf<Result>(initial, common.ranks, conference, teamId, common.openGames, (r) =>
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
  const reset = () => { setWayPicks(null); titleKey.current = null; setNote(""); update({}, {}); };
  // A title pick Undo brings back stands while its team is in the title game (its matchup key is gone with the step).
  const back = () => { titleKey.current = null; setNote(""); undo(); };
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
  const picks = pickList(locks, titles, common.openGames, names, teamId);
  function remove(id: string) {
    if (id.startsWith("t")) {
      titleKey.current = null;
      pickTitle(id.slice(1), undefined);
    } else onPick(Number(id.slice(1)), undefined);
  }
  const short = conferenceShort(conference);
  const outLine = titleGameOutLine(conference, me);
  const numLabels = { titleGame: "Title game", playoff: labels.playoff, projected: labels.projected, projectedNote: labels.projectedNote };
  return (
    <Frame
      {...common}
      ranks={ranks}
      record={formatRecord(me.record, conference)}
      picks={picks.length}
      lab={lab}
      onReset={reset}
      onUndo={back}
      canUndo={canUndo}
      busy={busy}
      status={status}
      failed={failed}
      scores={[
        { value: formatPlayoff(me.playoff, me.cfp, me.status, me.autoBid, me.postseasonBan), label: `${labels.playoff}*`, lead: true, detail: playoffDetail(me) },
        { value: formatTitleOdds(me.titleGame, me.status), label: `${short} title game`, short: "Title game" },
        { value: formatChampion(me), label: labels.champion },
      ]}
      main={
        <>
          {board && board.records.length > 0 && <WhatItTakes board={board} />}
          <section aria-labelledby="weeks">
            <Heading id="weeks" sub={`${team.name}’s playoff and ${conferenceName(conference)} title-game odds after each of its own results. Tap one to lock it.`}>Week by week</Heading>
            {note && <p role="status" className="mb-2 text-sm font-semibold text-lamp-ink">{note}</p>}
            {outLine && <p className="mb-2 text-[13px] text-ink-muted">{outLine}</p>}
            <WeekByWeek weeks={tree.weeks} outlook={me} board={board} teamId={teamId} team={team.name} names={names} locks={locks} onPick={onPick}
              title={titlePick} onTitle={onTitle} labels={numLabels} settled={outLine !== null} />
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
          <YourPicks picks={picks} names={names} onRemove={remove} />
          <p className="text-xs text-ink-muted">* Playoff odds are our own estimate, not the committee. Odds from {ITERATIONS.toLocaleString("en-US")} simulated seasons; “In” and “Out” are proven. {dataNote(through)}</p>
        </>
      }
    />
  );
}

/** An FBS independent's page: no conference, so no title game; its own games and the playoff. */
export function IndependentExplorer({ initial, ...common }: Common & { initial: IndependentResult }) {
  const { teamId, teams, names, through } = common;
  const { locks, result, ranks, busy, failed, status, update, pick, undo, canUndo } = useWhatIf<IndependentResult>(initial, common.ranks, null, teamId, common.openGames, (r) =>
    r.independent ? { outlook: r.outlook, games: r.games, playoffGames: r.playoffGames, board: r.board } : null);
  const me = result.outlook.find((o) => o.teamId === teamId)!;
  const team = teams.find((t) => t.id === teamId)!;
  const board = result.board;
  const lab = labHref(locks, teamId);
  const picks = pickList(locks, {}, common.openGames, names, teamId);
  const numLabels = { titleGame: "Title game", playoff: "Playoff" };
  const [kept, setKept] = useState<Kept>({});
  function onHelpPick(gameId: number, winner: number | undefined) { setKept((k) => track(board, k, gameId, winner)); pick(gameId, winner); }
  const helpBoard = keepPicked(board, kept, locks);
  return (
    <Frame
      {...common}
      ranks={ranks}
      record={formatRecord(me.record, common.conference)}
      picks={picks.length}
      lab={lab}
      onReset={() => update({})}
      onUndo={undo}
      canUndo={canUndo}
      busy={busy}
      status={status}
      failed={failed}
      scores={[{ value: formatPlayoff(me.playoff, me.cfp, "alive", false, me.postseasonBan), label: "Playoff*", lead: true, detail: playoffDetail(me) }]}
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
          <YourPicks picks={picks} names={names} onRemove={(id) => pick(Number(id.slice(1)), undefined)} />
          <p className="text-xs text-ink-muted">* Playoff odds are our own estimate, not the committee. {dataNote(through)}</p>
        </>
      }
    />
  );
}

type Score = {
  value: string; label: string; lead?: boolean; detail?: { label: string; value: string }[];
  /** A shorter label for the odds band on phones ("Title game" for "Big Ten title game"). */
  short?: string;
};

/** The names on a team's header from here on wrap instead of truncating: past this many letters it steps down a size. */
const LONG_NAME = 18;
/** In the name line, which shares its row with Undo, Reset and Share, names past this many letters step down to 15px. */
const STRIP_NAME = 12;

function Frame({ teamId, conference, teams, conferences, names, abbreviations, ranks, through, asOf, record, picks, lab, onReset, onUndo, canUndo, busy, failed, status, scores, main, rail }: Common & {
  /** The team's record, shown in the team picker under the name: "6-3 (5-2 ACC)". */
  record: string;
  /** How many picks are on the page. */
  picks: number;
  /** The Season Lab link, carrying the picks and the team. */
  lab: string;
  onReset: () => void;
  onUndo: () => void;
  canUndo: boolean;
  busy: boolean;
  failed: boolean;
  status: string;
  /** The header's numbers, the lead one first. */
  scores: Score[];
  main: ReactNode;
  rail: ReactNode;
}) {
  const [sheet, setSheet] = useState(false);
  // Two pickers share one state: the name line's (phones, and screens too short for the one-screen layout) and the header's.
  const stripPicker = useRef<HTMLButtonElement>(null);
  const deskPicker = useRef<HTMLButtonElement>(null);
  const focusPicker = () => [deskPicker.current, stripPicker.current].find((b) => b && b.offsetParent !== null)?.focus();
  useEffect(() => {
    if (!sheet) return;
    const close = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSheet(false);
      focusPicker();
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
  const long = team.name.length > LONG_NAME;
  const openLab = (
    <>Open picks in Lab{picks > 0 && <span className="font-sans text-xs font-semibold normal-case tracking-normal text-board-muted"> · {picks} pick{picks === 1 ? "" : "s"}</span>} <span aria-hidden className="text-lamp">→</span></>
  );
  // Undo, Reset, Share: the same suite, in the same order, as the Lab's header. Below `sm` all three are icon squares,
  // to sit in the name line beside the team.
  const actions = (
    <div className="flex shrink-0 gap-1.5">
      <BoardButton kind="undo" onClick={onUndo} disabled={!canUndo} />
      <BoardButton kind="reset" onClick={onReset} disabled={picks === 0} />
      {/* Dimmed with no picks, as in the Lab, but still pressable: the link still shares the team. */}
      <ShareButton board label="Share" className={picks === 0 ? "opacity-55" : ""} />
    </div>
  );
  const labLink = "cond inline-flex items-center gap-1 whitespace-nowrap text-[15px] font-bold tracking-[0.05em] text-board-text transition-colors hover:text-white";
  const chevron = (cls: string) => <svg aria-hidden viewBox="0 0 12 12" className={`transition-transform ${cls} ${sheet ? "rotate-180" : ""}`}><path d="M2.5 4.5 6 8 9.5 4.5" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="square" /></svg>;
  const pickerLabel = `${team.name}: change team`;
  const list = (
    <TeamList conferences={conferences} names={names} abbreviations={abbreviations} selectedId={going ?? teamId} onSelect={(id) => { if (id !== teamId) setGoing(id); setSheet(false); }} />
  );
  const closeSheet = () => { setSheet(false); focusPicker(); };
  const panel = "scroll-thin absolute z-30 mt-2 max-h-[min(70dvh,34rem)] w-[min(24rem,calc(100vw-1.75rem))] origin-top animate-pop overflow-y-auto rounded-md border border-board-line bg-board-deep shadow-[0_12px_32px_rgba(10,36,26,0.4),0_2px_6px_rgba(10,36,26,0.3)]";

  return (
    <ConferenceProvider value={conference}>
      <RanksContext.Provider value={ranks}>
      <AbbreviationsContext.Provider value={abbreviations}>
      {/* The one-screen layout (static header, columns that scroll on their own) needs a screen at least 640px tall as well
          as 768 wide; shorter ones scroll as one page, with the name line and odds band as the only sticky part. */}
      <div className="flex min-h-dvh flex-col tall:md:h-dvh tall:md:overflow-hidden">
        <header className="contents">
          <div className="board-dots text-board-text">
            <SiteBar current="teams" teams={`/team/${teamId}`} lab={lab} through={through} asOf={asOf} find={conferences.flatMap((c) => c.teams).map((t) => ({ ...t, abbr: abbreviations[t.id] }))} />
          </div>

          {/* Phones and short screens: the name line (picker with the record under the name, then Undo, Reset, Share) and
              the odds band stick together while the page scrolls. */}
          <div className="board-dots sticky top-0 z-30 text-board-text tall:md:hidden">
            <div className="relative flex h-[52px] items-center gap-2 pl-3.5 pr-2 md:px-6">
              <button type="button" ref={stripPicker} aria-expanded={sheet} aria-controls="team-sheet-strip" aria-label={pickerLabel} onClick={() => setSheet(!sheet)}
                className="relative z-30 flex h-11 min-w-0 flex-1 items-center gap-2 text-left">
                <TeamLogo id={teamId} size="1.5rem" />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className={`cond min-w-0 font-extrabold tracking-[0.03em] text-white ${team.name.length > STRIP_NAME ? "line-clamp-2 text-[15px] leading-[1.05]" : "truncate text-xl leading-none"}`}>{team.name}</span>
                  <span className="truncate text-[11.5px] leading-none text-board-muted">{record}</span>
                </span>
                <span className="shrink-0 text-board-muted">{chevron("h-3.5 w-3.5")}</span>
              </button>
              {sheet && (
                <>
                  <button type="button" aria-label="Close team list" tabIndex={-1} onClick={closeSheet} className="fixed inset-0 z-20 cursor-default" />
                  <div id="team-sheet-strip" className={`${panel} left-3.5 top-full md:left-6`}>{list}</div>
                </>
              )}
              {actions}
            </div>
            <OddsBand scores={scores} />
          </div>

          {/* The rest of the header. One screen: the identity row (picker with the record, then the actions with the Lab
              link under them), the odds band and the playoff road. Phones: the playoff road, then one row of actions. */}
          <div className="board-dots flex flex-col text-board-text">
            <div className="hidden flex-wrap items-center gap-x-5 gap-y-3 px-6 pb-3.5 pt-4 tall:md:flex">
              <div className="relative min-w-0 max-w-full">
                {/* The team picker, as a field with the chevron in its own cell: the name, the record under it. The name is
                    never cut: it steps down a size, then wraps. */}
                <button type="button" ref={deskPicker} aria-expanded={sheet} aria-controls="team-sheet" aria-label={pickerLabel} onClick={() => setSheet(!sheet)}
                  className={`flex max-w-full items-stretch rounded-[3px] border bg-white/[0.04] text-left transition-colors hover:border-board-muted hover:bg-white/[0.07] ${sheet ? "border-board-muted" : "border-board-line"}`}>
                  <span className={`cond flex min-w-0 items-center gap-2.5 px-3 py-2 text-[32px] text-white ${long ? "" : "tall:lg:text-[40px]"}`}>
                    <TeamLogo id={teamId} size="1.1em" />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="min-w-0 break-words font-extrabold leading-[0.95]">{team.name}</span>
                      <span className="font-sans text-[13px] font-medium normal-case leading-none tracking-normal text-board-muted">{record}</span>
                    </span>
                  </span>
                  <span className="flex w-11 items-center justify-center border-l border-board-line text-board-text">{chevron("h-5 w-5")}</span>
                </button>
                {sheet && (
                  <>
                    <button type="button" aria-label="Close team list" tabIndex={-1} onClick={closeSheet} className="fixed inset-0 z-20 cursor-default" />
                    <div id="team-sheet" className={`${panel} left-0 top-full`}>{list}</div>
                  </>
                )}
              </div>
              <div className="ml-auto flex flex-col items-end gap-2">
                {actions}
                <Link href={lab} className={labLink}>{openLab}</Link>
              </div>
            </div>
            {/* Phones and short screens: the Lab link on its own line, under the playoff road. */}
            <div className="flex px-3.5 md:px-6 tall:md:hidden">
              <Link href={lab} className={`${labLink} min-h-11`}>{openLab}</Link>
            </div>
            <div className="hidden tall:md:block"><OddsBand scores={scores} /></div>
            <PlayoffRoad detail={scores.find((s) => s.lead)?.detail ?? []} />
          </div>
        </header>

        {/* On a tall desktop the page is one screen and each column scrolls on its own. */}
        <div className="grid flex-1 tall:md:min-h-0 tall:md:grid-cols-[minmax(0,1fr)_300px]">
          <main aria-busy={going !== null || busy} className={`scroll-thin relative min-w-0 p-4 transition-opacity duration-200 tall:md:overflow-y-auto tall:md:p-6 ${busy ? "opacity-80" : ""}`}>
            {going !== null && <Loading name={names[going]} />}
            {status && <p role="status" className={`mb-2 text-xs ${failed ? "text-hurt" : "text-ink-muted"}`}>{status}</p>}
            {main}
          </main>
          <aside aria-label="Summary" className="scroll-thin border-t border-rule bg-paper p-4 pb-10 tall:md:overflow-y-auto tall:md:border-l tall:md:border-t-0 tall:md:px-5 tall:md:py-6">
            {rail}
          </aside>
        </div>
      </div>
      </AbbreviationsContext.Provider>
      </RanksContext.Provider>
    </ConferenceProvider>
  );
}

/**
 * The header's main numbers in one board-deep band of equal cells, label over lit number, the lead one's label in white.
 * Phones use each label's short form ("Title game").
 */
function OddsBand({ scores }: { scores: Score[] }) {
  return (
    <div className="grid border-t border-board-line bg-board-deep" style={{ gridTemplateColumns: `repeat(${scores.length}, minmax(0, 1fr))` }}>
      {scores.map((s) => (
        <div key={s.label} className="flex min-w-0 flex-col gap-0.5 px-3.5 pb-2 pt-1.5 not-first:border-l not-first:border-board-line md:px-6 tall:md:gap-1 tall:md:pb-3 tall:md:pt-2.5">
          <span className={`cond truncate text-[11px] font-bold tracking-[0.08em] tall:md:text-xs ${s.lead ? "text-white" : "text-board-muted"}`}>
            {s.short ? <><span className="sm:hidden">{s.short}</span><span className="hidden sm:inline">{s.label}</span></> : s.label}
          </span>
          <Lit value={s.value} className="text-[26px] text-white tall:md:text-4xl tall:lg:text-[44px]" />
        </div>
      ))}
    </div>
  );
}

/**
 * The playoff's second tier under the band ("First-round bye <0.1%", "National title 14%"): small lit numbers, a step
 * down from the band's. Nothing when the playoff has none (no field simulated).
 */
function PlayoffRoad({ detail }: { detail: { label: string; value: string }[] }) {
  if (detail.length === 0) return null;
  return (
    <div className="order-first flex flex-wrap items-baseline gap-x-4 gap-y-0.5 border-b border-board-line bg-board-deep px-3.5 py-1.5 md:px-6 tall:md:order-none tall:md:border-b-0 tall:md:border-t">
      <span className="cond text-[11px] font-bold tracking-[0.1em] text-board-muted">Playoff road</span>
      {detail.map((d) => (
        <span key={d.label} className="inline-flex items-baseline gap-1.5">
          <span className="cond text-[11px] font-bold tracking-[0.08em] text-board-muted">{d.label}</span>
          <Lit value={d.value} className="text-[15px] text-board-text" />
        </span>
      ))}
    </div>
  );
}

/** Covers a column while the next team's page loads. */
function Loading({ name }: { name?: string }) {
  return (
    // Sticks to the top of the column, so it covers what's on screen however far the column is scrolled.
    <div className="sticky top-0 z-10 -mx-4 -mt-4 h-0 tall:md:-mx-6 tall:md:-mt-6">
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
