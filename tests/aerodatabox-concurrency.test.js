import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { fetchViaAeroDataBox } from '../api/_schedule-aerodatabox.js';
import { __resetAdbSpendForTests } from '../api/_cost-state.js';

// Prod, Sep 26 2026 01:31:59Z: a burst of board requests fired ~13 background refreshes at once
// (26 FIDS calls). RapidAPI answered "You have exceeded the rate limit per second for your plan,
// ULTRA", the retries (which bill too) 429'd again, and DEN/IAH/ORD/SFO arrivals gave up and
// stayed 5-11h stale. The instance must queue its own provider calls instead of stampeding the
// per-second limit.

describe('AeroDataBox per-instance concurrency cap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetAdbSpendForTests();
    process.env.AERODATABOX_API_KEY = 'adb-test-key';
    process.env.AERODATABOX_INTER_WINDOW_DELAY_MS = '0';
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '100000';
  });
  afterEach(() => {
    delete process.env.AERODATABOX_API_KEY;
    delete process.env.AERODATABOX_INTER_WINDOW_DELAY_MS;
    delete process.env.AERODATABOX_DAILY_UNIT_BUDGET;
    __resetAdbSpendForTests();
    vi.restoreAllMocks();
  });

  it('never has more than 2 provider requests in flight, and still completes every board', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    let calls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (!String(url).includes('aerodatabox')) {
        return { ok: false, status: 403, text: async () => '', json: async () => ({}), headers: { get: () => null } };
      }
      calls++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ departures: [], arrivals: [] }) };
    });

    const nowSec = Math.floor(Date.now() / 1000);
    const hubs = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD'];
    const results = await Promise.all(hubs.map((h) => fetchViaAeroDataBox(h, 'arrivals', nowSec, 10000)));

    expect(calls).toBe(hubs.length * 2); // 2 FIDS windows per board, none dropped
    expect(maxInFlight).toBeLessThanOrEqual(2);
    for (const r of results) expect(r).toBeTruthy();
  });
});
