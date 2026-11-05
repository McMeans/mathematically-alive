# Fixtures

Files here are generated. Do not hand-edit them.

- `acc-2025.json`: the ACC's 2025 teams, all their games and those games' opponents, as a raw CollegeFootballData snapshot. Regenerate with `pnpm fixture` (reads `data/season-2025.json`, fetching it first if missing; needs `CFBD_API_KEY`).
- `acc-2026.json`: the same for 2026, as fetched mid-season (through week 9). Regenerate with `pnpm fixture 2026`.
- `big-12-2025.json`, `big-12-2026.json`: the same for the Big 12 (2026 as fetched through week 9). Regenerate with `pnpm fixture 2025 "Big 12"` or `pnpm fixture 2026 "Big 12"`.
- `sec-2025.json`, `sec-2026.json`: the same for the SEC (2026 as fetched through week 9). Regenerate with `pnpm fixture 2025 SEC` or `pnpm fixture 2026 SEC`.
