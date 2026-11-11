// Old FAA programs must never read as current (TODOS: "Stale FAA programs on the dashboard").
import { describe, it, expect } from 'vitest';

import {
  FAA_PROGRAM_END_GRACE_MS,
  FAA_STALE_AFTER_MS,
  currentFaaPicture,
  faaAnswerAsOf,
  faaStatusAsOfLine,
  isProgramPastEnd,
  programEndMs,
  withoutExpiredPrograms,
  zuluClock,
} from '../src/lib/faa-freshness.js';
import { hubProgramMarker } from '../src/lib/ops-health.js';

const NOW = Date.parse('2026-11-10T18:00:00Z');
const MIN = 60_000;

function ewrGroundStop(endTime) {
  return {
    airportCode: 'EWR',
    programs: [{ type: 'ground_stop', reason: 'WX:Thunderstorms', endTime }],
    delays: [{ type: 'ground_stop', reason: 'WX:Thunderstorms', endTime }],
    groundStop: true,
    groundDelay: false,
    departureDelay: false,
    arrivalDelay: false,
    closure: false,
  };
}

describe('faaAnswerAsOf', () => {
  it('backdates the arrival by the server staleness and the edge Age (both seconds)', () => {
    expect(faaAnswerAsOf(NOW, '600', '120')).toBe(NOW - 720_000);
    expect(faaAnswerAsOf(NOW, null, null)).toBe(NOW);
    expect(faaAnswerAsOf(NOW, 'garbage', '-5')).toBe(NOW);
  });
});

describe('program end times', () => {
  it('only an ISO time with a date and a zone counts', () => {
    expect(programEndMs('2026-11-10T18:30:00Z')).toBe(Date.parse('2026-11-10T18:30:00Z'));
    expect(programEndMs('2026-11-10T18:30:00.000+00:00')).toBe(Date.parse('2026-11-10T18:30:00Z'));
    expect(programEndMs('1500')).toBe(null); // the XML fallback: no day, no zone
    expect(programEndMs('2026-11-10T18:30:00')).toBe(null); // no zone
    expect(programEndMs(null)).toBe(null);
  });

  it('a program that ended after the answer was taken, longer ago than the grace, is past its end', () => {
    const asOf = NOW - 24 * MIN;
    expect(FAA_PROGRAM_END_GRACE_MS).toBe(15 * MIN);
    expect(isProgramPastEnd({ endTime: new Date(NOW - 16 * MIN).toISOString() }, asOf, NOW)).toBe(true);
    // Ended 30 min ago, but the answer 24 min ago still listed it: not lifted yet.
    expect(isProgramPastEnd({ endTime: new Date(NOW - 30 * MIN).toISOString() }, asOf, NOW)).toBe(false);
    expect(isProgramPastEnd({ endTime: new Date(NOW + 30 * MIN).toISOString() }, asOf, NOW)).toBe(false);
    expect(isProgramPastEnd({ endTime: '1500' }, asOf, NOW)).toBe(false);
  });

  it('a stop that ended minutes ago is kept: news of an extension can take that long to arrive', () => {
    // Extended a minute before its end; the answers that say so are still in the edge cache.
    expect(isProgramPastEnd({ endTime: new Date(NOW - 5 * MIN).toISOString() }, NOW - 10 * MIN, NOW)).toBe(false);
  });

  it('clears an expired program from programs and delays and recomputes the flags', () => {
    const airport = ewrGroundStop(new Date(NOW - 16 * MIN).toISOString());
    const { airports, expired } = withoutExpiredPrograms([airport], NOW - 24 * MIN, NOW);
    expect(expired).toEqual(['EWR:ground_stop']);
    expect(airports[0]).toMatchObject({ programs: [], delays: [], groundStop: false });
    expect(hubProgramMarker({ EWR: airports[0] }, 'EWR')).toBe(null);
    // Nothing expired: the same objects come back.
    const live = ewrGroundStop(new Date(NOW + 60 * MIN).toISOString());
    expect(withoutExpiredPrograms([live], NOW - 5 * MIN, NOW).airports[0]).toBe(live);
  });
});

describe('currentFaaPicture', () => {
  const live = [ewrGroundStop(new Date(NOW + 60 * MIN).toISOString())];

  it('a recent answer is the current picture', () => {
    const picture = currentFaaPicture(live, NOW - 10 * MIN, NOW);
    expect(picture.stale).toBe(false);
    expect(hubProgramMarker(picture.index, 'EWR')).toMatchObject({ label: 'Ground stop' });
  });

  it('past the age limit nothing is current: the index is empty and the picture is stale', () => {
    const picture = currentFaaPicture(live, NOW - FAA_STALE_AFTER_MS - 1, NOW);
    expect(picture.stale).toBe(true);
    expect(picture.index).toEqual({});
  });

  it('no answer yet is not "stale", just empty', () => {
    expect(currentFaaPicture(null, null, NOW)).toMatchObject({ stale: false, index: {} });
  });

  it('its key moves only when what a reader sees moves', () => {
    const a = currentFaaPicture(live, NOW - 10 * MIN, NOW);
    const b = currentFaaPicture(live, NOW - 10 * MIN, NOW + MIN);
    expect(b.key).toBe(a.key);
    const expiring = [ewrGroundStop(new Date(NOW + 2 * MIN).toISOString())];
    const before = currentFaaPicture(expiring, NOW, NOW + 16 * MIN);
    const after = currentFaaPicture(expiring, NOW, NOW + 18 * MIN);
    expect(after.key).not.toBe(before.key);
    expect(currentFaaPicture(live, NOW, NOW + FAA_STALE_AFTER_MS + MIN).key).not.toBe(a.key);
  });
});

describe('faaStatusAsOfLine', () => {
  const asOf = Date.parse('2026-11-10T14:05:00Z');

  it('is silent while both feeds are current', () => {
    expect(faaStatusAsOfLine({ faaAsOf: asOf, faaStale: false, nasAsOf: asOf, nasStale: false })).toBe(null);
  });

  it('says "FAA status as of HH:MMZ" and that nothing is shown as current', () => {
    expect(faaStatusAsOfLine({ faaAsOf: asOf, faaStale: true, nasAsOf: null, nasStale: false }))
      .toBe('FAA status as of 14:05Z: airport programs have not updated since and are not shown as current.');
    expect(faaStatusAsOfLine({ faaAsOf: asOf, faaStale: true, nasAsOf: asOf + 10 * MIN, nasStale: true }))
      .toBe('FAA status as of 14:05Z: the FAA has not answered since, so no program is shown as current.');
    expect(faaStatusAsOfLine({ faaAsOf: null, faaStale: false, nasAsOf: asOf, nasStale: true }))
      .toMatch(/^FAA status as of 14:05Z: system-wide programs/);
  });

  it('formats the clock in UTC like the rest of the Weather tab', () => {
    expect(zuluClock(asOf)).toBe('14:05Z');
  });
});
