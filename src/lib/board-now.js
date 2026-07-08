// ═══ "NOW" ANCHOR FOR TIME-ASCENDING BOARDS ═══
// The schedule board sorts time-ascending, so yesterday's stragglers lead the page
// all day (audit Jul 3 2026). These helpers find where "now" falls in a sorted list
// of departure timestamps so the UI can (a) auto-scroll to the first still-relevant
// row and (b) insert a "── NOW ──" divider between past and future rows.
//
// A row counts as "future" from 30 minutes before now: a flight scheduled 20 minutes
// ago may still be boarding, so anchoring strictly at now would scroll past it.

export const NOW_GRACE_SECONDS = 1800; // 30 minutes

/**
 * Index of the first row whose timestamp is at or after (now - grace).
 * @param {Array<number|null|undefined>} timesSec  sorted-ascending unix seconds (0/null = unknown).
 * @param {number} nowSec  current unix time in seconds.
 * @returns {number} index, or -1 when there are no future rows (skip all NOW anchoring).
 */
export function firstFutureIndex(timesSec, nowSec, graceSec = NOW_GRACE_SECONDS) {
  if (!Array.isArray(timesSec) || !Number.isFinite(Number(nowSec))) return -1;
  for (let i = 0; i < timesSec.length; i++) {
    const t = Number(timesSec[i]);
    if (Number.isFinite(t) && t > 0 && t >= nowSec - graceSec) return i;
  }
  return -1;
}

/**
 * Effective time (unix seconds) to place a row against the NOW divider (F075).
 *
 * The divider was anchored to scheduled time only, so a flight held on the ground during
 * a GDP/ground stop — hours past its scheduled push, but not yet departed — sat ABOVE
 * "── NOW ──" as if it had already resolved, precisely when it matters most. The fix:
 * when the flight has NO real (out/off) time yet, anchor it to max(scheduled, estimated),
 * so a delayed-but-not-departed flight floats down to its expected time and lands below
 * the divider. A row that HAS a real time keeps the existing behavior (scheduled anchor)
 * so already-departed rows stay put. The TIME-column sort order is unchanged; this only
 * affects where the divider falls.
 *
 * @param {{scheduled?:number, real?:number, estimated?:number}} times  unix seconds (0/null = unknown).
 * @returns {number} effective unix seconds (0 when nothing is known).
 */
export function effectiveRowTime({ scheduled = 0, real = 0, estimated = 0 } = {}) {
  const sched = Number(scheduled) > 0 ? Number(scheduled) : 0;
  const realT = Number(real) > 0 ? Number(real) : 0;
  if (realT > 0) return sched; // real time exists → keep current (scheduled-anchored) behavior
  const est = Number(estimated) > 0 ? Number(estimated) : 0;
  return Math.max(sched, est);
}

/**
 * Where to insert the "── NOW ──" divider row, or -1 when a divider makes no sense:
 *  - no future rows (whole board is in the past — e.g. late-night today board), or
 *  - no past rows (divider would sit uselessly at the very top — e.g. tomorrow board
 *    or early-morning today board).
 */
export function nowDividerIndex(timesSec, nowSec, graceSec = NOW_GRACE_SECONDS) {
  const idx = firstFutureIndex(timesSec, nowSec, graceSec);
  return idx > 0 ? idx : -1;
}
