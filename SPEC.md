# Mathematically Alive: spec

What the app is, how its numbers are made, and the rules the code follows. Read this with `CLAUDE.md`, which covers layout, testing rules and the checks a change must pass.

## What it is

A Next.js site. Pick a college football team and see what has to happen for it to reach its conference championship game. A team's page uses its own conference; the supported ones are listed in `SUPPORTED_CONFERENCES` (`src/app/config.ts`): the ACC, the Big 12, the SEC, the Big Ten, the MAC (CFBD's "Mid-American", the first Group of Six conference; see conference names below), CUSA ("Conference USA"), the Mountain West, the American ("American Athletic"), the Pac-12 (shown "Pac 12") and the Sun Belt, the last two Group of Six conferences. The FBS independents (Notre Dame and UConn in 2026) have pages too, about the playoff alone: they have no title game. A playoff estimate exists but is experimental.

It answers three questions for the picked team:

1. **How likely is it?** Title-game and title odds from simulated seasons.
2. **Is it settled?** "In" (clinched) and "Out" (eliminated) are proven exactly, never inferred from odds.
3. **What has to happen?** Its own remaining games, games elsewhere that help or hurt it, and the likeliest combination of results that gets it in.

Users can lock results ("what if Miami loses to Wake Forest?") and every number updates.

## Data

- **Source:** CollegeFootballData (CFBD) free tier. Teams, games, betting lines, SP+ ratings. `scripts/fetch-season.ts` (`pnpm data [year]`, the year defaulting to the season being played) makes 5 API calls (teams; every FBS game, regular season and postseason; betting lines for both; SP+ ratings; the polls, of which only the committee's, "Playoff Committee Rankings", is kept) and writes the national snapshot, `data/season-<year>.json`: raw CFBD rows, one per line in id order, so a refresh's diff shows what changed. The postseason rows bring the playoff games, each with CFBD's `playoff` field (round, bracket slot and both teams' seeds) once its matchup is set; CFBD lists a postseason game only then (none for 2026 on Nov. 8). It needs `CFBD_API_KEY` (in `.env.local`, or the repository secret in the refresh job). The key is build-time only and must never reach the client or a log.
- **Snapshot:** committed. `.github/workflows/refresh-data.yml` refreshes it in season (August to January), Sunday 12:00 UTC once Saturday's games are final and Wednesday for the week's lines, plus Sunday 23:00 UTC in December, after the committee announces the field (Dec. 6, 2026, about 17:00 UTC): 10 CFBD calls a week, 15 in December, well inside the free tier's 1,000 a month; it can also be run by hand with a year. It fetches, refuses a partial response (`checkFetch`: no teams or games, or any list, the committee rankings included, down more than 5% from the committed snapshot of the same season, so a lost game or two still goes through), runs `pnpm build` (so the checks below and every team page must pass), and commits the snapshot to `main` when anything besides the fetch time changed. The host's git deploy ships it. A bad snapshot fails the job and is never committed.
- **Build:** `scripts/build-data.ts` turns the newest `data/season-<year>.json` into `src/app/data/season.json`, which is gitignored. So `next build` and CI never need a key. It runs before `lint`, `typecheck` and `build`. It fails unless `checkSnapshot` (`snapshot.ts`) passes for the supported conferences and the independents (`INDEPENDENTS`, "FBS Independents", which need neither check): every supported conference has a full schedule (each member plays a conference game against another member) and tiebreak rules for the season. It lists every other FBS conference in the snapshot as not supported. With the whole 2026 season in the snapshot (888 games, through week 11), `pnpm build` takes about 110 s on a laptop, nearly all of it rendering the 71 team pages, and one team's `explore` has a median of 2.9 s (Penn State and Rutgers about 13 s). Simulating the other conferences' games costs about 0.3 s of that median; the merged week-9 fixtures took 85 s and 2.2 s.
- **Model:** `src/core/season.ts`, via `seasonFromCfbd`. A `Season` has teams (id, conference, FBS or not, colors, SP+ rating), regular-season games (week, kickoff, neutral site, conference game, home/away, score once completed, spread, and `titleGame` for a conference title game), `playoffGames` (the College Football Playoff games CFBD lists, each with its round and the two teams' seeds; other bowls are dropped) and `committeeRankings` (each committee ranking, team ids best first). A row with no team yet is skipped.
- **Title games:** `seasonFromCfbd` marks each conference's title game and makes it a non-conference game, whichever way CFBD flags it (a conference game before 2025, not from 2025), so it never counts in the standings or a tiebreak. `findTitleGame`: a game between two members whose CFBD note says "Championship" ("SEC Championship"; every 2025 title game has one); otherwise, from the schedule, the only game between members in the latest week that has any (or the only one there at a neutral site), provided it comes after both teams' conference schedules: a game that leaves both teams short of the median member's count of games against members, or either one two short, is a last-week or postponed game, not the title game. Without that check, before the title game is listed, the last week's only neutral-site game (Michigan State-Maryland at Ford Field, 2025 Big Ten; also 2015 and 2023 Big Ten, 2018 Big 12, 2024-2025 CUSA) or a postponed game alone in title week (2018 and 2021 Pac-12, 2022 MAC) was taken for it, in `fixtures/cfp-<year>.json`. 2020 skips the check (COVID-19 left schedules too uneven). A conference of two teams (the 2024-2025 Pac-12, which played twice) has none from the schedule; Army-Navy and the Pac-12's flex games are never one. Checked on every conference's 2014-2025 title games (all found, 2020 included) and with them removed (none found outside 2020). Army-Navy is a non-conference game: CFBD flags it a conference game because both are American members (Army for football since 2024), but it isn't one of the American's eight conference games and is played the week after its title game. The Pac-12's 2026 week-13 flex games, between two members, are non-conference games too (the league counts them out of the standings); until the data lists a member's week-13 game, its projected pairing stands in (unplayed, Nov. 28, a negative id; see the Pac-12 below).
- **Postseason bans:** `Team.postseasonBan`, set by `seasonFromCfbd` from a per-season list of barred schools (`POSTSEASON_BANS`, `season.ts`). None in 2026: Akron's 2025 Academic Progress Rate ban was lifted by an NCAA waiver in March 2026, and teams moving up to FBS are eligible at once (NCAA Division I Cabinet, June 24, 2026). A barred team's games count for everyone, in the standings, every tiebreak step and the ranking, but it never plays in a title game (`championshipParticipants` picks among the rest, within its division where there are divisions), the proofs and the likeliest-way search don't count it as a rival, and `playoffField` skips it, so the next team takes its at-large spot or the Group of Six bid. Its outlook has `postseasonBan`, it is Out (eliminated), `playoffRoute` says "Barred from the postseason this season: no title game, no playoff", and its path's summary says so. A conference with fewer than two eligible teams, or a division with none, is an error.
- **Committee rankings:** `fixtures/cfp-<year>.json` (2014–2026), made by `pnpm cfp`: see the committee stand-in below.
- **Fixtures:** `fixtures/national-2025.json` (every FBS game of 2025, postseason included, trimmed to the fields `seasonFromCfbd` reads, with ratings and the committee's rankings; `pnpm fixture 2025 national`) is the end-to-end postseason test: title games, selection-day ranking, field and bracket. `fixtures/acc-2025.json` and `fixtures/big-12-2025.json` (full season), and `fixtures/acc-2026.json` and `fixtures/big-12-2026.json` (mid-season, through week 9), are raw snapshots made by `scripts/make-fixture.ts` (`pnpm fixture [year] [conference]`). Never hand-edit them. They are for tests only; the app is built from the national snapshot.

## How the stats work

All logic lives in `src/core` (framework-free, public API in `src/core/index.ts`). Everything is seeded, so the same inputs always give the same numbers. There is no `Math.random()` in the core.

### Single-game odds (`odds.ts`, `sim.ts`)

- Final margins are taken as normal around the spread, with SD `MARGIN_SD` = 15.5 points. `winProbability(spread)` is the normal CDF.
- When a game has a spread, that spread is used. Otherwise one is derived from the SP+ rating difference plus 2.5 points of home field (`HOME_FIELD`), with none at a neutral site. A missing rating counts as 0 for FBS teams and −10 for others.

### Season simulation (`sim.ts`)

- Monte Carlo: every unplayed game is played out over many seasons. The core takes the count and seed as options; the app sets them in `src/app/config.ts` (`ITERATIONS` = 20,000, `SEED` = 2026). Completed games are never changed. Locked games always go to the locked winner.
- **Rating shift:** in each simulated season, each team's rating moves by one normal draw (`SHOCK_SD` = 4) that is shared by all its games. A team that is better than its rating tends to win more of them. The per-game SD shrinks to match, so a single game's odds still equal what the spread says.
- **Ranking stand-in:** the SportSource Team Success Ranking (a tiebreak step) is modelled as the rating plus `RANK_PER_NET_WIN` = 2 per net simulated win, plus noise (`RANK_SD` = 3); Army-Navy, after every tiebreak, doesn't count, nor do the Pac-12's flex games, played after its title-game teams are set. It comes from one hashed draw per team and season, which the title game reuses.
- Tiebreak draws and title-game rolls come from streams seeded per iteration and per conference (a salt hashed from the conference's name), so what-if runs stay paired with the base run and two conferences never share a draw. That means differences come from the lock, not from noise.

### National simulation (`national.ts`)

`simulateNational(season, { iterations, seed, locks, conferences })` runs phase 4's stages 2 to 5 (`docs/plan-national.md`) on every simulated season of `simulateSeason`, which is stage 1:

- **Stage 2, title games.** Each listed conference's rules pick its two teams, and the game is played at a neutral site with the season's simulated ratings. Once the data has the title game between those two teams, its result decides instead (final, locked, or simulated as a scheduled game). Once every conference game is final and the data marks the title game (`ConferenceData.decided`), its two teams play whatever the rules say (the real ranking or coin toss can differ from the stand-in's): the national pass, the outlook, the path and the proofs (its teams clinched, everyone else eliminated) all go by it. `championshipParticipants` still applies the rules alone, so tests can check them against real title games. `seasonOutlook` plays its title game the same way, from the same streams, so a conference's title-game and title odds are the same in both. A conference with no tiebreak rules for the season is an error. Every FBS conference has rules in 2026; a conference left out of `conferences` has no title game simulated, and its teams' `titleGame` and `champion` are null. A Group of Six title game counts in its teams' records and strength of schedule, but no Group of Six champion gets the champion weight below; under the 2026 format the Group of Six bid goes by ranking, not by title.
- **Stage 3, committee stand-in ranking** (`committee.ts`). Every FBS team is scored on the season's simulated record (title game included; Army-Navy, played after the field is picked, left out, so Army's and Navy's pick of it shows their odds unchanged either way), its simulated rating (rating plus the season's shift), strength of schedule (its opponents' average rating) and a power-conference title, then ordered best first. Each team's score gets one standard Gumbel draw per season, hashed from (seed, iteration, team), which gives any two teams the pair odds the model was fitted on.
- **Stage 4, playoff field** (`playoff.ts`). The season's format (`playoffFormat(year)`, each one cited) picks and seeds the field from the stand-in's ranking and the simulated champions; `playoffField(season, ranking, champions)` does the same for any ranking. Once the committee has announced the field (`announcedField(season)`), every simulated season uses it (`NationalResult.announced`):
  - Source: CFBD's playoff games, whose `playoff.homeSeed` and `awaySeed` give the seeds (CFBD's /games, postseason, from 2024), when they name all of them (`source: "bracket"`).
  - Otherwise the committee's selection-day ranking (CFBD's /rankings, "Playoff Committee Rankings": the first one with a week after the title games, every title game the format needs final; 2025's is week 16) under the season's format, with the data's title-game winners as champions (`source: "ranking"`). Teams past its 25 follow in the stand-in's order, so an unranked power champion with an automatic bid (2026 rules) is seeded last. Seeds the playoff games already name stand; CFBD may list the first round before the quarterfinals, whose teams have byes. On 2025 data it gives the field the committee announced, under the 2025 format, from the ranking alone or with only the first round listed.
  - Before either, the field is simulated.
  - 2014–2023: the top four, 1 vs 4 and 2 vs 3.
  - 2024: 12 teams, the five highest-ranked conference champions plus seven at-large; the four highest-ranked champions are seeds 1–4 with byes.
  - 2025: the same bids, straight seeding by ranking.
  - 2026 (CFP Management Committee; no rule document is published, so the citation is the SI, Front Office Sports and NCAA.com reports of January–February 2026): the ACC, Big 12, Big Ten and SEC champions; the highest-ranked Group of Six team, champion or not; Notre Dame when it ranks in the top 12; then at-large by ranking. Straight seeding, top four with byes.
- **Stage 5, bracket.** First round 5–12, 6–11, 7–10, 8–9 at the higher seed (2.5 points of home field); quarterfinals, semifinals and the final at neutral sites (1 meets the 8/9 winner, 2 the 7/10, 3 the 6/11, 4 the 5/12; the 1 and 4 sides meet in a semifinal; no reseeding). Each game is played at the season's simulated ratings with one uniform draw hashed from (seed, iteration, bracket game). With the announced field, a playoff game the data has as final decides its game in the bracket; the rest are simulated from the real bracket, so national-title odds follow the playoff through January. Playoff games can't be locked. Each team's `NationalPlayoff.run` (`PlayoffRun`): its seed, `state` ("in", "out" when not selected or beaten, "champion") and a sentence ("Seed 10 in the playoff: beat Ohio State 24-14 in the quarterfinal", "Seed 1 in the playoff: won the national title, 27-21 over Miami", "Not selected for the playoff"); null before the field is announced.
- The playoff stages run only when the format's champions are simulated: every power conference must be in `conferences` from 2026, and the 2024–2025 formats need every conference's champion, so those seasons get none (`NationalResult.playoff` is false and every team's `playoff` is null). Four-team seasons need no champions.
- Per FBS team: `titleGame` and `champion` shares, `meanRank`, the shares of seasons in the stand-in's top 4, 12 and 25, and `playoff`: shares in the field, with a bye, at each seed, and reaching the quarterfinals (null in a four-team format), semifinals, final and title. `forEachIteration` replays each season's title games, full ranking, field and national champion.
- What-ifs stay paired: a lock changes only its own game's draw, so seasons where that game already went the locked way come out the same.
- Cost on the 2026 snapshot at 20,000 iterations, on top of the regular season (0.4 s): about 1.25 s for the four power conferences' title games and the ranking (0.35 s of it the ranking), and about 0.25 s more for the field and bracket, so a national pass is about 1.8–1.95 s, inside one team page's median. Phase 5 runs it on every team page: `explore` shares one `simulateSeason` between the outlook and the national pass, the national pass replays each of the focus team's games the other way (only the title races that game's teams are in), and `reuse` copies an earlier run's title races that no changed lock touches and starts each season's sort from its ranking. The worker keeps its last run and warms one at load; the build reuses one base run. Measured (12-team sample, 20,000 iterations): one team's `explore` median 2.62 s before, 3.78 s cold and 3.29 s for a what-if reusing the last run after; `pnpm build` 92 s before, 108 s after. Measured when stages 4–5 landed (same machine, two runs each): one team's `explore` median 2.87 s and 2.49 s before, 2.47 s and 2.74 s after (noise; the page doesn't run the national pass), `pnpm build` 89 s before, 92 s after. Measured when stages 2–3 landed: one team's `explore` median 2.83 s before, 2.93 s after (the draw streams changed, the work didn't; Penn State and Rutgers about 13.5 s both times), `pnpm build` 108 s before, 104 s after.

### Committee stand-in (`committee.ts`)

A modelled ranking, not the committee's. `committeeRanking(season, { throughWeek, champions })` ranks every FBS team from completed games by `score = 0.953·wins − 1.419·losses + 0.123·rating + 0.414·strength + 0.744·champion` (`committee-weights.ts`). Strength is the average rating of the opponents played (a missing rating is 0 for FBS teams and −10 below FBS). Champion means a power-conference champion (ACC, Big 12, Big Ten, SEC, and the Pac-12 through 2023); by default, the winner of each one's title game once played.

- **Fitting:** `pnpm cfp` (`scripts/fetch-cfp.ts`, 4 CFBD calls a season) writes `fixtures/cfp-<year>.json`: every committee ranking of the season with a trimmed snapshot of its games and SP+ ratings. `pnpm fit-committee` (`scripts/fit-committee.ts`, no API calls) fits the weights by maximum likelihood on each season's latest ranking (the final one for 2014–2025, the first of 2026, released Nov. 3 after week 9): the committee puts a above b with probability `1 / (1 + e^−(score a − score b))`, over every pair the ranking orders (ranked over ranked, ranked over unranked), each ranking weighted equally, with a small ridge penalty. Features come from games before the ranking's week.
- **Fit (in-sample):** its top 12 holds 10.8 of the committee's top 12 on average (at least 9 every season) and at least 3 of the top 4 every season. The old placeholder score (`wins − 1.5·losses + rating/10`) holds 8.9. `tests/blackbox/committee.test.ts` holds it to at least 9 every season, 10.5 on average and 3 of the top 4.
- **Limits:** past seasons use final SP+, which includes bowl games played after the ranking. Title games are the ones `seasonFromCfbd` marks (see title games under Data; the trimmed `cfp-<year>.json` rows have no notes, so these come from the schedule); the Big 12 had none in 2014–2016, and the 2020 Pac-12 game isn't found. Group of Six champions get no champion weight.

### Tiebreakers (`tiebreak.ts`, `steps.ts`, `rules.ts`)

One engine serves every conference. `rules.ts` holds a config per conference and season: the step list, the resolver settings, the game-count rule, the luck wording and the source document. A conference or season with no config is an error ("No tiebreak rules for <conference> in <season>"), never another conference's rules. `hasTiebreakRules` says whether one exists, and `checkSnapshot` fails the build for a supported conference without one. Only 2026 configs exist (ACC, Big 12, SEC, Big Ten, MAC, CUSA, Mountain West, American, Pac-12, Sun Belt): the project covers the 2026 season only. Tests that check real 2025 title games load the 2025 fixtures as 2026, so they run under the 2026 rules.

- **Steps** (`steps.ts`): head-to-head (by games or by opponent, with or without dropping a team that lost to all; when not all played each other, a team that beat all the others is ahead unless `beatAll: false`), common opponents, highest placed common opponent (opponents level on record grouped, or ordered by head-to-head; optionally a group counts only when every tied team played all of it, or only the tied teams' division counts), common opponents outside the tied teams' division, strength of schedule, opponents' win pct, division win pct, total wins and overall win pct (FCS cap: a win past it is left out of both counts; or against FBS teams only; the title game left out), capped relative scoring margin, ranking, draw. One implementation each. Any score that can tie as a fraction is kept in whole numbers and compared exactly, so scores equal as fractions always tie (a float sum can round them apart).
- **Resolver:** teams are ordered by conference win pct, and a tie is resolved for the open spots. Each step either can't tell the tied teams apart (next step), or names the teams at the top of its order. One alone at the top is placed and the rest start over for any spot left. Several at the top that fit the open spots are all in, seeded by starting over among them. Otherwise those at the top start over, from the first step or from the next one as the step says, and the rest are out of the tie. A config may give two-team ties their own procedure (`twoTeam`, the Pac-12's): `spot` steps when two are tied for one spot (a bigger tie cut to two included, starting from its first step), `seed` steps when both are in and only their order is open. Divisions (`divisions`, the Sun Belt's, by school name): each division's champion plays, the best conference win pct in the division with a tie broken for one spot among its teams; the champion with the better conference win pct is seeded first, a tie broken by the `seed` steps. `cut: "continue"` sends the teams at the top of a split on to the next step instead of starting over. Settings: `spots` ("open": the tie fills every open spot at once; "one": one spot at a time, the rest re-tied from scratch after each) and `drop` (a dropped team leaves only this tie, or the whole race with a re-tie).
- A step marked `nonConference` (total wins) counts non-conference results: `countsNonConference` follows from it, and proofs skip it as luck.
- Proof shortcuts that rely on the ACC's game-count rule (`couldTieByCount`, the tie route, the schedule-spread check) apply only where the config has `gameCountTies`.
- With divisions, proofs and the likeliest-way search go by the team's division (`race`): one spot among its division's teams, every team's win pct still over all its conference games. "Two teams ahead" becomes one division rival ahead, and "no two others can catch it" becomes no division rival can.

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

Assumed, not stated on the page: a step that cuts a tie down starts over among the teams left, as for every other conference. Sacramento State, a football-only member new to FBS in 2026, can play for the MAC title: the NCAA Division I Cabinet made teams moving up eligible at once (June 24, 2026), lifting the two-season wait announced when it joined (ESPN, February 2026). Proofs count the ranking and the draw as luck; the likeliest-way note says "depending on the ranking tiebreak".

**Conference USA** ("CUSA Football Championship Game Tiebreaker Policy", September 2024, the latest published: https://s3.amazonaws.com/sidearm.sites/conferenceusa.com/documents/2024/9/19/CUSA_FB_Championship_Game_Tiebreaker_Policy.pdf). No divisions; the two teams with the best conference win pct play, non-conference games don't count. Shown as "CUSA". `spots: "open"`, `drop: "restart"` ("if at any point the tie is broken in a multiple team tie, the remaining teams will begin the process again at step #1"), no game-count rule. Steps:

a. Head-to-head, as the MAC's.
b. Win pct against common conference opponents.
c. Record against common opponents by order of finish, down the standings. A tied group in the standings is "evaluated collectively" (the Big 12's reading: opponents level on win pct are one group).
d. Average computer ranking (Connelly SP+, SportSource Analytics, ESPN SOR, KPI), modelled by the ranking stand-in.
e. Cumulative conference win pct of all conference opponents (strength of schedule).
f. Coin toss by the Commissioner or designee.

Not modelled: section C, which ties a team short a postponed game with the leaders when it is within one win and level on losses. Teams not bowl eligible "due to transition status, NCAA sanctions" can't play; Delaware and Missouri State, in their second FBS season, are eligible in 2026. Proofs count the ranking and the draw as luck.

**Mountain West** ("Mountain West Football Championship Tiebreaking Procedures", Aug. 1, 2023, the latest published: https://storage.googleapis.com/themw-com/2023/09/ec9093ac-2023-mw-football-championship-tiebreakers-final.pdf). No divisions; the two teams with the best conference win pct play. Shown as "Mountain West", "MW" where space is tight. `spots: "open"` (three or more tied: "the two highest-ranked tied teams" go at the ranking step, and the process runs "until one or more teams gain an advantage"), `drop: "restart"`, no game-count rule. Two-team and multi-team steps are the same:

a. Head-to-head (three or more: the mini round-robin when all played each other, otherwise one that beat all the others is in).
b. The CFP ranking of Nov. 21 for a ranked team that wins on the final weekend, otherwise a composite of selected computer rankings (SP+, ESPN SOR, KPI, SportSource). Both modelled by the ranking stand-in.
c. Overall win pct against all opponents, at most one FCS win counted (a win past the cap is left out of both wins and games: an assumption, the document doesn't say). It counts non-conference games, so proofs treat it as luck, like the Big 12's total wins.
d. Record against the next highest placed team down the standings; lower teams level on win pct are one position. A position some tied team didn't play in full is skipped (the document's a and b); past the lowest team, the next step.
e. Win pct against common conference opponents.
f. Coin toss (two teams) or drawing (three or more) by the Commissioner.

Teams ineligible for a bowl under NCAA or Mountain West rules can't play. North Dakota State, new to FBS in 2026, is eligible: the NCAA Division I Cabinet made teams moving up immediately eligible for conference title games, bowls and the CFP from 2026 (June 24, 2026). Not modelled: the host (the better seed is listed first). Proofs count the ranking, overall win pct and the draw as luck; the likeliest-way note says "depending on the ranking tiebreak and overall win pct".

**American** ("American Conference Football Tiebreakers", 2025, Section 10: Conference Champion Determination, the latest published; the PDF `25_FB_Tiebreakers.pdf` linked from https://theamerican.org/news/2025/11/23/FOOTBALL_Tiebreaker.aspx). CFBD's "American Athletic"; the conference dropped "Athletic" in 2025 and is shown as "American". No divisions; each team plays eight conference games, and the two with the best conference win pct play. `spots: "open"` (the ranking step sends "the highest-ranked team or teams"), `drop: "restart"` ("if only two teams remain tied after any step, the two-team tie procedures shall be used"), no game-count rule. Two-team (10.5) and multi-team (10.6) steps are the same:

a. Head-to-head (three or more: the mini round-robin when all played each other, otherwise one that beat all the others is in).
b. The CFP ranking going into the final weekend, for a ranked team that doesn't lose that weekend; otherwise a composite average of selected computer metrics (Connelly SP+, SportSource TR116 SOR, ESPN SOR, KPI) after the final weekend. Both modelled by the ranking stand-in.
c. Win pct against all common conference opponents.
d. Overall win pct, conference and non-conference, with no cap on FCS wins. It counts non-conference games, so proofs treat it as luck.
e. Coin toss (two teams) or drawing by the Commissioner.

Army-Navy counts in neither the standings nor the overall record (see the data model). Not modelled: 10.4, the unbalanced-schedule rule (seven conference games to be eligible; a team short a game that is level in the loss column and beat every team it tied with goes ahead), "exempt games", which the document leaves out of overall win pct and the engine counts, 10.7 (an ineligible participant; none in 2026) and the host (the better seed is listed first). The title game in the data is found leaving Army-Navy out (`titleGameIndex`). Proofs count the ranking, overall win pct and the draw as luck; the likeliest-way note says "depending on the ranking tiebreak and overall win pct".

**Pac-12** ("Pac-12 Football Championship Game Tiebreakers", in "Pac-12 announces commercial and operational updates ahead of its 2026 football season kickoff", Sept. 3, 2026: https://pac-12.com/news/2026/9/3/pac-12-announces-commercial-and-operational-updates-ahead-of-its-2026-football-season-kickoff.aspx). Eight members, no divisions: a seven-game round robin in weeks 5–12, and the title-game teams are set after week 12 (Friday, Dec. 4, at the higher seed's home). Week 13 is a flex week ("The new Pac-12 announces its 2026 football schedule", Feb. 11, 2026): each member plays another, a game that doesn't count in the standings. The league projected Boise State at Utah State, Texas State at Colorado State, San Diego State at Fresno State and Oregon State at Washington State, its home teams fixed, to be confirmed six days before at the latest and changeable for CFP considerations. `titleGameIndex` never takes a flex game for the title game, even one left alone in the latest week by data listing only some of them. Until the data has a member's week-13 game, the projected one stands in, marked `projected` and shown with a "Projected" tag. Flex games count in the overall record, the committee stand-in and the field, not in the standings or the ranking tiebreak, so a flex pick moves a team's playoff odds but never its title-game odds.

Two procedures. `spots: "one"` ("once one team gains an advantage and is seeded, the remaining teams will restart"), `drop: "restart"`, no game-count rule.

- Two teams (`twoTeam`): tied for first, both play and the head-to-head winner is seeded first. Tied for a spot (for second, or a bigger tie cut to two: "if the process reduces the tie to two teams, the two-team procedure will then be applied"): (a) win pct against the next-highest-placed common opponent down the standings, a level group counted as one; (b) win pct against all common conference opponents; (c) the CFP ranking the Tuesday before week 13, then (d) the SportSource Team Rating Score after the last conference weekend, both modelled by the ranking stand-in; (e) coin toss. Head-to-head isn't one of them. Seeding two teams whose game wasn't played goes on to (a)–(e) (assumed).
- Three or more: (a) head-to-head win pct among them, only when all played each other (otherwise the next step: no one is ahead for beating the others); (b) win pct against all common conference opponents; (c) the next-highest-placed common opponent, as above; (d) the combined conference win pct of conference opponents; (e) the SportSource score (the ranking stand-in); (f) coin toss.

In a full round robin a two-team tie is always decided by (a) or (b) (against common opponents the head-to-head loser is a game better), and a three-way tie that head-to-head can't split is level on common opponents too, so (c) decides. Not modelled: the host (the better seed is listed first). Proofs count the ranking and the draw as luck; the likeliest-way note says "depending on the ranking tiebreak".

**Sun Belt** ("Football Tie-Breaking Procedures", Sun Belt Conference, updated for 2026 with Louisiana Tech in the West: https://sunbeltsports.org/sports/2018/8/30/FB_Tie-Breakers.aspx). Two seven-team divisions ("Sun Belt Announces 2026 Football Schedule", March 13, 2026): East, App State, Coastal Carolina, Georgia Southern, Georgia State, James Madison, Marshall and Old Dominion; West, Arkansas State, Louisiana, UL Monroe, Louisiana Tech, South Alabama, Southern Miss and Troy. Each team plays its division and two teams from the other. A division champion is the team with the best win pct in all conference games, and the two champions play (Friday, Dec. 4, at the champion with the better conference record). Two-team and three-or-more ties use the same steps:

a. Head-to-head (two: their game; more: win pct in games among them; a division's teams all play each other).
b. Win pct in division games.
c. Win pct against the next-highest team in the final division standings, then on down; a level group counted collectively.
d. Win pct against common non-divisional conference opponents.
e. The CFP ranking going into the final weekend, for a ranked team that wins that weekend; otherwise a composite of computer rankings (SportSource, KPI, SP+, ESPN SOR). Both modelled by the ranking stand-in.
f. Overall win pct against FBS teams (games against FCS teams left out). It counts non-conference games, so proofs treat it as luck.
g. Coin toss (two teams) or lot (three or more) by the Commissioner.

A tie of three or more cut down doesn't start over: "the remaining teams will continue down the tiebreaker" (`cut: "continue"`). The champions are seeded by conference win pct; level, by the host tiebreaker: head-to-head, then the rankings (the ranking stand-in), then a draw. Not modelled: the ineligible-champion rule (no member is barred in 2026) and the host (the better seed is listed first). Proofs count the ranking, overall win pct and the draw as luck; the likeliest-way note says "depending on the ranking tiebreak and overall win pct".

### Outlook (`outlook.ts`)

For each conference team, `seasonOutlook` gives:

- the record so far, with locks counted as played;
- `titleGame`: the share of seasons it plays in the title game;
- `title`: the share of seasons it wins the title game. That game is a neutral-site game using the simulated ratings;
- `status`: clinched, eliminated or alive, from the proof;
- `title`: when the data already has the title game between the two teams the rules pick, its result decides, as in the national simulation.
- `titleResult`: once its conference's title game is final and it played in it, whether it won and "Beat Virginia 27-20 in the ACC title game" / "Lost to Duke 27-20 in the ACC title game"; null otherwise. `formatChampion` shows "Won" or "Lost" in place of its title odds.
- `playoff`: **experimental**, not the committee (the committee stand-in replaces it with stage 4). The conference champion always gets in. Any other FBS team gets in when it ranks in the top 11 by `wins − 1.5·losses + rating/10`.
- `atLarge`: the share of seasons it gets in without winning the conference. 0 means it must win the conference (`mustWinConference`), and the app shows "Must win ACC" instead of a playoff percentage. Never for a Group of Six team.
- `postseasonBan`: barred from the postseason this season (see the data model).
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

- Conference names: data and config keep CFBD's names; everything the user sees goes through `conferenceName` ("MAC", "Pac 12", "Sun Belt", "American", "CUSA", "Mountain West"; the rest as CFBD spells them) or, where space is tight (records, column labels), `conferenceShort` ("SBC", "MW").

All wording users see is made in the core so tests can check it. `formatTitleOdds(p, status)` and `formatSideOdds(p, status)` follow these rules:

- `formatTitleOdds` (title-game odds): proven clinched → "In", proven eliminated → "Out", else as side odds.
- `formatChampion` (the "Win <conference>" odds): "Won" or "Lost" once the team has played the title game, else side odds.
- `formatPlayoff` (playoff odds): "In" or "Out" once the field is announced, else side odds. `playoffDetail` then gives the seed and the national title as "Won", "Out" or its odds; `playoffRoute` and an independent's `route` give the run's sentence; `mustWinConference` is false.
- Path summary once the data's title game decides: "Miami plays Duke in the ACC title game, Dec 6." / "Virginia didn't make the ACC title game: Miami and Duke play for it."; once final: "Duke won the ACC title game, 27-20 over Virginia.", "Virginia lost the ACC title game to Duke, 27-20.", "Miami didn't make the ACC title game: Duke beat Virginia 27-20."
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

### Independents (`independent.ts`)

FBS independents (`INDEPENDENTS`, CFBD's "FBS Independents"; an FBS team with no conference counts too) have no conference title game, so their page is the playoff alone.

- `independentOutlook(season, opts, shared?)`: every independent, by name, with its record, expected wins, playoff field share and full playoff odds (`cfp`) from the national simulation, `postseasonBan`, and `route`: "No conference to win: gets in with a top-12 finish in the final ranking (an automatic bid), else at large" for Notre Dame under the 2026 format, "No conference to win: gets in at large" otherwise, the ban wording for a barred team. The national run plays the power conferences' title games, or an earlier run's (`reuse`) when it covers them; a season with no national simulation is an error. For `teamId`, `games` has its playoff odds if it wins or loses each unplayed game, each the national run replayed with only that game flipped, so it equals what picking it shows.
- `exploreIndependent(season, opts)`: everything its page shows: the outlook, its unplayed games in schedule order (date, opponent, site, "95%" if it wins and if it loses, "68% to win", `projected`), `playoffGames` and the national run, to reuse. Only for an FBS independent.

### National view and playoff signals (`view.ts`)

- `nationalView(national, { bubble, season })`: null without a playoff run. `heading` and `bracketHeading` say "Projected playoff field" and "Projected bracket" until the field is announced, then "Playoff field" and "Bracket" (`announced`); the announced view lists the real seeds, each spot's text its run ("National title 23%", "First-round bye · national title 31%" before a bye team's first game, "Beat Ohio State 24-14 in the quarterfinal · national title 41%", "Lost to Miami 24-14 in the quarterfinal", "Won the national title, 27-21 over Miami"), no bubble, and each bracket game's sides as the games feeding it are final and its `result` ("Indiana 38, Alabama 3") once played (from `season`'s playoff games). The projected field is the teams with the best field odds, as many as the format takes, ordered by their average seed in the seasons they get in. Each spot: field odds, the share at exactly that seed, bye and title odds, and "In 92% · seed 3 in 31%". The bubble (default six) is the next teams by field odds ("In 4%", one decimal under 1%). The bracket is `bracketGames` over the projected seeds, each game with its round (First round, Quarterfinal, Semifinal, Final), its sides (a seed and team, or the winner of an earlier game) and "At the higher seed" or "Neutral site".
- `playoffSignals(season, sim, national, teamId, max = 8)`: unplayed games not involving the team whose result clearly moves its playoff-field odds (the `OVERALL` bar in `signal.ts`, on the split of `sim`'s seasons by who won), biggest swing first, each with "Root for Utah over BYU: 34% if Utah wins, 22% if BYU does.", plus " A projected matchup, not yet confirmed." and `projected` for a projected game. `sim` must be the simulation `national` ran on; otherwise, or without a playoff, it is empty. Cost: two passes over the iterations, small next to the national pass.

## App (`src/app`)

- `/national`: the projected playoff field with each spot's odds, the bubble and the projected bracket, built at build time from the base national run (`nationalView`). Linked from the explorer header as "Playoff field". Once the field is announced it is the "Playoff field": the real seeds with each team's run, no bubble, and the bracket with each game's result; team pages show Playoff In/Out, the seed and the national title ("Won", "Out" or odds), and the title game's result under "Win <conference>" once it is final.
- `/`: team list. `/team/[id]`: the explorer for that team (`ExplorerPage`, `explorer/*`). Each team page's title names the team ("Utah · Mathematically Alive"). An independent's page is `IndependentExplorer`, in the same frame (header, team picker, columns). Any other URL (an FCS team, say) gets a branded 404 (`not-found.tsx`) that names the covered conferences and the independents.
- The first numbers are computed at build time. What-ifs run in a Web Worker (`sim.worker.ts`) so the main thread never blocks. Explore's worst case is about 2.6 s.
- Panels:
  - Team list with odds. One tab per supported conference, plus Independents (the team's own selected), wrapping chips with the short names ("MW", "SBC") and the full name on hover, and a search that looks through every conference. Conference rows show title-game odds; the independents' show playoff odds, under a "Playoff" header.
  - Stat tiles: title game, title, playoff and if-win-out.
  - The season by week. Own-game buttons and elsewhere chips can be clicked to lock a result. Each own game (conference or not) is a small table: Win and Lose rows under ACC and CFP columns, the chance to win (kept after the game is picked), and a "Non-con" tag on non-conference games, plus a dashed "Projected" tag beside the week's date (`labels.projected`; its meaning, `labels.projectedNote`, on hover and in the card's label read aloud) for a projected matchup (`Game.projected`, the Pac-12's flex week). An unplayed non-conference game gets its week even when the conference plays none that week (the Pac-12's week 13). A picked win fills green, a picked loss red. Each elsewhere game shows both sides' chance to win under its buttons. Each number is what picking that result would show (see `games` above). Non-conference games show "—" in the conference column for the ACC, the SEC and the Big Ten, where they move the title race only slightly, through the ranking tiebreak. In the Big 12, whose total-wins step counts them, they show the title odds either way. For a team that must win the conference, conference cards drop the CFP column. Its non-conference cards keep it so they stay pickable and a pick on them stays visible. Final results, byes and the tables are all the same height, so the weeks line up.
  - The race table.
  - The "What <team> needs" card, from the likeliest way in (a line says so): the team's own part, then help from elsewhere, one row per team with its needed results counted ("2 losses, 2 wins") and grouped: loses to (teal), beats (green), either way (dashed). "Fill in the likeliest way" picks all its results; the card then shrinks to a bar with Undo. It can also be minimized to one line ("Win out, Utah and Kansas each lose twice").
  - "Results elsewhere for the playoff" under the weeks: `playoffGames`, recomputed with each what-if in the worker.
  - The header shows "Through <day of the latest final game>", with the fetch time on hover.
  - An independent's page: its remaining games, each a Win and Lose table under one CFP column with its chance to win; "Results elsewhere for the playoff"; and on the right its playoff odds (with "Today" once picks are in), its route, bye and national-title odds and its picks. Phones pin playoff, bye and national-title tiles. What-ifs go through the same worker (`conference` null).
- **Brand:** see `CLAUDE.md`. Space Grotesk and Inter; navy, turf, marker and mist colors; light-only.

## Constraints

- CFBD free tier only. No paid services. The repo owner deploys; agents don't deploy or touch DNS.
- Never print or commit secrets (the CFBD key, tokens).
- Every behavior change in `src/core` ships with black-box tests (`tests/blackbox`, importing only `@/core`). The coverage gate is 85% (`.claude/skills/coverage-gate/gate.sh`) and must not be lowered without asking.
- The repo owner merges PRs.

## Known limits and open ideas

- The team page's playoff odds come from the national pass (phase 5): field, bye and national title, and each own game's Win/Lose CFP columns, paired with the locks they stand for. Seasons the national pass can't run (no format, a field needing every conference's champion, a power conference without rules) keep the rough top-11 estimate.
- CFBD flagged title games as conference games before 2025. A title game counts in no standings or tiebreak whichever way it is flagged (see title games under Data). The schedule rule (used when CFBD's note is missing) can't tell a title game from a postponed game played in title week that leaves the two teams level with the rest; CFBD's note settles it when present.
- The announced field relies on CFBD listing the playoff games with seeds, or the selection-day ranking, after the Sunday-evening refresh in December; until a refresh brings them in, the field is simulated.
- Ranking is a stand-in for SportSource.
- Proofs and the likeliest search have budgets. Near the edge they say "open" or return null rather than guess.
- The app covers every FBS conference: the ACC, the Big 12, the SEC, the Big Ten, the MAC, CUSA, the Mountain West, the American, the Pac-12 and the Sun Belt. The FBS independents have pages about the playoff alone. Three of the Big Ten's rules are assumed until the Big Ten's full document is available again (common opponents level on record count as one group; no team is dropped for losing to all the others; a tie of three or more, once cut down, starts over at head-to-head).
- **Expanding conferences.** Every FBS conference and the independents are in (`docs/plan-national.md`, phase 6 done).
- **Group of Six, done.** The 2026 format guarantees a spot to the highest-ranked Group of Six team, whether or not it won its conference (the 2024–2025 formats took the highest-ranked champions). The national pass applies that rule. All six title games are simulated (the MAC's, CUSA's, the Mountain West's, the American's, the Pac-12's and the Sun Belt's, the one with divisions) and their teams have pages with that wording. The champion weight in the stand-in still goes only to power-conference champions. A team barred from the postseason (none in 2026) is left out of its title game and the field; see postseason bans under Data.
- **Season Lab** (`docs/plan-season-lab.md`). Phase 1 in core: `seasonLab` runs the national simulation with picks for regular-season games, conference title games (`titleLocks`: the picked team wins the title game in the seasons it plays in it) and playoff games (`bracketLocks`, by bracket game index); a real final result always wins over a pick. `encodeLabLocks`/`decodeLabLocks` carry picks in a URL and drop, with a note, any pick that real results have settled or that no longer fits the season. Odds mode only; no page yet.
- A future MCP server is planned on top of `src/core`.
