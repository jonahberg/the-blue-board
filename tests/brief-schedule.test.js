// The day's schedule for the ops brief (src/lib/brief-schedule.js): which windows are counted, when a
// comparison is believed, the factor the usual in-the-air count is scaled by, and the five dates
// whose fallback is calm. Pure functions, every clock passed in.
import { describe, expect, it } from 'vitest';

import {
  BRIEF_SCHEDULE_DAYS, BRIEF_SCHEDULE_FLOOR_SHARE, BRIEF_SCHEDULE_MIN_DAYS, BRIEF_SCHEDULE_MIN_USUAL,
  BRIEF_SCHEDULE_USUAL_BAND_PCT, BRIEF_SCHEDULE_WINDOW_MIN, centralDate, lighterSchedulePct, lightScheduleHoliday,
  sameClockDaysBefore, scheduleComparison, scheduleWindows, thanksgivingDate,
} from '../src/lib/brief-schedule.js';
import { BRIEF_AIRBORNE_USUAL_BAND_PCT } from '../src/lib/brief-facts.js';

const t = (iso) => Date.parse(iso);
const week = (n) => Array.from({ length: 7 }, () => n);

describe('the constants', () => {
  it('four hours, seven days, three needed, 150 usual, 40% floor, a 10-point band', () => {
    expect([BRIEF_SCHEDULE_WINDOW_MIN, BRIEF_SCHEDULE_DAYS, BRIEF_SCHEDULE_MIN_DAYS, BRIEF_SCHEDULE_MIN_USUAL, BRIEF_SCHEDULE_FLOOR_SHARE])
      .toEqual([240, 7, 3, 150, 0.4]);
    // The band is "about the usual", the same 10 as the in-the-air comparison's.
    expect(BRIEF_SCHEDULE_USUAL_BAND_PCT).toBe(BRIEF_AIRBORNE_USUAL_BAND_PCT);
  });
});

describe('scheduleWindows', () => {
  it('today ends now, the earlier days at the same wall clock, each four hours, bounded a day either side', () => {
    const now = t('2026-11-13T21:25:30Z'); // 1:25 PM PT, the ground stop
    const w = scheduleWindows(now);
    expect(w).toHaveLength(8);
    const end = Math.floor(now / 60_000);
    expect(w[0]).toEqual({ daysBack: 0, startMin: end - 240, endMin: end, fromDate: '2026-11-12', toDate: '2026-11-14' });
    expect(w[1].endMin).toBe(Math.floor(sameClockDaysBefore(now, 1) / 60_000));
    expect(w[7]).toMatchObject({ daysBack: 7, endMin: end - 7 * 1440, fromDate: '2026-11-05', toDate: '2026-11-07' });
    for (const x of w) expect(x.endMin - x.startMin).toBe(240);
  });

  it('a window across UTC midnight spans its start day before and its end day after', () => {
    const w = scheduleWindows(t('2026-11-18T02:00:00Z'))[0]; // 6 PM PT Nov 17; the window opens at 22:00Z Nov 17
    expect([w.fromDate, w.toDate]).toEqual(['2026-11-16', '2026-11-19']);
  });

  it('across a clock change the earlier windows keep the wall clock, not the UTC time', () => {
    const w = scheduleWindows(t('2026-11-04T15:00:00Z')); // 9 AM CST, Wed Nov 4 2026
    expect(w[4].endMin).toBe(Math.floor(t('2026-10-31T14:00:00Z') / 60_000)); // 9 AM CDT, Sat Oct 31
  });
});

describe('scheduleComparison', () => {
  it('the factor is min(1, ratio + 0.10): only a schedule lighter than the ordinary spread counts', () => {
    expect(scheduleComparison({ today: 490, prior: week(700) })).toEqual({
      status: 'ok', windowMin: 240, today: 490, usual: 700, days: 7, ratio: 0.7, factor: 0.8,
    });
    // A Saturday 7% lighter than the weekday-heavy median is inside the band: factor 1.
    expect(scheduleComparison({ today: 651, prior: week(700) }).factor).toBe(1);
    expect(scheduleComparison({ today: 630, prior: week(700) }).factor).toBe(1); // exactly 0.90
    // A heavier schedule never raises the usual.
    expect(scheduleComparison({ today: 900, prior: week(700) })).toMatchObject({ ratio: 1.286, factor: 1 });
  });

  it('the usual is the median of the earlier days that have rows; a day with none is no data', () => {
    expect(scheduleComparison({ today: 500, prior: [0, 0, 0, 640, 700, 760, null] })).toMatchObject({ status: 'ok', usual: 700, days: 3 });
    expect(scheduleComparison({ today: 500, prior: [600, 700, 720, 800] })).toMatchObject({ usual: 710, days: 4 });
  });

  it('unavailable, and so unscaled, for every reason it cannot be believed', () => {
    expect(scheduleComparison(null)).toMatchObject({ status: 'unavailable', reason: 'not_read' });
    expect(scheduleComparison({ today: null, prior: [], error: 'timeout' })).toMatchObject({ status: 'unavailable', reason: 'timeout' });
    expect(scheduleComparison({ today: null, prior: week(700) })).toMatchObject({ status: 'unavailable', reason: 'read_failed', usual: 700 });
    // flight_history began Nov 6 2026: two days with rows is not a usual.
    expect(scheduleComparison({ today: 500, prior: [0, 0, 0, 0, 0, 700, 710] })).toMatchObject({ status: 'unavailable', reason: 'too_few_days', days: 2 });
    // Overnight the four-hour count is too small to compare.
    expect(scheduleComparison({ today: 60, prior: week(149) })).toMatchObject({ status: 'unavailable', reason: 'usual_too_small' });
    expect(scheduleComparison({ today: 150, prior: week(150) }).status).toBe('ok');
    // Under 40% of usual is missing rows, not a schedule: believing it would hide a halt.
    expect(scheduleComparison({ today: 279, prior: week(700) })).toMatchObject({ status: 'unavailable', reason: 'today_too_thin', today: 279 });
    expect(scheduleComparison({ today: 280, prior: week(700) })).toMatchObject({ status: 'ok', factor: 0.5 });
  });

  it('lighterSchedulePct: how much lighter, only when it moves the usual', () => {
    expect(lighterSchedulePct(scheduleComparison({ today: 490, prior: week(700) }))).toBe(30);
    expect(lighterSchedulePct(scheduleComparison({ today: 629, prior: week(700) }))).toBe(10);
    expect(lighterSchedulePct(scheduleComparison({ today: 630, prior: week(700) }))).toBeNull();
    expect(lighterSchedulePct(scheduleComparison({ today: null, prior: week(700) }))).toBeNull();
    expect(lighterSchedulePct(null)).toBeNull();
  });
});

describe('the five light-schedule dates (the fallback only)', () => {
  it('Thanksgiving is the fourth Thursday of November', () => {
    expect(thanksgivingDate(2026)).toBe('2026-11-26');
    expect(thanksgivingDate(2027)).toBe('2027-11-25');
    expect(thanksgivingDate(2028)).toBe('2028-11-23');
    expect(thanksgivingDate(2029)).toBe('2029-11-22');
  });

  it('by the US Central date', () => {
    expect(centralDate(t('2026-11-26T05:59:00Z'))).toBe('2026-11-25');
    expect(lightScheduleHoliday(t('2026-11-26T05:59:00Z'))).toBeNull(); // 11:59 PM CT Wednesday
    expect(lightScheduleHoliday(t('2026-11-26T06:00:00Z'))).toBe('Thanksgiving Day');
    expect(lightScheduleHoliday(t('2026-11-27T05:59:00Z'))).toBe('Thanksgiving Day');
    expect(lightScheduleHoliday(t('2026-11-27T06:00:00Z'))).toBeNull();
    expect(lightScheduleHoliday(t('2026-12-24T18:00:00Z'))).toBe('Christmas Eve');
    expect(lightScheduleHoliday(t('2026-12-25T18:00:00Z'))).toBe('Christmas Day');
    expect(lightScheduleHoliday(t('2026-12-31T18:00:00Z'))).toBe("New Year's Eve");
    expect(lightScheduleHoliday(t('2027-01-01T18:00:00Z'))).toBe("New Year's Day");
    expect(lightScheduleHoliday(t('2027-01-02T18:00:00Z'))).toBeNull();
    expect(lightScheduleHoliday(t('2026-11-13T21:25:00Z'))).toBeNull();
  });
});
