---
version: 1
slug: "src-app-explorer-explorer-tsx"
primary_target: "src/app/explorer/Explorer.tsx"
related_targets: ["src/app/explorer/Season.tsx"]
---

# Team explorer

Scope: the team explorer (`/` and `/team/[id]`). Mode: Operate. Three views: desktop (1440x900), short desktop (1280x620) and phone (375-390 wide).
Job: a fan checks their team's title-game and playoff odds, what has to happen and which results elsewhere to root for, then locks what-ifs.
Constraint: too much at once today (three columns, legends, helper lines). Every feature stays reachable, but fewer things compete.
Status: two static drafts being compared, in `docs/redesign/`. A = brand direction D, cleaned up. B = stadium scoreboard (below). The chosen one gets built into the app.

## Direction contract (draft B)

THESIS: The odds are the scoreboard. Each number is a plate hung on a board, and picking a result re-hangs plates. It refuses the default of a dashboard of soft cards.
OWN-WORLD: a deep scoreboard-green board for the shell and number grid; off-white enamel plates with black block numerals; amber lamp marks what is lit (a locked pick, the selected team); chalk-grey concrete ground for reading text; condensed display face for plates and heads, a plain sans for body.
STORY: the fan sees their team's three numbers on the board, reads the weeks as a line score, sees which games elsewhere help, and locks results to watch the plates change.
FIRST VIEWPORT: green board header across the top: team name, record, three plates (title game, win conf, playoff). Below, the line score: weeks as columns, Win/Lose rows, plates in cells. Right rail: race standings board. Primary action: tapping a Win/Lose plate.
FORM: stadium hand-turned scoreboard, #4 on my list; seed:3b6bcfd269744345
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
