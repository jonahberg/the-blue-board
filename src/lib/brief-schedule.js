// ═══ OPS BRIEF: THE DAY'S SCHEDULE ═══
// How many hub departures were scheduled over the last four hours, against the usual for this time
// of day, so the in-the-air comparison (air.normal in src/lib/brief-facts.js) can tell a lighter
// schedule from a halt. Thanksgiving Day, Christmas and New Year's are scheduled light: without
// this, "far fewer flights in the air than usual" could read "Disrupted" on a day United simply
// planned fewer flights. A real halt does not touch this count (a held or canceled flight keeps its
// scheduled departure in flight_history), so it still trips the alarm on a light day.
//
// Pure: counts in, comparison out, no clock reads. The read is api/_brief-collect.ts
// loadScheduleCounts (count-only requests on flight_history, sql/021).
//
// Backtest (scripts/backtest-airborne-schedule.sql, every 5-minute airborne_samples row of Nov 7 to
// Nov 18 2026 against flight_history): on days with a full baseline (Nov 15 to 18) the scheduled
// ratio had a median of 1.00, 5th percentile 0.89, 95th 1.04 and a minimum of 0.65 (a light
// Tuesday night). Through the Nov 13 ground stop it stayed at 1.00 or above, so the stop reads
// exactly as before.
//
// The taper (v1.34.1, the same script, Nov 13 to Nov 27 2026): Thanksgiving's readable afternoon
// went from 11 "watch" samples to none, and no other group's watch or disrupted count moved. No sample
// of Nov 13 or 14 had a ratio under 0.90 while 25% or more short, so the backtest shows only that
// the taper leaves the stop alone; that a halt on a light day still trips is a synthetic test.

/** The trailing window of scheduled departures, in minutes. */
export const BRIEF_SCHEDULE_WINDOW_MIN = 240;
/** Earlier days the usual is the median of, at the same US wall clock (the same 7 as air.normal). */
export const BRIEF_SCHEDULE_DAYS = 7;
/** Fewer earlier days with any rows than this and there is no usual (flight_history began Nov 6 2026). */
export const BRIEF_SCHEDULE_MIN_DAYS = 3;
/**
 * A usual count below this is too small to compare: overnight the four-hour count is 40 to 150, and
 * a few flights either way swing the ratio (it read 0.62 to 1.48 between 1 and 4 AM CT). Above it
 * the ratio sits near 1. It is reached at about 5:15 AM PT and lost at about 11:30 PM PT.
 */
export const BRIEF_SCHEDULE_MIN_USUAL = 150;
/**
 * Today's count under this share of the usual is not believed: it is missing rows (the history
 * writer down, a board not yet written), not a schedule. No ordinary day went below 0.65.
 */
export const BRIEF_SCHEDULE_FLOOR_SHARE = 0.4;
/**
 * Only the part of a lighter schedule beyond this many percent counts: the same 10 as
 * BRIEF_AIRBORNE_USUAL_BAND_PCT ("about the usual"). Ordinary days run 0.89 to 1.04, and the 35/45
 * lines were set on raw counts that already carry that spread. Without it the Saturday after the
 * Nov 13 stop (a schedule 6 to 8% lighter than the weekday-heavy median) read "watch" on 10 of 25
 * samples between 5 and 7 AM PT instead of "disrupted"; with it, all 25 stay "disrupted".
 * Since v1.34.1 the band tapers (BRIEF_SCHEDULE_BAND_FULL_RATIO, BRIEF_SCHEDULE_BAND_NONE_RATIO).
 */
export const BRIEF_SCHEDULE_USUAL_BAND_PCT = 10;
/**
 * At this ratio and above the whole band applies, exactly as before v1.34.1: the ordinary
 * day-to-day spread (5th percentile 0.89) and the Saturday after the Nov 13 stop (0.92 to 0.94).
 */
export const BRIEF_SCHEDULE_BAND_FULL_RATIO = 0.9;
/**
 * At this ratio and below none of the band applies: the usual is scaled by the ratio itself. Between
 * the two the band shrinks in a straight line. A flat 10 points was meant for an ordinary spread;
 * on a schedule half the usual it raised the expected count by about 19%. Thanksgiving Day 2026 at
 * 3:10 PM PT: 281 in the air against a usual 680 on a schedule of 354 against 660 (ratio 0.536). The
 * flat band expected 432 and read 35% short, "watch"; with none it expects 364, 23% short.
 */
export const BRIEF_SCHEDULE_BAND_NONE_RATIO = 0.7;

/** How far `tz`'s wall clock is ahead of UTC at `ms`, in milliseconds (negative in the Americas). */
function tzOffsetMs(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const part = (type) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')) - Math.floor(ms / 1000) * 1000;
}
/**
 * The instant `daysBack` days earlier that shows the same wall-clock time in the US: what "the usual
 * for this time of day" is compared with. Exactly 24 hours a day except across a clock change,
 * where the schedule moves an hour against UTC (the US zones change together, so one stands for all).
 * @param {number} nowMs
 * @param {number} daysBack
 * @param {string} [tz]
 * @returns {number}
 */
export function sameClockDaysBefore(nowMs, daysBack, tz = 'America/Chicago') {
  const naive = nowMs - daysBack * 86_400_000;
  return naive + tzOffsetMs(nowMs, tz) - tzOffsetMs(naive, tz);
}

const utcDate = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * The windows to count: today's (`daysBack` 0, ending now) and the same clock time on each earlier
 * day. Minutes are epoch minutes (flight_history.sched_dep), the window is [startMin, endMin).
 * `fromDate`..`toDate` bound service_date a day either side of the window's UTC dates, so the BRIN
 * index narrows the scan: a hub's board day is its own local date, a day behind UTC in the US and a
 * day ahead at Narita and Guam.
 * @param {number} nowMs
 * @param {{days?: number, windowMin?: number}} [options]
 * @returns {Array<{daysBack: number, startMin: number, endMin: number, fromDate: string, toDate: string}>}
 */
export function scheduleWindows(nowMs, { days = BRIEF_SCHEDULE_DAYS, windowMin = BRIEF_SCHEDULE_WINDOW_MIN } = {}) {
  const out = [];
  for (let d = 0; d <= days; d++) {
    const endMin = Math.floor((d === 0 ? nowMs : sameClockDaysBefore(nowMs, d)) / 60_000);
    const startMin = endMin - windowMin;
    out.push({ daysBack: d, startMin, endMin, fromDate: utcDate(startMin * 60_000 - 86_400_000), toDate: utcDate(endMin * 60_000 + 86_400_000) });
  }
  return out;
}

function median(sorted) {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * @typedef {{today: number|null, prior: Array<number|null>, error?: string}} ScheduleCounts
 *   What the read returned: today's count and one per earlier day (null = that count failed).
 * @typedef {{status: 'ok', windowMin: number, today: number, usual: number, days: number,
 *   ratio: number, factor: number}
 *   | {status: 'unavailable', windowMin: number, reason: string, today: number|null,
 *   usual: number|null, days: number}} ScheduleComparison
 */

/**
 * Today's scheduled departures against the usual, and the factor the usual airborne count is
 * scaled by: min(1, ratio + 0.10 × t), where t = (ratio − 0.70) / (0.90 − 0.70) held between 0 and
 * 1 (BRIEF_SCHEDULE_BAND_NONE_RATIO, BRIEF_SCHEDULE_BAND_FULL_RATIO). From 0.90 that is the whole
 * 10-point band, at 0.70 and below none of it. Capped at 1, so a heavier schedule never raises the bar.
 * Unavailable (the comparison is unscaled, exactly as before) when the read failed, fewer than
 * BRIEF_SCHEDULE_MIN_DAYS earlier days have rows, the usual is under BRIEF_SCHEDULE_MIN_USUAL, or
 * today is under BRIEF_SCHEDULE_FLOOR_SHARE of the usual. An earlier day with no rows is no data,
 * not a day with no flights.
 * @param {ScheduleCounts|null|undefined} counts
 * @returns {ScheduleComparison}
 */
export function scheduleComparison(counts) {
  const windowMin = BRIEF_SCHEDULE_WINDOW_MIN;
  const today = Number.isFinite(counts?.today) ? Number(counts?.today) : null;
  const prior = (counts?.prior || []).filter((n) => Number.isFinite(n) && Number(n) > 0).map(Number).sort((a, b) => a - b);
  const usual = prior.length ? median(prior) : null;
  const unavailable = (reason) => ({ status: /** @type {const} */ ('unavailable'), windowMin, reason, today, usual, days: prior.length });
  if (!counts) return unavailable('not_read');
  if (today === null) return unavailable(counts.error || 'read_failed');
  if (prior.length < BRIEF_SCHEDULE_MIN_DAYS || usual === null) return unavailable('too_few_days');
  if (usual < BRIEF_SCHEDULE_MIN_USUAL) return unavailable('usual_too_small');
  if (today < BRIEF_SCHEDULE_FLOOR_SHARE * usual) return unavailable('today_too_thin');
  const ratio = today / usual;
  const taper = Math.min(1, Math.max(0, (ratio - BRIEF_SCHEDULE_BAND_NONE_RATIO) / (BRIEF_SCHEDULE_BAND_FULL_RATIO - BRIEF_SCHEDULE_BAND_NONE_RATIO)));
  const factor = Math.min(1, ratio + (BRIEF_SCHEDULE_USUAL_BAND_PCT / 100) * taper);
  return { status: 'ok', windowMin, today, usual, days: prior.length, ratio: round3(ratio), factor: round3(factor) };
}

/**
 * How many percent fewer departures were scheduled than usual, as a traveler reads it ("about 30%
 * fewer"), or null when the schedule is not lighter beyond the usual spread (factor 1).
 * @param {ScheduleComparison|null|undefined} comparison
 * @returns {number|null}
 */
export function lighterSchedulePct(comparison) {
  if (comparison?.status !== 'ok' || !(comparison.factor < 1)) return null;
  return Math.round((1 - comparison.today / comparison.usual) * 100);
}

/** The Central-time calendar date at `ms`, as YYYY-MM-DD. */
export function centralDate(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

/** The fourth Thursday of November of `year`, as YYYY-MM-DD. */
export function thanksgivingDate(year) {
  const firstDow = new Date(Date.UTC(year, 10, 1)).getUTCDay();
  const day = 1 + ((4 - firstDow + 7) % 7) + 21;
  return `${year}-11-${String(day).padStart(2, '0')}`;
}

/**
 * The days United schedules far fewer flights, by US Central date. This list is ONLY the fallback
 * for a day the schedule cannot be read or trusted: on these dates, and the morning after until 6 AM
 * Central (lightScheduleDayOrMorningAfter), a shortfall in the air then sets no tone, rather than
 * risk a false "Disrupted". It is not how the brief normally allows for a light day; the schedule
 * count is.
 * @param {number} ms
 * @returns {string|null} the day's name, or null on any other day
 */
export function lightScheduleHoliday(ms) {
  const date = centralDate(ms);
  const monthDay = date.slice(5);
  if (date === thanksgivingDate(Number(date.slice(0, 4)))) return 'Thanksgiving Day';
  if (monthDay === '12-24') return 'Christmas Eve';
  if (monthDay === '12-25') return 'Christmas Day';
  if (monthDay === '12-31') return "New Year's Eve";
  if (monthDay === '01-01') return "New Year's Day";
  return null;
}

/** The morning after a light-schedule date still counts as it, until this Central hour. */
const MORNING_AFTER_UNTIL_HOUR_CT = 6;

/**
 * One of the five light-schedule dates, or the morning after one until 6:00 AM Central: from the
 * late evening until about 5:15 AM PT the four-hour schedule count is too small to use, while the
 * flights in the air are still the holiday evening's light red-eyes. The fallback (a calm tone when
 * the schedule cannot be used) has to cover those hours too, or the small hours of the Friday after
 * Thanksgiving, Dec 26 and Jan 2 could read a false "watch" or "disrupted".
 * @param {number} ms
 * @returns {string|null} "Thanksgiving Day", "the morning after Thanksgiving Day", …, or null
 */
export function lightScheduleDayOrMorningAfter(ms) {
  const today = lightScheduleHoliday(ms);
  if (today) return today;
  const earlier = lightScheduleHoliday(ms - MORNING_AFTER_UNTIL_HOUR_CT * 3_600_000);
  return earlier ? `the morning after ${earlier}` : null;
}
