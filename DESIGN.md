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

Two status hues shadcn does not carry are declared in a real `@theme` block:

| Token | Value | Use |
|---|---|---|
| `--color-bb-warn` | `oklch(0.76 0.12 85)` | caution / degraded |
| `--color-bb-ok` | `oklch(0.74 0.16 150)` | clear / on-time |

They are emitted as custom properties (so `content.css` can reach them with `var()`) **and**
as utilities (`bg-bb-ok`, `text-bb-warn`, `border-bb-warn`).

### Domain colour constants — `src/lib/*`

Status, phase and category colours are **data**, not styling: they are encodings a chart
legend, a map marker and a table badge must agree on. They live beside the logic that
produces them, are unit-tested, and are the only sanctioned hex literals in the codebase.

| Module | Export | Encodes |
|---|---|---|
| `plane-icon.js` | (inline in `planeIconSvg`) | map marker fill: watched → Starlink violet → long-haul amber → phase |
| `metar-explain.js` | `CAT_COLORS` | VFR / MVFR / IFR / LIFR flight categories |
| `metar-category.js` | `OPS_COLORS` | normal / caution / warning / severe ops impact |
| `fleet-utils.js` | status list | active, maintenance, stored, NEXT retrofit, painting, Starlink install, future GUM |
| `fleet-view.js` | `FLEET_FAMILY_COLORS`, `FLEET_FAMILY_FALLBACK_COLOR` | aircraft family in the delivery histogram |
| `special-aircraft.js` | `SEAT_BAR_COLORS`, `CABIN_COLORS` | seat-map bars vs cabin classes (**distinct palettes — never conflate**) |
| `starlink-chart.js` | `STARLINK_CHART_COLORS` | express / mainline / cumulative series |
| `stats-chart.js` | `UTIL_BAR_COLOR`, `AGE_BAR_COLOR`, `PHASE_COLORS`, `PHASE_ICONS` | utilisation bars, fleet-age bands, flight-phase donut |
| `connection-risk.js` | `CONN_COLORS` | connection risk bands |
| `weather-cards.js` | `NEUTRAL_MARKER_COLOR`, `UNKNOWN_CAT_COLOR` | no-data map markers |

Owner-approved: Starlink aircraft render **violet** `#A78BFA` on the map (Jul 4 2026).

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
`Header` → `Ticker` → `HubHealthStrip` → `TabBar` (desktop) → active view → `Attribution`
→ `MobileNav` (mobile). Only the view scrolls; the chrome is `shrink-0`.

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
wrapped. Icons are **lucide-react**.

| Need | Primitive | Where |
|---|---|---|
| Flight detail panel | `Sheet` (non-modal, right) | `features/FlightSheet.tsx` |
| Filter drawers, watch list, mobile "More" | `Sheet` | `views/LiveView`, `views/schedule/ScheduleControls`, `shell/WatchPanel`, `shell/MobileNav` |
| Aircraft detail, delay explain, FR24 lookup, disclaimer, onboarding | `Dialog` (modal) | `features/*Dialog.tsx`, `features/Onboarding.tsx` |
| Global search (⌘K) | `Command` | `features/SearchPalette.tsx` |
| Waitlist signup | `Dialog` + `Input`/`Textarea`/`Label` | `features/WaitlistDialog.tsx` |
| Legal / attribution disclosure | `Popover` | `features/LegalPopover.tsx` |
| Jargon definitions | `Tooltip` | `features/JargonTerm.tsx` |
| Tab navigation | `Tabs` | `shell/TabBar.tsx` |
| Segmented filters | `ToggleGroup` / `Toggle` | `views/schedule/ScheduleControls.tsx` |
| Dropdown filters | `Select` | schedule / fleet / starlink controls |
| Data grids | `Table` + sortable `<th><button>` | `views/schedule/ScheduleTable`, `views/fleet/SortableHeader`, `components/trackers/TrackerTable.astro` |
| Status pills | `Badge` | throughout |
| Loading | `Skeleton` | every async view |
| Hints | `Tooltip` | throughout |

**Rule of thumb:** modal → `Dialog`; a panel that must leave the map usable → non-modal
`Sheet`; a small anchored disclosure → `Popover`. Never hand-roll an overlay: the primitives
bring the focus trap, the Escape handler and the accessible name for free.

**Engagement surfaces stay quiet.** The news banner, tip strip, support meter and BMAC toast
(`features/NewsBanner`, `TipStrip`, `SupportMeter`, `BmacToast`) are dismissible inline
elements, never modals, and their show/hide rules live in `src/lib/engagement.js`,
`tips.js`, `support-meter.js` and `waitlist-gate.js` — not in the components. Nothing that
asks the visitor for something may interrupt the data they came for.

Astro-side building blocks live in `src/components/site/` (`StatTile`, `HighlightBox`,
`JumpNav`, `PillNav`, `Breadcrumbs`, `ContentSection`, `Seo`, `JsonLd`) and
`src/components/trackers/`.

## Responsive

Tailwind defaults: **`sm` 640 · `md` 768 · `lg` 1024**.

- **The dashboard switches navigation at `lg`.** `TabBar` is `hidden lg:block`; `MobileNav`
  (bottom bar) is `lg:hidden`. The Live sidebar and the flight panel's map-control offset use
  the matching `(min-width: 1024px)` media query — keep the class and the query in step.
- **Content pages switch at `md`.** `SiteHeader`'s inline nav is `hidden md:flex`; below that
  it is a `<details>` menu.
- **Touch targets are ≥44px below the breakpoint that hides the pointer UI** — `min-h-11` /
  `size-11`, relaxed at `md:` where a mouse is likely.
- The page body never scrolls horizontally. Tables, the map and code blocks get their own
  `overflow-x-auto` container.

## Accessibility

- **One IROPS announcer.** `shell/IropsAnnouncer.tsx` is the single `aria-live` writer for
  disruption news. The `Ticker` is deliberately `aria-live="off"` — a strip that rotates on a
  timer would otherwise interrupt a screen reader every few seconds.
- **Live regions, by design:** `OfflineBanner` (`assertive` — connectivity is urgent);
  `IropsAnnouncer`, `HubHealthStrip`, `live/StatsBar`, `weather/IropsSection`,
  `weather/TrackerBriefing`, and the tracker Astro widgets (`polite`). Adding a new one means
  checking it does not compete with these.
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
- **No CDN.** No unpkg, no Google Fonts, no external stylesheet or script. CSP is
  `script-src 'self'` + hashed Astro island scripts; a CDN reference fails silently in prod.
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
