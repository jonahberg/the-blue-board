// ═══ WATCH ALERT RULES — one answer for the push cron and the in-tab watch ═══
// What a watched flight's status MEANS (its phase), which phase changes are worth waking someone
// for, and when a delay is big enough to say so. Shared by api/_watch-diff.ts (background push)
// and src/lib/watch-utils.js (in-tab alerts) so both surfaces agree (Oct 4 2026 audit, finding 4).
//
// Phases, in flight order: scheduled → departed → landed. Cancelled and diverted end a leg.
// `likely_canceled` is AeroDataBox's unconfirmed cancellation ("Likely Canceled"): wrong for 38 of
// 45 flights on Oct 3 2026, so it is never news itself, but it is still a pre-departure state — a
// later Departed or confirmed Canceled alerts from it as usual (v1.12.0).
//
// Forward only. A status that moves BACKWARDS (Landed → Departed, Landed → Expected) is never news:
// it is the departures board (which never advances to landed) disagreeing with the arrivals board,
// or yesterday's leg being compared with today's. Both used to push.

import { isLikelyCanceledText } from './cancellation.js';

/** @typedef {'scheduled'|'likely_canceled'|'departed'|'landed'|'cancelled'|'diverted'|'unknown'} WatchPhase */

/**
 * The phase a status WORD describes, in every vocabulary a watch sees: the board's display labels
 * ("Expected", "Arrived", "Likely Canceled"), /api/flight-times' generic text ("en-route",
 * "canceled_uncertain") and FlightAware's ("En Route").
 *
 * "estimated" is pre-departure: api/schedule.ts's FR24 normalizer maps estimated/delayed to it, and
 * the board classifier (schedule-status.js RECLASSIFIABLE_KEYS) treats it as not yet operated. The
 * old push engine read it as airborne, which hid the departure of a flight stored as "estimated".
 *
 * @param {string|null|undefined} text
 * @returns {WatchPhase}
 */
export function phaseOfStatusText(text) {
  const s = String(text || '').trim().toLowerCase();
  if (!s || s === 'unknown' || s === 'n/a' || s === 'scheduled?' || s === '—' || s === '-') return 'unknown';
  if (isLikelyCanceledText(s)) return 'likely_canceled';
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('divert')) return 'diverted';
  if (s.includes('landed') || s.includes('arrived')) return 'landed';
  if (
    s.includes('depart') ||
    s.includes('en route') ||
    s.includes('en-route') ||
    s.includes('enroute') ||
    s.includes('airborne') ||
    s.includes('in air') ||
    s.includes('approaching') ||
    s === 'active'
  ) return 'departed';
  // Scheduled / expected / estimated / on time / boarding / delayed / gate closed, and any other
  // known pre-departure word.
  return 'scheduled';
}

/**
 * The phase of a board classification KEY (src/lib/schedule-status.js classifySchedStatus).
 * @param {string|null|undefined} key
 * @returns {WatchPhase}
 */
export function phaseOfStatusKey(key) {
  switch (key) {
    case 'scheduled':
    case 'estimated':
    case 'delayed':
      return 'scheduled';
    case 'canceled_uncertain':
      return 'likely_canceled';
    case 'departed':
    case 'enroute':
      return 'departed';
    case 'landed':
      return 'landed';
    case 'canceled':
    case 'cancelled':
      return 'cancelled';
    case 'diverted':
      return 'diverted';
    default:
      return 'unknown';
  }
}

/** A phase that ends the leg: nothing after it is news. */
export function isTerminalPhase(phase) {
  return phase === 'landed' || phase === 'cancelled' || phase === 'diverted';
}

/** A phase that is never news and never overwrites what we already knew. */
export function isSilentPhase(phase) {
  return phase === 'unknown' || phase === 'likely_canceled';
}

const RANK = { scheduled: 0, likely_canceled: 0, departed: 1, landed: 2 };

/**
 * Is moving from `from` to `to` a real flight event?
 *
 *   scheduled / likely canceled → departed, landed, cancelled, diverted
 *   departed                    → landed, cancelled, diverted
 *   landed                      → diverted (the provider's diversion arrives as a landing first)
 *   cancelled, diverted         → nothing (the leg is over)
 *
 * Never into unknown or Likely Canceled, never from unknown (we had no baseline), never backwards,
 * never within a phase (a vocabulary flip such as "Landed" ⇄ "Arrived").
 *
 * @param {WatchPhase} from
 * @param {WatchPhase} to
 * @returns {boolean}
 */
export function isForwardTransition(from, to) {
  if (!from || !to || from === to) return false;
  if (isSilentPhase(to) || from === 'unknown') return false;
  if (from === 'cancelled' || from === 'diverted') return false;
  if (to === 'diverted') return true;
  if (to === 'cancelled') return from !== 'landed';
  return RANK[to] > RANK[from];
}

/**
 * Whichever of two phases is further along — the one to keep. A silent phase never replaces a
 * meaningful one; a terminal phase is never replaced.
 * @param {WatchPhase|undefined} stored
 * @param {WatchPhase} next
 * @returns {WatchPhase|undefined}
 */
export function laterPhase(stored, next) {
  if (!stored || stored === 'unknown') return next === 'unknown' ? stored : next;
  if (isForwardTransition(stored, next)) return next;
  // A confirmed state replaces the soft Likely Canceled without being news on its own
  // (scheduled after Likely Canceled: the provider withdrew the suspicion).
  if (stored === 'likely_canceled' && next === 'scheduled') return next;
  // A first Likely Canceled over a scheduled baseline is remembered (so a confirmation can follow),
  // but it is not a transition.
  if (stored === 'scheduled' && next === 'likely_canceled') return next;
  return stored;
}

/** Minutes late before a watch says "delayed" (the board's own 15-minute line). */
export const DELAY_ALERT_MIN = 15;

/**
 * The delay band a number of minutes falls in: 0 (on time), 15, 30, 60, then each further hour
 * (120, 180, …). A watch alerts when the band goes UP, never twice for the same band, and never
 * when an estimate wobbles back down and up again across the same line.
 *
 * @param {number|null|undefined} minutes
 * @returns {number}
 */
export function delayBucket(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m < DELAY_ALERT_MIN) return 0;
  if (m < 30) return 15;
  if (m < 60) return 30;
  return Math.floor(m / 60) * 60;
}

/**
 * Should a delay of `minutes` alert, given the highest band already announced (or baselined)?
 * Returns the new band when it should, otherwise null.
 *
 * @param {number|null|undefined} storedBucket
 * @param {number|null|undefined} minutes
 * @returns {number|null}
 */
export function delayEscalation(storedBucket, minutes) {
  const next = delayBucket(minutes);
  const prev = Number.isFinite(Number(storedBucket)) ? Number(storedBucket) : 0;
  return next > prev ? next : null;
}
