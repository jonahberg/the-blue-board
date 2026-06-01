# STARLINK Tab — Design Spec

**Date:** 2026-06-01
**Status:** Approved (mockup Direction A — "NOC Console", selected by Jonah)
**Supersedes:** PR #180 (`feat/starlink-top-level-tab`, the shortcut-tab approach)

## Problem

Starlink coverage is The Blue Board's most differentiated dataset (371 equipped aircraft, live
flight assignments, install dates), but it is buried as a sub-tab under FLEET and its data is the
only table on the site whose rows are not clickable. Users — including the owner — repeatedly
cannot find it.

## Goals

1. Starlink gets a top-level 🛰️ STARLINK nav tab (desktop tab bar + mobile More menu), deep-linkable
   as `#starlink`.
2. Every tail in the table is clickable and expands inline into that aircraft's flight timeline and
   actions ("NOC Console" direction).
3. The tab leads with rollout stats: equipped count, Express/Mainline progress bars, new-this-week,
   airborne-now.
4. Looks excellent per DESIGN.md: dark NOC, Satoshi/DM Sans/JetBrains Mono, amber used only for
   emphasis (NEW badges, hero number, featured borders).
5. Zero API changes — the data is already served by `/api/starlink-data` (fixed/enriched in PR #185/#187).

## Non-Goals

- No new backend endpoints or schema changes.
- No per-flight pages or flight-detail modals (the timeline rows are informational).
- No changes to the LIVE OPS map beyond reusing the existing `focusFlight()` to track an airborne
  Starlink aircraft.

## Architecture

### Navigation

- `public/index.html`: add `<button class="tab-btn" data-tab="tab-starlink">🛰️ STARLINK</button>`
  between FLEET and DELAYS·WEATHER·HUBS in `#tab-bar`; add the same entry to `#mobile-more-menu`.
- `src/dashboard/main.js`: add `'tab-starlink': '#starlink'` to `TAB_HASHES`; add a
  `tab-starlink` init branch in `switchToTab()`'s requestAnimationFrame block that calls
  `initStarlinkTab()` and — mirroring the FLEET branch — `refreshFlights()` when `allFlights` is
  empty, so airborne status works when a user deep-links straight to `#starlink`.
- A real `<div class="tab-content" id="tab-starlink" role="tabpanel">` panel — NOT PR #180's
  virtual mapping onto `#tab-fleet`.

### Tab content (`#tab-starlink`)

Three zones, top to bottom:

1. **Hero band** (`.sl-hero`, amber-left-bordered card per DESIGN.md "Featured/highlight"):
   - Left: `371` (JetBrains Mono 32px, amber) over "AIRCRAFT EQUIPPED" micro-label.
   - Center: two progress bars — Express `320/659 · 49%` (green fill), Mainline `51/1122 · 5%`
     (accent-blue fill).
   - Right: chips — `+N NEW THIS WEEK` (amber soft) and `● N AIRBORNE NOW` (green soft, live).
2. **Filter bar** (`.sl-filters`, mirrors existing fleet-controls pattern):
   - Tail search input, Fleet select, Type select, Operator select (populated from data, already
     deduped server-side), and a "★ New this week" toggle chip.
   - Sortable column headers (same `data-*-sort` pattern as the existing Starlink table).
3. **Aircraft table** (`#sl-table` / `#sl-tbody`):
   - Columns: Tail · Fleet · Type · Operator · Status · Next Flight.
   - Tail cell: `.ac-reg-link`-styled clickable + NEW badge when `dateFound` ≤ 7 days.
   - Status: `● Airborne` (green badge, matched against the live flight feed) or `Scheduled` (muted).
   - Next Flight: next upcoming flight number + route + local HH:MM (existing logic, moved here).
   - **Row expansion**: clicking anywhere on the row (except links/buttons inside it) toggles an
     inset `<tr class="sl-expand">` directly below it containing:
     - Meta cards: Starlink Since (amber, relative + absolute) · Operator · Airframe · Flights Today.
     - Flight timeline: up to 5 upcoming flights as `flight_number · ORG → DST · HH:MM – HH:MM` rows.
     - Actions: `📡 Track on Live Map` (only when airborne; calls `focusFlight(icao24)` and switches
       to LIVE OPS) · `Aircraft Details` (existing modal) · `Planespotters ↗` (external).
     - Only one row expanded at a time; clicking another tail collapses the previous. Re-sorting,
       filtering, or searching collapses any expanded row (the table fully re-renders).

### FLEET tab cleanup

- Remove the Starlink sub-tab button (`#fleet-subtab-starlink`), its panel (`#fleet-view-starlink`),
  its filter row (`#fleet-controls-starlink`), and `renderStarlinkTable()`/`initStarlinkFilters()`
  (logic moves to the new tab's renderer).
- Keep: fleet-pulse rollout chips/progress (Zone 1), `SL` badges in the fleet & airborne tables,
  `STARLINK_TAILS` set, and the `fleet-starlink-source` attribution line (moves into the new tab's
  footer).
- The fleet sub-tab count (`fleet-subtab-count-starlink`) and `switchFleetView('starlink')`
  references are removed; deep links that used FLEET→Starlink now route to `#starlink`.

### Data flow

```
loadFleetData() [existing, unchanged]
  ├── /api/starlink-data → STARLINK_DB, STARLINK_FLIGHTS_BY_TAIL, STARLINK_FLEET_STATS, STARLINK_LAST_UPDATED
  └── /data/fleet.json   → FLEET_DB (for Aircraft Details modal)

initStarlinkTab() [new, called on first tab activation]
  ├── renderStarlinkHero()    ← STARLINK_FLEET_STATS + dateFound counts + airborne count
  ├── renderStarlinkTable()   ← STARLINK_DB filtered/sorted (rebuilt; lives in new tab)
  └── wireStarlinkFilters()   ← once

Airborne matching [new helper]
  starlinkAirborne(): Map<tail → {icao24, flight}> built from allFlights (live feed already polled
  by LIVE OPS); refreshed on tab activation and on the existing flight-refresh cycle.

Row expansion [new, delegated via existing data-action click handler]
  data-action="sl-expand" data-tail="N75432" → toggle .sl-expand row, render timeline from
  STARLINK_FLIGHTS_BY_TAIL[tail]
  data-action="sl-track" data-icao24="..." → switchToTab('tab-live') + focusFlight(icao24)
```

### Styling (`public/css/style.css`)

New classes, all from DESIGN.md tokens: `.sl-hero`, `.sl-hero-num`, `.sl-bars`, `.sl-bar-track/.fill`,
`.sl-chip`, `.sl-filters`, `.sl-table` (inherits existing table styles), `.sl-expand`,
`.sl-meta-grid/.sl-meta`, `.sl-fl-row`, `.sl-actions/.sl-btn`, `.sl-live-badge`. Reuses
`.starlink-new-badge` and `.starlink-next-time` from PR #185. Single 600px responsive breakpoint:
hero stacks vertically, meta grid 2-col, table horizontal-scrolls.

## Degraded modes

| Condition | Behavior |
|---|---|
| Static fallback only (no fleetStats/flights) | Hero shows count only (bars hidden), Status + Next Flight columns hidden, expanded row shows meta + Planespotters only |
| Live feed unavailable | Airborne chip hidden, Status column shows `—`, no Track action |
| Aircraft not in FLEET_DB (Express) | "Aircraft Details" still opens the modal with its existing Express fallback content |
| flightsByTail missing a tail | Expanded row shows "No upcoming flights in feed" placeholder |

## Verification plan

1. `bun run typecheck` + `bunx vitest run` (full suite stays green — no api changes expected).
2. `bun run build` (vite dashboard + astro).
3. Browser QA against a local server via gstack browse: tab appears + hash routing, hero numbers
   match `/api/starlink-data`, tail click expands/collapses, only-one-expanded invariant, NEW
   badge filter, Track-on-Map jumps to LIVE OPS focused on the right plane, Aircraft Details modal,
   mobile (375px) layout, FLEET tab still works minus the removed sub-tab.
4. PR with before/after screenshots; close PR #180 referencing this PR.

## Files touched

- `public/index.html` — tab button, mobile menu entry, `#tab-starlink` panel markup, remove fleet
  starlink sub-tab markup
- `src/dashboard/main.js` — TAB_HASHES, switchToTab branch, initStarlinkTab + renderers + airborne
  matcher + delegated actions, remove old renderStarlinkTable/initStarlinkFilters
- `public/css/style.css` — `.sl-*` styles
- `docs/superpowers/specs/2026-06-01-starlink-tab-design.md` — this spec
