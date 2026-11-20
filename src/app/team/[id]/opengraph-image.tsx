// The share image for a team's page: the team and its header odds with no picks.
import { notFound } from "next/navigation";
import { supportedTeams } from "@/app/season";
import { teamImage } from "../card";

export { contentType, size } from "@/app/og";
export const alt = "A team's playoff and conference title odds on Mathematically Alive";

// Drawn at build time for every team with a page, so a link preview never waits on a simulation.
export function generateStaticParams() {
  return supportedTeams.map((t) => ({ id: String(t.id) }));
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const image = await teamImage(Number((await params).id));
  if (!image) notFound();
  return image;
}
