import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { INDEPENDENTS, conferenceName } from "@/core";
import { ExplorerPage } from "@/app/ExplorerPage";
import { conferenceOf, supportedTeams } from "@/app/season";

export function generateStaticParams() {
  return supportedTeams.map((t) => ({ id: String(t.id) }));
}

/** "Utah · Mathematically Alive", so a tab or a shared link names the team. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const id = Number((await params).id);
  const team = supportedTeams.find((t) => t.id === id);
  if (!team) return {};
  const independent = team.conference === null || team.conference === INDEPENDENTS;
  return {
    title: `${team.name} · Mathematically Alive`,
    description: independent
      ? `Every path for ${team.name} to the playoff.`
      : `Every path for ${team.name} to the ${conferenceName(team.conference!)} title game and the playoff.`,
  };
}

export default async function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const teamId = Number((await params).id);
  if (conferenceOf(teamId) === null) notFound();
  return <ExplorerPage teamId={teamId} />;
}
