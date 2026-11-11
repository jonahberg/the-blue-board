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
| The ops brief, one line | `<button>` in the `Ticker` row: tone word (plus icon and status colour for watch/disrupted) and the truncated headline. Opens the brief sheet, or on Live at `lg`+ focuses the open sidebar panel | `shell/Ticker.tsx`, `features/BriefTone.tsx` |
| The ops brief, in full | `Sheet` (modal): bottom sheet below `lg`, right panel at `lg`+ on tabs without the sidebar panel; open in the Live sidebar at `lg`+ | `features/BriefSheet.tsx`, `features/BriefPanel.tsx` |
| Brief evidence chips | `<a>` with a real deep link (`src/lib/brief-chips.js`) where the dashboard shows the fact; plain text where it does not. Never a button | `features/BriefPanel.tsx` |
| "Ask the board": a plain question in ⌘K becomes the view's own filters, shown as removable chips with the real count | `Command` item ("Ask: …") + an inline chip row (`button` chips, 44 px on touch) — no new overlay | `features/SearchPalette.tsx`, `features/AskChips.tsx`, `state/ask.tsx`, `src/lib/ask-*.js` |
| Legal / attribution disclosure | `Popover` | `features/LegalPopover.tsx` |
| Jargon definitions | `Tooltip` | `features/JargonTerm.tsx` |
| Tab navigation | `Tabs` | `shell/TabBar.tsx` |
| Segmented filters | `ToggleGroup` / `Toggle` | `views/schedule/ScheduleControls.tsx` |
| Dropdown filters | `Select` | schedule / fleet / starlink controls |
| "Fly to" commands (map region presets) | `DropdownMenu` + `RadioItem` — `onSelect` fires on every pick, so re-picking recentres; touch opens on click, not pointerdown | `views/live/MapControls` (`RegionMenu`) |
| Map key | disclosure (`Button` with `aria-expanded`), open from `md`, a 44 px "Key" button below | `views/live/MapLegend` |
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
given (US Central), or the next open day after it, so the strip's button names that day: "Cover today
· $17", "Cover tomorrow · $17" (with a thank-you naming today's supporter) or "Cover the next open
day · $17", and "Cover a day · $17" with the plain $17-a-day line when `/api/support-status` cannot
vouch for today. It stays down while today and the next 14 days are covered. It may lead with the
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

- **The dashboard switches navigation at `lg`.** `TabBar` is `hidden lg:block`; `MobileNav`
  (bottom bar) is `lg:hidden`. The Live sidebar and the flight panel's map-control offset use
  the matching `(min-width: 1024px)` media query — keep the class and the query in step.
- **Content pages switch at `md`.** `SiteHeader`'s inline nav is `hidden md:flex`; below that
  it is a `<details>` menu.
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
