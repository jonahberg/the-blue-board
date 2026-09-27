/**
 * Delay-risk scenarios, asserted against the REAL engine (src/lib/delay-risk.js).
 *
 * These replace tests/irops.test.js's "computeDelayRisk v3 algorithm" block, which exercised
 * a scorer hand-copied into the test file from the long-gone index.html and had drifted from
 * production (GDP 20 vs 16, EWR base 8 vs 6, …) — it could not fail because of a change to
 * the engine. Only the scenarios tests/delay-risk.test.js did not already cover are ported,
 * each with the engine's current point values.
 */

import { describe, expect, it } from 'vitest';

import { HUB_RISK_PROFILES, RISK_BANDS, computeDelayRiskModel } from '../src/lib/delay-risk.js';

function points(result, id) {
  const component = result.components.find((c) => c.id === id);
  return component ? component.points : null;
}

/** A 10:00 local ORD→LAX departure, two hours out, with nothing going on. */
function base(over = {}) {
  return {
    nowMs: Date.parse('2026-03-18T14:00:00Z'),
    scheduledTime: '2026-03-18T16:00:00Z',
    originHub: 'ORD',
    destinationHub: 'LAX',
    timeZone: 'America/Chicago',
    ...over,
  };
}

const QUIET_WX = {
  level: 'normal', reasons: [], fltCat: 'VFR', hasThunderstorms: false,
  hasFreezingPrecip: false, hasSnow: false, hasFog: false, gustKt: 0, tempC: 15,
};

describe('delay-risk scenarios (real engine)', () => {
  it('is LOW for clean conditions: no delay, VFR, good on-time, morning', () => {
    const r = computeDelayRiskModel(base({ originHub: 'GUM', timeZone: 'Pacific/Guam', originOtp: 92, originWeather: QUIET_WX }));
    expect(r.label).toBe('LOW');
    expect(r.score).toBe(HUB_RISK_PROFILES.GUM.base);
  });

  it('a 30-minute delay alone is at least MOD, never LOW', () => {
    const r = computeDelayRiskModel(base({ comparisonTime: '2026-03-18T16:30:00Z' }));
    expect(points(r, 'actual-delay')).toBe(30);
    expect(r.label).not.toBe('LOW');
  });

  it('scores an origin ground stop at 30 and an origin GDP at 16, +4 past 45 min, +8 past 90', () => {
    expect(points(computeDelayRiskModel(base({ originFaa: { groundStop: true } })), 'origin-faa-gs')).toBe(30);
    expect(points(computeDelayRiskModel(base({ originFaa: { groundDelay: true } })), 'origin-faa-gdp')).toBe(16);
    expect(points(computeDelayRiskModel(base({ originFaa: { groundDelay: true, avgDelay: 50 } })), 'origin-faa-gdp')).toBe(20);
    expect(points(computeDelayRiskModel(base({ originFaa: { groundDelay: true, maxDelay: 95 } })), 'origin-faa-gdp')).toBe(24);
  });

  it('gives EWR a higher baseline than GUM', () => {
    const ewr = computeDelayRiskModel(base({ originHub: 'EWR', timeZone: 'America/New_York' }));
    const gum = computeDelayRiskModel(base({ originHub: 'GUM', timeZone: 'Pacific/Guam' }));
    expect(points(ewr, 'hub-profile')).toBe(6);
    expect(points(gum, 'hub-profile')).toBe(1);
  });

  it('adds thunderstorms, freezing precipitation and snow on top of the level', () => {
    const r = computeDelayRiskModel(base({
      originWeather: { ...QUIET_WX, level: 'severe', hasThunderstorms: true, hasFreezingPrecip: true, hasSnow: true },
    }));
    expect(points(r, 'origin-weather-level')).toBe(8);
    expect(points(r, 'origin-weather-ts')).toBe(8);
    expect(points(r, 'origin-weather-fz')).toBe(6);
    expect(points(r, 'origin-weather-snow')).toBe(4);
  });

  it('scores thunderstorms above a generic caution', () => {
    const ts = computeDelayRiskModel(base({ originWeather: { ...QUIET_WX, level: 'warning', hasThunderstorms: true } }));
    const caution = computeDelayRiskModel(base({ originWeather: { ...QUIET_WX, level: 'caution' } }));
    expect(ts.score).toBeGreaterThan(caution.score);
  });

  it('adds a de-icing penalty at or below 2C, larger at or below -5C', () => {
    const cold = computeDelayRiskModel(base({ originWeather: { ...QUIET_WX, hasSnow: true, tempC: 0 } }));
    const colder = computeDelayRiskModel(base({ originWeather: { ...QUIET_WX, hasFreezingPrecip: true, tempC: -8 } }));
    const mild = computeDelayRiskModel(base({ originWeather: { ...QUIET_WX, hasSnow: true, tempC: 5 } }));
    expect(points(cold, 'origin-weather-deice')).toBe(6);
    expect(points(colder, 'origin-weather-deice')).toBe(10);
    expect(points(mild, 'origin-weather-deice')).toBeNull();
  });

  it('weights EWR origin IFR at 7 and a generic hub at 5', () => {
    const ewr = computeDelayRiskModel(base({ originHub: 'EWR', timeZone: 'America/New_York', originWeather: { ...QUIET_WX, fltCat: 'IFR' } }));
    const ord = computeDelayRiskModel(base({ originWeather: { ...QUIET_WX, fltCat: 'IFR' } }));
    expect(points(ewr, 'origin-weather-ifr')).toBe(7);
    expect(points(ord, 'origin-weather-ifr')).toBe(5);
  });

  it('scores origin IROPS cancellations 12 / 7 / 3 and a high 60-min delay rate 4', () => {
    const at = (cancellationRate, delayed60Rate = 0) =>
      computeDelayRiskModel(base({ originIrops: { cancellationRate, delayed60Rate } }));
    expect(points(at(15), 'origin-irops-cancel')).toBe(12);
    expect(points(at(8), 'origin-irops-cancel')).toBe(7);
    expect(points(at(3), 'origin-irops-cancel')).toBe(3);
    expect(points(at(2), 'origin-irops-cancel')).toBeNull();
    expect(points(at(0, 20), 'origin-irops-delay')).toBe(4);
  });

  it('scores destination IROPS at the arrival weights (7 cancellations, 2 delays)', () => {
    const r = computeDelayRiskModel(base({ destinationIrops: { cancellationRate: 15, delayed60Rate: 20 } }));
    expect(points(r, 'destination-irops-cancel')).toBe(7);
    expect(points(r, 'destination-irops-delay')).toBe(2);
  });

  it('scores destination thunderstorms at 5', () => {
    const r = computeDelayRiskModel(base({ destinationWeather: { ...QUIET_WX, hasThunderstorms: true } }));
    expect(points(r, 'destination-weather-ts')).toBe(5);
  });

  it('bands on-time performance 12 / 8 / 4 / 2', () => {
    const otp = (v) => points(computeDelayRiskModel(base({ originOtp: v })), 'origin-otp');
    expect(otp(35)).toBe(12);
    expect(otp(50)).toBe(8);
    expect(otp(65)).toBe(4);
    expect(otp(75)).toBe(2);
    expect(otp(85)).toBeNull();
  });

  it('adds more cascade risk later in the hub-local day', () => {
    const at = (utc) => points(computeDelayRiskModel(base({ scheduledTime: utc })), 'time-of-day');
    expect(at('2026-03-18T15:00:00Z')).toBeNull(); // 10:00 CDT
    expect(at('2026-03-18T19:00:00Z')).toBe(2); // 14:00
    expect(at('2026-03-18T22:00:00Z')).toBe(5); // 17:00
    expect(at('2026-03-19T01:00:00Z')).toBe(8); // 20:00
  });

  it('labels scores with the RISK_BANDS thresholds', () => {
    expect(RISK_BANDS.map((b) => [b.min, b.label])).toEqual([[75, 'V.HIGH'], [50, 'HIGH'], [25, 'MOD'], [0, 'LOW']]);
    const r = computeDelayRiskModel(base({
      comparisonTime: '2026-03-18T18:30:00Z', // 150 min late → 50
      originFaa: { groundStop: true }, // 30
    }));
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.label).toBe('V.HIGH');
  });
});
