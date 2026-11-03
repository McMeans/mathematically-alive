"use client";
import { useState } from "react";
import { formatRecord, formatSideOdds, formatTitleOdds, oddsLabels, type Impact, type SeasonWeek, type TeamOutlook } from "@/core";
import { CONFERENCE } from "@/app/config";
import type { Locks, TeamInfo } from "./Explorer";
import { Beta, playoffText } from "./Panels";

const LABELS = oddsLabels(CONFERENCE);
type PickState = "picked" | "likely" | "open";

const label = "text-[11px] font-semibold uppercase tracking-wide text-ink-muted";

type PickFn = (gameId: number, winner: number | undefined) => void;

/**
 * The rest of the season as week columns. Every button shows the team's odds if that result happens,
 * given the picks so far; a green outline marks the likeliest way in, navy a locked pick.
 */
export function SeasonWeeks({ weeks, base, teamId, locks, likely, onPick }: {
  weeks: SeasonWeek[];
  /** The same weeks with no picks. Which games each week lists, and in what order, comes from here, so picks never add or move games. */
  base: SeasonWeek[];
  teamId: number;
  locks: Locks;
  likely: Map<number, number>;
  onPick: PickFn;
}) {
  return (
    <section aria-label="Week by week" className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p className={label}>Week by week · pick any result</p>
        <p className="text-xs text-ink-muted">Each button shows the odds if it happens.</p>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-soft" aria-label="How much a result helps">
        <span>Helps / hurts:</span>
        {(["big", "some", "small"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1">
            <span className={`h-3 w-2.5 rounded-l-sm ${TINT.helps[k]}`} />
            <span className={`-ml-1 h-3 w-2.5 rounded-r-sm ${TINT.hurts[k]}`} />
            {k === "big" ? "a lot" : k === "some" ? "some" : "a little"}
          </span>
        ))}
        <span className="flex items-center gap-1"><span className="h-3 w-5 rounded-sm outline-dashed outline-[1.5px] -outline-offset-[1.5px] outline-navy/80" />likeliest way</span>
      </div>
      <ol className="scroll-thin mt-2 flex gap-2 overflow-x-auto pb-2 md:grid md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] md:overflow-visible">
        {weeks.map((w) => (
          <Week key={w.week} w={w} base={base.find((b) => b.week === w.week) ?? w} teamId={teamId} locks={locks} likely={likely} onPick={onPick} />
        ))}
      </ol>
    </section>
  );
}

function Week({ w, base, teamId, locks, likely, onPick }: { w: SeasonWeek; base: SeasonWeek; teamId: number; locks: Locks; likely: Map<number, number>; onPick: PickFn }) {
  const [all, setAll] = useState(false);
  // Listed: what mattered with no picks, plus anything locked, in that order, so picks never add or move games.
  // A game your picks have made neutral (either result, same odds) drops out of the list.
  const live = new Map(w.games.map((g) => [g.gameId, g]));
  const neutral = (id: number) => { const g = live.get(id); return !g || (locks[id] === undefined && g.helps === null && g.likely === null); };
  const listed = base.games.filter((g) => (g.matters || locks[g.gameId] !== undefined) && !neutral(g.gameId)).map((g) => g.gameId);
  const rest = base.games.filter((g) => !listed.includes(g.gameId)).map((g) => g.gameId);
  const games = (all ? [...listed, ...rest] : listed).flatMap((id) => live.get(id) ?? []);
  const hidden = all ? 0 : rest.length;
  // Hidden games your picks have made worth a look.
  const rising = all ? 0 : rest.filter((id) => { const g = live.get(id); return g?.impact === "big" || g?.impact === "some"; }).length;
  const own = w.own;
  const side = (gameId: number, winner: number, likelyWinner: number | null) =>
    locks[gameId] === winner ? "picked" : locks[gameId] === undefined && likelyWinner === winner ? "likely" : "open";
  const state = (gameId: number, winner: number) =>
    locks[gameId] === winner ? "picked" : locks[gameId] === undefined && likely.get(gameId) === winner ? "likely" : "open";
  return (
    <li className="flex w-40 shrink-0 flex-col gap-1.5 md:w-auto">
      <span className="text-xs font-semibold text-ink-muted">{w.label}</span>
      {own ? (
        <PickTable
          vs={`${own.site === "away" ? "at" : "vs"} ${own.opponent}`} winChance={own.winChance} cfp={own.cfpIfWin !== null}
          win={{ conf: own.ifWin, cfp: own.cfpIfWin, state: state(own.gameId, teamId), onClick: () => onPick(own.gameId, teamId) }}
          lose={{ conf: own.ifLose, cfp: own.cfpIfLose, state: state(own.gameId, own.opponentId), onClick: () => onPick(own.gameId, own.opponentId) }}
        />
      ) : w.played || w.nonConference ? null : (
        <span className={`flex items-center justify-center rounded-lg border border-dashed border-navy/20 px-2 text-xs text-ink-muted ${CARD_H}`}>No game this week</span>
      )}
      {w.played && <Final played={w.played} />}
      {w.nonConference && (
        <NonConference game={w.nonConference} win={state(w.nonConference.gameId, teamId)} lose={state(w.nonConference.gameId, w.nonConference.opponentId)}
          onWin={() => onPick(w.nonConference!.gameId, teamId)} onLose={() => onPick(w.nonConference!.gameId, w.nonConference!.opponentId)} />
      )}
      <div className="flex grow flex-col gap-1 rounded-lg bg-mist p-1.5">
        <span className="px-0.5 text-[11px] font-semibold text-ink-muted">Elsewhere</span>
        {games.map((g) => (
          <div key={g.gameId} role="group" aria-label={`${g.home} vs ${g.away}`} className="grid animate-rise grid-cols-2 gap-0.5 rounded-md bg-white p-0.5">
            <SideButton team={g.home} odds={g.ifHome} effect={effectOf(g, g.homeId)} state={side(g.gameId, g.homeId, g.likely)} onClick={() => onPick(g.gameId, g.homeId)} />
            <SideButton team={g.away} odds={g.ifAway} effect={effectOf(g, g.awayId)} state={side(g.gameId, g.awayId, g.likely)} onClick={() => onPick(g.gameId, g.awayId)} />
          </div>
        ))}
        {listed.length === 0 && !all && <span className="px-0.5 text-[11px] text-ink-muted">Nothing elsewhere changes the odds</span>}
        {hidden > 0 && (
          <button type="button" onClick={() => setAll(true)} className="self-start px-0.5 text-left text-[11px] text-ink-muted">
            <span className="font-bold text-navy underline">{hidden} more</span>
            {rising > 0 ? (
              <span className="text-turf"> · <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-turf align-middle" /> {rising} now matter{rising === 1 ? "s" : ""}</span>
            ) : (
              " that barely matter"
            )}
          </button>
        )}
      </div>
    </li>
  );
}

// Every card in a week's first slot is the height of the Win/Lose table, so the weeks line up.
const CARD_H = "h-[7.5rem]";

/** The team's game this week that's already final. */
function Final({ played }: { played: NonNullable<SeasonWeek["played"]> }) {
  return <FinalCard vs={`${played.site === "away" ? "at" : "vs"} ${played.opponent}`} won={played.won} score={played.score} />;
}

/** A final result, laid out like the Win/Lose table: opponent top left, the result in the middle, the Non-con tag bottom left. */
function FinalCard({ vs, won, score, nonConference }: { vs: string; won: boolean; score: string; nonConference?: boolean }) {
  return (
    <div className={`flex flex-col justify-between rounded-lg border border-navy/15 bg-white p-1.5 ${CARD_H}`}>
      <span className="flex h-4 items-center justify-between gap-1 px-0.5 text-[11px] text-ink-muted">
        <span className="truncate">{vs}</span><span className="shrink-0">Final</span>
      </span>
      <span className={`px-0.5 font-display text-xl font-bold ${won ? "text-turf" : "text-marker-text"}`}>
        {won ? "Won" : "Lost"} {score}
      </span>
      <span className="flex h-4 items-center px-0.5">
        {nonConference && <span className="whitespace-nowrap rounded border border-navy/20 px-1 text-[10px] leading-4 text-ink-muted">{LABELS.nonConference}</span>}
      </span>
    </div>
  );
}

/** The team's non-conference game that week: pickable with its playoff odds either way, or the result once it's final. */
function NonConference({ game, win, lose, onWin, onLose }: {
  game: NonNullable<SeasonWeek["nonConference"]>; win: PickState; lose: PickState; onWin: () => void; onLose: () => void;
}) {
  const vs = `${game.site === "away" ? "at" : "vs"} ${game.opponent}`;
  if (!game.score)
    return (
      <PickTable vs={vs} winChance={game.winChance} cfp nonConference
        win={{ conf: null, cfp: game.ifWin, state: win, onClick: onWin }} lose={{ conf: null, cfp: game.ifLose, state: lose, onClick: onLose }} />
    );
  return <FinalCard vs={vs} won={game.won!} score={game.score} nonConference />;
}

/**
 * Best title-game odds first. Proven in goes above everything and proven out below everything, so a team
 * still alive at 0% in the sample ("<0.1%") stays above every team that's out. Ties go alphabetical.
 */
export function byOdds(names: Record<number, string>) {
  const key = (o: TeamOutlook) => (o.status === "clinched" ? 2 : o.status === "eliminated" ? -1 : o.titleGame);
  return (a: TeamOutlook, b: TeamOutlook) => key(b) - key(a) || names[a.teamId].localeCompare(names[b.teamId]);
}

const sideOdds = (p: number, o: TeamOutlook) => formatSideOdds(p, o.status);
const titleOdds = (o: TeamOutlook) => formatTitleOdds(o.titleGame, o.status);

// In / Out on the navy own-game card, light enough to read there.
const darkTone = (odds: string) => (odds === "In" ? "font-bold text-[#8FE3B4]" : odds === "Out" ? "font-bold text-[#F6B08C]" : "");

type PickRow = { conf: string | null; cfp: string | null; state: PickState; onClick: () => void };

// Win and Lose rows under ACC and CFP columns, the same shape for every game so the weeks line up.
// `conf` null: a non-conference game, which can't move the title odds ("—"). `cfp` false: no CFP column.
function PickTable({ vs, winChance, cfp, nonConference, win, lose }: {
  vs: string; winChance: string | null; cfp: boolean; nonConference?: boolean; win: PickRow; lose: PickRow;
}) {
  const cols = cfp ? "grid-cols-[1fr_2.75rem_2.75rem]" : "grid-cols-[1fr_2.75rem]";
  const row = (text: string, r: PickRow) => {
    const look = r.state === "picked" ? "bg-turf text-white" : r.state === "likely" ? "bg-white/10 text-white outline-dashed outline-1 -outline-offset-2 outline-white/60 hover:bg-white/20" : "bg-white/10 text-white hover:bg-white/20";
    const label = [r.conf && `${LABELS.conference} ${r.conf}`, r.cfp && `${LABELS.cfp} ${r.cfp}`].filter(Boolean).join(", ");
    return (
      <button type="button" aria-label={`${text}: ${label}`} aria-pressed={r.state === "picked"} onClick={r.onClick} className={`press grid h-8 items-center rounded-md px-2 text-xs ${cols} ${look}`}>
        <span className="text-left font-bold">{text}</span>
        <span className={`text-right ${r.conf === null ? "text-white/50" : r.state === "picked" ? "" : darkTone(r.conf)}`}>{r.conf ?? "—"}</span>
        {cfp && <span className={`text-right ${r.conf === null ? "" : "text-white/70"}`}>{r.cfp ?? "—"}</span>}
      </button>
    );
  };
  return (
    <div role="group" aria-label={nonConference ? `${vs}, non-conference` : vs} className={`flex flex-col gap-1 rounded-lg bg-navy p-1.5 ${CARD_H}`}>
      <span className={`grid h-4 items-center pl-0.5 pr-2 text-[10px] text-white/60 ${cols}`}>
        <span className="truncate text-[11px] text-white/75">{vs}</span>
        <span className="text-right">{LABELS.conference}</span>
        {cfp && <span className="text-right">{LABELS.cfp}</span>}
      </span>
      {row("Win", win)}
      {row("Lose", lose)}
      <span className="flex h-4 items-center justify-between gap-1 px-0.5 text-[11px] text-white/75">
        <span>{nonConference && <span className="whitespace-nowrap rounded border border-white/40 px-1 text-[10px] leading-4">{LABELS.nonConference}</span>}</span>
        {winChance && <span className="shrink-0">{winChance}</span>}
      </span>
    </div>
  );
}

// The side that helps the team is tinted green and the side that hurts it red, deeper the more it moves
// the odds. Light tints with navy text, so only a picked result (solid navy) reads as selected.
type Effect = { kind: "helps" | "hurts"; impact: Impact };
const TINT: Record<Effect["kind"], Record<Impact, string>> = {
  helps: { big: "bg-turf/40", some: "bg-turf/20", small: "bg-turf/10" },
  hurts: { big: "bg-red-600/30", some: "bg-red-600/15", small: "bg-red-600/[0.07]" },
};
const ODDS_TEXT: Record<Effect["kind"], string> = { helps: "text-turf", hurts: "text-red-700" };

/** Whether this winner helps or hurts the team, and how much; null when the game doesn't move its odds. */
function effectOf(g: SeasonWeek["games"][number], winner: number): Effect | null {
  if (g.helps === null || g.impact === null) return null;
  return { kind: g.helps === winner ? "helps" : "hurts", impact: g.impact };
}

function SideButton({ team, odds, effect, state, onClick }: {
  team: string;
  odds: string;
  effect: Effect | null;
  state: "picked" | "likely" | "open";
  onClick: () => void;
}) {
  const tint = effect ? `${TINT[effect.kind][effect.impact]} text-navy` : "text-ink-soft hover:bg-mist";
  const look = state === "picked" ? "bg-navy text-white" : `${tint} ${state === "likely" ? "outline-dashed outline-[1.5px] -outline-offset-[1.5px] outline-navy/80" : ""}`;
  const oddsLook =
    state === "picked" ? "font-bold text-white"
    : effect && effect.impact !== "small" ? `font-bold ${ODDS_TEXT[effect.kind]}`
    : "text-ink-muted";
  return (
    <button type="button" aria-label={`${team} wins: ${odds}${effect ? `, ${effect.kind} (${effect.impact})` : ""}`} aria-pressed={state === "picked"} onClick={onClick} className={`press flex min-h-9 min-w-0 flex-col items-start rounded px-1.5 py-0.5 text-left text-[11px] font-semibold ${look}`}>
      <span className="line-clamp-2 w-full break-words leading-tight">{team}</span>
      <span className={oddsLook}>{odds}</span>
    </button>
  );
}

/** The right column: odds with the picks so far, the race projected from them, and the picks themselves. */
export function WhatIf({ team, me, outlook, today, locks, weeks, names, teamId, onPick, onReset }: {
  team: TeamInfo;
  me: TeamOutlook;
  outlook: TeamOutlook[];
  today: TeamOutlook;
  locks: Locks;
  weeks: SeasonWeek[];
  names: Record<number, string>;
  teamId: number;
  onPick: PickFn;
  onReset: () => void;
}) {
  // Every pick is in some week: the team's own game (conference or not) or a locked game elsewhere.
  const picks = weeks.flatMap((w) => {
    const out: { id: number; what: string; when: string }[] = [];
    if (w.own && locks[w.own.gameId] !== undefined) {
      out.push({ id: w.own.gameId, what: locks[w.own.gameId] === teamId ? `Beat ${w.own.opponent}` : `Lose to ${w.own.opponent}`, when: w.label });
    }
    const nc = w.nonConference;
    if (nc && locks[nc.gameId] !== undefined) {
      out.push({ id: nc.gameId, what: locks[nc.gameId] === teamId ? `Beat ${nc.opponent}` : `Lose to ${nc.opponent}`, when: nc.date });
    }
    for (const g of w.games) {
      const winner = locks[g.gameId];
      if (winner === undefined) continue;
      out.push({ id: g.gameId, what: winner === g.homeId ? `${g.home} over ${g.away}` : `${g.away} over ${g.home}`, when: w.label });
    }
    return out;
  });
  const has = picks.length > 0;
  const race = [...outlook].sort(byOdds(names));
  const top = race.slice(0, 5);
  const place = race.findIndex((o) => o.teamId === teamId);
  const verdict = titleOdds(me);
  return (
    <div className="flex flex-col tall:min-h-0 tall:flex-1">
      {/* On tall screens name, record, Reset and the odds stay fixed above a divider and only the race and picks scroll;
          on short ones the whole column scrolls so the list isn't squeezed. */}
      <div className="flex flex-col gap-5 border-b border-ink-muted/25 p-5 xl:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-2xl font-bold">{team.name}</h2>
            <p className="text-sm text-ink-soft">
              {formatRecord(me.record, CONFERENCE)}{has && " with your picks"}
            </p>
          </div>
          {has && (
            <button type="button" onClick={onReset} className="press flex h-8 shrink-0 animate-rise items-center gap-1.5 rounded-full bg-marker-text px-3 text-xs font-bold text-white hover:bg-marker">
              <span aria-hidden>↺</span> Reset
            </button>
          )}
        </div>

        <section className="flex flex-col gap-3 rounded-xl bg-mist p-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-ink-muted">{has ? `${LABELS.titleGame}, with your picks` : LABELS.titleGame}</p>
              <p key={verdict} className={`animate-rise font-display text-5xl font-bold leading-none ${me.titleGame >= 0.5 || me.status === "clinched" ? "text-turf" : "text-marker-text"}`}>{verdict}</p>
            </div>
            {has && <p className="text-xs text-ink-muted">Today {titleOdds(today)}</p>}
          </div>
          <div className="flex flex-col gap-1 border-t border-navy/10 pt-2 text-sm text-ink-soft">
            <p className="flex justify-between">{LABELS.champion}<span className="font-bold text-navy">{sideOdds(me.champion, me)}</span></p>
            <p className="flex justify-between"><span className="flex items-center gap-1">{LABELS.playoff}<Beta /></span><span className="font-bold text-navy">{playoffText(me, sideOdds(me.playoff, me))}</span></p>
          </div>
        </section>
      </div>
      <div className="scroll-thin flex flex-col gap-5 p-5 xl:p-6 tall:min-h-0 tall:flex-1 tall:overflow-y-auto">
        <section className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <p className={label}>The race</p>
            <p className="text-[11px] text-ink-muted">{has ? "Projected with your picks" : "Projected"}</p>
          </div>
          {top.map((o) => <RaceRow key={o.teamId} o={o} name={names[o.teamId]} me={o.teamId === teamId} />)}
          {place >= top.length && (
            <div className="mt-1 flex items-center gap-2">
              <span className="w-5 text-xs text-ink-muted">{place + 1}</span>
              <div className="min-w-0 flex-1"><RaceRow o={me} name={names[teamId]} me /></div>
            </div>
          )}
        </section>
        <section className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <p className={label}>Your picks</p>
          </div>
          {has ? (
            picks.map((p) => (
              <div key={p.id} className="flex animate-rise items-center justify-between gap-2 rounded-lg border border-navy/10 px-2.5 py-1.5">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold">{p.what}</span>
                  <span className="text-[11px] text-ink-muted">{p.when}</span>
                </span>
                <button type="button" aria-label={`Remove ${p.what}`} onClick={() => onPick(p.id, undefined)} className="h-8 w-8 shrink-0 rounded text-ink-muted hover:bg-mist">
                  ×
                </button>
              </div>
            ))
          ) : (
            <p className="text-xs text-ink-muted">Pick results in the weeks to see what they do.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function RaceRow({ o, name, me }: { o: TeamOutlook; name: string; me: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-md px-1.5 py-1 ${me ? "bg-mist" : ""}`}>
      <span className="w-28 truncate text-sm font-semibold">{name}</span>
      <span className="w-8 text-xs text-ink-muted" title={LABELS.conferenceRecord}>{o.record.conferenceWins}-{o.record.conferenceLosses}</span>
      <span className="h-1.5 flex-1 rounded-full bg-navy/10">
        <span className={`block h-1.5 rounded-full transition-[width] duration-500 ease-out ${me ? "bg-marker" : "bg-navy"}`} style={{ width: `${Math.max(3, Math.round(o.titleGame * 100))}%` }} />
      </span>
      <span className="w-10 text-right text-xs font-bold">{titleOdds(o)}</span>
    </div>
  );
}
