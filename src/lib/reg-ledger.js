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
export function lookupReg(ledger, flightNumRaw, schedDepSec, schedArrSec) {
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
