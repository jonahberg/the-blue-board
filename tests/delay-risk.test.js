import { describe, expect, it } from 'vitest';
import { computeDelayRiskModel } from '../src/lib/delay-risk.js';

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
});
