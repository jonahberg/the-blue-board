// Future "actual" times and date-shifted stale legs (live audit Oct 3 2026, v1.11.3).
//
// At 17:55Z the ORD boards carried 13 rows whose `time.real.*` was LATER than the clock: an
// "Arrived" UA2113 with a real arrival at 22:55Z, a "Departed" UA845 that leaves at 9:30 PM CDT,
// an "Arrived" UA4422 eight minutes before it reached the gate. Two different things produce them:
//
//   - AeroDataBox hands back yesterday's leg with its ARRIVAL shifted +1 day. UA2113 LAX→ORD left
//     Oct 2 17:58Z and "arrived" Oct 3 22:55Z — a 29-hour LAX→ORD block. The schedule repair then
//     copied that arrival into the scheduled arrival, which moved the leg INTO today's hub day.
//   - Rows flagged Departed/Arrived whose revised time is still ahead of us (UA845, UA1363,
//     UA4422): a forecast, not an actual.
//
// The fixture rows below are verbatim from theblueboard.co/api/schedule at that moment.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  FUTURE_ACTUAL_TOLERANCE_SECONDS,
  MAX_PLAUSIBLE_BLOCK_SECONDS,
  isFutureActual,
  isImplausibleLegSpan,
} from '../src/lib/schedule-plausibility.js';
import { clearFutureActuals, sanitizeBoardFlights } from '../src/lib/schedule-actuals.js';
import { classifySchedStatus } from '../src/lib/schedule-status.js';

const FIXTURE = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/ord-2026-10-03-future-actuals.json'), 'utf8'),
);
// 2026-10-03 17:55:14Z — when the boards were read (meta.regSightingsAt of that response).
const NOW = FIXTURE.capturedAt;
const DEP = FIXTURE.departures.flights;
const ARR = FIXTURE.arrivals.flights;

const ident = (f) => f.identification.number.default;
const find = (rows, id, pred = () => true) => {
  const row = rows.find((f) => ident(f) === id && pred(f));
  if (!row) throw new Error(`fixture row ${id} missing`);
  return row;
};
const arrived = (f) => f.status.text === 'arrived';
const futureRealCount = (rows, now) =>
  rows.filter((f) => Object.values(f.time.real).some((t) => t && t > now + FUTURE_ACTUAL_TOLERANCE_SECONDS)).length;

describe('the plausibility bounds', () => {
  it('allows the longest United block (~17.5h) and rejects a day-long one', () => {
    expect(MAX_PLAUSIBLE_BLOCK_SECONDS).toBeGreaterThanOrEqual(18 * 3600);
    expect(MAX_PLAUSIBLE_BLOCK_SECONDS).toBeLessThan(24 * 3600);
  });

  it('isFutureActual has a small tolerance for clock skew and nothing else', () => {
    expect(isFutureActual(NOW + 60, NOW)).toBe(false);
    expect(isFutureActual(NOW + FUTURE_ACTUAL_TOLERANCE_SECONDS, NOW)).toBe(false);
    expect(isFutureActual(NOW + FUTURE_ACTUAL_TOLERANCE_SECONDS + 1, NOW)).toBe(true);
    expect(isFutureActual(null, NOW)).toBe(false);
    expect(isFutureActual(NOW + 3600, null)).toBe(false);
  });
});

describe('isImplausibleLegSpan', () => {
  it("flags yesterday's UA2113 leg whose arrival was shifted a day (29h LAX→ORD)", () => {
    const bogus = find(ARR, 'UA2113', arrived);
    expect(bogus._source.scheduleTimeDerivedFromActual.arrival).toBe(true);
    expect(isImplausibleLegSpan(bogus)).toBe(true);
  });

  it('flags the other date-shifted arrivals on the same board (UA2835, UA2665)', () => {
    expect(isImplausibleLegSpan(find(ARR, 'UA2835', arrived))).toBe(true);
    expect(isImplausibleLegSpan(find(ARR, 'UA2665', arrived))).toBe(true);
  });

  it("leaves today's UA2113 and every ordinary row alone", () => {
    expect(isImplausibleLegSpan(find(ARR, 'UA2113', (f) => !arrived(f)))).toBe(false);
    expect(isImplausibleLegSpan(find(ARR, 'UA4422'))).toBe(false);
    expect(isImplausibleLegSpan(find(ARR, 'UA1958'))).toBe(false);
    expect(isImplausibleLegSpan(find(DEP, 'UA845'))).toBe(false);
  });

  it('judges only legs that actually happened — a schedule on its own is not evidence', () => {
    const t0 = NOW - 3600;
    const row = (time) => ({ time: { scheduled: {}, real: {}, estimated: {}, ...time } });
    expect(isImplausibleLegSpan(row({ scheduled: { departure: t0, arrival: t0 + 30 * 3600 } }))).toBe(false);
    expect(isImplausibleLegSpan(row({ real: { departure: t0, arrival: t0 + 17.5 * 3600 } }))).toBe(false);
    expect(isImplausibleLegSpan(row({ real: { departure: t0, arrival: t0 + 21 * 3600 } }))).toBe(true);
    // A real departure against a scheduled arrival a day later is the same splice.
    expect(isImplausibleLegSpan(row({ real: { departure: t0 }, scheduled: { arrival: t0 + 26 * 3600 } }))).toBe(true);
  });
});

describe('clearFutureActuals', () => {
  it('UA845 ORD→GRU "Departed" 9.5h before it leaves becomes Expected at its scheduled time', () => {
    const row = find(DEP, 'UA845');
    expect(classifySchedStatus(row, 'departures', NOW).key).toBe('departed'); // the bug
    const out = clearFutureActuals(row, NOW);
    expect(out).not.toBe(row);
    expect(out.time.real.departure).toBeNull();
    expect(out.time.estimated.departure).toBe(row.time.real.departure);
    expect(out.time.scheduled).toEqual(row.time.scheduled);
    expect(out.status.generic.status.text).toBe('scheduled');
    expect(out.status.live).toBe(false);
    expect(out._source.futureActualCleared).toEqual({ departure: true, arrival: false });
    const shown = classifySchedStatus(out, 'departures', NOW);
    expect(shown.key).toBe('scheduled');
    expect(shown.text).toBe('Expected');
  });

  it('UA1363 "Departed" at the 17:14Z fetch, 45 minutes before its 18:00Z departure, was not departed', () => {
    const row = find(DEP, 'UA1363');
    const fetchedAt = FIXTURE.departures.meta.generatedAt;
    const out = clearFutureActuals(row, fetchedAt);
    expect(out.time.real.departure).toBeNull();
    expect(classifySchedStatus(out, 'departures', fetchedAt).key).toBe('scheduled');
    // By 17:55:14Z its 18:00Z time is inside the 5-minute clock-skew tolerance: left alone.
    expect(clearFutureActuals(row, NOW)).toBe(row);
  });

  it('UA4422 FSD→ORD "Arrived" 8 minutes early is en route — it really did depart', () => {
    const row = find(ARR, 'UA4422');
    expect(classifySchedStatus(row, 'arrivals', NOW).key).toBe('landed'); // the bug
    const out = clearFutureActuals(row, NOW);
    expect(out.time.real.arrival).toBeNull();
    expect(out.time.real.departure).toBe(row.time.real.departure);
    expect(out.time.estimated.arrival).toBe(row.time.real.arrival);
    expect(out.status.generic.status.text).toBe('en-route');
    expect(out._source.futureActualCleared).toEqual({ departure: false, arrival: true });
    expect(classifySchedStatus(out, 'arrivals', NOW).key).toBe('enroute');
  });

  it('becomes landed again once the clock passes the time it reported', () => {
    const row = find(ARR, 'UA4422');
    expect(clearFutureActuals(row, row.time.real.arrival + 60)).toBe(row);
  });

  it('an arrival whose departure has not happened either goes back to Expected', () => {
    const row = {
      status: { generic: { status: { text: 'landed', diverted: false }, type: '' }, text: 'arrived', icon: 'green', live: false },
      time: {
        scheduled: { departure: NOW + 2 * 3600, arrival: NOW + 5 * 3600 },
        real: { departure: NOW + 2 * 3600, arrival: NOW + 5 * 3600 },
        estimated: { departure: null, arrival: null },
      },
      _source: { provider: 'aerodatabox' },
    };
    const out = clearFutureActuals(row, NOW);
    expect(out.time.real).toEqual({ departure: null, arrival: null });
    expect(out.status.generic.status.text).toBe('scheduled');
    expect(classifySchedStatus(out, 'arrivals', NOW).key).toBe('scheduled');
  });

  it('keeps an existing estimate rather than overwriting it with the cleared time', () => {
    const row = find(DEP, 'UA1363');
    const withEstimate = { ...row, time: { ...row.time, estimated: { ...row.time.estimated, departure: NOW + 1800 } } };
    expect(clearFutureActuals(withEstimate, NOW).time.estimated.departure).toBe(NOW + 1800);
  });

  it('clears the time but keeps the label on cancelled and diverted rows', () => {
    const base = find(DEP, 'UA845');
    const cancelled = { ...base, status: { generic: { status: { text: 'canceled', diverted: false }, type: 'canceled' }, text: 'canceled', icon: 'red', live: false } };
    const diverted = { ...base, status: { generic: { status: { text: 'landed', diverted: true }, type: '' }, text: 'diverted', icon: 'red', live: false } };
    expect(clearFutureActuals(cancelled, NOW).status).toBe(cancelled.status);
    expect(clearFutureActuals(cancelled, NOW).time.real.departure).toBeNull();
    expect(clearFutureActuals(diverted, NOW).status).toBe(diverted.status);
  });

  it('never mutates its input and returns the same object when nothing is in the future', () => {
    const row = find(DEP, 'UA845');
    const before = structuredClone(row);
    clearFutureActuals(row, NOW);
    expect(row).toEqual(before);
    const past = find(ARR, 'UA1958');
    expect(clearFutureActuals(past, NOW)).toBe(past);
  });
});

describe('sanitizeBoardFlights (the whole board, as served)', () => {
  it('leaves no future actual on either ORD board and drops the date-shifted legs', () => {
    expect(futureRealCount(DEP, NOW)).toBe(1); // UA845 (UA1363 is inside the skew tolerance by now)
    expect(futureRealCount(ARR, NOW)).toBeGreaterThanOrEqual(5);

    const dep = sanitizeBoardFlights(DEP, NOW);
    expect(futureRealCount(dep.flights, NOW)).toBe(0);
    expect(dep.staleLegs).toBe(0);
    expect(dep.futureActuals).toBe(1);
    expect(dep.flights).toHaveLength(DEP.length);
    // Against the clock of the fetch that produced the departures board, both are caught.
    expect(sanitizeBoardFlights(DEP, FIXTURE.departures.meta.generatedAt).futureActuals).toBe(2);

    const arr = sanitizeBoardFlights(ARR, NOW);
    expect(futureRealCount(arr.flights, NOW)).toBe(0);
    // UA2113 (LAX, Oct 2), UA2835 (SEA, Oct 2), UA2665 (PHL, Sep 30): gone. Today's rows for the
    // same three numbers stay.
    expect(arr.staleLegs).toBe(3);
    const left = arr.flights.map(ident);
    for (const id of ['UA2113', 'UA2835', 'UA2665']) {
      expect(left.filter((x) => x === id)).toHaveLength(1);
      expect(arr.flights.find((f) => ident(f) === id).status.text).toBe('expected');
    }
    expect(arr.flights.some((f) => classifySchedStatus(f, 'arrivals', NOW).key === 'landed' && f.time.real.arrival > NOW)).toBe(false);
  });

  it('returns the input array untouched when there is nothing to fix', () => {
    const clean = ARR.filter((f) => ident(f) === 'UA1958' || ident(f) === 'UA882');
    const out = sanitizeBoardFlights(clean, NOW);
    expect(out.flights).toBe(clean);
    expect(out).toMatchObject({ staleLegs: 0, futureActuals: 0 });
  });

  it('tolerates a board with no flights array', () => {
    expect(sanitizeBoardFlights(undefined, NOW)).toMatchObject({ flights: undefined, staleLegs: 0, futureActuals: 0 });
  });
});
