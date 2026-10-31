"use client";
import { useState } from "react";
import { formatFine, type Impact, type SeasonWeek, type TeamOutlook } from "@/core";
import type { Locks, TeamInfo } from "./Explorer";

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
        <span>Helps:</span>
        <span className="flex items-center gap-1"><span className="h-3 w-5 rounded-sm bg-turf" />a lot</span>
        <span className="flex items-center gap-1"><span className="h-3 w-5 rounded-sm bg-turf/30" />some</span>
        <span className="flex items-center gap-1"><span className="h-3 w-5 rounded-sm bg-turf/10" />a little</span>
        <span className="flex items-center gap-1"><span className="h-3 w-5 rounded-sm ring-2 ring-inset ring-navy" />likeliest way</span>
      </div>
      <ol className="scroll-thin mt-2 flex gap-2 overflow-x-auto pb-2 md:grid md:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] md:overflow-visible">
        {weeks.map((w) => (
          <Week key={w.week} w={w} base={base.find((b) => b.week === w.week) ?? w} teamId={teamId} locks={locks} likely={likely} onPick={onPick} />
        ))}
      </ol>
    </section>
  );
}

function Week({ w, base, teamId, locks, likely, onPick }: { w: SeasonWeek; base: SeasonWeek; teamId: number; locks: Locks; likely: Map<number, number>; onPick: PickFn }) {
  const [all, setAll] = useState(false);
  // Listed: what mattered with no picks, plus anything locked. Odds come from the live run; the list doesn't change.
  const live = new Map(w.games.map((g) => [g.gameId, g]));
  const listed = base.games.filter((g) => g.matters || locks[g.gameId] !== undefined).map((g) => g.gameId);
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
        <div role="group" aria-label={`${own.site === "away" ? "at" : "vs"} ${own.opponent}`} className="flex flex-col gap-1 rounded-lg bg-navy p-1.5">
          <span className="px-0.5 text-[11px] text-white/75">{own.site === "away" ? "at" : "vs"} {own.opponent}</span>
          <OwnButton text="Win" odds={own.ifWin} state={state(own.gameId, teamId)} onClick={() => onPick(own.gameId, teamId)} />
          <OwnButton text="Lose" odds={own.ifLose} state={state(own.gameId, own.opponentId)} onClick={() => onPick(own.gameId, own.opponentId)} />
        </div>
      ) : w.played ? null : (
        <span className="rounded-lg border border-dashed border-navy/20 px-2 py-2 text-xs text-ink-muted">No game this week</span>
      )}
      {w.played && <Final played={w.played} />}
      <div className="flex grow flex-col gap-1 rounded-lg bg-mist p-1.5">
        <span className="px-0.5 text-[11px] font-semibold text-ink-muted">Elsewhere</span>
        {games.map((g) => (
          <div key={g.gameId} role="group" aria-label={`${g.home} vs ${g.away}`} className="grid grid-cols-2 gap-0.5 rounded-md bg-white p-0.5">
            <SideButton team={g.home} odds={g.ifHome} impact={g.helps === g.homeId ? g.impact : null} state={side(g.gameId, g.homeId, g.likely)} onClick={() => onPick(g.gameId, g.homeId)} />
            <SideButton team={g.away} odds={g.ifAway} impact={g.helps === g.awayId ? g.impact : null} state={side(g.gameId, g.awayId, g.likely)} onClick={() => onPick(g.gameId, g.awayId)} />
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

/** The team's game this week that's already final. */
function Final({ played }: { played: NonNullable<SeasonWeek["played"]> }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-navy/15 bg-white px-2 py-1.5">
      <span className="text-[11px] text-ink-muted">Final · {played.site === "away" ? "at" : "vs"} {played.opponent}</span>
      <span className={`text-sm font-bold ${played.won ? "text-turf" : "text-marker-text"}`}>
        {played.won ? "Won" : "Lost"} {played.score}
      </span>
    </div>
  );
}

/** Title-game odds for display: In or Out when proven; a team still alive at 0% in the sample shows as under 0.1%. */
/** Any other odds of a team: a team still alive at 0% in the sample shows as under 0.1%, one that's out as 0%. */
const sideOdds = (p: number, o: TeamOutlook) => (p === 0 && o.status !== "eliminated" ? "<0.1%" : formatFine(p));

const titleOdds = (o: TeamOutlook) =>
  o.status === "clinched" ? "In" : o.status === "eliminated" ? "Out" : o.titleGame === 0 ? "<0.1%" : formatFine(o.titleGame);

const tone = (odds: string) => (odds === "In" ? "text-turf" : odds === "Out" ? "text-marker-text" : "");

function OwnButton({ text, odds, state, onClick }: { text: string; odds: string; state: "picked" | "likely" | "open"; onClick: () => void }) {
  const look =
    state === "picked" ? "bg-turf text-white" : state === "likely" ? "bg-white text-navy ring-2 ring-inset ring-turf" : "bg-white/10 text-white hover:bg-white/20";
  return (
    <button type="button" aria-label={`${text}: ${odds}`} aria-pressed={state === "picked"} onClick={onClick} className={`flex min-h-8 items-center justify-between rounded-md px-2 text-xs font-bold ${look}`}>
      {text}
      <span className={`font-normal ${state === "picked" ? "" : tone(odds)}`}>{odds}</span>
    </button>
  );
}

// The side that helps the team is tinted green, deeper the more it moves the odds.
const TINT: Record<Impact, string> = { big: "bg-turf text-white", some: "bg-turf/30 text-navy", small: "bg-turf/10 text-navy" };

function SideButton({ team, odds, impact, state, onClick }: {
  team: string;
  odds: string;
  impact: Impact | null;
  state: "picked" | "likely" | "open";
  onClick: () => void;
}) {
  const tint = impact ? TINT[impact] : "hover:bg-mist";
  const look =
    state === "picked" ? "bg-navy text-white" : `${tint} ${impact ? "" : "text-ink-soft"} ${state === "likely" ? "ring-2 ring-inset ring-navy" : ""}`;
  const oddsLook =
    state === "picked" || impact === "big" ? "font-bold text-white" : impact === "some" || state === "likely" ? "font-bold text-turf" : "text-ink-muted";
  return (
    <button type="button" aria-label={`${team} wins: ${odds}${impact ? `, helps (${impact})` : ""}`} aria-pressed={state === "picked"} onClick={onClick} className={`flex min-h-9 min-w-0 flex-col items-start rounded px-1.5 py-0.5 text-left text-[11px] font-semibold ${look}`}>
      <span className="w-full truncate">{team}</span>
      <span className={oddsLook}>{odds}</span>
    </button>
  );
}

/** The right column: odds with the picks so far, the picks themselves, and the race projected from them. */
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
  // Every pick is in some week: the team's own game or a locked game elsewhere.
  const picks = weeks.flatMap((w) => {
    const out: { id: number; what: string; when: string }[] = [];
    if (w.own && locks[w.own.gameId] !== undefined) {
      out.push({ id: w.own.gameId, what: locks[w.own.gameId] === teamId ? `Beat ${w.own.opponent}` : `Lose to ${w.own.opponent}`, when: w.label });
    }
    for (const g of w.games) {
      const winner = locks[g.gameId];
      if (winner === undefined) continue;
      out.push({ id: g.gameId, what: winner === g.homeId ? `${g.home} over ${g.away}` : `${g.away} over ${g.home}`, when: w.label });
    }
    return out;
  });
  const has = picks.length > 0;
  const race = [...outlook].sort((a, b) => b.titleGame - a.titleGame || a.teamId - b.teamId);
  const top = race.slice(0, 5);
  const place = race.findIndex((o) => o.teamId === teamId);
  const verdict = titleOdds(me);
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-2xl font-bold">{team.name}</h2>
        <p className="text-sm text-ink-soft">
          {me.record.wins}-{me.record.losses} ({me.record.conferenceWins}-{me.record.conferenceLosses} ACC)
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-xl bg-mist p-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-ink-muted">{has ? "Title game, with your picks" : "Title game"}</p>
            <p className={`font-display text-5xl font-bold leading-none ${me.titleGame >= 0.5 || me.status === "clinched" ? "text-turf" : "text-marker-text"}`}>{verdict}</p>
          </div>
          {has && <p className="text-xs text-ink-muted">Today {titleOdds(today)}</p>}
        </div>
        <div className="flex flex-col gap-1 border-t border-navy/10 pt-2 text-sm text-ink-soft">
          <p className="flex justify-between">Win the ACC<span className="font-bold text-navy">{sideOdds(me.champion, me)}</span></p>
          <p className="flex justify-between">Playoff (beta)<span className="font-bold text-navy">{sideOdds(me.playoff, me)}</span></p>
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <p className={label}>Your picks</p>
          {has && (
            <button type="button" onClick={onReset} className="text-xs font-bold text-navy underline">Reset</button>
          )}
        </div>
        {has ? (
          picks.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-navy/10 px-2.5 py-1.5">
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
    </div>
  );
}

function RaceRow({ o, name, me }: { o: TeamOutlook; name: string; me: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-md px-1.5 py-1 ${me ? "bg-mist" : ""}`}>
      <span className="w-28 truncate text-sm font-semibold">{name}</span>
      <span className="h-1.5 flex-1 rounded-full bg-navy/10">
        <span className={`block h-1.5 rounded-full ${me ? "bg-marker" : "bg-navy"}`} style={{ width: `${Math.max(3, Math.round(o.titleGame * 100))}%` }} />
      </span>
      <span className="w-10 text-right text-xs font-bold">{titleOdds(o)}</span>
    </div>
  );
}
