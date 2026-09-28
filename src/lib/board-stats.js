// ═══ SCHEDULE STAT-STRIP RECONCILIATION ═══
// Audit Jul 3 2026: renderScheduleStats computed `canceled` but never rendered it —
// ORD showed Total 717 while the visible cards summed 475, hiding 70 cancellations
// during an IROPS night. This helper buckets EVERY row exactly once so the cards
// (+ a muted "uncategorized" catch-all) visibly reconcile with Total:
//
//   total = onTime + late + upcoming + canceled + presumed + uncategorized
//
// Buckets:
//   onTime/late     OPERATED rows per hub-health.js operatedOutcome() — the same definition
//                   /api/irops and the hub strip use (D9) — split by the 30-min rule
//   upcoming        scheduled / estimated / delayed / unknown (unknown renders as
//                   "Scheduled (as of …)" so it counts here, not as noise)
//   canceled        canceled + canceled_uncertain ("Likely Canceled" groups here)
//   presumed        time-inferred departures/landings (no live confirmation)
//   uncategorized   everything else: diverted, operated rows without usable
//                   timestamps, live-feed rescue rows, derived-schedule rows, and
//                   rows whose delta no real flight could have (F4: "+54h" cross-
//                   instance pairs and stale 10h estimates were counted Late)

import { operatedOutcome } from './hub-health.js';
import { classifySchedStatus } from './schedule-status.js';

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

  let onTime = 0, late = 0, upcoming = 0, canceled = 0, canceledUncertain = 0, presumed = 0;

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

    const outcome = hasOperated || key === 'diverted' ? operatedOutcome(fl, dir, key) : null;
    if (outcome === 'onTime') { onTime++; continue; }
    if (outcome === 'late') { late++; continue; }

    if (!hasOperated && (key === 'scheduled' || key === 'estimated' || key === 'delayed' || key === 'unknown')) upcoming++;
    // Everything else — diverted without a real time, novel keys, and operated rows the shared
    // definition cannot score (estimate-only, synthetic, implausible delta) — is the
    // uncategorized remainder.
  }

  const total = list.length;
  const operated = onTime + late;
  const otp = operated > 0 ? Math.round((onTime / operated) * 100) : null;
  const uncategorized = Math.max(0, total - onTime - late - upcoming - canceled - presumed);

  return { total, onTime, late, upcoming, canceled, canceledUncertain, presumed, operated, otp, uncategorized };
}
