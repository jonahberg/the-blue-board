/**
 * "Cover a day" (Nov 2026): $17 keeps the site running for a day. A payment covers the day it is
 * made (its US Central date) or, if that day is taken, the next open day after it, never a day
 * before it; leftovers pool across payments, oldest money first, and carry across month ends.
 * These pin the allocation, the time-zone edges, refunds, and every sentence and button label the
 * strip, the About section and the menu can show.
 */

import { describe, expect, it } from 'vitest';

import {
  COVER_RULE_LINE,
  COVER_TIME_ZONE,
  DAILY_COST_CENTS,
  DAILY_COST_USD,
  STRIP_COVERED_HORIZON_DAYS,
  UNCONFIGURED_STATUS,
  addDays,
  allocateDays,
  calendarCells,
  coverButtonLabel,
  coverSentence,
  coverTarget,
  coverageRuns,
  coveredByLabel,
  coveredCountLine,
  daysInMonth,
  monthBoundsUtc,
  monthFullyCovered,
  netCents,
  parseSupportStatus,
  supportStatusFromRows,
  supportStripCopy,
  todayLine,
  zonedDate,
  zonedDateKey,
  zonedMidnightUtcMs,
} from '../src/lib/cover-a-day.js';

let nextId = 1;
/** A stored payment row as sql/023 returns it. */
function pay(dollars, paidAt, extra = {}) {
  return {
    id: nextId++,
    amount_cents: Math.round(dollars * 100),
    currency: 'usd',
    paid_at: paidAt,
    refunded: false,
    amount_refunded_cents: 0,
    display_name: null,
    hidden: false,
    ...extra,
  };
}

/** A Central date at 9:00 CST (15:00Z) — November 2026 is after DST ends. */
const at = (day, month = 11) => `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T15:00:00Z`;
// Nov 10 2026, noon Central.
const NOV10 = Date.parse('2026-11-10T18:00:00Z');

const keys = (allocation) => [...allocation.covered.keys()].sort();
const by = (allocation, key) => allocation.covered.get(key);

describe('the unit', () => {
  it('is $17 a day, in US Central', () => {
    expect(DAILY_COST_CENTS).toBe(1700);
    expect(DAILY_COST_USD).toBe(17);
    expect(COVER_TIME_ZONE).toBe('America/Chicago');
    expect(COVER_RULE_LINE).toBe('Each $17 covers the day it is given, or the next open day after it.');
  });
});

describe('allocateDays — a payment covers the day it is made', () => {
  it('$17 today covers today', () => {
    const dana = pay(17, at(10), { display_name: 'Dana R.' });
    const a = allocateDays([dana]);
    expect(keys(a)).toEqual(['2026-11-10']);
    expect(by(a, '2026-11-10')).toEqual([dana]);
    expect(a.poolCents).toBe(0);
  });

  it('$50 today covers today and tomorrow, and pools the other $16', () => {
    const lee = pay(50, at(10));
    const a = allocateDays([lee]);
    expect(keys(a)).toEqual(['2026-11-10', '2026-11-11']);
    expect(a.poolCents).toBe(1600);
  });

  it('a later payment finishes a day with the pool: oldest money first, "2 supporters"', () => {
    const lee = pay(50, at(10), { display_name: 'Lee' });
    const sam = pay(5, at(12), { display_name: 'Sam' });
    const a = allocateDays([lee, sam]);
    expect(keys(a)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
    expect(by(a, '2026-11-12')).toEqual([lee, sam]);
    expect(coveredByLabel(by(a, '2026-11-12'))).toBe('2 supporters');
    expect(a.poolCents).toBe(400);
  });

  it('small amounts pool, and the day they complete is the last payment\'s day — never an earlier one', () => {
    const rows = [pay(5, at(2)), pay(5, at(3)), pay(7, at(4))];
    expect(keys(allocateDays(rows.slice(0, 2)))).toEqual([]);
    const a = allocateDays(rows);
    expect(keys(a)).toEqual(['2026-11-04']);
    expect(by(a, '2026-11-04')).toHaveLength(3);
  });

  it('a payment on the 30th carries into the next month', () => {
    const ana = pay(40, at(30), { display_name: 'Ana' });
    const a = allocateDays([ana]);
    expect(keys(a)).toEqual(['2026-11-30', '2026-12-01']);
    expect(a.poolCents).toBe(600);
  });

  it('with today already covered, a new payment takes the next open day', () => {
    const dana = pay(17, '2026-11-10T15:00:00Z', { display_name: 'Dana R.' });
    const kim = pay(17, '2026-11-10T16:00:00Z', { display_name: 'Kim' });
    const a = allocateDays([dana, kim]);
    expect(by(a, '2026-11-10')).toEqual([dana]);
    expect(by(a, '2026-11-11')).toEqual([kim]);
  });

  it('skips covered days and fills the first open one after the payment\'s day', () => {
    const big = pay(17 * 3, at(10)); // 10, 11, 12
    const later = pay(17, at(11)); // 11 and 12 are taken → 13
    expect(keys(allocateDays([big, later]))).toEqual(['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
  });

  it('never claims a past day: days before any payment, and gaps, stay open', () => {
    const a = allocateDays([pay(17, at(2)), pay(17, at(5))]);
    expect(keys(a)).toEqual(['2026-11-02', '2026-11-05']);
  });

  it('takes payments in paid-time order, whatever order the rows come in, with a stable tiebreak', () => {
    const first = pay(17, '2026-11-10T15:00:00Z', { display_name: 'First' });
    const second = pay(17, '2026-11-10T17:00:00Z', { display_name: 'Second' });
    const a = allocateDays([second, first]);
    expect(by(a, '2026-11-10')).toEqual([first]);
    expect(by(a, '2026-11-11')).toEqual([second]);

    const tieA = pay(17, at(20), { id: 7 });
    const tieB = pay(17, at(20), { id: 8 });
    const t = allocateDays([tieB, tieA]);
    expect(by(t, '2026-11-20')[0].id).toBe(7);
    expect(by(t, '2026-11-21')[0].id).toBe(8);
  });

  it('with no payments, covers nothing', () => {
    expect(keys(allocateDays([]))).toEqual([]);
    expect(allocateDays(undefined).poolCents).toBe(0);
  });

  it('counts in integer cents: three $5.67 payments make exactly one day', () => {
    const rows = [1, 2, 3].map((n) => pay(5.67, at(n)));
    expect(keys(allocateDays(rows))).toEqual(['2026-11-03']);
  });
});

describe('refunds are recomputed from what remains', () => {
  it('a fully refunded payment covers nothing, and the others are laid out without it', () => {
    const lee = pay(50, at(10), { display_name: 'Lee', refunded: true, amount_refunded_cents: 5000 });
    const sam = pay(5, at(12), { display_name: 'Sam' });
    expect(netCents(lee)).toBe(0);
    const a = allocateDays([lee, sam]);
    expect(keys(a)).toEqual([]);
    expect(a.poolCents).toBe(500);
  });

  it('a refund on an earlier payment can hand its day to the next payment that day', () => {
    const dana = pay(17, '2026-11-10T15:00:00Z', { refunded: true, amount_refunded_cents: 1700 });
    const kim = pay(17, '2026-11-10T16:00:00Z', { display_name: 'Kim' });
    const a = allocateDays([dana, kim]);
    expect(keys(a)).toEqual(['2026-11-10']);
    expect(by(a, '2026-11-10')).toEqual([kim]);
  });

  it('a partial refund takes its amount back out', () => {
    const row = pay(50, at(10), { amount_refunded_cents: 2000 });
    expect(netCents(row)).toBe(3000);
    const a = allocateDays([row]);
    expect(keys(a)).toEqual(['2026-11-10']);
    expect(a.poolCents).toBe(1300);
  });

  it('treats junk amounts as nothing rather than throwing', () => {
    expect(netCents({ amount_cents: 'lots' })).toBe(0);
    expect(netCents({ amount_cents: -500 })).toBe(0);
    expect(netCents({ amount_cents: 1000, amount_refunded_cents: 5000 })).toBe(0);
    expect(netCents(null)).toBe(0);
  });
});

describe('the Central calendar', () => {
  it('starts November 2026 at 05:00Z: DST ends on Nov 1, so its midnight is still CDT', () => {
    const { startMs, endMs } = monthBoundsUtc(2026, 11);
    expect(new Date(startMs).toISOString()).toBe('2026-11-01T05:00:00.000Z');
    expect(new Date(endMs).toISOString()).toBe('2026-12-01T06:00:00.000Z');
    expect(new Date(zonedMidnightUtcMs(2026, 3, 1)).toISOString()).toBe('2026-03-01T06:00:00.000Z');
    expect(new Date(zonedMidnightUtcMs(2026, 4, 1)).toISOString()).toBe('2026-04-01T05:00:00.000Z');
  });

  it('puts 04:59Z on Nov 1 on Oct 31 and 05:30Z on Nov 1', () => {
    expect(zonedDate(Date.parse('2026-11-01T04:59:00Z'))).toEqual({ year: 2026, month: 10, day: 31 });
    expect(zonedDateKey(Date.parse('2026-11-01T05:30:00Z'))).toBe('2026-11-01');
    expect(keys(allocateDays([pay(17, '2026-11-01T04:59:00Z')]))).toEqual(['2026-10-31']);
    expect(keys(allocateDays([pay(17, '2026-11-01T05:30:00Z')]))).toEqual(['2026-11-01']);
  });

  it('a 23:30 Central New Year\'s Eve payment covers Dec 31, then Jan 1', () => {
    expect(keys(allocateDays([pay(34, '2027-01-01T05:30:00Z')]))).toEqual(['2026-12-31', '2027-01-01']);
  });

  it('does calendar arithmetic across month and year ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 2)).toBe(28);
  });
});

describe('coveredByLabel', () => {
  it('names one supporter when the name passes the check', () => {
    expect(coveredByLabel([pay(17, 'x', { display_name: '  Dana   R. ' })])).toBe('Dana R.');
  });

  it('says "a supporter" for no name, a failing name, a hidden row, or names switched off', () => {
    expect(coveredByLabel([pay(17, 'x')])).toBe('a supporter');
    expect(coveredByLabel([pay(17, 'x', { display_name: 'visit dana.com' })])).toBe('a supporter');
    expect(coveredByLabel([pay(17, 'x', { display_name: 'Dana R.', hidden: true })])).toBe('a supporter');
    expect(coveredByLabel([pay(17, 'x', { display_name: 'Dana R.' })], { namesOn: false })).toBe('a supporter');
  });

  it('says "N supporters" for a pooled day, counting the same typed name once', () => {
    expect(coveredByLabel([pay(5, 'x'), pay(12, 'x')])).toBe('2 supporters');
    expect(coveredByLabel([pay(5, 'x', { display_name: 'Lee' }), pay(12, 'x', { display_name: 'lee ' })])).toBe('Lee');
    expect(coveredByLabel([pay(5, 'x', { display_name: 'Lee' }), pay(12, 'x', { display_name: 'Lee', hidden: true })])).toBe('a supporter');
  });
});

describe('supportStatusFromRows (the public body)', () => {
  it('with zero payments: nothing covered, today open and the next open day', () => {
    expect(supportStatusFromRows([], NOV10)).toEqual({
      configured: true,
      timeZone: 'America/Chicago',
      month: '2026-11',
      daysInMonth: 30,
      today: 10,
      daysCovered: 0,
      todayCovered: false,
      todayBy: null,
      nextOpenDate: '2026-11-10',
      days: [],
      dailyCostUsd: 17,
    });
  });

  it('says who covered today and every covered day this month, gaps and all', () => {
    const rows = [pay(17, at(2)), pay(34, at(10), { display_name: 'Dana R.' })];
    const body = supportStatusFromRows(rows, NOV10);
    expect(body).toMatchObject({ daysCovered: 3, todayCovered: true, todayBy: 'Dana R.', nextOpenDate: '2026-11-12' });
    expect(body.days).toEqual([
      { day: 2, by: 'a supporter' },
      { day: 10, by: 'Dana R.' },
      { day: 11, by: 'Dana R.' },
    ]);
  });

  it('shows days carried over from last month\'s money', () => {
    const body = supportStatusFromRows([pay(40, at(31, 10), { display_name: 'Ana' })], NOV10);
    expect(body.days).toEqual([{ day: 1, by: 'Ana' }]);
  });

  it('looks past the month end for the next open day', () => {
    const nov30 = Date.parse('2026-11-30T18:00:00Z');
    const body = supportStatusFromRows([pay(34, at(30))], nov30);
    expect(body).toMatchObject({ today: 30, todayCovered: true, nextOpenDate: '2026-12-02' });
  });

  it('carries no amounts and no dollar totals: only the daily cost', () => {
    const body = supportStatusFromRows([pay(50, at(10), { display_name: 'Dana R.' })], NOV10);
    expect(Object.keys(body).sort()).toEqual(
      ['configured', 'dailyCostUsd', 'days', 'daysCovered', 'daysInMonth', 'month', 'nextOpenDate', 'timeZone', 'today', 'todayBy', 'todayCovered'].sort(),
    );
    expect(JSON.stringify(body)).not.toMatch(/50|1600|amount|cents|pool/);
  });

  it('counts US dollars only, and ignores payments dated after now', () => {
    expect(supportStatusFromRows([pay(17, at(10), { currency: 'eur' })], NOV10).todayCovered).toBe(false);
    expect(supportStatusFromRows([pay(17, '2026-11-10T19:00:00Z')], NOV10).todayCovered).toBe(false);
    expect(supportStatusFromRows([pay(17, at(10), { currency: 'USD' })], NOV10).todayCovered).toBe(true);
  });

  it('applies the names switch to every label', () => {
    expect(supportStatusFromRows([pay(17, at(10), { display_name: 'Dana R.' })], NOV10, { namesOn: false }).todayBy).toBe('a supporter');
  });
});

const body = (rows, now = NOV10) => JSON.parse(JSON.stringify(supportStatusFromRows(rows, now)));
const status = (rows, now = NOV10) => parseSupportStatus(body(rows, now), now);

describe('parseSupportStatus (what the page will believe)', () => {
  it('round-trips a well-formed body for today', () => {
    expect(status([pay(17, at(2)), pay(34, at(10))])).toMatchObject({
      configured: true,
      year: 2026,
      month: 11,
      today: 10,
      daysCovered: 3,
      todayCovered: true,
      todayBy: 'a supporter',
      nextOpenDate: '2026-11-12',
    });
  });

  it('falls back to {configured:false} for anything it cannot vouch for', () => {
    const good = body([pay(17, at(2)), pay(17, at(10))]);
    for (const bad of [
      null,
      'nope',
      { configured: false },
      { ...good, month: 'Nov' },
      { ...good, daysInMonth: 31 },
      { ...good, daysCovered: 5 },
      { ...good, todayCovered: false, todayBy: null },
      { ...good, todayBy: 'Somebody Else' },
      { ...good, days: [...good.days].reverse() },
      { ...good, days: [{ day: 2, by: '' }, good.days[1]] },
      { ...good, nextOpenDate: '2026-11-10' },
      { ...good, nextOpenDate: '2026-11-09' },
      { ...good, nextOpenDate: '2026-11-13' },
      { ...good, nextOpenDate: 'soon' },
      { ...good, nextOpenDate: null },
    ]) {
      expect(parseSupportStatus(bad, NOV10)).toEqual(UNCONFIGURED_STATUS);
    }
  });

  it('drops a cached answer from yesterday (a CDN copy straddling Central midnight)', () => {
    const yesterday = body([], NOV10 - 24 * 3600_000);
    expect(parseSupportStatus(yesterday, NOV10)).toEqual(UNCONFIGURED_STATUS);
  });
});

describe('the sentences and the button', () => {
  it('todayLine: covered by a name, by a pool, not yet, or nothing to say', () => {
    expect(todayLine(status([pay(17, at(10), { display_name: 'Dana R.' })]))).toBe('Today is covered by Dana R.');
    expect(todayLine(status([pay(17, at(10), { display_name: 'Lee' })]))).toBe('Today is covered by Lee.');
    expect(todayLine(status([pay(10, at(9)), pay(7, at(10))]))).toBe('Today is covered by 2 supporters.');
    expect(todayLine(status([]))).toBe("Today isn't covered yet.");
    expect(todayLine(UNCONFIGURED_STATUS)).toBeNull();
    expect(coveredCountLine(status([pay(17, at(2)), pay(34, at(10))]))).toBe('3 of 30 days covered');
  });

  it('the button names the day $17 would cover right now', () => {
    expect(coverButtonLabel(UNCONFIGURED_STATUS)).toBe('Cover a day · $17');
    expect(coverButtonLabel(status([]))).toBe('Cover today · $17');
    expect(coverButtonLabel(status([pay(17, at(10))]))).toBe('Cover tomorrow · $17');
    expect(coverButtonLabel(status([pay(34, at(10))]))).toBe('Cover the next open day · $17');
    expect(coverButtonLabel(status([pay(17 * 400, at(10))]))).toBe('Support The Blue Board');
  });

  it('coverTarget and the menu sentence agree with the button', () => {
    expect(coverTarget(UNCONFIGURED_STATUS)).toBeNull();
    expect(coverTarget(status([]))).toEqual({ kind: 'today', date: '2026-11-10' });
    expect(coverSentence(status([]))).toBe('$17 covers today.');
    expect(coverSentence(status([pay(17, at(10))]))).toBe('$17 covers tomorrow.');
    expect(coverSentence(status([pay(17 * 6, at(10))]))).toBe('$17 covers the next open day, Nov 16.');
    expect(coverSentence(UNCONFIGURED_STATUS)).toBeNull();
  });

  it('strip, not configured: the plain ask and "Cover a day", no coverage claim', () => {
    expect(supportStripCopy(UNCONFIGURED_STATUS)).toEqual({
      lead: null,
      text: '$17 keeps The Blue Board running for a day.',
      short: '$17 keeps it running for a day.',
      button: 'Cover a day · $17',
    });
  });

  it('strip, today not covered (even with earlier days covered): "Cover today"', () => {
    expect(supportStripCopy(status([pay(17, at(2))]))).toEqual({
      lead: null,
      text: "Today isn't covered yet. $17 keeps The Blue Board running for a day.",
      short: "Today isn't covered yet.",
      button: 'Cover today · $17',
    });
  });

  it('strip, today covered and tomorrow open: a thank-you, then tomorrow', () => {
    expect(supportStripCopy(status([pay(17, at(10), { display_name: 'Dana R.' })]))).toEqual({
      lead: null,
      text: 'Today is covered, thanks to Dana R. $17 keeps The Blue Board running tomorrow.',
      short: "Today is covered. Tomorrow isn't yet.",
      button: 'Cover tomorrow · $17',
    });
  });

  it('strip, covered past tomorrow: never says "tomorrow", names the next open day', () => {
    const copy = supportStripCopy(status([pay(17 * 6, at(10))]));
    expect(copy).toEqual({
      lead: null,
      text: 'Today is covered, thanks to a supporter. $17 covers the next open day, Nov 16.',
      short: 'Covered through Nov 15.',
      button: 'Cover the next open day · $17',
    });
  });

  it(`strip stays down while today and the next ${STRIP_COVERED_HORIZON_DAYS} days are covered`, () => {
    expect(STRIP_COVERED_HORIZON_DAYS).toBe(14);
    // Today + 14 more days covered → the next open day is 15 days out → no strip.
    expect(supportStripCopy(status([pay(17 * 15, at(10))]))).toBeNull();
    // Today + 13 covered → the next open day is the 14th day out → still asks.
    expect(supportStripCopy(status([pay(17 * 14, at(10))])).text).toContain('the next open day, Nov 24.');
  });

  it('crosses the month end in its words', () => {
    const nov30 = Date.parse('2026-11-30T18:00:00Z');
    expect(supportStripCopy(status([pay(34, at(30))], nov30), {}).short).toBe('Covered through Dec 1.');
    expect(supportStripCopy(status([pay(17, at(30))], nov30), {}).button).toBe('Cover tomorrow · $17');
  });

  it('leads with the personal count only from five flights up', () => {
    const open = status([]);
    expect(supportStripCopy(open, { flightsThisMonth: 4 }).lead).toBeNull();
    expect(supportStripCopy(open, { flightsThisMonth: 23 }).lead).toBe("You've looked up 23 flights here this month.");
    expect(supportStripCopy(UNCONFIGURED_STATUS, { flightsThisMonth: 5 }).lead).toBe("You've looked up 5 flights here this month.");
  });

  it('monthFullyCovered only when every day of the month is', () => {
    expect(monthFullyCovered(status([pay(17 * 30, at(1))], NOV10))).toBe(true);
    expect(monthFullyCovered(status([pay(17 * 29, at(2))], NOV10))).toBe(false);
  });
});

describe('calendarCells and coverageRuns', () => {
  it('lays November 2026 out from Sunday the 1st, marking covered days (with gaps) and today', () => {
    const cal = calendarCells(status([pay(17, at(2)), pay(34, at(10), { display_name: 'Dana R.' })]));
    expect(cal.leadingBlanks).toBe(0);
    expect(cal.cells).toHaveLength(30);
    expect(cal.cells[0]).toMatchObject({ day: 1, covered: false, label: 'November 1: open' });
    expect(cal.cells[1]).toMatchObject({ day: 2, covered: true, by: 'a supporter' });
    expect(cal.cells[9]).toMatchObject({ day: 10, covered: true, today: true, label: 'November 10, today: covered by Dana R.' });
    expect(cal.cells[11]).toMatchObject({ day: 12, covered: false });
    expect(calendarCells(UNCONFIGURED_STATUS)).toBeNull();
  });

  it('offsets a month that starts mid-week', () => {
    expect(calendarCells(status([], Date.parse('2026-10-15T18:00:00Z'))).leadingBlanks).toBe(4); // Thu Oct 1 2026
  });

  it('folds consecutive days under one shown name, never across a gap, anonymous or pooled days', () => {
    const rows = [pay(17, at(2), { display_name: 'Dana R.' }), pay(34, at(4), { display_name: 'Dana R.' }), pay(17, at(8)), pay(17, at(9))];
    expect(coverageRuns(status(rows)).map((r) => [r.text, r.by])).toEqual([
      ['Nov 2', 'Dana R.'],
      ['Nov 4–5', 'Dana R.'],
      ['Nov 8', 'a supporter'],
      ['Nov 9', 'a supporter'],
    ]);
  });
});
