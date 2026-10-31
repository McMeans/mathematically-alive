import Link from "next/link";
import { formatOdds } from "@/core";
import { Logo } from "./Logo";
import { accTeams, baseOutlook, season } from "./season";

const asOf = new Date(season.fetchedAt).toLocaleDateString("en-US", {
  timeZone: "America/New_York",
  month: "long",
  day: "numeric",
  year: "numeric",
});

export default function Home() {
  const rows = [...baseOutlook.teams]
    .sort((a, b) => b.titleGame - a.titleGame || b.playoff - a.playoff)
    .map((o) => ({ o, team: accTeams.find((t) => t.id === o.teamId)! }));
  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-8 flex flex-col gap-2">
        <div className="flex items-center gap-3 sm:gap-4">
          <Logo size={56} decorative />
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-5xl">
            mathematically <span className="text-turf">alive</span>
          </h1>
        </div>
        <p className="text-lg text-ink-soft">Every path to the playoff, for every team.</p>
        <p className="text-sm text-ink-muted">Data as of {asOf}</p>
      </header>
      <h2 className="mb-3 font-display text-xl font-bold">ACC standings</h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map(({ o, team }) => (
          <li key={team.id}>
            <Link
              href={`/team/${team.id}`}
              className="block h-full rounded-lg border-l-4 bg-mist p-4 hover:ring-2 hover:ring-navy focus-visible:outline-2 focus-visible:outline-navy"
              style={{ borderColor: team.color ?? "#14213D" }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-lg font-bold">{team.name}</span>
                <span className="text-sm text-ink-soft">
                  {o.record.conferenceWins}-{o.record.conferenceLosses} ACC
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <dt className="text-xs text-ink-muted">Title game</dt>
                  <dd className="text-2xl font-bold text-turf">{formatOdds(o.titleGame)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Playoff (experimental)</dt>
                  <dd className="text-2xl font-bold text-navy">{formatOdds(o.playoff)}</dd>
                </div>
              </dl>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
