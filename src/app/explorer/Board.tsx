"use client";
// The team page's board, design B: what it takes, the team's own games week by week (and its title game once it's in
// the likeliest matchup), help from elsewhere, and the rail's races. Every number and line comes from `@/core`.
import Link from "next/link";
import { createContext, useContext, type ReactNode } from "react";
import {
  formatSideOdds, formatTitleOdds,
  type BestShot, type HelpGroup, type IndependentGame, type PlayoffRace, type RaceItem, type SeasonWeek, type TeamBoard, type TeamOutlook,
} from "@/core";
import type { Locks } from "./Explorer";
import { ShareButton } from "./Share";

export type PickFn = (gameId: number, winner: number | undefined) => void;

/** A team's logo from CollegeFootballData: `dark` for the board, light for the ground or a lit (amber) button. */
export function TeamLogo({ id, dark = true, size = "1.2em" }: { id: number; dark?: boolean; size?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small external logos, no layout shift worth optimising
    <img src={`https://cdn.collegefootballdata.com/${dark ? "logos-dark" : "logos"}/64/${id}.png`} alt="" width={64} height={64}
      className="inline-block shrink-0 object-contain align-[-0.24em]" style={{ width: size, height: size }} loading="lazy" />
  );
}

/** This week's committee ranking by team ("#16"), for every name on the page. */
export const RanksContext = createContext<Record<number, string>>({});

/** A team as the page names it: logo, then its committee rank when it has one, then its name. */
export function TeamName({ id, name, dark = true }: { id: number; name: string; dark?: boolean }) {
  const rank = useContext(RanksContext)[id];
  return (
    <span className="inline-flex min-w-0 items-center gap-1 align-bottom">
      <TeamLogo id={id} dark={dark} />
      <span className="min-w-0 truncate">{rank && <span className="mr-1 text-[0.74em] font-bold opacity-80">{rank}</span>}{name}</span>
    </span>
  );
}

/** A section heading on the ground: condensed capitals, with an optional line under it. */
export function Heading({ id, children, sub }: { id: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-3">
      <h2 id={id} className="cond text-2xl font-extrabold tracking-[0.02em]">{children}</h2>
      {sub && <p className="mt-0.5 text-ink-soft">{sub}</p>}
    </div>
  );
}

/** One number on a result button, labelled under it; `change`: how much it moves the team's odds today ("+5", "−2"). */
type Num = { value: string; label: string; change?: string | null };

/**
 * One result you can lock: what happens, its chance, and the team's odds if it does. A lock fills it amber.
 * `small`: a game elsewhere, one size down.
 */
export function Outcome({ label, chance, nums, picked, small, onClick }: {
  label: string; chance?: string; nums: Num[]; picked: boolean; small?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={picked} onClick={onClick} title={picked ? "Locked. Tap again to clear." : `Lock: ${label}`}
      className={`press flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-[3px] border px-3 text-left ${small ? "py-1.5" : "py-2"} ${
        picked ? "border-lamp bg-lamp text-plate-ink" : "border-board-line bg-white/[0.04] text-white hover:border-board-muted hover:bg-white/[0.07]"}`}>
      <span className="flex min-w-0 flex-col gap-px">
        <span className={`cond flex items-center gap-1.5 font-bold tracking-[0.03em] ${small ? "text-sm" : "text-base"} ${picked ? "" : small ? "text-board-muted" : "text-board-text"}`}>
          <span className="min-w-0">{label}</span>
        </span>
        {chance && <span className={`text-xs ${picked ? "text-plate-ink" : "text-board-muted"}`}>{chance}</span>}
      </span>
      <span className="flex shrink-0 items-baseline gap-3.5">
        {nums.map((n, k) => (
          <span key={n.label} className="flex flex-col items-end gap-0.5">
            <span className="flex items-baseline gap-1">
              <span className={`plate ${k === 0 ? (small ? "text-xl" : "text-[26px]") : small ? "text-[15px]" : "text-lg"} ${picked ? "" : k === 0 ? "text-white" : "text-board-text"}`}>{n.value}</span>
              {n.change && <span className={`plate text-[13px] ${picked ? "" : n.change.startsWith("+") ? "text-root" : "text-drop"}`}>{n.change}</span>}
            </span>
            <small className={`cond whitespace-nowrap text-[11px] font-bold tracking-[0.06em] ${picked ? "text-plate-ink" : "text-board-muted"}`}>{n.label}</small>
          </span>
        ))}
      </span>
    </button>
  );
}

/** Playoff odds by final record, and the ways in: bullets when there's more than one. */
export function WhatItTakes({ board }: { board: TeamBoard }) {
  const best = board.records[0];
  return (
    <section aria-labelledby="takes" className="mb-8">
      <Heading id="takes" sub={board.recordsNote}>What it takes</Heading>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded bg-board-line sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
        {board.records.map((r) => (
          <div key={r.record} className={`flex flex-col gap-1 bg-board-deep px-4 pb-3.5 pt-3 text-board-muted ${r === best ? "shadow-[inset_0_3px_0_var(--color-lamp)]" : ""}`}>
            <span className={`cond text-[15px] font-bold tracking-[0.06em] ${r === best ? "text-lamp" : ""}`}>{r.label}</span>
            <span className="plate text-[34px] text-white">{r.playoffText}</span>
            {r.titleGameText && <span className="text-xs text-board-text">Title game <b className="font-bold text-white">{r.titleGameText}</b></span>}
            <span className="text-xs">{r.likely}</span>
          </div>
        ))}
      </div>
      {board.ways.length > 1 ? (
        <ul className="mt-3 flex flex-col gap-1 text-ink-soft">
          {board.ways.map((w) => (
            <li key={w.label} className="flex items-baseline gap-2">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 -translate-y-0.5 rounded-full bg-board" />
              <span><b className="font-semibold text-ink">{w.label}</b> <span className="plate text-lg text-ink">{w.oddsText}</span> {w.text}</span>
            </li>
          ))}
        </ul>
      ) : board.ways.length === 1 ? (
        <p className="mt-3 text-ink-soft"><b className="font-semibold text-ink">{board.ways[0].label}</b> <span className="plate text-lg text-ink">{board.ways[0].oddsText}</span> {board.ways[0].text}</p>
      ) : null}
    </section>
  );
}

const SITE = { home: "vs", away: "at", neutral: "vs" } as const;

/** A week's row: the game on the left, its results on the right (above them on narrow screens). */
function WeekRow({ date, game, tag, children }: { date: string; game: ReactNode; tag?: ReactNode; children?: ReactNode }) {
  return (
    <div className="grid gap-x-4 gap-y-2 border-board-line px-3 py-3 not-first:border-t sm:px-4 lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-center">
      <div className={`flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 lg:flex-col lg:items-start ${children ? "" : "lg:col-span-2"}`}>
        <span className="cond basis-full text-xs font-bold tracking-[0.06em] text-board-muted">{date}</span>
        <span className="cond text-lg font-bold leading-tight text-white">{game}</span>
        {tag}
      </div>
      {children}
    </div>
  );
}

function Pair({ children }: { children: ReactNode }) {
  return <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-2">{children}</div>;
}

const Tag = ({ children }: { children: ReactNode }) => (
  <span className="cond w-fit border border-board-muted px-1.5 text-[11px] font-bold tracking-[0.06em] text-board-muted">{children}</span>
);

/**
 * The team's own games, week by week: each result with the team's playoff and title-game odds if it happens. After
 * them, its conference title game, pickable once it's in the likeliest matchup.
 */
export function WeekByWeek({ weeks, outlook, board, teamId, team, names, locks, onPick, title, onTitle, labels }: {
  weeks: SeasonWeek[]; outlook: TeamOutlook; board: TeamBoard | null; teamId: number; team: string; names: Record<number, string>;
  locks: Locks; onPick: PickFn;
  /** The picked title-game winner, if any. */
  title: number | null; onTitle: (winner: number | undefined) => void;
  labels: { titleGame: string; playoff: string; projected: string; projectedNote: string };
}) {
  const odds = new Map(outlook.games.map((g) => [g.gameId, g]));
  const chances = new Map((board?.own ?? []).map((c) => [c.gameId, c]));
  const status = outlook.postseasonBan ? "eliminated" : "alive";
  const show = (p: number | undefined) => (p === undefined ? "—" : formatSideOdds(p, status));
  const pick = (gameId: number, winner: number) => onPick(gameId, locks[gameId] === winner ? undefined : winner);
  const result = (gameId: number, opponentId: number, opponent: string, titleWin?: string, titleLose?: string) => {
    const o = odds.get(gameId), c = chances.get(gameId);
    const nums = (playoff: number | undefined, titleText: string | undefined, titleP: number | undefined) =>
      [{ value: show(playoff), label: labels.playoff }, { value: titleText ?? show(titleP), label: labels.titleGame }];
    return (
      <Pair>
        <Outcome label={`${team} wins`} chance={c?.win} nums={nums(o?.playoffIfWin, titleWin, o?.titleIfWin)} picked={locks[gameId] === teamId} onClick={() => pick(gameId, teamId)} />
        <Outcome label={`${opponent} wins`} chance={c?.lose} nums={nums(o?.playoffIfLose, titleLose, o?.titleIfLose)} picked={locks[gameId] === opponentId} onClick={() => pick(gameId, opponentId)} />
      </Pair>
    );
  };
  const rows: ReactNode[] = [];
  for (const w of weeks) {
    if (w.played) {
      rows.push(
        <WeekRow key={`p${w.played.gameId}`} date={w.label} game={<>{SITE[w.played.site]} {w.played.opponent}</>}>
          <p className={`cond text-lg font-bold ${w.played.won ? "text-white" : "text-board-muted"}`}>{w.played.won ? "Won" : "Lost"} {w.played.score}</p>
        </WeekRow>,
      );
    }
    if (w.own) {
      const g = w.own;
      rows.push(
        <WeekRow key={g.gameId} date={w.label} game={<>{SITE[g.site]} <TeamName id={g.opponentId} name={g.opponent} /></>}>
          {result(g.gameId, g.opponentId, g.opponent, g.ifWin, g.ifLose)}
        </WeekRow>,
      );
    }
    const nc = w.nonConference;
    if (nc) {
      rows.push(
        <WeekRow key={`n${nc.gameId}`} date={nc.date} game={<>{SITE[nc.site]} <TeamName id={nc.opponentId} name={nc.opponent} /></>} tag={nc.projected
          ? <span title={labels.projectedNote} className="cond w-fit border border-dashed border-board-muted px-1.5 text-[11px] font-bold tracking-[0.06em] text-board-muted">{labels.projected}<span className="sr-only">: {labels.projectedNote}</span></span>
          : <Tag>Non-con</Tag>}>
          {nc.won !== null
            ? <p className={`cond text-lg font-bold ${nc.won ? "text-white" : "text-board-muted"}`}>{nc.won ? "Won" : "Lost"} {nc.score}</p>
            : result(nc.gameId, nc.opponentId, nc.opponent, nc.titleIfWin ?? undefined, nc.titleIfLose ?? undefined)}
        </WeekRow>,
      );
    }
  }
  const tw = board?.titleWeek;
  if (tw) {
    const [a, b] = tw.teams;
    rows.push(tw.mine ? (
      <WeekRow key="title" date={`Championship week · ${tw.label}`} game={<>vs <TeamName id={tw.mine.opponentId} name={names[tw.mine.opponentId]} /></>}
        tag={<span className="text-xs text-board-muted">Likeliest matchup with your picks</span>}>
        <Pair>
          <Outcome label={`${team} wins`} chance={tw.mine.winText} nums={[{ value: tw.mine.ifWin, label: labels.playoff }]} picked={title === teamId}
            onClick={() => onTitle(title === teamId ? undefined : teamId)} />
          <Outcome label={`${names[tw.mine.opponentId]} wins`} chance={tw.mine.loseText} nums={[{ value: tw.mine.ifLose, label: labels.playoff }]}
            picked={title === tw.mine.opponentId} onClick={() => onTitle(title === tw.mine!.opponentId ? undefined : tw.mine!.opponentId)} />
        </Pair>
      </WeekRow>
    ) : (
      <WeekRow key="title" date={`Championship week · ${tw.label}`}
        game={<span className="flex flex-wrap items-center gap-x-2"><TeamName id={a} name={names[a]} /><span className="text-board-muted">vs</span><TeamName id={b} name={names[b]} /></span>} />
    ));
  }
  return <div className="overflow-hidden rounded bg-board-deep text-board-text">{rows}</div>;
}

/** An independent's games: each result with its playoff odds. */
export function IndependentWeeks({ games, board, teamId, team, locks, onPick, labels }: {
  games: IndependentGame[]; board: TeamBoard | null; teamId: number; team: string; locks: Locks; onPick: PickFn; labels: { playoff: string };
}) {
  const chances = new Map((board?.own ?? []).map((c) => [c.gameId, c]));
  const pick = (gameId: number, winner: number) => onPick(gameId, locks[gameId] === winner ? undefined : winner);
  if (games.length === 0) return <p className="text-sm text-ink-muted">No games left.</p>;
  return (
    <div className="overflow-hidden rounded bg-board-deep text-board-text">
      {games.map((g) => (
        <WeekRow key={g.gameId} date={g.date} game={<>{g.site === "away" ? "at" : "vs"} <TeamName id={g.opponentId} name={g.opponent} /></>}>
          <Pair>
            <Outcome label={`${team} wins`} chance={chances.get(g.gameId)?.win} nums={[{ value: g.ifWin, label: labels.playoff }]} picked={locks[g.gameId] === teamId} onClick={() => pick(g.gameId, teamId)} />
            <Outcome label={`${g.opponent} wins`} chance={chances.get(g.gameId)?.lose} nums={[{ value: g.ifLose, label: labels.playoff }]} picked={locks[g.gameId] === g.opponentId} onClick={() => pick(g.gameId, g.opponentId)} />
          </Pair>
        </WeekRow>
      ))}
    </div>
  );
}

/** Games elsewhere that move the team's playoff odds, one card per team to root against. */
export function HelpElsewhere({ board, locks, onPick, labels }: { board: TeamBoard; locks: Locks; onPick: PickFn; labels: { titleGame: string; playoff: string } }) {
  const pick = (gameId: number, winner: number) => onPick(gameId, locks[gameId] === winner ? undefined : winner);
  return (
    <section aria-labelledby="help" className="mt-8">
      <Heading id="help" sub={board.helpNote}>Help from elsewhere</Heading>
      <div className="flex flex-col gap-4">
        {board.help.map((g: HelpGroup) => (
          <div key={g.teamId} className="overflow-hidden rounded bg-board-deep text-board-text">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 pb-2.5 pt-3.5 sm:px-4">
              <h3 className="cond text-[22px] font-extrabold text-white">Root against <TeamName id={g.teamId} name={g.team} /></h3>
              <span className="text-[13px] text-board-muted">{g.record}</span>
            </div>
            <div className="border-t border-board-line">
              {g.games.map((x) => (
                <WeekRow key={x.gameId} date={x.date} game={<>{x.site} <TeamName id={x.opponentId} name={x.opponent} /></>}>
                  <Pair>
                    {x.sides.map((s) => (
                      <Outcome key={s.teamId} small label={s.label} chance={s.chance} picked={locks[x.gameId] === s.teamId} onClick={() => pick(x.gameId, s.teamId)}
                        nums={[{ value: s.playoffText, label: labels.playoff, change: s.playoffChange }, ...(s.titleGameText ? [{ value: s.titleGameText, label: labels.titleGame }] : [])]} />
                    ))}
                  </Pair>
                </WeekRow>
              ))}
            </div>
          </div>
        ))}
      </div>
      {board.quiet && <p className="mt-2.5 text-[13px] text-ink-muted">{board.quiet}</p>}
    </section>
  );
}

/** A small heading in the rail, with an optional line under it. */
function RailHeading({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <h3 className="cond mb-2.5 text-lg font-extrabold tracking-[0.03em]">
      {children}
      {sub && <small className="block font-sans text-xs font-medium normal-case tracking-normal text-ink-muted">{sub}</small>}
    </h3>
  );
}

/** One row on a rail board; the page's team is the only one lit. */
function BoardRow({ lead, name, record, odds, me }: { lead?: ReactNode; name: ReactNode; record: string; odds: string; me: boolean }) {
  return (
    <div className={`cond grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2.5 px-3 py-1 text-[17px] font-bold ${me ? "text-white shadow-[inset_3px_0_0_var(--color-lamp)]" : "text-board-muted"}`}>
      <span className="flex min-w-0 items-center gap-1.5 truncate">{lead}{name}</span>
      <span className="text-[15px]">{record}</span>
      <span className={`plate min-w-[2.2em] text-right text-[19px] ${me ? "text-lamp" : ""}`}>{odds}</span>
    </div>
  );
}

/**
 * The playoff race: the projected field around the page's team. Seed on the left (with its automatic bid under it),
 * the projected final rank beside the name, the teams out dimmed under "Next in line". A Group of Six page leads with
 * its race for the Group of Six bid, then the at-large line.
 */
export function PlayoffRaceCard({ race, lab }: { race: PlayoffRace; lab: string }) {
  const blocks = [...(race.g6 ? [race.g6] : []), { title: race.title, items: race.items }];
  return (
    <section className="mb-7">
      <RailHeading sub={race.note}>Playoff race</RailHeading>
      <div className="flex flex-col gap-2">
        {blocks.map((b, k) => <RaceBlock key={k} title={b.title} items={b.items} columns={race.columns} />)}
      </div>
      <Link href={lab} className="mt-2 inline-block text-[13px] font-semibold text-ink underline underline-offset-[3px]">The whole field in the Lab →</Link>
    </section>
  );
}

/** One board of the race card: an optional title, the column headings, then its rows and lines. */
function RaceBlock({ title, items, columns }: { title: string | null; items: RaceItem[]; columns: string[] }) {
  const cols = "grid grid-cols-[1.6rem_minmax(0,1fr)_1.7rem_2.5rem] items-center gap-1.5 px-3";
  const line = (label: string, cut: boolean) => (
    <div className={`relative mx-3 my-1.5 border-t border-dashed ${cut ? "border-lamp" : "border-board-line"}`}>
      <span className={`cond absolute -top-[9px] right-0 bg-board-deep pl-1.5 text-[11px] font-bold tracking-[0.08em] ${cut ? "text-lamp" : "text-board-muted"}`}>{label}</span>
    </div>
  );
  return (
    <div className="rounded bg-board-deep py-1.5">
      {title && <h3 className="cond px-3 pb-0.5 pt-1 text-[13px] font-extrabold tracking-[0.07em] text-white">{title}</h3>}
      <div aria-hidden className={`${cols} cond mb-0.5 border-b border-board-line pb-1.5 pt-1 text-[11px] font-bold tracking-[0.08em] text-board-muted`}>
        {columns.map((c, k) => <span key={c} className={k === 2 ? "text-center" : k === 3 ? "text-right" : ""}>{c}</span>)}
      </div>
      {items.map((x, k) => {
        if (x.kind === "bye" || x.kind === "bid") return <div key={k}>{line(x.label, false)}</div>;
        if (x.kind === "cut") return <div key={k}>{line(x.label, true)}</div>;
        if (x.kind === "gap") return <div key={k} aria-hidden className="px-3 leading-none text-board-muted">⋯</div>;
        if (x.kind === "next") return <div key={k} className="cond px-3 pt-1 text-[11px] font-bold tracking-[0.09em] text-board-muted">{x.label}</div>;
        const out = x.seed === null;
        const edge = x.me ? "shadow-[inset_3px_0_0_var(--color-lamp)]" : x.under ? "bg-white/[0.035] shadow-[inset_3px_0_0_var(--color-board-line)]" : "";
        const tone = x.me ? "text-lamp" : out ? "text-board-muted" : "text-white";
        return (
          <div key={x.teamId} className={`${cols} cond min-h-9 py-1 font-bold ${edge}`}>
            <span className="flex flex-col gap-0.5 text-sm leading-none text-board-muted">
              {x.seed}
              {x.tag && <span title="Automatic bid" className="text-[9.5px] tracking-[0.06em] text-board-text">{x.tag}</span>}
            </span>
            <span className={`min-w-0 truncate text-base ${tone}`}><TeamName id={x.teamId} name={x.team} /></span>
            <span className="text-center text-[15px] text-board-muted">{x.projected}</span>
            <span className={`plate text-right text-lg ${tone}`}>{x.text}</span>
          </div>
        );
      })}
    </div>
  );
}

/** The conference title race: title-game odds, the five likeliest and the team. */
export function ConferenceRace({ outlook, names, teamId, label, sub }: { outlook: TeamOutlook[]; names: Record<number, string>; teamId: number; label: string; sub: string }) {
  const key = (o: TeamOutlook) => (o.status === "clinched" ? 2 : o.status === "eliminated" ? -1 : o.titleGame);
  const race = [...outlook].sort((a, b) => key(b) - key(a) || names[a.teamId].localeCompare(names[b.teamId]));
  const top = race.slice(0, 5);
  const me = race.find((o) => o.teamId === teamId)!;
  const rows = top.includes(me) ? top : [...top, me];
  return (
    <section className="mb-7">
      <RailHeading sub={sub}>{label}</RailHeading>
      <div className="rounded bg-board-deep py-1.5">
        {rows.map((o) => (
          <BoardRow key={o.teamId} name={<TeamName id={o.teamId} name={names[o.teamId]} />} record={`${o.record.conferenceWins}-${o.record.conferenceLosses}`}
            odds={formatTitleOdds(o.titleGame, o.status)} me={o.teamId === teamId} />
        ))}
      </div>
    </section>
  );
}

/** The picks so far, each removable, with Share, the Lab and Reset. */
export function YourPicks({ picks, lab, onRemove, onReset }: {
  picks: { id: string; what: string; when: string }[]; lab: string; onRemove: (id: string) => void; onReset: () => void;
}) {
  return (
    <section className="mb-7 text-sm">
      <RailHeading>Your picks</RailHeading>
      {picks.length === 0 ? <p className="text-ink-muted">Nothing locked yet.</p> : (
        <ul>
          {picks.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 border-rule py-1.5 not-first:border-t">
              <span className="min-w-0">{p.what} <span className="text-ink-muted">· {p.when}</span></span>
              <button type="button" aria-label={`Remove ${p.what}`} onClick={() => onRemove(p.id)} className="h-8 w-8 shrink-0 rounded text-ink-muted hover:bg-paper">×</button>
            </li>
          ))}
        </ul>
      )}
      {picks.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <ShareButton small />
          <Link href={lab} className="cond flex h-9 items-center rounded-[3px] border border-rule bg-white px-3 text-[15px] font-bold tracking-[0.05em] hover:border-ink-muted">Open in Lab</Link>
          <button type="button" onClick={onReset} className="cond h-9 rounded-[3px] border border-rule bg-white px-3 text-[15px] font-bold tracking-[0.05em] hover:border-ink-muted">Reset</button>
        </div>
      )}
    </section>
  );
}

/**
 * The best shot: the likeliest way in, step by step, with the playoff odds when it all happens. Each step lights green
 * as your picks complete it and rings red when one goes against it.
 */
export function BestShotCard({ shot, locks, filled, onFill, lab }: { shot: BestShot; locks: Locks; filled: boolean; onFill: () => void; lab: string }) {
  const state = (s: BestShot["steps"][number]) =>
    s.results.length === 0 ? "open"
      : s.results.some((x) => locks[x.gameId] !== undefined && locks[x.gameId] !== x.winner) ? "off" : s.results.every((x) => locks[x.gameId] === x.winner) ? "done" : "open";
  const off = shot.steps.some((s) => state(s) === "off");
  let k = 0;
  const value = (v: string, add: string | null, lit: boolean, dim: boolean) => (
    <span className={`plate text-right text-xl ${dim ? "text-board-muted" : lit ? "text-lamp" : "text-white"}`}>
      {v}
      {add && <small className={`mt-0.5 block font-sans text-[11px] font-semibold ${add.startsWith("+") ? "text-root" : "text-board-muted"}`}>{add}</small>}
    </span>
  );
  return (
    <section aria-labelledby="shot" className="mt-8">
      <Heading id="shot" sub={shot.sub}>{shot.title}</Heading>
      <div className="rounded bg-board-deep px-4 pb-3.5 pt-3.5 text-board-text">
        <p className="cond text-xl font-extrabold leading-tight text-white md:text-[26px]">{shot.headline}</p>
        <div role="table" className="mt-2.5 grid grid-cols-[minmax(0,1fr)_4.25rem_4.25rem] gap-x-2.5">
          <div role="row" className="contents">
            {shot.columns.map((c, i) => (
              <span role="columnheader" key={c} className={`cond pb-1.5 text-[11px] font-bold tracking-[0.08em] text-board-muted ${i > 0 ? "text-right" : ""}`}>{c}</span>
            ))}
          </div>
          {shot.steps.map((s) => {
            const st = state(s), today = s.kind === "today", end = s.kind === "title";
            const n = today ? "" : String(++k);
            return (
              <div role="row" key={s.text} className="contents">
                <div role="cell" className="flex items-start gap-2.5 border-t border-board-line py-2.5">
                  <span aria-label={st === "done" ? "Picked" : st === "off" ? "Off this path" : undefined}
                    className={`plate mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-[2px] text-[15px] ${
                      today ? "border border-board-line text-board-muted" : st === "off" ? "border-2 border-hurt text-white" : st === "done" || end ? "bg-lamp text-plate-ink" : "bg-board-muted text-plate-ink"}`}>{n}</span>
                  <span className="min-w-0">
                    <b className={`cond block text-[17px] font-bold leading-tight ${today ? "text-board-muted" : "text-white"}`}>{s.text}</b>
                    {s.detail && <i className="mt-0.5 block text-xs not-italic text-board-muted">{s.detail}</i>}
                  </span>
                </div>
                <div role="cell" className="border-t border-board-line py-2.5 text-right">{value(s.titleGame, s.titleAdd, end, today)}</div>
                <div role="cell" className="border-t border-board-line py-2.5 text-right">{value(s.playoff, s.playoffAdd, end, today)}</div>
              </div>
            );
          })}
        </div>
        <p className="border-t border-board-line pt-2.5 text-xs text-board-muted">{off ? shot.left : shot.note}</p>
        <span className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={onFill} className={`cond h-10 rounded-[3px] px-4 text-[17px] font-bold tracking-[0.05em] ${filled ? "border border-lamp text-lamp hover:bg-lamp hover:text-plate-ink" : "bg-lamp text-plate-ink hover:brightness-105"}`}>{filled ? "Undo this path" : shot.fill}</button>
          <Link href={lab} className="cond flex h-10 items-center gap-1.5 rounded-[3px] border border-board-line px-3.5 text-[17px] font-bold tracking-[0.05em] text-board-text hover:border-board-muted">Try it in the Lab <span aria-hidden className="text-lamp">→</span></Link>
        </span>
      </div>
    </section>
  );
}
