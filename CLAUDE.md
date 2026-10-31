# Mathematically Alive

Next.js (TypeScript) site: pick a college football team, see what has to happen for it to make its conference championship game and the College Football Playoff. Project concept doc: https://claude.ai/artifact/AChusu68g5WjTAnFv7MvgX

- `src/core`: all logic (data model, game odds, season simulation, tiebreakers, path finding). Framework-free, so it runs in the browser, scripts and a future MCP server. Public API is `src/core/index.ts`.
- `src/app`: Next.js App Router UI. Not unit-tested.
- `tests/blackbox`: black-box tests. These are what the coverage gate measures.
- `tests/unit`: optional white-box tests. Keep them, but they don't count toward the gate.
- `fixtures/`: test data (schedules, results) and the scripts that generate them.

Dev: `npm run dev`. Lint: `npm run lint`. Types: `npm run typecheck`. Test: `npm test`. Build: `npm run build`.

## Black-box testing as we go

Every change to `src/core` behavior ships with black-box tests in the same change.

- Black-box tests import only from `@/core`, never from a file inside it.
- Drive public inputs (a schedule, completed results, locked what-ifs, a seed), assert on public outputs (odds, projected records, standings, path lists). No mocks of internals and no asserting on private state.
- Don't export anything just to test it. If code can't be reached through the public API, question whether it should exist.
- Simulations take a seed, so tests are deterministic. No `Math.random()` in `src/core`.
- Name tests after the behavior: `"a locked upset raises the underdog's title odds"`.
- Fixtures go in `fixtures/`, made by a script, never hand-edited. A test needing a tiny made-up conference may build it inline.
- Path and odds wording the user sees belongs in `src/core`, so black-box tests can check it. The app only shows it.
- Bug fix: first write a black-box test that reproduces the bug, then fix it.

## Before calling a change done

1. `npm run lint`, `npm run typecheck` and `npm test` pass.
2. Run the `coverage-gate` skill (`.claude/skills/coverage-gate/gate.sh`). It must pass at the threshold in the script. Never lower the threshold without asking.
3. For a branch or PR, run the `pr-review` skill.

## Brand

Identity direction D (canvas: https://claude.ai/artifact/KL6C75XoRFuUYPqYurETpt). Light-only, white page.

- Type: Space Grotesk 700 for display (`font-display`), Inter for body and data (`font-sans`).
- Colors (Tailwind tokens in `src/app/globals.css`): `navy` #14213D (text, the ball), `turf` #1F7A4D (accent, conference odds), `marker` #D9622B (fills only; use `marker-text` #B4501F for orange text on white), `mist` #F3F5F8 (cards).
- Mark: a football whose laces form a pulse line. `src/app/Logo.tsx`; below 48px it drops the lace ticks. Favicon is `src/app/icon.svg`.
