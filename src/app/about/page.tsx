// How it works: where the numbers come from and what they can and can't tell you, in plain words. Read from the data
// alone (no simulation), so the page stays cheap.
import type { Metadata } from "next";
import Link from "next/link";
import { INDEPENDENTS, conferenceName } from "@/core";
import { Colophon } from "../Colophon";
import { SiteBar } from "../SiteBar";
import { ITERATIONS, SUPPORTED_CONFERENCES } from "../config";
import { asOf, through } from "../dates";
import data from "../data/season.json";
import { inConferenceOrder } from "../explorer/conferenceOrder";

export const metadata: Metadata = {
  title: "How it works · Mathematically Alive",
  description: "How Mathematically Alive works out each team's odds, proves who's in and out, and finds every path to the playoff.",
};

const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const conferences = list([...inConferenceOrder(SUPPORTED_CONFERENCES.map((conference) => ({ conference }))).map((c) => conferenceName(c.conference)), "the FBS independents"]);

// Every team with a page, for the bar's search (as on the not-found page).
const find = (data.teams as { id: number; name: string; abbreviation?: string | null; conference: string | null; classification?: string }[])
  .filter((t) => t.classification === "fbs" && t.conference !== null && (t.conference === INDEPENDENTS || SUPPORTED_CONFERENCES.includes(t.conference)))
  .map((t) => ({ id: t.id, name: t.name, abbr: t.abbreviation ?? undefined }));

function Part({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="cond mb-2 text-2xl font-extrabold uppercase tracking-[0.02em] text-ink">{title}</h2>
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-ink-soft">{children}</div>
    </section>
  );
}

export default function About() {
  return (
    <div className="flex min-h-dvh flex-col bg-ground">
      <header className="board-dots text-board-text">
        <SiteBar current={null} teams="/" lab="/lab" through={through} asOf={asOf} find={find} />
      </header>
      <main className="mx-auto w-full max-w-2xl px-4 pb-16 pt-8 md:pt-12">
        <h1 className="cond text-4xl font-extrabold uppercase tracking-[0.02em] text-ink">How it works</h1>
        <p className="mt-3 text-[17px] leading-relaxed text-ink-soft">
          Pick a college football team and see what has to happen for it to reach its conference title game and the College Football Playoff. Every team gets three answers: how likely it is, whether it&rsquo;s settled, and what has to happen.
        </p>

        <Part title="How likely is it?">
          <p>
            We play out the rest of the season {ITERATIONS.toLocaleString("en-US")} times. Each game&rsquo;s chances come from its betting line, or from SP+ ratings when there&rsquo;s no line yet. Each simulated season, every team plays a little better or worse than its rating, the same way in all its games, so hot and cold streaks happen the way they do in real seasons.
          </p>
          <p>
            Every conference&rsquo;s real tiebreakers then decide its title game, and the title game is played too. A team&rsquo;s odds are the share of those seasons where it gets there. Numbers are seeded, so the same data always gives the same odds.
          </p>
        </Part>

        <Part title="Is it settled?">
          <p>
            &ldquo;In&rdquo; and &ldquo;Out&rdquo; are never guessed from odds. They are proven: we check every way the remaining games can go, with the conference&rsquo;s tiebreakers, and only say In when the team gets in whatever happens, or Out when it can&rsquo;t. Until then you&rsquo;ll see &ldquo;&gt;99%&rdquo; or &ldquo;&lt;0.1%&rdquo;, never a flat 100% or 0%.
          </p>
        </Part>

        <Part title="What has to happen?">
          <p>
            Each team page shows its odds after each of its own results, the games elsewhere worth rooting for, and its likeliest way in: the most probable set of results that gets it there. Long shots get their paths too.
          </p>
          <p>
            Tap any result to lock it, and every number on the page updates. The <Link href="/lab" className="font-semibold text-ink underline decoration-rule underline-offset-2 hover:decoration-ink-muted">Season Lab</Link> does the same for the whole country: pick games and watch the projected playoff field, bracket and ranking follow.
          </p>
        </Part>

        <Part title="The playoff odds are our estimate">
          <p>
            The committee picks the playoff field, and nobody can prove what it will do. Our playoff odds come from a model of its ranking, fit to every ranking it has released since 2014, built on record, rating, strength of schedule and conference titles. The field follows the 2026 format: the ACC, Big Ten, Big 12 and SEC champions, the best-ranked Group of Six team, Notre Dame when it ranks in the top 12, then at-large teams by ranking.
          </p>
          <p>That&rsquo;s why playoff numbers carry an asterisk. Treat them as an informed estimate, not a forecast of the committee.</p>
        </Part>

        <Part title="What's covered">
          <p>Every FBS team: the {conferences}. Independents have playoff odds only, since they have no conference title game.</p>
          <p>
            A few tiebreak details aren&rsquo;t spelled out in the conferences&rsquo; published rules, and we&rsquo;ve had to assume how they work. Where a tie comes down to a coin toss or a ranking, proofs treat it as luck, so a team won&rsquo;t read In or Out on a step nobody can know yet.
          </p>
        </Part>

        <Part title="Where the data comes from">
          <p>
            Schedules, results, betting lines and SP+ ratings come from <a href="https://collegefootballdata.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-ink underline decoration-rule underline-offset-2 hover:decoration-ink-muted">CollegeFootballData</a>. During the season the data refreshes twice a week: Sunday morning once Saturday&rsquo;s games are final, and Wednesday for the new rankings and lines. The date in the top bar says how current it is.
          </p>
        </Part>

        <Colophon />
      </main>
    </div>
  );
}
