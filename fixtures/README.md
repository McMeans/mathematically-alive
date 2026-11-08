# Fixtures

Files here are generated. Do not hand-edit them. They are for tests only: the app is built from the national snapshot in `data/`.

- `acc-2025.json`: the ACC's 2025 teams, all their games and those games' opponents, as a raw CollegeFootballData snapshot. Regenerate with `pnpm fixture` (reads `data/season-2025.json`, fetching it first if missing: 5 API calls, needs `CFBD_API_KEY`). Only the current season's snapshot is committed, so delete a fetched `data/season-2025.json` afterwards: the build uses the newest year, but it would show up as a new file.
- `acc-2026.json`: the same for 2026, as fetched mid-season (through week 9). Regenerate with `pnpm fixture 2026`.
- `big-12-2025.json`, `big-12-2026.json`: the same for the Big 12 (2026 as fetched through week 9). Regenerate with `pnpm fixture 2025 "Big 12"` or `pnpm fixture 2026 "Big 12"`.
- `sec-2025.json`, `sec-2026.json`: the same for the SEC (2026 as fetched through week 9). Regenerate with `pnpm fixture 2025 SEC` or `pnpm fixture 2026 SEC`.
- `big-ten-2025.json`, `big-ten-2026.json`: the same for the Big Ten (2026 as fetched through week 9). Regenerate with `pnpm fixture 2025 "Big Ten"` or `pnpm fixture 2026 "Big Ten"`.
- `national-2025.json`: every FBS game of 2025, postseason included (title games with CFBD's notes, playoff games with their seeds), trimmed to the fields `seasonFromCfbd` reads, with SP+ ratings and the committee's rankings (no betting lines). The end-to-end postseason tests run on it. Regenerate with `pnpm fixture 2025 national` (reads `data/season-2025.json`, fetching it if missing: 5 API calls), then delete `data/season-2025.json`.
- `cfp-<year>.json` (2014–2026): every College Football Playoff committee ranking of the season, with a trimmed snapshot of that season's games, teams and SP+ ratings (no betting lines). Made by `pnpm cfp [first year] [last year]` (`scripts/fetch-cfp.ts`, 4 API calls a season, needs `CFBD_API_KEY`). The committee stand-in's weights are fitted to them by `pnpm fit-committee`, which rewrites `src/core/committee-weights.ts`; refit after refreshing them. `cfp-2026.json` was fetched after the first 2026 ranking (week 10, games through week 9).
