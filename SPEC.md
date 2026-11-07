# Mathematically Alive: spec

What the app is, how its numbers are made, and the rules the code follows. Read this with `CLAUDE.md`, which covers layout, testing rules and the checks a change must pass.

## What it is

A Next.js site. Pick a college football team and see what has to happen for it to reach its conference championship game. A team's page uses its own conference; the supported ones are listed in `SUPPORTED_CONFERENCES` (`src/app/config.ts`): the ACC, the Big 12, the SEC, the Big Ten and the MAC (CFBD's "Mid-American", the first Group of Six conference). A playoff estimate exists but is experimental.

It answers three questions for the picked team:

1. **How likely is it?** Title-game and title odds from simulated seasons.
2. **Is it settled?** "In" (clinched) and "Out" (eliminated) are proven exactly, never inferred from odds.
3. **What has to happen?** Its own remaining games, games elsewhere that help or hurt it, and the likeliest combination of results that gets it in.

Users can lock results ("what if Miami loses to Wake Forest?") and every number updates.

## Data

- **Source:** CollegeFootballData (CFBD) free tier. Teams, games, betting lines, SP+ ratings. `scripts/fetch-season.ts` (`pnpm data [year]`, the year defaulting to the season being played) makes 4 API calls that bring back every FBS game and writes the national snapshot, `data/season-<year>.json`: raw CFBD rows, one per line in id order, so a refresh's diff shows what changed. It needs `CFBD_API_KEY` (in `.env.local`, or the repository secret in the refresh job). The key is build-time only and must never reach the client or a log.
- **Snapshot:** committed. `.github/workflows/refresh-data.yml` refreshes it in season (August to January), Sunday 12:00 UTC once Saturday's games are final and Wednesday for the week's lines, 8 CFBD calls a week; it can also be run by hand with a year. It fetches, refuses a partial response (`checkFetch`: no teams or games, or any list down more than 5% from the committed snapshot of the same season, so a lost game or two still goes through), runs `pnpm build` (so the checks below and every team page must pass), and commits the snapshot to `main` when anything besides the fetch time changed. The host's git deploy ships it. A bad snapshot fails the job and is never committed.
- **Build:** `scripts/build-data.ts` turns the newest `data/season-<year>.json` into `src/app/data/season.json`, which is gitignored. So `next build` and CI never need a key. It runs before `lint`, `typecheck` and `build`. It fails unless `checkSnapshot` (`snapshot.ts`) passes: every supported conference has a full schedule (each member plays a conference game against another member) and tiebreak rules for the season. It lists every other FBS conference in the snapshot, independents included, as not supported. With the whole 2026 season in the snapshot (888 games, through week 11), `pnpm build` takes about 110 s on a laptop, nearly all of it rendering the 71 team pages, and one team's `explore` has a median of 2.9 s (Penn State and Rutgers about 13 s). Simulating the other conferences' games costs about 0.3 s of that median; the merged week-9 fixtures took 85 s and 2.2 s.
- **Model:** `src/core/season.ts`, via `seasonFromCfbd`. A `Season` has teams (id, conference, FBS or not, colors, SP+ rating) and games (week, kickoff, neutral site, conference game, home/away, score once completed, spread).
- **Committee rankings:** `fixtures/cfp-<year>.json` (2014–2026), made by `pnpm cfp`: see the committee stand-in below.
- **Fixtures:** `fixtures/acc-2025.json` and `fixtures/big-12-2025.json` (full season), and `fixtures/acc-2026.json` and `fixtures/big-12-2026.json` (mid-season, through week 9), are raw snapshots made by `scripts/make-fixture.ts` (`pnpm fixture [year] [conference]`). Never hand-edit them. They are for tests only; the app is built from the national snapshot.

## How the stats work

All logic lives in `src/core` (framework-free, public API in `src/core/index.ts`). Everything is seeded, so the same inputs always give the same numbers. There is no `Math.random()` in the core.

### Single-game odds (`odds.ts`, `sim.ts`)

- Final margins are taken as normal around the spread, with SD `MARGIN_SD` = 15.5 points. `winProbability(spread)` is the normal CDF.
- When a game has a spread, that spread is used. Otherwise one is derived from the SP+ rating difference plus 2.5 points of home field (`HOME_FIELD`), with none at a neutral site. A missing rating counts as 0 for FBS teams and −10 for others.

### Season simulation (`sim.ts`)

- Monte Carlo: every unplayed game is played out over many seasons. The core takes the count and seed as options; the app sets them in `src/app/config.ts` (`ITERATIONS` = 20,000, `SEED` = 2026). Completed games are never changed. Locked games always go to the locked winner.
- **Rating shift:** in each simulated season, each team's rating moves by one normal draw (`SHOCK_SD` = 4) that is shared by all its games. A team that is better than its rating tends to win more of them. The per-game SD shrinks to match, so a single game's odds still equal what the spread says.
- **Ranking stand-in:** the SportSource Team Success Ranking (a tiebreak step) is modelled as the rating plus `RANK_PER_NET_WIN` = 2 per net simulated win, plus noise (`RANK_SD` = 3). It comes from one hashed draw per team and season, which the title game reuses.
- Tiebreak draws and title-game rolls come from streams seeded per iteration and per conference (a salt hashed from the conference's name), so what-if runs stay paired with the base run and two conferences never share a draw. That means differences come from the lock, not from noise.

### National simulation (`national.ts`)

`simulateNational(season, { iterations, seed, locks, conferences })` runs phase 4's stages 2 to 5 (`docs/plan-national.md`) on every simulated season of `simulateSeason`, which is stage 1:

- **Stage 2, title games.** Each listed conference's rules pick its two teams, and the game is played at a neutral site with the season's simulated ratings. Once the data has the title game between those two teams, its result decides instead (final, locked, or simulated as a scheduled game). `seasonOutlook` plays its title game the same way, from the same streams, so a conference's title-game and title odds are the same in both. A conference with no tiebreak rules for the season is an error. Of the Group of Six, only the MAC has rules so far: the other five's title games aren't simulated, and their teams' `titleGame` and `champion` are null. A MAC title game counts in its teams' records and strength of schedule, but no Group of Six champion gets the champion weight below; under the 2026 format the Group of Six bid goes by ranking, not by title.
- **Stage 3, committee stand-in ranking** (`committee.ts`). Every FBS team is scored on the season's simulated record (title game included), its simulated rating (rating plus the season's shift), strength of schedule (its opponents' average rating) and a power-conference title, then ordered best first. Each team's score gets one standard Gumbel draw per season, hashed from (seed, iteration, team), which gives any two teams the pair odds the model was fitted on.
- **Stage 4, playoff field** (`playoff.ts`). The season's format (`playoffFormat(year)`, each one cited) picks and seeds the field from the stand-in's ranking and the simulated champions; `playoffField(season, ranking, champions)` does the same for any ranking.
  - 2014–2023: the top four, 1 vs 4 and 2 vs 3.
  - 2024: 12 teams, the five highest-ranked conference champions plus seven at-large; the four highest-ranked champions are seeds 1–4 with byes.
  - 2025: the same bids, straight seeding by ranking.
  - 2026 (CFP Management Committee; no rule document is published, so the citation is the SI, Front Office Sports and NCAA.com reports of January–February 2026): the ACC, Big 12, Big Ten and SEC champions; the highest-ranked Group of Six team, champion or not; Notre Dame when it ranks in the top 12; then at-large by ranking. Straight seeding, top four with byes.
- **Stage 5, bracket.** First round 5–12, 6–11, 7–10, 8–9 at the higher seed (2.5 points of home field); quarterfinals, semifinals and the final at neutral sites (1 meets the 8/9 winner, 2 the 7/10, 3 the 6/11, 4 the 5/12; the 1 and 4 sides meet in a semifinal; no reseeding). Each game is played at the season's simulated ratings with one uniform draw hashed from (seed, iteration, bracket game). Bowl and playoff games aren't read from the data, so a lock can't pick a playoff result.
- The playoff stages run only when the format's champions are simulated: every power conference must be in `conferences` from 2026, and the 2024–2025 formats need every conference's champion, so those seasons get none (`NationalResult.playoff` is false and every team's `playoff` is null). Four-team seasons need no champions.
- Per FBS team: `titleGame` and `champion` shares, `meanRank`, the shares of seasons in the stand-in's top 4, 12 and 25, and `playoff`: shares in the field, with a bye, at each seed, and reaching the quarterfinals (null in a four-team format), semifinals, final and title. `forEachIteration` replays each season's title games, full ranking, field and national champion.
- What-ifs stay paired: a lock changes only its own game's draw, so seasons where that game already went the locked way come out the same.
- Cost on the 2026 snapshot at 20,000 iterations, on top of the regular season (0.4 s): about 1.25 s for the four power conferences' title games and the ranking (0.35 s of it the ranking), and about 0.25 s more for the field and bracket, so a national pass is about 1.8–1.95 s, inside one team page's median. Phase 5 runs it on every team page: `explore` shares one `simulateSeason` between the outlook and the national pass, the national pass replays each of the focus team's games the other way (only the title races that game's teams are in), and `reuse` copies an earlier run's title races that no changed lock touches and starts each season's sort from its ranking. The worker keeps its last run and warms one at load; the build reuses one base run. Measured (12-team sample, 20,000 iterations): one team's `explore` median 2.62 s before, 3.78 s cold and 3.29 s for a what-if reusing the last run after; `pnpm build` 92 s before, 108 s after. Measured when stages 4–5 landed (same machine, two runs each): one team's `explore` median 2.87 s and 2.49 s before, 2.47 s and 2.74 s after (noise; the page doesn't run the national pass), `pnpm build` 89 s before, 92 s after. Measured when stages 2–3 landed: one team's `explore` median 2.83 s before, 2.93 s after (the draw streams changed, the work didn't; Penn State and Rutgers about 13.5 s both times), `pnpm build` 108 s before, 104 s after.

### Committee stand-in (`committee.ts`)

A modelled ranking, not the committee's. `committeeRanking(season, { throughWeek, champions })` ranks every FBS team from completed games by `score = 0.953·wins − 1.419·losses + 0.123·rating + 0.414·strength + 0.744·champion` (`committee-weights.ts`). Strength is the average rating of the opponents played (a missing rating is 0 for FBS teams and −10 below FBS). Champion means a power-conference champion (ACC, Big 12, Big Ten, SEC, and the Pac-12 through 2023); by default, the winner of each one's title game once played.

- **Fitting:** `pnpm cfp` (`scripts/fetch-cfp.ts`, 4 CFBD calls a season) writes `fixtures/cfp-<year>.json`: every committee ranking of the season with a trimmed snapshot of its games and SP+ ratings. `pnpm fit-committee` (`scripts/fit-committee.ts`, no API calls) fits the weights by maximum likelihood on each season's latest ranking (the final one for 2014–2025, the first of 2026, released Nov. 3 after week 9): the committee puts a above b with probability `1 / (1 + e^−(score a − score b))`, over every pair the ranking orders (ranked over ranked, ranked over unranked), each ranking weighted equally, with a small ridge penalty. Features come from games before the ranking's week.
- **Fit (in-sample):** its top 12 holds 10.8 of the committee's top 12 on average (at least 9 every season) and at least 3 of the top 4 every season. The old placeholder score (`wins − 1.5·losses + rating/10`) holds 8.9. `tests/blackbox/committee.test.ts` holds it to at least 9 every season, 10.5 on average and 3 of the top 4.
- **Limits:** past seasons use final SP+, which includes bowl games played after the ranking. Title games are found in the data as the only game between members in the conference's last week (or the only one at a neutral site), since CFBD flags them as conference games before 2025 and non-conference games from 2025; the Big 12 had none in 2014–2016, and the 2020 Pac-12 game isn't found. Group of Six champions get no champion weight.

### Tiebreakers (`tiebreak.ts`, `steps.ts`, `rules.ts`)

One engine serves every conference. `rules.ts` holds a config per conference and season: the step list, the resolver settings, the game-count rule, the luck wording and the source document. A conference or season with no config is an error ("No tiebreak rules for <conference> in <season>"), never another conference's rules. `hasTiebreakRules` says whether one exists, and `checkSnapshot` fails the build for a supported conference without one. Only 2026 configs exist (ACC, Big 12, SEC, Big Ten, MAC): the project covers the 2026 season only. Tests that check real 2025 title games load the 2025 fixtures as 2026, so they run under the 2026 rules.

- **Steps** (`steps.ts`): head-to-head (by games or by opponent, with or without dropping a team that lost to all), common opponents, highest placed common opponent (opponents level on record grouped, or ordered by head-to-head), strength of schedule, opponents' win pct, total wins (FCS cap; the title game left out), capped relative scoring margin, ranking, draw. One implementation each. Any score that can tie as a fraction is kept in whole numbers and compared exactly, so scores equal as fractions always tie (a float sum can round them apart).
- **Resolver:** teams are ordered by conference win pct, and a tie is resolved for the open spots. Each step either can't tell the tied teams apart (next step), or names the teams at the top of its order. One alone at the top is placed and the rest start over for any spot left. Several at the top that fit the open spots are all in, seeded by starting over among them. Otherwise those at the top start over, from the first step or from the next one as the step says, and the rest are out of the tie. Settings: `spots` ("open": the tie fills every open spot at once; "one": one spot at a time, the rest re-tied from scratch after each) and `drop` (a dropped team leaves only this tie, or the whole race with a re-tie).
- A step marked `nonConference` (total wins) counts non-conference results: `countsNonConference` follows from it, and proofs skip it as luck.
- `ineligible` (by team name): members who can't play in the title game. Their games count for everyone's record and every step, but the resolver never picks them, and proofs don't count them as rivals for a spot (they can win any number of games without taking one). An ineligible team is itself eliminated.
- Proof shortcuts that rely on the ACC's game-count rule (`couldTieByCount`, the tie route, the schedule-spread check) apply only where the config has `gameCountTies`.

The ACC tiebreaker policy (July 2026), no divisions, top two play for the title:

1. Order teams by conference win pct. **Tied teams** are those at the best pct, plus teams with a different game count whose wins or losses match theirs.
2. **Two-team tie:** head-to-head, then ranking, then a seeded draw.
3. **Three or more teams that all played each other (round robin):** record among the tied teams. If that cuts the tie down, start over among the teams left, so two left go back to step 2. If it doesn't, ranking, then a draw.
4. **No round robin:** a team that beat every other tied team is placed. Otherwise a team that lost to every other tied team is eliminated. Otherwise ranking, then a draw.
5. After a team is placed, the rest are re-tied from scratch.

Steps based on record come before ranking and the draw. Proofs treat ranking and the draw as "could go either way".

On the engine: steps head-to-head (by opponent, a team that lost to all dropped), ranking (teams level at the top go to the draw), draw; `spots: "one"`, `drop: "retie"`, `gameCountTies`.

**Big 12** (Big 12 Football Tiebreaking Procedures, 2024 season document, the latest published: https://s3.amazonaws.com/big12sports.com/documents/2025/11/4/Big_12_Football_2024_Tiebreaker_Policy.pdf). On the engine: `spots: "one"`, no game-count rule. Every team plays nine conference games, so there's no game-count rule. Order teams by conference win pct. A tie is broken by the first of these steps that tells the teams apart. If that step leaves one team best, that team is placed. If several share the best mark, the tie starts over among them, so two left go back to the two-team steps. After a team is placed, the rest start over.

a. Head-to-head. For two teams, their game. For three or more who all played each other, the record among them. For three or more who didn't, a team that beat every other tied team is placed; otherwise go to the next step.
b. Win pct against common conference opponents (those every tied team played).
c. Win pct against the next highest placed common opponent, down the standings. Common opponents tied in the standings count as one group.
d. Strength of conference schedule: the combined conference win pct of the team's conference opponents, counted per game.
e. Total wins in the regular season, with at most one win over a team below FBS. The title game (a non-conference game between two members in the data) is left out. Games exempt from the NCAA 12-game limit can't be told apart in the data, so they count too.
f. Ranking (SP+ standing in for the SportSource Analytics rating), then g. a seeded draw (the coin toss).

Proofs search conference games only, so they skip total wins and treat it like ranking: "could go either way". The likeliest-way note for a Big 12 team says "depending on total wins and the ranking tiebreak".

**SEC** (Southeastern Conference Official Football Tiebreakers, "SEC Football Tiebreakers Final 10.29.24", the document the SEC's tiebreaker page https://www.secsports.com/fbtiebreaker publishes for the 16-team, no-division format: https://storage.googleapis.com/secsports-prod/upload/2024/10/29/f6fc7cd9-3031-4357-8754-80bfa4b9c4c0.pdf). Every team plays the same number of conference games (eight in 2025, nine in 2026), so there's no game-count rule. On the engine: `spots: "open"`, `drop: "restart"`. Order teams by conference win pct. Teams level at the top fill both spots; a team alone at the top is in and the teams level below it fill the second. A tie is broken by the first step that tells the teams apart:

- One team alone at the best mark is in. With two spots open, the rest start over for the second.
- Two teams at the best mark with two spots open are both in.
- Otherwise the teams at the best mark start over and the rest are out.
- Two teams who are both in are seeded by the two-team steps.

a. Head-to-head. For teams who all played each other, the record among them. For teams who didn't, a team that beat every other tied team is in; otherwise a team that lost to every other one is out and the rest start over; otherwise go to the next step.
b. Record against common conference opponents (those every tied team played).
c. Record against the highest placed common opponent, down the standings. Opponents level on record are placed by head-to-head only (the step a. rules); those it can't separate count as one group, and only the common ones in a group count.
d. Cumulative conference win pct of all conference opponents (the average of their win pcts).
e. Capped relative total scoring margin against conference opponents (Appendix A). Per conference game: points scored over the opponent's regular-season average allowed, capped at 200%, minus points allowed over its average scored. Then the average over the team's conference games. The title game (a non-conference game between two members in the data) is left out of the averages. An opponent whose season total of points scored or allowed is 0 (not seen in FBS data) counts as 1 point, so the step stays defined.
f. Random draw: one name per open spot, the first name drawn seeded first.

Step e. needs every regular-season score of every member. Until then, the simulation can't know it, so the ranking stand-in takes its place, and proofs count it as luck ("could go either way") like the ranking. Results of non-conference games feed only the averages in step e., never a win count, so `countsNonConference` is false for the SEC and its non-conference cards show no title odds. The likeliest-way note for an SEC team says "depending on the scoring margin tiebreak".

**Big Ten** ("Big Ten Announces New Football Tiebreaking Procedures", Big Ten Communications, Aug. 26, 2024, the latest published: https://bigten.org/fb/article/blt6104802d94ebe1ab/). The full PDF that release links to is offline and no 2026 document is published, so the step order and wording come from the release, and the rest from secondary sources (cfb.app, CBS Sports, NBC, playoffstatus.com) and the Big Ten's 2025 title-game scenarios. Every team plays nine conference games, so there's no game-count rule. Non-conference games don't count. On the engine: `spots: "open"`, `drop: "restart"`, as for the SEC: two teams level at the top are both in, and a tie cut to two goes back to head-to-head (both shown in the 2025 scenarios). A tie is broken by the first step that tells the teams apart:

a. Head-to-head. For teams who all played each other, the record among them. For teams who didn't, a team that beat every other tied team is in; otherwise go to the next step. No source has a team that lost to all the others dropped, so it isn't.
b. Record against all common conference opponents.
c. Record against the common opponent with the best conference record, then down the standings. Assumed, not confirmed by the document: common opponents level on record count as one group (the Big 12's stated rule).
d. Cumulative conference win pct of all conference opponents. Every team plays nine conference games, so the average of their win pcts and the combined pct agree; the SEC's step (the average) is reused.
e. Ranking: SportSource Analytics Team Rating Score after the regular season, modelled by the ranking stand-in.
f. Random draw by the Commissioner or designee: one name per open spot, the first name drawn seeded first.

Assumed, not confirmed by the document: when a step cuts a tie of three or more down to a smaller group, that group starts over at head-to-head (the engine's rule for every conference). The 2025 scenarios show it for two teams left; cfb.app's paraphrase has a group of three or more go on to the next step instead.

Proofs count the ranking and the draw as luck. The likeliest-way note for a Big Ten team says "depending on the ranking tiebreak".

**MAC** ("MAC Football Championship Tiebreaker", Mid-American Conference: https://getsomemaction.com/sports/2025/11/12/FB_1112255434.aspx). No divisions; the two teams with the best conference win pct play for the title, and non-conference games don't count. The page lists a two-team and a more-than-two-team procedure that come to the same steps on the engine. `spots: "open"` ("two teams superior after any step" both go), `drop: "restart"`, no game-count rule. A tie is broken by the first step that tells the teams apart:

a. Head-to-head. Two teams: their game. Three or more who all played each other: the combined record among them. Otherwise a team that beat every other tied team advances; otherwise go on.
b. Win pct against all common opponents.
c. Ranking: SportSource Analytics Team Rating Score after the regular season, modelled by the ranking stand-in. Unlike the Big Ten, this comes before order of finish.
d. Win pct against common opponents by order of finish, down the standings. The page says order of finish is "with ties broken", so opponents level on record are placed by head-to-head (the SEC's reading), those it can't separate counting as one group.
e. Combined conference win pct of conference opponents (strength of schedule, the Big 12's step).
f. A draw by the Commissioner or designee.

Assumed, not stated on the page: a step that cuts a tie down starts over among the teams left, as for every other conference. Sacramento State, a football-only member from 2026, can't play for the MAC title in its first two seasons (ESPN, February 2026), so it is `ineligible`. Proofs count the ranking and the draw as luck; the likeliest-way note says "depending on the ranking tiebreak".

### Outlook (`outlook.ts`)

For each conference team, `seasonOutlook` gives:

- the record so far, with locks counted as played;
- `titleGame`: the share of seasons it plays in the title game;
- `title`: the share of seasons it wins the title game. That game is a neutral-site game using the simulated ratings;
- `status`: clinched, eliminated or alive, from the proof;
- `title`: when the data already has the title game between the two teams the rules pick, its result decides, as in the national simulation.
- `playoff`: **experimental**, not the committee (the committee stand-in replaces it with stage 4). The conference champion always gets in. Any other FBS team gets in when it ranks in the top 11 by `wins − 1.5·losses + rating/10`.
- `atLarge`: the share of seasons it gets in without winning the conference. 0 means it must win the conference (`mustWinConference`), and the app shows "Must win ACC" instead of a playoff percentage. Never for a Group of Six team.
- `groupOfSix`: the season's format has the Group of Six bid (2026 on) and the team is in a Group of Six conference. Its conference title is no automatic bid, so `mustWinConference` is false, and `playoffRoute` gives the wording the app shows under its playoff odds: "Gets in as the highest-ranked Group of Six team, conference champion or not". Null for everyone else.
- The national run behind a Group of Six conference's odds plays the power conferences' title games and its own; an earlier run passed as `reuse` that covers those (the app's, with every supported conference) is used as it is.
- `games` (only for `OutlookOptions.teamId`): its title-game and playoff odds if it wins or loses each unplayed game. Each simulated season is replayed with only that game flipped (the title race rerun, ranking included), so the numbers equal what picking that result shows. A lock changes only its own game's draw, which is what makes this exact. Splitting the seasons by how the game went instead would be biased: seasons where a team loses lean toward seasons it drew a weak rating, so it also loses more of its other games.

### Proofs (`proof.ts`)

Exact checks, not Monte Carlo. Can the team still miss, or still make, the title game under some combination of the remaining conference results, its own included?

- A depth-first search over the remaining conference games. A branch stops early once a matching argument settles it. The budget is 30,000 nodes per check.
- If the search runs out of budget, the answer is "open". It never gives a false clinch or elimination.
- **One pool per page:** apart from the root proof (150,000 nodes), a tree's proofs (branches, game sides, locked games' full proofs) share 250,000 nodes, each check taking at most its own budget from what's left. Each locked game first gets a quick 3,000-node check of its own, outside the pool. A team its proofs can't settle (Penn State and Rutgers, 2026) would otherwise spend a full budget on every one, about 40 s a page. Once the pool is empty the rest are "open", so those branches show their odds (">99%", "<1%") instead of In or Out. Which branches those are depends on the order the tree asks: earlier proofs use up the pool, so a cheap one late in the walk can come back open. The pool was sized from 2026 data, above what every ACC, Big 12 and SEC page used then (the most, Auburn: 212,000), so those pages didn't change; another season or a page with many locks can still run it dry.
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

`explore` is everything the explorer page shows for one team, from one shared simulation: the outlook, the path, the tree and `playoffGames` (below). The tree's larger proof budget overrides the outlook's status for that team.

### National view and playoff signals (`view.ts`)

- `nationalView(national, { bubble })`: null without a playoff run. The projected field is the teams with the best field odds, as many as the format takes, ordered by their average seed in the seasons they get in. Each spot: field odds, the share at exactly that seed, bye and title odds, and "In 92% · seed 3 in 31%". The bubble (default six) is the next teams by field odds ("In 4%", one decimal under 1%). The bracket is `bracketGames` over the projected seeds, each game with its round (First round, Quarterfinal, Semifinal, Final), its sides (a seed and team, or the winner of an earlier game) and "At the higher seed" or "Neutral site".
- `playoffSignals(season, sim, national, teamId, max = 8)`: unplayed games not involving the team whose result clearly moves its playoff-field odds (the `OVERALL` bar in `signal.ts`, on the split of `sim`'s seasons by who won), biggest swing first, each with "Root for Utah over BYU: 34% if Utah wins, 22% if BYU does." `sim` must be the simulation `national` ran on; otherwise, or without a playoff, it is empty. Cost: two passes over the iterations, small next to the national pass.

## App (`src/app`)

- `/national`: the projected playoff field with each spot's odds, the bubble and the projected bracket, built at build time from the base national run (`nationalView`). Linked from the explorer header as "Playoff field".
- `/`: team list. `/team/[id]`: the explorer for that team (`ExplorerPage`, `explorer/*`). Each team page's title names the team ("Utah · Mathematically Alive"). Any other URL, including a team in a conference not covered yet, gets a branded 404 (`not-found.tsx`) that names the covered conferences.
- The first numbers are computed at build time. What-ifs run in a Web Worker (`sim.worker.ts`) so the main thread never blocks. Explore's worst case is about 2.6 s.
- Panels:
  - Team list with odds. One tab per supported conference (the team's own selected), and a search that looks through every conference.
  - Stat tiles: title game, title, playoff and if-win-out.
  - The season by week. Own-game buttons and elsewhere chips can be clicked to lock a result. Each own game (conference or not) is a small table: Win and Lose rows under ACC and CFP columns, the chance to win (kept after the game is picked), and a "Non-con" tag on non-conference games. A picked win fills green, a picked loss red. Each elsewhere game shows both sides' chance to win under its buttons. Each number is what picking that result would show (see `games` above). Non-conference games show "—" in the conference column for the ACC, the SEC and the Big Ten, where they move the title race only slightly, through the ranking tiebreak. In the Big 12, whose total-wins step counts them, they show the title odds either way. For a team that must win the conference, conference cards drop the CFP column. Its non-conference cards keep it so they stay pickable and a pick on them stays visible. Final results, byes and the tables are all the same height, so the weeks line up.
  - The race table.
  - The "What <team> needs" card, from the likeliest way in (a line says so): the team's own part, then help from elsewhere, one row per team with its needed results counted ("2 losses, 2 wins") and grouped: loses to (teal), beats (green), either way (dashed). "Fill in the likeliest way" picks all its results; the card then shrinks to a bar with Undo. It can also be minimized to one line ("Win out, Utah and Kansas each lose twice").
  - "Results elsewhere for the playoff" under the weeks: `playoffGames`, recomputed with each what-if in the worker.
  - The header shows "Through <day of the latest final game>", with the fetch time on hover.
- **Brand:** see `CLAUDE.md`. Space Grotesk and Inter; navy, turf, marker and mist colors; light-only.

## Constraints

- CFBD free tier only. No paid services. The repo owner deploys; agents don't deploy or touch DNS.
- Never print or commit secrets (the CFBD key, tokens).
- Every behavior change in `src/core` ships with black-box tests (`tests/blackbox`, importing only `@/core`). The coverage gate is 85% (`.claude/skills/coverage-gate/gate.sh`) and must not be lowered without asking.
- The repo owner merges PRs.

## Known limits and open ideas

- The team page's playoff odds come from the national pass (phase 5): field, bye and national title, and each own game's Win/Lose CFP columns, paired with the locks they stand for. Seasons the national pass can't run (no format, a field needing every conference's champion, a power conference without rules) keep the rough top-11 estimate.
- CFBD flagged title games as conference games before 2025. If a 2026 title game comes in flagged that way, the standings would count it as a conference game; the 2025 rows are flagged non-conference.
- Ranking is a stand-in for SportSource.
- Proofs and the likeliest search have budgets. Near the edge they say "open" or return null rather than guess.
- The app covers the ACC, the Big 12, the SEC, the Big Ten and the MAC. Three of the Big Ten's rules are assumed until the Big Ten's full document is available again (common opponents level on record count as one group; no team is dropped for losing to all the others; a tie of three or more, once cut down, starts over at head-to-head).
- **Expanding conferences.** The power four are all in. Next: the rest of FBS (`docs/plan-national.md`).
- **Group of Six, in progress.** The 2026 format guarantees a spot to the highest-ranked Group of Six team, whether or not it won its conference (the 2024–2025 formats took the highest-ranked champions). The national pass applies that rule. The MAC's title game is simulated and its teams have pages with that wording; the American, Conference USA, Mountain West, Pac-12 and Sun Belt are next (the Sun Belt has divisions, the Mountain West a transitioning member, the American a computer-composite step). The champion weight in the stand-in still goes only to power-conference champions, and the field doesn't yet leave out teams barred from the postseason (Sacramento State in 2026–2027) from the Group of Six bid.
- A future MCP server is planned on top of `src/core`.
