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
import { liveArrivalEstimate } from './my-flights.js';

/**
 * An AIRBORNE fix this recent means "airborne right now" → rows get live:{seenAt}. Since v1.12.1 the
 * fix must be airborne (`airborneAtMs`) and the sighting's latest word: a parked or landed aircraft
 * with its transponder on is "seen", not live (Oct 4 2026 audit: 28–42 wrong LIVE badges).
 */
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
 * The airborne fix of THIS flight instance, or null: the sighting's `airborneAtMs` when it passes
 * the instance gate described above (every sightingMatchesFlight() guard, airborne no earlier than
 * 15 min before the scheduled departure and no later than 18h after it, origin present and equal to
 * the row's, and on an arrivals board the destination too). It says the aircraft flew this leg; it
 * says nothing about whether it is still in the air (see isAirborneNow()).
 *
 * @param {{reg:string, origin?:string, dest?:string, seenAtMs:number, airborneAtMs?:number|null}} sighting
 * @param {object} flight  a board row.
 * @param {'departures'|'arrivals'} dir
 * @returns {number|null} epoch ms.
 */
export function instanceAirborneAt(sighting, flight, dir) {
  const board = boardDirection(dir);
  if (!board || !sightingMatchesFlight(sighting, flight)) return null;
  const airborne = Number(sighting.airborneAtMs);
  if (sighting.airborneAtMs == null || !Number.isFinite(airborne) || airborne <= 0) return null;
  const dep = Number(flight.time.scheduled.departure) * 1000; // sightingMatchesFlight guarantees it
  if (airborne < dep - SEEN_AIRBORNE_BEFORE_DEP_MS || airborne > dep + SEEN_AIRBORNE_AFTER_DEP_MS) return null;
  const so = String(sighting.origin || '').toUpperCase();
  const fo = String(flight.airport?.origin?.code?.iata || '').toUpperCase();
  if (!so || so !== fo) return null;
  if (board === 'arrivals') {
    const sd = String(sighting.dest || '').toUpperCase();
    const fd = String(flight.airport?.destination?.code?.iata || '').toUpperCase();
    if (!sd || sd !== fd) return null;
  }
  return airborne;
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
  if (sighting?.onGround === true) return false;
  return instanceAirborneAt(sighting, flight, dir) != null;
}

// ── Airborne NOW vs seen on the ground (v1.12.1, live audit Oct 4 2026) ──
// The LIVE badge used to mean "any sighting under 15 min old", so a parked or landed aircraft with
// its transponder on read "Departed · LIVE" / "En Route · LIVE": ORD UA303, UA2048, UA1922, UA6000
// and UA2059 had landed 19:34–19:54 CDT and still said En Route · LIVE, SFO UA1151 sat at 0 kt as
// "Departed · LIVE", and UA845 to GRU read Departed · LIVE 1h40m before its departure. The rules now:
//   - LIVE needs the sighting's LATEST word to be airborne (`airborneAtMs >= seenAtMs`; the server
//     writer stamps both on an airborne poll and only `seen_at` on a ground one), that fix inside this
//     instance (instanceAirborneAt) and under LIVE_RECENT_MS old;
//   - a sighting that is newer than a row's LIVE stamp and is not airborne-now clears the stamp (the
//     browser re-overlays boards the CDN cached with the server's stamps);
//   - an aircraft that flew this leg and was LATER seen on the ground at a plausible arrival time has
//     landed: `_source.track.landed`, which the classifier shows as Landed* "seen on the ground".
//     Only a sighting with a prior airborne fix can say that: the server's reg_sightings row (airborne
//     time kept when the ground poll updates `seen_at`), or the browser's ground sighting on a row the
//     server already stamped with this instance's airborne fix.

/** Is the sighting's latest word "airborne"? Server rows: airborne_at === seen_at; feed rows: the flag. */
function isAirborneNow(sighting) {
  if (!sighting || sighting.onGround === true) return false;
  const airborne = Number(sighting.airborneAtMs);
  if (sighting.airborneAtMs == null || !Number.isFinite(airborne) || airborne <= 0) return false;
  return airborne >= Number(sighting.seenAtMs);
}

/** When the sighting last saw the aircraft on the ground, or null (its latest word is airborne). */
function groundSeenAt(sighting) {
  const seen = Number(sighting?.seenAtMs);
  if (!Number.isFinite(seen) || seen <= 0) return null;
  return isAirborneNow(sighting) ? null : seen;
}

/** Floor between the airborne fix and a ground sighting before it can count as a landing. */
const MIN_LANDING_AFTER_DEP_MS = 30 * 60e3;

/**
 * The earliest a ground sighting can be this leg's LANDING: half the scheduled block after the
 * scheduled departure (30 min when the block is unknown). An air return sooner than that is not
 * an arrival.
 */
function earliestLandingMs(flight) {
  const dep = Number(flight?.time?.scheduled?.departure) * 1000;
  const arr = Number(flight?.time?.scheduled?.arrival) * 1000;
  const half = arr > dep ? (arr - dep) / 2 : MIN_LANDING_AFTER_DEP_MS;
  return dep + Math.max(MIN_LANDING_AFTER_DEP_MS, half);
}

/**
 * This row's tracking evidence after one sighting: the prior stamp merged with what the sighting adds.
 *
 * @returns {{airborneAt:number, groundAt?:number, landed?:boolean}|null}
 */
function mergeTrack(prior, sighting, flight, dir) {
  const fix = instanceAirborneAt(sighting, flight, dir);
  const airborneAt = Math.max(Number(prior?.airborneAt) || 0, fix || 0);
  if (!airborneAt) return null;
  const track = { airborneAt };
  let groundAt = Number(prior?.groundAt) > airborneAt ? Number(prior.groundAt) : 0;
  const ground = groundSeenAt(sighting);
  // A ground sighting only says "landed HERE" when its route is this row's: on an arrivals board
  // sightingMatchesFlight() let blank codes through, so require the destination outright.
  const sd = String(sighting?.dest || '').toUpperCase();
  const fd = String(flight?.airport?.destination?.code?.iata || '').toUpperCase();
  if (ground && ground > airborneAt && sd && sd === fd) groundAt = Math.max(groundAt, ground);
  if (groundAt > airborneAt) {
    track.groundAt = groundAt;
    if (groundAt >= earliestLandingMs(flight)) track.landed = true;
  }
  return track;
}

function sameTrack(a, b) {
  if (!a || !b) return !a && !b;
  return a.airborneAt === b.airborneAt && (a.groundAt || 0) === (b.groundAt || 0) && !!a.landed === !!b.landed;
}

function sameLive(a, b) {
  if (!a || !b) return !a && !b;
  return a.seenAt === b.seenAt && (a.etaSec || 0) === (b.etaSec || 0);
}

/**
 * Feed rows → the sightings map applySightingsToBoard() takes, for a browser that has the live feed.
 * Same shape the board hook builds inline, plus the position (`lat`, `lon`, `spd`) so an arrivals row
 * that is airborne now also gets `live.etaSec`, the My Flights "ETA from live position" figure
 * (src/lib/my-flights.js liveArrivalEstimate).
 *
 * @param {Array<object>} liveFlights  parseFr24Feed() rows.
 * @param {number} liveFeedTs  when the feed was generated (epoch ms).
 * @returns {Map<string, {reg:string, origin:string, dest:string, seenAtMs:number, airborneAtMs:number|null, onGround:boolean, lat?:number, lon?:number, spd?:number}>}
 */
export function sightingsFromLiveFeed(liveFlights, liveFeedTs) {
  const map = new Map();
  if (!Array.isArray(liveFlights) || !Number.isFinite(Number(liveFeedTs))) return map;
  for (const flight of liveFlights) {
    if (!flight?.reg) continue;
    const key = normalizeFlightNum(flight.flightIATA) || normalizeFlightNum(flight.callsign);
    if (!key || map.has(key)) continue;
    map.set(key, {
      reg: flight.reg,
      origin: flight.origin || '',
      dest: flight.dest || '',
      seenAtMs: Number(liveFeedTs),
      airborneAtMs: isOnGround(flight) ? null : Number(liveFeedTs),
      onGround: flight.onGround === true,
      lat: flight.lat,
      lon: flight.lon,
      spd: flight.spd,
    });
  }
  return map;
}

/** `live.etaSec` for an arrivals row airborne now, when the sighting carries a position. */
function liveEtaSec(sighting, flight, nowMs) {
  if (!Number.isFinite(Number(sighting?.lat)) || !Number.isFinite(Number(sighting?.lon))) return 0;
  const dest = flight?.airport?.destination?.code?.iata || '';
  const est = liveArrivalEstimate(
    { lat: Number(sighting.lat), lon: Number(sighting.lon), spd: Number(sighting.spd), onGround: false },
    dest,
    nowMs,
  );
  return est ? Math.round(Date.parse(est.etaISO) / 1000) : 0;
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
 *  - records this instance's tracking evidence in `_source.track` ({airborneAt, groundAt?, landed?}):
 *    the airborne fix, a later ground sighting at the destination, and whether that is a landing;
 *  - marks a row airborne right now (`live: {seenAt, etaSec?}`) only on a recent AIRBORNE fix of this
 *    instance, and clears a LIVE stamp a newer non-airborne sighting contradicts;
 *  - rewrites a Likely Canceled row the feed saw AIRBORNE on this leg to departed, keeping the
 *    evidence in `_source.seenAirborne` ({airborneAt, seenAt, reg, origin, dest, providerStatus}).
 *    Never a departure time. Reg backfill still keys off `seenAtMs`, unchanged.
 *
 * Idempotent: an overlaid board overlays to itself (api/irops.ts re-applies it with fresher
 * sightings to boards /api/schedule already overlaid, and the browser re-applies its own feed).
 *
 * @param {any} payload  a board ({flights, dir?, …}); anything without a flights array passes through.
 * @param {Map<string, {reg:string, origin?:string, dest?:string, seenAtMs:number, airborneAtMs?:number|null, onGround?:boolean, lat?:number, lon?:number, spd?:number}>} sightingsByKey
 * @param {number} nowMs
 * @param {{dir?: 'departures'|'arrivals'}} [opts]  the board direction; wins over `payload.dir`.
 *   With neither, the tracking stamps and the seen-airborne override are skipped (fail closed).
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
    const prior = fl._source?.track || null;
    const track = dir ? mergeTrack(prior, s, fl, dir) : prior;
    const fix = dir ? instanceAirborneAt(s, fl, dir) : null;
    const airborneNow = !!fix && isAirborneNow(s) && nowMs - fix <= LIVE_RECENT_MS && !track?.landed;
    let live = fl.live;
    if (airborneNow) {
      const etaSec = dir === 'arrivals' ? liveEtaSec(s, fl, nowMs) : 0;
      live = etaSec ? { seenAt: fix, etaSec } : { seenAt: fix };
    } else if (live && (track?.landed || Number(s.seenAtMs) >= Number(live.seenAt))) {
      live = undefined; // a newer sighting does not have it in the air
    }
    const flew = !!dir && cancellationKind(fl, dir) === 'likely' && seenAirborneMatches(s, fl, dir);
    const trackChanged = !sameTrack(prior, track);
    const liveChanged = !sameLive(fl.live, live);
    if (hasProviderReg && !trackChanged && !liveChanged && !flew) return fl; // nothing to add
    changed = true;
    const next = { ...fl };
    if (!hasProviderReg) {
      next.aircraft = { ...(fl.aircraft || {}), registration: s.reg, regSource: 'live_feed' };
    }
    if (liveChanged) {
      if (live) next.live = live;
      else delete next.live;
    }
    if (trackChanged || flew) next._source = { ...(fl._source || {}) };
    if (trackChanged) next._source.track = track;
    if (flew) {
      next.status = seenDepartedStatus();
      next._source.seenAirborne = {
        airborneAt: Number(s.airborneAtMs),
        seenAt: Number(s.seenAtMs),
        reg: s.reg,
        origin: String(s.origin || '').toUpperCase(),
        dest: String(s.dest || '').toUpperCase(),
        providerStatus: 'canceled_uncertain',
      };
    }
    return next;
  });
  if (!changed) return payload;
  return { ...payload, flights };
}
