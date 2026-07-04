# July 4 Punch List — Design

Five items from owner feedback (Jul 4 2026): stale-board banner copy, Starlink map
marker treatment, IROPS score display, radar map framing, and schedule registration
backfill (Phase 1 of the schedule overhaul).

## 1. Stale-board banner copy

**Problem.** The schedule banner says "live updates paused" for degraded/stale boards.
"Paused" implies an intentional, resumable stop; the truth is the feed is failing or the
board is a cached snapshot. Owner: "doesn't feel very honest."

**Change.** In `src/dashboard/main.js` (banner builder inside the schedule load path),
replace the three "— live updates paused." strings with "— showing the latest data we
have.":

- degraded + partial: `Statuses as of {asOf} (partial board, {age} old) — showing the latest data we have.`
- degraded, complete: `Statuses as of {asOf} ({age} old) — showing the latest data we have.`
- stale, complete: same as degraded-complete.

Everything else — age-based amber/red escalation, completeness percentage, Retry button —
is unchanged.

## 2. Starlink markers on the live ops map

**Problem.** Starlink-equipped aircraft get a stacked triple `drop-shadow` amber halo
(`createPlaneIcon`), which reads as a blurry "glowing orb," especially at low zoom.

**Change.** Remove the halo. Starlink aircraft are drawn with a violet fill `#A78BFA`;
all aircraft keep the standard single 2px legibility drop-shadow in their own fill color.

Fill-color priority: **watched green → Starlink violet → long-haul amber → phase color.**
A watched Starlink aircraft stays green (watchlist beats equipment).

Accepted trade-off (owner decision): phase color is no longer visible on Starlink planes.
The flight popup and the Starlink-only filter still carry that information. Any legend /
tooltip / help text describing the amber glow is updated to describe the violet fill.
The icon cache key already includes `isStarlink`; no cache-shape change needed.

## 3. IROPS score → severity label

**Problem.** The Delays tab shows `IROPS 56/100`. Owner: the 0–100 rating isn't helpful.

**Change.** At both render sites of the IROPS bar, replace the numeric chip with a
plain-language severity label using the existing score→class mapping and colors:

- score < 5 → `NORMAL OPERATIONS` (green)
- 5–15 → `MINOR DISRUPTION` (yellow)
- ≥ 15 → `SIGNIFICANT DISRUPTION` (red)

The concrete counts beside it (cancellations, >30m, >60m, diversions, total flights) are
unchanged. The tooltip is reworded to explain the label thresholds in terms of weighted
events per 100 flights, without presenting a user-facing 0–100 score.

**Constraint.** The numeric score continues to be computed and written to
`lastIropsScore` — the header ticker's ops-health gating (`src/lib/ops-health.js`,
"never say normal on a red IROPS night") depends on it. Display-only change.

## 4. Radar map framing (Delays tab)

**Change.** `L.map('radar-map', {center:[39,-97], zoom:3})` → `zoom: 4`. Same center.
Frames CONUS like the live ops map instead of hemisphere-plus-oceans.

## 5. Schedule Phase 1 — registration & aircraft backfill (client-side)

**Problem.** Schedule boards get registrations only from the AeroDataBox schedule feed,
which frequently omits them — including for flights currently airborne whose tail is
already known to the live FR24 feed in the same browser session. No cross-fill exists.

**Change.** Client-side, zero new API spend:

1. **Seen-today reg ledger.** On every live-feed poll, record
   `normalizedFlightNumber → { reg, seenAt }` for every flight with both fields.
   Kept in a module-level map and mirrored to `localStorage` so a tail seen airborne
   earlier survives page reloads. Entries expire on a same-service-day TTL — a ledger
   entry never fills a row whose scheduled departure is on a different local day than
   `seenAt` (prevents pinning yesterday's tail on today's same flight number).
2. **Backfill order in the schedule row renderer.** When `fl.aircraft.registration` is
   empty: (a) match the live feed (`allFlights`) by normalized flight number — flight is
   airborne now; (b) else consult the ledger — flight departed while a session was
   watching. If neither hits, the row keeps `—`.
3. **Free enrichment.** A backfilled reg flows into the existing `FLEET_BY_REG`
   enrichment (aircraft type, Starlink ⚡, special-livery badge) with no further work.
4. **Normalization.** One shared helper normalizes both sides of the match:
   `UA123` / `UAL123` / `UA 0123` → `UA123`. Regional operating idents (e.g. `G7929`)
   are not matched — mainline only, since the live feed is queried as UAL.

**Honest limit (recorded, deliberate).** Flights that departed before any browser
session saw them airborne remain blank. Closing that gap needs a server-side reg ledger
(cron snapshots the live feed into Supabase) — deferred to schedule-overhaul Phase 2
alongside caching/freshness. Phase 3 is the visual redesign.

## Testing

Unit tests (vitest) for: flight-number normalization, ledger TTL / service-day guard,
and backfill precedence (live feed beats ledger; existing provider reg never overwritten).
Repo gates before PR: `bun run test`, `bun run typecheck`, `bun run build`.

## Out of scope

Server-side reg ledger, schedule caching rework, schedule visual redesign (Phases 2–3),
any change to the IROPS score computation or ticker logic.
