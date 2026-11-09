// A shared Lab link: its own preview (title, the title favourite, the field image) for chat and social apps, then on
// to the Lab with the picks.
import type { Metadata } from "next";
import Link from "next/link";
import { sharedCard } from "./shared";
import { Forward } from "./Forward";

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const card = sharedCard((await params).code);
  const title = "My playoff picks · Season Lab";
  const description = card ? `${card.picks}. ${card.champion}.` : "Play out the rest of the college football season.";
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

export default async function SharedLab({ params }: Props) {
  const to = `/lab?picks=${encodeURIComponent((await params).code)}`;
  return (
    <main className="p-6 text-sm text-ink-soft">
      <Forward to={to} />
      <Link href={to} className="font-bold text-navy underline">Open these picks in the Season Lab</Link>
    </main>
  );
}
