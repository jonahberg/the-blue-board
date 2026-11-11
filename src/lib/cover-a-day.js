// ═══ COVER A DAY ═══
// The Blue Board costs about $500 a month to run, about $17 a day. A donation "covers a day":
//
//   - $17 keeps the site running for one day (DAILY_COST_CENTS).
//   - A payment covers THE DAY IT IS MADE (its US Central date), or, if that day is already
//     covered, the first open day after it. Never a day before it: a later payment never claims
//     a past day, and days before any payment, or gaps between them, simply stay open.
//   - Payments are taken in paid-time order over everything on record (not month by month),
//     with one running pool of leftovers. For each payment, available = pool + its net amount;
//     while that is at least $17, the first open day on or after the payment's date is covered
//     and $17 is taken, oldest money first (the pool before the new payment). What is left
//     becomes the pool. So $17 today covers today; $50 today covers today and tomorrow and pools
//     $16; a later $5 finishes the next day with that $16. A day paid for entirely by one payment
//     is that supporter's; a day that used anyone else's pooled money is "N supporters".
//   - Coverage runs forward across month ends: $40 on Nov 30 covers Nov 30 and Dec 1.
//   - The calendar is US Central (`COVER_TIME_ZONE`, America/Chicago, the owner's and United's
//     home zone): a payment's day is its Central date, and "today" is Central's date.
//   - Only US dollars count. Refunds are recomputed from the remaining net amounts (a full refund
//     removes the payment), so coverage can go DOWN and other days can move.
//
// Every sentence a visitor reads about it is built here (and the strip's lead in
// usage-count.js) so that the rule cannot drift between the API, the About section, the menu,
// the strip and the button labels.
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
/**
 * The strip stays down while today and the next STRIP_COVERED_HORIZON_DAYS days are all covered:
 * an ask for a day two weeks out is not an ask about now.
 */
export const STRIP_COVERED_HORIZON_DAYS = 14;
/** How far ahead "the next open day" is looked for. Past this the answer is "none soon". */
export const NEXT_OPEN_SEARCH_DAYS = 366;
/** A ceiling on days one payment can cover (ten years), so a bad amount cannot spin the loop. */
const MAX_DAYS_PER_PAYMENT = 3660;

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

/** 'YYYY-MM-DD' — sorts as text in date order. */
export function dateKey(year, month, day) {
  return `${monthKey(year, month)}-${String(day).padStart(2, '0')}`;
}

/** @param {string} key 'YYYY-MM-DD' */
export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''));
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}

/** A calendar date plus n days (calendar arithmetic, no time zone involved). */
export function addDays(key, n) {
  const d = parseDateKey(key);
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return dateKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The Central date of an instant, as 'YYYY-MM-DD'. */
export function zonedDateKey(ms, timeZone = COVER_TIME_ZONE) {
  const d = zonedDate(ms, timeZone);
  return dateKey(d.year, d.month, d.day);
}

/**
 * The UTC instant of local midnight at the start of a date in a zone. DST-safe: the offset is
 * measured at the guess and corrected, so a month that starts the day DST ends (Central, Nov 1
 * 2026: midnight is 05:00Z, not 06:00Z) lands on the real midnight.
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

/** "Nov 16" from 'YYYY-MM-DD'. */
export function shortDateKey(key) {
  const d = parseDateKey(key);
  return d ? shortDate(d.month, d.day) : '';
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
 * Lay every payment over the calendar (the rule in the header).
 *
 * @param {Array<object>} rows payments that count (USD, live where it matters), any order
 * @param {{timeZone?: string, dailyCostCents?: number}} [opts]
 * @returns {{covered: Map<string, object[]>, poolCents: number}} `covered` maps each covered
 *   Central date ('YYYY-MM-DD') to the payments whose money paid for it, oldest first.
 */
export function allocateDays(rows, { timeZone = COVER_TIME_ZONE, dailyCostCents = DAILY_COST_CENTS } = {}) {
  const ordered = (rows || []).filter((row) => netCents(row) > 0 && Number.isFinite(paidMs(row))).sort(compareArrival);
  const covered = new Map();
  /** Unspent money, oldest first: [{row, cents}]. */
  const pool = [];
  let available = 0;
  for (const row of ordered) {
    const net = netCents(row);
    pool.push({ row, cents: net });
    available += net;
    let cursor = zonedDateKey(paidMs(row), timeZone);
    let days = 0;
    while (available >= dailyCostCents && days < MAX_DAYS_PER_PAYMENT) {
      while (covered.has(cursor)) cursor = addDays(cursor, 1);
      const paidBy = [];
      let need = dailyCostCents;
      while (need > 0) {
        const chunk = pool[0];
        const take = Math.min(chunk.cents, need);
        chunk.cents -= take;
        need -= take;
        if (!paidBy.includes(chunk.row)) paidBy.push(chunk.row);
        if (chunk.cents === 0) pool.shift();
      }
      covered.set(cursor, paidBy);
      available -= dailyCostCents;
      cursor = addDays(cursor, 1);
      days += 1;
    }
  }
  return { covered, poolCents: available };
}

/**
 * Who covered a day, worded for the page: one supporter's shown name, "a supporter", or
 * "N supporters" when several people's money paid for it. The same typed name twice is one
 * person; payments with no name each count as one.
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
 * The public body of GET /api/support-status for the Central month containing `nowMs`,
 * computed from the allocation over every payment given (so money carried over from an
 * earlier month shows). Nothing per person beyond the shown label, and no dollar figures
 * except the daily cost.
 *
 * @param {object[]} rows stored payments (supporter_payments)
 * @param {number} nowMs
 * @param {{timeZone?: string, namesOn?: boolean, dailyCostCents?: number}} [opts]
 */
export function supportStatusFromRows(rows, nowMs, { timeZone = COVER_TIME_ZONE, namesOn = true, dailyCostCents = DAILY_COST_CENTS } = {}) {
  const today = zonedDate(nowMs, timeZone);
  const todayKey = dateKey(today.year, today.month, today.day);
  const days = daysInMonth(today.year, today.month);
  const counted = (rows || []).filter((row) => {
    if (String(row?.currency ?? '').toLowerCase() !== COUNTED_CURRENCY) return false;
    const ms = paidMs(row);
    return Number.isFinite(ms) && ms <= nowMs;
  });
  const { covered } = allocateDays(counted, { timeZone, dailyCostCents });

  const labelled = [];
  for (let day = 1; day <= days; day += 1) {
    const paidBy = covered.get(dateKey(today.year, today.month, day));
    if (paidBy) labelled.push({ day, by: coveredByLabel(paidBy, { namesOn }) });
  }
  let nextOpenDate = null;
  for (let i = 0, key = todayKey; i <= NEXT_OPEN_SEARCH_DAYS; i += 1, key = addDays(key, 1)) {
    if (!covered.has(key)) {
      nextOpenDate = key;
      break;
    }
  }
  const todayCovered = covered.has(todayKey);
  return {
    configured: true,
    timeZone,
    month: monthKey(today.year, today.month),
    daysInMonth: days,
    today: today.day,
    daysCovered: labelled.length,
    todayCovered,
    todayBy: todayCovered ? labelled.find((d) => d.day === today.day).by : null,
    nextOpenDate,
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
 *   nextOpenDate: string|null, days: Array<{day: number, by: string}>, dailyCostUsd: number}}
 */
export function parseSupportStatus(json, nowMs) {
  if (!json || typeof json !== 'object' || json.configured !== true) return UNCONFIGURED_STATUS;
  const match = /^(\d{4})-(\d{2})$/.exec(String(json.month ?? ''));
  if (!match) return UNCONFIGURED_STATUS;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const days = daysInMonth(year, month);
  const { daysCovered, today, todayCovered, todayBy, nextOpenDate } = json;
  if (json.daysInMonth !== days) return UNCONFIGURED_STATUS;
  if (!isInt(today) || today < 1 || today > days) return UNCONFIGURED_STATUS;
  if (!Array.isArray(json.days) || !isInt(daysCovered) || json.days.length !== daysCovered) return UNCONFIGURED_STATUS;
  let previous = 0;
  const labelled = [];
  for (const d of json.days) {
    if (!d || !isInt(d.day) || d.day <= previous || d.day > days || typeof d.by !== 'string' || !d.by) return UNCONFIGURED_STATUS;
    previous = d.day;
    labelled.push({ day: d.day, by: d.by });
  }
  const todayEntry = labelled.find((d) => d.day === today);
  if (todayCovered !== Boolean(todayEntry)) return UNCONFIGURED_STATUS;
  if (todayCovered ? todayBy !== todayEntry.by : todayBy !== null) return UNCONFIGURED_STATUS;
  // The calendar must agree with the next open day: every day from today up to it is covered,
  // and it (when it falls in this month) is not. null means nothing is open within a year, so
  // the rest of this month must be covered.
  const todayKey = dateKey(year, month, today);
  const coveredDays = new Set(labelled.map((d) => d.day));
  let lastCovered = days;
  if (nextOpenDate !== null) {
    const next = typeof nextOpenDate === 'string' ? parseDateKey(nextOpenDate) : null;
    if (!next || nextOpenDate < todayKey) return UNCONFIGURED_STATUS;
    if ((nextOpenDate === todayKey) === todayCovered) return UNCONFIGURED_STATUS;
    const sameMonth = next.year === year && next.month === month;
    if (sameMonth && coveredDays.has(next.day)) return UNCONFIGURED_STATUS;
    if (sameMonth) lastCovered = next.day - 1;
  }
  for (let d = today; d <= lastCovered; d += 1) if (!coveredDays.has(d)) return UNCONFIGURED_STATUS;

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
    nextOpenDate,
    days: labelled,
    dailyCostUsd: Number.isFinite(json.dailyCostUsd) && json.dailyCostUsd > 0 ? json.dailyCostUsd : DAILY_COST_USD,
  };
}

/**
 * Which day a $17 given right now would cover: 'today', 'tomorrow', 'next' (a later open day,
 * `date`), or null when it cannot be said (status unknown, or nothing open within a year).
 * @returns {{kind: 'today'|'tomorrow'|'next', date: string}|null}
 */
export function coverTarget(status) {
  if (!status?.configured || !status.nextOpenDate) return null;
  const todayKey = dateKey(status.year, status.month, status.today);
  if (status.nextOpenDate === todayKey) return { kind: 'today', date: todayKey };
  if (status.nextOpenDate === addDays(todayKey, 1)) return { kind: 'tomorrow', date: status.nextOpenDate };
  return { kind: 'next', date: status.nextOpenDate };
}

/**
 * The button: "Cover today · $17" / "Cover tomorrow · $17" / "Cover the next open day · $17",
 * "Cover a day · $17" while the status is unknown, "Support The Blue Board" when nothing is open
 * within a year.
 */
export function coverButtonLabel(status) {
  const cost = `$${DAILY_COST_USD}`;
  if (!status?.configured) return `Cover a day · ${cost}`;
  const target = coverTarget(status);
  if (!target) return 'Support The Blue Board';
  if (target.kind === 'today') return `Cover today · ${cost}`;
  if (target.kind === 'tomorrow') return `Cover tomorrow · ${cost}`;
  return `Cover the next open day · ${cost}`;
}

/** The rule in one line, for under the calendar. */
export const COVER_RULE_LINE = `Each $${DAILY_COST_USD} covers the day it is given, or the next open day after it.`;

/** End a sentence on a label without doubling an initial's period ("Dana R." not "Dana R.."). */
export function sentenceEnd(label) {
  return /\.$/.test(label) ? label : `${label}.`;
}

/** Every day of the current month is covered. */
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

/**
 * The ⓘ menu's second sentence: what $17 would do right now. "$17 covers today." /
 * "$17 covers tomorrow." / "$17 covers the next open day, Nov 16." / null.
 */
export function coverSentence(status) {
  const target = coverTarget(status);
  if (!target) return null;
  const cost = `$${DAILY_COST_USD}`;
  if (target.kind === 'today') return `${cost} covers today.`;
  if (target.kind === 'tomorrow') return `${cost} covers tomorrow.`;
  return `${cost} covers the next open day, ${shortDateKey(target.date)}.`;
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
  const byDay = new Map(status.days.map((d) => [d.day, d.by]));
  const cells = [];
  for (let day = 1; day <= status.daysInMonth; day += 1) {
    const by = byDay.get(day) ?? null;
    const covered = by !== null;
    cells.push({
      day,
      covered,
      today: day === status.today,
      by,
      // The words a screen reader (and a hovering mouse) gets for the cell.
      label: `${monthName(status.month)} ${day}${day === status.today ? ', today' : ''}: ${covered ? `covered by ${by}` : 'open'}`,
    });
  }
  return { leadingBlanks, cells };
}

/**
 * "Who covered which day", with consecutive days under the same shown NAME folded together:
 * [{from: 10, to: 11, by: 'Dana R.', text: 'Nov 10–11'}, …]. "a supporter" and "N supporters" are
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
 * The deep-use strip's words and button, or null when there is nothing honest to ask about now
 * (today and the next STRIP_COVERED_HORIZON_DAYS days all covered).
 *
 * `text` is the sentence for a wide screen; `short` the phone version. `lead` is the visitor's
 * own count of flights looked up this month, only when it is true and at least
 * PERSONAL_COUNT_MIN (src/lib/usage-count.js), or null; on a phone it replaces `short`.
 *
 * @param {ReturnType<typeof parseSupportStatus>} status
 * @param {{flightsThisMonth?: number}} [opts]
 * @returns {{lead: string|null, text: string, short: string, button: string}|null}
 */
export function supportStripCopy(status, { flightsThisMonth = 0 } = {}) {
  const lead = personalCountLine(flightsThisMonth);
  const cost = `$${DAILY_COST_USD}`;
  const button = coverButtonLabel(status);
  if (!status?.configured) {
    return { lead, text: `${cost} keeps The Blue Board running for a day.`, short: `${cost} keeps it running for a day.`, button };
  }
  const target = coverTarget(status);
  if (!target) return null;
  const todayKey = dateKey(status.year, status.month, status.today);
  if (target.date > addDays(todayKey, STRIP_COVERED_HORIZON_DAYS)) return null;
  if (target.kind === 'today') {
    return { lead, text: `Today isn't covered yet. ${cost} keeps The Blue Board running for a day.`, short: "Today isn't covered yet.", button };
  }
  if (target.kind === 'tomorrow') {
    return {
      lead,
      text: `Today is covered, thanks to ${sentenceEnd(status.todayBy)} ${cost} keeps The Blue Board running tomorrow.`,
      short: "Today is covered. Tomorrow isn't yet.",
      button,
    };
  }
  return {
    lead,
    text: `Today is covered, thanks to ${sentenceEnd(status.todayBy)} ${cost} covers the next open day, ${shortDateKey(target.date)}.`,
    short: `Covered through ${shortDateKey(addDays(target.date, -1))}.`,
    button,
  };
}

/**
 * The flight page's support line, in the site's day framing, or null to keep the page's own
 * sentence ("The Blue Board is free and run by one person. If it helped you today, you can chip in
 * toward the data bill."). Only an uncovered today changes it: a covered today, an unconfigured or
 * unreadable status, or no status at all says nothing about days.
 *
 * @param {ReturnType<typeof parseSupportStatus>|null|undefined} status
 * @returns {{text: string, link: string}|null}  `text` before the link, `link` its words.
 */
export function flightPageSupportCopy(status) {
  if (!status?.configured || status.todayCovered || coverTarget(status)?.kind !== 'today') return null;
  const copy = supportStripCopy(status);
  if (!copy) return null;
  return { text: copy.text, link: coverButtonLabel(status) };
}
