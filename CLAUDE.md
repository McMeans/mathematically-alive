# Mathematically Alive

Next.js (TypeScript) site: pick a college football team, see what has to happen for it to make its conference championship game and the College Football Playoff. Project concept doc: https://claude.ai/artifact/AChusu68g5WjTAnFv7MvgX

- `src/core`: all logic (data model, game odds, season simulation, tiebreakers, path finding). Framework-free, so it runs in the browser, scripts and a future MCP server. Public API is `src/core/index.ts`.
- `src/app`: Next.js App Router UI. Not unit-tested.
- `tests/blackbox`: black-box tests. These are what the coverage gate measures.
- `tests/unit`: optional white-box tests. Keep them, but they don't count toward the gate.
- `fixtures/`: test data (schedules, results) and the scripts that generate them.

Package manager: pnpm (`corepack enable` once; npm's lockfile drops other platforms' native bindings, which broke CI). Dev: `pnpm dev`. Lint: `pnpm lint`. Types: `pnpm typecheck`. Test: `pnpm test`. Build: `pnpm build`.

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

1. `pnpm lint`, `pnpm typecheck` and `pnpm test` pass.
2. Run the `coverage-gate` skill (`.claude/skills/coverage-gate/gate.sh`). It must pass at the threshold in the script. Never lower the threshold without asking.
3. For a branch or PR, run the `pr-review` skill.

## Brand

Design B, the stadium scoreboard (drafts: `docs/redesign/b-scoreboard.html`, `docs/redesign/b-lab.html`). A green board with lit numbers on a light gray ground; light-only.

**The full design guide is [`docs/DESIGN.md`](docs/DESIGN.md)**: tokens, type scale, components, layout (phone, desktop, short desktop), motion, accessibility, do/don't, and known drift. Read it before building UI, and update it in the same change when the design moves. The summary:

- Type: Saira Condensed 600–800 for board lettering and every number (`font-display`, the `cond` and `plate` classes), Public Sans for reading (`font-sans`).
- Colors (Tailwind tokens in `src/app/globals.css`): `board` greens for the header and game boards; `plate` cream for the current nav item and Share; `lamp` amber for a pick or the lit thing (`lamp-ink` as text on the ground); `root` green and `drop` red for gains and losses in odds on the board; `ground`/`paper` light grays with `ink` text.
- One meaning per color: amber is what's picked or lit; green is a gain in odds, red a loss; numbers are lit digits on the board, never boxes. Only buttons get an outline; a pick fills amber.
- Team logos from CollegeFootballData (`logos-dark` on the board, `logos` on light or amber). `TeamLogo` in `src/app/explorer/Board.tsx`.
- Mark: a football whose laces form a pulse line. `src/app/Logo.tsx` (cream ball, board-green pulse on the board; pass `color`/`pulse` on light grounds); below 48px it drops the lace ticks. Favicon `src/app/icon.svg` and `public/logo.svg` are the board-green ball with a cream pulse.
