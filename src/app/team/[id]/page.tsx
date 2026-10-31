import { notFound } from "next/navigation";
import { ExplorerPage } from "@/app/ExplorerPage";
import { accTeams } from "@/app/season";

export function generateStaticParams() {
  return accTeams.map((t) => ({ id: String(t.id) }));
}

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const teamId = Number((await params).id);
  if (!accTeams.some((t) => t.id === teamId)) notFound();
  return <ExplorerPage teamId={teamId} />;
}
