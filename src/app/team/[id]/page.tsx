import { notFound } from "next/navigation";
import { ExplorerPage } from "@/app/ExplorerPage";
import { conferenceOf, supportedTeams } from "@/app/season";

export function generateStaticParams() {
  return supportedTeams.map((t) => ({ id: String(t.id) }));
}

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const teamId = Number((await params).id);
  if (conferenceOf(teamId) === null) notFound();
  return <ExplorerPage teamId={teamId} />;
}
