// @vitest-environment jsdom
// useBoardModel end-to-end on real board row shapes (api/schedule AeroDataBox rows).
import { afterEach, describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import { EMPTY_FILTERS, useBoardModel } from '@/app/views/schedule/useBoardModel';
import type { BoardModelInput } from '@/app/views/schedule/useBoardModel';
import type { Flight } from '@/app/data/types';
import { getStartOfHubDay } from '@/lib/hubTz.js';

const DAY = getStartOfHubDay('SFO', 0, new Date('2026-09-26T19:00:00Z'));
const NOW = DAY + 20 * 3600;

function row(ident: string, model: string, registration = '', regSource?: string) {
  return {
    identification: { number: { default: ident } },
    airport: { origin: { code: { iata: 'SFO' } }, destination: { code: { iata: 'ORD' } } },
    aircraft: { model: { code: model, text: '' }, registration, ...(regSource ? { regSource } : {}) },
    time: { scheduled: { departure: DAY + 14 * 3600, arrival: DAY + 18 * 3600 }, real: {}, estimated: {} },
    status: { generic: { status: { text: 'scheduled' } } },
  };
}

function input(rows: Record<string, unknown>[], lookupReg: BoardModelInput['lookupReg']): BoardModelInput {
  return {
    rows,
    hub: 'SFO',
    dir: 'departures',
    day: 0,
    dayStartSec: DAY,
    nowSec: NOW,
    meta: null,
    filters: EMPTY_FILTERS,
    sort: { column: 'time', asc: true },
    swaps: [],
    liveFlights: [],
    liveFeedTs: null,
    lookupReg,
    fleetDb: [],
    fleetByReg: {
      N76265: { r: 'N76265', t: '737-800', c: '16F/54E+/96Y', d: '2001' },
      N14502: { r: 'N14502', t: 'A321neo', c: '20F/57E+/119Y' },
    } as unknown as BoardModelInput['fleetByReg'],
    starlinkTails: new Set(),
    special: new Map(),
    faaIndex: {},
    weatherOpsByHub: {},
    nas: null,
    hubOtp: {},
    iropsHubRates: {},
  };
}

describe('useBoardModel — backfilled tails must fit the scheduled type (F15)', () => {
  it('drops a ledger tail from another aircraft family (UA2278 A21N ← 737-800 N76265)', () => {
    const { result } = renderHook(() => useBoardModel(input([row('UA2278', 'A21N')], () => 'N76265')));
    const r = result.current.rows[0];
    expect(r.reg).toBe('');
    expect(r.fleet).toBeNull();
  });

  it('drops a server-merged live-feed tail from another family, but keeps a provider tail', () => {
    const { result } = renderHook(() =>
      useBoardModel(
        input(
          [row('UA2278', 'A21N', 'N76265', 'live_feed'), row('UA1', 'A21N', 'N76265')],
          () => null,
        ),
      ),
    );
    const byIdent = Object.fromEntries(result.current.rows.map((r) => [r.ident, r]));
    expect(byIdent.UA2278.reg).toBe('');
    expect(byIdent.UA1.reg).toBe('N76265'); // provider-sent: a real swap is the swap detector's job
  });

  it('keeps a matching ledger tail', () => {
    const { result } = renderHook(() => useBoardModel(input([row('UA2278', 'A21N')], () => 'N14502')));
    expect(result.current.rows[0].reg).toBe('N14502');
    expect(result.current.rows[0].regFromLive).toBe(true);
  });
});

describe('useBoardModel — the board-truth fields reach the row (v1.13.0)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // ORD arrivals, SFO→ORD. The provider still says "Expected" with an on-time arrival estimate
  // while the aircraft is over Denver — about 1h50m from the gate at cruise speed.
  const NOW_MS = Date.parse('2026-10-04T01:00:00Z');
  const NOW_S = NOW_MS / 1000;
  const ORD_DAY = getStartOfHubDay('ORD', 0, new Date(NOW_MS));

  function arrivalRow() {
    return {
      identification: { number: { default: 'UA1234' } },
      airport: { origin: { code: { iata: 'SFO' } }, destination: { code: { iata: 'ORD' } } },
      aircraft: { model: { code: 'B39M', text: '' }, registration: 'N37502' },
      time: {
        scheduled: { departure: NOW_S - 210 * 60, arrival: NOW_S + 35 * 60 },
        real: {},
        estimated: { arrival: NOW_S + 35 * 60 },
      },
      status: { generic: { status: { text: 'scheduled' } }, text: 'Expected' },
    };
  }

  function feedRow(withPosition: boolean): Flight {
    return {
      fr24id: 'x',
      icao24: 'a1b2c3',
      ...(withPosition ? { lat: 39.86, lon: -104.67, spd: 230 } : { lat: NaN, lon: NaN, spd: 230 }),
      hdg: 80,
      alt: 11000,
      vr: 0,
      squawk: null,
      acType: 'B39M',
      reg: 'N37502',
      origin: 'SFO',
      dest: 'ORD',
      flightIATA: 'UA1234',
      onGround: false,
      callsign: 'UAL1234',
      airline: 'UAL',
    } as Flight;
  }

  function arrivalsInput(liveFlights: Flight[]): BoardModelInput {
    return {
      ...input([arrivalRow()], () => null),
      hub: 'ORD',
      dir: 'arrivals',
      dayStartSec: ORD_DAY,
      nowSec: NOW_S,
      liveFlights,
      liveFeedTs: NOW_MS,
    };
  }

  it('an arrival airborne now measures its delay to the live-position ETA (sightingsFromLiveFeed)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
    const { result } = renderHook(() => useBoardModel(arrivalsInput([feedRow(true)])));
    const r = result.current.rows[0];
    expect(r.status.live).toBe(true);
    expect(r.status.text).toBe('En Route');
    expect(r.delay.kind).toBe('delta');
    if (r.delay.kind !== 'delta') return;
    expect(r.delay.basis).toBe('live');
    expect(r.delay.title).toBe('ETA from live position vs scheduled arrival');
    // ~770 nm at ~447 kt plus the 10-min allowance, against a gate time 35 min out.
    expect(r.delay.minutes).toBeGreaterThan(60);
    expect(r.delay.minutes).toBeLessThan(100);
  });

  it('without a position the same row falls back to the provider estimate (what the inline map did)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW_MS);
    const { result } = renderHook(() => useBoardModel(arrivalsInput([feedRow(false)])));
    const r = result.current.rows[0];
    expect(r.status.live).toBe(true);
    expect(r.delay.kind === 'delta' ? r.delay.basis : null).not.toBe('live');
  });

  it('identDisplay strips a provider suffix; ident stays raw', () => {
    const { result } = renderHook(() => useBoardModel(input([row('UA526H', 'E75L')], () => null)));
    expect(result.current.rows[0].ident).toBe('UA526H');
    expect(result.current.rows[0].identDisplay).toBe('UA526');
  });

  it('a tail only the Starlink roster knows reads Starlink, sourced from the roster', () => {
    const base = input([row('UA5063', 'E75L', 'N140SY')], () => null);
    const { result } = renderHook(() => useBoardModel({ ...base, starlinkTails: new Set(['N140SY']) }));
    expect(result.current.rows[0].fleet).toEqual({
      badge: 'Starlink',
      starlink: true,
      enrich: '⚡ Starlink',
      source: 'starlink-roster',
    });
    expect(result.current.rows[0].actualFromRunway).toBe(false);
  });

  it('a United Express tail reads from the Express fleet when one is passed', () => {
    const base = input([row('UA5575', 'E75L', 'N85377'), row('UA2106', 'A21N', 'N14502')], () => null);
    const expressByReg = {
      N85377: { r: 'N85377', t: 'E175', tk: 'E175', o: 'SkyWest Airlines', oc: 'SKW', w: '', c: '', fs: '', ls: '', lf: '', x: true },
    } as NonNullable<BoardModelInput['expressByReg']>;
    const { result } = renderHook(() => useBoardModel({ ...base, expressByReg }));
    const byIdent = Object.fromEntries(result.current.rows.map((r) => [r.ident, r]));
    expect(byIdent.UA5575.fleet).toEqual({
      badge: 'E175',
      starlink: false,
      enrich: 'E175 · SkyWest Airlines',
      source: 'express',
    });
    // The mainline row is untouched by the Express index.
    expect(byIdent.UA2106.fleet?.source).toBe('fleet');
    expect(byIdent.UA2106.fleet?.badge).toBe('20F/57E+/119Y');
  });
});
