// ═══ "YOU'VE LOOKED UP 23 FLIGHTS HERE THIS MONTH" ═══
// A count of how many flights this visitor has opened in the flight panel this calendar month,
// kept in their own browser and never sent anywhere (no analytics property carries it). The
// deep-use support strip may lead with it, but only when it is true and meaningful:
//
//   - it is a count, never an estimate: each opening of the flight panel on a new flight adds
//     one (the dashboard skips re-opening the same flight within a page load);
//   - it is this browser's count for the visitor's own calendar month (their clock, not the
//     site's Central calendar: "this month" is theirs), and starts again at 0 on the 1st;
//   - below PERSONAL_COUNT_MIN it is never shown.
//
// Stored as `<YYYY-MM>:<count>`, e.g. `2026-11:23`. Every read and write is wrapped: a broken
// store means no count, never an error.

export const FLIGHT_COUNT_STORAGE_KEY = 'bb_flights_opened';
export const PERSONAL_COUNT_MIN = 5;

/** The visitor's own month, 'YYYY-MM', from their clock. */
export function localMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * @param {string|null|undefined} raw
 * @returns {{month: string, count: number}|null}
 */
export function parseFlightCount(raw) {
  const match = /^(\d{4}-\d{2}):(\d{1,6})$/.exec(String(raw ?? ''));
  return match ? { month: match[1], count: Number(match[2]) } : null;
}

/**
 * Flights opened this month in this browser; 0 when none, unreadable, or from another month.
 * @param {{getItem: Function}|null|undefined} storage
 * @param {Date} [now]
 */
export function readFlightCount(storage, now = new Date()) {
  if (!storage) return 0;
  try {
    const record = parseFlightCount(storage.getItem(FLIGHT_COUNT_STORAGE_KEY));
    return record && record.month === localMonthKey(now) ? record.count : 0;
  } catch {
    return 0;
  }
}

/**
 * Add one opened flight. Returns the new count, or null when it could not be stored.
 * @param {{getItem: Function, setItem: Function}|null|undefined} storage
 * @param {Date} [now]
 */
export function recordFlightOpen(storage, now = new Date()) {
  if (!storage) return null;
  try {
    const next = Math.min(readFlightCount(storage, now) + 1, 999999);
    storage.setItem(FLIGHT_COUNT_STORAGE_KEY, `${localMonthKey(now)}:${next}`);
    return next;
  } catch {
    return null;
  }
}

/**
 * The strip's lead sentence, or null below the threshold.
 * @param {number} count
 */
export function personalCountLine(count) {
  if (!Number.isInteger(count) || count < PERSONAL_COUNT_MIN) return null;
  return `You've looked up ${count} flights here this month.`;
}
