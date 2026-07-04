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
 * Where to insert the "── NOW ──" divider row, or -1 when a divider makes no sense:
 *  - no future rows (whole board is in the past — e.g. late-night today board), or
 *  - no past rows (divider would sit uselessly at the very top — e.g. tomorrow board
 *    or early-morning today board).
 */
export function nowDividerIndex(timesSec, nowSec, graceSec = NOW_GRACE_SECONDS) {
  const idx = firstFutureIndex(timesSec, nowSec, graceSec);
  return idx > 0 ? idx : -1;
}
