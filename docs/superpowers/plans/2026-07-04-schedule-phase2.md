# Schedule Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-side registration ledger (every user gets every tail) + live-status overlay (airborne aircraft upgrade stale "Scheduled" rows), at zero new metered spend.

**Architecture:** New Supabase table `reg_sightings` written from `fr24-feed.ts` (throttled `waitUntil` side effect) with an hourly warm-cron backstop; read at serve time in `schedule.ts` via the FAA-disruption peek+kick pattern; pure merge/match logic shared in `src/lib/reg-overlay.js`; `classifySchedStatus` treats a recent sighting as stronger-than-time-inference evidence.

**Tech Stack:** Vercel TS functions (`api/`), Supabase (service role), vanilla JS dashboard, vitest via `bun run test`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-04-schedule-phase2-design.md`
- Tests: `bun run test` (vitest) — NEVER bare `bun test` (repo CLAUDE.md).
- Gates before PR: `bun run test`, `bun run typecheck`, `bun run build`.
- **Zero new metered spend**: no AeroDataBox calls, no TTL/cadence changes, no new cron slots.
- **Provider registrations are never overwritten**; snapshots/caches stay pure provider data (merge is serve-time only and MUST NOT mutate its input payload — cache entries are shared objects).
- Sightings are an enhancement: every Supabase failure degrades to "no merge", never to an error response.
- `api/` files import from `src/lib/` with the `../src/lib/*.js` pattern (see `api/schedule.ts:17-18`).

---

### Task 1: `sql/013_reg_sightings.sql`

**Files:**
- Create: `sql/013_reg_sightings.sql`

**Interfaces:**
- Produces: table `reg_sightings(flight_key text pk, reg text, origin text, dest text, seen_at timestamptz)` — Tasks 4+ write/read it. NOT applied by CI; applied manually via Supabase SQL editor at ship time (same flow as sql/009).

- [ ] **Step 1: Write the migration**

```sql
-- Phase 2 (spec: docs/superpowers/specs/2026-07-04-schedule-phase2-design.md):
-- server-side flight→tail sightings harvested from the free FR24 live feed.
-- One row per normalized mainline flight number; latest sighting wins (upsert).
-- Rolling window: readers ignore rows older than 36h, so the table stays ~≤1,500 rows.
-- RLS default-deny (no policies): only the service-role API reads/writes this table.
create table if not exists reg_sightings (
  flight_key text primary key,
  reg        text not null,
  origin     text,
  dest       text,
  seen_at    timestamptz not null default now()
);
create index if not exists reg_sightings_seen_at_idx on reg_sightings (seen_at);
alter table reg_sightings enable row level security;
```

- [ ] **Step 2: Commit**

```bash
git add sql/013_reg_sightings.sql
git commit -m "feat(schedule): reg_sightings table for the server-side tail ledger"
```

---

### Task 2: `src/lib/reg-overlay.js` — pure merge logic (TDD)

**Files:**
- Create: `src/lib/reg-overlay.js`
- Test: `tests/reg-overlay.test.js`

**Interfaces:**
- Consumes: `normalizeFlightNum`, `SIGHTING_BEFORE_DEP_MS`, `SIGHTING_AFTER_ARR_MS`, `DEFAULT_FLIGHT_SPAN_MS` from `src/lib/reg-ledger.js` (Phase 1, exists).
- Produces (Tasks 4/6 depend on exact names):
  - `LIVE_RECENT_MS = 15 * 60e3`
  - `extractSightings(parsedFlights, nowMs)` → `[{flight_key, reg, origin, dest, seen_at}]`
  - `sightingMatchesFlight(sighting, flight)` → boolean (sighting: `{reg, origin, dest, seenAtMs}`)
  - `applySightingsToBoard(payload, sightingsByKey, nowMs)` → payload (new object when changed, same reference when not)

- [ ] **Step 1: Write the failing tests**

`tests/reg-overlay.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  LIVE_RECENT_MS, extractSightings, sightingMatchesFlight, applySightingsToBoard,
} from '../src/lib/reg-overlay.js';

const H = 3600e3;
const NOW = 1_750_000_000_000;
const depSec = Math.floor(NOW / 1000) - 1800; // scheduled 30 min ago
const arrSec = depSec + 4 * 3600;

const boardFlight = (over = {}) => ({
  identification: { number: { default: 'UA123' } },
  time: { scheduled: { departure: depSec, arrival: arrSec } },
  airport: { origin: { code: { iata: 'ORD' } }, destination: { code: { iata: 'SFO' } } },
  aircraft: { model: { code: '739' }, registration: '' },
  ...over,
});
const sighting = (over = {}) => ({ reg: 'N12345', origin: 'ORD', dest: 'SFO', seenAtMs: NOW - 5 * 60e3, ...over });

describe('extractSightings', () => {
  it('builds upsert rows from parsed feed flights, deduped by key, reg required', () => {
    const rows = extractSightings([
      { flightIATA: 'UA123', callsign: 'UAL123', reg: 'N12345', origin: 'ORD', dest: 'SFO' },
      { flightIATA: 'UA123', callsign: 'UAL123', reg: 'N99999', origin: 'ORD', dest: 'SFO' }, // dup key: first wins
      { flightIATA: '', callsign: 'UAL456', reg: 'N45678', origin: 'ewr', dest: 'lax' },
      { flightIATA: 'UA789', callsign: 'UAL789', reg: '' },          // no reg
      { flightIATA: 'G7929', callsign: 'GJS929', reg: 'N11111' },    // not mainline
    ], NOW);
    expect(rows).toEqual([
      { flight_key: 'UA123', reg: 'N12345', origin: 'ORD', dest: 'SFO', seen_at: new Date(NOW).toISOString() },
      { flight_key: 'UA456', reg: 'N45678', origin: 'EWR', dest: 'LAX', seen_at: new Date(NOW).toISOString() },
    ]);
  });
  it('handles garbage input', () => {
    expect(extractSightings(null, NOW)).toEqual([]);
    expect(extractSightings([null, {}], NOW)).toEqual([]);
  });
});

describe('sightingMatchesFlight', () => {
  it('matches inside the operation window with agreeing route', () => {
    expect(sightingMatchesFlight(sighting(), boardFlight())).toBe(true);
  });
  it('rejects sightings outside the operation window (another day’s instance)', () => {
    expect(sightingMatchesFlight(sighting({ seenAtMs: depSec * 1000 - 24 * H }), boardFlight())).toBe(false);
    expect(sightingMatchesFlight(sighting({ seenAtMs: arrSec * 1000 + 24 * H }), boardFlight())).toBe(false);
  });
  it('uses a 16h span when scheduled arrival is missing', () => {
    const fl = boardFlight({ time: { scheduled: { departure: depSec } } });
    expect(sightingMatchesFlight(sighting(), fl)).toBe(true);
    expect(sightingMatchesFlight(sighting({ seenAtMs: depSec * 1000 + 20 * H }), fl)).toBe(false);
  });
  it('rejects a route mismatch, tolerates missing codes on either side', () => {
    expect(sightingMatchesFlight(sighting({ origin: 'DEN' }), boardFlight())).toBe(false);
    expect(sightingMatchesFlight(sighting({ dest: 'LAX' }), boardFlight())).toBe(false);
    expect(sightingMatchesFlight(sighting({ origin: '', dest: '' }), boardFlight())).toBe(true);
    const noRouteFlight = boardFlight({ airport: {} });
    expect(sightingMatchesFlight(sighting(), noRouteFlight)).toBe(true);
  });
  it('requires a scheduled departure and a usable sighting', () => {
    expect(sightingMatchesFlight(sighting(), boardFlight({ time: { scheduled: {} } }))).toBe(false);
    expect(sightingMatchesFlight(sighting({ seenAtMs: NaN }), boardFlight())).toBe(false);
    expect(sightingMatchesFlight(sighting({ reg: '' }), boardFlight())).toBe(false);
    expect(sightingMatchesFlight(null, boardFlight())).toBe(false);
  });
});

describe('applySightingsToBoard', () => {
  const mapOf = (s) => new Map([['UA123', s]]);

  it('backfills a blank registration and tags regSource', () => {
    const payload = { flights: [boardFlight()], meta: { completeness: 1 } };
    const out = applySightingsToBoard(payload, mapOf(sighting()), NOW);
    expect(out.flights[0].aircraft.registration).toBe('N12345');
    expect(out.flights[0].aircraft.regSource).toBe('live_feed');
    expect(out.flights[0].aircraft.model.code).toBe('739'); // rest of aircraft preserved
  });

  it('NEVER overwrites a provider registration', () => {
    const payload = { flights: [boardFlight({ aircraft: { registration: 'N77777' } })] };
    const out = applySightingsToBoard(payload, mapOf(sighting()), NOW);
    expect(out.flights[0].aircraft.registration).toBe('N77777');
    expect(out.flights[0].aircraft.regSource).toBeUndefined();
  });

  it('attaches live:{seenAt} for recent sightings — including rows WITH a provider reg', () => {
    const recent = sighting({ seenAtMs: NOW - 5 * 60e3 });
    const withReg = { flights: [boardFlight({ aircraft: { registration: 'N77777' } })] };
    expect(applySightingsToBoard(withReg, mapOf(recent), NOW).flights[0].live).toEqual({ seenAt: recent.seenAtMs });
    const old = sighting({ seenAtMs: NOW - LIVE_RECENT_MS - 1000 });
    const out = applySightingsToBoard({ flights: [boardFlight()] }, mapOf(old), NOW);
    expect(out.flights[0].live).toBeUndefined();          // old sighting: reg fills, no live flag
    expect(out.flights[0].aircraft.registration).toBe('N12345');
  });

  it('does not mutate the input payload or its flights (shared cache objects)', () => {
    const fl = boardFlight();
    const payload = { flights: [fl] };
    const out = applySightingsToBoard(payload, mapOf(sighting()), NOW);
    expect(fl.aircraft.registration).toBe('');
    expect(fl.live).toBeUndefined();
    expect(payload.flights[0]).toBe(fl);
    expect(out).not.toBe(payload);
  });

  it('returns the SAME payload reference when nothing changes', () => {
    const payload = { flights: [boardFlight({ identification: { number: { default: 'UA999' } } })] };
    expect(applySightingsToBoard(payload, mapOf(sighting()), NOW)).toBe(payload);
    expect(applySightingsToBoard(payload, new Map(), NOW)).toBe(payload);
    expect(applySightingsToBoard(null, mapOf(sighting()), NOW)).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test tests/reg-overlay.test.js`
Expected: FAIL — cannot resolve `../src/lib/reg-overlay.js`.

- [ ] **Step 3: Implement**

`src/lib/reg-overlay.js`:

```js
// ═══ REG OVERLAY — pure merge logic for server-side sighting enrichment ═══
// Phase 2 (spec: docs/superpowers/specs/2026-07-04-schedule-phase2-design.md). Shared by
// api/_reg-sightings.ts (row shaping), api/schedule.ts (serve-time board merge) and tests.
// Pure functions only — no I/O, no Date.now() defaults; callers inject time.
//
// Guard model (all guards must pass before a sighting touches a board row):
//   1. key match — the map is keyed by normalized mainline flight number (UA123);
//   2. operation window — the sighting happened during THIS flight instance's operation
//      (2h before scheduled dep → 3h after scheduled arr; 16h span when arr unknown),
//      Phase 1 semantics from src/lib/reg-ledger.js;
//   3. route match — when both sides carry origin/dest IATA they must agree; missing
//      codes never veto (some feed rows have blank endpoints).

import {
  normalizeFlightNum,
  SIGHTING_BEFORE_DEP_MS,
  SIGHTING_AFTER_ARR_MS,
  DEFAULT_FLIGHT_SPAN_MS,
} from './reg-ledger.js';

/** A sighting this recent means "airborne right now" → rows get live:{seenAt}. */
export const LIVE_RECENT_MS = 15 * 60e3;

/**
 * Shape parsed live-feed flights (src/lib/feed-health.js parseFr24Feed output) into
 * reg_sightings upsert rows. Mainline UA only, reg required, deduped by key (first wins —
 * feed order is stable within a poll and duplicates are pathological anyway).
 */
export function extractSightings(parsedFlights, nowMs) {
  const rows = [];
  if (!Array.isArray(parsedFlights)) return rows;
  const seen = new Set();
  const seenAtIso = new Date(nowMs).toISOString();
  for (const f of parsedFlights) {
    if (!f || typeof f.reg !== 'string' || !f.reg) continue;
    const key = normalizeFlightNum(f.flightIATA) || normalizeFlightNum(f.callsign);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({
      flight_key: key,
      reg: f.reg,
      origin: String(f.origin || '').toUpperCase(),
      dest: String(f.dest || '').toUpperCase(),
      seen_at: seenAtIso,
    });
  }
  return rows;
}

/** Guards 2+3 (window + route). Key matching is the caller's map lookup. */
export function sightingMatchesFlight(sighting, flight) {
  if (!sighting || !flight) return false;
  const seen = Number(sighting.seenAtMs);
  if (!Number.isFinite(seen) || typeof sighting.reg !== 'string' || !sighting.reg) return false;
  const depSec = Number(flight.time?.scheduled?.departure);
  if (!Number.isFinite(depSec) || depSec <= 0) return false; // can't tie a sighting to an unscheduled row
  const dep = depSec * 1000;
  const arrSec = Number(flight.time?.scheduled?.arrival);
  const arr = arrSec > 0 ? arrSec * 1000 : dep + DEFAULT_FLIGHT_SPAN_MS;
  if (seen < dep - SIGHTING_BEFORE_DEP_MS || seen > arr + SIGHTING_AFTER_ARR_MS) return false;
  const so = String(sighting.origin || '').toUpperCase();
  const sd = String(sighting.dest || '').toUpperCase();
  const fo = String(flight.airport?.origin?.code?.iata || '').toUpperCase();
  const fd = String(flight.airport?.destination?.code?.iata || '').toUpperCase();
  if (so && fo && so !== fo) return false;
  if (sd && fd && sd !== fd) return false;
  return true;
}

/**
 * Serve-time board enrichment. NEVER mutates the input — cache entries are shared
 * objects; changed rows are replaced with copies, unchanged payloads return the same
 * reference (cheap no-op for the common all-provider-regs case).
 */
export function applySightingsToBoard(payload, sightingsByKey, nowMs) {
  if (!payload || !Array.isArray(payload.flights) || !sightingsByKey || sightingsByKey.size === 0) return payload;
  let changed = false;
  const flights = payload.flights.map((fl) => {
    const key = normalizeFlightNum(fl?.identification?.number?.default);
    if (!key) return fl;
    const s = sightingsByKey.get(key);
    if (!s || !sightingMatchesFlight(s, fl)) return fl;
    const hasProviderReg = !!fl.aircraft?.registration;
    const isRecent = nowMs - Number(s.seenAtMs) <= LIVE_RECENT_MS;
    if (hasProviderReg && !isRecent) return fl; // nothing to add
    changed = true;
    const next = { ...fl };
    if (!hasProviderReg) {
      next.aircraft = { ...(fl.aircraft || {}), registration: s.reg, regSource: 'live_feed' };
    }
    if (isRecent) next.live = { seenAt: Number(s.seenAtMs) };
    return next;
  });
  if (!changed) return payload;
  return { ...payload, flights };
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun run test tests/reg-overlay.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reg-overlay.js tests/reg-overlay.test.js
git commit -m "feat(schedule): reg-overlay — pure sighting merge logic for server-side enrichment"
```

---

### Task 3: `classifySchedStatus` live reclassification (TDD)

**Files:**
- Modify: `src/lib/schedule-status.js` (function `classifySchedStatus`, currently lines ~119-154)
- Test: `tests/schedule-status.test.js` (append a new describe block)

**Interfaces:**
- Consumes: `flight.live.seenAt` (epoch **ms**) attached by Task 6's serve-time merge.
- Produces: classification results may now carry `live: true` (with keys `departed` / `enroute`). Task 7's display layer reads `statusDisp.live`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/schedule-status.test.js` (match its existing import of `classifySchedStatus`):

```js
describe('live-sighting reclassification (Phase 2)', () => {
  const NOW_SEC = 1_750_000_000;
  const mk = (statusText, { liveAgoSec, schedDepAgoSec = 1800 } = {}) => ({
    status: { text: statusText, generic: { status: { text: statusText } } },
    time: { scheduled: { departure: NOW_SEC - schedDepAgoSec, arrival: NOW_SEC + 3 * 3600 } },
    ...(liveAgoSec != null ? { live: { seenAt: (NOW_SEC - liveAgoSec) * 1000 } } : {}),
  });

  it('upgrades a scheduled departures row with a recent sighting to Departed · live', () => {
    const s = classifySchedStatus(mk('Scheduled', { liveAgoSec: 300 }), 'departures', NOW_SEC);
    expect(s.key).toBe('departed');
    expect(s.live).toBe(true);
    expect(s.presumed).toBeUndefined();
  });

  it('upgrades an arrivals row to En Route, never Landed', () => {
    const s = classifySchedStatus(mk('Scheduled', { liveAgoSec: 300 }), 'arrivals', NOW_SEC);
    expect(s.key).toBe('enroute');
    expect(s.live).toBe(true);
  });

  it('live evidence beats time-inference (no presumed asterisk)', () => {
    // scheduled 3h ago → the time path would mint presumed Departed; live must win instead
    const s = classifySchedStatus(mk('Scheduled', { liveAgoSec: 300, schedDepAgoSec: 3 * 3600 }), 'departures', NOW_SEC);
    expect(s.key).toBe('departed');
    expect(s.live).toBe(true);
    expect(s.presumed).toBeUndefined();
  });

  it('ignores stale sightings (engine-side recency re-check)', () => {
    const s = classifySchedStatus(mk('Scheduled', { liveAgoSec: 1500 }), 'departures', NOW_SEC);
    expect(s.live).toBeUndefined(); // > 20 min old — falls through to normal logic
  });

  it('never touches non-reclassifiable statuses', () => {
    for (const [txt, key] of [['Canceled', 'canceled'], ['Landed', 'landed'], ['Departed', 'departed']]) {
      const s = classifySchedStatus(mk(txt, { liveAgoSec: 300 }), 'departures', NOW_SEC);
      expect(s.key).toBe(key);
      expect(s.live).toBeUndefined();
    }
  });

  it('works without a scheduled time (sighting is the only evidence)', () => {
    const fl = mk('Scheduled', { liveAgoSec: 300 });
    fl.time = {};
    const s = classifySchedStatus(fl, 'departures', NOW_SEC);
    expect(s.key).toBe('departed');
    expect(s.live).toBe(true);
  });
});
```

Note: check the file's existing flight fixtures — if `classifyBase` derives 'scheduled' from a different shape than `status.text`, mirror the shape existing tests use for a Scheduled row. The behavioral assertions above are the contract; adapt fixture construction only.

- [ ] **Step 2: Run to verify failure**

Run: `bun run test tests/schedule-status.test.js`
Expected: new block FAILS (`s.live` undefined / key stays `scheduled`).

- [ ] **Step 3: Implement**

In `src/lib/schedule-status.js`, next to `RECLASSIFIABLE_KEYS` (line ~43) add:

```js
// A live-feed sighting older than this is not proof the aircraft is airborne NOW — a
// cached board can be served minutes after the merge stamped it. 20 min = the server's
// 15-min "recent" gate plus one full board-cache staleness grace.
const LIVE_SIGHTING_MAX_AGE_S = 1200;
```

In `classifySchedStatus`, insert between the `if (!RECLASSIFIABLE_KEYS.has(base.key)) return base;` gate (line ~136) and the time-inference block that follows:

```js
  // Live-sighting reclassification (Phase 2): the aircraft was seen airborne by the live
  // feed moments ago. Stronger evidence than elapsed time, so it runs BEFORE the
  // time-inference below and carries live:true instead of presumed:true (there IS a
  // trustworthy signal — just not a provider timestamp, so still excluded from OTP
  // stats the same way presumed rows are, via the absence of time.real).
  // Never 'landed' from a sighting: a recent sighting means airborne.
  const liveSeenAtMs = Number(flight.live?.seenAt);
  if (Number.isFinite(liveSeenAtMs) && liveSeenAtMs > 0 && nowSec - liveSeenAtMs / 1000 <= LIVE_SIGHTING_MAX_AGE_S) {
    return isArr
      ? { text: 'En Route', cls: 'enroute', key: 'enroute', live: true }
      : { text: 'Departed', cls: 'departed', key: 'departed', live: true };
  }
```

Update the function's JSDoc `@returns` line to include `live?:boolean` with one sentence: "live:true marks a status confirmed by a live-feed sighting (Phase 2) — badge as LIVE, not presumed."

- [ ] **Step 4: Run the full status suites**

Run: `bun run test tests/schedule-status.test.js tests/schedule-status-dq.test.js tests/status-display.test.js tests/board-stats.test.js`
Expected: ALL pass (new + existing — the existing suites prove upgrade-only holds).

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule-status.js tests/schedule-status.test.js
git commit -m "feat(schedule): live-sighting reclassification — airborne beats time-inference, upgrade-only"
```

---

### Task 4: `api/_reg-sightings.ts` — Supabase writer/reader (TDD)

**Files:**
- Create: `api/_reg-sightings.ts`
- Test: `tests/reg-sightings.test.js`

**Interfaces:**
- Consumes: `getSupabase` from `api/_supabase.ts`; `extractSightings` from Task 2.
- Produces (Tasks 5/6 depend on exact names):
  - `recordFeedSightings(parsedFlights, nowMs?)` → `Promise<number>` (rows written; 0 on throttle/failure; **never throws**)
  - `peekRegSightings()` → `Map<string, {reg, origin, dest, seenAtMs}>` (sync, never fetches)
  - `kickRegSightingsRefresh()` → `Promise<Map>|null` (null = cache fresh)
  - `peekRegSightingsLoadedAt()` → epoch ms (0 = never loaded)
  - `shouldWriteSightings(nowMs, lastMs, minIntervalMs?)` → boolean (pure, for tests)
  - `__resetRegSightingsForTests()`

- [ ] **Step 1: Write the failing tests**

`tests/reg-sightings.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsertMock = vi.fn(async () => ({ error: null }));
const gtMock = vi.fn(async () => ({ data: [], error: null }));
vi.mock('../api/_supabase.js', () => ({
  getSupabase: () => ({
    from: () => ({
      upsert: upsertMock,
      select: () => ({ gt: gtMock }),
    }),
  }),
}));

import {
  recordFeedSightings, peekRegSightings, kickRegSightingsRefresh,
  peekRegSightingsLoadedAt, shouldWriteSightings, __resetRegSightingsForTests,
  REG_SIGHTINGS_WRITE_MIN_INTERVAL_MS,
} from '../api/_reg-sightings.js';

const FLIGHTS = [{ flightIATA: 'UA123', callsign: 'UAL123', reg: 'N12345', origin: 'ORD', dest: 'SFO' }];

beforeEach(() => {
  __resetRegSightingsForTests();
  upsertMock.mockClear();
  gtMock.mockClear();
});

describe('shouldWriteSightings', () => {
  it('throttles to one write per interval', () => {
    expect(shouldWriteSightings(1000, 0, 500)).toBe(true);
    expect(shouldWriteSightings(1000, 800, 500)).toBe(false);
    expect(shouldWriteSightings(1300, 800, 500)).toBe(true);
  });
});

describe('recordFeedSightings', () => {
  it('upserts extracted rows and reports the count', async () => {
    const n = await recordFeedSightings(FLIGHTS, 1_000_000);
    expect(n).toBe(1);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock.mock.calls[0][0][0].flight_key).toBe('UA123');
    expect(upsertMock.mock.calls[0][1]).toEqual({ onConflict: 'flight_key' });
  });
  it('throttles a second write inside the interval', async () => {
    await recordFeedSightings(FLIGHTS, 1_000_000);
    const n = await recordFeedSightings(FLIGHTS, 1_000_000 + REG_SIGHTINGS_WRITE_MIN_INTERVAL_MS - 1);
    expect(n).toBe(0);
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });
  it('writes nothing for reg-less feeds and never throws on Supabase errors', async () => {
    expect(await recordFeedSightings([{ flightIATA: 'UA1', reg: '' }], 1_000_000)).toBe(0);
    upsertMock.mockResolvedValueOnce({ error: { message: 'boom' } });
    expect(await recordFeedSightings(FLIGHTS, 1_000_000)).toBe(0);
  });
});

describe('peek + kick', () => {
  it('peek returns an empty map before any load; kick loads and caches', async () => {
    expect(peekRegSightings().size).toBe(0);
    expect(peekRegSightingsLoadedAt()).toBe(0);
    gtMock.mockResolvedValueOnce({
      data: [
        { flight_key: 'UA123', reg: 'N12345', origin: 'ORD', dest: 'SFO', seen_at: new Date(123456789).toISOString() },
        { flight_key: 'BAD', reg: '', origin: '', dest: '', seen_at: 'garbage' },
      ],
      error: null,
    });
    const p = kickRegSightingsRefresh();
    expect(p).not.toBeNull();
    const map = await p;
    expect(map.get('UA123')).toEqual({ reg: 'N12345', origin: 'ORD', dest: 'SFO', seenAtMs: 123456789 });
    expect(map.has('BAD')).toBe(false);
    expect(peekRegSightings().get('UA123').reg).toBe('N12345');
    expect(kickRegSightingsRefresh()).toBeNull(); // cache fresh → no refetch
  });
  it('a failed load caches an empty map (no hammering) and never throws', async () => {
    gtMock.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    await kickRegSightingsRefresh();
    expect(peekRegSightings().size).toBe(0);
    expect(kickRegSightingsRefresh()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test tests/reg-sightings.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`api/_reg-sightings.ts`:

```ts
// ═══ REG SIGHTINGS — server-side flight→tail ledger (Supabase) ═══
// Phase 2 (spec: docs/superpowers/specs/2026-07-04-schedule-phase2-design.md).
// WRITE: api/fr24-feed.ts (waitUntil side effect, throttled here) and the warm cron
// backstop. READ: api/schedule.ts at serve time via the same non-blocking peek+kick
// contract as the FAA disruption context (api/faa.ts kickDisruptionRefresh) — a serve
// never waits on Supabase, and every failure degrades to "no merge", never an error.

import { getSupabase } from './_supabase.js';
import { extractSightings } from '../src/lib/reg-overlay.js';

export type SightingRecord = { reg: string; origin: string; dest: string; seenAtMs: number };

const SIGHTINGS_CACHE_TTL_MS = 60_000;
const SIGHTINGS_MAX_AGE_H = 36; // matches the Phase 1 client ledger prune horizon
export const REG_SIGHTINGS_WRITE_MIN_INTERVAL_MS = 60_000;

let sightingsCache: { map: Map<string, SightingRecord>; expires: number; loadedAt: number } | null = null;
let sightingsInFlight: Promise<Map<string, SightingRecord>> | null = null;
let lastWriteAt = 0;
const EMPTY_MAP: Map<string, SightingRecord> = new Map();

/** Pure throttle decision (one upsert per instance per interval), exported for tests. */
export function shouldWriteSightings(nowMs: number, lastMs: number, minIntervalMs = REG_SIGHTINGS_WRITE_MIN_INTERVAL_MS): boolean {
  return nowMs - lastMs >= minIntervalMs;
}

/** Batch-upsert sightings from a parsed live feed. Never throws; 0 = throttled/failed/empty. */
export async function recordFeedSightings(parsedFlights: any[], nowMs = Date.now()): Promise<number> {
  try {
    if (!shouldWriteSightings(nowMs, lastWriteAt)) return 0;
    const rows = extractSightings(parsedFlights, nowMs);
    if (rows.length === 0) return 0;
    // Claim the slot BEFORE the await: concurrent polls in this instance must not double-write.
    lastWriteAt = nowMs;
    const supabase = getSupabase();
    const { error } = await supabase.from('reg_sightings').upsert(rows, { onConflict: 'flight_key' });
    if (error) {
      console.warn('reg-sightings upsert failed:', error.message);
      return 0;
    }
    return rows.length;
  } catch (e: any) {
    console.warn('reg-sightings record failed:', e?.message || e);
    return 0;
  }
}

async function fetchSightingsMap(): Promise<Map<string, SightingRecord>> {
  const map = new Map<string, SightingRecord>();
  try {
    const supabase = getSupabase();
    const cutoff = new Date(Date.now() - SIGHTINGS_MAX_AGE_H * 3600e3).toISOString();
    const { data, error } = await supabase
      .from('reg_sightings')
      .select('flight_key, reg, origin, dest, seen_at')
      .gt('seen_at', cutoff);
    if (error) throw new Error(error.message);
    for (const row of data || []) {
      const seenAtMs = Date.parse(row.seen_at);
      if (!row.flight_key || typeof row.reg !== 'string' || !row.reg || !Number.isFinite(seenAtMs)) continue;
      map.set(row.flight_key, { reg: row.reg, origin: row.origin || '', dest: row.dest || '', seenAtMs });
    }
  } catch (e: any) {
    // Cache the empty map anyway: one failed load must not turn every serve into a retry storm.
    console.warn('reg-sightings load failed (merge disabled this window):', e?.message || e);
  }
  sightingsCache = { map, expires: Date.now() + SIGHTINGS_CACHE_TTL_MS, loadedAt: Date.now() };
  return map;
}

/** Synchronous read of the cached sightings map. Never fetches; empty map when cold. */
export function peekRegSightings(): Map<string, SightingRecord> {
  return sightingsCache?.map || EMPTY_MAP;
}

/** Epoch ms of the last successful cache load (0 = never) — surfaced in board meta for debugging. */
export function peekRegSightingsLoadedAt(): number {
  return sightingsCache?.loadedAt || 0;
}

/** Returns a refresh promise when the cache is cold/expired (caller enqueues it), else null. */
export function kickRegSightingsRefresh(): Promise<Map<string, SightingRecord>> | null {
  if (sightingsCache && Date.now() < sightingsCache.expires) return null;
  if (!sightingsInFlight) {
    sightingsInFlight = fetchSightingsMap().finally(() => { sightingsInFlight = null; });
  }
  return sightingsInFlight;
}

export function __resetRegSightingsForTests(): void {
  sightingsCache = null;
  sightingsInFlight = null;
  lastWriteAt = 0;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun run test tests/reg-sightings.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add api/_reg-sightings.ts tests/reg-sightings.test.js
git commit -m "feat(schedule): _reg-sightings — throttled Supabase writer + peek/kick reader"
```

---

### Task 5: Writer hooks — `fr24-feed.ts` + warm-cron backstop

**Files:**
- Modify: `api/fr24-feed.ts`
- Modify: `api/cron/warm-schedules.ts`

**Interfaces:**
- Consumes: `recordFeedSightings` (Task 4), `parseFr24Feed` from `src/lib/feed-health.js` (exists).

- [ ] **Step 1: Hook the live-feed function**

`api/fr24-feed.ts` — add imports:

```ts
import { waitUntil } from '@vercel/functions';
import { parseFr24Feed } from '../src/lib/feed-health.js';
import { recordFeedSightings } from './_reg-sightings.js';
```

In `doFetch`, immediately after `if (countFeedAircraft(payload) === 0) throw new EmptyFeedError();` and before `return payload;`:

```ts
      // Phase 2: harvest flight→tail sightings from every FRESH feed fetch (cache hits carry
      // nothing new). Throttled inside recordFeedSightings (≤1 upsert/min/instance) and
      // fire-and-forget — sighting capture must never delay or fail the feed serve.
      const sightingsTask = recordFeedSightings(parseFr24Feed(payload));
      try { waitUntil(sightingsTask); } catch { /* waitUntil unavailable (local dev) — promise still runs best-effort */ }
```

- [ ] **Step 2: Warm-cron backstop**

`api/cron/warm-schedules.ts` — add imports:

```ts
import { parseFr24Feed } from '../../src/lib/feed-health.js';
import { recordFeedSightings } from '../_reg-sightings.js';
```

In the handler, AFTER the schedule warm loop finishes and BEFORE the starlink ping section (locate the loop over `warmPlan` and place this right after it closes):

```ts
  // Phase 2 backstop: harvest reg sightings once per fire so the ledger stays populated
  // overnight when no browser is polling /api/fr24-feed. Free upstream (public FR24 feed,
  // same endpoint fr24-feed.ts proxies); failure never fails the cron. 10s timeout keeps
  // the run inside the 300s maxDuration budget (see the budget math comment at the top).
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 10000);
    const feedRes = await fetch('https://data-cloud.flightradar24.com/zones/fcgi/feed.js?airline=UAL', {
      signal: controller.signal,
      headers: { 'User-Agent': 'TheBlueBoardDashboard/1.0 (https://theblueboard.co)', 'Accept': 'application/json' },
    });
    clearTimeout(t);
    if (feedRes.ok) {
      const recorded = await recordFeedSightings(parseFr24Feed(await feedRes.json()));
      results.regSightings = { ok: true, recorded };
    } else {
      results.regSightings = { ok: false, status: feedRes.status };
    }
  } catch (e: any) {
    console.warn('warm-schedules reg-sightings backstop failed:', e?.message || e);
    results.regSightings = { ok: false, error: String(e?.message || e) };
  }
```

Also update the budget-math comment at the top of the file (lines ~20-28): append one sentence — "Plus a ≤10s reg-sightings backstop fetch (Phase 2), keeping the worst case ≈264s."

- [ ] **Step 3: Run affected suites**

Run: `bun run test tests/fr24-feed.test.js tests/warm-schedules.test.js tests/warm-config.test.js`
Expected: ALL pass (these hooks add behavior; existing contracts unchanged). If a warm-schedules test asserts on the exact `results` shape, extend the expectation to tolerate the new `regSightings` key rather than weakening the assertion.

- [ ] **Step 4: Commit**

```bash
git add api/fr24-feed.ts api/cron/warm-schedules.ts
git commit -m "feat(schedule): sighting capture — fr24-feed waitUntil hook + warm-cron backstop"
```

---

### Task 6: Serve-time merge in `schedule.ts`

**Files:**
- Modify: `api/schedule.ts` (imports + the `withDisruption` block at ~1739-1750)

**Interfaces:**
- Consumes: `peekRegSightings`, `kickRegSightingsRefresh`, `peekRegSightingsLoadedAt` (Task 4); `applySightingsToBoard` (Task 2).
- Produces: every 200 response's `flights[]` may carry `aircraft.regSource` and `live.seenAt`; `meta.regSightingsAt` added. Task 7's client reads these.

- [ ] **Step 1: Imports**

```ts
import { peekRegSightings, kickRegSightingsRefresh, peekRegSightingsLoadedAt } from './_reg-sightings.js';
import { applySightingsToBoard } from '../src/lib/reg-overlay.js';
```

- [ ] **Step 2: Compose into the existing wrapper**

Locate (currently ~line 1745):

```ts
    const disruptionRefresh = kickDisruptionRefresh();
    if (disruptionRefresh) enqueueBackgroundTask(disruptionRefresh);
    const withDisruption = (payload: any) => ({
      ...payload,
      meta: { ...(payload?.meta || {}), hubDisruptionMinutes: peekHubDisruptionMinutes(hub) },
    });
```

Replace with:

```ts
    const disruptionRefresh = kickDisruptionRefresh();
    if (disruptionRefresh) enqueueBackgroundTask(disruptionRefresh);
    // Phase 2: reg-sightings merge, same non-blocking peek+kick contract as the FAA
    // disruption context above — a cold cache means "no merge this serve", never a wait.
    // applySightingsToBoard NEVER mutates its input (cache entries are shared objects);
    // wrapping here covers every 200 path: hot cache, stale, degraded, snapshot, fresh.
    const sightingsRefresh = kickRegSightingsRefresh();
    if (sightingsRefresh) enqueueBackgroundTask(sightingsRefresh);
    const withDisruption = (payload: any) => ({
      ...applySightingsToBoard(payload, peekRegSightings(), Date.now()),
      meta: {
        ...(payload?.meta || {}),
        hubDisruptionMinutes: peekHubDisruptionMinutes(hub),
        regSightingsAt: peekRegSightingsLoadedAt() || undefined,
      },
    });
```

(`applySightingsToBoard` does not touch `meta`, so spreading `payload?.meta` stays correct.)

- [ ] **Step 3: Run the schedule suites**

Run: `bun run test tests/schedule.test.js tests/schedule-meta-disruption.test.js tests/schedule-snapshots.test.js`
Expected: ALL pass. If a meta test asserts exact meta keys, extend for `regSightingsAt` (undefined when cold — JSON.stringify drops it, so most assertions won't notice).

- [ ] **Step 4: Commit**

```bash
git add api/schedule.ts
git commit -m "feat(schedule): serve-time sighting merge — tails + live flags on every board response"
```

---

### Task 7: Client display — LIVE chip + regSource tooltip

**Files:**
- Modify: `src/lib/status-display.js` (ensure `live` flag passes through)
- Modify: `src/dashboard/main.js` (status cell ~5112; `regFromLive` ~4992)
- Modify: `public/css/style.css` (new `.sched-live-chip` rule near `.sched-status` styles)

**Interfaces:**
- Consumes: `statusDisp.live` (Task 3), `fl.aircraft.regSource` / `fl.live` (Task 6).

- [ ] **Step 1: status-display passthrough**

Read `src/lib/status-display.js` `displayScheduleStatus` (line ~48): if it returns reconstructed objects (rather than spreading the input), ensure the returned object carries `live: status.live` through every branch that can receive a reclassified status. If it already spreads/returns the input object for non-special cases, no change — verify with the Task 3 test for `statusDisp.live` (add one assertion to `tests/status-display.test.js`):

```js
it('passes the live flag through (Phase 2)', () => {
  const disp = displayScheduleStatus({ text: 'Departed', cls: 'departed', key: 'departed', live: true });
  expect(disp.live).toBe(true);
});
```

- [ ] **Step 2: Status cell chip**

`src/dashboard/main.js` — locate (~line 5109):

```js
    const presumedTip = statusDisp.presumed
```

and the two lines below it building `statusCell`. Replace the `statusCell` construction with:

```js
    let statusCell = `<span class="sched-status ${escapeHtml(statusDisp.cls)}"${statusDisp.live ? ' title="Aircraft seen airborne by live flight tracking"' : presumedTip}>${escapeHtml(statusDisp.text)}${statusDisp.presumed ? '*' : ''}</span>${statusDisp.live ? '<span class="sched-live-chip">LIVE</span>' : ''}`;
```

(Everything else — the `asOf` line, `faaContext` — unchanged.)

- [ ] **Step 3: regSource tooltip**

`src/dashboard/main.js` — locate (~line 4992):

```js
    const regFromLive = reg !== '—' && !fl.aircraft?.registration;
```

Replace with:

```js
    // Server-merged tails arrive IN aircraft.registration tagged regSource:'live_feed';
    // client-ledger fills leave registration empty. Both get the honesty tooltip.
    const regFromLive = reg !== '—' && (!fl.aircraft?.registration || fl.aircraft?.regSource === 'live_feed');
```

- [ ] **Step 4: CSS**

`public/css/style.css` — add directly after the `.sched-status` rule block (grep `.sched-status{`):

```css
.sched-live-chip{margin-left:4px;padding:1px 4px;border-radius:3px;background:rgba(34,197,94,.15);color:var(--ua-green);font-family:var(--font-mono);font-size:8px;font-weight:700;letter-spacing:.5px;vertical-align:middle}
```

- [ ] **Step 5: Run full gates**

Run: `bun run test && bun run typecheck && bun run build`
Expected: green / clean / success.

- [ ] **Step 6: Commit**

```bash
git add src/lib/status-display.js src/dashboard/main.js public/css/style.css tests/status-display.test.js
git commit -m "feat(schedule): LIVE status chip + server-merged tail tooltip"
```

---

### Task 8: CHANGELOG + version

**Files:**
- Modify: `CHANGELOG.md`, `package.json`

- [ ] **Step 1: CHANGELOG entry**

Top of file, following the `## [x.y.z] - date` / `### Added` / `### Fixed` format:

```markdown
## [1.6.0] - 2026-07-04

### Added
- Schedule: server-side registration ledger — every user now sees tails harvested from live flight tracking (Supabase `reg_sightings`, written from the live-feed function + hourly cron backstop, merged into every board response; provider values never overwritten)
- Schedule: LIVE status overlay — a row still marked "Scheduled" whose aircraft was seen airborne in the last 15 minutes now shows "Departed · LIVE" (departures) or "En Route · LIVE" (arrivals); upgrade-only, never touches canceled/landed/diverted rows, and stat counts stay reconciled with visible rows
```

- [ ] **Step 2: Version bump**

`package.json`: `"version": "1.5.27"` → `"version": "1.6.0"` (new capability, not a fix).

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md package.json
git commit -m "chore: bump to v1.6.0 — schedule Phase 2"
```

---

## Ship checklist (orchestrator, not agents)

1. Apply `sql/013_reg_sightings.sql` in the Supabase SQL editor (Blue Board project) BEFORE merging — the code degrades gracefully without it, but merging first means a window of "load failed" warnings.
2. Full gates + headless smoke (app boots, schedule tab renders, no new console exceptions).
3. Push branch, PR, owner merges (merge = prod deploy).
4. Post-deploy: confirm `reg_sightings` rows appear (Supabase table editor) and a board response carries `meta.regSightingsAt`.
