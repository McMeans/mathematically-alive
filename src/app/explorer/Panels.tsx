"use client";
import Link from "next/link";
import { useId, useState } from "react";
import { formatChance, formatRecord, mustWinConference, type OddsLabels, type TeamOutlook, type TeamPath } from "@/core";
import { NAVY, pct, type ConferenceList, type GameInfo, type TeamInfo } from "./Explorer";
import { byOdds } from "./Season";
import { useConference } from "./conference";

/** White or navy text, whichever reads better on the team color (WCAG relative luminance). */
function inkOn(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05 / (l + 0.05)) >= (l + 0.05) / 0.0652 ? "#FFFFFF" : NAVY;
}

export function TeamList({ conferences, names, selectedId, onSelect }: {
  conferences: ConferenceList[];
  names: Record<number, string>;
  selectedId: number;
  /** Called on a plain click, before navigation, so the row can switch at once. */
  onSelect?: (id: number) => void;
}) {
  const { conference } = useConference();
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(conference);
  // Rendered twice (desktop column and phone sheet), so the label needs a per-copy id.
  const searchId = useId();
  const query = q.trim().toLowerCase();
  // A search looks through every conference; otherwise the chosen tab, best odds first.
  const rows = conferences
    .filter((c) => query !== "" || c.conference === shown)
    .flatMap((c) => {
      const byId = new Map(c.teams.map((t) => [t.id, t]));
      return [...c.outlook]
        .sort(byOdds(names))
        .filter((o) => byId.get(o.teamId)!.name.toLowerCase().includes(query))
        .map((o) => ({ t: byId.get(o.teamId)!, o, conference: c.conference }));
    });
  return (
    <div>
      {/* Search and column labels stay put while the list scrolls under them. */}
      <div className="sticky top-0 z-10 bg-white">
        {conferences.length > 1 && (
          <div role="group" aria-label="Conference" className="flex gap-1 px-3 pt-3">
            {conferences.map((c) => (
              <button
                key={c.conference}
                type="button"
                aria-pressed={query === "" && c.conference === shown}
                onClick={() => { setShown(c.conference); setQ(""); }}
                className="min-h-11 flex-1 rounded-full border border-navy/20 px-3 text-sm font-bold text-navy hover:bg-mist aria-pressed:border-navy aria-pressed:bg-navy aria-pressed:text-white md:min-h-8"
              >
                {c.conference}
              </button>
            ))}
          </div>
        )}
        <div className="p-3">
          <label htmlFor={searchId} className="mb-1 block text-xs font-bold text-ink-muted">
            Team
          </label>
          <input
            id={searchId}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={conferences.length > 1 ? "Search all conferences" : "Search"}
            autoComplete="off"
            className="min-h-11 w-full rounded-lg border border-ink-muted/40 bg-white px-3 text-sm placeholder:text-ink-muted md:min-h-9"
          />
        </div>
        <div aria-hidden className="flex items-center gap-2 px-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-ink-muted">
          <span className="w-2.5" />
          <span className="flex-1">Team</span>
          <span className="text-right">Odds</span>
        </div>
      </div>
      <ul>
        {rows.map(({ t, o, conference: c }) => {
          const id = t.id;
          const selected = id === selectedId;
          const fill = t.color ?? NAVY;
          const ink = inkOn(fill);
          return (
            <li key={id}>
              <Link
                href={`/team/${id}`}
                aria-current={selected ? "page" : undefined}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                  onSelect?.(id);
                }}
                style={selected ? { background: fill, color: ink } : undefined}
                className={`flex min-h-11 items-center gap-2 px-3 py-1.5 text-sm ${selected ? "font-bold" : "hover:bg-mist"}`}
              >
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: selected ? (t.altColor ?? ink) : fill, boxShadow: selected ? `0 0 0 1.5px ${ink}` : undefined }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate leading-5">{t.name}</span>
                  <span className={`block text-[11px] leading-4 tabular-nums ${selected ? "font-normal" : "text-ink-muted"}`}>
                    {formatRecord(o.record, c)}
                  </span>
                </span>
                <span className={`w-10 text-right tabular-nums ${o.status === "eliminated" && !selected ? "font-normal text-ink-muted" : ""}`}>
                  {formatChance(o.titleGame, o.status)}
                </span>
              </Link>
            </li>
          );
        })}
        {rows.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">No match</li>}
      </ul>
    </div>
  );
}

export function Beta() {
  const { labels } = useConference();
  return <span className="rounded border border-marker-text px-1 text-[10px] font-bold leading-4 text-marker-text">{labels.beta}</span>;
}

/** The playoff odds, or "Must win <conference>" when the team only gets in as champion (then they'd just repeat the Win <conference> odds). */
export const playoffText = (o: TeamOutlook, odds: string, labels: OddsLabels) => (mustWinConference(o) ? labels.mustWin : odds);

function Tile({ label, value, tone, badge, small }: { label: string; value: string; tone: string; badge?: boolean; small?: boolean }) {
  return (
    <div className="rounded-lg bg-mist p-3">
      <dt className="flex items-center gap-1 text-xs text-ink-muted">
        {label}
        {badge && <Beta />}
      </dt>
      <dd className={`font-display font-bold ${small ? "pt-1.5 text-base leading-6" : "text-2xl"} ${tone}`}>{value}</dd>
    </div>
  );
}

export function StatTiles({ outlook, ifWinOut, compact, condensed }: { outlook: TeamOutlook; ifWinOut: number | null; compact?: boolean; condensed?: boolean }) {
  const { labels } = useConference();
  // One slim row, for the pinned phone bar once the page has scrolled.
  if (condensed)
    return (
      <dl className="flex animate-rise items-baseline justify-between gap-3 text-xs text-ink-muted">
        {([[labels.titleGame, formatChance(outlook.titleGame, outlook.status), "text-turf", false], [labels.champion, pct(outlook.champion), "text-navy", false], [labels.playoff, playoffText(outlook, pct(outlook.playoff), labels), "text-navy", true]] as const).map(([label, value, tone, badge]) => (
          <div key={label} className="flex items-baseline gap-1.5">
            <dt className="flex items-center gap-1">{label}{badge && <Beta />}</dt>
            <dd className={`font-display text-base font-bold ${tone}`}>{value}</dd>
          </div>
        ))}
      </dl>
    );
  return (
    <dl className={`grid gap-2 ${compact ? "grid-cols-3" : "grid-cols-2"}`}>
      <Tile label={labels.titleGame} value={formatChance(outlook.titleGame, outlook.status)} tone="text-turf" />
      <Tile label={labels.champion} value={pct(outlook.champion)} tone="text-navy" />
      <Tile label={labels.playoff} value={playoffText(outlook, pct(outlook.playoff), labels)} tone="text-navy" badge small={mustWinConference(outlook)} />
      {!compact && <Tile label={labels.winOut} value={pct(ifWinOut)} tone="text-navy" />}
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
  const { conference } = useConference();
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
          {formatRecord(me.record, conference)}
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
