import Link from "next/link";
import { conferenceName } from "@/core";
import { Logo } from "./Logo";
import { SUPPORTED_CONFERENCES } from "./config";

const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

// Missing pages, including a team in a conference the app doesn't cover yet (/team/<id> for a Mountain West team).
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-white px-4 text-center">
      <Logo size={64} decorative />
      <h1 className="font-display text-2xl font-bold text-navy">No page here</h1>
      <p className="max-w-md text-sm text-ink-soft">
        That team or page isn&rsquo;t on Mathematically Alive. It covers the {list(SUPPORTED_CONFERENCES.map(conferenceName))} so far, with more
        conferences on the way.
      </p>
      <Link href="/" className="min-h-11 rounded-full bg-navy px-5 py-2.5 text-sm font-bold text-white hover:bg-navy/90">
        Pick a team
      </Link>
    </main>
  );
}
