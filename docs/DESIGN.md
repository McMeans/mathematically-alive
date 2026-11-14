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
  with two narrow exceptions noted below (status tags and the dashed "Projected" tag).
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
| `lamp` | `#F2B134` | Amber. A pick (button fill), the page's own team in a race (left edge and its numbers), the cut line, a big game's 2px outline, the focus ring, "live" status tags, a reset button that has something to reset, text selection. |
| `lamp-ink` | `#8A5D00` | Amber as text on the ground, where `lamp` is too light (1.5:1). Used for notes like "title pick cleared". |
| `plate` | `#F3F0E6` | The cream plate: the current nav item, Share on the board, the selected conference tab in the team sheet, the mark's ball. |
| `plate-ink` | `#121A16` | Text on `plate` and on `lamp`. |
| `root` | `#5FD08F` | A gain in odds, lit on the board: "+5" on the side to root for. |
| `drop` | `#F0806E` | A loss in odds, lit on the board: "−2". |

### The ground

| Token | Hex | Use |
| --- | --- | --- |
| `ground` | `#E4E7E5` | Page background (set on `body`), the Lab's phone tab strip. |
| `paper` | `#F6F8F7` | Rails and side panes: the team page's summary column, the Lab's field and races panes. |
| `white` | | Inputs and secondary buttons on the ground (Open in Lab, Reset, unselected chips and segments). |
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
| Team name in the header (picker) | `cond text-2xl md:text-[40px] font-extrabold` |
| Lead number in the header (Playoff) | `plate text-[32px] md:text-[56px]` |
| Other header numbers | `plate text-[22px] md:text-4xl` |
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
| `formatSideOdds(p, status)` | Any odds on the board. One decimal under 1% (`"0.4%"`), whole percents otherwise. A live team never shows a flat 0% or 100%: `"<0.1%"` and `">99%"`. A team that's out can show `0%`. |
| `formatTitleOdds(p, status)` | Title-game odds: `"In"` once clinched, `"Out"` once eliminated (both proven), else `formatSideOdds`. |
| `formatFine(p)` | The same one-decimal precision, without a status. |
| `formatOdds(p)` | Whole percents only (`"<1%"`, `">99%"`), for the team list and older views. |
| `formatPlayoff`, `formatChampion`, `formatRecord`, `statusTags`, `playoffDetail`, `oddsLabels` | The header's numbers, record line, status tags and labels. |
| `shownChange(before, after)` | How far odds moved, **in points of the odds as shown** (`">99%"` counts as 99, `"<0.1%"` as 0.1), so the move matches the two numbers on screen: `"+4"`, `"−0.3"`, or `null` when they read the same. Uses a real minus sign (`−`). |
| `labOddsChange(before, after)` | The same move with its unit, for the Lab: `"+4 pts"`, `"+1 pt"`. |

Rules that follow from this:

- "In" and "Out" (and a flat 100% or 0%) appear only when the core has proven them. Never round your way there.
- An odds change is a difference of the two numbers shown, never of the raw probabilities.
- The playoff estimate is the site's own model, not the committee. Label it: the team page marks Playoff with `*` and a
  footnote; the Lab shows a "Beta" tag and "Modelled, not the committee."
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
- `TeamName({ id, name, dark })` is logo (`gap-1`), then this week's committee rank (`#16`, from `RanksContext`, smaller and
  dimmer), then the name, truncating. Use it wherever the page names a team.

### Result buttons (the pick)

`Outcome` (team page) and `TeamButton` (Lab) are the core interaction. Both:

- are real `<button type="button">` elements with `aria-pressed={picked}` and a `title` that says what a tap does
  ("Lock: …", "Picked. Tap again to clear.");
- rest as `border-board-line bg-white/[0.04]`, hover to `border-board-muted bg-white/[0.07]`;
- fill when picked: `border-lamp bg-lamp text-plate-ink`, every child switching to `plate-ink`;
- are at least 44px tall on phones (`min-h-11`);
- use `.press` for the short color transition and a 0.97 scale on press.

`Outcome` shows the result's label (`cond`), its chance (Public Sans, `text-xs`), then one or two lit numbers, each with
a `cond` label under it. A number may carry an odds change, `plate text-[13px]`: `text-root` when it starts with `+`,
`text-drop` otherwise. In the Lab, a picked `TeamButton` swaps its odds for `PickMark` (a heavy square-ended check,
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
| Board action (Undo, Reset, Lab link in the header) | `cond h-9 rounded-[3px] border border-board-line text-white`, hover `border-board-muted` (Lab link hovers to `border-lamp`). Disabled: `opacity-40`. |
| Share on the board | The cream plate: `bg-plate text-plate-ink`, no border, hover `bg-white`. |
| Reset with picks to clear | Lit: `border-lamp bg-lamp text-plate-ink`. Without: `border-board-line text-board-muted opacity-50`, disabled. |
| Primary on the ground | `bg-board text-white`, hover `bg-board-deep` ("Fill the rest", "Pick a team"). |
| Secondary on the ground | `border border-rule bg-white`, hover `border-ink-muted` (Share picks, Open in Lab, Reset in the rail). |
| Segmented control / chips | `rounded-[2px] border`. Off: `border-rule bg-white text-ink-soft`. On: `border-board bg-board text-white`. An amber chip (the pinned team's games) is `border-lamp` and fills `lamp` when on. On the board (team sheet tabs) the on state is the cream plate. |
| Icon button | A visible 32px+ hit area and an `aria-label` ("Remove …", "Unpin …", "Find a team"). |

Arrows that lead elsewhere ("Try it in the Lab →") put the arrow in `text-lamp`, `aria-hidden`.

### Status tags

In the header, beside the record: `cond text-xs font-extrabold tracking-[0.1em] rounded-[2px] border px-1.5`.
A live goal is `border-lamp text-lamp`; a settled one `border-board-line text-board-muted`. The labels come from
`statusTags` in the core.

### Site bar and search

`SiteBar` (`src/app/SiteBar.tsx`) is the same on every page: the mark (with the name from `md`), the nav, team search,
and "Through Oct 31" (with the as-of time in its `title`). The current nav item is a `span` on the cream plate with
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
outside, and returns focus to the picker. Inside, `TeamList` (`src/app/explorer/Panels.tsx`): conference tabs as
`aria-pressed` buttons, a search, sortable Playoff / Title game columns (the active one in `lamp` with a chevron), rows
of logo, name, record and odds. The current team's row is `bg-lamp/10` with the amber left bar and `aria-current="page"`.

### Status and loading

- A what-if in flight dims the main column (`opacity-80`) and sets `aria-busy`; a `role="status"` line says
  "Updating…", or "Couldn't update. Showing the last result." in `hurt`.
- Opening another team covers the column with a white veil and a "Loading [team]…" pill (`role="status"`).
- The Lab header's "Field change" block is `aria-live="polite"`: the core's `LabChanges.lines` as up to two short
  lines, a small label (`In`/`Up` in `root`, `Out`/`Down` in `drop`) then the teams in white, each new seed small in
  `board-muted` before the name, up to four a line then "+N". It never grows the header. A note shows in `lamp` instead.
- The Lab's seeds and top 25 show each team's record (picks counted, a picked title game too) small in `board-muted`
  after the name. Rank tags are the current ranking only; the Lab shows no projected-seed tags beside names.

## Layout

Phone first: most use is on a phone around Saturdays. Three shapes matter.

### Phone (about 375px)

- Team page: one column. The sticky header stacks the picker, record and tags, the numbers (spread across the width),
  then the actions (Lab, Share, Reset; labels shorten to "Lab" and an icon-only Reset). The rail follows the main
  column under a `rule` border.
- Lab: a Field / Games / Races tab strip (`role="tablist"`, 44px tabs) under the header; one pane at a time. A pinned
  team docks at the bottom as a ticket in thumb reach (`fixed`, above `env(safe-area-inset-bottom)`), opening upward,
  and flashes amber (`.bump`) when its odds change. Game rows show team abbreviations instead of full names.
- Site bar: search collapses to a button; the "Through" date and the site name hide.
- Every tap target is at least 44px (`min-h-11`, `h-11`) on phones; some shrink to 28 to 36px from `md`, where a
  pointer is likely.
- Content must fit 375px with no horizontal page scroll. Wide content scrolls inside its own box (the bracket, the
  chip row, which fades out at its right edge on phones).

### Desktop (`md` and up for the team page, `lg` and up for the Lab)

- The page is exactly one screen tall (`h-dvh overflow-hidden`); the header is static and **each column scrolls on its
  own** (`overflow-y-auto` with `.scroll-thin`).
- Team page: main column plus a 300px `paper` rail (`md:grid-cols-[minmax(0,1fr)_300px]`). The picker column sits
  beside the numbers in the header.
- Lab: three panes, field (320 to 380px, `paper`), games (flexible, on the ground), races (300px, `paper`). The "Season
  Lab" title shows from `xl`. A pinned team gets a strip under the header with before → after odds.

### Short desktop

On a laptop around 1280×720 the header is fixed height, so the columns get what's left and scroll inside. Keep the
header compact; don't add rows to it. A `tall:` variant (`min-height: 640px`) exists in `globals.css` for pinning a
block above a scrolling list only when the screen has room; nothing uses it today.

## Motion

Short, eased, never bouncy. Defined in `globals.css`:

- `.plate-hang`: a lit number flips once (180ms, two steps) when it changes. Re-key the element on its value so it
  runs.
- `.bump`: a 900ms amber glow that fades into the board, for the phone dock when odds move.
- `animate-pop` (160ms) for floating panels (the team sheet). `animate-rise` (220ms, content rising 4px as it fades
  in) is defined for new content; nothing uses it today.
- `.press`: 180ms color transitions and a 0.97 press scale on buttons.
- `prefers-reduced-motion: reduce` cuts every animation and transition to 1ms and drops the press scale.

## Accessibility

- **Focus ring**: `:focus-visible` draws a 2px `lamp` outline, offset 2px, in `@layer base` so a field wrapper can
  show the ring itself and its input can opt out with `outline-none`. Never remove the outline without moving it to a
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
| Keep tap targets at 44px on phones. | Shrink phone targets to fit more on a row; use abbreviations instead. |
| Keep the site light-only. | Add a dark mode or `prefers-color-scheme` styles. |

## Known drift

Places where shipped code doesn't yet follow this guide. Fix them when you touch the file; don't copy them.

- **Lab odds moves use amber, not green.** `PinOdds` and `DockNum` in `src/app/lab/Lab.tsx` color a gain `text-lamp`
  and a loss with a raw `#f08a7e` instead of `text-root` and `text-drop`.
- **Inline percent formatting in the Lab.** `Field` and `Races` in `Lab.tsx` round odds with local `pct` helpers
  (`Math.round(x * 100)`) instead of a core formatter, so long shots read "0%" or "<1%" where the team page shows
  "0.4%".
- **Hex values in components**: the lit Reset hover `#f5c056` in `Explorer.tsx`.
- **Legacy tokens**: the loading pill in `Explorer.tsx` uses `navy`; `.scroll-thin` in `globals.css` uses `navy`.
- **Toledo on amber.** The Lab draft (`b-lab.html`) notes Toledo's light logo is mostly gold and disappears on an amber
  pick, and shows its dark logo on a small dark disc instead. The shipped `TeamLogo` has no exception yet, so a
  picked Toledo shows the light logo on amber.
- **Focus ring on light grounds.** The amber ring is 1.5:1 against `ground` and 1.8:1 against `paper`, below the 3:1
  WCAG asks of focus indicators. It reads well on the board (8:1). A darker ring on light surfaces would fix it.
