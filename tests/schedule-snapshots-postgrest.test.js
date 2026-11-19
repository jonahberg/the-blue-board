// loadBoardsListingFlight through the REAL supabase-js client (no network: fetch is captured), so
// the PostgREST request it sends is pinned, not just the builder calls a mock saw. Preview deploys
// are skipped on this project, so production would otherwise be the first place this query runs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { loadBoardsListingFlight } from '../api/_schedule-snapshots.js';

describe('loadBoardsListingFlight — the PostgREST request', () => {
  let requests;
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
    requests = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      requests.push({ url: String(input instanceof Request ? input.url : input), method: init?.method || 'GET' });
      const rows = [{
        cache_key: 'agg:ORD:departures:1794981600',
        payload: { flights: [{ identification: { number: { default: 'UA1' } } }, { identification: { number: { default: 'UA2' } } }] },
        refreshed_at: '2026-11-18T12:00:00+00:00',
      }];
      return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('is one GET on schedule_snapshots with the key list and the jsonb containment filter', async () => {
    const keys = ['agg:ORD:departures:1794981600', 'agg:SFO:arrivals:1794988800'];
    const result = await loadBoardsListingFlight(keys, 'UA1');

    expect(requests).toHaveLength(1);
    expect(requests[0].method).toBe('GET');
    const url = new URL(requests[0].url);
    expect(url.pathname).toBe('/rest/v1/schedule_snapshots');
    expect(url.searchParams.get('select')).toBe('cache_key,payload,refreshed_at');
    expect(url.searchParams.get('cache_key')).toBe('in.(agg:ORD:departures:1794981600,agg:SFO:arrivals:1794988800)');
    expect(url.searchParams.get('expires_at')).toMatch(/^gt\.\d{4}-\d{2}-\d{2}T/);
    expect(url.searchParams.get('payload')).toBe('cs.{"flights":[{"identification":{"number":{"default":"UA1"}}}]}');

    expect(result.failed).toBe(false);
    expect(result.boards.get('agg:ORD:departures:1794981600').data.flights).toEqual([{ identification: { number: { default: 'UA1' } } }]);
  });
});
