import { describe, it, expect } from 'vitest';

import {
  computeDelayRiskModel,
  liveConditionsApply,
  riskTimesForRow,
} from '../src/lib/delay-risk.js';
import { computeScheduleRowRisk, findBoardRiskForFlight } from '../src/lib/board-risk.js';

const sec = (iso) => Math.floor(Date.parse(iso) / 1000);

// The reader's case (Oct 7 2026, 20:53 EDT): TOMORROW's UA934 EWR→LHR, 08:20 EDT → 20:40 BST.
// AeroDataBox had an arrival estimate (on time) and no departure estimate.
const UA934_TOMORROW = {
  identification: { number: { default: 'UA934' } },
  status: { text: 'Expected', generic: { status: { text: 'scheduled' } } },
  airport: { origin: { code: { iata: 'EWR' } }, destination: { code: { iata: 'LHR' } } },
  time: {
    scheduled: { departure: sec('2026-10-08T12:20:00Z'), arrival: sec('2026-10-08T19:40:00Z') },
    estimated: { departure: null, arrival: sec('2026-10-08T19:40:00Z') },
    real: { departure: null, arrival: null },
  },
};
const VIEWED_AT_MS = Date.parse('2026-10-08T00:53:00Z'); // 20:53 EDT Oct 7

/** That evening's EWR: departure delays plus a planned ground stop in the NAS plan. */
const EWR_EVENING = {
  originHub: 'EWR',
  destinationHub: 'LHR',
  timeZone: 'America/New_York',
  originFaa: { departureDelay: true, maxDelay: 60 },
  originOtp: 62,
  plannedTmis: [{ type: 'terminal', event: 'GS', affectedAirports: ['EWR'], time: 'later' }],
};

describe('riskTimesForRow — like with like', () => {
  it('measures an arrival estimate against the scheduled ARRIVAL, never the departure', () => {
    const times = riskTimesForRow(UA934_TOMORROW);
    expect(times.scheduledTime).toBe(UA934_TOMORROW.time.scheduled.departure);
    expect(times.comparisonTime).toBe(UA934_TOMORROW.time.estimated.arrival);
    expect(times.delayBaseTime).toBe(UA934_TOMORROW.time.scheduled.arrival);
  });

  it('prefers the departure pair when a departure estimate exists', () => {
    const row = structuredClone(UA934_TOMORROW);
    row.time.estimated.departure = row.time.scheduled.departure + 45 * 60;
    const times = riskTimesForRow(row);
    expect(times.comparisonTime).toBe(row.time.estimated.departure);
    expect(times.delayBaseTime).toBe(row.time.scheduled.departure);
  });

  it('has nothing to compare when only one side of a pair exists', () => {
    const row = structuredClone(UA934_TOMORROW);
    row.time.scheduled.arrival = null;
    expect(riskTimesForRow(row)).toEqual({
      scheduledTime: row.time.scheduled.departure,
      comparisonTime: '',
      delayBaseTime: '',
    });
  });
});

describe('the 440-minute "delay"', () => {
  it('the old pairing reproduces the reader’s HIGH 59/100', () => {
    const t = UA934_TOMORROW.time;
    const old = computeDelayRiskModel({
      ...EWR_EVENING,
      originFaa: null,
      originOtp: null,
      nowMs: Date.parse('2026-10-08T12:00:00Z'), // same-day view, so only the pairing differs
      scheduledTime: t.scheduled.departure,
      comparisonTime: t.estimated.departure || t.estimated.arrival,
    });
    expect(old.factors).toContain('Already 440min delayed');
  });

  it('an on-time arrival estimate adds no delay at all', () => {
    const risk = computeDelayRiskModel({
      ...EWR_EVENING,
      ...riskTimesForRow(UA934_TOMORROW),
      nowMs: VIEWED_AT_MS,
    });
    expect(risk.components.find((c) => c.id === 'actual-delay')).toBeUndefined();
    expect(risk.factors.join(' ')).not.toMatch(/delayed|min delay/);
  });

  it('a real projected arrival delay still counts', () => {
    const row = structuredClone(UA934_TOMORROW);
    row.time.estimated.arrival += 95 * 60;
    const risk = computeDelayRiskModel({ ...EWR_EVENING, ...riskTimesForRow(row), nowMs: VIEWED_AT_MS });
    expect(risk.factors).toContain('Already 95min delayed');
  });

  it('an arrivals-board row with no departure estimate is not "delayed" by its block time', () => {
    const arriving = {
      ...structuredClone(UA934_TOMORROW),
      airport: { origin: { code: { iata: 'SJO' } }, destination: { code: { iata: 'SFO' } } },
    };
    arriving.time.scheduled = { departure: sec('2026-10-08T15:00:00Z'), arrival: sec('2026-10-08T21:38:00Z') };
    arriving.time.estimated = { departure: null, arrival: sec('2026-10-08T21:38:00Z') };
    const risk = computeScheduleRowRisk(arriving, 'SFO', 'arrivals', sec('2026-10-08T12:00:00Z'), {});
    expect((risk?.factors || []).join(' ')).not.toMatch(/delayed|min delay/);
  });
});

describe('liveConditionsApply — tonight’s conditions are not tomorrow’s', () => {
  it('drops a later-day departure more than 6h out', () => {
    expect(liveConditionsApply(UA934_TOMORROW.time.scheduled.departure, VIEWED_AT_MS, 'America/New_York')).toBe(false);
  });

  it('keeps a post-midnight red-eye that is part of tonight’s operation', () => {
    const now = Date.parse('2026-10-08T03:00:00Z'); // 23:00 EDT Oct 7
    expect(liveConditionsApply(sec('2026-10-08T04:30:00Z'), now, 'America/New_York')).toBe(true);
  });

  it('keeps every same-day departure, and is true when the time is unknown', () => {
    expect(liveConditionsApply(sec('2026-10-08T02:30:00Z'), VIEWED_AT_MS - 10 * 3600e3, 'America/New_York')).toBe(true);
    expect(liveConditionsApply('', VIEWED_AT_MS, 'America/New_York')).toBe(true);
  });

  it('scores tomorrow’s UA934 on what is known about it, not on this evening at EWR', () => {
    const risk = computeDelayRiskModel({ ...EWR_EVENING, ...riskTimesForRow(UA934_TOMORROW), nowMs: VIEWED_AT_MS });
    expect(risk.label).toBe('LOW');
    expect(risk.factors).toEqual(['EWR congestion baseline']);
  });

  it('the same flight departing within the hour still gets the evening’s delays and plan', () => {
    const soon = Date.parse('2026-10-08T11:40:00Z');
    const risk = computeDelayRiskModel({ ...EWR_EVENING, ...riskTimesForRow(UA934_TOMORROW), nowMs: soon });
    expect(risk.factors.some((f) => f.startsWith('Departure delays at EWR'))).toBe(true);
    expect(risk.factors.some((f) => f.startsWith('Planned ground stop at EWR'))).toBe(true);
  });
});

describe('findBoardRiskForFlight — the instance the card is about', () => {
  const NOW = Math.floor(Date.now() / 1000);
  const base = {
    identification: { number: { default: 'UA328' } },
    status: { text: 'Expected', generic: { status: { text: 'scheduled' } } },
    airport: { origin: { code: { iata: 'ORD' } }, destination: { code: { iata: 'DEN' } } },
  };
  const today = { ...base, time: { scheduled: { departure: NOW + 2 * 3600 }, estimated: {}, real: {} } };
  const tomorrow = { ...base, time: { scheduled: { departure: NOW + 26 * 3600 }, estimated: {}, real: {} } };
  const deps = {
    faaIndex: { ORD: { groundStop: true } },
    weatherOpsByHub: {},
    hubOtp: {},
    iropsHubRates: {},
    nas: null,
  };

  it('picks today’s row even when tomorrow’s board comes first', () => {
    const boards = {
      'ORD-departures-1': { hub: 'ORD', dir: 'departures', rows: [tomorrow] },
      'ORD-departures-0': { hub: 'ORD', dir: 'departures', rows: [today] },
    };
    const risk = findBoardRiskForFlight('UA328', boards, NOW, deps);
    expect(risk.factors).toContain('Ground stop at ORD');
  });
});
