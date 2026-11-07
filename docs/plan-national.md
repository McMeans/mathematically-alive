# Plan: every FBS conference and a full playoff simulator

Status: proposed, November 2026. Each phase below is one PR (or a core PR plus an app PR, as the conference
additions shipped), and each follows `CLAUDE.md`: black-box tests in the same change, the coverage gate, the
`pr-review` skill. Read with `SPEC.md`.

This plan assumes the SEC PRs #27 (core) and #28 (app) are merged. Everything below that names the SEC,
`secPick` or `tiebreak-sec.test.ts` refers to code in those PRs, so phase 1 starts only after both land.

## Where things stand

- **Conferences:** ACC and Big 12 on main (PRs #20–#23); the SEC in #27 and #28, pending merge. Each has its own
  tiebreak function in `src/core/tiebreak.ts`, chosen by conference name: `accBreak` (also the fallback for any
  other name), `big12Break` and, with #27, `secPick`. Rules are cited from each conference's official document.
- **Simulation:** `simulateSeason` (`sim.ts`) already simulates every game in the season, nationally. The
  per-conference layer (`seasonOutlook`) replays those seasons to pick that one conference's title-game teams.
- **Playoff:** experimental. Only the team's own conference champion is modelled; everyone else gets in by a top-11
  cut on `wins − 1.5·losses + rating/10`. Other conferences' champions, the field rules and the bracket are not
  modelled.
- **Proofs:** `proof.ts` is exact for the title game, but some shortcuts assume the ACC's game-count rule
  (`MAX_SPREAD`, `couldTieByCount`, `tieRouteOpen`).
- **Data:** build merges per-conference fixtures (`scripts/build-data.ts`) when there's no full snapshot in `data/`.

## Goal

Pick any FBS team and see its conference title-game path and its playoff odds, from one national simulation:
every conference's title race, a committee stand-in ranking, the field and the bracket.

## Principles

- **Proved vs modelled.** Title-game In/Out stays an exact proof. Playoff spots are a committee decision, so they
  are modelled odds with their own wording and the Beta tag, except a bid the format guarantees (for example, an
  automatic bid for winning the conference) once the title is proven.
- **Rules from sources.** Every conference's rules come from its official document for that season, cited in the
  config and in `SPEC.md`. No document: stop and ask.
- **Exact tie scores.** Any tiebreak score that can tie as a fraction is built from whole numbers and divided once.
  The SEC's opponents' win pct step broke a true tie by float rounding (fixed in #27); the engine makes this the
  rule for every step.
- **Real seasons as tests.** For each conference, past seasons must send the teams that actually played the title
  game. Cheapest, highest-value check per conference.

## Phase 1: one tiebreak engine, conferences as config

The biggest risk to scaling. Do it before the Big Ten.

1. **Step library** in `src/core`: head-to-head (two teams, round robin, beat-all / lost-to-all), common opponents,
   best placed common opponent (with each conference's rule for opponents level on record: grouped, or ordered by
   head-to-head), opponents' win pct, strength of schedule, total wins (FCS cap), ranking (SportSource, CFP or a
   composite, by stand-in), capped relative scoring margin, draw. One implementation each, exact arithmetic.
2. **One resolver with open spots**, generalizing `secPick`: each step ranks the tied teams; one alone at the top is
   placed; two at the top with two spots are both in; otherwise the top restarts and the rest are out. ACC "place
   one, re-tie" and Big 12 "first step that separates" are settings of it (whether the rest are re-tied from scratch
   or kept, whether a step can eliminate).
3. **Config keyed by (conference, season):** step list, resolver settings, "tied teams" rule (the ACC's
   game-count rule), which steps need non-conference results (`countsNonConference`), which count as luck in proofs,
   the luck wording (`luckSteps`), and the source URL. Unknown conference or season: an explicit error at build,
   not a silent ACC fallback.
4. **Proof hooks:** move the ACC game-count shortcuts in `proof.ts` behind the config, so proofs know which
   conferences have that rule.
5. **Port ACC, Big 12, SEC** onto the engine. The existing black-box tests (`tiebreak.test.ts`,
   `tiebreak-big12.test.ts`, `tiebreak-sec.test.ts`, real 2025 seasons) must pass unchanged. Keep the independent
   cross-check approach used for the SEC: random seasons against a second implementation written from the PDF.
6. Fix on the way: the Big 12 total-wins step counts the conference title game (a week-15 non-conference game
   between two members) once it's in the data. The SEC code in #27 already leaves it out.
   Write the black-box test that reproduces it first (a Big 12 season with the title game played), then fix it.

Done when: three conferences run on configs, all current tests pass, adding a conference is a config plus tests.

## Phase 2: the Big Ten on the engine

Same shape as the SEC (core PR, then app PR): official document, `pnpm fixture 2025 "Big Ten"` and `2026`,
`tests/blackbox/tiebreak-big-ten.test.ts` with each step and the real 2025 title game, then `SUPPORTED_CONFERENCES`.
First proof that phase 1 pays off.

## Phase 3: one national snapshot, refreshed on a schedule

Status: done (build/scripts PR). The snapshot `data/season-2026.json` is committed; `.github/workflows/refresh-data.yml`
refreshes it Sunday and Wednesday, August to January, and commits it to `main` for the host's git deploy (the
user's choice over a deploy hook). `checkSnapshot` in `src/core` is the build check. The repository secret
`CFBD_API_KEY` must be set for the job to run. Measured: build 85 s to 107 s, one team's `explore` median 2.2 s to
2.9 s (about 0.3 s of it the other conferences' games, which phase 4 needs anyway).

- Build from one full-season CFBD snapshot (all FBS games come back in the same 4 calls) instead of merging
  fixtures. Removes the risk of merged fixtures fetched on different dates.
- Fixtures stay per conference, for tests only.
- A scheduled job (GitHub Action, weekly in season) fetches, builds and deploys. The CFBD key stays a repository
  secret, build-time only, never logged.
- Build check: every supported conference has a full schedule (as `build-data.ts` checks today), and every
  conference in the snapshot either has a config for that season or is reported as not supported.

## Phase 4: national simulation in stages

Status: done. Stages 2–3 (core PR #36): `simulateNational` and `committeeRanking`. The user chose a stand-in fitted
to past rankings, with the first 2026 ranking included. Fitted on each season's latest committee ranking 2014–2026
(`fixtures/cfp-<year>.json`, `pnpm cfp`, `pnpm fit-committee`), its top 12 holds 10.8 of the committee's on average
(the placeholder 8.9). Stages 4–5: `playoffFormat` (cited per season), `playoffField`, and the bracket inside
`simulateNational`. The 2026 Group of Six bid goes to the highest-ranked G6 team, champion or not, so G6 title games
aren't needed for the 2026 field; the 2024–2025 formats need every champion, so the national pass gives those seasons
no playoff. A national pass costs about 1.8–1.95 s at 20,000 iterations (regular season 0.4 s, stages 2–3 1.25 s,
stages 4–5 about 0.25 s); no page runs it yet. Measured at stages 4–5: one team's `explore` median 2.5–2.9 s both
before and after (noise), `pnpm build` 89 s to 92 s. Next: phase 5.

One pass per simulated season, every stage a pure function in `src/core` and testable through the public API:

1. **Regular season:** `simulateSeason` as today (rating shift, seeded streams, locks).
2. **Conference title games:** every conference's config picks its two teams; the game is simulated (neutral site,
   simulated ratings).
3. **Committee stand-in ranking:** rating, record, strength of schedule, conference champion flag. Fit its weights
   to past CFP rankings (store them as generated fixtures with the script that fetches them) and test that it
   reproduces past fields within a stated tolerance.
4. **Field selection** by season format: automatic bids, the Group of Six rule `SPEC.md` describes, at-large spots,
   seeding and byes. Format keyed by season, cited like the tiebreak rules.
5. **Bracket:** games by simulated ratings, home field for the higher seeds where the format gives it.

`seasonOutlook` becomes a view over these results for one conference; what-ifs keep paired streams, so a lock
still changes only its own game's draw. Budget: one national pass at the app's 20,000 iterations must stay inside
the worker's current time for one team page (median about 2.5 s on 2026 data), or the precomputed base run
covers it and what-ifs rerun only what a lock touches.

## Phase 5: playoff UI

Status: team-page odds done (field, bye, title, paired Win/Lose CFP columns, "Must win" from the field rules; timings in `SPEC.md`). National view (`/national`: projected field, bracket, bubble, from `nationalView`) and the results-elsewhere list (`playoffSignals`, on each team page) done. Measured: `pnpm build` about 104 s (was 108 s); one team's cold `explore` (Georgia, 20,000 iterations, no reuse) about 4.7 s on this machine, the signal pass a small part of it.

- Team page: playoff odds from the national run (in, seed, bye, title), "Must win <conference>" from the field
  rules, Beta tag and modelled wording.
- A national view: projected field and bracket, each spot's odds, the bubble.
- Which results elsewhere matter for the playoff, reusing the signal rules in `signal.ts`.

## Phase 6: the rest of FBS

- Group of Six conferences, one config each from its official document. Under the 2026 format the route is being the
  highest-ranked Group of Six team, champion or not, so the wording is never "Must win <conference>" (`playoffRoute`).
  - Done: the MAC (rules from its published tiebreak page), its title game in the national pass, its pages.
    Sacramento State, first ruled out of the title game for 2026-2027, is eligible under the NCAA's June 2026 rule
    for teams moving up; the `ineligible` config list it needed is gone (see git history to bring it back).
  - Done: Conference USA (rules from its 2024 policy PDF; Delaware and Missouri State eligible in 2026).
  - Done: the Mountain West (rules from its 2023 procedures PDF; North Dakota State eligible under the NCAA's June
    2026 rule for teams moving up).
  - Done: the American (rules from its 2025 tiebreakers PDF; the CFP-ranking and computer-composite steps are the
    ranking stand-in). Army-Navy, which CFBD flags a conference game, is non-conference and played after the title
    game and the field: it counts in no standings, tiebreak, ranking or field, and is never taken for the title game.
  - Next: the Pac-12, the Sun Belt (divisions: needs engine support).
  - When a member is barred from the postseason: leave it out of its title game and the Group of Six bid.
- Independents (Notre Dame and others): no title-game section; playoff only.
- Picker that scales to every conference plus independents.

## Order and size

| Phase | Ships as | Depends on |
| --- | --- | --- |
| 1. Tiebreak engine | core PR | #27 and #28 merged |
| 2. Big Ten | core PR + app PR | 1 |
| 3. National snapshot + refresh | build/scripts PR | nothing (can run alongside 1–2) |
| 4. National simulation | core PRs (stages 2–3, then 4–5) | 1, 3 |
| 5. Playoff UI | app PRs | 4 |
| 6. Rest of FBS | one core + app PR per conference or two | 1, and 5 for G6 wording |

## Open questions for the user

- Committee stand-in: answered in phase 4. Fitted to past rankings, the first 2026 ranking included.
- Refresh: answered in phase 3. Scheduled, Sunday and Wednesday in season, committing the snapshot to `main`.
- How far back should real-season tests go per conference (one season, or several where the rules were the same)?
