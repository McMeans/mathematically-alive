# Spike: tree and "Help from elsewhere" logic

Branch `one-page` (worktree `ma-ui`), commit 4ca0557, local only. Data: data/season-2026.json, 5000 iterations, seed 2026.
Scripts: scratchpad `spike/{audit,noise,nullscen,after}.ts`.

## Findings
- **Data is complete.** All 17 ACC teams have 12 games. 35 ACC conference games and 10 ACC non-conference games remain. No TBD dates. Week 13 kickoffs at 05:00Z are placeholders for an unset time, and they still show the right Eastern date. Many games have no line yet, so they fall back to SP+. FCS opponents have no rating and count as -10.
- **The tree was cut short.** It used depth 3, but every team has 4 or 5 games left, and it also branched on non-conference games. At full depth that is 31 to 63 nodes. Most are dead: Miami has 29 of 63 nodes with too few seasons to give odds, and Florida State has 59 of 63 decided.
- **Non-conference games can't change the title game.** The tiebreak uses only conference results plus a fixed rating. So their measured "swing" is pure noise, for example Merrimack at Wake Forest showed 5.3 points for Louisville.
- **The 1-point swing bar let noise through.** On non-conference games, whose true swing is 0, 39 of 176 passed it (22%). Adding z >= 3 cut that to 0.
- **Help missed games that matter in combination.** If Louisville wins out (24%), 7 games swing it by 15 to 34 points. Only the top 3 were shown, ranked by their small overall swing. SMU has 3 games that matter only in some of its own scenarios, which were never listed. Miami's "Nothing else moves the needle" is correct: nothing clears noise even within its scenarios.
- **The help list showed stale numbers.** Live odds came from the top 5 key games, so a listed game outside that top 5 kept showing its no-lock numbers.
- **Monte Carlo noise.** Across 10 seeds, SMU ranged 52.8 to 54.7%, Louisville 7.6 to 8.7% and Wake Forest 36.5 to 38.0%. "Out" is unreliable for longshots: Boston College came out 0% in 3 of 10 seeds, NC State in 9 of 10, Pittsburgh in 7 and Virginia in 3. One worker round takes about 0.8 s, because it runs 3 separate sims.

## What I chose and built
- **The tree** branches on every remaining conference game, in kickoff order. A branch stops when it is settled: "In" or "Out" (in every season that goes that way), "Rare" (too few seasons), or "—" (ruled out by a lock). Each stop has a note and the count of games left. Leaves show the final conference record. Size is now 1 to 29 nodes (SMU 29, Wake Forest 25, Louisville 21).
- **Non-conference games** get a footnote instead of branches, because they can't move the title odds.
- **Desktop:** levels 0 to 1, the likely path and any locked path are open; the rest is behind "+ N outcomes".
- **Mobile drill-down** shows verdicts and notes.
- **Help:** `pathTree().help` covers every other remaining conference game. A game is flagged when it matters now (swing >= 1 point and z >= 3) or in one of the team's own-result scenarios (swing >= 5 points and z >= 4). It gets a core-written line such as "Matters more if Louisville wins out: 15% with a Wake Forest win, 48% with a Duke win."
  - The list is frozen from the no-lock run, so order stays stable; the numbers are live. It shows 5 games, with a "Show all" button.
  - A note covers the games left off the list.
- **teamPath key games** use the same noise filter and ignore non-conference games.
- **Tests:** 105 pass and the coverage gate is at 99.6%. The new tests failed on the old code. Lint and typecheck pass.
- **Not run:** `next build`, because it would clobber the dev server's `.next`.
- **Checked by eye:** desktop for SMU and Louisville. Mobile was not checked.

## Open questions for you
1. Should the app share one simulation across outlook, path and tree and use about 20k iterations? That would cut longshot flicker and deep-branch noise for about the same time as now.
2. Should "Out" and "In" require a real (exact) proof rather than "0 of 5000"? Today, tiles show "0%" while the list shows "Out".
3. The header says "after Week 9", but week 9 games are still unplayed.
4. The playoff tile depends on non-conference games, but the tree doesn't show them.

## Follow-up (commit after 4ca0557): user decisions implemented
- **One simulation:** `explore()` feeds outlook, path and tree from one shared sim, and the app now runs 20,000 iterations. Measured on real data: about 2.7 s per what-if round in Node.
- **"In"/"Out" are now proofs.** `proof.ts` searches every combination of the remaining conference games, depth-first with pruning, and treats rating and coin-flip tiebreak steps as could-go-either-way. A team that isn't proven and shows 0% or 100% in the sample displays "<1%" / ">99%" (`formatChance`). Tree branches are proven the same way.
  - With today's data, no ACC team is proven out yet.
  - Assumptions:
    - A team looking for a way in wins all its own remaining games, and one looking for a way out loses them all.
    - The search gives up after 200k nodes and then reports "alive", so it can miss a real clinch or elimination but never claims a false one.
- **Header:** "As of <data fetch time, ET>" with no week number.
- **Checks:** 108 tests pass, coverage gate 99.7%, lint and typecheck clean. `next build` not run, because of the dev server.
- **Open:** a 2.7 s worker round is slow, so consider fewer iterations for what-ifs. I haven't checked that the remaining "alive" teams are truly alive (a search that hits the budget also reports alive).
