# Starlink Installation Velocity Chart — Design Spec

**Date:** 2026-06-01
**Status:** Approved (comp A — "Ops Bars", selected by Jonah from rendered comps)
**Builds on:** the dedicated STARLINK tab (#188), spec `2026-06-01-starlink-tab-design.md`

## Problem

The STARLINK tab shows the rollout's current state (371 equipped, fleet percentages) but nothing
about its **velocity** — how fast United is equipping aircraft month over month, and how the
rollout has shifted from Express (2025) to Mainline (2026). The data to show this already exists:
every aircraft carries `dateFound`.

## The chart (comp A — Ops Bars)

A chart card on the STARLINK tab, directly under the hero band, above the filters:

- **Card chrome**: same amber-left-bordered card as the hero. Label `INSTALLATION VELOCITY`
  (mono, amber, uppercase) · sub `Aircraft equipped per month · <first month> – <current month>`.
- **Stacked bars per month**: Express (green, `--ua-green`) below, Mainline (accent blue,
  `--ua-accent`) above, total count label over each bar.
- **Cumulative line**: amber (`--ua-amber`), 2px, dot per month, riding over the bars on its own
  scale (0 → live total). End label shows the current total.
- **Outlier handling**: any month whose total exceeds the visual cap (45/month) renders as a capped
  bar with a jagged break marker and a `N*` label; a footnote explains the Dec 2025 tracker
  catch-up batch (117 aircraft on Dec 3).
- **Zero months**: rendered as empty slots — the time axis is continuous from the first install
  month to the current month.
- **Legend**: Express · Mainline · Cumulative.
- **Left axis**: monthly installs (0–cap). **Right axis**: cumulative (amber, 0–total).

## Data flow

Zero API changes. Everything derives from `STARLINK_DB[].dateFound` + `.fleet`, which the tab
already loads:

```
src/lib/starlink-utils.js (NEW — unit-testable, mirrors fleet-utils.js)
  bucketInstallsByMonth(aircraft, nowDate?) →
    [{ ym: '2025-03', label: 'MAR 25', express: 7, mainline: 0, total: 7, cumulative: 7 }, ...]
  - continuous month range: first dateFound month → current month (zero months included)
  - aircraft without a parseable dateFound are excluded from bars but counted in a returned
    `undated` count (cumulative line still ends at aircraft.length when undated === 0)
  - label rule: 'MMM' uppercase; January and the first month carry the 2-digit year ('MAR 25')

src/dashboard/main.js
  renderSlChart() — builds the SVG from bucketInstallsByMonth(STARLINK_DB); called from
  initStarlinkTab() after renderSlHero(). Pure-SVG string assembly (no chart library), all
  dynamic text through escapeHtml.
```

## Markup / styles

- `public/index.html`: `<div class="sl-chart-card" id="sl-chart-card" style="display:none">` between
  `.sl-hero` and `.sl-filters`, containing label, sub, `<svg id="sl-chart" viewBox="0 0 940 280">`,
  legend, and footnote container.
- `public/css/style.css`: `.sl-chart-card`, `.sl-chart-label`, `.sl-chart-sub`, `.sl-chart-legend`,
  `.sl-chart-footnote` — all from existing tokens. Mobile (≤600px): card gets horizontal scroll
  (`overflow-x:auto`) with a min-width on the SVG so bars stay readable.

## Degraded modes

| Condition | Behavior |
|---|---|
| No aircraft have `dateFound` (static fallback) | Chart card stays `display:none` |
| Some aircraft missing `dateFound` | Bars show dated aircraft only; footnote appends "+N undated" |
| Single month of data | Renders one bar + flat cumulative line (no special case needed) |

## Verification

1. Unit tests (`tests/starlink-utils.test.js`): month bucketing, fleet split, zero-month
   continuity, cumulative math, undated handling, label formatting, Dec-batch data shape.
2. `bun run typecheck` + `bunx vitest run` + `bun run build`.
3. Browser QA (local build + prod data proxy): chart renders under hero, bars/line/labels match
   live data, break marker + footnote on Dec, mobile 375px horizontal scroll, card hidden when
   data degraded.
4. PR off `main`; chart visible after merge.
