import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsertMock = vi.fn(async () => ({ error: null }));
const gtMock = vi.fn(async () => ({ data: [], error: null }));
const selectMock = vi.fn(() => ({ gt: gtMock }));
vi.mock('../api/_supabase.js', () => ({
  getSupabase: () => ({
    from: () => ({
      upsert: upsertMock,
      select: selectMock,
    }),
  }),
}));

import {
  recordFeedSightings, peekRegSightings, kickRegSightingsRefresh,
  peekRegSightingsLoadedAt, shouldWriteSightings, __resetRegSightingsForTests,
  isRegSightingsConfigured, REG_SIGHTINGS_WRITE_MIN_INTERVAL_MS, awaitRegSightings,
  isMissingAirborneColumn,
} from '../api/_reg-sightings.js';

const FLIGHTS = [{ flightIATA: 'UA123', callsign: 'UAL123', reg: 'N12345', origin: 'ORD', dest: 'SFO' }];

beforeEach(() => {
  __resetRegSightingsForTests();
  upsertMock.mockReset();
  upsertMock.mockImplementation(async () => ({ error: null }));
  gtMock.mockReset();
  gtMock.mockImplementation(async () => ({ data: [], error: null }));
  selectMock.mockClear();
  // The module no-ops entirely without a Supabase URL (the unconfigured guard) — these
  // tests exercise the configured path; the guard has its own describe block below.
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co');
});

describe('unconfigured guard', () => {
  it('write and kick are hard no-ops without a Supabase URL — never enqueue doomed work', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(isRegSightingsConfigured()).toBe(false);
    expect(await recordFeedSightings(FLIGHTS, 1_000_000)).toBe(0);
    expect(upsertMock).not.toHaveBeenCalled();
    expect(kickRegSightingsRefresh()).toBeNull();
    expect(gtMock).not.toHaveBeenCalled();
    expect(peekRegSightings().size).toBe(0);
  });
});

describe('shouldWriteSightings', () => {
  it('throttles to one write per interval', () => {
    expect(shouldWriteSightings(1000, 0, 500)).toBe(true);
    expect(shouldWriteSightings(1000, 800, 500)).toBe(false);
    expect(shouldWriteSightings(1300, 800, 500)).toBe(true);
  });
});

describe('recordFeedSightings', () => {
  it('upserts extracted rows and reports the count', async () => {
    const n = await recordFeedSightings(FLIGHTS, 1_000_000);
    expect(n).toBe(1);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock.mock.calls[0][0][0].flight_key).toBe('UA123');
    expect(upsertMock.mock.calls[0][1]).toEqual({ onConflict: 'flight_key' });
  });
  it('throttles a second write inside the interval', async () => {
    await recordFeedSightings(FLIGHTS, 1_000_000);
    const n = await recordFeedSightings(FLIGHTS, 1_000_000 + REG_SIGHTINGS_WRITE_MIN_INTERVAL_MS - 1);
    expect(n).toBe(0);
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });
  it('writes nothing for reg-less feeds and never throws on Supabase errors', async () => {
    expect(await recordFeedSightings([{ flightIATA: 'UA1', reg: '' }], 1_000_000)).toBe(0);
    upsertMock.mockResolvedValueOnce({ error: { message: 'boom' } });
    expect(await recordFeedSightings(FLIGHTS, 1_000_000)).toBe(0);
  });
});

describe('peek + kick', () => {
  it('peek returns an empty map before any load; kick loads and caches', async () => {
    expect(peekRegSightings().size).toBe(0);
    expect(peekRegSightingsLoadedAt()).toBe(0);
    gtMock.mockResolvedValueOnce({
      data: [
        { flight_key: 'UA123', reg: 'N12345', origin: 'ORD', dest: 'SFO', seen_at: new Date(123456789).toISOString() },
        { flight_key: 'BAD', reg: '', origin: '', dest: '', seen_at: 'garbage' },
      ],
      error: null,
    });
    const p = kickRegSightingsRefresh();
    expect(p).not.toBeNull();
    const map = await p;
    expect(map.get('UA123')).toEqual({ reg: 'N12345', origin: 'ORD', dest: 'SFO', seenAtMs: 123456789, airborneAtMs: null });
    expect(map.has('BAD')).toBe(false);
    expect(peekRegSightings().get('UA123').reg).toBe('N12345');
    expect(kickRegSightingsRefresh()).toBeNull(); // cache fresh → no refetch
  });
  it('queries with a 36h staleness cutoff (serving day-old tails is a freshness regression)', async () => {
    const before = Date.now();
    await kickRegSightingsRefresh();
    const after = Date.now();
    expect(gtMock).toHaveBeenCalledWith('seen_at', expect.any(String));
    const cutoffMs = Date.parse(gtMock.mock.calls[0][1]);
    // The cutoff must sit ~36h before "now" — pin it against widening/removing the window.
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 36 * 3600e3 - 5000);
    expect(cutoffMs).toBeLessThanOrEqual(after - 36 * 3600e3 + 5000);
  });
  it('a failed load caches an empty map (no hammering) and never throws', async () => {
    gtMock.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    await kickRegSightingsRefresh();
    expect(peekRegSightings().size).toBe(0);
    expect(kickRegSightingsRefresh()).toBeNull();
  });
});

// v1.12.0: /api/irops and the flight-times snapshot tier score/alert on what they read, so a cold
// cache must not silently mean "nobody was seen flying".
describe('awaitRegSightings', () => {
  it('waits for a cold load and returns it', async () => {
    gtMock.mockResolvedValueOnce({
      data: [{ flight_key: 'UA1094', reg: 'N12345', origin: 'ORD', dest: 'DEN', seen_at: new Date(5e12).toISOString() }],
      error: null,
    });
    const map = await awaitRegSightings(1000);
    expect(map.get('UA1094')).toEqual({ reg: 'N12345', origin: 'ORD', dest: 'DEN', seenAtMs: 5e12, airborneAtMs: null });
    expect(gtMock).toHaveBeenCalledTimes(1);
    // Warm: no second query inside the cache TTL.
    expect((await awaitRegSightings(1000)).size).toBe(1);
    expect(gtMock).toHaveBeenCalledTimes(1);
  });

  it('gives up after the timeout with whatever the cache holds (never hangs the caller)', async () => {
    gtMock.mockImplementationOnce(() => new Promise(() => {})); // Supabase never answers
    const started = Date.now();
    const map = await awaitRegSightings(30);
    expect(map.size).toBe(0);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('is an empty map without Supabase configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect((await awaitRegSightings(10)).size).toBe(0);
    expect(gtMock).not.toHaveBeenCalled();
  });
});

// v1.12.0 follow-up: only an AIRBORNE sighting is evidence a Likely Canceled flight flew, so the
// writer records airborne_at — without ever letting a ground sighting erase it.
describe('airborne_at (sql/016)', () => {
  const AIR = { flightIATA: 'UA1094', reg: 'N12345', origin: 'ORD', dest: 'DEN', alt: 10000, spd: 200, onGround: false };
  const GROUND = { flightIATA: 'UA2000', reg: 'N54321', origin: 'ORD', dest: 'SFO', alt: 0, spd: 5, onGround: true };
  const TAXI = { flightIATA: 'UA3000', reg: 'N33333', origin: 'ORD', dest: 'LAX', alt: 0, spd: 12, onGround: false }; // <100 ft, <50 kt

  it('splits ground and airborne rows into separate upserts; ground rows never name airborne_at', async () => {
    const n = await recordFeedSightings([AIR, GROUND, TAXI], 1_000_000);
    expect(n).toBe(3);
    expect(upsertMock).toHaveBeenCalledTimes(2);
    const calls = upsertMock.mock.calls.map((c) => c[0]);
    const groundCall = calls.find((rows) => rows.some((r) => r.flight_key === 'UA2000'));
    const airCall = calls.find((rows) => rows.some((r) => r.flight_key === 'UA1094'));
    expect(groundCall).not.toBe(airCall);
    expect(groundCall.map((r) => r.flight_key).sort()).toEqual(['UA2000', 'UA3000']);
    for (const r of groundCall) expect(Object.keys(r)).not.toContain('airborne_at');
    expect(airCall).toEqual([{
      flight_key: 'UA1094', reg: 'N12345', origin: 'ORD', dest: 'DEN',
      seen_at: new Date(1_000_000).toISOString(), airborne_at: new Date(1_000_000).toISOString(),
    }]);
    for (const c of upsertMock.mock.calls) expect(c[1]).toEqual({ onConflict: 'flight_key' });
  });

  it('keeps one write slot per interval for both upserts', async () => {
    await recordFeedSightings([AIR, GROUND], 1_000_000);
    expect(await recordFeedSightings([AIR, GROUND], 1_000_000 + 1000)).toBe(0);
    expect(upsertMock).toHaveBeenCalledTimes(2);
  });

  it('a DB without the column: logs once, falls back to the old row shape, never stops writing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    upsertMock.mockImplementation(async (rows) => (rows.some((r) => 'airborne_at' in r)
      ? { error: { code: 'PGRST204', message: "Could not find the 'airborne_at' column of 'reg_sightings' in the schema cache" } }
      : { error: null }));
    expect(await recordFeedSightings([AIR, GROUND], 1_000_000)).toBe(2);
    const legacy = upsertMock.mock.calls.map((c) => c[0]).find((rows) => rows.some((r) => r.flight_key === 'UA1094' && !('airborne_at' in r)));
    expect(legacy).toEqual([{ flight_key: 'UA1094', reg: 'N12345', origin: 'ORD', dest: 'DEN', seen_at: new Date(1_000_000).toISOString() }]);
    // Next write goes straight to the old shape, and the warning is not repeated.
    upsertMock.mockClear();
    expect(await recordFeedSightings([AIR], 1_000_000 + REG_SIGHTINGS_WRITE_MIN_INTERVAL_MS)).toBe(1);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(Object.keys(upsertMock.mock.calls[0][0][0])).not.toContain('airborne_at');
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('airborne_at column unavailable'))).toHaveLength(1);
    warn.mockRestore();
  });

  it('other upsert errors do not trigger the fallback', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    upsertMock.mockImplementation(async () => ({ error: { code: '23505', message: 'boom' } }));
    expect(await recordFeedSightings([AIR], 1_000_000)).toBe(0);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('recognises the missing-column errors', () => {
    expect(isMissingAirborneColumn({ code: 'PGRST204', message: 'x' })).toBe(true);
    expect(isMissingAirborneColumn({ code: '42703', message: 'column reg_sightings.airborne_at does not exist' })).toBe(true);
    expect(isMissingAirborneColumn({ message: 'column "airborne_at" does not exist' })).toBe(true);
    expect(isMissingAirborneColumn({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(isMissingAirborneColumn(null)).toBe(false);
  });

  it('the loader selects airborne_at and maps it to airborneAtMs (null when the flight was only seen on the ground)', async () => {
    gtMock.mockResolvedValueOnce({
      data: [
        { flight_key: 'UA1094', reg: 'N1', origin: 'ORD', dest: 'DEN', seen_at: new Date(5e12).toISOString(), airborne_at: new Date(4e12).toISOString() },
        { flight_key: 'UA2000', reg: 'N2', origin: 'ORD', dest: 'SFO', seen_at: new Date(5e12).toISOString(), airborne_at: null },
      ],
      error: null,
    });
    const map = await kickRegSightingsRefresh();
    expect(selectMock).toHaveBeenCalledWith('flight_key, reg, origin, dest, seen_at, airborne_at');
    expect(map.get('UA1094').airborneAtMs).toBe(4e12);
    expect(map.get('UA1094').seenAtMs).toBe(5e12);
    expect(map.get('UA2000').airborneAtMs).toBeNull();
  });

  it('the loader survives a DB without the column: retries the old select, every airborneAtMs null', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    gtMock
      .mockResolvedValueOnce({ data: null, error: { code: '42703', message: 'column reg_sightings.airborne_at does not exist' } })
      .mockResolvedValueOnce({ data: [{ flight_key: 'UA1094', reg: 'N1', origin: 'ORD', dest: 'DEN', seen_at: new Date(5e12).toISOString() }], error: null });
    const map = await kickRegSightingsRefresh();
    expect(selectMock.mock.calls.map((c) => c[0])).toEqual([
      'flight_key, reg, origin, dest, seen_at, airborne_at',
      'flight_key, reg, origin, dest, seen_at',
    ]);
    expect(map.get('UA1094')).toEqual({ reg: 'N1', origin: 'ORD', dest: 'DEN', seenAtMs: 5e12, airborneAtMs: null });
    warn.mockRestore();
  });
});
