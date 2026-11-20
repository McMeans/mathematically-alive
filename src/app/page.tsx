import { ExplorerPage } from "./ExplorerPage";
import { baseOutlooks, season } from "./season";

// `/` shows the team with the best title-game odds; /team/[id] is the shareable link for any team.
export default function Home() {
  const top = baseOutlooks.flatMap((b) => b.outlook.teams)
    .sort((a, b) => b.titleGame - a.titleGame || b.playoff - a.playoff || a.teamId - b.teamId)[0];
  const name = season.teams.find((t) => t.id === top.teamId)?.name ?? "This team";
  return <ExplorerPage teamId={top.teamId} intro={`Every path to the playoff, for every team. ${name} is up first, with the best title-game odds: tap its name above or search to switch to yours.`} />;
}
