import { describe, it, expect } from 'vitest';
import { matchesScheduleFilters } from '../src/lib/schedule-board-filters.js';

// Minimal ctx; individual tests only exercise the branches their filterValues activate.
function makeCtx(overrides = {}) {
  return {
    dir: 'departures',
    hubTz: 'UTC',
    intlAirports: new Set(['LHR', 'NRT', 'FRA']),
    starlinkTails: new Set(['N127SY']),
    classify: () => ({ key: 'scheduled' }),
    fleetFamily: () => '',
    regFor: () => '',
    computeRisk: () => ({ label: 'LOW' }),
    ...overrides,
  };
}

const NONE = {
  statusFilter: '', aircraftFilter: '', fleetFamilyFilter: '', routeTypeFilter: '',
  starlinkFilter: '', timeRangeFilter: '', riskFilter: '', searchFilter: '',
};

// A departure scheduled at the given whole UTC hour (1970-01-01).
function depAt(hourUTC) {
  return { time: { scheduled: { departure: hourUTC * 3600 } } };
}

describe('matchesScheduleFilters', () => {
  it('includes everything when no filters are set', () => {
    expect(matchesScheduleFilters({}, NONE, makeCtx())).toBe(true);
  });

  describe('time-range buckets (UTC hub)', () => {
    it('morning is [5,12)', () => {
      const ctx = makeCtx();
      const fv = { ...NONE, timeRangeFilter: 'morning' };
      expect(matchesScheduleFilters(depAt(5), fv, ctx)).toBe(true);
      expect(matchesScheduleFilters(depAt(11), fv, ctx)).toBe(true);
      expect(matchesScheduleFilters(depAt(12), fv, ctx)).toBe(false);
      expect(matchesScheduleFilters(depAt(4), fv, ctx)).toBe(false);
    });

    it('redeye wraps 22..05', () => {
      const ctx = makeCtx();
      const fv = { ...NONE, timeRangeFilter: 'redeye' };
      expect(matchesScheduleFilters(depAt(22), fv, ctx)).toBe(true);
      expect(matchesScheduleFilters(depAt(4), fv, ctx)).toBe(true);
      expect(matchesScheduleFilters(depAt(5), fv, ctx)).toBe(false);
      expect(matchesScheduleFilters(depAt(21), fv, ctx)).toBe(false);
    });
  });

  describe('F004 delay-risk band gating', () => {
    it('the "high" filter accepts BOTH HIGH and V.HIGH', () => {
      const fv = { ...NONE, riskFilter: 'high' };
      expect(matchesScheduleFilters({}, fv, makeCtx({ computeRisk: () => ({ label: 'HIGH' }) }))).toBe(true);
      expect(matchesScheduleFilters({}, fv, makeCtx({ computeRisk: () => ({ label: 'V.HIGH' }) }))).toBe(true);
      expect(matchesScheduleFilters({}, fv, makeCtx({ computeRisk: () => ({ label: 'MOD' }) }))).toBe(false);
      expect(matchesScheduleFilters({}, fv, makeCtx({ computeRisk: () => ({ label: 'LOW' }) }))).toBe(false);
    });

    it('excludes non-active statuses from the high/moderate risk filters', () => {
      const fv = { ...NONE, riskFilter: 'high' };
      const ctx = makeCtx({ classify: () => ({ key: 'departed' }), computeRisk: () => ({ label: 'V.HIGH' }) });
      expect(matchesScheduleFilters({}, fv, ctx)).toBe(false);
    });
  });

  describe('route-type classification', () => {
    it('domestic filter drops international endpoints', () => {
      const fv = { ...NONE, routeTypeFilter: 'domestic' };
      const ctx = makeCtx();
      const intl = { airport: { destination: { code: { iata: 'NRT' } } } };
      const dom = { airport: { destination: { code: { iata: 'DEN' } } } };
      expect(matchesScheduleFilters(intl, fv, ctx)).toBe(false);
      expect(matchesScheduleFilters(dom, fv, ctx)).toBe(true);
    });

    it('international filter keeps only international endpoints', () => {
      const fv = { ...NONE, routeTypeFilter: 'international' };
      const ctx = makeCtx();
      const intl = { airport: { destination: { code: { iata: 'LHR' } } } };
      const dom = { airport: { destination: { code: { iata: 'DEN' } } } };
      expect(matchesScheduleFilters(intl, fv, ctx)).toBe(true);
      expect(matchesScheduleFilters(dom, fv, ctx)).toBe(false);
    });
  });

  it('status filter groups canceled_uncertain under canceled', () => {
    const fv = { ...NONE, statusFilter: 'canceled' };
    const ctx = makeCtx({ classify: () => ({ key: 'canceled_uncertain' }) });
    expect(matchesScheduleFilters({}, fv, ctx)).toBe(true);
  });
});
