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

// Grace window before a past-time, un-actualized flight is treated as operated. Generous on
// purpose: a genuinely delayed flight holding at the gate keeps a FUTURE estimated time (see
// effective-time logic below) and is never reclassified, so this only catches flights whose
// best-known time is already well behind us.
export const OPERATED_GRACE_SECONDS = 3600; // 60 minutes

// How far past scheduled an estimated time must be before classifyBase labels it "delayed"
// rather than "estimated". Faithfully carried over from the original inline classifier.
const ESTIMATED_DELAY_SECONDS = 900; // 15 minutes

// "Not yet operated" provider states that are eligible for time-based reclassification.
const RECLASSIFIABLE_KEYS = new Set(['scheduled', 'estimated', 'delayed']);

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
  if (statusText === 'canceled' || statusText === 'cancelled' || txtLower.includes('cancel') || (iconColor === 'red' && generic?.type === 'canceled')) return { text: txt || 'Canceled', cls: 'canceled', key: 'canceled' };
  if (statusText === 'landed' || txtLower.includes('landed')) return { text: txt || 'Landed', cls: 'landed', key: 'landed' };
  if (statusText === 'departed' || txtLower.startsWith('departed')) return { text: txt || 'Departed', cls: 'departed', key: 'departed' };
  // A flight is en-route if: FR24 says so, OR it's live with a real departure (actually airborne)
  const isAirborne = s.live === true && (flight.time?.real?.departure != null);
  if (statusText === 'en-route' || txtLower.includes('en route') || isAirborne) return { text: txt || 'En Route', cls: 'enroute', key: 'enroute' };
  if (statusText === 'scheduled') return { text: txt || 'Scheduled', cls: 'scheduled', key: 'scheduled' };
  if (statusText === 'estimated') {
    const schedTime = flight.time?.scheduled?.departure || flight.time?.scheduled?.arrival;
    const estTime = flight.time?.estimated?.departure || flight.time?.estimated?.arrival;
    if (schedTime && estTime && estTime > schedTime + ESTIMATED_DELAY_SECONDS) return { text: txt, cls: 'delayed', key: 'estimated' };
    return { text: txt, cls: 'estimated', key: 'estimated' };
  }
  if (txtLower.includes('delay')) return { text: txt, cls: 'delayed', key: 'delayed' };
  return { text: txt || 'Unknown', cls: 'unknown', key: 'unknown' };
}

/**
 * Classify a schedule flight for display.
 *
 * @param {object} flight  normalized schedule flight (see api/schedule.ts)
 * @param {('departures'|'arrivals')} [dir='departures']  board direction; decides which
 *        leg (departure vs arrival) drives the time-based "has it operated yet?" check.
 * @param {number} [nowSec]  current unix time in SECONDS (injectable for tests).
 * @returns {{text:string, cls:string, key:string, inferred?:boolean}}
 *        inferred:true marks a status derived from elapsed time rather than confirmed by
 *        the provider — callers exclude these from on-time stats (no trustworthy actual time).
 */
export function classifySchedStatus(flight, dir = 'departures', nowSec = Math.floor(Date.now() / 1000)) {
  const base = classifyBase(flight);
  if (!RECLASSIFIABLE_KEYS.has(base.key)) return base;

  // Reclassify purely on elapsed time. This path is only reached for not-yet-operated provider
  // statuses (scheduled / estimated / delayed); a confirmed real departure/arrival is already
  // handled by classifyBase (the departed / en-route / landed branches), so we do not re-read
  // time.real here.
  const time = flight.time || {};
  const isArr = dir === 'arrivals';
  const scheduled = isArr ? time.scheduled?.arrival : time.scheduled?.departure;
  const estimated = isArr ? time.estimated?.arrival : time.estimated?.departure;
  const eff = effectiveTime(scheduled, estimated);
  if (!eff) return base; // no time to reason about — leave provider status untouched

  if (eff < nowSec - OPERATED_GRACE_SECONDS) {
    return isArr
      ? { text: 'Landed', cls: 'landed', key: 'landed', inferred: true }
      : { text: 'Departed', cls: 'departed', key: 'departed', inferred: true };
  }
  return base;
}
