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
