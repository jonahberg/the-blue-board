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
//
// Those guards are enough to backfill a tail number. Un-cancelling a flight needs more — see
// seenAirborneMatches() below for the stricter gate the seen-airborne override uses.

import {
  normalizeFlightNum,
  SIGHTING_BEFORE_DEP_MS,
  SIGHTING_AFTER_ARR_MS,
  DEFAULT_FLIGHT_SPAN_MS,
} from './reg-ledger.js';
import { cancellationKind } from './cancellation.js';
import { isOnGround } from './flight-phase.js';

/** A sighting this recent means "airborne right now" → rows get live:{seenAt}. */
export const LIVE_RECENT_MS = 15 * 60e3;

/**
 * Shape parsed live-feed flights (src/lib/feed-health.js parseFr24Feed output) into
 * reg_sightings upsert rows. Mainline UA only, reg required, deduped by key (first wins —
 * feed order is stable within a poll and duplicates are pathological anyway).
 *
 * Every aircraft with a reg is recorded, on the ground too: the tail ledger wants a tail as soon
 * as the aircraft is at the gate. An AIRBORNE one (the dashboard's own rule, flight-phase.js
 * isOnGround: the feed's flag or under 100 ft and 50 kt) also carries `airborne_at` — the only
 * evidence the seen-airborne override accepts (v1.12.0). A ground row has NO `airborne_at` key at
 * all, and api/_reg-sightings.ts upserts it separately, so a taxi-in after landing never erases the
 * airborne time the flight earned (a mixed upsert would write NULL into the missing column).
 *
 * @returns {Array<{flight_key:string, reg:string, origin:string, dest:string, seen_at:string, airborne_at?:string}>}
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
    const row = {
      flight_key: key,
      reg: f.reg,
      origin: String(f.origin || '').toUpperCase(),
      dest: String(f.dest || '').toUpperCase(),
      seen_at: seenAtIso,
    };
    if (!isOnGround(f)) row.airborne_at = seenAtIso;
    rows.push(row);
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

// ── Seen-airborne override (v1.12.0) ──
// AeroDataBox's CanceledUncertain ("Likely Canceled") is wrong most of the time: at 22:54Z on
// Oct 3 2026 38 of the 45 uncertain departures on the nine hub boards had been seen airborne from
// their origin after their scheduled departure, and on Sep 30 – Oct 2 the boards carried 130–150
// uncertain rows a day against 0–3 confirmed cancellations. A Likely Canceled row the live feed saw
// fly this leg is rewritten to departed, so neither the board, the IROPS index nor a watch alert
// calls it cancelled. An unseen one stays Likely Canceled — some are real.
//
// The evidence must be AIRBORNE (`airborneAtMs`, reg_sightings.airborne_at): any sighting at all
// (`seenAtMs`) would let a flight held on a taxiway with its transponder on — a ground stop — and
// then cancelled read as flown, hiding real cancellations exactly on the bad nights. A row with no
// airborne time (a ground-only sighting, or one written before the column existed) proves nothing.
//
// reg_sightings keeps only the LATEST sighting per flight number, so the gate is strict:
//   - the airborne time is no earlier than 15 min before the scheduled (gate) departure — wheels-up
//     earlier than that would need a pushback 25+ min early — and no later than 18h after it (the
//     longest United block times). An airborne time before that is a previous leg or a previous
//     day's instance: a through flight's inbound leg on final approach, for one;
//   - its origin is present and equals the row's origin (it left THIS airport), and on an arrivals
//     board its destination is present and equals the row's destination (it was coming HERE);
//   - plus every sightingMatchesFlight() guard (operation window, no contradicting route code);
//   - it is not marked on the ground (the browser's overlay passes its live feed's flag).
// Known limit: origin/dest belong to the LATEST sighting, which can be a ground sighting newer than
// the airborne time. A through flight (one number, two legs) whose late inbound leg was airborne
// within the window, whose cancelled continuation was then seen at the gate, would pass. That needs
// all four at once; not observed.
export const SEEN_AIRBORNE_BEFORE_DEP_MS = 15 * 60e3;
export const SEEN_AIRBORNE_AFTER_DEP_MS = 18 * 3600e3;

/** 'departures' | 'arrivals' | null — null means "unknown", and the override then does nothing. */
function boardDirection(dir) {
  return dir === 'departures' || dir === 'arrivals' ? dir : null;
}

/**
 * The stricter gate for un-cancelling a row (see the block comment above).
 *
 * @param {{reg:string, origin?:string, dest?:string, seenAtMs:number, airborneAtMs?:number|null, onGround?:boolean}} sighting
 * @param {object} flight  a board row.
 * @param {'departures'|'arrivals'} dir  the board's direction; anything else never matches.
 * @returns {boolean}
 */
export function seenAirborneMatches(sighting, flight, dir) {
  const board = boardDirection(dir);
  if (!board || sighting?.onGround === true || !sightingMatchesFlight(sighting, flight)) return false;
  const airborne = Number(sighting.airborneAtMs);
  if (sighting.airborneAtMs == null || !Number.isFinite(airborne) || airborne <= 0) return false;
  const dep = Number(flight.time.scheduled.departure) * 1000; // sightingMatchesFlight guarantees it
  if (airborne < dep - SEEN_AIRBORNE_BEFORE_DEP_MS || airborne > dep + SEEN_AIRBORNE_AFTER_DEP_MS) return false;
  const so = String(sighting.origin || '').toUpperCase();
  const fo = String(flight.airport?.origin?.code?.iata || '').toUpperCase();
  if (!so || so !== fo) return false;
  if (board === 'arrivals') {
    const sd = String(sighting.dest || '').toUpperCase();
    const fd = String(flight.airport?.destination?.code?.iata || '').toUpperCase();
    if (!sd || sd !== fd) return false;
  }
  return true;
}

// The status object the AeroDataBox normalizer emits for "Departed" (mapAeroStatus), minus its
// live flag: the row-level `live` field says whether it is airborne right now. Every downstream
// reader (classifier, IROPS, flight-times, the watch cron) handles this shape already.
function seenDepartedStatus() {
  return { generic: { status: { text: 'departed', diverted: false }, type: '' }, text: 'departed', icon: 'green', live: false };
}

/**
 * Serve-time board enrichment. NEVER mutates the input — cache entries are shared
 * objects; changed rows are replaced with copies, unchanged payloads return the same
 * reference (cheap no-op for the common all-provider-regs case).
 *
 *  - backfills a blank registration from the sighting (`aircraft.regSource: 'live_feed'`);
 *  - marks a row airborne right now (`live: {seenAt}`) when the sighting is recent;
 *  - rewrites a Likely Canceled row the feed saw AIRBORNE on this leg to departed, keeping the
 *    evidence in `_source.seenAirborne` ({airborneAt, seenAt, reg, origin, dest, providerStatus}).
 *    Never a departure time. Reg backfill and the LIVE flag still key off `seenAtMs`, unchanged.
 *
 * Idempotent: an overlaid board overlays to itself (api/irops.ts re-applies it with fresher
 * sightings to boards /api/schedule already overlaid).
 *
 * @param {any} payload  a board ({flights, dir?, …}); anything without a flights array passes through.
 * @param {Map<string, {reg:string, origin?:string, dest?:string, seenAtMs:number, airborneAtMs?:number|null}>} sightingsByKey
 * @param {number} nowMs
 * @param {{dir?: 'departures'|'arrivals'}} [opts]  the board direction; wins over `payload.dir`.
 *   With neither, the seen-airborne override is skipped (fail closed).
 * @returns {any} the same payload, or a copy with the changed rows replaced.
 */
export function applySightingsToBoard(payload, sightingsByKey, nowMs, opts = {}) {
  if (!payload || !Array.isArray(payload.flights) || !sightingsByKey || sightingsByKey.size === 0) return payload;
  const dir = boardDirection(opts?.dir) || boardDirection(payload.dir);
  let changed = false;
  const flights = payload.flights.map((fl) => {
    const key = normalizeFlightNum(fl?.identification?.number?.default);
    if (!key) return fl;
    const s = sightingsByKey.get(key);
    if (!s || !sightingMatchesFlight(s, fl)) return fl;
    const hasProviderReg = !!fl.aircraft?.registration;
    const isRecent = nowMs - Number(s.seenAtMs) <= LIVE_RECENT_MS;
    const flew = !!dir && cancellationKind(fl, dir) === 'likely' && seenAirborneMatches(s, fl, dir);
    if (hasProviderReg && !isRecent && !flew) return fl; // nothing to add
    changed = true;
    const next = { ...fl };
    if (!hasProviderReg) {
      next.aircraft = { ...(fl.aircraft || {}), registration: s.reg, regSource: 'live_feed' };
    }
    if (isRecent) next.live = { seenAt: Number(s.seenAtMs) };
    if (flew) {
      next.status = seenDepartedStatus();
      next._source = {
        ...(fl._source || {}),
        seenAirborne: {
          airborneAt: Number(s.airborneAtMs),
          seenAt: Number(s.seenAtMs),
          reg: s.reg,
          origin: String(s.origin || '').toUpperCase(),
          dest: String(s.dest || '').toUpperCase(),
          providerStatus: 'canceled_uncertain',
        },
      };
    }
    return next;
  });
  if (!changed) return payload;
  return { ...payload, flights };
}
