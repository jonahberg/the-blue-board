// @vitest-environment jsdom
/**
 * F152 — FeedProvider lifecycle: the poll loop, not the parser.
 *
 * `parseFr24Feed` / `nextFeedRetryDelay` are unit-tested in feed-health.test.js. What was
 * untested is how the provider wires them: the 30 s cadence, a zero-aircraft 200 counted as
 * a failure that keeps the last-good flights, the 5/10/20/30 s retry ladder, and the
 * visibility pause. Those are store-lifecycle behaviours, which pure-logic tests miss.
 *
 * `fetch` is stubbed (not `fetchFr24Feed`) so the real zero-aircraft rule in
 * src/app/data/api.ts runs. Rows use FR24's real array layout (see feed-health.js).
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FEED_POLL_MS, FeedProvider, useFeed } from '../src/app/state/feed';
import type { FeedValue } from '../src/app/state/feed';

/** One FR24 feed row, indexes as parseFr24Feed reads them. */
function row(flight: string, reg: string, lat = 41.97, lon = -87.9): unknown[] {
  return ['A1B2C3', lat, lon, 270, 35000, 450, '2341', 'F-KORD1', 'B39M', reg, 1727380000, 'ORD', 'SFO', flight, 0, 0, `UAL${flight.slice(2)}`, 0, 'UAL'];
}

const FULL = { full_count: 12000, version: 4, '3a1b2c': row('UA123', 'N37502'), '3a1b2d': row('UA456', 'N27213', 39.8, -104.7) };
/** The meta-only body /api/fr24-feed really returned in the Jul 3 2026 incident. */
const META_ONLY = { full_count: 12000, version: 4 };

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function Probe({ into }: { into: { current: FeedValue | null } }) {
  into.current = useFeed();
  return null;
}

async function mount() {
  const handle: { current: FeedValue | null } = { current: null };
  await act(async () => {
    render(
      <FeedProvider>
        <Probe into={handle} />
      </FeedProvider>,
    );
  });
  // Let the mount poll's fetch + json() promises settle.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return handle;
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  document.dispatchEvent(new Event('visibilitychange'));
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-09-20T18:00:00Z'));
  localStorage.clear();
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe('FeedProvider poll loop', () => {
  it('polls /api/fr24-feed on mount and then every 30 s', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(FULL));
    const feed = await mount();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/fr24-feed?airline=UAL');
    expect(feed.current!.flights.map((f) => f.flightIATA)).toEqual(['UA123', 'UA456']);
    expect(feed.current!.freshness).toBe('live');
    expect(feed.current!.failed).toBe(false);

    await advance(FEED_POLL_MS - 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('records flight → registration sightings into the reg ledger', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(FULL));
    const feed = await mount();
    const ledger = JSON.parse(localStorage.getItem('bb_reg_ledger_v1') || '{}');
    // Keyed by leg (F15): the feed row flies ORD→SFO.
    expect(ledger['UA123|ORD|SFO']?.reg).toBe('N37502');
    // A sighting only backfills a row whose schedule window contains it…
    const dep = Math.floor(Date.now() / 1000) - 3600;
    expect(feed.current!.lookupReg('UA123', dep, dep + 4 * 3600)).toBe('N37502');
    expect(feed.current!.lookupReg('UA123', dep, dep + 4 * 3600, 'ORD', 'SFO')).toBe('N37502');
    expect(feed.current!.lookupReg('UA123')).toBeNull();
    // …and whose leg it is.
    expect(feed.current!.lookupReg('UA123', dep, dep + 4 * 3600, 'SFO', 'EWR')).toBeNull();
  });

  it('treats a zero-aircraft 200 as a failed poll and keeps the last-good flights', async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse(FULL));
    fetchMock.mockImplementation(async () => jsonResponse(META_ONLY));
    const feed = await mount();
    expect(feed.current!.flights).toHaveLength(2);

    await advance(FEED_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(feed.current!.flights).toHaveLength(2);
    expect(feed.current!.retrying).toBe(true);
    expect(feed.current!.error).toMatch(/no aircraft/i);
    // Flights are still on screen, so the map's "no data" overlay must not show.
    expect(feed.current!.failed).toBe(false);
  });

  it('reports failed only when the feed has never produced flights', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ error: 'upstream' }, 502));
    const feed = await mount();
    expect(feed.current!.flights).toEqual([]);
    expect(feed.current!.failed).toBe(true);
    expect(feed.current!.freshness).toBe('stale');
  });

  it('retries on the 5 / 10 / 20 / 30 s ladder after failures, then resets on success', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({}, 503));
    const feed = await mount();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (const [delay, calls] of [[5000, 2], [10000, 3], [20000, 4], [30000, 5], [30000, 6]] as const) {
      await advance(delay - 1);
      expect(fetchMock).toHaveBeenCalledTimes(calls - 1);
      await advance(1);
      expect(fetchMock).toHaveBeenCalledTimes(calls);
    }

    fetchMock.mockImplementation(async () => jsonResponse(FULL));
    await advance(30000);
    expect(feed.current!.retrying).toBe(false);
    expect(feed.current!.error).toBeNull();
    // Back on the normal cadence.
    const calls = fetchMock.mock.calls.length;
    await advance(FEED_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(calls + 1);
  });

  it('backdates last-good by X-BB-Feed-Stale so a stale serve reads as stale', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(FULL, 200, { 'X-BB-Feed-Stale': '600' }));
    const feed = await mount();
    expect(feed.current!.lastGoodTs).toBe(Date.now() - 600_000);
    expect(feed.current!.freshness).toBe('stale');
  });

  it('adds the CDN Age to the stale-serve age: an edge-cached stale serve is older by both (F102)', async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse(FULL, 200, { 'X-BB-Feed-Stale': '600', Age: '30' }),
    );
    const feed = await mount();
    expect(feed.current!.lastGoodTs).toBe(Date.now() - 630_000);
  });

  it('backdates last-good by the CDN Age alone on a fresh-but-cached response', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(FULL, 200, { Age: '30' }));
    const feed = await mount();
    expect(feed.current!.lastGoodTs).toBe(Date.now() - 30_000);
  });

  it('stops polling while the tab is hidden and refreshes immediately when shown', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(FULL));
    const feed = await mount();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => setHidden(true));
    expect(feed.current!.countdown).toBeNull();
    await advance(FEED_POLL_MS * 4);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => setHidden(false));
    await advance(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(feed.current!.countdown).toBe(FEED_POLL_MS / 1000);
  });

  it('stops polling after unmount', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(FULL));
    await mount();
    cleanup();
    await advance(FEED_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
