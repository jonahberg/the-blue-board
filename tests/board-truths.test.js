// Two small truths on the schedule board (Nov 10 2026).
//  (a) A departure the live feed proved, with no provider departure time, used to print "+0m": the
//      provider's ESTIMATE restating the schedule, not a measurement.
//  (b) On arrivals boards the "presumed landed" chip also counts landings the live feed PROVED,
//      and its tooltip said "without a live update".
import { describe, it, expect } from 'vitest';

import { buildScheduleRow, delayCell } from '../src/lib/schedule-row-model.js';
import { classifySchedStatus } from '../src/lib/schedule-status.js';
import { computeScheduleStatCounts, statStripCopy } from '../src/lib/board-stats.js';

const NOW_SEC = 1791074760; // 00:46Z Oct 4 2026
const TS = { hasGateArr: true, hasGateDep: true, hasRunwayArr: true, hasRunwayDep: true, gateDistinctArr: false, gateDistinctDep: false };
const expected = () => ({ icon: '', live: false, text: 'expected', generic: { type: '', status: { text: 'scheduled', diverted: false } } });

function row(time, extra = {}) {
  return {
    identification: { number: { default: 'UA1234' } },
    status: expected(),
    time: { real: { departure: null, arrival: null }, estimated: { departure: null, arrival: null }, ...time },
    airport: { origin: { code: { iata: 'ORD' } }, destination: { code: { iata: 'DEN' } } },
    aircraft: { model: { code: 'B739' }, registration: 'N12345' },
    _source: { provider: 'aerodatabox', timeSource: TS },
    ...extra,
  };
}

function model(flight, dir) {
  const status = classifySchedStatus(flight, dir, NOW_SEC);
  return buildScheduleRow(flight, { hub: dir === 'arrivals' ? 'DEN' : 'ORD', dir, timeZone: 'UTC', status, reg: 'N12345' });
}

describe('(a) a feed-confirmed departure with no provider time shows no "+0m"', () => {
  const sched = NOW_SEC - 20 * 60;

  it('the live feed has it airborne, the provider estimate equals the schedule: no delay figure', () => {
    const flight = row(
      { scheduled: { departure: sched, arrival: sched + 3 * 3600 }, estimated: { departure: sched, arrival: sched + 3 * 3600 } },
      { live: { seenAt: (NOW_SEC - 30) * 1000 } },
    );
    const m = model(flight, 'departures');
    expect(m.status).toMatchObject({ key: 'departed', live: true });
    expect(m.delay).toEqual({ kind: 'none' });
  });

  it('a big estimate on such a row still shows, titled as an estimate', () => {
    const cell = delayCell({
      statusKey: 'departed', presumed: false, schedTimeSec: sched, actualTimeSec: sched + 40 * 60,
      hasRealTime: false, dir: 'departures', risk: null, basis: 'estimate', pastDue: true,
    });
    expect(cell).toMatchObject({ kind: 'delta', text: '+40m', title: 'Estimated vs scheduled departure' });
  });

  it('a real departure time is still a measurement, small or not', () => {
    const cell = delayCell({
      statusKey: 'departed', presumed: false, schedTimeSec: sched, actualTimeSec: sched + 2 * 60,
      hasRealTime: true, dir: 'departures', risk: null, basis: 'gate',
    });
    expect(cell).toMatchObject({ kind: 'delta', minutes: 2 });
  });

  it('an arrival still in the air keeps its estimated arrival (a forecast of this board’s side)', () => {
    const cell = delayCell({
      statusKey: 'enroute', presumed: false, schedTimeSec: sched, actualTimeSec: sched - 3 * 60,
      hasRealTime: false, dir: 'arrivals', risk: null, basis: 'estimate', pastDue: true,
    });
    expect(cell).toMatchObject({ kind: 'delta', minutes: -3 });
  });
});

describe('(b) the "presumed landed" chip says what it counts', () => {
  it('a landing the live feed proved is in the presumed bucket, and the arrivals tooltip says so', () => {
    const seenLanded = { key: 'landed', presumed: true, inferred: true, seenLanded: true };
    const timeInferred = { key: 'landed', presumed: true, inferred: true };
    const counts = computeScheduleStatCounts([{ a: 1 }, { b: 2 }], {
      dir: 'arrivals',
      classify: (fl) => (fl.a ? seenLanded : timeInferred),
    });
    expect(counts.presumed).toBe(2);

    const copy = statStripCopy('arrivals').presumed;
    expect(copy.label).toBe('presumed landed');
    expect(copy.title).toMatch(/live flight feed saw the landing/);
    expect(copy.title).not.toMatch(/without a live update/);
  });

  it('the departures tooltip keeps the clock-inference wording (every presumed departure is one)', () => {
    const copy = statStripCopy('departures').presumed;
    expect(copy.label).toBe('presumed departed');
    expect(copy.title).toMatch(/without a live update/);
  });
});
