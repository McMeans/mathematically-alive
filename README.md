<p align="center">
  <img src="docs/brand/wordmark.png" alt="Mathematically Alive" width="560">
</p>

<p align="center"><b>Every path to the playoff, for every team.</b></p>

Pick a college football team and see what has to happen for it to reach its conference championship game and the College Football Playoff. Every FBS conference and the independents are covered.

For each team it answers three questions:

1. **How likely is it?** Title-game, title and playoff odds from thousands of simulated seasons, using betting lines and SP+ ratings.
2. **Is it settled?** "In" and "Out" are proven exactly from the remaining schedule and the conference's real tiebreakers, never guessed from odds.
3. **What has to happen?** The team's own games, games elsewhere to root for or against, and the likeliest combination of results that gets it in.

Lock any result ("what if Miami loses to Wake Forest?") and every number updates. The **Season Lab** does the same for the whole country: pick games and watch the projected playoff field, bracket and ranking change, then share the result.

## Run it

```bash
corepack enable
pnpm install
pnpm dev
```

Open http://localhost:3000. The committed snapshot in `data/` is all the app needs; no API key.

To refresh the data yourself, put a [CollegeFootballData](https://collegefootballdata.com) key in `.env.local` as `CFBD_API_KEY` and run `pnpm data`. In season, a GitHub Action does this twice a week.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server on port 3000 |
| `pnpm test` | Unit and black-box tests (Vitest) |
| `pnpm lint` / `pnpm typecheck` | ESLint / TypeScript |
| `pnpm build` | Production build (renders every team page) |
| `pnpm gate` | Black-box coverage gate |
| `pnpm data [year]` | Fetch a season snapshot from CFBD |

## How it's built

- `src/core`: all the logic (game odds, season simulation, tiebreakers, proofs, paths), framework-free and seeded so results are reproducible.
- `src/app`: the Next.js site.
- `tests/blackbox`: tests that drive only the public API of `src/core`.

[`SPEC.md`](SPEC.md) explains how every number is made and each conference's tiebreak rules. [`CLAUDE.md`](CLAUDE.md) has the layout, testing rules and the checks a change must pass.

## License

Code is [MIT](LICENSE). Schedule, results, betting-line and rating data (including the snapshots in `data/` and `fixtures/`) come from [CollegeFootballData](https://collegefootballdata.com) and stay under its terms, not this license.
