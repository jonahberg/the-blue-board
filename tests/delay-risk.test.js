import { describe, expect, it, vi } from 'vitest';
import { computeDelayRiskModel } from '../src/lib/delay-risk.js';

function componentPoints(result, id) {
  const component = result.components.find((c) => c.id === id);
  return component ? component.points : null;
}

describe('computeDelayRiskModel', () => {
  it('treats an existing large delay as the dominant signal', () => {
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: '2026-03-18T18:00:00Z',
      comparisonTime: '2026-03-18T20:05:00Z',
      originHub: 'EWR',
      destinationHub: 'SFO',
      timeZone: 'America/New_York',
    });

    expect(result.label).toBe('HIGH');
    expect(result.score).toBeGreaterThanOrEqual(55);
    expect(result.factors[0]).toContain('Already 125min delayed');
    expect(result.components[0].id).toBe('actual-delay');
  });

  it('caps stacked severe operational signals at very high risk', () => {
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T22:15:00Z'),
      scheduledTime: '2026-03-18T23:00:00Z',
      originHub: 'EWR',
      destinationHub: 'SFO',
      timeZone: 'America/New_York',
      originFaa: { groundStop: true },
      originWeather: {
        level: 'severe',
        reasons: ['thunderstorms', 'low visibility'],
        fltCat: 'LIFR',
        hasThunderstorms: true,
        hasFreezingPrecip: false,
        hasSnow: false,
        hasFog: true,
        gustKt: 42,
        tempC: 18,
      },
      originIrops: { cancellationRate: 20, delayed60Rate: 24 },
      inboundFlight: {
        origin: 'ORD',
        lat: 41.97,
        lon: -87.9,
        spd: 230,
        alt: 10000,
        vr: 0,
        acType: 'B739',
        originWeatherLevel: 'warning',
        originFaaGroundStop: false,
        originFaaGroundDelay: true,
      },
    });

    expect(result.score).toBe(100);
    expect(result.label).toBe('V.HIGH');
    expect(result.factors).toContain('Ground stop at EWR');
    expect(result.factors).toContain('Multiple severe disruptions compounding');
  });

  it('uses aircraft journey propagation as a real scored feature', () => {
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T18:00:00Z'),
      scheduledTime: '2026-03-18T20:30:00Z',
      originHub: 'ORD',
      destinationHub: 'MCI',
      timeZone: 'America/Chicago',
      originOtp: 52,
      originIrops: { cancellationRate: 2, delayed60Rate: 23 },
      aircraftJourney: {
        segments: [
          { flightNumber: 'UA101', delayMin: 62 },
          { flightNumber: 'UA202', delayMin: 48 },
          { flightNumber: 'UA303', delayMin: 0 },
        ],
      },
      currentFlightNumber: 'UA303',
    });

    expect(result.label).toBe('MOD');
    expect(result.factors).toContain('Aircraft running late all day (avg +55m across 2 segments)');
    expect(result.components.some((component) => component.id === 'journey-propagation')).toBe(true);
  });

  it('uses the scheduled hub-local hour for cascade scoring', () => {
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T15:00:00Z'),
      scheduledTime: '2026-03-19T04:30:00Z',
      originHub: 'LAX',
      destinationHub: 'ORD',
      timeZone: 'America/Los_Angeles',
    });

    expect(result.factors).toContain('Late evening - high cascade risk');
  });

  it('handles numeric avgDelay from JSON endpoint', () => {
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: '2026-03-18T18:00:00Z',
      originHub: 'LGA',
      destinationHub: 'ORD',
      timeZone: 'America/New_York',
      originFaa: { groundDelay: true, avgDelay: 95, maxDelay: 120 },
    });

    expect(result.score).toBeGreaterThanOrEqual(25);
    expect(result.factors.some(f => f.includes('Ground delay program'))).toBe(true);
    expect(result.factors.some(f => f.includes('120m'))).toBe(true);
  });

  it('handles string avgDelay from XML fallback', () => {
    // parseDelayNumber extracts max number from string: "5 hours and 45 minutes" → 45
    // In new API, server normalizes to numeric minutes. Old parseDelayNumber is defensive fallback.
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: '2026-03-18T18:00:00Z',
      originHub: 'LGA',
      destinationHub: 'ORD',
      timeZone: 'America/New_York',
      originFaa: { groundDelay: true, avgDelay: '5 hours and 45 minutes' },
    });

    expect(result.score).toBeGreaterThanOrEqual(20);
    expect(result.factors.some(f => f.includes('Ground delay program'))).toBe(true);
  });

  it('handles null avgDelay gracefully', () => {
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: '2026-03-18T18:00:00Z',
      originHub: 'LGA',
      destinationHub: 'ORD',
      timeZone: 'America/New_York',
      originFaa: { groundDelay: true, avgDelay: null, maxDelay: null },
    });

    expect(result.factors.some(f => f.includes('Ground delay program'))).toBe(true);
  });

  it('adds probability-of-extension signal for ground stops', () => {
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: '2026-03-18T18:00:00Z',
      originHub: 'EWR',
      destinationHub: 'ORD',
      timeZone: 'America/New_York',
      originFaa: {
        groundStop: true,
        probabilityOfExtension: 'HIGH',
        programs: [{ type: 'ground_stop', probabilityOfExtension: 'HIGH' }],
      },
    });

    expect(result.factors.some(f => f.includes('GS extension likely'))).toBe(true);
    expect(result.components.some(c => c.id === 'origin-faa-gs-ext')).toBe(true);
  });

  it('adds arrival rate signal for reduced capacity', () => {
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: '2026-03-18T18:00:00Z',
      originHub: 'SFO',
      destinationHub: 'ORD',
      timeZone: 'America/Los_Angeles',
      originFaa: { runwayConfig: { arrivalRunways: '28L', departureRunways: '28R', arrivalRate: 20 } },
    });

    expect(result.factors.some(f => f.includes('Reduced arrival rate'))).toBe(true);
    expect(result.components.some(c => c.id === 'origin-faa-rate')).toBe(true);
  });

  it('adds planned TMI signals for hub airports', () => {
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: '2026-03-18T18:00:00Z',
      originHub: 'EWR',
      destinationHub: 'ORD',
      timeZone: 'America/New_York',
      plannedTmis: [
        { time: 'AFTER 1800', event: 'EWR GDP POSSIBLE', type: 'terminal', affectedAirports: ['EWR'] },
      ],
    });

    expect(result.factors.some(f => f.includes('Planned ground delay'))).toBe(true);
    expect(result.components.some(c => c.id === 'origin-planned-gdp')).toBe(true);
  });

  // --- Actual-delay magnitude bands (the exact scoring class of the runway-vs-gate incident) ---

  const delayBands = [
    { minutes: 20, points: 15, factor: '20min delay', notAlready: true },
    { minutes: 45, points: 30, factor: '45min delay', notAlready: true },
    { minutes: 75, points: 40, factor: 'Already 75min delayed', notAlready: false },
  ];

  for (const band of delayBands) {
    it(`buckets a ${band.minutes}min actual delay into the ${band.points}-point band`, () => {
      const scheduled = Date.parse('2026-03-18T18:00:00Z');
      const result = computeDelayRiskModel({
        nowMs: Date.parse('2026-03-18T17:00:00Z'),
        scheduledTime: scheduled,
        comparisonTime: scheduled + band.minutes * 60000,
        originHub: 'ORD',
        destinationHub: 'MCI',
        timeZone: 'America/Chicago',
      });

      expect(componentPoints(result, 'actual-delay')).toBe(band.points);
      expect(result.factors).toContain(band.factor);
      if (band.notAlready) {
        expect(result.factors.some((f) => f.startsWith('Already'))).toBe(false);
      }
    });
  }

  it('emits no actual-delay signal below the 15-minute floor', () => {
    const scheduled = Date.parse('2026-03-18T18:00:00Z');
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: scheduled,
      comparisonTime: scheduled + 10 * 60000,
      originHub: 'ORD',
      destinationHub: 'MCI',
      timeZone: 'America/Chicago',
    });

    expect(componentPoints(result, 'actual-delay')).toBeNull();
  });

  // --- Inbound-aircraft turnaround engine (haversine ETA + widebody thresholds) ---

  it('scores an inbound that cannot make its turnaround at 28 points', () => {
    const nowMs = Date.parse('2026-03-18T12:00:00Z');
    const result = computeDelayRiskModel({
      nowMs,
      scheduledTime: nowMs + 60 * 60000,
      originHub: 'ORD',
      destinationHub: 'DEN',
      timeZone: 'America/Chicago',
      inboundFlight: { origin: 'LAX', lat: 33.942, lon: -118.408, spd: 230, acType: 'B738' },
    });

    expect(componentPoints(result, 'inbound-turn')).toBe(28);
    expect(result.factors.some((f) => f.includes('cannot make turnaround'))).toBe(true);
  });

  it('requires more buffer for a widebody than a narrowbody on identical geometry', () => {
    const nowMs = Date.parse('2026-03-18T12:00:00Z');
    const base = {
      nowMs,
      scheduledTime: nowMs + 85 * 60000,
      originHub: 'ORD',
      destinationHub: 'DEN',
      timeZone: 'America/Chicago',
    };
    const inbound = { origin: 'STL', lat: 41.5, lon: -87.9, spd: 230 };

    const narrow = computeDelayRiskModel({ ...base, inboundFlight: { ...inbound, acType: 'B738' } });
    const wide = computeDelayRiskModel({ ...base, inboundFlight: { ...inbound, acType: 'B789' } });

    // Same ETA, but the widebody needs a 75m turn vs the narrowbody's 45m, so it lands a worse tier.
    expect(componentPoints(narrow, 'inbound-turn')).toBe(12);
    expect(componentPoints(wide, 'inbound-turn')).toBe(28);
  });

  it('uses the no-position fallback for an inbound still airborne without a fix', () => {
    const nowMs = Date.parse('2026-03-18T12:00:00Z');
    const result = computeDelayRiskModel({
      nowMs,
      scheduledTime: nowMs + 30 * 60000,
      originHub: 'ORD',
      destinationHub: 'DEN',
      timeZone: 'America/Chicago',
      inboundFlight: { origin: 'DEN', spd: 0 },
    });

    expect(componentPoints(result, 'inbound-turn')).toBe(22);
    expect(result.factors.some((f) => f.includes('still airborne'))).toBe(true);
  });

  // --- Destination-role scoring (distinct weights + arrival wording) ---

  it('scores a destination ground stop at the arrival weight', () => {
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: '2026-03-18T18:00:00Z',
      originHub: 'ORD',
      destinationHub: 'SFO',
      timeZone: 'America/Chicago',
      destinationFaa: { groundStop: true },
    });

    expect(componentPoints(result, 'destination-faa-gs')).toBe(20);
    expect(result.factors).toContain('Ground stop at SFO');
  });

  it('scores destination LIFR weather at the arrival weight', () => {
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: '2026-03-18T18:00:00Z',
      originHub: 'ORD',
      destinationHub: 'DEN',
      timeZone: 'America/Chicago',
      destinationWeather: { fltCat: 'LIFR' },
    });

    expect(componentPoints(result, 'destination-weather-lifr')).toBe(5);
  });

  it('labels destination cancellations as arrival disruptions', () => {
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: '2026-03-18T18:00:00Z',
      originHub: 'ORD',
      destinationHub: 'DEN',
      timeZone: 'America/Chicago',
      destinationIrops: { cancellationRate: 15 },
    });

    expect(componentPoints(result, 'destination-irops-cancel')).toBe(7);
    expect(result.factors.some((f) => f.includes('(arrival disruptions)'))).toBe(true);
  });

  // --- FAA airport-closure branch (highest-severity FAA signal, early-returns) ---

  it('scores an origin closure at 35 points and suppresses lower FAA signals', () => {
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: '2026-03-18T18:00:00Z',
      originHub: 'ORD',
      destinationHub: 'DEN',
      timeZone: 'America/Chicago',
      originFaa: { closure: true, groundStop: true },
    });

    expect(componentPoints(result, 'origin-faa-closure')).toBe(35);
    expect(result.factors).toContain('Airport closed at ORD');
    // Closure short-circuits collectFaaSignals, so the ground stop must NOT also score.
    expect(componentPoints(result, 'origin-faa-gs')).toBeNull();
  });

  it('scores a destination closure at 25 points', () => {
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: '2026-03-18T18:00:00Z',
      originHub: 'ORD',
      destinationHub: 'SFO',
      timeZone: 'America/Chicago',
      destinationFaa: { closure: true },
    });

    expect(componentPoints(result, 'destination-faa-closure')).toBe(25);
    expect(result.factors).toContain('Airport closed at SFO');
  });

  // --- Hub-specific LIFR weights (the operational facts the AI system prompt cites) ---

  it('weights SFO origin LIFR at 14 with single-stream wording', () => {
    const result = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: '2026-03-18T18:00:00Z',
      originHub: 'SFO',
      destinationHub: 'ORD',
      timeZone: 'America/Los_Angeles',
      originWeather: { fltCat: 'LIFR' },
    });

    expect(componentPoints(result, 'origin-weather-lifr')).toBe(14);
    expect(result.factors.some((f) => f.includes('single-stream'))).toBe(true);
  });

  it('weights EWR origin LIFR at 12 and a generic hub at 10', () => {
    const ewr = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: '2026-03-18T18:00:00Z',
      originHub: 'EWR',
      destinationHub: 'ORD',
      timeZone: 'America/New_York',
      originWeather: { fltCat: 'LIFR' },
    });
    const iah = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: '2026-03-18T18:00:00Z',
      originHub: 'IAH',
      destinationHub: 'ORD',
      timeZone: 'America/Chicago',
      originWeather: { fltCat: 'LIFR' },
    });

    expect(componentPoints(ewr, 'origin-weather-lifr')).toBe(12);
    expect(componentPoints(iah, 'origin-weather-lifr')).toBe(10);
  });

  it('fires the compound-severe signal only at three or more severe signals', () => {
    const twoSevere = computeDelayRiskModel({
      nowMs: Date.parse('2026-03-18T17:00:00Z'),
      scheduledTime: '2026-03-18T18:00:00Z',
      originHub: 'EWR',
      destinationHub: 'ORD',
      timeZone: 'America/New_York',
      originFaa: { groundStop: true },
      originWeather: { level: 'severe', reasons: ['thunderstorms'] },
    });

    expect(twoSevere.factors).not.toContain('Multiple severe disruptions compounding');
    expect(componentPoints(twoSevere, 'compound-severe')).toBeNull();
  });

  // --- getLocalHour ICU midnight quirk (hour="24") ---

  it('normalizes an ICU hour="24" midnight so it is not scored as late evening', () => {
    const spy = vi.spyOn(Date.prototype, 'toLocaleTimeString').mockReturnValue('24');
    try {
      const result = computeDelayRiskModel({
        nowMs: Date.parse('2026-03-18T05:00:00Z'),
        scheduledTime: '2026-03-19T06:00:00Z',
        originHub: 'ORD',
        destinationHub: 'DEN',
        timeZone: 'America/Chicago',
      });

      expect(result.factors).not.toContain('Late evening - high cascade risk');
      expect(componentPoints(result, 'time-of-day')).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });
});
