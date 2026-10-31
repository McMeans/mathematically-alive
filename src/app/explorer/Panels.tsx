"use client";
import Link from "next/link";
import { useState } from "react";
import { formatChance, type TeamOutlook, type TeamPath } from "@/core";
import { NAVY, pct, type GameInfo, type TeamInfo } from "./Explorer";

export function TeamList({ teams, order, outlook, selectedId }: { teams: TeamInfo[]; order: number[]; outlook: TeamOutlook[]; selectedId: number }) {
  const [q, setQ] = useState("");
  const byId = new Map(teams.map((t) => [t.id, t]));
  const odds = new Map(outlook.map((o) => [o.teamId, o]));
  const ids = order.filter((id) => byId.get(id)!.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div>
      <div className="p-3">
        <label htmlFor="team-search" className="mb-1 block text-xs font-bold text-ink-muted">
          Team
        </label>
        <input
          id="team-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          autoComplete="off"
          className="min-h-11 w-full rounded-lg border border-ink-muted/40 bg-white px-3 text-sm placeholder:text-ink-muted md:min-h-9"
        />
      </div>
      <ul>
        {ids.map((id) => {
          const t = byId.get(id)!;
          const o = odds.get(id)!;
          const selected = id === selectedId;
          return (
            <li key={id}>
              <Link
                href={`/team/${id}`}
                aria-current={selected ? "page" : undefined}
                className={`flex min-h-11 items-center gap-2 px-3 text-sm md:min-h-10 ${selected ? "bg-mist font-bold ring-2 ring-inset ring-navy" : "hover:bg-mist"}`}
              >
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: t.color ?? NAVY }} />
                <span className="flex-1 truncate">{t.name}</span>
                <span className="text-xs font-normal text-ink-muted">
                  {o.record.wins}-{o.record.losses}
                </span>
                <span className={`w-10 text-right tabular-nums ${o.status === "eliminated" ? "font-normal text-ink-muted" : ""}`}>
                  {formatChance(o.titleGame, o.status)}
                </span>
              </Link>
            </li>
          );
        })}
        {ids.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">No match</li>}
      </ul>
    </div>
  );
}

function Tile({ label, value, tone, badge }: { label: string; value: string; tone: string; badge?: boolean }) {
  return (
    <div className="rounded-lg bg-mist p-3">
      <dt className="flex items-center gap-1 text-xs text-ink-muted">
        {label}
        {badge && <span className="rounded border border-marker-text px-1 text-[10px] font-bold leading-4 text-marker-text">BETA</span>}
      </dt>
      <dd className={`font-display text-2xl font-bold ${tone}`}>{value}</dd>
    </div>
  );
}

export function StatTiles({ outlook, ifWinOut, compact }: { outlook: TeamOutlook; ifWinOut: number | null; compact?: boolean }) {
  return (
    <dl className={`grid gap-2 ${compact ? "grid-cols-3" : "grid-cols-2"}`}>
      <Tile label="Title game" value={formatChance(outlook.titleGame, outlook.status)} tone="text-turf" />
      <Tile label="Win ACC" value={pct(outlook.champion)} tone="text-navy" />
      <Tile label="Playoff" value={pct(outlook.playoff)} tone="text-navy" badge />
      {!compact && <Tile label="Win out" value={pct(ifWinOut)} tone="text-navy" />}
    </dl>
  );
}

export function Stats({ team, outlook, me, path, teamId, own, names }: {
  team: TeamInfo;
  outlook: TeamOutlook[];
  me: TeamOutlook;
  path: TeamPath;
  teamId: number;
  own: GameInfo[];
  names: Record<number, string>;
}) {
  const games = me.record.wins + me.record.losses + own.length;
  const wins = me.expectedWins;
  const big = path.keyGames.find((k) => k.homeId === teamId || k.awayId === teamId);
  const bigLabel = big ? (big.awayId === teamId ? `@ ${names[big.homeId]}` : `vs ${names[big.awayId]}`) : "—";
  const top = [...outlook].sort((a, b) => b.titleGame - a.titleGame || a.teamId - b.teamId).slice(0, 5);
  const nameOf = (id: number) => names[id] ?? `Team ${id}`;
  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <span aria-hidden className="h-4 w-4 shrink-0 rounded-sm" style={{ background: team.color ?? NAVY }} />
          <h2 className="font-display text-2xl font-bold">{team.name}</h2>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          {me.record.wins}-{me.record.losses} · {me.record.conferenceWins}-{me.record.conferenceLosses} ACC
        </p>
      </div>
      <StatTiles outlook={me} ifWinOut={path.ifWinOut} />
      <section aria-labelledby="proj">
        <h3 id="proj" className="text-xs font-bold uppercase tracking-wide text-ink-muted">Projected</h3>
        <dl className="mt-2 divide-y divide-ink-muted/20 text-sm">
          <div className="flex justify-between py-2">
            <dt className="text-ink-soft">Record</dt>
            <dd className="font-bold">{wins.toFixed(1)}–{(games - wins).toFixed(1)}</dd>
          </div>
          <div className="flex justify-between gap-2 py-2">
            <dt className="text-ink-soft">Biggest game</dt>
            <dd className="font-bold">{bigLabel}</dd>
          </div>
        </dl>
      </section>
      <section aria-labelledby="race">
        <h3 id="race" className="text-xs font-bold uppercase tracking-wide text-ink-muted">Race</h3>
        <ol className="mt-2 space-y-2 text-sm">
          {top.map((o) => (
            <li key={o.teamId} className="grid grid-cols-[88px_1fr_36px] items-center gap-2">
              <span className={`truncate ${o.teamId === teamId ? "font-bold" : ""}`}>{nameOf(o.teamId)}</span>
              <span aria-hidden className="h-2 rounded-full bg-mist">
                <span className="block h-full rounded-full" style={{ width: `${Math.round(o.titleGame * 100)}%`, background: o.teamId === teamId ? "#D9622B" : NAVY }} />
              </span>
              <span className="text-right tabular-nums">{formatChance(o.titleGame, o.status)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
