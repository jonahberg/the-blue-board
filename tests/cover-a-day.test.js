/**
 * "Cover a day" (Nov 2026): $17 keeps the site running for a day; a month's money covers that
 * month's days in order from the 1st, in arrival order, pooling small amounts; the calendar is
 * US Central. These pin the allocation, the time-zone edges, refunds, and every sentence the
 * strip and the About section can say.
 */

import { describe, expect, it } from 'vitest';

import {
  COVER_TIME_ZONE,
  DAILY_COST_CENTS,
  DAILY_COST_USD,
  UNCONFIGURED_STATUS,
  allocateMonth,
  calendarCells,
  coverageRuns,
  coveredByLabel,
  coveredCountLine,
  daysInMonth,
  monthBoundsUtc,
  monthFullyCovered,
  netCents,
  nextOpenDay,
  parseSupportStatus,
  supportStatusFromRows,
  supportStripCopy,
  todayLine,
  zonedDate,
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

// Nov 10 2026, noon Central (CST, UTC-6).
const NOV10 = Date.parse('2026-11-10T18:00:00Z');

describe('the unit', () => {
  it('is $17 a day, in US Central', () => {
    expect(DAILY_COST_CENTS).toBe(1700);
    expect(DAILY_COST_USD).toBe(17);
    expect(COVER_TIME_ZONE).toBe('America/Chicago');
  });
});

describe('allocateMonth', () => {
  const days = 30;

  it('$17 covers exactly one day', () => {
    const a = allocateMonth([pay(17, '2026-11-02T15:00:00Z', { display_name: 'Dana R.' })], { days });
    expect(a.daysCovered).toBe(1);
    expect(a.towardNextCents).toBe(0);
    expect(a.days.map((d) => d.day)).toEqual([1]);
  });

  it('$50 covers two days and leaves $16 toward the third', () => {
    const a = allocateMonth([pay(50, '2026-11-02T15:00:00Z')], { days });
    expect(a.daysCovered).toBe(2);
    expect(a.towardNextCents).toBe(1600);
  });

  it('small amounts pool: $5 + $5 + $7 make one day, paid for by all three', () => {
    const rows = [pay(5, '2026-11-02T15:00:00Z'), pay(5, '2026-11-03T15:00:00Z'), pay(7, '2026-11-04T15:00:00Z')];
    const a = allocateMonth(rows, { days });
    expect(a.daysCovered).toBe(1);
    expect(a.days[0].rows).toHaveLength(3);
    expect(allocateMonth(rows.slice(0, 2), { days })).toMatchObject({ daysCovered: 0, towardNextCents: 1000 });
  });

  it('a payment that finishes one day and starts the next shares both', () => {
    const dana = pay(50, '2026-11-02T15:00:00Z', { display_name: 'Dana R.' });
    const lee = pay(10, '2026-11-03T15:00:00Z', { display_name: 'Lee' });
    const a = allocateMonth([dana, lee], { days });
    expect(a.daysCovered).toBe(3);
    expect(a.days[0].rows).toEqual([dana]);
    expect(a.days[1].rows).toEqual([dana]);
    expect(a.days[2].rows).toEqual([dana, lee]);
    expect(a.towardNextCents).toBe(6000 - 3 * 1700);
  });

  it('fills in arrival order, whatever order the rows come in, with a stable tiebreak on equal times', () => {
    const first = pay(17, '2026-11-02T15:00:00Z', { display_name: 'First' });
    const second = pay(17, '2026-11-05T15:00:00Z', { display_name: 'Second' });
    const a = allocateMonth([second, first], { days });
    expect(a.days[0].rows).toEqual([first]);
    expect(a.days[1].rows).toEqual([second]);

    const tieA = pay(17, '2026-11-06T15:00:00Z', { id: 7 });
    const tieB = pay(17, '2026-11-06T15:00:00Z', { id: 8 });
    expect(allocateMonth([tieB, tieA], { days }).days.map((d) => d.rows[0].id)).toEqual([7, 8]);
  });

  it('never covers more days than the month has', () => {
    const a = allocateMonth([pay(1000, '2026-11-02T15:00:00Z')], { days });
    expect(a.daysCovered).toBe(30);
    expect(a.towardNextCents).toBe(0);
  });

  it('with no payments, covers nothing', () => {
    expect(allocateMonth([], { days })).toEqual({ daysCovered: 0, towardNextCents: 0, days: [] });
    expect(allocateMonth(undefined, { days })).toEqual({ daysCovered: 0, towardNextCents: 0, days: [] });
  });

  it('counts in integer cents: three $5.67 payments are exactly one day', () => {
    const rows = [1, 2, 3].map((n) => pay(5.67, `2026-11-0${n}T15:00:00Z`));
    expect(allocateMonth(rows, { days }).daysCovered).toBe(1);
  });
});

describe('refunds reduce coverage', () => {
  it('a fully refunded payment covers nothing, and later payments move up', () => {
    const refunded = pay(17, '2026-11-02T15:00:00Z', { display_name: 'Refunded', refunded: true, amount_refunded_cents: 1700 });
    const kept = pay(17, '2026-11-03T15:00:00Z', { display_name: 'Kept' });
    expect(netCents(refunded)).toBe(0);
    const a = allocateMonth([refunded, kept], { days: 30 });
    expect(a.daysCovered).toBe(1);
    expect(a.days[0].rows).toEqual([kept]);
  });

  it('a partial refund takes its amount back out', () => {
    const row = pay(50, '2026-11-02T15:00:00Z', { amount_refunded_cents: 2000 });
    expect(netCents(row)).toBe(3000);
    expect(allocateMonth([row], { days: 30 })).toMatchObject({ daysCovered: 1, towardNextCents: 1300 });
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
    // December starts in CST.
    expect(new Date(endMs).toISOString()).toBe('2026-12-01T06:00:00.000Z');
    expect(new Date(zonedMidnightUtcMs(2026, 3, 1)).toISOString()).toBe('2026-03-01T06:00:00.000Z');
    expect(new Date(zonedMidnightUtcMs(2026, 4, 1)).toISOString()).toBe('2026-04-01T05:00:00.000Z');
  });

  it('puts 04:59Z on Nov 1 in October and 05:30Z in November', () => {
    expect(zonedDate(Date.parse('2026-11-01T04:59:00Z'))).toEqual({ year: 2026, month: 10, day: 31 });
    expect(zonedDate(Date.parse('2026-11-01T05:30:00Z'))).toEqual({ year: 2026, month: 11, day: 1 });
  });

  it('counts a payment in the Central month it was paid in, not the UTC one', () => {
    const october = pay(17, '2026-11-01T04:59:00Z', { display_name: 'Halloween' });
    const november = pay(17, '2026-11-01T05:30:00Z', { display_name: 'Early Bird' });
    const body = supportStatusFromRows([october, november], NOV10);
    expect(body.daysCovered).toBe(1);
    expect(body.days[0].by).toBe('Early Bird');
  });

  it('starts over on the 1st: last month\'s money covers none of this month', () => {
    const lastMonth = pay(500, '2026-10-20T15:00:00Z');
    expect(supportStatusFromRows([lastMonth], NOV10).daysCovered).toBe(0);
  });

  it('a New Year\'s Eve payment at 23:30 Central belongs to December of the old year', () => {
    const nye = pay(17, '2027-01-01T05:30:00Z');
    const body = supportStatusFromRows([nye], Date.parse('2027-01-01T05:45:00Z')); // 23:45 Central
    expect(body.month).toBe('2026-12');
    expect(body.daysCovered).toBe(1);
  });

  it('knows month lengths', () => {
    expect(daysInMonth(2026, 11)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
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
    expect(coveredByLabel([pay(5, 'x', { display_name: 'Lee' }), pay(12, 'x', { display_name: 'Dana' })])).toBe('2 supporters');
    expect(coveredByLabel([pay(5, 'x', { display_name: 'Lee' }), pay(12, 'x', { display_name: 'lee ' })])).toBe('Lee');
    // A hidden row hides the name of the same person's other row too.
    expect(coveredByLabel([pay(5, 'x', { display_name: 'Lee' }), pay(12, 'x', { display_name: 'Lee', hidden: true })])).toBe('a supporter');
  });
});

describe('supportStatusFromRows (the public body)', () => {
  it('with zero payments: nothing covered, today open, nobody named', () => {
    expect(supportStatusFromRows([], NOV10)).toEqual({
      configured: true,
      timeZone: 'America/Chicago',
      month: '2026-11',
      daysInMonth: 30,
      today: 10,
      daysCovered: 0,
      todayCovered: false,
      todayBy: null,
      days: [],
      dailyCostUsd: 17,
    });
  });

  it('says who covered today, and every covered day', () => {
    const rows = [pay(17 * 9, '2026-11-02T15:00:00Z'), pay(17, '2026-11-09T15:00:00Z', { display_name: 'Dana R.' })];
    const body = supportStatusFromRows(rows, NOV10);
    expect(body).toMatchObject({ daysCovered: 10, todayCovered: true, todayBy: 'Dana R.' });
    expect(body.days[0]).toEqual({ day: 1, by: 'a supporter' });
    expect(body.days[9]).toEqual({ day: 10, by: 'Dana R.' });
  });

  it('carries no amounts and no dollar totals: only the daily cost', () => {
    const body = supportStatusFromRows([pay(50, '2026-11-02T15:00:00Z', { display_name: 'Dana R.' })], NOV10);
    expect(Object.keys(body).sort()).toEqual(
      ['configured', 'dailyCostUsd', 'days', 'daysCovered', 'daysInMonth', 'month', 'timeZone', 'today', 'todayBy', 'todayCovered'].sort(),
    );
    expect(JSON.stringify(body)).not.toMatch(/50|1600|amount|cents/);
  });

  it('counts US dollars only, and ignores payments dated after now', () => {
    const rows = [pay(17, '2026-11-02T15:00:00Z', { currency: 'eur' }), pay(17, '2026-11-11T15:00:00Z')];
    expect(supportStatusFromRows(rows, NOV10).daysCovered).toBe(0);
    expect(supportStatusFromRows([pay(17, '2026-11-02T15:00:00Z', { currency: 'USD' })], NOV10).daysCovered).toBe(1);
  });

  it('applies the names switch to every label', () => {
    const rows = [pay(17 * 10, '2026-11-02T15:00:00Z', { display_name: 'Dana R.' })];
    expect(supportStatusFromRows(rows, NOV10, { namesOn: false }).todayBy).toBe('a supporter');
  });
});

describe('parseSupportStatus (what the page will believe)', () => {
  const body = (rows) => JSON.parse(JSON.stringify(supportStatusFromRows(rows, NOV10)));

  it('round-trips a well-formed body for today', () => {
    const parsed = parseSupportStatus(body([pay(17 * 3, '2026-11-02T15:00:00Z')]), NOV10);
    expect(parsed).toMatchObject({ configured: true, year: 2026, month: 11, today: 10, daysCovered: 3, todayCovered: false, todayBy: null });
  });

  it('falls back to {configured:false} for anything it cannot vouch for', () => {
    const good = body([pay(17 * 3, '2026-11-02T15:00:00Z')]);
    for (const bad of [
      null,
      'nope',
      { configured: false },
      { ...good, month: 'Nov' },
      { ...good, daysInMonth: 31 },
      { ...good, daysCovered: 99 },
      { ...good, todayCovered: true },
      { ...good, days: [] },
      { ...good, days: [{ day: 1, by: '' }, ...good.days.slice(1)] },
    ]) {
      expect(parseSupportStatus(bad, NOV10)).toEqual(UNCONFIGURED_STATUS);
    }
  });

  it('drops a cached answer from yesterday (a CDN copy straddling Central midnight)', () => {
    const yesterday = JSON.parse(JSON.stringify(supportStatusFromRows([], NOV10 - 24 * 3600_000)));
    expect(parseSupportStatus(yesterday, NOV10)).toEqual(UNCONFIGURED_STATUS);
  });
});

const status = (rows, now = NOV10) => parseSupportStatus(JSON.parse(JSON.stringify(supportStatusFromRows(rows, now))), now);

describe('the sentences', () => {
  it('todayLine: covered by a name, by a pool, not yet, or nothing to say', () => {
    expect(todayLine(status([pay(17 * 10, '2026-11-02T15:00:00Z', { display_name: 'Dana R.' })]))).toBe('Today is covered by Dana R.');
    expect(todayLine(status([pay(17 * 9 + 10, '2026-11-02T15:00:00Z'), pay(7, '2026-11-03T15:00:00Z')]))).toBe('Today is covered by 2 supporters.');
    expect(todayLine(status([]))).toBe("Today isn't covered yet.");
    expect(todayLine(UNCONFIGURED_STATUS)).toBeNull();
    expect(todayLine(status([pay(17 * 10, '2026-11-02T15:00:00Z', { display_name: 'Lee' })]))).toBe('Today is covered by Lee.');
    expect(coveredCountLine(status([pay(51, '2026-11-02T15:00:00Z')]))).toBe('3 of 30 days covered');
  });

  it('strip, not configured: the plain ask, no coverage claim', () => {
    expect(supportStripCopy(UNCONFIGURED_STATUS)).toEqual({
      lead: null,
      text: '$17 keeps The Blue Board running for a day.',
      short: '$17 keeps it running for a day.',
    });
  });

  it('strip, today not covered', () => {
    expect(supportStripCopy(status([pay(17, '2026-11-02T15:00:00Z')]))).toEqual({
      lead: null,
      text: "Today isn't covered yet. $17 keeps The Blue Board running for a day.",
      short: "Today isn't covered yet.",
    });
  });

  it('strip, today covered and tomorrow open: a thank-you, then tomorrow', () => {
    expect(supportStripCopy(status([pay(17 * 10, '2026-11-02T15:00:00Z', { display_name: 'Dana R.' })]))).toEqual({
      lead: null,
      text: 'Today is covered, thanks to Dana R. $17 keeps The Blue Board running tomorrow.',
      short: "Today is covered. Tomorrow isn't yet.",
    });
  });

  it('strip, covered past tomorrow: never says "tomorrow", names the next open day', () => {
    const copy = supportStripCopy(status([pay(17 * 15, '2026-11-02T15:00:00Z')]));
    expect(copy).toEqual({
      lead: null,
      text: 'Today is covered, thanks to a supporter. $17 covers the next open day, Nov 16.',
      short: 'Covered through Nov 15.',
    });
    expect(copy.text).not.toMatch(/tomorrow/);
  });

  it('strip, every day of the month covered: nothing to ask for', () => {
    const full = status([pay(17 * 30, '2026-11-02T15:00:00Z')]);
    expect(monthFullyCovered(full)).toBe(true);
    expect(nextOpenDay(full)).toBeNull();
    expect(supportStripCopy(full)).toBeNull();
  });

  it('on the last day, covered means the month is covered (no "tomorrow" in December)', () => {
    const nov30 = Date.parse('2026-11-30T18:00:00Z');
    expect(supportStripCopy(status([pay(17 * 30, '2026-11-02T15:00:00Z')], nov30), {})).toBeNull();
    expect(supportStripCopy(status([pay(17 * 29, '2026-11-02T15:00:00Z')], nov30)).text).toBe(
      "Today isn't covered yet. $17 keeps The Blue Board running for a day.",
    );
  });

  it('leads with the personal count only from five flights up', () => {
    const open = status([]);
    expect(supportStripCopy(open, { flightsThisMonth: 4 }).lead).toBeNull();
    expect(supportStripCopy(open, { flightsThisMonth: 23 }).lead).toBe("You've looked up 23 flights here this month.");
    expect(supportStripCopy(UNCONFIGURED_STATUS, { flightsThisMonth: 5 }).lead).toBe("You've looked up 5 flights here this month.");
  });
});

describe('calendarCells and coverageRuns', () => {
  it('lays November 2026 out from Sunday the 1st, marking covered days and today', () => {
    const cal = calendarCells(status([pay(17 * 3, '2026-11-02T15:00:00Z', { display_name: 'Dana R.' })]));
    expect(cal.leadingBlanks).toBe(0);
    expect(cal.cells).toHaveLength(30);
    expect(cal.cells[0]).toMatchObject({ day: 1, covered: true, today: false, by: 'Dana R.', label: 'November 1: covered by Dana R.' });
    expect(cal.cells[9]).toMatchObject({ day: 10, covered: false, today: true, label: 'November 10, today: open' });
    expect(calendarCells(UNCONFIGURED_STATUS)).toBeNull();
  });

  it('offsets a month that starts mid-week', () => {
    const oct = Date.parse('2026-10-15T18:00:00Z');
    expect(calendarCells(status([], oct)).leadingBlanks).toBe(4); // Thu Oct 1 2026
  });

  it('folds consecutive days under one shown name, never anonymous or pooled days', () => {
    const rows = [
      pay(34, '2026-11-02T15:00:00Z', { display_name: 'Dana R.' }),
      pay(17, '2026-11-03T15:00:00Z'),
      pay(17, '2026-11-04T15:00:00Z'),
    ];
    expect(coverageRuns(status(rows)).map((r) => [r.text, r.by])).toEqual([
      ['Nov 1–2', 'Dana R.'],
      ['Nov 3', 'a supporter'],
      ['Nov 4', 'a supporter'],
    ]);
  });
});
