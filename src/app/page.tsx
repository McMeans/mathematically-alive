import { ExplorerPage } from "./ExplorerPage";
import { baseOutlook } from "./season";

// `/` shows the team with the best title-game odds; /team/[id] is the shareable link for any team.
export default function Home() {
  const top = [...baseOutlook.teams].sort((a, b) => b.titleGame - a.titleGame || b.playoff - a.playoff || a.teamId - b.teamId)[0];
  return <ExplorerPage teamId={top.teamId} />;
}
