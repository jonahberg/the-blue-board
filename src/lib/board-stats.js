// ═══ SCHEDULE STAT-STRIP RECONCILIATION ═══
// Audit Jul 3 2026: renderScheduleStats computed `canceled` but never rendered it —
// ORD showed Total 717 while the visible cards summed 475, hiding 70 cancellations
// during an IROPS night. This helper buckets EVERY row exactly once so the cards
// (+ a muted "uncategorized" catch-all) visibly reconcile with Total:
//
//   total = onTime + late + untimed + canceled + inAir + upcoming + presumed + uncategorized
//
// Buckets:
//   onTime/late     OPERATED rows per hub-health.js operatedOutcome() — the same definition
//                   /api/irops and the hub strip use (D9) — split by the 30-min rule
//   untimed         rows the board itself calls Departed (departures) / Landed (arrivals) —
//                   on the provider's word or the live feed's — with NO actual time on that
//                   side, so there is nothing to score on time or late (Nov 2026, below)
//   canceled        canceled + canceled_uncertain ("Likely Canceled" groups here; the
//                   unconfirmed part is also reported on its own, and `canceledConfirmed` is
//                   the rest — a headline that says "canceled" shows that one)
//   inAir           arrivals boards only: left the origin, not yet here (En Route / Departed)
//   upcoming        scheduled / estimated / delayed / unknown (unknown renders as
//                   "Scheduled (as of …)" so it counts here, not as noise)
//   presumed        time-inferred departures/landings (no live confirmation)
//   uncategorized   what is left: rows that carry an actual time the shared definition
//                   refuses (live-feed rescue rows, derived-schedule rows, deltas no real
//                   flight could have — F4: "+54h" cross-instance pairs), and diversions
//                   without a real time
//
// WHY `untimed` and `inAir` exist (Nov 10 2026). The catch-all was written before v1.13.0
// (Oct 3) taught the classifier to call a row Departed on live-feed evidence: a flight the
// feed saw airborne, or one airborne right now, is "Departed" with no provider time — and so
// is a row the provider itself marks departed without sending the time. All of them fell
// through to "Uncategorized": on ORD at 16:54 CST that day the strip read 88 Uncategorized
// beside 150 on time, every one of them a departure the board prints as "Departed". On the
// arrivals board the same catch-all held every flight in the air (73). Neither was a data
// problem the reader needed warning about, and neither feeds onTime/late/operated/otp.

import { operatedOutcome } from './hub-health.js';
import { classifySchedStatus } from './schedule-status.js';

/** The actual time on the board's own side (departure on departures, arrival on arrivals). */
function realTimeOnBoardSide(fl, isArr) {
  const t = isArr ? fl?.time?.real?.arrival : fl?.time?.real?.departure;
  return Number(t) > 0;
}

/**
 * The stat strip's words for the buckets a traveller would not guess from the name — shared
 * by the desktop cards and the phone grid so the two cannot drift. The rows these count still
 * print "Departed" / "Landed" / "En Route"; the labels say what the strip can and cannot score.
 *
 * @param {('departures'|'arrivals')} dir
 * @returns {{untimed: {label: string, phoneLabel: string, title: string},
 *   inAir: {label: string, title: string}, uncategorized: {label: string, title: string}}}
 */
export function statStripCopy(dir) {
  const isArr = dir === 'arrivals';
  const verb = isArr ? 'Landed' : 'Departed';
  const side = isArr ? 'an arrival' : 'a departure';
  return {
    untimed: {
      label: `${verb} · not timed`,
      phoneLabel: 'Not timed',
      // Arrivals reach this bucket only on the provider's word: a landing the feed proved
      // without a provider time is a presumed Landed* (schedule-status.js seenLandedStatus).
      title: isArr
        ? 'Landed, but no arrival time has been reported (the schedule provider marked them landed without one), so these are not scored on time or late.'
        : 'Departed, but no departure time has been reported (the live flight feed saw them leave, or the schedule provider marked them departed without one), so these are not scored on time or late.',
    },
    inAir: {
      label: 'In the air',
      title: 'Left the origin and not landed here yet: the schedule provider says en route, or the live flight feed has the aircraft in the air.',
    },
    uncategorized: {
      label: 'Uncategorized',
      title: `Rows that fit no card: ${side} time that cannot be trusted (a live-feed stand-in, a schedule derived from the actual, or a delay no real flight could have), or a diversion with no time.`,
    },
  };
}

/**
 * @param {Array<object>} flights  normalized schedule flights (api/schedule shape).
 * @param {object} [opts]
 * @param {('departures'|'arrivals')} [opts.dir]
 * @param {number} [opts.nowSec]
 * @param {(fl:object)=>object} [opts.classify]  injectable for tests; defaults to
 *        classifySchedStatus(fl, dir, nowSec, classifyOpts).
 * @param {object} [opts.classifyOpts]  forwarded to classifySchedStatus (e.g.
 *        {hubDisruptionMinutes}) so the disruption-extended inference grace engages
 *        even when no custom classify is injected.
 */
export function computeScheduleStatCounts(flights, { dir = 'departures', nowSec = Math.floor(Date.now() / 1000), classify, classifyOpts } = {}) {
  const cls = classify || ((fl) => classifySchedStatus(fl, dir, nowSec, classifyOpts));
  const isArr = dir === 'arrivals';
  const list = Array.isArray(flights) ? flights : [];

  let onTime = 0, late = 0, untimed = 0, inAir = 0, upcoming = 0, canceled = 0, canceledUncertain = 0, presumed = 0;

  for (const fl of list) {
    const status = cls(fl) || {};
    const key = status.key || 'unknown';

    if (key === 'canceled' || key === 'canceled_uncertain') {
      canceled++;
      if (key === 'canceled_uncertain') canceledUncertain++;
      continue;
    }

    // D9 (live audit Sep 28 2026): ONE "operated" definition, shared with /api/irops and the
    // hub strip — `operatedOutcome()` in hub-health.js (a real out/in time, never an estimate;
    // diversions included; synthetic and implausible rows excluded). The header used to accept
    // an estimate on a departed row and read "170 operated" beside the strip's 146.
    // F021: on arrivals boards, "departed"/"enroute" only prove the flight LEFT the origin
    // (and carry no real ARRIVAL, which operatedOutcome requires anyway).
    const hasOperated = isArr ? key === 'landed' : (key === 'departed' || key === 'enroute' || key === 'landed');

    // Time-inferred rows have no trustworthy actual-out time: they are neither
    // on-time nor late — they are "presumed departed" and get their own count.
    if (hasOperated && (status.presumed || status.inferred)) { presumed++; continue; }

    // An arrival that has left its origin and not reached this hub is in the air — not
    // upcoming in the "has not left" sense, and not a row the reader needs to worry about.
    if (isArr && (key === 'enroute' || key === 'departed')) { inAir++; continue; }

    const outcome = hasOperated || key === 'diverted' ? operatedOutcome(fl, dir, key) : null;
    if (outcome === 'onTime') { onTime++; continue; }
    if (outcome === 'late') { late++; continue; }

    // The board says it left (or landed) but nobody has reported WHEN: never scored, never
    // hidden. A row that has a time the shared definition refuses stays uncategorized below.
    if (hasOperated && !realTimeOnBoardSide(fl, isArr)) { untimed++; continue; }

    if (!hasOperated && (key === 'scheduled' || key === 'estimated' || key === 'delayed' || key === 'unknown')) upcoming++;
    // Everything else — diverted without a real time, novel keys, and operated rows whose real
    // time the shared definition refuses (synthetic, implausible delta) — is the remainder.
  }

  const total = list.length;
  const operated = onTime + late;
  const otp = operated > 0 ? Math.round((onTime / operated) * 100) : null;
  const uncategorized = Math.max(0, total - onTime - late - untimed - inAir - upcoming - canceled - presumed);
  const canceledConfirmed = Math.max(0, canceled - canceledUncertain);

  return {
    total,
    onTime,
    late,
    untimed,
    inAir,
    upcoming,
    canceled,
    canceledUncertain,
    canceledConfirmed,
    presumed,
    operated,
    otp,
    uncategorized,
  };
}
