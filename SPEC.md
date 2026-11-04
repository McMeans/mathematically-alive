# Mathematically Alive: spec

What the app is, how its numbers are made, and the rules the code follows. Read this with `CLAUDE.md`, which covers layout, testing rules and the checks a change must pass.

## What it is

A Next.js site. Pick a college football team and see what has to happen for it to reach its conference championship game. A team's page uses its own conference; the supported ones are listed in `SUPPORTED_CONFERENCES` (`src/app/config.ts`): the ACC and the Big 12. A playoff estimate exists but is experimental.

It answers three questions for the picked team:

1. **How likely is it?** Title-game and title odds from simulated seasons.
2. **Is it settled?** "In" (clinched) and "Out" (eliminated) are proven exactly, never inferred from odds.
3. **What has to happen?** Its own remaining games, games elsewhere that help or hurt it, and the likeliest combination of results that gets it in.

Users can lock results ("what if Miami loses to Wake Forest?") and every number updates.

## Data

- **Source:** CollegeFootballData (CFBD) free tier. Teams, games, betting lines, SP+ ratings. `scripts/fetch-season.ts` makes 4 API calls and writes `data/season-<year>.json`. It needs `CFBD_API_KEY` in `.env.local`. The key is build-time only and must never reach the client or a log.
- **Build:** `scripts/build-data.ts` turns the newest snapshot in `data/` (or, when there is none, every committed fixture for the newest year, merged) into `src/app/data/season.json`, which is gitignored. So `next build` and CI never need a key. It runs before `lint`, `typecheck` and `build`.
- **Model:** `src/core/season.ts`, via `seasonFromCfbd`. A `Season` has teams (id, conference, FBS or not, colors, SP+ rating) and games (week, kickoff, neutral site, conference game, home/away, score once completed, spread).
- **Fixtures:** `fixtures/acc-2025.json` and `fixtures/big-12-2025.json` (full season), and `fixtures/acc-2026.json` and `fixtures/big-12-2026.json` (mid-season, through week 9), are raw snapshots made by `scripts/make-fixture.ts` (`pnpm fixture [year] [conference]`). Never hand-edit them. Without `data/`, the build merges every fixture for the newest year.

## How the stats work

All logic lives in `src/core` (framework-free, public API in `src/core/index.ts`). Everything is seeded, so the same inputs always give the same numbers. There is no `Math.random()` in the core.

### Single-game odds (`odds.ts`, `sim.ts`)

- Final margins are taken as normal around the spread, with SD `MARGIN_SD` = 15.5 points. `winProbability(spread)` is the normal CDF.
- When a game has a spread, that spread is used. Otherwise one is derived from the SP+ rating difference plus 2.5 points of home field (`HOME_FIELD`), with none at a neutral site. A missing rating counts as 0 for FBS teams and −10 for others.

### Season simulation (`sim.ts`)

- Monte Carlo: every unplayed game is played out over many seasons. The core takes the count and seed as options; the app sets them in `src/app/config.ts` (`ITERATIONS` = 20,000, `SEED` = 2026). Completed games are never changed. Locked games always go to the locked winner.
- **Rating shift:** in each simulated season, each team's rating moves by one normal draw (`SHOCK_SD` = 4) that is shared by all its games. A team that is better than its rating tends to win more of them. The per-game SD shrinks to match, so a single game's odds still equal what the spread says.
- **Ranking stand-in:** the SportSource Team Success Ranking (a tiebreak step) is modelled as the rating plus `RANK_PER_NET_WIN` = 2 per net simulated win, plus noise (`RANK_SD` = 3). It comes from one hashed draw per team and season, which the title game reuses.
- Tiebreak draws and title-game rolls come from streams seeded per iteration, so what-if runs stay paired with the base run. That means differences come from the lock, not from noise.

### Tiebreakers (`tiebreak.ts`)

The ACC tiebreaker policy (July 2026), no divisions, top two play for the title:

1. Order teams by conference win pct. **Tied teams** are those at the best pct, plus teams with a different game count whose wins or losses match theirs.
2. **Two-team tie:** head-to-head, then ranking, then a seeded draw.
3. **Three or more teams that all played each other (round robin):** record among the tied teams. If that cuts the tie down, start over among the teams left, so two left go back to step 2. If it doesn't, ranking, then a draw.
4. **No round robin:** a team that beat every other tied team is placed. Otherwise a team that lost to every other tied team is eliminated. Otherwise ranking, then a draw.
5. After a team is placed, the rest are re-tied from scratch.

Steps based on record come before ranking and the draw. Proofs treat ranking and the draw as "could go either way".

The rules depend on the conference name. Any conference other than the Big 12 uses the ACC policy above.

**Big 12** (Big 12 Football Tiebreaking Procedures, 2024 season document, the latest published). Every team plays nine conference games, so there's no game-count rule. Order teams by conference win pct. A tie is broken by the first of these steps that tells the teams apart. If that step leaves one team best, that team is placed. If several share the best mark, the tie starts over among them, so two left go back to the two-team steps. After a team is placed, the rest start over.

a. Head-to-head. For two teams, their game. For three or more who all played each other, the record among them. For three or more who didn't, a team that beat every other tied team is placed; otherwise go to the next step.
b. Win pct against common conference opponents (those every tied team played).
c. Win pct against the next highest placed common opponent, down the standings. Common opponents tied in the standings count as one group.
d. Strength of conference schedule: the combined conference win pct of the team's conference opponents, counted per game.
e. Total wins in the regular season, with at most one win over a team below FBS. Games exempt from the NCAA 12-game limit can't be told apart in the data, so they count too.
f. Ranking (SP+ standing in for the SportSource Analytics rating), then g. a seeded draw (the coin toss).

Proofs search conference games only, so they skip total wins and treat it like ranking: "could go either way". The likeliest-way note for a Big 12 team says "depending on total wins and the ranking tiebreak".

### Outlook (`outlook.ts`)

For each conference team, `seasonOutlook` gives:

- the record so far, with locks counted as played;
- `titleGame`: the share of seasons it plays in the title game;
- `title`: the share of seasons it wins the title game. That game is a neutral-site game using the simulated ratings;
- `status`: clinched, eliminated or alive, from the proof;
- `playoff`: **experimental**, not the committee. The conference champion always gets in. Any other FBS team gets in when it ranks in the top 11 by `wins − 1.5·losses + rating/10`.
- `atLarge`: the share of seasons it gets in without winning the conference. 0 means it must win the conference (`mustWinConference`), and the app shows "Must win ACC" instead of a playoff percentage.
- `games` (only for `OutlookOptions.teamId`): its title-game and playoff odds if it wins or loses each unplayed game. Each simulated season is replayed with only that game flipped (the title race rerun, ranking included), so the numbers equal what picking that result shows. A lock changes only its own game's draw, which is what makes this exact. Splitting the seasons by how the game went instead would be biased: seasons where a team loses lean toward seasons it drew a weak rating, so it also loses more of its other games.

### Proofs (`proof.ts`)

Exact checks, not Monte Carlo. Can the team still miss, or still make, the title game under some combination of the remaining conference results, its own included?

- A depth-first search over the remaining conference games. A branch stops early once a matching argument settles it. The budget is 30,000 nodes per check.
- If the search runs out of budget, the answer is "open". It never gives a false clinch or elimination.
- **One rival left:** if at most one other team can still get in, the team is in, because two teams play for the title. This catches clinches the main search runs out of budget on.

### Display rules (`paths.ts`)

All wording users see is made in the core so tests can check it. `formatTitleOdds(p, status)` and `formatSideOdds(p, status)` follow these rules:

- `formatTitleOdds` (title-game odds): proven clinched → "In", proven eliminated → "Out", else as side odds.
- `formatSideOdds` (title and playoff odds): 1.0 shows ">99%" unless the team has clinched the title game. 0 shows "<0.1%" unless it is eliminated, in which case it may show "0%".
- Under 1%, odds keep one decimal (`formatFine`), and anything above 0 but under 0.1% shows "<0.1%".
- So a flat 100% or 0% only appears once a proof backs it.

### Telling a real swing from noise (`signal.ts`)

A game's swing is the gap between the team's title-game odds when the home side wins and when the away side wins. A swing counts only if it clears a z-score bar:

- `OVERALL`: at least 1 point and z ≥ 3.
- `FAINT`: z ≥ 2.5. Used only to show which side helps.
- `SCENARIO`: at least 5 points and z ≥ 4, within one of the team's own-result scenarios.

### Path tree and help from elsewhere (`tree.ts`)

- The tree branches on the team's own remaining conference games, up to 12 of them. A branch stops when its outcome is settled (in or out in every season that goes that way) or too rare to call. Non-conference games aren't branched on, since they can't move title-game odds.
- **Help from elsewhere:** every other remaining conference game, with the team's odds for each result. A side helps if (a) proofs say so, else (b) it matters now, else (c) it matters within one of the team's scenarios ("if Louisville wins out"), else (d) it leans that way (`FAINT`).
- The UI tints helps green and hurts red, by impact (big ≥ 50 points, some ≥ 20 points, impact floor 2 points).
- The root odds equal `teamPath`'s `titleGame` for the same seed and locks.

### Likeliest way in (`likeliest.ts`)

- The most probable combination of remaining conference results that puts the team in, found by search, not sampling. It starts from a way in that the proof finds, flips results toward the likelier side while the team stays in, then improves the result by branch and bound.
- Its early stop is guarded by schedule spread (`MAX_SPREAD`).
- The way is trimmed to the results the team's spot depends on.
- `chance` multiplies game odds as if they were independent. The simulation links a team's games through its rating shift, so the true chance can differ a little.
- `needsTiebreakLuck` flags a way that works only if the team also wins its ranking and draw steps.
- The result can be null when the search runs out of budget.

### Explore (`explore.ts`)

`explore` is everything the explorer page shows for one team, from one shared simulation: the outlook, the path and the tree. The tree's larger proof budget overrides the outlook's status for that team.

## App (`src/app`)

- `/`: team list. `/team/[id]`: the explorer for that team (`ExplorerPage`, `explorer/*`). Each team page's title names the team ("Utah · Mathematically Alive"). Any other URL, including a team in a conference not covered yet, gets a branded 404 (`not-found.tsx`) that names the covered conferences.
- The first numbers are computed at build time. What-ifs run in a Web Worker (`sim.worker.ts`) so the main thread never blocks. Explore's worst case is about 2.6 s.
- Panels:
  - Team list with odds. One tab per supported conference (the team's own selected), and a search that looks through every conference.
  - Stat tiles: title game, title, playoff and if-win-out.
  - The season by week. Own-game buttons and elsewhere chips can be clicked to lock a result. Each own game (conference or not) is a small table: Win and Lose rows under ACC and CFP columns, the chance to win (kept after the game is picked), and a "Non-con" tag on non-conference games. A picked win fills green, a picked loss red. Each elsewhere game shows both sides' chance to win under its buttons. Each number is what picking that result would show (see `games` above). Non-conference games show "—" in the conference column for the ACC, where they move the title race only slightly, through the ranking tiebreak. In the Big 12, whose total-wins step counts them, they show the title odds either way. For a team that must win the conference, conference cards drop the CFP column. Its non-conference cards keep it so they stay pickable and a pick on them stays visible. Final results, byes and the tables are all the same height, so the weeks line up.
  - The race table.
  - The "What <team> needs" card, from the likeliest way in (a line says so): the team's own part, then help from elsewhere, one row per team with its needed results counted ("2 losses, 2 wins") and grouped: loses to (teal), beats (green), either way (dashed). "Fill in the likeliest way" picks all its results; the card then shrinks to a bar with Undo. It can also be minimized to one line ("Win out, Utah and Kansas each lose twice").
  - The header shows "Through <day of the latest final game>", with the fetch time on hover.
- **Brand:** see `CLAUDE.md`. Space Grotesk and Inter; navy, turf, marker and mist colors; light-only.

## Constraints

- CFBD free tier only. No paid services. The repo owner deploys; agents don't deploy or touch DNS.
- Never print or commit secrets (the CFBD key, tokens).
- Every behavior change in `src/core` ships with black-box tests (`tests/blackbox`, importing only `@/core`). The coverage gate is 85% (`.claude/skills/coverage-gate/gate.sh`) and must not be lowered without asking.
- The repo owner merges PRs.

## Known limits and open ideas

- The playoff model is a rough placeholder, not the committee.
- Ranking is a stand-in for SportSource.
- Proofs and the likeliest search have budgets. Near the edge they say "open" or return null rather than guess.
- The app covers the ACC and the Big 12. SEC and Big Ten still need their own tiebreak rules.
- **Expanding conferences.** Next: SEC and Big Ten. Like the ACC and Big 12, each champion gets an automatic playoff bid, and as power-four teams they have the best at-large odds, so today's model and UI carry over.
- **Group of Six, later.** The 2026 format guarantees a spot only to the highest-ranked Group of Six conference champion, not to every champion. Winning the conference isn't enough on its own, and at-large bids are rare but have happened. Before adding a G6 conference, the playoff model needs that rule (champion and ranked above every other G6 champion), and the UI needs wording for it ("Must win the conference and be the top G6 champion", or similar, rather than "Must win ACC").
- A future MCP server is planned on top of `src/core`.
