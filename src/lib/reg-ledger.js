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
//
// A flight number can fly several legs in one day (SAN→SFO→ORD), so a sighting is also tied
// to its LEG (F15): it is keyed `UA123|SAN|SFO` when the live feed knows the route, and a
// row only takes a tail seen on its own origin/destination. A sighting with no route is
// keyed by the bare number and matches any leg, exactly as the server's reg-overlay does.

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

const code = (v) => String(v || '').trim().toUpperCase();

/** 'UA123' + route → the ledger key: `UA123|SAN|SFO`, or `UA123` when the route is unknown. */
export function ledgerKey(flightNum, origin, dest) {
  const o = code(origin);
  const d = code(dest);
  return o && d ? `${flightNum}|${o}|${d}` : flightNum;
}

/** Record every reg-carrying live flight. Mutates ledger; latest sighting per leg wins. */
export function recordSightings(ledger, flights, nowMs) {
  if (!ledger || !Array.isArray(flights)) return;
  for (const f of flights) {
    if (!f || !f.reg) continue;
    const num = normalizeFlightNum(f.flightIATA) || normalizeFlightNum(f.callsign);
    if (!num) continue;
    const key = ledgerKey(num, f.origin, f.dest);
    ledger[key] = key === num
      ? { reg: f.reg, seenAt: nowMs }
      : { reg: f.reg, seenAt: nowMs, origin: code(f.origin), dest: code(f.dest) };
  }
}

/** Does a ledger entry's leg fit the row's? Only a side both of them know can disagree. */
function legFits(entry, origin, dest) {
  const o = code(origin);
  const d = code(dest);
  if (entry.origin && o && entry.origin !== o) return false;
  if (entry.dest && d && entry.dest !== d) return false;
  return true;
}

/**
 * Backfill lookup for one schedule row. Times in unix SECONDS (schedule feed shape). `origin`
 * and `dest` are the row's leg (IATA); when both are known only that leg's sighting — or a
 * route-less one — can fill it, so another leg flown under the same number never does (F15).
 */
export function lookupReg(ledger, flightNumRaw, schedDepSec, schedArrSec, origin = '', dest = '') {
  const num = normalizeFlightNum(flightNumRaw);
  if (!num || !ledger) return null;
  const dep = Number(schedDepSec) * 1000;
  if (!Number.isFinite(dep) || dep <= 0) return null; // can't tie a sighting to an unscheduled row
  const arr = Number(schedArrSec) > 0 ? Number(schedArrSec) * 1000 : dep + DEFAULT_FLIGHT_SPAN_MS;
  const inWindow = (entry) => {
    const seen = entry ? Number(entry.seenAt) : NaN;
    if (!entry || typeof entry.reg !== 'string' || !entry.reg || !Number.isFinite(seen)) return false;
    return seen >= dep - SIGHTING_BEFORE_DEP_MS && seen <= arr + SIGHTING_AFTER_ARR_MS;
  };

  const exact = ledgerKey(num, origin, dest);
  // Both ends known: this leg's own key, then the route-less sighting. No scan needed.
  const candidates = exact !== num
    ? [ledger[exact], ledger[num]]
    : Object.keys(ledger)
      .filter((k) => k === num || k.startsWith(`${num}|`))
      .map((k) => ledger[k])
      .sort((a, b) => Number(b?.seenAt) - Number(a?.seenAt));
  for (const entry of candidates) {
    if (entry && legFits(entry, origin, dest) && inWindow(entry)) return entry.reg;
  }
  return null;
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
        if (typeof v.origin === 'string' && v.origin) out[k].origin = v.origin;
        if (typeof v.dest === 'string' && v.dest) out[k].dest = v.dest;
      }
    }
    return out;
  } catch {
    return {};
  }
}
