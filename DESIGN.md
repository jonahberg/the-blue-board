# Design System — The Blue Board

A dark-first operations dashboard built on **shadcn/ui** (`radix-nova` style) and **Tailwind
v4**, with one United-blue primary against neutral zinc surfaces. The personality is in the
density and the data, not in the chrome: this is a tool people leave open for hours.

> This file is the design authority for the repo (see `CLAUDE.md`). If a token, class or
> component here disagrees with the code, the code is the bug — fix it or amend this file
> with a Decisions Log row.

## Product Context

- **What this is:** a fan-built real-time ops dashboard for United Airlines — live flight
  tracking, delay/IROPS scoring, schedules, fleet and Starlink data, weather, plus
  prerendered hub / fleet / news / tracker pages.
- **Who it's for:** aviation enthusiasts and United frequent flyers who want ops-center
  visibility.
- **Competitive set:** FlightRadar24, FlightAware, Flighty, ADSB Exchange.
- **Not affiliated with United Airlines, Inc.**

## Aesthetic Direction

- **Dark-first.** `BaseLayout.astro` sets `<html class="dark" style="color-scheme:dark">`.
  There is no light-mode product. The light `:root` palette in `global.css` is the stock
  shadcn neutral scale, kept so the token set is complete — it is **not** a supported theme
  and its `--primary` is near-black, not United blue.
- **One accent.** United blue `oklch(0.66 0.17 255)` is `--primary`, `--ring` and
  `--chart-1`. Everything else is a neutral zinc surface. Colour that is not a status signal
  is decoration, and this product does not decorate.
- **Flat, bordered elevation.** Surfaces separate by `--border` and `--card`, never by drop
  shadow stacks, gradients or blur.
- **Density is the feature.** A screen that fits one more row of real data beats a screen
  with more air.

## Typography

| Role | Family | Notes |
|---|---|---|
| UI, headings, prose | **Geist Sans** (`--font-sans`, `--font-heading`) | `@fontsource-variable/geist` |
| Data, IDs, times | **Geist Mono** (`--font-mono`) | `@fontsource-variable/geist-mono` |

- Both are imported in `src/styles/global.css` and **bundled by Vite into `_astro/*.woff2`**.
  `font-src` is `'self'`: no Google Fonts, no Fontshare, no `public/fonts/`.
- **Sizes are the Tailwind scale** (`text-xs` … `text-2xl`), not hand-written pixel values.
  Arbitrary sizes (`text-[10px]`, `text-[11px]`) are reserved for micro-labels in dense
  dashboard chrome where the scale has no rung.
- **Content pages have an 11px floor.** Nothing under `src/pages`, `src/layouts`,
  `src/components/site|trackers` or `content.css` goes below `text-[11px]` — the 8–10px
  micro-labels belong to the dashboard only (`tests/design-guards.test.js`).
- **Mono is semantic, not stylistic.** Use `font-mono` for anything a reader compares
  character by character: flight numbers, tail numbers, IATA/ICAO codes, times, counts,
  percentages. Numeric columns also take `tabular-nums` so digits line up.
- Prose headings on content pages are styled once, in `src/styles/content.css` under
  `.bb-content`, because that prose arrives as raw HTML strings from `src/data/**` and
  cannot be hand-classed.

## Colour

### Theme tokens — `src/styles/global.css`

The shadcn variable set is the whole palette: `--background`, `--foreground`, `--card`,
`--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`,
`--input`, `--ring`, `--chart-1…5`, `--sidebar-*`. Dark values live under `.dark`; the
`@theme inline` block maps each to a Tailwind colour utility (`bg-card`, `text-muted-foreground`, …).

One token is ours, not shadcn's:

| Token | Dark value | Use |
|---|---|---|
| `--primary-fill` (`bg-primary-fill`) | `oklch(0.5 0.17 255)` | every **filled** surface that carries `--primary-foreground` — buttons, CTAs, badges, the skip link |

`--primary` is tuned as *ink* (text, rings, bars: 6.3:1 on `--background`); behind white
text it is only 3.0:1. `--primary-fill` is the same hue, darker (5.8:1 with white).
`tests/primary-contrast.test.js` pins both pairs. Text and outlines stay `--primary`.

The hues shadcn does not carry are declared in a real `@theme` block:

| Token | Value | Use |
|---|---|---|
| `--color-bb-warn` | `oklch(0.76 0.12 85)` | caution / degraded / in progress |
| `--color-bb-ok` | `oklch(0.74 0.16 150)` | clear / on-time / live |
| `--color-bb-info` | `oklch(0.75 0.13 230)` | informative, not a problem: an estimate, an advisory, "announced" |
| `--color-bb-starlink` | `oklch(0.702 0.183 293.541)` (`#A78BFA`) | Starlink metal — badges, chips, charts |

Red is shadcn's own `--destructive` (`text-destructive`, `bg-destructive/15`). They are emitted
as custom properties (so `content.css` can reach them with `var(--color-bb-ok)` — never
`var(--bb-ok)`, which is not declared) **and** as utilities (`bg-bb-ok`, `text-bb-warn`,
`border-bb-warn/40`).

**The dashboard and every component use these tokens, never the raw Tailwind palette.**
`text-amber-400` and `text-bb-warn` are different ambers; mixing them is how the dashboard's
"ok" green drifted from the content pages' (audit F72). `tests/design-guards.test.js` fails on
any chromatic palette utility (`amber-400`, `emerald-500/40`, `violet-300` …) under `src/app`,
`src/components`, `src/pages` or `src/layouts`, and on any `var(--x)` whose name is not
declared. A count that is a fact rather than a verdict (the IROPS totals) stays in body
colour: hue is for status. A figure labelled canceled counts confirmed cancellations only; the
provider's unconfirmed "Likely Canceled" flights ride beside it as a quieter "+N unconfirmed", and
the IROPS score still counts them (`src/lib/cancellation-display.js`).

### Domain colour constants — `src/lib/*`

Status, phase and category colours are **data**, not styling: they are encodings a chart
legend, a map marker and a table badge must agree on. They live beside the logic that
produces them, are unit-tested, and are the only sanctioned hex literals in the codebase.

| Module | Export | Encodes |
|---|---|---|
| `plane-icon.js` | `PLANE_COLORS`, `PLANE_SIZES`, `PLANE_LEGEND` | map marker fill: watched → Starlink violet (only with the Starlink highlight on) → long-haul amber (only with the Long-haul highlight on) → United Express white (airborne) → phase; airborne Express draws at 85% size in any colour. By default the map is mainline vs Express. The map key renders `PLANE_LEGEND`, which is computed by `planeIconSpec` itself |
| `metar-explain.js` | `CAT_COLORS` | VFR / MVFR / IFR / LIFR flight categories |
| `metar-category.js` | `OPS_COLORS` | normal / caution / warning / severe ops impact |
| `fleet-utils.js` | status list | active, maintenance, stored, NEXT retrofit, painting, Starlink install, future GUM |
| `fleet-view.js` | `FLEET_FAMILY_COLORS`, `FLEET_FAMILY_FALLBACK_COLOR` | aircraft family in the delivery histogram |
| `special-aircraft.js` | `SEAT_BAR_COLORS`, `CABIN_COLORS` | seat-map bars vs cabin classes (**distinct palettes — never conflate**) |
| `starlink-chart.js` | `STARLINK_CHART_COLORS` | express / mainline / cumulative series |
| `stats-chart.js` | `UTIL_BAR_COLOR`, `AGE_BAR_COLOR`, `PHASE_COLORS`, `PHASE_ICONS` | utilisation bars, fleet-age bands, flight-phase donut |
| `connection-risk.js` | `CONN_COLORS` | connection risk bands |
| `weather-cards.js` | `NEUTRAL_MARKER_COLOR`, `UNKNOWN_CAT_COLOR` | no-data map markers |

Owner-approved: Starlink aircraft render **violet** `#A78BFA` on the map (Jul 4 2026) — since v1.16.0 only while the Starlink highlight is on (Oct 4 2026).

### The status rule

**Colour is never the only signal.** Every status colour ships with an icon, a glyph or a
text label in the same element — green/amber/red is unreadable to ~8% of men and invisible
in a screenshot pasted into a thread. This rule is older than the rebuild and survives it.

The phase donut is the worked example: the legacy ramp shipped three blues for Cruise, Climb
and En Route — slices a full-colour reader could not separate, let alone anyone else. The
re-stepped `PHASE_COLORS` keeps adjacent slices apart in hue *and* lightness, and every slice
carries a `PHASE_ICONS` glyph in the legend. A new series goes through both.

## Spacing, Radius, Elevation

- **Tailwind's 4px scale.** No custom spacing tokens.
- **`--radius: 0.625rem`**, with `--radius-sm/md/lg/xl/2xl/3xl/4xl` derived from it in
  `@theme inline`. Use `rounded-md` / `rounded-lg`; never a hard-coded `border-radius`.
- **Density has two registers.** *Compact* for dashboard chrome and tables (`p-2`/`p-3`,
  `gap-1`/`gap-2`, `text-xs`). *Comfortable* for prose on content pages (`p-4`+, `gap-4`,
  section rhythm from `ContentSection`). Pick one per surface and hold it.
- **Elevation is a border plus a surface token.** `bg-card` + `border` for a card,
  `bg-popover` for anything floating. No shadow ladder.

## Layout

**Dashboard** (`src/app/Dashboard.tsx`) — a full-height column:
`OfflineBanner` → `Header` → `Ticker` → `HubHealthStrip` → `WatchBanner` → `TabBar`
(desktop) → active view → engagement slot (`SupportStrip` → `WaitlistStrip` → `NewsBanner` → `TipStrip`) →
`Attribution` → `MobileNav` (mobile). Only the view scrolls; the chrome is `shrink-0`. The `Ticker` row is the ops brief's row whenever a current brief exists (`state/brief.tsx`, rules in `src/lib/brief-view.js`): its tone and its headline on one line, truncated; otherwise it is the rotating ticker. Both are the same 28 px, so a brief arriving, changing or going stale never moves the map. On the Live tab at `lg`+ the full brief sits open in the sidebar under the search box; everywhere else the row opens it as a sheet. The
late-arriving strips mount **below** the panel, never above it, so their arrival never shoves
the data the visitor is reading. The slot shows **one** strip at a time at every width — the first
present, in that order — so the asks never stack under the data: three lines were ~100 px of a
phone's first screen, and the news, the tip and the attribution ~110 px of a 900 px desktop
(`tests/shell-strips.test.tsx`).

**Content pages** — everything goes through `BaseLayout.astro`: skip link → `SiteHeader`
→ `<main id="main">` → `SiteFooter`. Chrome (header, footer) is `max-w-5xl`; page content is
`max-w-4xl`. Sections come from `ContentSection` so an authored section and one arriving as a
raw `contentHtml` string read identically.

## Motion

- **Functional only.** Transitions carry state changes: opacity on a rotating ticker line,
  border/shadow on a hub card, enter/exit on overlays.
- **Budget: 100ms for hover and press, 200ms for overlays, 300ms for cross-fades** where a
  hard swap would read as a glitch (`Ticker`, `WeatherView` freshness line, `QuickAdd`).
  Nothing above 300ms except the content-page freshness fade.
- **`prefers-reduced-motion` is honoured globally** by the block in `global.css`, and
  individually with `motion-reduce:transition-none` where an element animates on data arrival.

## Components

Primitives are shadcn, installed into `src/components/ui/` and edited there rather than
wrapped. Icons are **lucide-react** — tabs, buttons, chips, badges, panel titles, empty
states and dismiss controls — always `aria-hidden` beside a text label or inside a control
that has its own name. Starlink is `Zap` (⚡) everywhere. Two things stay text glyphs on
purpose: the `src/lib` encodings (`PHASE_ICONS`, the ops-health `⛔`/`⚠` markers, the
`✓`/`⚠` weather prefixes), because that layer is DOM-free and those strings also travel into
the ticker, tooltips and screen-reader text; and emoji inside **copy** (toasts, the waitlist, news) where they are part of the sentence, not a control.
`tests/design-guards.test.js` keeps pictographic emoji out of the navigation chrome.

| Need | Primitive | Where |
|---|---|---|
| Flight detail panel | `Sheet` (non-modal): right panel ≥`lg`, bottom sheet peeking at 40dvh below it | `features/FlightSheet.tsx` |
| Filter drawers, watch list, mobile "More" | `Sheet` | `views/LiveView`, `views/schedule/ScheduleControls`, `shell/WatchPanel`, `shell/MobileNav` |
| Aircraft detail, delay explain, FR24 lookup, disclaimer, "What is this dashboard?" (opens on request only: the header "?", the phone More sheet) | `Dialog` (modal) | `features/*Dialog.tsx`, `features/Onboarding.tsx` |
| Global search (⌘K) | `Command` | `features/SearchPalette.tsx` |
| Waitlist signup | `Dialog` + `Input`/`Textarea`/`Label`, opened on request (`?waitlist=1` or the strip's button) or as the deep-use email ask, after a pause | `features/WaitlistDialog.tsx`, `features/WaitlistStrip.tsx`, `features/EmailPrompt.tsx` |
| "Cover a day" support ask for heavy users | inline strip, first in the engagement slot, on the deep-use trigger | `features/SupportStrip.tsx`, `state/deep-use.ts` |
| "Cover a day" month calendar | `<ol>` grid of day cells in the About `Dialog`: covered = filled `bg-primary-fill`, open = dashed outline, today = ring, legend + per-cell sr text | `features/CoverADay.tsx` |
| Amount ladder | outline `Button` links (the $17 chip filled on the content card) + an "Other amount" text link, 44 px on touch | `src/lib/cover-a-day.js` `supportLadder`, `features/CoverADay.tsx`, `components/site/SupportNote.astro` |
| The ops brief, one line | `<button>` in the `Ticker` row: tone word (plus icon and status colour for watch/disrupted) and the truncated headline. Opens the brief sheet, or on Live at `lg`+ focuses the open sidebar panel | `shell/Ticker.tsx`, `features/BriefTone.tsx` |
| The ops brief, in full | `Sheet` (modal): bottom sheet below `lg`, right panel at `lg`+ on tabs without the sidebar panel; open in the Live sidebar at `lg`+ | `features/BriefSheet.tsx`, `features/BriefPanel.tsx` |
| Brief evidence chips | `<a>` with a real deep link (`src/lib/brief-chips.js`) where the dashboard shows the fact; plain text where it does not. Never a button | `features/BriefPanel.tsx` |
| "Ask the board": a plain question in ⌘K becomes the view's own filters, shown as removable chips with the real count | `Command` item ("Ask: …") + an inline chip row (`button` chips, 44 px on touch) — no new overlay | `features/SearchPalette.tsx`, `features/AskChips.tsx`, `state/ask.tsx`, `src/lib/ask-*.js` |
| Legal / attribution disclosure | `Popover` | `features/LegalPopover.tsx` |
| Jargon definitions | `Tooltip` with a mouse, `Popover` on a coarse pointer; they carry the board's former `title=` explanations | `features/JargonTerm.tsx` |
| Flight number | `<a>` to `/flight/<ident>`, same tab: link colour where the number is what the row is about, quiet where it is a second name in the row ("inbound on UA3508"); body text when `flightLink()` says no. One exception to "a United prefix is required": on a row the Starlink feed marks United (`airline: 'UA'`), an Express number with a tested operating prefix (SKW OO RPA YX GJS G7 ASH YV) prints and links as the United number, SKW5415 → UA5415 (`unitedNumber()`), and so does the inbound leg from the United-only live feed. The Starlink tab prints every linked number as its page's ident (UA347, not UAL347). Callsigns everywhere else (Live ticker, map) stay as printed | `src/lib/flight-link.js`, `src/lib/starlink-roster.js` (`starlinkFlightLabel`, `starlinkInboundLabel`), `features/FlightLink.tsx`, `src/scripts/flight-link.ts` |
| Tail | `<a>` to `/?aircraft=<reg>`, the aircraft dialog, opened in place over the current tab; a US registration (`tailLink()`), otherwise body text. Link colour where the row is about the tail (the Starlink verification ledger). The Starlink roster's tail stays its row's disclosure button | `src/lib/tail-link.js`, `features/EntityLinks.tsx` (`TailLink`) |
| Hub code | In the dashboard, `<a>` to that hub's Schedule board, `/?tab=schedule&hub=ORD`, in place, on Departures; the content-page address is `/hubs/<code>` (`hubLink(code, side)`). The nine hubs only; any other airport is body text. Quiet. The hub strip's chips are this link. The board's one door to the hub page is a quiet "ORD hub guide": beside the hub select, and on a phone at the end of the line under the stat strip | `src/lib/hub-link.js`, `features/EntityLinks.tsx` (`HubLink`), `shell/HubHealthStrip.tsx`, `views/schedule/HubGuideLink.tsx` |
| Aircraft type | In the dashboard, `<a>` to the Fleet tab filtered to that type, `/?tab=fleet&type=737-900ER`, in place; the content-page address is `/fleet/<slug>` (`fleetTypeLink(typeCode, side)`). Where the row has a tail, the type is the fleet database's for that tail (`fleetTypeCodeForTail()`), never the printed string, and the row prints its own words; a type with no fleet page (regional types, ICAO codes, "Boeing 737") is body text. Quiet. The Fleet tab's one door to the fleet page is "About the 737 MAX 9" at the end of the controls row, while one type is selected | `src/lib/fleet-type-link.js`, `src/lib/fleet-view.js` (`fleetDeepLinkTarget`), `features/EntityLinks.tsx` (`TypeLink`), `views/FleetView.tsx`, `views/fleet/FleetControls.tsx` |
| A count that filters the list below it | `<button>`, not a link: it changes the view it is in and has no address. The Starlink hero's Mainline and Express bars and "+N NEW THIS WEEK" show those aircraft in the roster below, with every other roster filter back at rest (`rosterFiltersShowing()`), and scroll to it; named by their words plus sr-only words, 44 px on touch | `views/starlink/SlHero.tsx`, `views/StarlinkView.tsx`, `src/lib/starlink-roster.js` |
| In-place dashboard link | `<a href>` with the real address. An unmodified primary click on an address `resolveDeepLink()` can apply in full goes through the dashboard's state (Schedule board, Fleet link, tab, then the aircraft dialog), with no reload; a modified or middle click, a page outside the dashboard, and any address the resolver returns null for are left to the browser. A follow that changes the tab pushes one history entry (Back returns to the tab you were on), announces the destination, and moves focus to the new tab's panel when focus was in the panel it hid. Tone `identity` (link colour, one per row) or `quiet` (body colour, a muted underline that takes the text colour on hover and focus); a 44 px `after:` hit box on touch; `finePointerOnly` makes a hub or type link take no taps on a coarse pointer in a row that is already one tap target, and gives it no hit box | `features/DashLink.tsx`, `features/link-style.ts`, `state/follow-link.tsx` (`FollowProvider`), `state/deep-links.ts`, `state/ui.tsx` (`fleetLink`), `src/lib/followed-link.js` |
| Tab navigation | `Tabs` | `shell/TabBar.tsx` |
| Segmented filters | `ToggleGroup` / `Toggle` | `views/schedule/ScheduleControls.tsx` |
| Dropdown filters | `Select` | schedule / fleet / starlink controls |
| "Fly to" commands (map region presets) | `DropdownMenu` + `RadioItem` — `onSelect` fires on every pick, so re-picking recentres; touch opens on click, not pointerdown | `views/live/MapControls` (`RegionMenu`) |
| Map key | disclosure (`Button` with `aria-expanded`), open from `md`, a 36 px "Key" button with a 44 px hit area below | `views/live/MapLegend` |
| Data grids | `Table` + sortable `<th><button>`; below `md` the schedule board is a two-line `<ol>` list instead (`SchedulePhoneRow`) | `views/schedule/ScheduleTable`, `views/fleet/SortableHeader`, `components/trackers/TrackerTable.astro` |
| Status pills | `Badge` | throughout |
| Loading | `Skeleton` | every async view |
| Hints | `Tooltip` | throughout |

**Rule of thumb:** modal → `Dialog`; a panel that must leave the map usable → non-modal
`Sheet`; a small anchored disclosure → `Popover`. Never hand-roll an overlay: the primitives
bring the focus trap, the Escape handler and the accessible name for free.

**Engagement surfaces stay quiet.** The waitlist strip, news banner, tip strip, support meter
and BMAC toast (`features/WaitlistStrip`, `NewsBanner`, `TipStrip`, `SupportMeter`,
`BmacToast`) are dismissible inline
elements, never modals, and their show/hide rules live in `src/lib/engagement.js`,
`tips.js`, `support-meter.js` and `waitlist-gate.js` — not in the components. Nothing that
asks the visitor for something may interrupt the data they came for. Nothing opens by itself on a
first visit either: the "What is this dashboard?" dialog opens only when asked (Nov 2026).

**The deep-use asks (Oct 2026; the support ask became a strip in Nov 2026).** Heavy users (the
waitlist strip's T1/T2 trigger, `state/deep-use.ts`) get ONE ask per visit, latched when the trigger
fires: the "cover a day" support strip (`features/SupportStrip.tsx`, rules in
`src/lib/donate-prompt.js`, words in `src/lib/cover-a-day.js`) or the "Stay in the loop" dialog
(`features/EmailPrompt.tsx` opening `WaitlistDialog`, rules in `src/lib/email-prompt.js`). While both
are eligible the choice is weighted 60/40 towards the support strip (`DEEP_USE_DONATE_WEIGHT`); when
neither is, the quiet waitlist strip is the fallback. The support strip leads the engagement slot, so
on its visits it is the one line shown, and it never covers the board. A payment covers the day it is
given (US Central), or the next open day after it, so the strip's button names that day and
goes to the fixed $17 Payment Link: "Cover today · $17", "Cover tomorrow · $17" (with a thank-you
naming today's supporter) or "Cover Nov 15 · $17"; when `/api/support-status` cannot vouch for
today it says "Help cover a day", with no price, on the any-amount link. Every word comes from
`src/lib/cover-a-day.js`, in one voice: one verb (cover), one unit (a day, $17 from
`DAILY_COST_USD`), one reason ("The Blue Board is free because flyers cover it, one day at a
time"; "readers" on news, fleet, hub and tracker pages), "I" wherever a person speaks, no promise
of a place on the Supporters Wall, and no ask says donate, donation, support the project, server
costs, consider, chip in or coffee (`tests/support-voice.test.js`). Where there is room (the
content-page card, the About section) an amount ladder ($5, $10, $17 · one day, $100 · nearly six
days, Other amount; `supportLadder`) offers one fixed link per amount, each with its own
`<placement>-<amount>` label; it disappears when no amount has a link. It stays down while today and the next 14 days are covered. It may lead with the
visitor's own count of flights looked up this month, from five up, kept in localStorage and never
sent; on a phone that sentence then stands alone beside the button. Everything it says is true or
absent: no invented urgency or counters, and its dismiss control is a plain "Dismiss". It goes quiet
for 30 days after a dismiss and 90 after a tap on its button (`bb_donate_prompt`, the retired modal's
key). The email dialog is the one remaining modal ask: it waits for a 3-second pause, never opens
over another dialog, sheet or popover or into a hidden tab, keeps the soft keyboard down, goes quiet
for 30 days after any close without a signup (or a "no" to the strip), and never returns once an
email is given.

Astro-side building blocks live in `src/components/site/` (`StatTile`, `HighlightBox`,
`JumpNav`, `PillNav`, `Breadcrumbs`, `ContentSection`, `Seo`, `JsonLd`, `HubBoard`, `FleetLive`) and
`src/components/trackers/`.

## Responsive

Tailwind defaults: **`sm` 640 · `md` 768 · `lg` 1024**.

One variant is ours: **`landscape-phone:`** (coarse pointer, landscape, at most 500 px tall), declared in
`global.css`. A phone on its side gets the phone's map chrome (icon toolbar, key closed) and no
attribution strip; the basemap credit stays on the map.

- **The dashboard switches navigation at `lg`.** `TabBar` is `hidden lg:block`; `MobileNav`
  (bottom bar) is `lg:hidden`. The Live sidebar and the flight panel's map-control offset use
  the matching `(min-width: 1024px)` media query — keep the class and the query in step.
- **Content pages switch at `md`.** `SiteHeader`'s inline nav is `hidden md:flex`; below that
  it is a `<details>` menu.
- **A control may draw smaller than its target.** Where 44 px of surface costs the map or a
  dense row, the control is drawn at 36 px and an `after:` box carries the 44 px hit area
  (`TOUCH_CONTROL` in `shell/touch-target.ts`; inset `-inset-[5px]`, because a pseudo-element is
  measured from inside the 1 px border). Inside a strip that scrolls sideways the hit box is
  clipped, so those chips fill the row instead (the 28 px hub strip: 27 px, above WCAG 2.5.8's 24).
- **Touch targets are ≥44px unless the pointer is fine** — `min-h-11` / `size-11`, relaxed
  only with `pointer-fine:md:` (a mouse at ≥768px). Width is not input type: an iPad at
  768/1024px is a touch device, so a bare `md:min-h-0` is a bug (`tests/design-guards.test.js`
  scans `src/app` and `src/components`).
- **Phone inputs are 16px** (`text-base md:text-[11px]`): iOS zooms the page on focus below
  that.
- **The flight panel covers part of the map.** "View on map" moves centre their target in the
  uncovered part (`src/lib/flight-panel-occlusion.js`), and at ≥`lg` the Leaflet control stack
  slides clear of the right panel (`global.css`). Keep the panel's 28rem / 40dvh in step with
  both.
- The page body never scrolls horizontally. Tables, the map and code blocks get their own
  `overflow-x-auto` container.

## Accessibility

- **One IROPS announcer.** `shell/IropsAnnouncer.tsx` is the single `aria-live` writer for
  disruption news. The `Ticker` is deliberately `aria-live="off"` — a strip that rotates on a
  timer would otherwise interrupt a screen reader every few seconds.
- **Live regions, by design:** `OfflineBanner` (`assertive` — connectivity is urgent);
  `IropsAnnouncer`, `HubHealthStrip`, `live/StatsBar`, `weather/IropsSection`,
  `weather/TrackerBriefing`, and the tracker Astro widgets (`polite`); `BmacToast` (`status`,
  single mount); `WaitlistDialog`'s inline error and `starlink/VerificationLedger` (`alert`,
  raised once). `NewsBanner` rotates on a timer and is `aria-live="off"` like the Ticker.
  Adding a new one means checking it does not compete with these.
- **Sortable headers are `<button>`s inside `<th>` with `aria-sort`** on the header cell.
  A sortable column that is only click-handled is a bug.
- **Focus is always visible.** `global.css` gives `:focus-visible` a 2px `--ring` outline at
  2px offset; shadcn primitives keep their own `focus-visible:ring-*`. Never
  `outline: none` without a replacement.
- Semantic landmarks (`<header>`, `<nav aria-label>`, `<main id="main">`, `<footer>`), a skip
  link on every page, and `rel="noopener noreferrer"` on every external link.
- Text contrast clears 4.5:1 against its own surface — check against `--card`/`--popover`,
  not just `--background`.

## Anti-Patterns

- **No `--ua-*` tokens.** The old palette is gone. Use the shadcn variables.
- **No hex literals in `.tsx` / `.astro` / component CSS.** Colour is a token or, if it
  encodes domain state, an export from `src/lib` (table above).
- **No CDN.** Library code ships from `node_modules` through the Astro build — Leaflet and its
  stylesheet from the `leaflet` package, the Geist faces from `@fontsource-variable/*`. No
  external stylesheet or font host at all, and the only third-party script is Vercel's own
  analytics beacon, which is why `https://va.vercel-scripts.com` is the single non-`'self'`
  entry in `script-src`. Everything else is `'self'` + hashed Astro island scripts; a CDN
  reference fails silently in prod, and `tests/csp.test.js` pins the header.
- **No inline `<script>` or `on*=` attributes** in `.astro` files — either forces
  `'unsafe-inline'` back into the CSP. `scripts/verify-csp-hashes.mjs` fails the build.
- **No nested cards.** A card inside a card means the hierarchy is wrong.
- **No glassmorphism, no gradient surfaces, no shadow ladders.**
- **No colour-only status.** See the status rule.
- **No hero images.** This is a data tool.
- **No new `aria-live` region** without checking it against the inventory above.

## Decisions Log

| Date | Decision | Rationale |
|---|---|---|
| 2025-01 | Initial dark NOC system | Inter + JetBrains Mono, hand-rolled `--ua-*` tokens |
| 2026-03-19 | Satoshi + DM Sans + amber accent | Typographic identity against a field of corporate blue |
| 2026-07-04 | Starlink markers render violet `#A78BFA` | Owner decision; distinct from every phase colour |
| 2026-07-08 | `--ua-dim` lightened; `--ua-blue` banned as text | axe contrast review — blue measured 2.61:1 as stat text |
| 2026-09 | **Rebuilt on Astro + React island + Tailwind v4 + shadcn/ui (`radix-nova`)** | The single-file dashboard and the Astro content pages had drifted into two design systems with duplicated tokens and no shared primitives. One token set, one component library, and accessibility (focus trap, Escape, `aria-*`) arrives with the primitives instead of being hand-maintained. |
| 2026-09 | Geist Sans + Geist Mono, self-bundled | Satoshi/DM Sans/JetBrains Mono were three families from two CDNs. Geist covers both roles, ships from npm, and satisfies `font-src 'self'`. |
| 2026-09 | One accent: United blue as `--primary`; amber retired | The amber secondary was doing two jobs — personality and "caution". Caution is now `--color-bb-warn`, and the accent is unambiguous. |
| 2026-09 | Status/phase/category colours stay in `src/lib` | They are encodings shared by map, chart and table, and they are unit-tested. A CSS token cannot be asserted in a test. |
| 2026-09 | Dashboard nav breaks at `lg`, content pages at `md` | The dashboard needs the full tab bar's width; a content page does not. |
| 2026-09 | Status colour is the token set only; `bb-info` + `bb-starlink` added | ~260 raw palette classes had put a second amber and a second green in the dashboard (audit F72). Red maps to `--destructive` (identical to `red-400` in dark); amber/green render slightly quieter as `bb-warn`/`bb-ok`. The trackers' editorial gold accent became `--primary` (the amber secondary was already retired). |
| 2026-09 | Chrome icons are lucide; lib glyphs and copy emoji stay text | Tabs, chips and badges mixed emoji with lucide and rendered differently per OS (🎫 is a concert ticket on Apple; audit F73). Phase/status glyphs are `src/lib` data that also reach the ticker and sr-only text, so they stay strings — with every legend glyph distinct. |
| 2026-09 | `--primary-fill` for filled primary surfaces | White on `--primary` measured 2.99:1 (axe, audit F37). Darkening `--primary` itself would have cost its contrast as text on the dark surfaces, so fills got their own token. |
| 2026-09 | Touch floor relaxes on `pointer-fine:md:`, not `md:` | Tablets are touch devices at `md` widths (audit F24). |
| 2026-09 | Flight panel is a bottom sheet below `lg` | A right-hand sheet covered the whole phone map it was meant to sit beside (audit F20). |
| 2026-10 | Schedule board is a two-line list below `md`; toolbar and stat cards compact there | At 390 px the table was 1,065 px wide with status, tail, Wi-Fi and the watch eye off-screen, and at 360×780 no row was above the fold. Desktop/tablet keep the table. |
| 2026-10 | The passive waitlist ask is a strip, not a modal; one engagement strip at a time on a phone | The five-minute popup covered the board uninvited. The strip honours a "no" for 30 days; its signups carry `source: 'dashboard'` to compare with the link-driven `popup`. |
| 2026-10 | Heavy users get ONE modal ask, for donations; one deep-use ask per visit | Owner, Oct 6 2026: "a pop up for donations if someone really is going deep on the site", worded "donate to support costs and keep the blue board going" (no coffee). From Oct 3 to Oct 6 the deep-use trigger reached 322 visitors; the email strip it showed got 5 opens from 376 showings and no donations. The prompt takes that moment while it is eligible, and the strip gets it while the prompt cools down. |
| 2026-10-28 | The deep-use ask is weighted: donate 60%, email 40% while both are eligible; the email ask is the waitlist dialog, opened after a pause | Owner, Oct 28 2026: ask heavy users to donate "a bit more than half the time" and to sign up for email "a bit less than half". Email signups had been zero since Oct 5: the auto-opening dialog brought in 188 of the first 192, its replacement strip got 0 opens in 191 showings once the donation prompt took the moment, and the prompt itself got 5 donate taps in 340 showings. The email ask keeps the donation prompt's manners rather than the old popup's (which opened mid-scroll), reuses the one email form, and its signups carry `source: 'deep-use'` (needs `sql/019`). |
| 2026-10 | Radar dots take the flight-category colour; ops impact is a ⚠ in the label | `OPS_COLORS.caution` equals `CAT_COLORS.MVFR`, so a rainy VFR hub wore MVFR yellow under a "VFR" label. |
| 2026-10 | United Express markers: `--foreground` white, 85% size when airborne; on the ground they read as ground | Express is identified by callsign prefix (`src/lib/express-operators.js`) — the feed's airline field is `UAL` on every row. Every other token was taken: `bb-warn`/`bb-ok`/`bb-starlink` are the long-haul/watched/Starlink fills, `bb-info` sits ~20° from mainline blue, red is alarm. Size carries Express through Starlink violet, which wins the fill on ~3 in 4 Express jets. |
| 2026-10 | Map key on the Live map, drawn from `PLANE_LEGEND`; closed below `md` | "I couldn't figure out the meaning of the color-coding" (Reddit). The swatches are `planeIconSpec` output, so the key cannot drift; on a phone it waits behind a 44 px button rather than covering the map. |
| 2026-10 | The key names the hub ring ("United hub") while the Hubs layer is on | A reader asked why "some flights have a blue circle over them" (Oct 7): planes parked at a hub sit under its ring, and the key listed only planes. `HUB_RING` in `plane-icon.js` styles both the ring and the swatch. |
| 2026-10 | The map's default is mainline vs United Express; Starlink and Long-haul are highlights you switch on | Owner, Oct 4 2026: "by default have mainline and Express colors different, with no other filters, and then people can click for Starlink or long haul." With Starlink violet always on, ~3 in 4 Express jets drew violet and Express looked missing. The Starlink control now highlights instead of filtering; the key lists only what the map is drawing. |
| 2026-10 | Region presets replace the Pacific toggle: eleven bounding boxes in `src/lib/map-regions.js`, framed with `fitBounds` | One box serves every viewport. Oceania and Pacific cross the antimeridian through `normalizeLonContinuity`, and the map re-snaps markers, hub rings and the route to the visible world copy on every `moveend` (`wrapLonNear`). |
| 2026-10 | Board evidence markers carry words: "Landed*" + "seen landing", "≥"/"≤" + "at least"/"at most", a takeoff/touchdown icon + "from takeoff time; includes taxi" | A feed-proven landing is not "no live update", a floor is not a measurement, and a wheels-up delay includes taxi-out. Each glyph is `aria-hidden` beside sr-only words, and the wording lives in `src/lib/schedule-row-display.js` so the table and the phone row agree. |
| 2026-11-10 | The welcome dialog opens on request only and reads as a short orientation plus the home-hub picker | The live map is the first impression. The modal covered it for every new visitor with six emoji feature rows. `bb-visited` still sets the waitlist threshold; `bb-onboarded` / `bb_onboarding_dismissed` are still written, no longer read. On phones the picker is reached via More → "What is this dashboard?". |
| 2026-11-10 | One engagement strip at a time at every width | Desktop stacked the news, the tip and the attribution: ~110 px of a 900 px screen. |
| 2026-11-10 | "Canceled" headlines confirmed cancellations; unconfirmed ones are a quieter "+N unconfirmed"; scoring unchanged | The Delays tab read "53 CANCELLATIONS incl. 53 likely" beside NORMAL OPERATIONS; ORD's 14 Canceled were all unconfirmed. The Oct 3 calibration is untouched. |
| 2026-11-10 | Stat strip gains "Departed · not timed" and (arrivals) "In the air"; "Uncategorized" is only rows whose actual time cannot be trusted | ORD's 88 "Uncategorized" were all rows the board printed as Departed (live-feed-confirmed, no provider time). `board-stats.js` predated the v1.13.0 tracked statuses. |
| 2026-11-10 | LOW delay risk is quiet muted text; the pill is for MOD and up | On ORD 96 of 97 badges were identical green "RISK: LOW" pills. The badge is still the button to the AI explanation. |
| 2026-11-10 | Stats cards are paired by height | "Flights by Phase" stretched beside the utilisation list and was two-thirds empty at 1440 px. |
| 2026-11-10 | Hub pages show a slice of the Schedule board (next 8 departures, day truth, data-as-of stamp, one button into the board); fleet type pages show the type airborne now, matched by tail | Google sends ~1,000 visitors a month to these pages and they saw an article with one number. The board reads only the stored schedule snapshot (`/api/hub-board`), words rows with the board's own row model, reserves height only under `@media (scripting: enabled)`, and adds no `aria-live` region. |
| 2026-11-10 | One-time donations go to a Stripe Payment Link built by `supportUrl()` (`src/lib/support-link.js`), tagged `utm_content=<data-support label>`; memberships stay on Buy Me a Coffee; the phone support icon is `HandHeart` | Owner, Nov 10 2026: "I am switching to Stripe FULLY." Stripe records UTM parameters on the payment, so a payment can be traced to its placement; the coffee cup named the old processor. |
| 2026-11-10 | The ops brief takes the rotating ticker's row on every tab, sits open under the Live sidebar's search at `lg`+, and opens as a modal sheet everywhere else | Owner approved the mockup ("I LOVE THEM"). Taking the ticker's row adds no height (map top measured unchanged at 1440×900 and 390×844). Inside the sidebar's one scroll region, a four-item bad-day brief never hides hub traffic and the search box never moves. The row, panel and sheet are not live regions: the brief is read on request, and disruption news stays with `IropsAnnouncer`. |
| 2026-11-10 | A brief is shown only while current: a successful answer of no-brief or stale, or a `checkedAt` over 30 min old by the visitor's clock, brings the ticker back and removes the panel; a failed refresh keeps a brief that is still current | Old text must never read as "right now"; a response can sit in the CDN and in a background tab. |
| 2026-11-10 | An emergency squawk takes the brief row's text while it lasts; the tone word stays and the row still opens the brief | The brief replaced the ticker, and with it the only on-screen place a 7500/7600/7700 squawk was shown. |
| 2026-11-10 | Brief chips link only where the dashboard shows the fact, otherwise they are plain text; ATC radio chips are `bb-info` with `RadioTower` | A chip is the proof of its sentence, and a link to a page that does not show the fact proves nothing. Violet means Starlink. |
| 2026-11-10 | The brief row is 28 px with a 36 px touch area (8 px up into the header's padding); brief chips are 28 px on touch | Matching the ticker's height was a requirement, and growing the hit area down would take taps from the hub chips. A full-width row clears WCAG 2.5.8's 24 px; chips follow the hub strip's 24 px chip-link precedent. |
| 2026-11-10 | Ask the board: ⌘K questions map to a fixed vocabulary (view + hub, direction, family/type, Starlink, region, air/ground, status, route end, flight, tail) applied through each view's own controls plus one generic predicate; the rules parser answers first and Claude Haiku 5.5 only when it is not sure; chips show what was understood | Owner approved the mockup ("fantastic"). Free text never reaches the page — the model's only output is validated enums — so a hostile question can at worst produce a wrong, visible, removable filter. "Late" is the stat strip's 30-minute rule, not the provider's "Delayed" word. No on-time percentage is shown while rows are picked by status. |
| 2026-11-10 | The deep-use support ask is a strip, not a modal, first in the engagement slot, and its button names the day it covers | From Oct 6 the donation modal was shown 417 times, tapped 7 times and produced at most one donation. The owner approved retiring the popup. Trigger, latch, weighting, quiet periods, the `donate_prompt` event and the `deep-use-prompt` label are unchanged, except that `shown` now fires when the strip renders, without the modal's pause and hidden-tab guards, so `shown` counts from Nov 2026 run higher. |
| 2026-11-10 | "Cover a day": a payment covers the day it is given (US Central) or the next open day after it, never an earlier one; leftovers pool and carry across month ends; only coverage from signed Stripe events is shown | Filling the month from the 1st made "Today isn't covered yet" followed by a payment that covered an earlier day. Data: `api/stripe-webhook.ts` → `sql/023` → `/api/support-status`; unconfigured means the plain ask and no claims. |
| 2026-11-10 | Supporter names show only after a strict shape check, never while hidden, never with `SUPPORTER_NAMES=off`; otherwise "a supporter", and a pooled day "N supporters" | The owner's never-auto-publish rule for the Supporters Wall. |
| 2026-11-10 | Flight pages (`/flight/UA929`): a code-written verdict sentence whose time words follow the evidence (gate "left the gate at", runway "took off at", estimate "about"), a history strip that is never padded, and the AI read on request only | A shared link must say what is happening in one sentence and be honest about what is measured. Crawlers will hit these pages, so nothing on load calls a model or a metered provider. |
| 2026-11-10 | An FAA answer is current for 25 minutes: after that its programs leave `faaIndex` and the NAS panel prints "FAA status as of HH:MMZ" in `bb-warn` with a history icon; a program is cleared 15 minutes after its own end time | `/api/faa` serves its last good answer for up to 30 min when the FAA fails, and the dashboard kept old programs forever. An old ground stop must not read as live. |
| 2026-11-10 | The phone More sheet carries a "Home hub" row | The header's hub button is hidden below `md`, so a phone could only set a hub through "What is this dashboard?". |
| 2026-11-11 | On a flight page the read card shows only while the board predicts the leg (before it leaves); "Watch this flight" opens the dashboard's `?watch=UA929` deep link | After departure the card was an empty box. The deep link adds the flight through the eye buttons' own path (push mirror and first-watch prompt included) where a direct storage write skipped them. |
| 2026-11-11 | With a stale FAA answer and nothing else showing a disruption, the ticker's fallback line and the hub strip's network chip say "FAA status unknown since HH:MM" in muted text with a `History` icon, never the green "All systems normal" / "Smooth Ops" | Clearing stale programs left nothing to report, which read as calm. The time is held from the moment it went stale, so the strip (a polite region) changes only with the state. |
| 2026-11-11 | The flight page's support line takes the site's day framing when `/api/support-status` says today is open, otherwise its own sentence | One set of words for every support surface (`src/lib/cover-a-day.js`); the link and its `flight-page` label are unchanged. |
| 2026-11-11 | For FAA programs at United hubs, the brief's tone uses the header's own levels: ground delay programs, at however many hubs, are "Watch" (amber `TriangleAlert`), as the header's network chip reads "Some Delays" for them; a ground stop or closure at a hub is "Disrupted" (red `OctagonAlert`); the traveler note shows whenever a hub ground stop or delay program is in effect. Evidence chips follow the same split: a hub ground stop or closure chip is red (`text-destructive`), a hub delay program chip amber (`text-bb-warn`, `border-bb-warn/40`). With no brief, the ticker's advisory line uses the same words: "Some delays: ground delay program for flights into SFO (avg 62 min)" ("Disrupted:" only when the header is), "Disrupted: ground stop for flights into EWR" | On the first live morning one SFO delay program made the brief read "Disrupted" in red under a header chip reading "Some Delays". The program still holds flights into that airport, so travelers bound there get the note at either tone. |
| 2026-11-11 | The phone header is 44 px: smaller wordmark, the LIVE pill, and ghost icon controls drawn at 36 px with a 44 px `after:` hit area. Desktop secondary header controls are all ghost; an empty home hub reads "Home hub" | Owner, on his iPhone: "the header is a little thick and the amount of map you see is kind of small." Measured at 393×659 with a touch pointer, the Live map was 398 px of the screen; it is now 509. The brief row's reach-up (2026-11-10) now yields to the header controls and keeps the band under the wordmark. |
| 2026-11-11 | The hub strip is 28 px at every pointer and its touch chips fill the row | It had grown to 45 px on phones under the Oct 3 44 px chip rule. A sideways-scrolling strip clips any hit box, so the chips are 27 px, above WCAG 2.5.8's 24 px. Reverses that rule for this strip only. |
| 2026-11-11 | On the Live tab below `lg` the news strip is hidden (still mounted, so the slot's one-strip order holds); the More sheet links News. The support and waitlist strips are unaffected | On a phone the Live tab is the map. The strip stays on every other tab and at `lg`+. |
| 2026-11-11 | Below 1081 px the airborne count is a chip on the map beside the Key button, opening the same 24-hour graph | The row cost 45 px of map for one number. |
| 2026-11-11 | Map controls are 36 px opaque surfaces with 44 px hit areas; below `sm` the layer toggles, Refresh, Filters and the region button are icons (names kept for screen readers), an "on" toggle takes the primary colour, and Filters is pinned outside the scrolling row | The Starlink toggle sat clipped under Filters at 393 px, and a long region name pushed Refresh under the fade. |
| 2026-11-11 | No Leaflet zoom buttons for a coarse pointer on the Live map (`data-map="live"`); the radar map keeps them, lifted clear of its attribution below `sm` | Pinch does it and the region menu frames a region in one tap, so the buttons only took a corner of a phone map. The radar map has no region menu, so its buttons are the one-finger way to zoom out (WCAG 2.5.1). |
| 2026-11-11 | A phone Live map with no home hub opens on the lower 48, fitted to width at a 0.1 zoom step, north edge under the toolbar; hub labels are compact mono and placed by the radar map's table | The first paint spent its top third on Canada and EWR's label sat under IAD's. |
| 2026-11-11 | The hub strip's network chip steps aside while a current brief holds the ticker row with the same tone; it stays when they differ, when there is no brief, and for "FAA status unknown" | "DISRUPTED" appeared three times on one desktop screen from two computations that agreed. |
| 2026-11-11 | The IROPS card names its measure after the level: "index 14.8 · United cancels + delays" | The brief row said DISRUPTED for an FAA ground stop while the card said NORMAL OPERATIONS. Both were right: the index counts cancellations, diversions and long delays, and cannot see flights a ground stop is still holding. Scoring unchanged. |
| 2026-11-11 | The watched-flight alert is a flat 32 px strip, not a 56 px card | Same register as the other strips. |
| 2026-11-11 | Schedule: the presumed chip, FAA note, data age and cache line share one running-text line under the stat strip; the cache line carries no ⚡. Secondary toolbar actions (Refresh) are outline, not filled primary | Three stacked lines sat between the cards and the table, ⚡ is the Starlink mark, and the filled Refresh was the loudest thing on a phone's first screen. |
| 2026-11-11 | Starlink as a fact is `bb-starlink` violet everywhere (aircraft dialog, My Flights, the Reg cell); every dashboard table uses one sort mark, ↑/↓ in primary and ↕ muted | They were `bb-ok` green in three places, and Fleet used ▲/▼. |
| 2026-11-11 | NAS titles are shown in sentence case from a fixed plain-word list; codes and acronyms print as sent; an AFTER/UNTIL window moves to the detail only when the item has no time of its own | The raw FAA capitals shouted. A test pins that upper-casing the result returns the input, so no fact changes. |
| 2026-11-11 | Control heights relax only on `pointer-fine:md:`, for `h-*` as well as `min-h-*` | iPads were getting 32–36 px targets from bare `md:h-9`. |
| 2026-11-11 | Sources: the fleet database badge is SNAPSHOT, not DAILY | There is no daily refresh job (audit F86). |
| 2026-11-11 | Every content page uses the `max-w-4xl` container with reading columns inside it, and one h1: `text-2xl` bold, left-aligned (the flight ident excepted) | The left edge jumped between page types (fleet 5xl, articles 3xl, privacy and thanks 2xl); tracker h1s were `text-lg` on phones and the fleet index was centred at `text-3xl`. |
| 2026-11-11 | Amber is status only on content pages too; card surfaces are `rounded-lg`, callout rails 2 px; in-page jumps are `rounded-full` uppercase pills and links to other pages are `rounded-md` bordered pills; news, hub and fleet cards are clickable whole through a stretched primary link | The news featured rail, two callouts, fleet family counts and Newark dates used amber as decoration; three radii and two rail widths were in use; the cards' hover border already promised the click. |
| 2026-11-11 | Content chrome: footer, breadcrumb, header nav and source links are 44 px on touch (`pointer-fine:md:` relaxes them); the footer is three rows and the body a `min-h-dvh` column when it shows; `html` has `scroll-pt-16` | The footer floated mid-screen on short pages and anchor targets landed under the sticky header. |
| 2026-11-11 | Flight page: one equal timeline column per step from `md`, the rail dot takes the step's colour; the route is dashed between end caps with the plane at its position in the air; card footnotes follow their content under a hairline and cards stay equal height | Four steps stopped at 60% of the width, the route was a bare hairline, and `mt-auto` opened a band mid-card. |
| 2026-11-11 | Every ask speaks one "cover a day" voice: a button that names a day carries the price and the $17 link, every other ask says "Help cover a day" on the any-amount link (preset $10), and an amount ladder shows only where there is room | Owner: the donation language "doesn't feel the strongest". There were seven different asks ("Donate to support costs", "Support Server Costs", "chip in toward the data bill", …), the reason given was the site's bills, the copy hedged ("consider"), "we" sat beside "I", "0 of 30 days covered" read as failure, and the card promised a Supporters Wall place a Stripe payment never gets. He also asked for a lower default and a choice of amounts ("$5, 10, $17, $100"); Stripe's hosted page shows one preset, so four fixed Payment Links back the ladder and the day buttons. An empty month reads "No one has covered a day in November yet. Be the first." The landed toast now reads the shared support status when it shows. |
| 2026-11-11 | Every flight number printed in link colour is a link to its flight page, on the dashboard and on content pages, by one rule (`flightLink()`: a United prefix is required; operating callsigns, provider suffixes and bare numbers stay body text). A number inside a control that does something else is split out of it (phone schedule row, Live search, Starlink board) or printed in body colour | Owner, on the desktop Schedule board: "why can't I click the flight number to get to the new flight page?" It was blue text in a table cell; the flight pages were reachable only from the flight panel. |
| 2026-11-11 | Dashboard controls are named by their visible words plus `sr-only` words, never an `aria-label` over different text (wordmark, search, brief row, watch button, airborne and Starlink chips) | WCAG 2.5.3: axe flagged the three header controls on every tab. |
| 2026-11-11 | A stale hub reading dims only its glyph and adds a `History` mark and the sr-only words "stale reading"; the percentage keeps full colour | The 60%-opacity chip measured 3.82:1 and dimming was the only signal. |
| 2026-11-11 | The flight panel focuses its heading on open, with no ring after a pointer open (`focusVisible: false`, `src/lib/input-modality.js`); a keyboard open rings the heading | A click on the map ringed "Center map". No outline is removed. |
| 2026-11-11 | Width-only `h-*` / `size-*` under 44 px is a guard failure at every breakpoint, as bare `md:min-h-*` already was | Seven 32–36 px iPad targets had slipped through `md:h-N`. |
| 2026-11-11 | An upright touch tablet gets the phone's lower-48 map framing; the attribution strip wraps in two deliberate groups; a phone on its side (`landscape-phone:`) gets the icon toolbar and no attribution strip | The map opened on a band of Canada at 820 px, the footer wrapped mid-phrase, and a sideways phone had 184 px of map. |
| 2026-11-11 | The IROPS card adds one quiet coverage line ("8 of 9 hub boards current · LAX board 3 h old"), shown only from an `/api/irops` payload that carries coverage fields and clocked at fetch time | The index pools nine boards refreshed about every three hours. Disclosure costs nothing in the score; a polite region should change with the data, not the minute. |
| 2026-11-11 | A held flight is inferred against the board's own clock: overdue is measured at `min(now, generatedAt + 30 min)`, and not at all on a board that carries no actual times | Owner-approved Nov 11. Against the wall clock a 3-hour-old board invented holds (about 15 of 17 at LAX) and added up to +12.7 to the index. Thresholds (20 / 40) unchanged and due a re-check against a week of corrected scores. |
| 2026-11-11 | A hub chip with no on-time figure shows the reason's label (GUM "n/a") and puts the reason in the link's name as fixed sr-only words, with the counted sentence in the tooltip | The provider sends no actual departure times for Guam, so "No reading yet" was never going to become one. A tap navigates, so the name and tooltip are the only places the reason can live; fixed words keep polls silent. |
| 2026-11-11 | The Starlink board, footer and source line state our own sync's age and tier, never the tracker's `lastUpdated`; an exhausted stored schedule reads "feed offline", not "no departures" | The tracker's field froze on Oct 27 ("updated 16d ago") while the rows kept counting down. |
| 2026-11-11 | The fleet index tile is "Mainline with Starlink"; the combined count always says "mainline + Express" and its day; a type page whose table and roster disagree says both counts and both days | The tile sat among mainline figures showing a combined count 44 days old (602 beside the dashboard's 681). |
| 2026-11-11 | Tracker entries may carry their own `verified` day; the file's `lastVerified` is the last full pass and may be older than `lastUpdated` | A partial re-check of two Dulles entries would otherwise have stamped all 26 projects "verified Nov 11". |
| 2026-11-11 | News `updated` drives JSON-LD `dateModified` and sitemap `lastmod`; the visible date stays the publication date with a quiet "Updated" beside it; an update is one dated first paragraph and the original text is never rewritten | Crawlers re-read updated articles without the article pretending to be new. |
| 2026-11-11 | A wide content table scrolls in its own named region with a tab stop only while it overflows; below `md` the tracker tables are the same table restacked as cards with a "Sort by" row | axe: `scrollable-region-focusable` on the fleet pages; six- and seven-column tables scrolled sideways on a phone. |
| 2026-11-11 | Stat tiles are one family (label, figure, optional sub-line, aligned by subgrid; a figure is body colour unless it is a status); the in-page jump row is one sideways-scrolling row below `md`; Starlink is `bb-starlink` violet on content pages too; a link in a compact list a mouse uses is at least 24 px (touch stays 44) | Three tile layouts, a jump nav wrapping to three rows, and green Starlink on content pages against violet on the dashboard. |
| 2026-11-11 | A ground stop or delay program at an airport that is not a United hub, or a possible hub program whose window opens tomorrow, never sets the brief's tone (the header counts neither); programs away from the hubs follow every fact about the hubs and get a traveler note, and tomorrow's possibles close the brief in one item. On a day every hub is at 80% or better the brief opens with the hubs summary; a single hub's figure is given only when it trails the next hub by 8+ points and is under 85%. Confirmed cancellations under five are not mentioned. Plan times carry their day. Fact statements use a traveler's words (no "boards", "readings"). Plain-text evidence tags keep the chip box with a dashed outline. Every verifier rewrite is re-checked on its final text (`finalizeSentence`) | Owner, on the 5:00 PM Nov 11 brief: "hmmm read the brief". A Seattle delay program and the next day's plan had set "Watch" while the brief said the hubs looked normal; it named the best hub, reported 1 cancellation among 2,700 departures in our own vocabulary, and said "after 10:00 AM ET" at 8:20 PM. He liked the 5:20 PM brief, which led with O'Hare at 80% beside 89%+ at the other hubs; the outlier rule keeps that. |
| 2026-11-12 | Starlink tab: the Express bar counts the two-cabin regional jets, numerator and denominator from one snapshot (the UA row's regional families in the tracker's fleet-summary), leaving out the named single-cabin CRJ-200 and ERJ-145 families (`EXPRESS_FAMILIES_LEFT_OUT`, never "types with no installs"); without that payload the row is the equipped count with no bar and no percentage, and the tracker's `expressTotal` never makes a percentage. The velocity card's second tile is United's stated target from one constant (`UNITED_STARLINK_TARGET`), in body colour; the site computes no completion date. The industry strip sums Alaska and Hawaiian into one "AS+HA" row (named for screen readers and on hover) and is titled "Starlink Coverage · United vs Alaska" only when it shows exactly those two rows | Owner: the tile's "~Sep '31" contradicted United's own target ("United expects it to be available fleet-wide by the end of 2027", Oct 20 2026); 145 of the 158 aircraft it divided were single-cabin jets outside United's stated dual-cabin plan (Mar 24 2026), which also held the bar at 69% (355 / 513) against 96% (354 / 368) of the two-cabin fleet. Alaska and Hawaiian are one airline (one certificate since Oct 29 2025, one AS code since Apr 22 2026). |
| 2026-11-12 | A name goes to its home on the side of the site you are on; if that side has no home, the link crosses over. In the dashboard a flight number goes to `/flight/<ident>` (the dashboard has no view of a flight that is not airborne), a tail to the aircraft dialog, a hub code to its Schedule board and an aircraft type with a fleet page to the Fleet tab filtered to it, the last three in place. A followed hub link opens that board on Departures and the hub's default day, as a cold load of its address does. A link followed in place that changes the tab leaves one history entry (the path and the new tab's hash, the dashboard's own query parameters dropped), so Back returns to the tab the reader was on, while the tab bar still leaves none; it says where it went in the page's polite region ("Schedule, ORD"), and when focus was in the panel it hid, or already lost, focus moves to the tab it opens. One tested rule per kind in `src/lib` (`flight-link.js`, `tail-link.js`, `hub-link.js`, `fleet-type-link.js`; the last two take the side as an argument). Two doors join the sides: one "ORD hub guide" link in the Schedule board's header and one "About the 737 MAX 9" link in the Fleet controls. Non-hub airports, operators and regional types stay body text. This release links the Starlink tab, the hub strip and the two doors; part 2 (the rest of the dashboard) and part 3 (content pages) follow under the same rule | Owner, Nov 12 2026: "Throughout all these tables and lists, I just feel like a lot of them should be linkable… I just want to make sure these things are linkable and that you can click and go to relevant sections throughout the site." Asked whether he meant the Starlink tab or the whole site: "every table and list please". He answered three numbered choices with "1 a 2 a 3 a". Choice 1 was the Starlink tile (United's stated target, the 2026-11-12 Starlink tab row above, shipped in v1.28.2). Choice 2 was where a hub code goes inside the dashboard; option a, as put to him, read: "ORD's Schedule board, staying in the dashboard. The hub strip at the top would do the same, instead of opening the hub guide as it does today." So the hub strip was part of what he approved. Choice 3 (Express numbers) is the next row. Departures: the hub chip's figure is operated departures, and a cold load opens Departures, but a followed link kept whichever direction the board was left on. Back is the builder's call, his to veto: the hub chips were page loads before this release, where Back came back to the dashboard, and a link that moves the reader should be undoable; the cost is that Back steps back through followed links before it leaves the dashboard. Focus: a hub or type link inside the Starlink tab hid the panel that held focus, which fell to the page with nothing said. Spec: `docs/superpowers/specs/2026-11-12-links-everywhere-design.md`. |
| 2026-11-12 | On the Starlink tab, a row the feed marks United (`airline: 'UA'`) whose number has a tested operating prefix (SKW OO RPA YX GJS G7 ASH YV) prints and links the United number, SKW5415 → UA5415 (`unitedNumber()`), with the operating carrier still named under it; an inbound leg from the United-only live feed is read the same way (YX3568 → UA3568). This reverses the 2026-11-11 flight-number row's "operating callsigns … stay body text" for those rows only: a row without `airline: 'UA'`, an untested prefix (UCA5004), a provider suffix (SKW5415A) and every callsign off the Starlink tab (Live ticker, map) stay as printed and plain. The tab prints every linked mainline number as its page's ident (UA347, not UAL347); the board's subtitle says "United flight numbers" and its footer "Flight numbers shown as UA are United's; the name under each is the carrier that operates it (SkyWest, Republic, Mesa…)" | Owner's choice 3, option a ("1 a 2 a 3 a"), which read as put to him: "Print "UA5415" and link it to its flight page. This reverses yesterday's "callsigns never link" rule." He asked "why did we do a callsigns never link rule?"; the builder's account, not his words: it was a caution, because nobody had checked that SKW5415 is UA5415. The check (`EXPRESS_NUMBER_CHECK`, `src/lib/flight-link.js`), against the site's flight history on Nov 12 2026, in two parts: 83 Starlink-feed Express flights checked against it by route and departure time, 82 matched, all 82 with the same number; a further 42 later-day flights in the feed's YV, G7 and YX forms checked a weaker way, the same United number having flown the same route within the past week, 42 of 42. The constant's 125 / 124 / 124 is the two parts added together, not 124 independent matches. Builder's calls, his to veto: mainline numbers printing as UA on this tab, the inbound leg, and the two reworded board strings. |
| 2026-11-12 | The hub strip's chips open that hub's Schedule board in place (`/?tab=schedule&hub=ORD`), where the dashboard lists the flights behind the figure; they went to the hub guide page. The tooltip reads "United at ORD · schedule board" and each chip's name ends with the fixed sr-only words "(schedule board)". The hub guide is one link further, the quiet "ORD hub guide" in the Schedule board's header. The board opens on Departures, the flights the chip's figure counts. After a tap or click the chip lets go of focus, so its tooltip closes; Enter keeps focus on the chip | Owner's choice 2, option a ("1 a 2 a 3 a"), which read as put to him: "ORD's Schedule board, staying in the dashboard. The hub strip at the top would do the same, instead of opening the hub guide as it does today." A chip used to load another page; followed in place, a tapped chip kept focus and its tooltip sat over the Schedule toolbar (seen on an emulated iPhone). "Schedule board", not "today's board", is the builder's call, his to veto: before 06:00 hub-local the Schedule tab shows yesterday's board. The words are the same for every hub and every poll, so the strip (a polite region) never announces them as a change. |
| 2026-11-12 | One link per row takes link colour (`text-primary`): the thing the row is about, the flight number on a departures row or an Upcoming Flights line, the tail on a ledger row. Every other link is body colour with a quiet underline (`decoration-muted-foreground/40`) that takes the text colour on hover and focus (`LINK_TONE`, `features/link-style.ts`). On a touch screen a departures row is one tap target (the aircraft dialog), and only its flight numbers and Track sit above it; its hub and type links, and the hub ends in the roster's Next Flight cell, take no taps on a coarse pointer (`finePointerOnly`) and stay in the tab order. Nothing that is not a link or button carries link colour or an underline | The spec's "wall of blue" anti-goal: a row with four link-coloured cells reads as decoration. The underline says "link" without colour (WCAG 1.4.1), as prose links on content pages do. Builder's calls, his to veto: the quiet-underline look, and hub and type links that take no taps on touch rows. The touch behaviour is pinned by class in tests and has not been tried on a real touch device. |
| 2026-11-12 | A link into the Fleet tab (`?type=`, `?filter=`, `?view=`) lands where a cold load of the same address lands. Followed in place it first resets search, Wi-Fi, status and type, the Express search and a Fleet "Ask the board" answer (the sort stays), and a filter with no view opens All Aircraft. Then the tab scrolls to the controls row, or to the sub-view's panel for a view alone, on a cold load too. An unknown value changes nothing, and the same link followed twice applies twice. The Starlink hero's buttons work the same way on the roster: they set what they name and put every other roster filter back at rest | The spec's equivalence guard: an in-place click and a cold load of one address reach the same state (`tests/deep-link-equivalence.test.tsx`). Without the reset a type link could land on an empty table behind an old search, and a hero bar on "No aircraft match your filters"; without the scroll, a followed type link opened on the pulse cards with the filtered table a long scroll below, and on the preview looked as if nothing had happened. Builder's calls, his to veto: the Fleet link's reset and its scroll, and the hero buttons' reset; their cost is that a search typed in the Fleet tab or the roster is lost when a link or a hero button is followed. |
| 2026-11-12 | Two guards. `tests/design-guards.test.js`: in the Starlink views (`StarlinkView.tsx`, `views/starlink/*.tsx`) an element that is not a link or button (`a`, `button`, `DashLink`, `Button`) fails if any class it can carry is `text-primary` or an `underline` utility, and the per-kind links' plain-text `className` is checked too; the allowlist needs a reason per entry and is empty. `scripts/ui-audit.mjs`, for each tab in `LINK_GUARD_TABS` (`['starlink']`, `src/lib/link-guard.js`) at its four viewports: text in a `tr`, `li` or `[data-link-row]` that is a United flight number, a tail the page loaded or a hub code must sit inside a link or button (`findUnlinkedNames`); a tab with no rows, no loaded tails or none of a kind it must show is a coverage gap; either fails the run. Parts 2 and 3 add their files and tabs | The spec's static and runtime guards, so the next new table is linked as well. An empty tab is a failure: a check that examined nothing proves nothing. Axe findings stay a report, as before. The runtime check needs live data, so it runs against a local build whose `/api` proxies to production (`MAINTENANCE.md`); production fails it until this release is live. |
