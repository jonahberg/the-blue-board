// ═══ SCHEDULE STAT-STRIP RECONCILIATION ═══
// Audit Jul 3 2026: renderScheduleStats computed `canceled` but never rendered it —
// ORD showed Total 717 while the visible cards summed 475, hiding 70 cancellations
// during an IROPS night. This helper buckets EVERY row exactly once so the cards
// (+ a muted "uncategorized" catch-all) visibly reconcile with Total:
//
//   total = onTime + late + upcoming + canceled + presumed + uncategorized
//
// Buckets:
//   onTime/late     operated rows with a trustworthy schedule baseline (30-min rule)
//   upcoming        scheduled / estimated / delayed / unknown (unknown renders as
//                   "Scheduled (as of …)" so it counts here, not as noise)
//   canceled        canceled + canceled_uncertain ("Likely Canceled" groups here)
//   presumed        time-inferred departures/landings (no live confirmation)
//   uncategorized   everything else: diverted, operated rows without usable
//                   timestamps, live-feed rescue rows, derived-schedule rows

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

    const hasOperated = key === 'departed' || key === 'enroute' || key === 'landed';
    if (!hasOperated) {
      if (key === 'scheduled' || key === 'estimated' || key === 'delayed' || key === 'unknown') upcoming++;
      // anything else (diverted, novel keys) falls into the uncategorized remainder
      continue;
    }

    // Time-inferred rows have no trustworthy actual-out time: they are neither
    // on-time nor late — they are "presumed departed" and get their own count.
    if (status.presumed || status.inferred) { presumed++; continue; }

    // OTP scoring — mirrors the long-standing rules (excludes synthetic baselines).
    if (fl._source?.liveFeedFallback) continue;
    const schedT = isArr ? fl.time?.scheduled?.arrival : fl.time?.scheduled?.departure;
    const derived = isArr
      ? fl._source?.scheduleTimeDerivedFromActual?.arrival
      : fl._source?.scheduleTimeDerivedFromActual?.departure;
    const realT = fl.time?.real?.departure || fl.time?.real?.arrival;
    const actT = realT || (isArr ? fl.time?.estimated?.arrival : fl.time?.estimated?.departure);
    if (!schedT || !actT || derived) continue;
    if (actT > schedT + 1800) late++;
    else onTime++;
  }

  const total = list.length;
  const operated = onTime + late;
  const otp = operated > 0 ? Math.round((onTime / operated) * 100) : null;
  const uncategorized = Math.max(0, total - onTime - late - upcoming - canceled - presumed);

  return { total, onTime, late, upcoming, canceled, canceledUncertain, presumed, operated, otp, uncategorized };
}
