import Link from "next/link";
import { conferenceName } from "@/core";
import { Logo } from "./Logo";
import { SUPPORTED_CONFERENCES } from "./config";

const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// Missing pages, including a team the app has no page for (/team/<id> for an FCS team).
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-ground px-4 text-center">
      <Logo size={64} color="#133F2E" pulse="#F3F0E6" decorative />
      <h1 className="cond text-3xl font-extrabold text-ink">No page here</h1>
      <p className="max-w-md text-sm text-ink-soft">
        That team or page isn&rsquo;t on Mathematically Alive. It covers FBS teams: the {list([...SUPPORTED_CONFERENCES.map(conferenceName), "independents"])}.
      </p>
      <Link href="/" className="min-h-11 cond flex items-center rounded-[3px] bg-board px-5 text-base font-bold tracking-[0.05em] text-white hover:bg-board-deep">
        Pick a team
      </Link>
    </main>
  );
}
