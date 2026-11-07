// The national view: the projected playoff field and bracket, each spot's odds, and the bubble. Built at build time
// from the base national run; every sentence and number format comes from core.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { BracketGame, BracketSide } from "@/core";
import { Logo } from "@/app/Logo";
import { asOf, baseNationalView, season, supportedTeams, through } from "@/app/season";

export const metadata: Metadata = {
  title: "Playoff field · Mathematically Alive",
  description: "The projected College Football Playoff field and bracket, with each spot's odds and the teams on the bubble.",
};

const names = new Map(season.teams.map((t) => [t.id, t.name]));
const paged = new Set(supportedTeams.map((t) => t.id));

function TeamName({ id }: { id: number }) {
  const name = names.get(id) ?? `Team ${id}`;
  return paged.has(id) ? <Link href={`/team/${id}`} className="font-bold text-navy hover:underline">{name}</Link> : <span className="font-bold text-navy">{name}</span>;
}

function Side({ side }: { side: BracketSide }) {
  if ("teamId" in side) return <span><span className="mr-1 text-xs text-ink-muted">{side.seed}</span><TeamName id={side.teamId} /></span>;
  return <span className="text-ink-muted">Winner of game {side.winnerOf + 1}</span>;
}

export default function NationalPage() {
  const view = baseNationalView;
  if (!view) notFound();
  const rounds = view.bracket.reduce<Record<string, BracketGame[]>>((acc, g) => ((acc[g.round] ??= []).push(g), acc), {});
  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between gap-3 border-b border-ink-muted/25 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <Logo size={32} decorative />
          <span className="font-display text-lg font-bold tracking-tight sm:text-xl">Mathematically Alive</span>
        </Link>
        <span title={asOf} className="text-sm text-ink-muted">{through}</span>
      </header>
      <main className="mx-auto max-w-5xl p-4 md:p-6">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold">
          Projected playoff field
          <span className="rounded border border-ink-muted/50 px-1 text-[10px] font-semibold leading-4 text-ink-muted">Beta</span>
        </h1>
        <p className="mt-1 text-sm text-ink-muted">{view.note}</p>

        <div className="mt-6 grid gap-6 md:grid-cols-[minmax(0,1fr)_280px]">
          <section aria-labelledby="field">
            <h2 id="field" className="font-display text-lg font-bold">The field</h2>
            <ol className="mt-2 divide-y divide-ink-muted/15 rounded-lg bg-mist">
              {view.field.map((s) => (
                <li key={s.teamId} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                  <span><span className="mr-2 inline-block w-5 text-right text-ink-muted">{s.seed}</span><TeamName id={s.teamId} /></span>
                  <span className="text-ink-soft">{s.text}</span>
                </li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="bubble">
            <h2 id="bubble" className="font-display text-lg font-bold">On the bubble</h2>
            <ul className="mt-2 divide-y divide-ink-muted/15 rounded-lg border border-ink-muted/25">
              {view.bubble.map((b) => (
                <li key={b.teamId} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                  <TeamName id={b.teamId} />
                  <span className="text-ink-soft">{b.text}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section aria-labelledby="bracket" className="mt-8">
          <h2 id="bracket" className="font-display text-lg font-bold">Projected bracket</h2>
          <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(rounds).map(([round, games]) => (
              <div key={round}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{round}</h3>
                <ul className="mt-1 space-y-2">
                  {games.map((g) => (
                    <li key={g.index} className="rounded-md bg-mist px-3 py-2 text-sm">
                      <p className="text-xs text-ink-muted">Game {g.index + 1} · {g.site}</p>
                      <p><Side side={g.a} /></p>
                      <p><Side side={g.b} /></p>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
