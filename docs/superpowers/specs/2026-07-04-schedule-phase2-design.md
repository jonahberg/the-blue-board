# Schedule Overhaul Phase 2 — Server-Side Reg Ledger + Live-Status Overlay

Phase 1 (PR #215) backfilled schedule registrations client-side: a tail fills only if
*that browser session* (or a prior same-browser session) saw the flight airborne. Phase 2
moves sighting capture and merge server-side so **every user gets every tail**, and uses
the same sighting data to fix the freshness credibility gap: board *statuses* may lag up
to 6h behind reality (clean-board TTL, `api/schedule.ts` — a deliberate quota-economy
trade), while the free FR24 live feed knows minute-by-minute which aircraft are airborne.

**Hard constraint: zero new metered spend.** No AeroDataBox unit-budget change (700/day,
warm cron 384), no TTL/cadence change, no new Vercel cron slot. All new data comes from
the FR24 public live feed (free) and Supabase (negligible).

## Architecture

One new Supabase table, one shared pure-logic module, one server module, three hook
points, one status-engine extension, small client display changes.

```
fr24-feed.ts  ──(waitUntil, ≤1 upsert/min)──▶  reg_sightings (Supabase)
warm-schedules cron ──(1 fetch+upsert/hour backstop)──▶     │
                                                            ▼
schedule.ts serve time ◀──(60s in-memory cache, non-blocking peek+kick,
                            same pattern as FAA disruption context)
        │ applySightingsToBoard(payload)  — never mutates cached objects
        ▼
  flights[]: aircraft.registration backfilled (+ regSource:'live_feed')
             flight.live = { seenAt } attached when sighting ≤15 min old
        ▼
client: classifySchedStatus reclassifies live rows (Departed / En Route · LIVE);
        reg tooltip recognizes regSource
```

## 1. `reg_sightings` table (`sql/013_reg_sightings.sql`)

```sql
create table if not exists reg_sightings (
  flight_key text primary key,      -- normalized, e.g. 'UA123'
  reg        text not null,         -- e.g. 'N12345'
  origin     text,                  -- IATA from the live feed (may be '')
  dest       text,
  seen_at    timestamptz not null default now()
);
create index if not exists reg_sightings_seen_at_idx on reg_sightings (seen_at);
alter table reg_sightings enable row level security;
```

No policies — default-deny; only the service-role API touches it (matches the
post-remediation RLS posture). One row per flight number, latest sighting wins (upsert).
Applied at ship time via the Supabase SQL editor (same flow as sql/009).

## 2. Shared pure logic (`src/lib/reg-overlay.js` + tests)

Pure functions, no I/O, imported by both `api/` (Vercel functions already import from
`src/lib/`) and tests. Reuses `normalizeFlightNum`, `SIGHTING_BEFORE_DEP_MS`,
`SIGHTING_AFTER_ARR_MS`, `DEFAULT_FLIGHT_SPAN_MS` from Phase 1's `src/lib/reg-ledger.js`.

- `extractSightings(parsedFlights, nowMs)` → `[{flight_key, reg, origin, dest, seen_at}]`
  rows for upsert, from `parseFr24Feed` output (mainline UA only, reg required).
- `sightingMatchesFlight(sighting, flight, nowMs)` → boolean. Guards, all required:
  1. key match on normalized flight number;
  2. operation window: `seen_at` within `[schedDep − 2h, schedArr + 3h]` (16h span when
     arrival missing) — Phase 1 semantics;
  3. **route match**: when both the sighting and the board row carry origin/dest IATA,
     they must agree (either direction pair); missing/empty codes don't veto.
- `applySightingsToBoard(payload, sightingsByKey, nowMs)` → new payload.
  - Backfill: rows with empty `aircraft.registration` whose sighting matches get
    `registration` + `regSource: 'live_feed'`. **Provider regs are never overwritten.**
  - Live overlay: any matching row (with or without provider reg) whose sighting is
    ≤ `LIVE_RECENT_MS` (15 min) old gets `live: { seenAt: <epoch ms> }`.
  - **Non-mutating**: returns new flight objects for changed rows only; the input payload
    (which may be a shared in-memory cache entry) is never modified. Snapshots and caches
    stay pure provider data; enrichment is serve-time only.

## 3. Server module (`api/_reg-sightings.ts` + tests)

Follows the FAA-disruption non-blocking pattern in `api/faa.ts` / `schedule.ts`:

- `recordFeedSightings(parsedFlights)`: batch upsert via `getSupabase()`, throttled to
  one write per instance per 60s (`REG_SIGHTINGS_WRITE_MIN_INTERVAL_MS`); never throws
  (log + degrade — sightings are an enhancement, never a failure source).
- `peekRegSightings()`: synchronous; returns the cached `Map<flight_key, sighting>` or
  an empty map. Never fetches.
- `kickRegSightingsRefresh()`: returns a refresh promise when the cache (CacheStore,
  60s TTL) is cold/expired, else null — caller passes it to `enqueueBackgroundTask`.
  Refresh reads rows with `seen_at > now() − 36h` (matches Phase 1 ledger max age;
  table stays ~≤1,500 rows).

## 4. Hook points

- **`api/fr24-feed.ts`**: after a successful upstream fetch (post `countFeedAircraft`
  guard), `waitUntil(recordFeedSightings(parseFr24Feed(payload)))` — with the same
  try/catch-if-waitUntil-unavailable fallback `schedule.ts:enqueueBackgroundTask` uses.
  Applies on fresh fetches only (cache hits recorded nothing new). Zero client latency.
- **`api/cron/warm-schedules.ts`**: once per fire, fetch the FR24 feed
  (`data-cloud.flightradar24.com`, free, same URL/headers as fr24-feed.ts) and
  `recordFeedSightings` — the overnight/no-traffic backstop. Failure is logged, never
  fails the cron run.
- **`api/schedule.ts`**: `kickRegSightingsRefresh()` enqueued next to
  `kickDisruptionRefresh()`; the existing `withDisruption(payload)` wrapper (applied on
  every 200 path) becomes `withDisruption(applySightingsToBoard(payload, peekRegSightings(), Date.now()))`
  composed in one place, so cached, stale, degraded, snapshot, and fresh serves all get
  the merge. Meta gains `regSightingsAt` (cache load time) for debuggability.

## 5. Status engine extension (`src/lib/schedule-status.js` + tests)

The engine already reclassifies stale provider statuses by elapsed time
(`RECLASSIFIABLE_KEYS = {scheduled, estimated, delayed}` → presumed Departed/Landed,
`inferred`/`presumed` flags). A live sighting is **stronger evidence** than elapsed time
and slots into the same gate:

- Input: `fl.live.seenAt` (epoch ms, attached server-side), engine-side recency re-check
  (≤ 20 min vs `nowSec`) as defense in depth — a board served from cache minutes later
  must not treat an aging sighting as current.
- When `base.key ∈ RECLASSIFIABLE_KEYS` and live evidence present:
  - departures: `{ text: 'Departed', cls: 'departed', key: 'departed', live: true }`
  - arrivals: `{ text: 'En Route', cls: 'enroute', key: 'enroute', live: true }`
  - Never `landed` from a sighting (a recent sighting means airborne).
- Live evidence takes precedence over time-inference (replaces `presumed` asterisk).
- Statuses outside the reclassifiable set (canceled, canceled_uncertain, diverted,
  landed, departed, enroute, boarding) are **never** touched — upgrade-only.
- Stat-strip coherence is automatic: the key change flows through
  `computeScheduleStatCounts`, so visible rows and stats agree (preserves the Jul 3
  reconciliation invariant).

## 6. Client display (`src/dashboard/main.js`, `src/lib/status-display.js`, CSS)

- Status cell: results with `live: true` render their text plus a small
  `<span class="sched-live-chip">LIVE</span>` (green, mono, 8px) instead of the presumed
  asterisk. Tooltip: "Aircraft seen airborne by live flight tracking".
- Reg tooltip: `regFromLive` becomes
  `reg !== '—' && (!fl.aircraft?.registration || fl.aircraft?.regSource === 'live_feed')`
  so server-merged tails keep the honesty tooltip.
- Phase 1's client-side ledger stays as the final fallback layer (covers the server
  cache's 60s cold window and any Supabase outage) — `schedRegFor` order becomes:
  provider (incl. server-merged) → client ledger.

## Failure modes

- Supabase down: writes and reads degrade silently; boards serve exactly as today.
- Sightings map cold (first request after deploy/idle): merge is a no-op for that serve;
  background refresh warms it. Never blocks, never errors.
- Wrong-instance protection: normalized-key + operation-window + route-match guards;
  engine-side recency re-check for the live chip.

## Testing

TDD for all pure logic: `tests/reg-overlay.test.js` (extract/match/apply, non-mutation
assertion), `tests/schedule-status.test.js` additions (live reclassification, recency
gate, upgrade-only, arrivals vs departures), `tests/reg-sightings.test.js` (throttle,
peek/kick contract, Supabase mocked following `tests/schedule-snapshots.test.js`
patterns). Gates: `bun run test`, `bun run typecheck`, `bun run build`.

## Out of scope

Schedule visual redesign (Phase 3); TTL/cadence/budget changes; historical reg archive
(table holds a rolling ~36h); non-UA carriers; feeding sightings into the IROPS index.
