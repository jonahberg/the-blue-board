# Jul 4 Punch List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Honest stale-board copy, violet Starlink markers (no glow), IROPS severity label instead of 0–100 score, radar map framed to CONUS, and client-side registration backfill on the schedule board.

**Architecture:** Four surgical edits in `src/dashboard/main.js` / `public/` plus one new pure-function module `src/lib/reg-ledger.js` (tested with vitest) that main.js wires to the live-feed poll and the schedule row renderer.

**Tech Stack:** Vanilla JS dashboard (`src/dashboard/main.js`), Leaflet, vitest via `bun run test`, Vercel deploy.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-04-punchlist-design.md`
- Tests: `bun run test` (vitest) — NEVER bare `bun test` (repo CLAUDE.md).
- Gates before PR: `bun run test`, `bun run typecheck`, `bun run build`.
- The numeric IROPS score must keep flowing to `lastIropsScore` → `updateTicker()` (ticker gating).
- Starlink violet is `#A78BFA`; fill-priority: watched green → Starlink violet → long-haul amber → phase.
- Reg backfill is client-side only; provider-supplied registrations are never overwritten.

---

### Task 1: Banner copy — retire "live updates paused"

**Files:**
- Modify: `src/dashboard/main.js:4628-4644` (three template strings + stale comment)

**Interfaces:** none (display strings only).

- [ ] **Step 1: Replace the three strings**

In the schedule banner builder (search `live updates paused`), change:

```js
        // Absolute time + consequence, not just a relative age: "from 2h ago" made users do
        // clock math and never said what it MEANS. "Statuses as of 7:12 PM CDT — showing the
        // latest data we have" states both without implying an intentional, resumable stop
        // (owner Jul 4 2026: "paused" read as dishonest). != null (not truthiness): a
        // just-written snapshot has dataAge 0, which must still render with age context.
        const age = formatDataAge(meta.dataAge);
        const asOf = formatBoardAsOf();
        msg = result.partial
          ? `Statuses as of ${asOf} (partial board, ${age} old) — showing the latest data we have.`
          : `Statuses as of ${asOf} (${age} old) — showing the latest data we have.`;
```

and in the `result.stale` branch:

```js
        msg = `Statuses as of ${formatBoardAsOf()} (${formatDataAge(meta.dataAge)} old) — showing the latest data we have.`;
```

- [ ] **Step 2: Verify no occurrence remains**

Run: `grep -rn "live updates paused" src/ public/ api/ tests/`
Expected: no matches.

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/main.js
git commit -m "fix(schedule): stale-board banner says 'showing the latest data we have', not 'live updates paused'"
```

---

### Task 2: Starlink markers — violet fill, no glow halo

**Files:**
- Modify: `src/dashboard/main.js:1198-1215` (`createPlaneIcon`)
- Modify: `public/css/style.css:128` (`.map-legend-dot-starlink`)
- Modify: `DESIGN.md` (add violet to color tokens)

**Interfaces:**
- `createPlaneIcon(hdg, isLonghaul, phase, isWatched, isStarlink)` signature unchanged; cache key already includes `isStarlink`.

- [ ] **Step 1: Change fill priority and drop the halo**

Replace the color/filter block in `createPlaneIcon`:

```js
  // Starlink marker treatment: distinct violet FILL, no glow halo (owner Jul 4 2026 — the
  // stacked drop-shadow "orb" look is gone). Fill priority: watched green → Starlink violet
  // → long-haul amber → phase color. Accepted trade-off: phase color is not visible on
  // Starlink aircraft — the popup and the Starlink-only filter still carry it.
  const color = isWatched ? '#22c55e'
    : isStarlink ? '#A78BFA'
    : isLonghaul ? '#fbbf24'
    : (phase === 'Ground' ? '#64748B' : '#6BAAED');
  const size = isWatched ? 16 : (isLonghaul ? 14 : 10);
  const filter = `drop-shadow(0 0 2px ${color})`;
```

(The old `isStarlink ? drop-shadow(...)×3 : ...` ternary is deleted; every marker keeps the single 2px legibility shadow in its own color.)

- [ ] **Step 2: Update the map legend dot**

`public/css/style.css` line 128 — replace:

```css
.map-legend-dot-starlink{background:#A78BFA}
```

(was amber `#fbbf24` with a two-layer glow `box-shadow`).

- [ ] **Step 3: Record the token in DESIGN.md**

Add a row to the Color Tokens table after `--ua-amber-soft`:

```markdown
| `--ua-violet` | `#A78BFA` | Starlink-equipped aircraft markers on maps. Owner-approved Jul 4 2026. Not for text or buttons. |
```

- [ ] **Step 4: Verify no stale glow references**

Run: `grep -n "fbbf24" src/dashboard/main.js public/css/style.css | grep -i starlink`
Expected: no matches (long-haul amber `#fbbf24` elsewhere is fine).

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/main.js public/css/style.css DESIGN.md
git commit -m "feat(map): starlink aircraft render violet, glow halo removed"
```

---

### Task 3: IROPS 0–100 score → severity label

**Files:**
- Modify: `src/dashboard/main.js:5775-5786` (client-computed bar in `updateIrops`)
- Modify: `src/dashboard/main.js:5876-5884` (API-fed bar)

**Interfaces:**
- `lastIropsScore` assignments (`main.js:5811`, `main.js:5898`) and `updateTicker()` calls are UNTOUCHED.

- [ ] **Step 1: Client-computed site**

Replace label derivation + chip line (keep `score`/`scoreCls` computation):

```js
  const scoreLabel = score < 5 ? 'NORMAL OPERATIONS' : score < 15 ? 'MINOR DISRUPTION' : 'SIGNIFICANT DISRUPTION';
```

```js
  // Plain-language severity instead of a bare 0-100 index (owner Jul 4 2026: the number
  // wasn't helpful). The numeric score is still computed below for the ticker's gating.
  html += `<span class="irops-bar-item"><span class="irops-score ${scoreCls}" style="font-size:12px;padding:2px 8px">${scoreLabel}</span><span class="hh-info">?<span class="hh-tooltip">Severity from weighted cancellations, 60min+ delays and diversions per 100 scheduled flights: Normal · Minor · Significant.</span></span></span>`;
```

(The adjacent `<span class="irops-bar-label">${scoreLabel}</span>` is removed — the chip IS the label now.)

- [ ] **Step 2: API-fed site**

Same two changes at the second render site (`const score = data.score;` block): same `scoreLabel` ternary, same chip HTML, drop the old bar-label span.

- [ ] **Step 3: Verify**

Run: `grep -n "/100" src/dashboard/main.js`
Expected: no IROPS chip matches. Run `grep -n "lastIropsScore = Number(score)" src/dashboard/main.js` — expected: still 2 matches.

- [ ] **Step 4: Commit**

```bash
git add src/dashboard/main.js
git commit -m "feat(delays): IROPS chip shows severity label instead of 0-100 score (ticker gating unchanged)"
```

---

### Task 4: Radar map zoom 3 → 4

**Files:**
- Modify: `src/dashboard/main.js:3717`

- [ ] **Step 1: Change zoom**

```js
  radarMap = L.map('radar-map', {center:[39,-97],zoom:4,zoomControl:false});
```

- [ ] **Step 2: Commit**

```bash
git add src/dashboard/main.js
git commit -m "fix(delays): radar map opens at zoom 4 — CONUS framing, matches live ops map"
```

---

### Task 5: `src/lib/reg-ledger.js` — pure functions + tests (TDD)

**Files:**
- Create: `src/lib/reg-ledger.js`
- Test: `tests/reg-ledger.test.js`

**Interfaces (Produces — Task 6 depends on these exact names):**
- `normalizeFlightNum(raw: any): string | null` — `'UA 0123'`/`'UAL123'` → `'UA123'`; non-UA/garbage → `null`
- `recordSightings(ledger: object, flights: Array<{flightIATA?, callsign?, reg?}>, nowMs: number): void` — mutates `ledger[key] = {reg, seenAt}`
- `lookupReg(ledger: object, flightNumRaw: any, schedDepSec: number, schedArrSec: number|null|undefined, nowMs?: number): string | null`
- `pruneLedger(ledger: object, nowMs: number): void` — drops entries older than 36h, caps at 1500 newest
- `deserializeLedger(json: string|null): object` — `{}` on any garbage

- [ ] **Step 1: Write the failing tests**

`tests/reg-ledger.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  normalizeFlightNum, recordSightings, lookupReg, pruneLedger, deserializeLedger,
} from '../src/lib/reg-ledger.js';

const H = 3600e3;

describe('normalizeFlightNum', () => {
  it('normalizes UA/UAL variants with spaces and leading zeros', () => {
    expect(normalizeFlightNum('UA123')).toBe('UA123');
    expect(normalizeFlightNum('ua 123')).toBe('UA123');
    expect(normalizeFlightNum('UAL0123')).toBe('UA123');
    expect(normalizeFlightNum('UA 0042')).toBe('UA42');
  });
  it('rejects non-mainline and garbage', () => {
    expect(normalizeFlightNum('G7929')).toBeNull();   // United Express operator ident
    expect(normalizeFlightNum('NK3005')).toBeNull();
    expect(normalizeFlightNum('UA')).toBeNull();
    expect(normalizeFlightNum('')).toBeNull();
    expect(normalizeFlightNum(null)).toBeNull();
    expect(normalizeFlightNum('UA12345')).toBeNull(); // >4 digits
  });
});

describe('recordSightings', () => {
  it('records by flightIATA, falls back to callsign, skips reg-less flights', () => {
    const ledger = {};
    recordSightings(ledger, [
      { flightIATA: 'UA123', callsign: 'UAL123', reg: 'N12345' },
      { flightIATA: '', callsign: 'UAL456', reg: 'N45678' },
      { flightIATA: 'UA789', callsign: 'UAL789', reg: '' },
    ], 1000);
    expect(ledger.UA123).toEqual({ reg: 'N12345', seenAt: 1000 });
    expect(ledger.UA456).toEqual({ reg: 'N45678', seenAt: 1000 });
    expect(ledger.UA789).toBeUndefined();
  });
  it('latest sighting wins', () => {
    const ledger = { UA123: { reg: 'N11111', seenAt: 1000 } };
    recordSightings(ledger, [{ flightIATA: 'UA123', reg: 'N22222' }], 2000);
    expect(ledger.UA123).toEqual({ reg: 'N22222', seenAt: 2000 });
  });
});

describe('lookupReg — sighting must fall inside this flight instance', () => {
  const dep = 1_750_000_000;            // scheduled departure (unix seconds)
  const arr = dep + 4 * 3600;           // scheduled arrival
  const ledgerAt = (seenAt) => ({ UA123: { reg: 'N12345', seenAt } });

  it('fills when seen between departure and arrival', () => {
    expect(lookupReg(ledgerAt(dep * 1000 + H), 'UA 123', dep, arr)).toBe('N12345');
  });
  it('allows taxi-out (2h before dep) and post-arrival (3h after)', () => {
    expect(lookupReg(ledgerAt(dep * 1000 - 1.9 * H), 'UA123', dep, arr)).toBe('N12345');
    expect(lookupReg(ledgerAt(arr * 1000 + 2.9 * H), 'UA123', dep, arr)).toBe('N12345');
  });
  it("never pins another day's tail on this flight number", () => {
    expect(lookupReg(ledgerAt(dep * 1000 - 24 * H), 'UA123', dep, arr)).toBeNull();
    expect(lookupReg(ledgerAt(arr * 1000 + 24 * H), 'UA123', dep, arr)).toBeNull();
  });
  it('uses a 16h span when arrival is missing', () => {
    expect(lookupReg(ledgerAt(dep * 1000 + 10 * H), 'UA123', dep, null)).toBe('N12345');
    expect(lookupReg(ledgerAt(dep * 1000 + 20 * H), 'UA123', dep, null)).toBeNull();
  });
  it('returns null without a scheduled departure, unknown key, or malformed entry', () => {
    expect(lookupReg(ledgerAt(dep * 1000), 'UA123', 0, arr)).toBeNull();
    expect(lookupReg({}, 'UA123', dep, arr)).toBeNull();
    expect(lookupReg({ UA123: { reg: 'N1', seenAt: 'nope' } }, 'UA123', dep, arr)).toBeNull();
  });
});

describe('pruneLedger', () => {
  it('drops entries older than 36h and caps at 1500 newest', () => {
    const now = 100 * H;
    const ledger = { OLD: { reg: 'N1', seenAt: now - 37 * H }, NEW: { reg: 'N2', seenAt: now - H } };
    for (let i = 0; i < 1600; i++) ledger[`UA${i}`] = { reg: 'N3', seenAt: now - 2 * H - i };
    pruneLedger(ledger, now);
    expect(ledger.OLD).toBeUndefined();
    expect(ledger.NEW).toBeDefined();
    expect(Object.keys(ledger).length).toBe(1500);
  });
});

describe('deserializeLedger', () => {
  it('round-trips valid entries and rejects malformed ones', () => {
    const json = JSON.stringify({
      UA123: { reg: 'N12345', seenAt: 1000 },
      BAD1: { reg: 42, seenAt: 1000 },
      BAD2: { reg: 'N1' },
    });
    expect(deserializeLedger(json)).toEqual({ UA123: { reg: 'N12345', seenAt: 1000 } });
  });
  it('returns {} for garbage, arrays, null', () => {
    expect(deserializeLedger('not json')).toEqual({});
    expect(deserializeLedger('[1,2]')).toEqual({});
    expect(deserializeLedger(null)).toEqual({});
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun run test tests/reg-ledger.test.js`
Expected: FAIL — cannot resolve `../src/lib/reg-ledger.js`.

- [ ] **Step 3: Implement**

`src/lib/reg-ledger.js`:

```js
// ═══ SEEN-TODAY REGISTRATION LEDGER ═══
// The AeroDataBox schedule feed frequently omits tail numbers — including for flights the
// live FR24 feed is tracking with a known registration in the SAME browser session (owner
// Jul 4 2026: "missing so many registration numbers for planes that have already departed").
// These pure helpers let the dashboard record flightNumber → {reg, seenAt} on every live
// feed poll and backfill blank schedule rows, client-side, zero API spend.
//
// Guard model: a ledger entry only fills a schedule row when the sighting happened during
// THAT flight instance's operation window (2h before scheduled departure, through 3h after
// scheduled arrival; 16h assumed span when arrival is unknown). This ties the tail to the
// specific instance instead of "same day" bookkeeping — red-eyes crossing midnight work,
// and yesterday's tail can never pin to today's same flight number.

export const SIGHTING_BEFORE_DEP_MS = 2 * 3600e3;   // taxi-out / early feed pickup
export const SIGHTING_AFTER_ARR_MS = 3 * 3600e3;    // late feed dropout after landing
export const DEFAULT_FLIGHT_SPAN_MS = 16 * 3600e3;  // when scheduled arrival is unknown
export const LEDGER_MAX_AGE_MS = 36 * 3600e3;
export const LEDGER_MAX_ENTRIES = 1500;

/**
 * 'UA 0123' / 'UAL123' / 'ua123' → 'UA123'. Mainline only: the live feed is queried as
 * UAL, so regional operating idents (G7/OO/YX…) never appear in it — rejecting them here
 * keeps a G7929 schedule row from matching nothing silently. Returns null when unmatched.
 */
export function normalizeFlightNum(raw) {
  const s = String(raw || '').toUpperCase().replace(/[\s-]/g, '');
  const m = s.match(/^(?:UA|UAL)0*(\d{1,4})$/);
  return m ? `UA${m[1]}` : null;
}

/** Record every reg-carrying live flight. Mutates ledger; latest sighting wins. */
export function recordSightings(ledger, flights, nowMs) {
  if (!ledger || !Array.isArray(flights)) return;
  for (const f of flights) {
    if (!f || !f.reg) continue;
    const key = normalizeFlightNum(f.flightIATA) || normalizeFlightNum(f.callsign);
    if (!key) continue;
    ledger[key] = { reg: f.reg, seenAt: nowMs };
  }
}

/** Backfill lookup for one schedule row. Times in unix SECONDS (schedule feed shape). */
export function lookupReg(ledger, flightNumRaw, schedDepSec, schedArrSec, nowMs = 0) {
  const key = normalizeFlightNum(flightNumRaw);
  if (!key) return null;
  const entry = ledger ? ledger[key] : null;
  const seen = entry ? Number(entry.seenAt) : NaN;
  if (!entry || typeof entry.reg !== 'string' || !entry.reg || !Number.isFinite(seen)) return null;
  const dep = Number(schedDepSec) * 1000;
  if (!Number.isFinite(dep) || dep <= 0) return null; // can't tie a sighting to an unscheduled row
  const arr = Number(schedArrSec) > 0 ? Number(schedArrSec) * 1000 : dep + DEFAULT_FLIGHT_SPAN_MS;
  if (seen < dep - SIGHTING_BEFORE_DEP_MS || seen > arr + SIGHTING_AFTER_ARR_MS) return null;
  return entry.reg;
}

/** Age out entries >36h and cap at the 1500 newest. Mutates ledger. */
export function pruneLedger(ledger, nowMs) {
  if (!ledger) return;
  for (const [k, v] of Object.entries(ledger)) {
    if (!v || !Number.isFinite(Number(v.seenAt)) || nowMs - Number(v.seenAt) > LEDGER_MAX_AGE_MS) delete ledger[k];
  }
  const keys = Object.keys(ledger);
  if (keys.length > LEDGER_MAX_ENTRIES) {
    keys.sort((a, b) => Number(ledger[b].seenAt) - Number(ledger[a].seenAt));
    for (const k of keys.slice(LEDGER_MAX_ENTRIES)) delete ledger[k];
  }
}

/** localStorage → ledger. Malformed JSON, arrays, or bad entries → {} / dropped. */
export function deserializeLedger(json) {
  try {
    const obj = JSON.parse(json || '{}');
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v.reg === 'string' && v.reg && Number.isFinite(Number(v.seenAt))) {
        out[k] = { reg: v.reg, seenAt: Number(v.seenAt) };
      }
    }
    return out;
  } catch {
    return {};
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `bun run test tests/reg-ledger.test.js`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/lib/reg-ledger.js tests/reg-ledger.test.js
git commit -m "feat(schedule): reg-ledger — pure helpers for live-feed tail backfill"
```

---

### Task 6: Wire the ledger into main.js

**Files:**
- Modify: `src/dashboard/main.js` (imports ~line 12; feed commit ~line 1092; schedule row renderer ~line 4963)

**Interfaces:**
- Consumes: `recordSightings`, `lookupReg`, `pruneLedger`, `deserializeLedger` from Task 5.
- Live flights shape: `{ flightIATA, callsign, reg }` (from `parseFr24Feed`).
- Schedule row shape: `fl.identification.number.default`, `fl.time.scheduled.departure/arrival` (unix seconds), `fl.aircraft.registration`.

- [ ] **Step 1: Import + module state**

Next to the existing `../lib/` imports at the top of `src/dashboard/main.js`:

```js
import { recordSightings, lookupReg, pruneLedger, deserializeLedger } from '../lib/reg-ledger.js';
```

Below the other module-level state (near `let allFlights`):

```js
// Seen-today reg ledger: flightNumber → {reg, seenAt} harvested from every live-feed poll,
// used to backfill blank schedule-board registrations (see src/lib/reg-ledger.js).
const REG_LEDGER_KEY = 'bb_reg_ledger_v1';
let regLedger = {};
try { regLedger = deserializeLedger(localStorage.getItem(REG_LEDGER_KEY)); } catch (e) { regLedger = {}; }
function recordRegSightings(flights) {
  recordSightings(regLedger, flights, Date.now());
  pruneLedger(regLedger, Date.now());
  try { localStorage.setItem(REG_LEDGER_KEY, JSON.stringify(regLedger)); } catch (e) { /* private mode / quota */ }
}
```

- [ ] **Step 2: Record on every successful feed commit**

In `refreshFlights()`, immediately after `allFlights = result.flights;`:

```js
    allFlights = result.flights;
    recordRegSightings(allFlights);
```

- [ ] **Step 3: Backfill in the schedule row renderer**

Replace `const reg = fl.aircraft?.registration || '—';` (in `renderScheduleTable`'s row loop) with:

```js
    // Provider reg first, ALWAYS. When the schedule feed omitted the tail, fall back to the
    // live-feed ledger — a currently-airborne flight fills from this poll's sighting, a
    // departed one from whenever a session saw it airborne. A filled reg also unlocks the
    // FLEET_BY_REG enrichment below (type, Starlink ⚡, special livery) for free.
    let reg = fl.aircraft?.registration || '';
    let regFromLive = false;
    if (!reg) {
      const filled = lookupReg(regLedger, fl.identification?.number?.default,
        fl.time?.scheduled?.departure, fl.time?.scheduled?.arrival, Date.now());
      if (filled) { reg = filled; regFromLive = true; }
    }
    if (!reg) reg = '—';
```

- [ ] **Step 4: Mark backfilled tails honestly**

In the same row template, the registration cell (`<td style="font-family:var(--font-mono);font-size:10px">…`) gets a title on the link when backfilled — change the reg span to:

```js
${reg !== '—' ? `<span class="ac-reg-link" data-action="aircraft-detail" data-reg="${escapeHtml(reg)}"${regFromLive ? ' title="Tail from live flight tracking (not in the schedule feed)"' : ''}>${escapeHtml(reg)}</span>` : '—'}
```

- [ ] **Step 5: Gates**

Run: `bun run test` → all pass. `bun run typecheck` → clean. `bun run build` → succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/main.js
git commit -m "feat(schedule): backfill missing registrations from the live-feed reg ledger"
```

---

### Task 7: Full gates + CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (new entry, follow existing format)

- [ ] **Step 1: Run all three gates**

Run: `bun run test && bun run typecheck && bun run build`
Expected: green / clean / success.

- [ ] **Step 2: CHANGELOG entry**

Follow the existing top-of-file format (see current entries for the version pattern; the version bump itself is handled at ship time):

```markdown
- Schedule: blank registrations backfill from live flight tracking (seen-today ledger; provider values never overwritten)
- Schedule: stale-board banner now says "showing the latest data we have" instead of "live updates paused"
- Live Ops: Starlink aircraft render violet (#A78BFA) — glow halo removed
- Delays: IROPS chip shows plain-language severity (Normal/Minor/Significant) instead of a 0–100 score; radar map opens framed to CONUS
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog for Jul 4 punch list"
```
