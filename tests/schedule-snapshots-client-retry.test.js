// getSupabaseAdmin (api/_schedule-snapshots.ts) memoizes the client's promise for the life of the
// instance. A failed `@supabase/supabase-js` import, or a createClient that throws, resolved that
// promise to null and kept it: every later call on the instance got null, so the schedule snapshots,
// the cost state, the brief, flight history and every other caller of this one seam stayed off until
// the instance recycled. The failure is now forgotten and the next call tries again.
//
// Its own file: the module-level promise must start empty, and the other snapshot tests memoize a
// working client.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const supa = vi.hoisted(() => ({ failures: 0, created: 0 }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => {
    if (supa.failures > 0) {
      supa.failures -= 1;
      throw new Error('simulated init failure');
    }
    supa.created += 1;
    return { from: () => ({}) };
  },
}));

import { getSupabaseAdmin } from '../api/_schedule-snapshots.js';

describe('getSupabaseAdmin after a failed initialisation', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('answers null for the call that failed, then retries and keeps the client it gets', async () => {
    supa.failures = 1;
    expect(await getSupabaseAdmin()).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);

    const client = await getSupabaseAdmin();
    expect(client).not.toBeNull();
    expect(supa.created).toBe(1);

    // Once it has a client, it keeps it: no second createClient.
    expect(await getSupabaseAdmin()).toBe(client);
    expect(supa.created).toBe(1);
  });
});
