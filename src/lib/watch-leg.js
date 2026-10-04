// ═══ WATCHED LEG — where one dated leg really is, from the best evidence we hold ═══
// The Oct 4 2026 audit (finding 1) caught /api/flight-times, as the watch cron calls it, answering
// "departed" for UA1630 after it had LANDED and "scheduled" for UA1351 while it was AIRBORNE. The
// departures board row it served never advances to landed, an arrivals row exists only when the
// destination is a hub, and the live feed's airborne/ground sightings were never consulted. These
// pure helpers build a leg's state from every source instead:
//
//   - mergeLegRows: the SAME leg's arrivals-board row (destination hub) lends its arrival times
//     and its further-along status to the origin's departures row.
//   - sightingLegEvidence / applyLegEvidence: reg_sightings (api/_reg-sightings.ts). An AIRBORNE
//     sighting out of this origin after the scheduled departure −15 min means departed; the latest
//     sighting being a GROUND one on this route, newer than the last airborne one and late in the
//     block, means it is on the ground at the destination — landed.
//   - resolveLegState: one /api/flight-times payload → phase, reason, delay, leg identity.
//
// No I/O, no Date.now() defaults: callers inject time.

import { SEEN_AIRBORNE_BEFORE_DEP_MS, SEEN_AIRBORNE_AFTER_DEP_MS } from './reg-overlay.js';
import { phaseOfStatusText } from './watch-rules.js';
import { cancellationKind } from './cancellation.js';

/** A ground sighting must trail the last airborne one by at least this much to count as "after". */
export const GROUND_AFTER_AIRBORNE_MS = 60e3;
/** …and by no more than this: much later, it is not the taxi-in of this leg. */
export const GROUND_AFTER_AIRBORNE_MAX_MS = 12 * 3600e3;
/**
 * The last airborne sighting must fall in the second half of the scheduled block, measured from the
 * best-known departure. A flight back on the ground EARLY — an air return, a rejected takeoff that
 * still squawked — has its last airborne time near the start of the block and is not "landed".
 */
export const LANDED_LATE_IN_BLOCK = 0.5;

const upper = (v) => String(v || '').trim().toUpperCase();

function ms(iso) {
  const t = Date.parse(String(iso || ''));
  return Number.isFinite(t) ? t : NaN;
}

function finite(n) {
  return Number.isFinite(n) ? n : NaN;
}

// ── Board rows ──

/** How far along a board row says its leg is: 0 not yet, 1 departed, 2 landed, 3 diverted. */
function rowProgress(row) {
  const generic = row?.status?.generic?.status || {};
  const text = String(generic.text || '').toLowerCase();
  if (generic.diverted) return 3;
  if (text === 'landed' || Number(row?.time?.real?.arrival) > 0) return 2;
  if (text === 'departed' || text === 'en-route' || Number(row?.time?.real?.departure) > 0) return 1;
  return 0;
}

/**
 * Merge the SAME leg's arrivals-board row (from the destination hub) into its departures-board row
 * (from the origin hub). The departures row stays the base — it owns the departure gate and times —
 * and the arrivals row, which is the only one that ever advances to landed, lends:
 *   - the arrival side: real and estimated arrival (and the scheduled one when the base lacks it);
 *   - a real departure the base never got;
 *   - its status when it is further along (landed or diverted beats departed beats not-yet), or a
 *     confirmed cancellation when the departures row shows nothing has happened;
 *   - the destination gate/terminal and the registration where the base is blank.
 * Never mutates either row.
 *
 * @param {object|null} depRow
 * @param {object|null} arrRow
 * @returns {object|null}
 */
export function mergeLegRows(depRow, arrRow) {
  if (!arrRow) return depRow;
  if (!depRow) return arrRow;
  const out = structuredClone(depRow);
  out.time = out.time || {};
  for (const kind of ['scheduled', 'estimated', 'real']) out.time[kind] = { ...(out.time[kind] || {}) };
  const at = arrRow.time || {};
  if (Number(at.real?.arrival) > 0) out.time.real.arrival = at.real.arrival;
  if (Number(at.estimated?.arrival) > 0) out.time.estimated.arrival = at.estimated.arrival;
  if (!(Number(out.time.scheduled.arrival) > 0) && Number(at.scheduled?.arrival) > 0) out.time.scheduled.arrival = at.scheduled.arrival;
  if (!(Number(out.time.real.departure) > 0) && Number(at.real?.departure) > 0) out.time.real.departure = at.real.departure;

  // Destination gate/terminal: the departures row's non-empty values win (unchanged from before),
  // the arrivals row fills the blanks.
  const destInfo = out.airport?.destination?.info || {};
  const arrInfo = arrRow.airport?.destination?.info || {};
  if (out.airport?.destination) {
    out.airport.destination.info = { ...arrInfo, ...Object.fromEntries(Object.entries(destInfo).filter(([, v]) => v)) };
  }
  if (!out.aircraft?.registration && arrRow.aircraft?.registration) {
    out.aircraft = { ...(out.aircraft || {}), registration: arrRow.aircraft.registration };
  }

  const depProgress = rowProgress(depRow);
  if (rowProgress(arrRow) > depProgress) {
    out.status = structuredClone(arrRow.status);
  } else if (depProgress === 0 && cancellationKind(arrRow, 'arrivals') === 'confirmed' && cancellationKind(depRow, 'departures') !== 'confirmed') {
    out.status = structuredClone(arrRow.status);
  }
  return out;
}

// ── /api/flight-times payloads ──

/**
 * The epoch-ms times and route of a /api/flight-times payload. Gate times first; the takeoff/landing
 * fields (FR24/FlightAware) fill in when a gate time is missing. NaN = unknown.
 * @param {any} payload
 */
export function legFromPayload(payload) {
  const dep = payload?.departure || {};
  const arr = payload?.arrival || {};
  return {
    schedDepMs: finite(ms(dep.gate?.scheduled) || ms(dep.takeoff?.scheduled)),
    estDepMs: finite(ms(dep.gate?.estimated)),
    gateDepMs: finite(ms(dep.gate?.actual)),
    actualDepMs: finite(ms(dep.gate?.actual) || ms(dep.takeoff?.actual)),
    schedArrMs: finite(ms(arr.gate?.scheduled) || ms(arr.landing?.scheduled)),
    estArrMs: finite(ms(arr.gate?.estimated) || ms(arr.landing?.estimated)),
    actualArrMs: finite(ms(arr.gate?.actual) || ms(arr.landing?.actual)),
    origin: upper(payload?.origin?.iata),
    dest: upper(payload?.destination?.iata),
  };
}

/**
 * What one reg_sightings record says about one leg, or null when it says nothing about it.
 *
 *  - 'airborne': the record's AIRBORNE time falls between 15 min before the scheduled departure and
 *    18 h after it (the seen-airborne override's window, src/lib/reg-overlay.js), its origin is this
 *    leg's origin, and its destination does not contradict this leg's.
 *  - 'landed': all of that, plus the record's latest sighting is a GROUND one (newer than the last
 *    airborne time — the ground upsert never touches airborne_at), on this leg's route (destination
 *    present and equal), and the last airborne time is in the second half of the block. That is the
 *    aircraft seen on the ground at the destination.
 *
 * The window is checked here rather than through sightingMatchesFlight(), whose bound is the
 * SCHEDULED arrival + 3 h: a flight four hours late would have its taxi-in sighting thrown away.
 *
 * Known limit: reg_sightings holds only the latest sighting per flight number, without a position.
 * An air return that comes back after the halfway point of the block would read as landed.
 *
 * @param {{reg?:string, origin?:string, dest?:string, seenAtMs:number, airborneAtMs?:number|null}|null|undefined} sighting
 * @param {ReturnType<typeof legFromPayload>} leg
 * @param {number} nowMs
 * @returns {{kind:'airborne'|'landed', airborneAtMs:number, seenAtMs:number}|null}
 */
export function sightingLegEvidence(sighting, leg, nowMs) {
  if (!sighting || !leg || !Number.isFinite(leg.schedDepMs)) return null;
  if (sighting.airborneAtMs == null) return null;
  const airborne = Number(sighting.airborneAtMs);
  if (!Number.isFinite(airborne) || airborne <= 0 || airborne > nowMs + 60e3) return null;
  const so = upper(sighting.origin);
  const sd = upper(sighting.dest);
  if (!so || !leg.origin || so !== leg.origin) return null;
  if (sd && leg.dest && sd !== leg.dest) return null;
  if (airborne < leg.schedDepMs - SEEN_AIRBORNE_BEFORE_DEP_MS || airborne > leg.schedDepMs + SEEN_AIRBORNE_AFTER_DEP_MS) return null;

  const seen = Number(sighting.seenAtMs);
  const seenAtMs = Number.isFinite(seen) && seen > 0 ? seen : airborne;
  const depBest = Number.isFinite(leg.actualDepMs)
    ? leg.actualDepMs
    : Math.max(leg.schedDepMs, Number.isFinite(leg.estDepMs) ? leg.estDepMs : 0);
  const block = leg.schedArrMs - leg.schedDepMs;
  const groundAfter = seenAtMs - airborne;
  const onGroundAtDest =
    groundAfter >= GROUND_AFTER_AIRBORNE_MS &&
    groundAfter <= GROUND_AFTER_AIRBORNE_MAX_MS &&
    seenAtMs <= nowMs + 60e3 &&
    !!sd && sd === leg.dest &&
    Number.isFinite(block) && block > 0 &&
    airborne >= depBest + block * LANDED_LATE_IN_BLOCK;
  return { kind: onGroundAtDest ? 'landed' : 'airborne', airborneAtMs: airborne, seenAtMs };
}

/** The phase a payload states on its own, before any sighting evidence. */
function statedPhase(payload, leg, nowMs) {
  if (payload.cancelled) return 'cancelled';
  if (payload.diverted) return 'diverted';
  if (Number.isFinite(leg.actualArrMs) && leg.actualArrMs <= nowMs + 60e3) return 'landed';
  const text = phaseOfStatusText(payload.status);
  if (text === 'landed' || text === 'cancelled' || text === 'diverted') return text;
  if (Number.isFinite(leg.actualDepMs) && leg.actualDepMs <= nowMs + 60e3) return 'departed';
  return text;
}

/**
 * Upgrade a payload's status with what the live feed saw — never downgrade it. A pre-departure
 * payload the feed saw airborne reads 'departed'; a not-yet-landed one seen on the ground at its
 * destination reads 'landed'. The evidence rides along in `evidence` ({kind, airborneAt, seenAt});
 * no time field is invented (a sighting is not a gate time). A confirmed cancellation is left alone.
 *
 * @param {any} payload  a /api/flight-times payload.
 * @param {object|null|undefined} sighting  the flight number's reg_sightings record.
 * @param {number} nowMs
 * @returns {object|null} the same payload, or a copy with `status` and `evidence` set.
 */
export function applyLegEvidence(payload, sighting, nowMs) {
  if (!payload || payload.success === false || payload.cancelled || !sighting) return payload;
  const leg = legFromPayload(payload);
  const ev = sightingLegEvidence(sighting, leg, nowMs);
  if (!ev) return payload;
  const phase = statedPhase(payload, leg, nowMs);
  const evidence = {
    kind: ev.kind === 'landed' ? 'ground-at-destination' : 'airborne',
    airborneAt: new Date(ev.airborneAtMs).toISOString(),
    seenAt: new Date(ev.seenAtMs).toISOString(),
  };
  const pre = phase === 'scheduled' || phase === 'likely_canceled' || phase === 'unknown';
  if (ev.kind === 'landed' && (pre || phase === 'departed')) return { ...payload, status: 'landed', evidence };
  if (pre) return { ...payload, status: 'departed', evidence };
  return payload;
}

/** YYYY-MM-DD of an instant in a timezone (UTC when the zone is unknown). */
export function localDate(msValue, tz) {
  if (!Number.isFinite(msValue)) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(msValue));
  } catch {
    return new Date(msValue).toISOString().slice(0, 10);
  }
}

/**
 * One payload → the watched leg's state. Null when the payload is unusable or names no scheduled
 * departure (a leg we cannot date cannot be watched).
 *
 * Phase, from the strongest evidence down: a confirmed cancellation or diversion; an arrival time
 * that has happened; a landed status (the provider's, or the live feed's ground-at-destination);
 * a departure time that has happened; a departed / en-route status (the provider's, or an airborne
 * sighting); otherwise what the status word says — scheduled, Likely Canceled, or unknown.
 *
 * Delay is measured at the gate (estimated, else actual gate departure, against scheduled), the same
 * line the board and My Flights use. Null when there is no estimate.
 *
 * @param {any} payload
 * @param {number} nowMs
 */
export function resolveLegState(payload, nowMs) {
  if (!payload || payload.success === false) return null;
  const leg = legFromPayload(payload);
  if (!Number.isFinite(leg.schedDepMs)) return null;
  const phase = statedPhase(payload, leg, nowMs);
  const evidenceKind = payload.evidence?.kind || '';
  let reason;
  if (phase === 'cancelled') reason = 'provider-cancelled';
  else if (phase === 'diverted') reason = 'provider-diverted';
  else if (phase === 'landed') {
    reason = Number.isFinite(leg.actualArrMs) ? 'actual-arrival'
      : evidenceKind === 'ground-at-destination' ? 'ground-at-destination' : 'provider-status';
  } else if (phase === 'departed') {
    reason = Number.isFinite(leg.actualDepMs) ? 'actual-departure'
      : evidenceKind === 'airborne' ? 'airborne-sighting' : 'provider-status';
  } else reason = 'provider-status';

  const depBestMs = Number.isFinite(leg.gateDepMs) ? leg.gateDepMs : leg.estDepMs;
  const delayMin = Number.isFinite(depBestMs) ? Math.round((depBestMs - leg.schedDepMs) / 60000) : null;
  const originTz = String(payload.origin?.tz || '');
  return {
    phase,
    reason,
    statusText: String(payload.status || ''),
    schedDepMs: leg.schedDepMs,
    legDep: new Date(leg.schedDepMs).toISOString(),
    legDate: localDate(leg.schedDepMs, originTz),
    origin: leg.origin,
    dest: leg.dest,
    originTz,
    destTz: String(payload.destination?.tz || ''),
    estDepMs: leg.estDepMs,
    actualArrMs: leg.actualArrMs,
    delayMin,
    gate: String(payload.origin?.gate || '').trim(),
    reg: String(payload.registration || '').trim().toUpperCase(),
    type: String(payload.aircraft || '').trim(),
  };
}
