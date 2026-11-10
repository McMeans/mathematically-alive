# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

College football fans following one team. They check during the season, week to week, mostly on their phones around Saturdays, to see whether their team is still alive and what has to happen for it to get in.

## Product Purpose

Pick a college football team and see what has to happen for it to make its conference championship game and the College Football Playoff. It answers three questions: how likely is it, is it settled, and what has to happen. Success means a fan leaves knowing their team's real situation and which results to root for.

## Positioning

Four things together, which odds-only sites don't offer:

- **Exact proofs.** "In" and "Out" are proven exactly with the conference's real tiebreakers, never inferred from odds. A flat 100% or 0% appears only when a proof backs it.
- **Paths, not just percentages.** The likeliest way in, help from games elsewhere, and a path tree over the team's own games.
- **Interactive what-ifs.** Lock any result and every number updates.
- **Every team, every path.** Long shots get their paths too, not only contenders.

## Operating Context

- In-season, weekly use, phone first. Fans move between their team's own games and the results elsewhere they need.
- Data comes from CollegeFootballData (teams, games, betting lines, SP+) at build time. Numbers are seeded and reproducible.
- What-ifs run in a Web Worker. The worst case is a few seconds, so loading states matter.

## Capabilities and Constraints

- Supports all Power Four conferences. Some conference tiebreak rules are partly assumed (see SPEC.md). The Group of Six would need a top-G6 rule.
- Conference title odds come from a Monte Carlo simulation (20,000 seasons). Clinched and eliminated come from exact proofs.
- The playoff estimate is **experimental** and is not the committee. It must be labelled that way.
- All wording users see (odds formats, path text) is produced in `src/core`, so it can be tested. The UI only displays it.
- Terminology: "In", "Out", "Must win [conference]", "Non-con", "likeliest way in", "help from elsewhere".

## Brand Commitments

- Name: Mathematically Alive. Tagline: "Every path to the playoff, for every team."
- Design B, the stadium scoreboard, is binding (CLAUDE.md, drafts in `docs/redesign/b-*.html`): a green board with lit numbers and an amber lamp for what's picked, on a light gray ground; Saira Condensed for board lettering and numbers, Public Sans for reading. Light-only.
- Mark: a football whose laces form a pulse line (`src/app/Logo.tsx`, `src/app/icon.svg`, `public/logo.svg`).

## Evidence on Hand

- Real season data: `data/season-2026.json` and the fixtures in `fixtures/`.
- No testimonials, user counts, press or accuracy track record exist. Don't invent any.

## Product Principles

1. Never claim certainty the math hasn't proven.
2. Answer "what has to happen?", not only "how likely?"
3. Every team deserves its path, including long shots.
4. Show the consequence of a what-if right away.
5. Be honest about what is modelled. Label experimental estimates as experimental.
