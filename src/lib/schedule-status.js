// ═══ SCHEDULE STATUS CLASSIFICATION ═══
// Single source of truth for turning a normalized schedule flight (FR24/AeroDataBox
// shape, see api/schedule.ts normalizeSummaryFlight) into a display status.
//
// WHY THIS IS TIME-AWARE (root cause of the "scheduled departures already airborne" bug):
// AeroDataBox marks many flights "Expected"/scheduled and never delivers an
// actual-departure update — `time.real.departure` stays null indefinitely. The provider
// status text alone therefore leaves a flight that left hours ago labeled "Scheduled"
// forever. Observed live: EWR UA1428, scheduled 06:52, still status="scheduled" at 22:00
// the same day with realDep=null. Snapshot staleness compounds this, but is NOT the cause:
// even a perfectly fresh fetch mislabels these rows, because the provider never actualized
// them. A pilot filtering "Scheduled" to count remaining departures saw a list dominated by
// flights that had already departed.
//
// The fix: a flight still in a not-yet-operated state (scheduled / estimated / delayed) whose
// *effective* departure (or arrival) time is comfortably in the past has almost certainly
// operated. We reclassify it as departed (departures) / landed (arrivals) with inferred:true
// so it drops out of the "Scheduled"/"Upcoming" buckets and the status filter. This uses only
// data already on the flight object — zero extra API calls.

import { isCanceledUncertainStatus } from './cancellation.js';

// Grace window before a past-time, un-actualized flight is treated as operated. Generous on
// purpose: a genuinely delayed flight holding at the gate keeps a FUTURE estimated time (see
// effective-time logic below) and is never reclassified, so this only catches flights whose
// best-known time is already well behind us.
export const OPERATED_GRACE_SECONDS = 3600; // 60 minutes

// During a hub-wide FAA program (GDP/ground stop), flights routinely sit hours past their
// best-known time WITHOUT the provider ever publishing a revised estimate — the Jul 3 2026 ORD
// GDP (293-min average delay) minted 162 false time-inferred "Departed" rows (UA2610/UA1967 were
// physically parked). When the caller passes the hub's current disruption magnitude, extend the
// inference grace to cover the program's average delay plus the normal 60-minute grace.
export function operatedGraceSeconds(hubDisruptionMinutes) {
  const mins = Number(hubDisruptionMinutes);
  if (!Number.isFinite(mins) || mins <= 0) return OPERATED_GRACE_SECONDS;
  return Math.max(OPERATED_GRACE_SECONDS, (mins + 60) * 60);
}

// How far past scheduled an estimated time must be before classifyBase labels it "delayed"
// rather than "estimated". Faithfully carried over from the original inline classifier.
const ESTIMATED_DELAY_SECONDS = 900; // 15 minutes

// "Not yet operated" provider states that are eligible for time-based reclassification.
const RECLASSIFIABLE_KEYS = new Set(['scheduled', 'estimated', 'delayed']);

// A live-feed sighting older than this is not proof the aircraft is airborne NOW — a
// cached board can be served minutes after the merge stamped it. 20 min = the server's
// 15-min "recent" gate plus one full board-cache staleness grace.
const LIVE_SIGHTING_MAX_AGE_S = 1200;

// A LIVE stamp earlier than this before the scheduled departure is a previous leg (or a stamp from
// before v1.12.1, when any sighting counted), never this departure: the overlay's airborne gate.
const LIVE_BEFORE_DEP_S = 15 * 60;

// An arrival the provider still calls en route / approaching / departed, with no live fix, whose best
// arrival time is this far behind the clock has landed (live audit Oct 4 2026: LAX UA38 "Approaching"
// 371 min after it arrived, ORD UA2472, ten such rows on the arrivals boards). Wider than the 60-min
// grace for rows that never moved: an aircraft really still in the air beyond the feed's coverage
// would need an arrival estimate wrong by more than this.
export const EN_ROUTE_AGING_SECONDS = 90 * 60;

// Effective time = the most current expectation for when the flight leaves/arrives.
// Math.max(scheduled, estimated) is deliberate and load-bearing:
//   - genuine delay: estimated > scheduled, we use estimated (often still in the FUTURE → kept)
//   - garbage early estimate (some provider rows carry an estimated time BEFORE the scheduled
//     time): max() ignores it and falls back to scheduled, so a real future flight is never
//     wrongly flagged as departed
//   - only one present: use whichever exists
function effectiveTime(scheduled, estimated) {
  const s = scheduled && scheduled > 0 ? scheduled : 0;
  const e = estimated && estimated > 0 ? estimated : 0;
  if (s && e) return Math.max(s, e);
  return e || s || 0;
}

// Provider status text arrives lowercase ('departed', 'expected') while inferred statuses are
// title-case ('Departed'), so the same status column mixed casings. Capitalize at the source.
function cap(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

// Base classification from provider status text. Mirrors the original inline
// classifySchedStatus logic exactly; the time-aware override is layered on top below.
function classifyBase(flight) {
  const s = flight.status;
  if (!s) return { text: 'Unknown', cls: 'unknown', key: 'unknown' };
  const generic = s.generic?.status;
  const txt = cap(s.text || '');
  const statusText = generic?.text || '';
  const diverted = generic?.diverted;
  const txtLower = txt.toLowerCase();
  if (diverted) return { text: 'Diverted', cls: 'diverted', key: 'diverted' };
  // FR24 uses various cancellation indicators: generic.status.text, status.text, status.icon
  const iconColor = s.icon || '';
  // AeroDataBox "CanceledUncertain" is a SOFT signal — the provider suspects a cancellation but
  // has not confirmed it. Surface it as its own warn-level state instead of hard red Canceled
  // (the UI used to render the raw string "Canceleduncertain"). MUST be checked before the
  // generic cancel branch below, whose includes('cancel') would swallow it. `label` mirrors
  // `text` — it is the field name in the agreed frontend contract for this status.
  if (isCanceledUncertainStatus(s)) {
    return { text: 'Likely Canceled', label: 'Likely Canceled', cls: 'warn', key: 'canceled_uncertain' };
  }
  if (statusText === 'canceled' || statusText === 'cancelled' || txtLower.includes('cancel') || (iconColor === 'red' && generic?.type === 'canceled')) return { text: txt || 'Canceled', cls: 'canceled', key: 'canceled' };
  if (statusText === 'landed' || txtLower.includes('landed')) return { text: txt || 'Landed', cls: 'landed', key: 'landed' };
  if (statusText === 'departed' || txtLower.startsWith('departed')) return { text: txt || 'Departed', cls: 'departed', key: 'departed' };
  // A flight is en-route if: FR24 says so, OR it's live with a real departure (actually airborne)
  const isAirborne = s.live === true && (flight.time?.real?.departure != null);
  // One spelling: the provider says "EnRoute"/"Approaching", a served-board repair says "en route"
  // (schedule-actuals.js) and a sighting says "En Route" — the board showed "En Route" and "En route"
  // side by side (live audit Oct 4 2026). "Approaching" is a real sub-state and keeps its word.
  if (statusText === 'en-route' || txtLower.includes('en route') || isAirborne) {
    return { text: txtLower.includes('approach') ? 'Approaching' : 'En Route', cls: 'enroute', key: 'enroute' };
  }
  if (statusText === 'scheduled') {
    // `txt` is the provider's free-text status and is shown verbatim in the Status column.
    // AeroDataBox emits both 'Expected' and the meaningless 'Unknown' for rows that are
    // identically not-yet-departed, so one flight in a board of 644 read "Unknown" while the
    // rest read "Expected" — same generic status, no estimated time, no real time, both hours
    // away. The `|| 'Scheduled'` fallback below never fired because "Unknown" is truthy.
    // generic.status.text is the normalized truth; use it whenever the provider word carries no
    // meaning. `key` stays 'scheduled' either way, so time-based reclassification is unaffected.
    const meaningful = txt && txtLower !== 'unknown';
    return { text: meaningful ? txt : 'Scheduled', cls: 'scheduled', key: 'scheduled' };
  }
  if (statusText === 'estimated') {
    const schedTime = flight.time?.scheduled?.departure || flight.time?.scheduled?.arrival;
    const estTime = flight.time?.estimated?.departure || flight.time?.estimated?.arrival;
    if (schedTime && estTime && estTime > schedTime + ESTIMATED_DELAY_SECONDS) return { text: txt, cls: 'delayed', key: 'estimated' };
    return { text: txt, cls: 'estimated', key: 'estimated' };
  }
  if (txtLower.includes('delay')) return { text: txt, cls: 'delayed', key: 'delayed' };
  return { text: txt || 'Unknown', cls: 'unknown', key: 'unknown' };
}

/** The overlay's tracking stamp (reg-overlay.js mergeTrack), or null. */
function trackOf(flight) {
  const track = flight?._source?.track;
  return track && Number(track.airborneAt) > 0 ? track : null;
}

/**
 * Is the row's LIVE stamp proof the aircraft is airborne now? Fresh (≤ 20 min) and not earlier than
 * 15 min before the scheduled departure — the same gate the overlay applies before stamping.
 */
function isLiveNow(flight, nowSec) {
  const seenAtMs = Number(flight?.live?.seenAt);
  if (!Number.isFinite(seenAtMs) || seenAtMs <= 0) return false;
  if (nowSec - seenAtMs / 1000 > LIVE_SIGHTING_MAX_AGE_S) return false;
  const dep = Number(flight?.time?.scheduled?.departure);
  return !(dep > 0 && seenAtMs / 1000 < dep - LIVE_BEFORE_DEP_S);
}

/** Landed, inferred from tracking: the aircraft flew this leg and was then seen on the ground there. */
function seenLandedStatus() {
  return { text: 'Landed', cls: 'landed', key: 'landed', inferred: true, presumed: true, seenLanded: true };
}

/** Landed, inferred from elapsed time. */
function presumedLandedStatus() {
  return { text: 'Landed', cls: 'landed', key: 'landed', inferred: true, presumed: true };
}

/** Has an arrival that is (or was) moving run out of time to still be in the air? */
function enRouteHasAged(flight, nowSec, opts) {
  const time = flight.time || {};
  const eff = effectiveTime(time.scheduled?.arrival, time.estimated?.arrival);
  if (!eff) return false;
  const grace = Math.max(EN_ROUTE_AGING_SECONDS, operatedGraceSeconds(opts?.hubDisruptionMinutes));
  return eff < nowSec - grace;
}

/**
 * Classify a schedule flight for display.
 *
 * @param {object} flight  normalized schedule flight (see api/schedule.ts)
 * @param {('departures'|'arrivals')} [dir='departures']  board direction; decides which
 *        leg (departure vs arrival) drives the time-based "has it operated yet?" check.
 * @param {number} [nowSec]  current unix time in SECONDS (injectable for tests).
 * @param {{hubDisruptionMinutes?: number}} [opts]  hubDisruptionMinutes > 0 (from board
 *        meta.hubDisruptionMinutes, derived from live FAA programs) extends the operated-
 *        inference grace to max(3600, (hubDisruptionMinutes + 60) * 60) seconds so a GDP hub
 *        stops minting false time-inferred Departed rows. 0/undefined = legacy behavior.
 * @returns {{text:string, cls:string, key:string, inferred?:boolean, presumed?:boolean, live?:boolean, label?:string, seen?:boolean, seenLanded?:boolean, pastDue?:boolean}}
 *        inferred:true / presumed:true both mark a status derived from elapsed time rather than
 *        confirmed by the provider — callers exclude these from on-time stats (no trustworthy
 *        actual time) and badge them as presumed in the UI.
 *        live:true marks a status confirmed by a recent AIRBORNE live-feed fix (Phase 2, v1.12.1) —
 *        badge as LIVE, not presumed.
 *        seen:true marks a row the provider called Likely Canceled that the live feed saw fly
 *        (v1.12.0, reg-overlay.js seen-airborne override) — the board says "seen airborne".
 *        seenLanded:true (v1.12.1) marks a Landed* the live feed proved: airborne on this leg, then
 *        on the ground at the destination. Presumed (no provider time), but not "no live update".
 *        pastDue:true (v1.12.1) marks a not-yet-operated row whose best time is already behind the
 *        clock: it is no longer a future flight, so it gets no delay-risk prediction.
 */
export function classifySchedStatus(flight, dir = 'departures', nowSec = Math.floor(Date.now() / 1000), opts = {}) {
  const base = classifyBase(flight);
  const time = flight.time || {};
  const isArr = dir === 'arrivals';

  // A provider row can carry the soft CanceledUncertain status AND a real departure/arrival
  // time (the suspicion was wrong — the flight operated). Confirmed real times win.
  if (base.key === 'canceled_uncertain') {
    const real = isArr ? time.real?.arrival : time.real?.departure;
    if (real && real > 0) {
      return isArr
        ? { text: 'Landed', cls: 'landed', key: 'landed' }
        : { text: 'Departed', cls: 'departed', key: 'departed' };
    }
    return base;
  }

  // Seen airborne (v1.12.0): the provider said CanceledUncertain, the live feed saw the aircraft
  // fly this leg, and the serve-time overlay (src/lib/reg-overlay.js) rewrote the row to departed
  // with the evidence in `_source.seenAirborne`. That is a departure without a provider time, so it
  // never scores on-time (operatedOutcome needs a real time) and is never presumed from the clock.
  if (flight._source?.seenAirborne && base.key === 'departed') {
    return classifySeenAirborne(flight, isArr, nowSec, opts);
  }

  const track = trackOf(flight);
  const live = isLiveNow(flight, nowSec);

  // Landed, seen (v1.12.1): the feed had this aircraft airborne on this leg and then on the ground at
  // its destination. Stronger than every "still flying" word the provider may still be sending —
  // ORD UA303 read "Expected · RISK: LOW" 36 min after it landed. A provider landing time wins.
  if (isArr && track?.landed && !live && !['landed', 'canceled', 'diverted'].includes(base.key)) {
    return seenLandedStatus();
  }

  if (!RECLASSIFIABLE_KEYS.has(base.key)) {
    // An arrival stuck "En Route" / "Approaching" / "Departed" hours after its arrival time has landed.
    if (isArr && (base.key === 'enroute' || base.key === 'departed') && !live && enRouteHasAged(flight, nowSec, opts)) {
      return presumedLandedStatus();
    }
    return base;
  }

  // Live-sighting reclassification (Phase 2): the aircraft was seen AIRBORNE by the live
  // feed moments ago. Stronger evidence than elapsed time, so it runs BEFORE the
  // time-inference below and carries live:true instead of presumed:true (there IS a
  // trustworthy signal — just not a provider timestamp, so still excluded from OTP
  // stats the same way presumed rows are, via the absence of time.real).
  // Never 'landed' from a LIVE fix: a recent airborne fix means airborne.
  if (live) {
    return isArr
      ? { text: 'En Route', cls: 'enroute', key: 'enroute', live: true }
      : { text: 'Departed', cls: 'departed', key: 'departed', live: true };
  }

  // Tracked (v1.12.1): the feed saw this instance airborne, just not in the last 20 min. It left;
  // an arrival is en route until it is seen down or its arrival time is long past.
  if (track) {
    if (!isArr) return { text: 'Departed', cls: 'departed', key: 'departed' };
    if (enRouteHasAged(flight, nowSec, opts)) return presumedLandedStatus();
    return { text: 'En Route', cls: 'enroute', key: 'enroute' };
  }

  // Reclassify purely on elapsed time. This path is only reached for not-yet-operated provider
  // statuses (scheduled / estimated / delayed); a confirmed real departure/arrival is already
  // handled by classifyBase (the departed / en-route / landed branches), so we do not re-read
  // time.real here.
  const scheduled = isArr ? time.scheduled?.arrival : time.scheduled?.departure;
  const estimated = isArr ? time.estimated?.arrival : time.estimated?.departure;
  const eff = effectiveTime(scheduled, estimated);
  if (!eff) return base; // no time to reason about — leave provider status untouched

  const grace = operatedGraceSeconds(opts?.hubDisruptionMinutes);
  if (eff < nowSec - grace) {
    return isArr
      ? presumedLandedStatus()
      : { text: 'Departed', cls: 'departed', key: 'departed', inferred: true, presumed: true };
  }
  // Past due (v1.12.1): the best time — the provider's estimate when it has one, even an early one
  // (UA303 was estimated 01:02Z against 01:33Z scheduled, and landed 00:41Z) — is behind the clock.
  if ((estimated > 0 ? estimated : eff) < nowSec) return { ...base, pastDue: true };
  return base;
}

/**
 * A seen-airborne row (see classifySchedStatus). Departures: Departed — LIVE while the fix is
 * fresh. Arrivals: En Route (LIVE while fresh) until it is seen on the ground (Landed*, seen) or the
 * arrival is past the operated grace (Landed*, presumed): the sighting proves the departure, never a
 * landing time.
 */
function classifySeenAirborne(flight, isArr, nowSec, opts) {
  const live = isLiveNow(flight, nowSec);
  if (!isArr) {
    return live
      ? { text: 'Departed', cls: 'departed', key: 'departed', live: true, seen: true }
      : { text: 'Departed', cls: 'departed', key: 'departed', seen: true };
  }
  if (live) return { text: 'En Route', cls: 'enroute', key: 'enroute', live: true, seen: true };
  if (trackOf(flight)?.landed) return { ...seenLandedStatus(), seen: true };
  const time = flight.time || {};
  const eff = effectiveTime(time.scheduled?.arrival, time.estimated?.arrival);
  if (eff && eff < nowSec - operatedGraceSeconds(opts?.hubDisruptionMinutes)) {
    return { text: 'Landed', cls: 'landed', key: 'landed', inferred: true, presumed: true, seen: true };
  }
  return { text: 'En Route', cls: 'enroute', key: 'enroute', seen: true };
}
