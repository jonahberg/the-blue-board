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

// ── Actual times that cannot be actual (live audit Oct 3 2026, v1.11.3) ──
// The ORD boards read at 17:55Z carried 13 rows with time.real.* LATER than the clock, from two
// sources: AeroDataBox returning yesterday's leg with its arrival shifted a day (UA2113 LAX→ORD
// "off 10-02 17:58Z, arrived 10-03 22:55Z"), and Departed/Arrived flags whose revised time is
// still ahead (UA845 "Departed" 9.5h before its 21:30 CDT departure). The row transforms that
// act on these live in schedule-actuals.js.

/**
 * Longest gate-to-gate leg a row may describe. United's longest scheduled block is ~17.5h
 * (IAH–SYD); 20h leaves room for a long hold and still rejects a leg spliced across two days.
 */
export const MAX_PLAUSIBLE_BLOCK_SECONDS = 20 * 3600;

/** Clock skew between the provider, this server and the visitor — and nothing more. */
export const FUTURE_ACTUAL_TOLERANCE_SECONDS = 5 * 60;

/**
 * Is an "actual" timestamp still in the future? Missing inputs are not evidence, so they pass.
 * @param {number|null|undefined} actualSec
 * @param {number|null|undefined} nowSec
 * @returns {boolean}
 */
export function isFutureActual(actualSec, nowSec) {
  const actual = Number(actualSec);
  const now = Number(nowSec);
  if (!(actual > 0) || !(now > 0)) return false;
  return actual > now + FUTURE_ACTUAL_TOLERANCE_SECONDS;
}

/**
 * Does this row describe a leg longer than any flight — two instances spliced into one row?
 *
 * Only a leg that actually happened is judged (a real departure or arrival must be present): a
 * schedule on its own is not evidence. Each side uses its real time when it has one and its
 * scheduled time otherwise, which also catches a scheduled arrival that the instance repair
 * DERIVED from a date-shifted actual (the repair is what moved UA2113 into today's hub day).
 *
 * @param {any} flight  a normalized schedule row.
 * @returns {boolean}
 */
export function isImplausibleLegSpan(flight) {
  const t = flight?.time || {};
  const realDep = Number(t.real?.departure) || 0;
  const realArr = Number(t.real?.arrival) || 0;
  if (!realDep && !realArr) return false;
  const dep = realDep || Number(t.scheduled?.departure) || 0;
  const arr = realArr || Number(t.scheduled?.arrival) || 0;
  return dep > 0 && arr > 0 && arr - dep > MAX_PLAUSIBLE_BLOCK_SECONDS;
}
