// Data-quality release (Jul 3 2026 audit) — cached FAA hub-disruption lookup used by
// api/schedule.ts (meta.hubDisruptionMinutes, #3) and api/cron/warm-schedules.ts (IROPS warm
// priority, #7).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  computeHubDisruptionMinutes,
  getHubDisruptionMinutes,
  getDisruptedAirportsMap,
  peekHubDisruptionMinutes,
  kickDisruptionRefresh,
  __resetFaaDisruptionCacheForTests,
} from '../api/faa.js';

function faaAirport(overrides = {}) {
  return {
    airportCode: 'ORD',
    programs: [],
    groundStop: false,
    groundDelay: false,
    departureDelay: false,
    arrivalDelay: false,
    closure: false,
    avgDelay: null,
    minDelay: null,
    maxDelay: null,
    delays: [],
    ...overrides,
  };
}

describe('computeHubDisruptionMinutes (pure)', () => {
  it('returns 0 for missing/undisrupted airports', () => {
    expect(computeHubDisruptionMinutes(null)).toBe(0);
    expect(computeHubDisruptionMinutes(undefined)).toBe(0);
    expect(computeHubDisruptionMinutes(faaAirport())).toBe(0);
  });

  it('uses the worst published delay figure for a GDP (the 293-min ORD case)', () => {
    expect(computeHubDisruptionMinutes(faaAirport({ groundDelay: true, avgDelay: 293, maxDelay: 353 }))).toBe(293);
  });

  it('falls back to minDelay when no average is published', () => {
    expect(computeHubDisruptionMinutes(faaAirport({ groundDelay: true, minDelay: 45, maxDelay: 90 }))).toBe(45);
  });

  it('floors a ground stop / closure with no published figure at 60 minutes', () => {
    expect(computeHubDisruptionMinutes(faaAirport({ groundStop: true }))).toBe(60);
    expect(computeHubDisruptionMinutes(faaAirport({ closure: true }))).toBe(60);
  });

  it('gives a numberless GDP a nominal 15 minutes', () => {
    expect(computeHubDisruptionMinutes(faaAirport({ groundDelay: true }))).toBe(15);
  });

  it('does NOT treat routine departure/arrival delay advisories as an active disruption', () => {
    // The documented contract is GDP/GS/closure only: a plain "departure delays 31-45 min"
    // advisory must not trigger IROPS warm priority or the extended inference grace.
    expect(computeHubDisruptionMinutes(faaAirport({ departureDelay: true, minDelay: 31, maxDelay: 45 }))).toBe(0);
    expect(computeHubDisruptionMinutes(faaAirport({ arrivalDelay: true, minDelay: 16, maxDelay: 30 }))).toBe(0);
    expect(computeHubDisruptionMinutes(faaAirport({ departureDelay: true, arrivalDelay: true }))).toBe(0);
  });
});

describe('getHubDisruptionMinutes / getDisruptedAirportsMap (cached fetch)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetFaaDisruptionCacheForTests();
  });

  afterEach(() => {
    __resetFaaDisruptionCacheForTests();
  });

  function mockFaaEvents(payload) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('nasstatus.faa.gov/api/airport-events')) {
        return { ok: true, status: 200, json: async () => payload };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  it('parses live airport-events into per-hub disruption minutes', async () => {
    mockFaaEvents([
      {
        airportId: 'ORD',
        groundDelay: { impactingCondition: 'thunderstorms', avgDelay: '4 hours and 53 minutes', maxDelay: 353 },
      },
      { airportId: 'SFO', groundStop: { impactingCondition: 'low ceilings' } },
      { airportId: 'DEN' }, // no programs
    ]);
    expect(await getHubDisruptionMinutes('ORD')).toBe(293);
    expect(await getHubDisruptionMinutes('SFO')).toBe(60);
    expect(await getHubDisruptionMinutes('DEN')).toBe(0);
    expect(await getHubDisruptionMinutes('ewr')).toBe(0); // case-insensitive, absent hub
  });

  it('caches the map — repeated lookups do not refetch', async () => {
    const fetchSpy = mockFaaEvents([{ airportId: 'ORD', groundDelay: { avgDelay: 100 } }]);
    await getHubDisruptionMinutes('ORD');
    await getHubDisruptionMinutes('DEN');
    await getDisruptedAirportsMap();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('degrades to 0 (all hubs undisrupted) when the FAA endpoint fails, and negative-caches', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
    expect(await getHubDisruptionMinutes('ORD')).toBe(0);
    expect(await getHubDisruptionMinutes('ORD')).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // negative cache: no hammering
  });

  it('degrades to 0 on schema-invalid payloads (non-array)', async () => {
    mockFaaEvents({ ok: true });
    expect(await getHubDisruptionMinutes('ORD')).toBe(0);
  });
});

describe('peekHubDisruptionMinutes / kickDisruptionRefresh (non-blocking serve path)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetFaaDisruptionCacheForTests();
  });

  afterEach(() => {
    __resetFaaDisruptionCacheForTests();
  });

  it('peek on a cold cache returns 0 and NEVER fetches', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('peek must not fetch');
    });
    expect(peekHubDisruptionMinutes('ORD')).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('kick warms the cache in the background; later peeks read the cached value synchronously', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('nasstatus.faa.gov/api/airport-events')) {
        return { ok: true, status: 200, json: async () => ([{ airportId: 'ORD', groundDelay: { avgDelay: 293 } }]) };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const refresh = kickDisruptionRefresh();
    expect(refresh).toBeTruthy(); // cold cache → refresh started
    await refresh;
    expect(peekHubDisruptionMinutes('ORD')).toBe(293);
    expect(peekHubDisruptionMinutes('ord')).toBe(293); // case-insensitive
    expect(peekHubDisruptionMinutes('DEN')).toBe(0);
    expect(kickDisruptionRefresh()).toBeNull(); // fresh cache → nothing to do
  });

  it('kick joins the in-flight refresh instead of double-fetching', async () => {
    let resolveFetch;
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => new Promise((resolve) => { resolveFetch = resolve; })
    );
    const a = kickDisruptionRefresh();
    const b = kickDisruptionRefresh();
    expect(b).toBe(a);
    resolveFetch({ ok: true, status: 200, json: async () => [] });
    await a;
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
