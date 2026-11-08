# Plan: Season Lab

Status: proposed, November 2026. Each phase is one PR (core and app may split), following `CLAUDE.md`: black-box
tests in the same change, the coverage gate, the `pr-review` skill. Read with `SPEC.md` and `docs/plan-national.md`.

## Goal

One page (`/lab`) where a fan plays out the rest of the season: pick any game, or let the model fill in the rest,
and watch every conference's standings and title game, the projected ranking, the field and the bracket update. The
result is a link anyone can open.

It answers the question the team page can't: "if the season goes like *this*, what does the whole picture look
like?" The team page stays the place for one team's paths.

## What makes it better than a plain pick-'em predictor

1. **Consequences, not just picks.** Every pick says what it changed ("Miami into the field as the 11 seed; SMU
   out"). A short change log lists the biggest movers since the last pick.
2. **Proven where it can be.** With every game in a conference picked, its title game is an exact tiebreak result,
   shown with the deciding step ("Duke over Virginia: record vs. common opponents"). With games left, title-game
   In/Out keeps using the existing proofs; nothing says 100% unless proven.
3. **Odds stay live while you pick.** Unpicked games are still simulated, so the board shows odds, not only one
   made-up season. "Fill the rest" switches to one complete season on top of the picks.
4. **The ranking explains itself.** Each team in the projected ranking carries its reason ("12-1 champion, strong
   schedule"), from the committee stand-in's features. Labelled experimental, as now.
5. **Fresh.** Data is refreshed after each game window, and the page shows "Through Week N" as the rest of the
   site does.

## The page

Phone first. Three tabs on a phone, side by side on desktop:

- **Games.** By week, then by conference. Each game is a three-way toggle: home win, away win, unpicked (shows the
  model's odds). Filters: my team's games, games that move the field most ("big games"), one conference. Bulk
  actions: "Favorites win the rest", "Fill the rest" (one seeded season), "Clear week", "Reset". Undo.
- **Conferences.** Each conference's standings and title game: the matchup odds, or the decided matchup and the
  tiebreak step that settled it. Title games are pickable too once both teams are set.
- **Playoff.** The projected top 25 (mean rank, range, reason), the field with seeds and byes, the bubble, and the
  bracket. Bracket games are pickable once both sides are known, through the national title.

Header: a summary strip ("12 picks · 3 changes to the field") and Share.

Team pages get an "Open in Season Lab" link that carries their locks over.

## State and sharing

- State is the set of locks: game id → winner id, plus title-game and bracket picks, plus an optional fill seed.
- It lives in the URL (compact encoding: sorted game ids as deltas, one bit for home/away, base64url). No server,
  no accounts. Personal data never goes in the URL; locks aren't personal.
- A lock on a game that has since gone final is dropped with a note ("2 picks were settled by real results").
- Share: copy link; later, a share image of the bracket (phase 5).

## Modes

| Mode | When | What runs | Shows |
| --- | --- | --- | --- |
| Odds | Some games unpicked, no fill | `simulateNational` with locks | Odds everywhere |
| Filled | After "Fill the rest" | One season drawn from the seed on top of the locks | One outcome, exact |
| Complete | Every game picked | No simulation needed | One outcome, exact |

Filled and Complete need a new core entry point (below). Committee noise is left out there: the ranking is the
stand-in's plain score, and it is labelled as the projection.

## Core work (`src/core`)

- `seasonLab(season, opts)`: the one public entry point for the page. Takes locks (regular season, title games,
  bracket), seed, iterations and mode. Returns a `LabView`: standings and title-game state per conference, the
  ranking with reasons, the field, bubble and bracket, and every sentence the page shows. Built on
  `simulateNational` (with `reuse`) and `nationalView`; wording in `paths.ts`/`view.ts` style so tests can check it.
- **Title-game and bracket locks.** `NationalOptions.locks` covers only scheduled games. Add locks for a
  conference's title game (by conference, winner) and bracket games (by bracket index, winner), honoured only when
  that team is in that game.
- **Single season.** Draw one season (seeded) on top of the locks and run stages 2–5 once, without committee noise.
  Tiebreaks report their deciding step.
- **Diff.** `labChanges(before, after)`: the biggest movers in field odds, seeds, title-game spots; the sentences
  for the change log.
- **Ranking reasons.** From `CommitteeTeam` features: the one or two biggest contributions to the score, as words.
- **Lock codec.** `encodeLocks`/`decodeLocks` live in core so tests can round-trip them.

No `Math.random()`; every draw stays hashed from the seed.

## Performance

Measured on this machine (Node, current data, 224 unplayed games, 10 conferences):

- Base national run, 20,000 seasons: ~2.3 s.
- With locks and `reuse`: 0.9 s (one lock) to 2.2 s (40 locks).
- 5,000 seasons, no reuse: ~0.6 s at any lock count.

Phones are several times slower, so 20,000 per pick is too slow. Plan:

- Run in the existing Web Worker, cancel the in-flight run on a new pick, and debounce ~250 ms.
- Progressive: 2,000 seasons first (~0.3 s on a phone, shown with "refining"), then 20,000 in the background.
- Filled and Complete modes run one season: instant.
- Budget: first numbers under 1 s on a mid-range phone after a pick. Check in phase 1 with a throttled CPU.

## Tests (black-box, `@/core` only)

- A locked upset moves the underdog's field odds up and the favourite's down.
- Picking every game in a made-up conference sends the right teams to its title game and names the deciding step.
- A locked title game makes that team its conference's champion in every season.
- A bracket pick is ignored when that team isn't in that game.
- "Fill the rest" with the same seed and locks gives the same season.
- Locks survive an encode/decode round trip; a lock on a final game is dropped and reported.
- The change log names the team that entered the field after a pick.

## Phases

1. **Core: lab entry point, title-game and bracket locks, lock codec.** Odds mode only.
2. **App: `/lab` with Games and Playoff tabs**, worker, progressive runs, URL state, Undo/Reset, team-page link.
3. **Conferences tab, Fill and Complete modes**, tiebreak deciding steps.
4. **Consequences:** the change log, ranking reasons, "big games" filter.
5. **Sharing:** bracket share image (Open Graph per link).

## Open questions

- Should the Lab replace the national page, or link from it? (Proposal: the national page becomes the Lab with no
  picks.)
- Committee noise in Filled mode: leave it out (proposed) or draw it from the seed?
- Pickable bowl games: out of scope.
