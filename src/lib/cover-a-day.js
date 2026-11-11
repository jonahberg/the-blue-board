// ═══ COVER A DAY ═══
// The Blue Board costs about $500 a month to run, about $17 a day. A donation "covers a day":
//
//   - $17 keeps the site running for one day (DAILY_COST_CENTS).
//   - Money received in a calendar month covers THAT month's days, in order from the 1st, in
//     the order the payments arrived. $17 covers one day; $50 covers two and leaves $16 toward
//     the next; small amounts pool until a day is whole. A day that more than one payment paid
//     for is "covered by N supporters".
//   - The calendar is US Central (`COVER_TIME_ZONE`, America/Chicago, the owner's and United's
//     home zone). A payment's month is its paid time's month in Central, and "today" is
//     Central's date. Money never carries into the next month, and a month's surplus beyond
//     its last day covers nothing further.
//   - Only US dollars count. A refund takes its amount back out (a full refund removes the
//     payment), so coverage can go DOWN and later days shift.
//
// So on the 10th, with three days' worth received, days 1-3 are covered and today is not:
// "Today isn't covered yet" is the truth, and a $17 payment now covers the 4th, not today.
// Every sentence a visitor reads is built here (and in the strip's lead, usage-count.js) so
// that rule cannot drift between the API, the About section and the strip.
//
// DOM-free and import-light: api/support-status.ts builds its body with `supportStatusFromRows`,
// and the dashboard reads it back with `parseSupportStatus`.

import { personalCountLine } from './usage-count.js';
import { SUPPORTER_FALLBACK_LABEL, supporterIdentityKey, supporterLabel } from './supporter-name.js';

export const COVER_TIME_ZONE = 'America/Chicago';
export const DAILY_COST_CENTS = 1700;
export const DAILY_COST_USD = DAILY_COST_CENTS / 100;
/** The owner's figure for the whole site, per month. Copy only; the unit is the day. */
export const MONTHLY_COST_USD = 500;
export const COUNTED_CURRENCY = 'usd';

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmtCache = new Map();
function zoneFormatter(timeZone) {
  let fmt = fmtCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hourCycle: 'h23',
    });
    fmtCache.set(timeZone, fmt);
  }
  return fmt;
}

function zonedParts(ms, timeZone) {
  const out = {};
  for (const part of zoneFormatter(timeZone).formatToParts(new Date(ms))) out[part.type] = Number(part.value);
  if (out.hour === 24) out.hour = 0;
  return out;
}

/**
 * The calendar date of an instant in a zone.
 * @param {number} ms
 * @param {string} [timeZone]
 * @returns {{year: number, month: number, day: number}} month is 1-12
 */
export function zonedDate(ms, timeZone = COVER_TIME_ZONE) {
  const p = zonedParts(ms, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

/** @param {number} year @param {number} month 1-12 */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 'YYYY-MM' */
export function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * The UTC instant of local midnight at the start of a date in a zone. DST-safe: the offset is
 * measured at the guess and corrected once, so a month that starts the day DST ends (Central,
 * Nov 1 2026: midnight is 05:00Z, not 06:00Z) lands on the real midnight.
 */
export function zonedMidnightUtcMs(year, month, day, timeZone = COVER_TIME_ZONE) {
  const wallAsUtc = Date.UTC(year, month - 1, day);
  let guess = wallAsUtc;
  for (let i = 0; i < 3; i += 1) {
    const p = zonedParts(guess, timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const drift = seen - wallAsUtc;
    if (drift === 0) break;
    guess -= drift;
  }
  return guess;
}

/** [startMs, endMs) of a calendar month in a zone. */
export function monthBoundsUtc(year, month, timeZone = COVER_TIME_ZONE) {
  const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return {
    startMs: zonedMidnightUtcMs(year, month, 1, timeZone),
    endMs: zonedMidnightUtcMs(next.year, next.month, 1, timeZone),
  };
}

/** The month name, "November". */
export function monthName(month) {
  return MONTHS_LONG[month - 1] ?? '';
}

/** "Nov 16" */
export function shortDate(month, day) {
  return `${MONTHS_SHORT[month - 1] ?? ''} ${day}`;
}

const isInt = (v) => Number.isInteger(v);

/**
 * What a stored payment still contributes, in cents: the amount less anything refunded, and
 * nothing at all once it is fully refunded. Bad numbers contribute nothing.
 * @param {{amount_cents?: unknown, refunded?: unknown, amount_refunded_cents?: unknown}} row
 */
export function netCents(row) {
  if (!row || row.refunded === true) return 0;
  const amount = isInt(row.amount_cents) && row.amount_cents > 0 ? row.amount_cents : 0;
  const refunded = isInt(row.amount_refunded_cents) && row.amount_refunded_cents > 0 ? row.amount_refunded_cents : 0;
  return Math.max(0, amount - refunded);
}

function paidMs(row) {
  const ms = typeof row?.paid_at === 'number' ? row.paid_at : Date.parse(String(row?.paid_at ?? ''));
  return Number.isFinite(ms) ? ms : NaN;
}

/** Arrival order: paid time, then the row id (or session id), so equal times never reorder. */
export function compareArrival(a, b) {
  const d = paidMs(a) - paidMs(b);
  if (d !== 0) return d;
  const ia = a?.id ?? a?.session_id ?? '';
  const ib = b?.id ?? b?.session_id ?? '';
  if (typeof ia === 'number' && typeof ib === 'number') return ia - ib;
  return String(ia) < String(ib) ? -1 : String(ia) > String(ib) ? 1 : 0;
}

/**
 * Lay one month's payments over its days.
 *
 * @param {Array<object>} rows this month's counted payments (any order)
 * @param {{days: number, dailyCostCents?: number}} opts
 * @returns {{daysCovered: number, towardNextCents: number,
 *   days: Array<{day: number, rows: object[]}>}} `days` lists the covered days only, each with
 *   every payment that put money into it.
 */
export function allocateMonth(rows, { days, dailyCostCents = DAILY_COST_CENTS }) {
  const ordered = (rows || []).filter((row) => netCents(row) > 0).sort(compareArrival);
  const spans = [];
  let total = 0;
  for (const row of ordered) {
    const net = netCents(row);
    spans.push({ row, from: total, to: total + net });
    total += net;
  }
  const daysCovered = Math.min(days, Math.floor(total / dailyCostCents));
  const towardNextCents = daysCovered >= days ? 0 : total - daysCovered * dailyCostCents;

  const covered = [];
  for (let day = 1; day <= daysCovered; day += 1) {
    const lo = (day - 1) * dailyCostCents;
    const hi = day * dailyCostCents;
    covered.push({ day, rows: spans.filter((s) => s.from < hi && s.to > lo).map((s) => s.row) });
  }
  return { daysCovered, towardNextCents, days: covered };
}

/**
 * Who covered a day, worded for the page: one supporter's shown name, "a supporter", or
 * "N supporters" when several people's money pooled into it. The same typed name twice is
 * one person; payments with no name each count as one.
 *
 * @param {object[]} rows the payments that paid into the day
 * @param {{namesOn?: boolean}} [opts]
 */
export function coveredByLabel(rows, { namesOn = true } = {}) {
  const groups = new Map();
  let anonymous = 0;
  for (const row of rows || []) {
    const key = supporterIdentityKey(row);
    if (!key) {
      anonymous += 1;
      groups.set(`#${anonymous}`, [row]);
    } else {
      groups.set(key, [...(groups.get(key) || []), row]);
    }
  }
  if (groups.size === 0) return supporterLabel(null);
  if (groups.size > 1) return `${groups.size} supporters`;
  const [only] = groups.values();
  // The same person twice: any hidden row hides the name.
  if (only.some((row) => row.hidden === true)) return supporterLabel(null);
  return supporterLabel(only[0], { namesOn });
}

/**
 * The public body of GET /api/support-status for the month containing `nowMs`.
 * Nothing per person beyond the shown label, and no dollar figures except the daily cost.
 *
 * @param {object[]} rows stored payments (supporter_payments)
 * @param {number} nowMs
 * @param {{timeZone?: string, namesOn?: boolean, dailyCostCents?: number}} [opts]
 */
export function supportStatusFromRows(rows, nowMs, { timeZone = COVER_TIME_ZONE, namesOn = true, dailyCostCents = DAILY_COST_CENTS } = {}) {
  const today = zonedDate(nowMs, timeZone);
  const days = daysInMonth(today.year, today.month);
  const inMonth = (rows || []).filter((row) => {
    if (String(row?.currency ?? '').toLowerCase() !== COUNTED_CURRENCY) return false;
    const ms = paidMs(row);
    if (!Number.isFinite(ms) || ms > nowMs) return false;
    const d = zonedDate(ms, timeZone);
    return d.year === today.year && d.month === today.month;
  });
  const allocation = allocateMonth(inMonth, { days, dailyCostCents });
  const labelled = allocation.days.map(({ day, rows: paidBy }) => ({ day, by: coveredByLabel(paidBy, { namesOn }) }));
  const todayCovered = allocation.daysCovered >= today.day;
  return {
    configured: true,
    timeZone,
    month: monthKey(today.year, today.month),
    daysInMonth: days,
    today: today.day,
    daysCovered: allocation.daysCovered,
    todayCovered,
    todayBy: todayCovered ? labelled[today.day - 1].by : null,
    days: labelled,
    dailyCostUsd: dailyCostCents / 100,
  };
}

/** What the page shows when there is no truthful coverage to report. */
export const UNCONFIGURED_STATUS = Object.freeze({ configured: false });

/**
 * Read /api/support-status back, defensively. Anything malformed, or a body for a different
 * Central date than the visitor's clock says it is now (a cached answer straddling midnight),
 * becomes `{configured: false}`: the page then makes no coverage claim at all.
 *
 * @param {unknown} json
 * @param {number} nowMs
 * @returns {{configured: false} | {configured: true, year: number, month: number, daysInMonth: number,
 *   today: number, daysCovered: number, todayCovered: boolean, todayBy: string|null,
 *   days: Array<{day: number, by: string}>, dailyCostUsd: number}}
 */
export function parseSupportStatus(json, nowMs) {
  if (!json || typeof json !== 'object' || json.configured !== true) return UNCONFIGURED_STATUS;
  const match = /^(\d{4})-(\d{2})$/.exec(String(json.month ?? ''));
  if (!match) return UNCONFIGURED_STATUS;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const days = daysInMonth(year, month);
  const { daysCovered, today, todayCovered, todayBy } = json;
  if (json.daysInMonth !== days) return UNCONFIGURED_STATUS;
  if (!isInt(today) || today < 1 || today > days) return UNCONFIGURED_STATUS;
  if (!isInt(daysCovered) || daysCovered < 0 || daysCovered > days) return UNCONFIGURED_STATUS;
  if (todayCovered !== daysCovered >= today) return UNCONFIGURED_STATUS;
  if (todayCovered ? typeof todayBy !== 'string' || !todayBy : todayBy !== null) return UNCONFIGURED_STATUS;
  if (!Array.isArray(json.days) || json.days.length !== daysCovered) return UNCONFIGURED_STATUS;
  const labelled = json.days.map((d, i) => (d && d.day === i + 1 && typeof d.by === 'string' && d.by ? { day: d.day, by: d.by } : null));
  if (labelled.some((d) => d === null)) return UNCONFIGURED_STATUS;

  const tz = typeof json.timeZone === 'string' ? json.timeZone : COVER_TIME_ZONE;
  let now;
  try {
    now = zonedDate(nowMs, tz);
  } catch {
    return UNCONFIGURED_STATUS;
  }
  if (now.year !== year || now.month !== month || now.day !== today) return UNCONFIGURED_STATUS;

  return {
    configured: true,
    year,
    month,
    daysInMonth: days,
    today,
    daysCovered,
    todayCovered,
    todayBy: todayCovered ? todayBy : null,
    days: /** @type {Array<{day: number, by: string}>} */ (labelled),
    dailyCostUsd: Number.isFinite(json.dailyCostUsd) && json.dailyCostUsd > 0 ? json.dailyCostUsd : DAILY_COST_USD,
  };
}

/** End a sentence on a label without doubling an initial's period ("Dana R." not "Dana R.."). */
export function sentenceEnd(label) {
  return /\.$/.test(label) ? label : `${label}.`;
}

/** The first day of the month not yet covered, or null when every day is. */
export function nextOpenDay(status) {
  if (!status?.configured) return null;
  return status.daysCovered >= status.daysInMonth ? null : status.daysCovered + 1;
}

/** Every day of this month is covered. */
export function monthFullyCovered(status) {
  return Boolean(status?.configured) && status.daysCovered >= status.daysInMonth;
}

/**
 * The one line of truth: "Today is covered by Dana R." / "Today isn't covered yet.", or null
 * when there is nothing true to say about today.
 */
export function todayLine(status) {
  if (!status?.configured) return null;
  return status.todayCovered ? `Today is covered by ${sentenceEnd(status.todayBy)}` : "Today isn't covered yet.";
}

/** "3 of 30 days covered" */
export function coveredCountLine(status) {
  if (!status?.configured) return null;
  return `${status.daysCovered} of ${status.daysInMonth} days covered`;
}

/**
 * The About section's month calendar: leading blanks for the weekday of the 1st (Sunday
 * first), then one cell per day.
 */
export function calendarCells(status) {
  if (!status?.configured) return null;
  const leadingBlanks = new Date(Date.UTC(status.year, status.month - 1, 1)).getUTCDay();
  const cells = [];
  for (let day = 1; day <= status.daysInMonth; day += 1) {
    const covered = day <= status.daysCovered;
    cells.push({
      day,
      covered,
      today: day === status.today,
      by: covered ? status.days[day - 1].by : null,
      // The words a screen reader (and a hovering mouse) gets for the cell.
      label: `${monthName(status.month)} ${day}${day === status.today ? ', today' : ''}: ${covered ? `covered by ${status.days[day - 1].by}` : 'open'}`,
    });
  }
  return { leadingBlanks, cells };
}

/**
 * "Who covered which day", with consecutive days under the same shown NAME folded together:
 * [{from: 1, to: 2, by: 'Dana R.', text: 'Nov 1–2'}, …]. "a supporter" and "N supporters" are
 * never folded: two anonymous days may be two different people.
 */
export function coverageRuns(status) {
  if (!status?.configured) return [];
  const runs = [];
  for (const { day, by } of status.days) {
    const last = runs[runs.length - 1];
    const foldable = by !== SUPPORTER_FALLBACK_LABEL && !/^\d+ supporters$/.test(by);
    if (foldable && last && last.by === by && last.to === day - 1) last.to = day;
    else runs.push({ from: day, to: day, by });
  }
  return runs.map((run) => ({
    ...run,
    text: run.from === run.to ? shortDate(status.month, run.from) : `${shortDate(status.month, run.from)}–${run.to}`,
  }));
}

/**
 * The deep-use strip's words, or null when there is nothing honest to ask for (every day of
 * the month is already covered).
 *
 * `text` is the full sentence for a wide screen; `short` the phone version. `lead` is the
 * visitor's own count of flights looked up this month, only when it is true and at least
 * PERSONAL_COUNT_MIN (src/lib/usage-count.js), or null.
 *
 * @param {ReturnType<typeof parseSupportStatus>} status
 * @param {{flightsThisMonth?: number}} [opts]
 * @returns {{lead: string|null, text: string, short: string}|null}
 */
export function supportStripCopy(status, { flightsThisMonth = 0 } = {}) {
  const lead = personalCountLine(flightsThisMonth);
  const cost = `$${DAILY_COST_USD}`;
  if (!status?.configured) {
    return { lead, text: `${cost} keeps The Blue Board running for a day.`, short: `${cost} keeps it running for a day.` };
  }
  const next = nextOpenDay(status);
  if (next === null) return null;
  if (!status.todayCovered) {
    return { lead, text: `Today isn't covered yet. ${cost} keeps The Blue Board running for a day.`, short: "Today isn't covered yet." };
  }
  if (next === status.today + 1) {
    return {
      lead,
      text: `Today is covered, thanks to ${sentenceEnd(status.todayBy)} ${cost} keeps The Blue Board running tomorrow.`,
      short: "Today is covered. Tomorrow isn't yet.",
    };
  }
  return {
    lead,
    text: `Today is covered, thanks to ${sentenceEnd(status.todayBy)} ${cost} covers the next open day, ${shortDate(status.month, next)}.`,
    short: `Covered through ${shortDate(status.month, next - 1)}.`,
  };
}
