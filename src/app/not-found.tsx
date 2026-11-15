import Link from "next/link";
import { INDEPENDENTS, conferenceName } from "@/core";
import { inConferenceOrder } from "./explorer/conferenceOrder";
import { Logo } from "./Logo";
import { SiteBar } from "./SiteBar";
import { SUPPORTED_CONFERENCES } from "./config";
import { asOf, through } from "./dates";
import data from "./data/season.json";

const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// Every team with a page, for the bar's search: a supported conference's teams and the FBS independents. Read from the
// data alone (no simulation), so this page stays cheap.
const find = (data.teams as { id: number; name: string; abbreviation?: string | null; conference: string | null; classification?: string }[])
  .filter((t) => t.classification === "fbs" && t.conference !== null && (t.conference === INDEPENDENTS || SUPPORTED_CONFERENCES.includes(t.conference)))
  .map((t) => ({ id: t.id, name: t.name, abbr: t.abbreviation ?? undefined }));

// Missing pages, including a team the app has no page for (/team/<id> for an FCS team).
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-ground">
      <header className="board-dots text-board-text">
        <SiteBar current={null} teams="/" lab="/lab" through={through} asOf={asOf} find={find} />
      </header>
      <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
        <Logo size={64} color="var(--color-board)" pulse="var(--color-plate)" decorative />
        <h1 className="cond text-3xl font-extrabold text-ink">No page here</h1>
        <p className="max-w-md text-sm text-ink-soft">
          That team or page isn&rsquo;t on Mathematically Alive. It covers FBS teams: the {list([...inConferenceOrder(SUPPORTED_CONFERENCES.map((conference) => ({ conference }))).map((c) => conferenceName(c.conference)), "independents"])}.
        </p>
        <Link href="/" className="min-h-11 cond flex items-center rounded-[3px] bg-board px-5 text-base font-bold tracking-[0.05em] text-white hover:bg-board-deep">
          Pick a team
        </Link>
      </main>
    </div>
  );
}
