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

// F127: the branches the original pins never reached — all live options in AdvancedFilters.tsx.
describe('matchesScheduleFilters — the remaining filter branches', () => {
  const ac = (code, text = '') => ({ aircraft: { model: { code, text } } });

  it('aircraft filter matches the exact model code', () => {
    const fv = { ...NONE, aircraftFilter: '789' };
    expect(matchesScheduleFilters(ac('789'), fv, makeCtx())).toBe(true);
    expect(matchesScheduleFilters(ac('738'), fv, makeCtx())).toBe(false);
  });

  it('fleet family filter asks ctx.fleetFamily with the code and text', () => {
    const fv = { ...NONE, fleetFamilyFilter: '787' };
    const seen = [];
    const ctx787 = makeCtx({ fleetFamily: (code, text) => { seen.push([code, text]); return '787'; } });
    expect(matchesScheduleFilters(ac('B789', 'Boeing 787-9'), fv, ctx787)).toBe(true);
    expect(seen).toEqual([['B789', 'Boeing 787-9']]);
    expect(matchesScheduleFilters(ac('B738'), fv, makeCtx({ fleetFamily: () => '737' }))).toBe(false);
  });

  it('starlink filter follows the (possibly backfilled) tail', () => {
    const sl = makeCtx({ regFor: () => 'N127SY' });
    const plain = makeCtx({ regFor: () => 'N12345' });
    const noTail = makeCtx({ regFor: () => '' });
    const on = { ...NONE, starlinkFilter: 'starlink' };
    const off = { ...NONE, starlinkFilter: 'no-starlink' };
    expect(matchesScheduleFilters({}, on, sl)).toBe(true);
    expect(matchesScheduleFilters({}, off, sl)).toBe(false);
    expect(matchesScheduleFilters({}, on, plain)).toBe(false);
    expect(matchesScheduleFilters({}, off, plain)).toBe(true);
    expect(matchesScheduleFilters({}, on, noTail)).toBe(false);
    expect(matchesScheduleFilters({}, off, noTail)).toBe(true);
  });

  it('afternoon is [12,17) and evening is [17,22)', () => {
    const ctx = makeCtx();
    const pm = { ...NONE, timeRangeFilter: 'afternoon' };
    const eve = { ...NONE, timeRangeFilter: 'evening' };
    expect(matchesScheduleFilters(depAt(12), pm, ctx)).toBe(true);
    expect(matchesScheduleFilters(depAt(16), pm, ctx)).toBe(true);
    expect(matchesScheduleFilters(depAt(17), pm, ctx)).toBe(false);
    expect(matchesScheduleFilters(depAt(17), eve, ctx)).toBe(true);
    expect(matchesScheduleFilters(depAt(21), eve, ctx)).toBe(true);
    expect(matchesScheduleFilters(depAt(22), eve, ctx)).toBe(false);
  });

  it('arrivals boards bucket on the scheduled ARRIVAL and classify route type by origin', () => {
    const ctx = makeCtx({ dir: 'arrivals' });
    const fl = { time: { scheduled: { departure: 3 * 3600, arrival: 13 * 3600 } }, airport: { origin: { code: { iata: 'LHR' } }, destination: { code: { iata: 'ORD' } } } };
    expect(matchesScheduleFilters(fl, { ...NONE, timeRangeFilter: 'afternoon' }, ctx)).toBe(true);
    expect(matchesScheduleFilters(fl, { ...NONE, timeRangeFilter: 'redeye' }, ctx)).toBe(false);
    expect(matchesScheduleFilters(fl, { ...NONE, routeTypeFilter: 'international' }, ctx)).toBe(true);
  });

  it("risk 'moderate' and 'low' bands", () => {
    const risk = (label) => makeCtx({ computeRisk: () => (label ? { label } : null) });
    const mod = { ...NONE, riskFilter: 'moderate' };
    const low = { ...NONE, riskFilter: 'low' };
    expect(matchesScheduleFilters({}, mod, risk('MOD'))).toBe(true);
    expect(matchesScheduleFilters({}, mod, risk('LOW'))).toBe(false);
    expect(matchesScheduleFilters({}, low, risk('LOW'))).toBe(true);
    expect(matchesScheduleFilters({}, low, risk(null))).toBe(true); // no model → LOW
    expect(matchesScheduleFilters({}, low, risk('HIGH'))).toBe(false);
    const departed = makeCtx({ classify: () => ({ key: 'departed' }) });
    expect(matchesScheduleFilters({}, mod, departed)).toBe(false);
    const landed = makeCtx({ classify: () => ({ key: 'landed' }) });
    expect(matchesScheduleFilters({}, low, landed)).toBe(true); // operated rows fall through 'low'
  });

  it('search matches every haystack field (caller lowercases the query)', () => {
    const fl = {
      identification: { number: { default: 'UA912' }, callsign: 'UAL912' },
      airport: {
        origin: { code: { iata: 'ORD' }, name: "Chicago O'Hare" },
        destination: { code: { iata: 'KEF' }, name: 'Keflavik' },
      },
      aircraft: { model: { code: 'B752' } },
    };
    const ctx = makeCtx({ regFor: () => 'N17105' });
    for (const q of ['ua912', 'ual912', 'n17105', 'keflavik', 'kef', 'ord', 'b752']) {
      expect(matchesScheduleFilters(fl, { ...NONE, searchFilter: q }, ctx), q).toBe(true);
    }
    expect(matchesScheduleFilters(fl, { ...NONE, searchFilter: 'lhr' }, ctx)).toBe(false);
  });
});

