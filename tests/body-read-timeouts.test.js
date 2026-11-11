// A response whose headers arrive and whose body then stalls must end at the request's own
// timeout. Two fetches cleared their abort timer as soon as fetch() resolved and then read the
// body with no bound: the FAA disruption lookup in api/faa.ts (run inside waitUntil on
// /api/schedule — the likely cause of the Nov 7 2026 function timeout) and the AeroDataBox window
// fetch in api/_schedule-aerodatabox.ts. The fake network here behaves like undici: the body
// stream never produces a byte and errors only when the request's AbortSignal fires. On the code
// before the fix neither call ever settles, so the "settled" assertions fail.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { __resetFaaDisruptionCacheForTests, getDisruptedAirportsMap } from '../api/faa.js';
import { fetchViaAeroDataBox } from '../api/_schedule-aerodatabox.js';
import { __resetAdbSpendForTests, getAdbUnitsToday } from '../api/_cost-state.js';

const abortError = () => Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });

/** Headers now, a body never — until the request is aborted, which errors the stream. */
function stalledBody(signal) {
  const body = new ReadableStream({
    start(controller) {
      if (signal?.aborted) controller.error(abortError());
      signal?.addEventListener('abort', () => controller.error(abortError()), { once: true });
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** Resolves to whether `promise` settled within `ms` of fake time. */
async function settlesWithin(promise, ms) {
  let settled = false;
  promise.then(() => { settled = true; }, () => { settled = true; });
  await vi.advanceTimersByTimeAsync(ms);
  return settled;
}

describe('FAA disruption lookup (api/faa.ts fetchDisruptionMap)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    __resetFaaDisruptionCacheForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    __resetFaaDisruptionCacheForTests();
  });

  it('a stalled body read ends at the 5-second timeout as "no disruption", negative-cached', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => stalledBody(init?.signal));
    const lookup = getDisruptedAirportsMap();
    expect(await settlesWithin(lookup, 4_900)).toBe(false);
    expect(await settlesWithin(lookup, 200)).toBe(true);
    expect((await lookup).size).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/FAA disruption lookup failed/), expect.anything());
    // Negative-cached: the next lookup does not fetch again.
    await getDisruptedAirportsMap();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('AeroDataBox window fetch (api/_schedule-aerodatabox.ts)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    __resetAdbSpendForTests();
    process.env.AERODATABOX_API_KEY = 'adb-test-key';
    process.env.AERODATABOX_INTER_WINDOW_DELAY_MS = '0';
    process.env.AERODATABOX_DAILY_UNIT_BUDGET = '100000';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.AERODATABOX_API_KEY;
    delete process.env.AERODATABOX_INTER_WINDOW_DELAY_MS;
    delete process.env.AERODATABOX_DAILY_UNIT_BUDGET;
    __resetAdbSpendForTests();
  });

  it('a stalled body read ends at the window timeout, takes the failure path, and bills exactly as before', async () => {
    let providerCalls = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (!String(url).includes('aerodatabox')) throw new Error(`unexpected fetch: ${url}`);
      providerCalls++;
      return stalledBody(init?.signal);
    });
    const unitsBefore = getAdbUnitsToday();
    // 4 s budget, no inter-window pause → each of the two FIDS windows gets 2 s.
    const board = fetchViaAeroDataBox('ORD', 'departures', Math.floor(Date.now() / 1000), 4_000);
    expect(await settlesWithin(board, 1_900)).toBe(false);
    expect(await settlesWithin(board, 2_400)).toBe(true);
    await board;
    expect(providerCalls).toBe(2);
    // Two requests fired, two units each — the count is per request sent, unchanged by the fix.
    expect(getAdbUnitsToday() - unitsBefore).toBe(4);
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/AeroDataBox schedule timeout for ORD departures/));
  });

  it('a body that arrives in time is still read and returned', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ departures: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const board = fetchViaAeroDataBox('ORD', 'departures', Math.floor(Date.now() / 1000), 4_000);
    expect(await settlesWithin(board, 100)).toBe(true);
    expect(console.error).not.toHaveBeenCalledWith(expect.stringMatching(/timeout/));
  });
});
