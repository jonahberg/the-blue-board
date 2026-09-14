import { describe, it, expect } from 'vitest';

import { computeScheduleRowRisk, findBoardRiskForFlight } from '../src/lib/board-risk.js';

// Anchored to the real clock: `computeDelayRiskModel` reads `Date.now()` for its
// time-of-day and lead-time signals, so a fixture pinned to a fixed calendar date would
// score differently depending on when the suite runs.
const NOW_SEC = Math.floor(Date.now() / 1000);

/** A provider schedule row, departing two hours out so it is still scoreable. */
function row(overrides = {}) {
  const departure = NOW_SEC + 2 * 3600;
  return {
    identification: { number: { default: 'UA328' } },
    status: { text: 'Expected', generic: { status: { text: 'scheduled' } } },
    airport: {
      origin: { code: { iata: 'ORD' } },
      destination: { code: { iata: 'DEN' } },
    },
    time: { scheduled: { departure }, estimated: {}, real: {} },
    ...overrides,
  };
}

/** Conditions bad enough that the model scores something. */
const ROUGH = {
  faaIndex: {
    ORD: {
      groundStop: true,
      groundDelay: true,
      programs: [{ type: 'ground_delay', avgDelay: 55, reason: 'weather' }],
    },
  },
  weatherOpsByHub: {
    ORD: { level: 'SEVERE', reasons: ['thunderstorms'], hasThunderstorms: true, gustKt: 41 },
  },
  hubOtp: { ORD: 38 },
  iropsHubRates: { ORD: { cancellations: 40, total: 400, cancellationRate: 10, delayed60Rate: 22 } },
  nas: null,
};

describe('computeScheduleRowRisk', () => {
  it('scores a not-yet-departed row', () => {
    const risk = computeScheduleRowRisk(row(), 'ORD', 'departures', NOW_SEC, ROUGH);
    expect(risk).not.toBeNull();
    expect(risk.score).toBeGreaterThan(0);
    expect(['V.HIGH', 'HIGH', 'MOD', 'LOW']).toContain(risk.label);
    expect(Array.isArray(risk.factors)).toBe(true);
  });

  it('refuses to predict a flight that has already operated — it has facts', () => {
    const operated = row({
      status: { text: 'Departed', generic: { status: { text: 'departed' } } },
      time: {
        scheduled: { departure: NOW_SEC - 3 * 3600 },
        real: { departure: NOW_SEC - 3 * 3600 + 120 },
        estimated: {},
      },
    });
    expect(computeScheduleRowRisk(operated, 'ORD', 'departures', NOW_SEC, ROUGH)).toBeNull();
  });

  it('never returns a zero score — a zero is "nothing to say", i.e. no badge', () => {
    // Asserted as an INVARIANT rather than by fixture: the model carries a time-of-day
    // signal, so whether a given calm row scores 0 or 2 depends on the wall clock the
    // suite happens to run at. What must hold at every hour is that a returned result
    // is always a real score — a zero is filtered to null so the board paints no badge
    // rather than a confident green LOW.
    const calm = { faaIndex: {}, weatherOpsByHub: {}, hubOtp: {}, iropsHubRates: {}, nas: null };
    const cases = [
      [row(), 'ORD'],
      [
        row({
          airport: { origin: { code: { iata: 'AUS' } }, destination: { code: { iata: 'MSY' } } },
        }),
        'AUS',
      ],
      [row(), 'ORD'],
    ];
    for (const [flight, hub] of cases) {
      for (const deps of [calm, ROUGH]) {
        const risk = computeScheduleRowRisk(flight, hub, 'departures', NOW_SEC, deps);
        if (risk !== null) expect(risk.score).toBeGreaterThan(0);
      }
    }
  });

  it('labels whatever it does score', () => {
    const calm = { faaIndex: {}, weatherOpsByHub: {}, hubOtp: {}, iropsHubRates: {}, nas: null };
    const risk = computeScheduleRowRisk(row(), 'ORD', 'departures', NOW_SEC, calm);
    if (risk) expect(['V.HIGH', 'HIGH', 'MOD', 'LOW']).toContain(risk.label);
  });

  it('does not throw on an empty deps bag', () => {
    expect(() => computeScheduleRowRisk(row(), 'ORD', 'departures', NOW_SEC, {})).not.toThrow();
    expect(() => computeScheduleRowRisk(row(), 'ORD', 'departures', NOW_SEC)).not.toThrow();
  });

  it('reads the ARRIVALS hub off the right end of the route', () => {
    const arriving = row({
      airport: { origin: { code: { iata: 'DEN' } }, destination: { code: { iata: 'ORD' } } },
      time: { scheduled: { arrival: NOW_SEC + 2 * 3600, departure: 0 }, estimated: {}, real: {} },
    });
    // Scored against DEN as the departure hub, so ORD's severe weather must not apply.
    const risk = computeScheduleRowRisk(arriving, 'ORD', 'arrivals', NOW_SEC, ROUGH);
    const home = computeScheduleRowRisk(row(), 'ORD', 'departures', NOW_SEC, ROUGH);
    expect(home.score).toBeGreaterThan(risk ? risk.score : 0);
  });
});

describe('findBoardRiskForFlight', () => {
  const boards = {
    'ORD-departures-0': {
      hub: 'ORD',
      dir: 'departures',
      meta: { hubDisruptionMinutes: 0 },
      rows: [row()],
    },
    'DEN-arrivals-0': { hub: 'DEN', dir: 'arrivals', meta: null, rows: [] },
  };

  it('finds the flight on a loaded board and returns that board’s score', () => {
    const risk = findBoardRiskForFlight('UA328', boards, NOW_SEC, ROUGH);
    expect(risk).not.toBeNull();
    expect(risk.score).toBeGreaterThan(0);
  });

  it('is null when the flight is on no loaded board — never a default LOW', () => {
    // Audit Jul 3 2026: the card said LOW while the board said V.HIGH for the same
    // flight, purely because the flight-times feed was dark. Null means "say RISK N/A".
    expect(findBoardRiskForFlight('UA9999', boards, NOW_SEC, ROUGH)).toBeNull();
  });

  it('skips empty boards and a missing flight number', () => {
    expect(findBoardRiskForFlight('', boards, NOW_SEC, ROUGH)).toBeNull();
    expect(findBoardRiskForFlight('UA328', {}, NOW_SEC, ROUGH)).toBeNull();
    expect(findBoardRiskForFlight('UA328', null, NOW_SEC, ROUGH)).toBeNull();
  });

  it('falls back to parsing hub and direction out of the key', () => {
    const keyOnly = { 'ORD-departures-0': { meta: null, rows: [row()] } };
    expect(findBoardRiskForFlight('UA328', keyOnly, NOW_SEC, ROUGH)).not.toBeNull();
  });
});
