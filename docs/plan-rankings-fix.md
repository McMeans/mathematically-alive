# Plan: fix the projected ranking

Status: done. Fix B and the ceilings are in; results at the end. The owner chose fix B.

Data: the 2026 snapshot (`data/season-2026.json`, fetched Nov. 11, committee ranking of week 11, 204 games open) and
`fixtures/cfp-2014..2025.json` (70 pairs of an earlier committee ranking and a later one). Everything below was run
through `@/core` (`liveRanking`, `seasonLab`, `committeeRanking`). The numbers for the two candidate fixes come from a
throwaway prototype of the scoring, not from committed code.

## Where the ranking comes from

The list the Lab shows (`SeasonLab.live`, `liveAll`) is `liveRanking(season, { locks, titles })`, called from
`projectedField` (`src/core/projected.ts:45`, `src/core/lab.ts:231`). It is not the simulation's average rank
(`SeasonLab.ranking`, which the page no longer shows).

- Every FBS team gets an anchored score from its place: the committee's 25 in the committee's order, then the other
  113 in the stand-in's order (`live.ts:130`), scored `3.274 · −√(place + 1)` (`live.ts:51`, `:132`). So places 26–138
  are computed, and an unranked team starts from the stand-in's score order, below every ranked team.
- Results since the ranking move the score: +1.42 a win (less for a Group of Six team or a team with two losses),
  −2.01 a loss, ±1.145 × how surprising the result was (`movedScore`, `live.ts:82`; `movement-weights.ts`).
- A real result counts in full. A picked result counts as `result − discount × (what was expected of that game)`,
  with `discount = 1 − picked / open` (`live.ts:226–241`).
- Loss ceilings reorder the top 20 only (`live.ts:58`, `:66`).

SPEC.md has no section on `live.ts` or `projected.ts`; "Committee stand-in" describes only the unanchored score.

## Problems, evidence, causes

### 1. Teams that win out climb too high

One team picked to win its remaining games, nothing else picked:

| Team (now) | Lab now | Simulation's order, same picks | Fix A | Fix B |
|---|---|---|---|---|
| Duke, 7-2 (#27) | #7 | #13 | #12 | #13 |
| Kentucky, 7-2 (#11) | #2 | #6 | #5 | #3 |
| SMU, 7-2 (#26) | #10 | #13 | #12 | #13 |
| Michigan, 5-4 (#41) | #14 | #20 | #20 | #20 |
| Arkansas, 3-6 (#69) | #25 (a 6-6 team) | #36 | #38 | #42 |
| Vanderbilt, 4-5 (#66) | #29 | #36 | #37 | #40 |
| Boston College, 4-5 (#70) | #29 | #38 | #40 | #44 |

21 unranked teams can reach the top 25 by winning out alone; 14–15 after either fix.

Cause: the discount at `live.ts:233–241`. A picked win is scored `win − discount × expected`, and for an underdog the
expected value of its game is negative, so the pick is worth more than the real result. Duke beating Miami (19%
chance): a real win is +2.35, the picked win +3.71. The intent ("a pick moves a team only by how much it beat the
odds") needs every unpicked team to sit at its own expectation too; instead they sit still, so the picked team is
compared with teams whose expected gains were never added. A team with hard games left gains the most.

Not the cause: the fitted weights. On real results the model is calibrated near the top. Starting from an earlier
committee ranking and moving it by the real results:

| | Top 12 held | Top 25 held |
|---|---|---|
| To the final ranking, model | 11.0 | 23.0 |
| To the final ranking, no change | 10.0 | 21.9 |
| To the next ranking, model | 11.4 | 23.3 |
| To the next ranking, no change | 10.8 | 22.8 |

It adds 3.0 new teams to the top 25 per case and the committee adds 2.7; 1.9 of the model's are right. Teams the
committee did add sit 3.5 places lower in the model, so on real results unranked teams climb too little, not too much.

A second, smaller cause: no ceiling past 20. The committee has never ranked a team with six losses, and its best
five-loss team was #22 (2018 Northwestern). `highestPlace` gives both #20 and `holdCeilings` stops at place 20, so
nothing keeps a 6-6 team out of #21–25. (The comment at `live.ts:54–56` says no five-loss team was ever ranked; one was.)

### 2. A picked loss can leave the rank unchanged

Every open game, picked alone as a loss for each side (404 cases):

| Loser | Chance it had | Cases | Rank unchanged | Average drop |
|---|---|---|---|---|
| Unranked | under 10% | 18 | 4 | 0.9 |
| Unranked | 10–25% | 55 | 2 | 2.9 |
| Unranked | 25–50% | 115 | 2 | 7.0 |
| Unranked | over 50% | 141 | 1 | 12.3 |
| Ranked | any | 75 | 0 | 6.5 |

Boston College (#70) loses to Notre Dame (3%): stays #70. Georgia Tech (#105) loses to Georgia (2%): stays #105.
Missouri (#22) loses to Georgia (15%): #23.

Cause: the same discount. A picked loss is worth `−chance × (win − loss)`, about −0.14 for a 3% underdog, and
neighbouring places sit 0.15–0.3 apart. Ties and rounding are not involved: scores are compared to 1e-9 and ties go
to the anchor order (`live.ts:249`).

### 3. The order below the top 25

- It is computed for all 138, and the starting order (the stand-in's) holds up: of the teams the committee newly
  ranks a week later, the average one was the stand-in's 4th-best unranked team. A high rating on a weak schedule is
  not inflated: Liberty (8-1, SP+ 15.0, schedule −9.9) starts #37, North Dakota State (7-2) #55; Group of Six teams
  are 33% of the stand-in's top three unranked and 29% of the committee's real newcomers.
- What makes it look wrong is problems 1 and 2, which are largest there: a win-out gains 23 places on average from
  #41–70 and 33 from #71 down.
- Nothing fits or tests it. `fit-movement.ts:74–82` uses pairs inside the later top 25 plus each ranked team over the
  anchor's top 40 unranked at weight 0.1; `fit-committee.ts:37–39` uses ranked over ranked and ranked over unranked.
  No pair of unranked teams is ever compared, because the committee publishes no order for them.
- Tried and dropped: spacing unranked teams by the stand-in's score gaps instead of by place (newcomer error 5.8 vs
  4.6 places), and a floor on the spacing below #25, #40 or #60 (no change in any measure).

## Fixes

Two ways to fix 1 and 2. They differ in what a partly picked season means. This needs the owner's decision.

**B, picks count as played (recommended).** Drop the discount: a picked result moves both teams exactly as the real
result would. Unpicked games move nothing.
- A picked loss always drops a team (unchanged in 4 of 404, the teams already last or in Army–Navy, which never
  counts). Boston College's loss to Notre Dame: #70 to #82.
- Win-outs come down to the table above. The ranking matches the records the Lab shows beside each team.
- With no picks it is still the committee's order, and a fully picked season is unchanged from today.
- Cost: a team picked to win games it was expected to win passes teams whose games aren't picked yet (Texas Tech,
  #12, wins out alone: #4, the same as today). "Fill the rest" removes the effect.
- Smallest change: about 15 lines in `liveRanking`.

**A, unpicked games count at their expected value.** Score every team as anchor + decided results + the expected
value of each open game.
- Win-outs land where the simulation puts them. Texas Tech winning out alone: #6.
- With no picks the list is no longer the committee's order: it is a projection of the final ranking (Kentucky #11
  to #16, Notre Dame #5 to #4). Scored against the final committee ranking from an earlier one, that projection is
  barely better than leaving the order alone (top 12: 10.1 vs 10.0; top 25: 21.9 vs 21.9).
- A heavy underdog's picked loss still doesn't move it (16 of 404 unchanged; under 10% chance, 1.1 places on
  average), because the loss is already in its starting place. Problem 2 stays.

**Ceilings, with either.** `highestPlace`: five losses #22, six or more #26. `holdCeilings` covers the top 25. This
also applies inside each simulated season (`national.ts:449`, `:522`), where it can only touch places 21–25.

**No refit.** The weights stay; neither fitting script runs.

## How to judge it

- `tests/blackbox/committee.test.ts` passes untouched (at least 9 of the top 12 every season, 10.5 on average, 3 of
  the top 4). The stand-in is not changed.
- New backtest, 2014–2025, an earlier committee ranking moved by real results to the final one: top 12 at least 10.8
  on average (11.0 now), top 25 at least 22.8 (23.0 now). Real results are scored the same before and after, so
  these must not move.
- 2026 snapshot, single picks: a picked loss leaves the loser's rank unchanged in at most 4 of 404 cases (9 now).
- 2026 snapshot, one team winning out: Duke no higher than #12, Arkansas outside the top 35, at most 15 unranked
  teams able to reach the top 25.
- No team with six losses in the top 25, in the Lab or in any simulated season.

## Black-box tests

In `tests/blackbox`, importing only `@/core`, on `fixtures/cfp-2026.json` unless a small inline league is clearer:

1. "an unranked team that loses drops in the projected ranking": each unranked team with a game left, its next game
   picked as a loss, ranks strictly lower (the last-placed team excepted).
2. "a picked result moves both teams exactly as the same result played": the same game locked, and marked final,
   gives the same order. Replaces "the same result picked moves it only by how much it beat the odds"
   (`live-ranking.test.ts:46`).
3. "an underdog's picked win lifts it no more than the win itself would": pins problem 1's cause.
4. "an unranked team that wins out against a weak schedule stays below a one-loss power team".
5. "no team with five losses ranks above 22nd, and none with six is in the top 25": through `seasonLab` picks and
   through `simulateNational`'s `forEachIteration`. Extends `projected-ranking.test.ts:73`.
6. "the committee's ranking moved by real results holds its later top 12 and top 25": the backtest above.
7. Check `projected-ranking.test.ts:19` ("winning out lifts a two-loss power team ranked in the teens a few places,
   not into the top four") still holds, and reword its reason: other teams' games are not picked, not "played too".

## Tasks

Each is one subagent brief. 1 and 2 touch `live.ts`, so they run in order.

1. **Picks count as played** (fix B; or fix A if chosen). Write tests 1–4 first and see 1–3 fail. Then in
   `liveRanking` remove `discount`, `cut`, `open` and `picked` and add each result in full. Update the doc comments
   on `liveRanking` and the file header, and `projected.ts`'s header. Fix tests that asserted the old behaviour
   (`live-ranking.test.ts:46`; check `lab-consequences`, `lab`, `projected-ranking`).
2. **Ceilings to 25.** Test 5 first. Change `highestPlace` and the limit in `holdCeilings`; correct the comment with
   the 2018 Northwestern case.
3. **Backtest test.** Test 6, thresholds set just under the measured values.
4. **Docs.** SPEC.md gets a "Live and projected ranking (`live.ts`, `projected.ts`)" section; this plan gets the
   results. Check the wording of the note in `view.ts:143` against the new behaviour (the wording lives in core).

Then lint, typecheck, tests, the coverage gate, the `pr-review` skill, and the Phase 1 cases in the Lab preview.

## Open questions

1. Fix B or fix A?
2. Are the ceilings right: five losses no higher than #22, six or more never in the top 25?
3. Leave the order among unranked teams unfitted? A truth for it would need another source (the AP poll's "others
   receiving votes" reaches about #40); that is a separate change and needs new CFBD calls.

## Results

Fix B and the ceilings landed as tasks 1–3; the weights were not refitted. Measured on the same 2026 snapshot.

| One team wins out, nothing else picked | Before | After |
|---|---|---|
| Duke, 7-2 (#27) | #7 | #13 |
| Kentucky, 7-2 (#11) | #2 | #3 |
| SMU, 7-2 (#26) | #10 | #13 |
| Michigan, 5-4 (#41) | #14 | #20 |
| Arkansas, 3-6 (#69) | #25 | #42 |
| Vanderbilt, 4-5 (#66) | #29 | #40 |
| Boston College, 4-5 (#70) | #29 | #44 |
| Unranked teams that can reach the top 25 this way | 21 | 14 |

| A single picked loss, 404 cases | Before | After |
|---|---|---|
| Loser's rank unchanged | 9 | 3 (Akron twice, already last; Army–Navy, which never counts) |
| Unranked, under 10% chance: average drop | 0.9 | 10.6 |
| Unranked, 10–25%: average drop | 2.9 | 10.4 |
| Ranked, under 25%: average drop | 1.3 | 5.0 |

- No pick set tried puts a six-loss team in the top 25.
- Backtest, 58 cases: 11.0 of the top 12 and 23.0 of the top 25, unchanged by the fix, now held by
  `tests/blackbox/live-backtest.test.ts`. `tests/blackbox/committee.test.ts` passes untouched.
- Not done: the simulation's per-season check of the six-loss ceiling (the public API gives each simulated season's
  ranking but not its records), and any fit of the order among unranked teams (open question 3).
