// ═══ SCHEDULE TIME PLAUSIBILITY ═══
// One definition of "this delay cannot be real", shared by the AeroDataBox normalizer
// (api/_schedule-aerodatabox.ts), the board stat strip (board-stats.js) and the row model
// (schedule-row-model.js), so the server, the Late count and the Delay cell agree.
//
// Why it exists (audit Sep 26 2026, ORD arrivals): AeroDataBox mixes flight INSTANCES. A row
// can carry yesterday's scheduled arrival next to today's real arrival (UA2113 "Arrived
// +54h20m", UA1946 "+41h17m"), a scheduled arrival EARLIER than its scheduled departure
// (UA5375 MSY→ORD), or a stale estimate parked at 00:00 on a flight that operated the day
// before (UA1677 "+10h47m Landed* presumed"). Every one of those rendered as a delay and
// counted as Late.

/** A single hub-local day cannot hold a longer gate delay — the cap api/irops.ts already uses. */
export const MAX_PLAUSIBLE_LATE_SECONDS = 16 * 3600;

/** Nothing pushes back or blocks in three hours ahead of schedule. */
export const MAX_PLAUSIBLE_EARLY_SECONDS = 3 * 3600;

/**
 * An ESTIMATE (no real time behind it) this far past schedule is a stale provider value, not a
 * forecast: the ghost rows above all carried a ~10-11h estimate on a flight that had already
 * operated.
 */
export const MAX_PLAUSIBLE_ESTIMATE_LATE_SECONDS = 6 * 3600;

/**
 * Is `actualSec - schedSec` a delta a real flight could have? Missing inputs are not evidence
 * of anything, so they pass.
 *
 * @param {number|null|undefined} actualSec  real (or, with `estimate`, estimated) unix seconds.
 * @param {number|null|undefined} schedSec  scheduled unix seconds.
 * @param {{estimate?: boolean}} [opts]  `estimate: true` applies the tighter estimate bound.
 * @returns {boolean}
 */
export function isPlausibleDelta(actualSec, schedSec, { estimate = false } = {}) {
  const actual = Number(actualSec);
  const sched = Number(schedSec);
  if (!(actual > 0) || !(sched > 0)) return true;
  const delta = actual - sched;
  const lateCap = estimate ? MAX_PLAUSIBLE_ESTIMATE_LATE_SECONDS : MAX_PLAUSIBLE_LATE_SECONDS;
  return delta <= lateCap && delta >= -MAX_PLAUSIBLE_EARLY_SECONDS;
}
