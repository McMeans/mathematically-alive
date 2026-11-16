# Design guide

How Mathematically Alive looks and behaves, written from what ships in `src/app`. Follow it when you build or change
UI. When this guide and the code disagree, the code is the source of truth: fix whichever is wrong in the same change.

The design is **design B, the stadium scoreboard**: a green board with lit numbers and an amber lamp for what's picked,
on a light gray ground. Drafts that show the intent live in `docs/redesign/b-*.html` (`b-scoreboard.html` for the team
page, `b-lab.html` for the Season Lab). Product context is in `PRODUCT.md`.

**See it:** [`docs/style-guide.html`](style-guide.html) is the visual companion to this guide: swatches, type,
the header, picks, races, best shot, buttons, motion, contrast, the mark and do/don't pairs, rendered with the real
tokens. Open it in a browser. Update both in the same change when the design moves.

The site is **light-only**. There is no dark mode, and none is planned.

## Contents

1. [Principles](#principles)
2. [Color](#color)
3. [Type](#type)
4. [Numbers and wording](#numbers-and-wording)
5. [Surfaces, shape and depth](#surfaces-shape-and-depth)
6. [Components](#components)
7. [Layout](#layout)
8. [Motion](#motion)
9. [Accessibility](#accessibility)
10. [The mark](#the-mark)
11. [Do and don't](#do-and-dont)
12. [Known drift](#known-drift)

## Principles

- **Two surfaces.** The *board* (dark green) carries game results, odds and anything you can pick. The *ground* (light
  gray) and the *paper* rails carry reading: headings, notes, footnotes, the picks list.
- **One meaning per color.** Amber is what's picked or lit. Green is a gain in odds, red a loss. Nothing else uses
  those colors.
- **Numbers are lit digits on the board, never boxes.** A number is Saira Condensed set straight on the board, not in a
  pill, chip or tile with its own border.
- **Only buttons get an outline.** A 1px border means "you can press this". Labels, tags and readouts don't get one,
  with one narrow exception noted below (the dashed "Projected" tag).
- **A pick fills amber.** A pressed result fills the whole button with `lamp`, with dark `plate-ink` text.
- **The core writes the words.** Every odds string and path sentence a user sees comes from `@/core`. The app lays it
  out.

## Color

All colors are Tailwind v4 tokens in the `@theme` block of `src/app/globals.css`. Use the token
(`bg-board-deep`, `text-lamp`), never a hex value in a component.

### The board

| Token | Hex | Use |
| --- | --- | --- |
| `board` | `#133F2E` | Header ground (with the dot texture, `.board-dots`), selected segmented control and chip, primary dark buttons on the ground ("Fill the rest", "Pick a team"), the phone dock. |
| `board-deep` | `#0C2C20` | Game boards: week-by-week rows, help cards, race cards, the field, the bracket, dropdown menus and the team sheet. |
| `board-deeper` | `#0A241A` | The deepest green. Defined but not used as a class today; shadows use its RGB (`rgba(10,36,26,…)`). |
| `board-line` | `#2A5A46` | Hairlines and outlines on the board: row dividers, unpressed button borders, the bye/bid lines in a race. |
| `board-text` | `#D7E4DC` | Body text on the board. |
| `board-muted` | `#9FBCAE` | Labels, dates, column headings, teams that are out, secondary numbers on the board. |
| `white` | `#FFFFFF` | Primary text and lead numbers on the board (team names, odds). |

### Lamp, plate and the odds colors

| Token | Hex | Use |
| --- | --- | --- |
| `lamp` | `#F2B134` | Amber. A pick (button fill), the page's own team in a race (left edge and its numbers), the cut line, a big game's 2px outline, the focus ring on the board, a reset button that has something to reset, text selection. |
| `lamp-ink` | `#8A5D00` | Amber as text on the ground, where `lamp` is too light (1.5:1). Used for notes like "title pick cleared". |
| `plate` | `#F3F0E6` | The cream plate: the current nav item, Share on the board, the mark's ball. |
| `plate-ink` | `#121A16` | Text on `plate` and on `lamp`. |
| `root` | `#5FD08F` | A gain in odds, lit on the board: "+5" on the side to root for. |
| `drop` | `#F0806E` | A loss in odds, lit on the board: "−2". |

### The ground

| Token | Hex | Use |
| --- | --- | --- |
| `ground` | `#E4E7E5` | Page background (set on `body`), the Lab's phone tab strip. |
| `paper` | `#F6F8F7` | Rails and side panes: the team page's summary column, the Lab's field and races panes. |
| `white` | | Inputs and secondary buttons on the ground (unselected chips and segments). |
| `rule` | `#D6D4CC` | Borders and dividers on the ground. |
| `ink` | `#15201B` | Text on the ground. |
| `ink-soft` | `#3D4A43` | Sub-heading lines, unselected segment text. |
| `ink-muted` | `#5D6A63` | Footnotes, notes, empty states, placeholders. |
| `hurt` | `#A3281C` | Errors on the ground ("Couldn't update"), and the ring on a best-shot step a pick has broken. |
| `help` | `#1D6B46` | Defined; not used by the current UI. |

`navy`, `turf`, `turf-ink`, `marker`, `marker-text`, `mist`, `teal` and `teal-ink` are **legacy aliases** from the
earlier design, remapped onto this palette so old class names still render on-brand (`navy` is `ink`, `marker` is
`lamp`, `mist` is `paper`). Don't use them in new code; `teal` in particular is off-palette.

### Translucent whites on the board

Unpressed buttons and inputs on the board sit on a faint white wash rather than a new token:
`bg-white/[0.04]` resting, `bg-white/[0.07]` hover, `bg-white/[0.06]` for search fields, `bg-white/[0.05]` for a list
row's hover, `bg-white/[0.035]` for a race row just under the line. A tint of amber, `bg-lamp/10`, marks the page's or
pinned team's row in a list.

## Type

Two families, loaded in `src/app/layout.tsx` with `next/font/google`:

- **Saira Condensed** 600, 700, 800 (`--font-saira`, Tailwind `font-display`). Board lettering and **every number**.
- **Public Sans** (`--font-public-sans`, Tailwind `font-sans`, the `body` default). Reading: sub-headings, notes,
  footnotes, chances ("61% to win"), the picks list.

`body` sets `font-variant-numeric: tabular-nums`, so digits line up in columns everywhere.

Two utility classes in `globals.css` carry the display face:

- **`.cond`**: Saira Condensed, upper case. Headings, team names on the board, button labels, column headings, tags.
  Pair it with a weight (`font-bold` or `font-extrabold`) and letter-spacing (`tracking-[0.03em]` to `tracking-[0.1em]`;
  smaller text gets more).
- **`.plate`**: Saira Condensed 800, `line-height: 1`. A lit number. Not upper-cased (it holds digits and `%`).

Where an element is `.cond` but holds a sentence or a count ("· 3 picks", a sub-line under a rail heading), switch back
with `font-sans normal-case tracking-normal`.

### Scale in use

| Role | Classes |
| --- | --- |
| Team name in the header (picker), 768px up | `cond text-[32px] lg:text-[40px] font-extrabold`; names over 18 letters stay 32px. It wraps and is never truncated. The record sits under it, `font-sans text-[13px]` in `board-muted`. |
| Odds band numbers (team page header) | `plate text-[26px]`; one screen: `text-4xl`, `lg` `text-[44px]`. Labels `cond text-[11px]` (`text-xs` one screen), the lead one white |
| Playoff road (under the band) | labels `cond text-[11px]` in `board-muted`, numbers `plate text-[15px]` in `board-text` |
| Name line (team page, phones and short screens) | name `cond text-xl` (15px over 12 letters, up to two lines: the line also holds Undo, Reset and Share), the record under it at 11.5px in `board-muted` |
| Section heading on the ground (`Heading`) | `cond text-2xl font-extrabold tracking-[0.02em]` |
| Lab pane heading (`PaneHeading`) | `cond text-[26px] font-extrabold` |
| Rail heading (`RailHeading`) | `cond text-lg font-extrabold tracking-[0.03em]` |
| Odds on a result button | `plate text-[26px]` first number, `text-lg` second; one size down when `small` |
| "What it takes" record tiles | `plate text-[34px]` |
| Board column headings, labels under numbers | `cond text-[11px] font-bold tracking-[0.06em]–[0.08em] text-board-muted` |
| Body on the ground | Public Sans, default size; notes `text-[13px]`, footnotes `text-xs` |

## Numbers and wording

All user-facing odds and path wording comes from `src/core` (public API `src/core/index.ts`), so black-box tests can
check it. The app never formats a probability or writes a path sentence itself. If you need new wording, add it to the
core with a black-box test, then display it.

Formatters to reach for:

| Function | What it shows |
| --- | --- |
| `formatSideOdds(p, status)` | Any odds on the board. One decimal under 1% (`"0.4%"`), whole percents otherwise. A live team never shows a flat 0% or 100%: `"<0.1%"` and `">99%"`. A team that's out can show `0%`. The Lab's text fields (`fieldTexts`, `titleGameText`, `championText`) are built from it. |
| `formatTitleOdds(p, status)` | Title-game odds: `"In"` once clinched, `"Out"` once eliminated (both proven), else `formatSideOdds`. |
| `formatFine(p)` | The same one-decimal precision, without a status. |
| `formatOdds(p)` | Whole percents only (`"<1%"`, `">99%"`), for the team list and older views. |
| `formatPlayoff`, `formatChampion`, `formatRecord`, `playoffDetail`, `oddsLabels` | The header's numbers, the record in the picker, and labels. |
| `shownChange(before, after)` | How far odds moved, **in points of the odds as shown** (`">99%"` counts as 99, `"<0.1%"` as 0.1), so the move matches the two numbers on screen: `"+4"`, `"−0.3"`, or `null` when they read the same. Uses a real minus sign (`−`). |
| `labOddsChange(before, after)` | The same move with its unit, for where the move stands alone (the Lab's pin strip and dock): `"+4 pts"`, `"+1 pt"`. |
| `winsLabel(name, abbreviation)` | A result button's label as `{ full, short }`: `"Florida International wins"` and `"FIU wins"`. The button picks one by width. |
| `titleGameOutLine(conference, outlook)` | Once the title game is proven Out: `"Out of the Big Ten title game. Playoff odds only."`; `null` while the team can still play in it. |
| `conferenceShort(c)`, `conferenceName(c)` | The short form (`"SBC"`) and the full name. |

Rules that follow from this:

- "In" and "Out" (and a flat 100% or 0%) appear only when the core has proven them. Never round your way there. Every
  live team reads `"<0.1%"` or `">99%"` on every page, the Lab's field and races and the team sheet included.
- An odds move is green (`root`) or red (`drop`) wherever it shows, the Lab's pin strip and dock too. Beside a number
  inside a result button it is a bare `+1`; where it stands alone it carries its unit, `+1 pt`.
- Conference names: the short form on board labels and tags ("Win SBC"), the full name in headings and sentences. One
  conference order everywhere, `CONFERENCE_ORDER` in `src/app/explorer/conference.tsx`: ACC, Big Ten, SEC, Big 12,
  American, Pac 12, MW, SBC, MAC, CUSA, Independents.
- Footnotes end with "Data through <date>." so the date is reachable on phones, where the site bar hides it.
- An odds change is a difference of the two numbers shown, never of the raw probabilities.
- The playoff estimate is the site's own model, not the committee. Label it: the team page marks Playoff with `*` and a
  footnote; the Lab's note reads "Our model, not the committee." There is no "Beta" tag anywhere.
- Terms: "In", "Out", "Must win [conference]", "Non-con", "likeliest way in", "help from elsewhere" (`PRODUCT.md`).

## Surfaces, shape and depth

- **Radii are small.** `rounded` (4px) for boards and cards; `rounded-[3px]` for buttons and inputs; `rounded-[2px]`
  for chips, segments, nav items and tags; `rounded-md` only for floating panels (menus, the team sheet, the phone
  dock). `rounded-full` only for the loading pill and list bullets.
- **Boards are flat.** A board is `rounded bg-board-deep`, no border and no shadow. Rows inside are divided by
  `border-board-line` hairlines (`not-first:border-t`).
- **Shadows are for things that float**: the team sheet and search results
  (`shadow-[0_12px_32px_rgba(10,36,26,0.4)]`), the phone dock, the Lab's fill menu on the ground. Nothing at rest on
  the page has a shadow.
- **Edges, not boxes, for emphasis.** The page's team in a race gets an inset left bar, `shadow-[inset_3px_0_0_var(--color-lamp)]`;
  the best record tile gets an inset top bar. A team just under the cut gets the same bar in `board-line`.
- **The header** is `board-dots` (board green with a faint 6px dot grid), sticky on phones, static from `md` (team
  page) or `lg` (Lab).

## Components

Shared building blocks live in `src/app/explorer/Board.tsx` and are reused by the Lab.

### Team logos and names

- `TeamLogo({ id, dark, size })` loads CollegeFootballData's 64px logo: `logos-dark` (the default, `dark`) on the board,
  `logos` (`dark={false}`) on the ground, on white, or on an amber pick. When a button fills amber, flip it:
  `<TeamLogo id={id} dark={!on} />`. Logos are decorative (`alt=""`); the name is always next to them.
- `TeamName({ id, name, dark, abbreviate })` is logo (`gap-1`), then this week's committee rank (`#16`, from `RanksContext`, smaller and
  dimmer), then the name, truncating. Use it wherever the page names a team.

#### Team names

Full name or abbreviation depends on where the name sits. A name never ends in an ellipsis where an abbreviation can
stand in, except in race rows.

| Where | Rule |
| --- | --- |
| Team page header | Always the full name. It steps down in size and wraps; never an ellipsis. |
| Pick buttons in the Lab (`TeamButton`) | Full name when the button is about 200px or wider (the switch is at 220px), else the abbreviation, by container query. |
| Result buttons on the team page | Labels use the abbreviation ("FIU wins") below 280px (`winsLabel`). |
| Race rows in the rail | The name truncates with an ellipsis; when the name column is under 120px it switches to the abbreviation. |
| Dock and bracket | Always the abbreviation. |
| Headings and sentences | Always the full name. |

### Result buttons (the pick)

`Outcome` (team page) and `TeamButton` (Lab) are the core interaction. Both:

- are real `<button type="button">` elements with `aria-pressed={picked}` and a `title` that says what a tap does
  ("Lock: …", "Picked. Tap again to clear.");
- rest as `border-board-line bg-white/[0.04]`, hover to `border-board-muted bg-white/[0.07]`;
- fill when picked: `border-lamp bg-lamp text-plate-ink`, every child switching to `plate-ink`;
- are at least 44px tall below `lg` (`min-h-11`);
- use `.press` for the short color transition and a 0.97 scale on press.

`Outcome` shows the result's label (`cond`), its chance (Public Sans, `text-xs`), then one or two lit numbers, each with
a `cond` label under it. A number may carry an odds change, `plate text-[13px]`: `text-root` when it starts with `+`,
`text-drop` otherwise. Once the title game is proven Out, the buttons show only the Playoff number under the
`titleGameOutLine` sentence, and record tiles that all read the same fold into one "Any finish: <value> playoff" block
(from the core's board). In the Lab, a picked `TeamButton` swaps its odds for `PickMark` (a heavy square-ended check,
`role="img" aria-label="Picked"`), and the beaten side fades to `opacity-40` (no strike-through: the fade and the amber winner say it).

### Week-by-week and help cards

`WeekRow`: date (`cond text-xs text-board-muted`), game (`cond text-lg font-bold text-white`), an optional tag, then a
`Pair` of results: stacked on phones, two columns from `sm`, game and results side by side from `lg`
(`lg:grid-cols-[13rem_minmax(0,1fr)]`). A finished game shows "Won 31-17" in white or "Lost …" in `board-muted`.

Tags on a row:

- `Non-con`: a solid 1px `board-muted` outline, `cond text-[11px]`.
- **Projected** (a game not yet confirmed): the same tag with a **dashed** outline, the explanation in its `title` and
  in an `sr-only` span.

`HelpElsewhere` groups games by the team to root against, one board per team, heading "Root against [team]".

### Races

- `PlayoffRaceCard` / `RaceBlock`: column headings from the core (`race.columns`), then rows of seed, team, projected
  rank and odds. Lines between rows are dashed: `bye` and `bid` lines in `board-line` with a `board-muted` label, the
  **cut** line in `lamp` with a `lamp` label. `⋯` marks a gap, "Next in line" introduces the teams out (dimmed to
  `board-muted`). The page's team is lit: amber bar on the left, name and odds in `lamp`. A row under the line gets the
  faint wash and a `board-line` bar. A Group of Six page shows its **Group of Six block first** (its race for the bid),
  then the at-large field, each block with its own title.
- `ConferenceRace`: the five likeliest plus the page's team, record and title-game odds; the page's team is the only
  one lit (`BoardRow`).
- Lab `Races`: per conference, the two leaders (plus the pinned team and the picked winner), a tap opening the
  standings table (`aria-expanded`).

### Best shot

`BestShotCard`: the core's headline, then a table (`role="table"`, `row`, `columnheader`, `cell` on a CSS grid) of
steps. Each step's number sits in a small square: `board-muted` fill while open, `lamp` once your picks complete it (and
for the final step), a red `hurt` ring when a pick goes against it. Gains under each number use `text-root`. The fill
button is solid `lamp`; once filled it turns to an amber outline, "Undo this path".

### Buttons

| Kind | Look |
| --- | --- |
| Board action (Undo, Reset, Share) | One suite, in that order, on the team page and in the Lab. One size everywhere, `BOARD_ACTION` in `src/app/BoardButton.tsx`: `cond` 16px bold, `h-11` (`lg:h-9`), `px-3.5`, `min-w-24`, 1px border, never wrapping. Outlined `border-board-line text-white`, hover `border-board-muted`. Undo and Reset carry an icon (`BoardButton`); below `sm` they are 44px icon squares with the label kept for screen readers (Share on the board too, team page and Lab alike). Undo steps back through the last 50 changes (a Reset included). |
| Lab link on the team header | Text, not a button: "Open picks in Lab" ("Lab" below `sm`), `cond` 15px bold `board-text`, hover white, an amber →, and "· 2 picks" in small `board-muted` sans when there are picks. Under the suite, right-aligned, on one screen; otherwise on its own line under the playoff road. |
| Share on the board | The cream plate: `bg-plate text-plate-ink`, its border the same cream, hover `bg-white`. Same box as the other board actions. With no picks it dims to `opacity-55` but stays pressable, on the team page and in the Lab alike. |
| Reset with picks to clear | Lit: `border-lamp bg-lamp text-plate-ink` (`resetLook`). Without: `border-board-line text-board-muted opacity-50`, disabled. The team page and the Lab match. |
| Primary on the ground | `bg-board text-white`, hover `bg-board-deep` ("Fill the rest", "Pick a team"). |
| Secondary on the ground | `border border-rule bg-white`, hover `border-ink-muted`. |
| Segmented control / chips | `rounded-[2px] border`. Off: `border-rule bg-white text-ink-soft`. On: `border-board bg-board text-white`. An amber chip (the pinned team's games) is `border-lamp` and fills `lamp` when on. |
| Icon button | A visible 32px+ hit area and an `aria-label` ("Remove …", "Unpin …", "Find a team"). |

Arrows that lead elsewhere ("Try it in the Lab →") put the arrow in `text-lamp`, `aria-hidden`.

### Odds band and playoff road (team page header)

The header's main numbers sit in one `board-deep` band of equal cells (`OddsBand` in `Explorer.tsx`), divided by
`board-line` hairlines: label over lit number, left-aligned, the lead label (Playoff) in white and the others in
`board-muted`. A conference team has three (Playoff, title game, win the conference), an independent one. Phones use the
labels' short forms ("Title game"). Nothing floats or bottom-aligns: every width is the same rows.

The playoff's second tier, first-round bye and national title (`playoffDetail`, or seed and national title once the field
is announced), is a thin **playoff road** row under the band (`PlayoffRoad`): a `board-muted` "Playoff road" label,
then each pair as a small `cond` label and a small lit number in `board-text`, a clear step down from the band. It is
never prose, and never in the band's cells. No row when there's no detail.

### Site bar and search

`SiteBar` (`src/app/SiteBar.tsx`) is the same on every page: the mark (with the name from `lg`), the nav, team search,
and "Through Oct 31" (from `md`, with the as-of time in its `title`). Nav items and the date never wrap. Nav items
keep a 28px look; below `lg` an extended hit area makes them 44px. The not-found page has the bar too. The current nav item is a `span` on the cream plate with
`aria-current="page"`; the others are links in `board-muted` that light to white on hover.

Team search is a combobox: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, a
`role="listbox"` of `role="option"` rows; arrow keys move, Enter opens, Escape clears. On phones it starts as a 32px
search button and opens across the bar. The field's **rounded box shows the focus ring**, not the input:
`focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-lamp focus-within:border-board-muted` on the
wrapper and `outline-none` on the input. The team sheet's search and the Lab's "Find a team" field use the same
pattern (on the ground, the border goes to `ink-muted`).

### Team picker and sheet

The header's team name is a button styled like a select (name in a field, chevron in its own cell) with
`aria-expanded` and `aria-controls="team-sheet"`. The sheet floats under it (`animate-pop`), closes on Escape or a tap
outside, and returns focus to the picker. Inside, `TeamList` (`src/app/explorer/Panels.tsx`): one row with the conference
switcher (a native `<select>` laid invisibly over the short name and an amber chevron, styled as a field like the
search, so phones get the OS picker; its first choice, "All teams", lists every team, and a search spans every conference too)
and the search. With all teams listed only the Playoff column shows: title-game odds don't compare across conferences. Under it the column
labels, each a sort button: Team (A–Z) on the left, Playoff and Title game on the right (the active one in `lamp` with a
stemmed down arrow, not the dropdown's chevron; playoff is the default, ties fall to the other odds column, then the name). Then rows of
logo, name, record and odds. The current team's row is `bg-lamp/10` with the amber left bar and `aria-current="page"`.

### Your picks (rail)

`YourPicks` (`src/app/explorer/Board.tsx`): picks grouped under their date (a `.cond` muted uppercase label), each a
white chip (`rounded-[2px] border border-rule bg-white`) with its wording and a × to remove it. No buttons under it:
Share, Reset and the Lab are in the header.

### Status and loading

- A what-if in flight dims the main column (`opacity-80`) and sets `aria-busy`; a `role="status"` line says
  "Updating…", or "Couldn't update. Showing the last result." in `hurt`.
- Opening another team covers the column with a white veil and a "Loading [team]…" pill (`role="status"`).
- On phones the Lab header's field-change row is a fixed 28px, one line, so the header never changes height; the full
  block shows from `md`. Opened from a link with picks, it reads "N picks loaded." (from the core).
- The Lab header's "Field change" block is `aria-live="polite"`: the core's `LabChanges.lines` as up to two short
  lines, a small label (`In`/`Up` in `root`, `Out`/`Down` in `drop`) then the teams in white, each new seed small in
  `board-muted` before the name, up to four a line then "+N". It never grows the header. A note shows in `lamp` instead.
- The Lab's seeds and top 25 show each team's record (picks counted, a picked title game too) small in `board-muted`
  after the name. Rank tags are the current ranking only; the Lab shows no projected-seed tags beside names.
- The Lab's top 25 opens to every FBS team with a `RankToggle` under #25: a dashed `board-line` rule with a centred
  amber label (`cond`, 12px), "All 138 (projection) ▾" closed and "Top 25 ▴" open (labels from the core's
  `allLabel`/`topLabel`). "Projection" flags that places past 25 come from our committee stand-in. Open, a second
  toggle ends the list (named `backLabel`, "Back to top 25", for screen readers); it folds the list, focuses the
  first toggle and scrolls it into view. Both carry `aria-expanded`. The "Unranked" tag shows only inside the top 25. A pinned team ranked below the folded list shows under #25 behind a dashed rule with its place and an amber "Pinned" tag, as the seeds view shows it under the bubble; opening the whole ranking drops that row.

## Layout

Phone first: most use is on a phone around Saturdays. Three shapes matter.

### Phone (about 375px)

- Team page: one column. A sticky block stays: the 52px name line (the picker: name with the record under it; then
  Undo, Reset and Share, all three 44px icon squares below `sm`) over the odds band. Under it, scrolling away: the
  playoff road, then the "Open picks in Lab →" link. The rail follows the main column under a `rule` border.
- Lab: a Field / Games / Races tab strip (`role="tablist"`) under the header; one pane at a time. A pinned
  team docks at the bottom as a ticket in thumb reach (`fixed`, above `env(safe-area-inset-bottom)`), opening upward,
  and flashes amber (`.bump`) when its odds change. Game rows show team abbreviations instead of full names.
- Site bar: search collapses to a button; the "Through" date and the site name hide.
- Every control is at least 44px (`min-h-11`, `h-11`) below `lg` (1024px), tablets included, not just phones; compact
  sizes (28 to 40px) start at `lg`.
- Content must fit 375px with no horizontal page scroll. Wide content scrolls inside its own box (the bracket, the
  chip row, which fades out at its right edge on phones).

### Desktop (`tall:md` for the team page, `lg:tall` for the Lab)

One screen needs width **and** 640px of height (the `tall:` variant, `min-height: 640px`, in `globals.css`). The team
page needs 768px wide, the Lab 1024px.

- The page is exactly one screen tall (`h-dvh overflow-hidden`); the header is static and **each column scrolls on its
  own** (`overflow-y-auto` with `.scroll-thin`).
- Team page: main column plus a 300px `paper` rail (`md:grid-cols-[minmax(0,1fr)_300px]`). The header is three rows:
  the identity row (the picker with the record under the name; at the row's end Undo, Reset, Share with the Lab link
  under them, right-aligned), the odds band, and the playoff road. No status tags: the band says it.
- Lab: three panes, field (320 to 380px, `paper`), games (flexible, on the ground), races (300px, `paper`). The "Season
  Lab" title shows from `xl`. A pinned team gets a strip under the header with before → after odds.

### Short desktop and tablets

Below those sizes, or on a screen under 640px tall (a laptop window around 1280×600), the page scrolls as one. The team
page's name line (with Undo, Reset, Share, labelled from `sm`) and odds band are the only sticky part; the Lab's header is sticky. The Lab's pane tabs are the header's last
row on the board: text tabs, `cond` 16px bold, 44px tall, `board-muted`, the selected one white with a 3px `lamp`
underline. They show whenever the three panes aren't side by side.

Keep the header compact; don't add rows to it. On a tall screen the fixed header leaves the columns what's left, and
they scroll inside.

## Motion

Short, eased, never bouncy. Defined in `globals.css`:

- `.plate-hang`: a lit number flips once (180ms, two steps) when it changes. Use `Lit` (`src/app/Lit.tsx`), which flips
  on a change only, never when the number first appears (page load, a tab or view switch, a new team), so new content
  rises in without every digit also flipping. Every changing number uses it: the team header's band and playoff road,
  result buttons, record tiles, the Lab's picks count, field, top 25 and races.
- `.bump`: a 900ms amber glow that fades into the board, for the phone dock when odds move.
- `animate-pop` (160ms) for floating panels (the team sheet) and the pick mark. `animate-rise` (220ms, content rising
  4px as it fades in) for new content: the Lab's panes as a phone tab shows them, a Field view switch, the games list
  when its filter changes, the field-change headline and opened standings. Use `motion-safe:`.
- The Lab's field, at-large and Group of Six bubbles and top 25 rows glide to their new place (360ms) when a pick reorders them,
  and new rows rise in (`useFlip` in `Lab.tsx`, keyed by `data-flip`). A row moved again mid-glide starts from where it
  is on screen, not its last resting place. Their numbers flip as they change.
- `.press`: 180ms transitions of background, border, text color and opacity (so a pick's amber border and the beaten
  side's fade ease with the fill), and a 0.97 press scale. Result buttons, board actions, segments and chips use it.
  The Lab's pane tabs ease their underline color.
- The phone dock's panel and the bracket's "Your champion" line rise in (`animate-rise`) when they appear.
- `prefers-reduced-motion: reduce` cuts every animation and transition to 1ms and drops the press scale.

## Accessibility

- **Focus ring**: `:focus-visible` draws a 2px outline in `var(--focus)`, offset 2px, in `@layer base` so a field
  wrapper can show the ring itself and its input can opt out with `outline-none`. `--focus` is board green on light
  surfaces and `lamp` inside `.board-dots`, `bg-board`, `bg-board-deep` and `bg-board-deeper` containers (their children
  inherit it, so a green button on the ground keeps the green ring). Never remove the outline without moving it to a
  visible wrapper.
- **Contrast** (WCAG ratios, computed from the tokens):

  | Pair | Ratio |
  | --- | --- |
  | `white` on `board-deep` | 15.0 |
  | `board-text` on `board-deep` | 11.5 |
  | `board-muted` on `board-deep` | 7.4 |
  | `board-muted` on `board` | 5.8 |
  | `lamp` on `board-deep` | 8.0 |
  | `root` on `board-deep` | 7.8 |
  | `drop` on `board-deep` | 5.7 |
  | `plate-ink` on `lamp` | 9.4 |
  | `ink` / `ink-soft` / `ink-muted` on `ground` | 13.4 / 7.5 / 4.5 |
  | `ink-muted` on `paper` | 5.3 |
  | `lamp-ink` on `ground` / `paper` | 4.6 / 5.4 |
  | `lamp` on `ground` | 1.5 (never use as text there) |

  `board-muted` passes AA for small text on both board greens, so it's safe for labels and dates. `ink-muted` on
  `ground` sits right at 4.5; don't go lighter.
- **Color is never the only signal.** A pick is a fill *and* `aria-pressed` *and* (in the Lab) a check mark. A gain
  or loss is a `+` or `−` sign as well as green or red. The page's team has an edge bar as well as amber text.
- **ARIA patterns in use**: `aria-pressed` for picks, filters, chips and segments; `aria-expanded`/`aria-controls` for
  the team sheet, race standings and the fill menu; `aria-current="page"` for the current nav item and team; a full
  combobox for team search; `role="tablist"`/`tab`/`aria-selected` for the Lab's phone panes; `role="status"` and
  `aria-live="polite"` for updates and the Share result; `aria-busy` while a what-if runs; `aria-labelledby` linking
  each section to its heading; `sr-only` text for labels a sighted user gets from layout (the search label, the
  Projected explanation).
- Decorative SVGs and arrows are `aria-hidden`; the mark is `aria-hidden` when the name is beside it, otherwise
  `role="img"` with a label.

## The mark

A football whose laces form a pulse line. `src/app/Logo.tsx`:

- On the board (the site bar): cream ball (`plate`), board-green pulse; these are the defaults.
- On a light ground: pass `color="#133F2E" pulse="#F3F0E6"` (as `not-found.tsx` does).
- Below 48px it drops the lace ticks and thickens the pulse (`simple`, automatic by size).
- `decorative` hides it from screen readers when the name is next to it.
- Favicon `src/app/icon.svg` (simple form) and `public/logo.svg` (full form) are the board-green ball with a cream
  pulse.

## Do and don't

| Do | Don't |
| --- | --- |
| Put odds on the board as `plate` digits in white (or `lamp` for the page's team). | Put a number in a bordered pill, badge or tile. |
| Fill a picked result with `lamp` and switch its text to `plate-ink` and its logo to `logos`. | Mark a pick with an amber border or amber text alone. |
| Show a gain as `+5` in `root` and a loss as `−2` in `drop`, on the board. | Use green or red for anything that isn't a change in odds (status, success, branding). |
| Use amber for one lit thing per row: the pick, the page's team, the cut. | Use amber for decoration, links or general highlighting. |
| Get odds strings and path sentences from `@/core` (`formatSideOdds`, `shownChange`, …). | Write `` `${Math.round(p * 100)}%` `` or a path sentence in a component. |
| Count an odds move in points of the shown odds ("+1 pt"). | Subtract raw probabilities for a change that won't match the two numbers on screen. |
| Use `lamp-ink` for amber text on the ground. | Use `lamp` as text on `ground` or `paper` (1.5:1). |
| Give a button a 1px outline; leave labels and readouts unboxed. | Outline headings, labels or numbers to make them look important. |
| Use tokens (`bg-board-deep`, `border-rule`). | Use hex values, or the legacy `navy`/`teal`/`marker` names, in new code. |
| Keep tap targets at 44px below `lg`. | Shrink phone targets to fit more on a row; use abbreviations instead. |
| Keep the site light-only. | Add a dark mode or `prefers-color-scheme` styles. |

## Known drift

Places where shipped code doesn't yet follow this guide. Fix them when you touch the file; don't copy them.

- **Toledo on amber.** The Lab draft (`b-lab.html`) notes Toledo's light logo is mostly gold and disappears on an amber
  pick, and shows its dark logo on a small dark disc instead. The shipped `TeamLogo` has no exception yet, so a
  picked Toledo shows the light logo on amber.
- **Share card font.** `src/app/lab/card.tsx` (the Lab's share image: green ground with dot texture, cream mark, seeds
  as board rows with team logos, amber seeds 1 to 4, an outlined "SEC champ" tag on each projected conference champion and "G6 bid" on the Group of Six bid, the title favorite on an amber plate; or, for a link with a filled-in bracket, "My playoff bracket": a column per round, each game level with the games feeding it, the pick filled amber with the light logo and the beaten side faded, then "My champion" with its logo, name in amber and seed) uses a bold sans
  stand-in, because no Saira Condensed `.ttf` is in the repo for `ImageResponse`.
