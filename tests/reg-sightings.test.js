import { describe, it, expect, vi, beforeEach } from 'vitest';

const upsertMock = vi.fn(async () => ({ error: null }));
const gtMock = vi.fn(async () => ({ data: [], error: null }));
vi.mock('../api/_supabase.js', () => ({
  getSupabase: () => ({
    from: () => ({
      upsert: upsertMock,
      select: () => ({ gt: gtMock }),
    }),
  }),
}));

import {
  recordFeedSightings, peekRegSightings, kickRegSightingsRefresh,
  peekRegSightingsLoadedAt, shouldWriteSightings, __resetRegSightingsForTests,
  isRegSightingsConfigured, REG_SIGHTINGS_WRITE_MIN_INTERVAL_MS,
} from '../api/_reg-sightings.js';

const FLIGHTS = [{ flightIATA: 'UA123', callsign: 'UAL123', reg: 'N12345', origin: 'ORD', dest: 'SFO' }];

beforeEach(() => {
  __resetRegSightingsForTests();
  upsertMock.mockClear();
  gtMock.mockClear();
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
    expect(map.get('UA123')).toEqual({ reg: 'N12345', origin: 'ORD', dest: 'SFO', seenAtMs: 123456789 });
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
