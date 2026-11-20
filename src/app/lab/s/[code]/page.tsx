// A shared Lab link: its own preview (title, the title favourite, the field image) for chat and social apps, then on
// to the Lab with the picks.
import type { Metadata } from "next";
import Link from "next/link";
import { readLabShareCode } from "@/core";
import { notFound } from "next/navigation";
import { sharedCard } from "./shared";
import { Forward } from "./Forward";

type Props = { params: Promise<{ code: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const card = sharedCard((await params).code);
  if (card === undefined) notFound();
  // No card: the season's playoff isn't simulated; the Lab's own words stand.
  const title = card?.title ?? "Season Lab · Mathematically Alive";
  const description = card?.description ?? "Play out the rest of the college football season.";
  // Someone's picks: worth a preview in a chat, not a search result.
  return { title, description, robots: { index: false }, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

export default async function SharedLab({ params }: Props) {
  const { code } = await params;
  if (sharedCard(code) === undefined) notFound();
  const parts = readLabShareCode(code);
  const q = new URLSearchParams();
  if (parts.picks) q.set("picks", parts.picks);
  if (parts.bracket) q.set("bracket", parts.bracket);
  const to = `/lab?${q.toString()}`;
  return (
    <main className="p-6 text-sm text-ink-soft">
      <Forward to={to} />
      <Link href={to} className="font-bold text-ink underline">Open these picks in the Season Lab</Link>
    </main>
  );
}
