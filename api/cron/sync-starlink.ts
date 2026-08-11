// Vercel Cron Job: syncs Starlink aircraft data from unitedstarlinktracker.com
// Persists the enriched payload to the durable Supabase snapshot (starlink_snapshot) so the
// serving endpoint (api/starlink-data.ts) can read it from any lambda. It also sets
// globalThis.__starlinkCache as a same-instance fast path, but Supabase is the real handoff —
// globalThis does NOT survive across serverless instances (the bug this replaces).
// Config in vercel.json: { "path": "/api/cron/sync-starlink", "schedule": "0 */4 * * *" }

import type { VercelRequest, VercelResponse } from '../types.js';
import { normalizeStarlinkPayload, validateStarlinkPayload } from '../_starlink-normalize.js';
import { loadStarlinkSnapshot, saveStarlinkSnapshot } from '../_starlink-snapshot.js';
import { isAuthorizedCronRequest } from '../_cron-auth.js';

const UPSTREAM_URL = 'https://unitedstarlinktracker.com/api/data';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret — timing-safe, fails closed when CRON_SECRET is unset
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const resp = await fetch(UPSTREAM_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'BlueBoard-StarlinkSync/1.0' },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return res.status(502).json({ error: `Upstream returned ${resp.status}` });
    }

    const upstream = await resp.json();
    const enriched = normalizeStarlinkPayload(upstream);

    // §05 validators: refuse to persist a structurally broken payload — a
    // transient empty/partial/renamed feed must not poison the durable snapshot
    // and get served as the "good" fallback for the next 12h.
    const previous = await loadStarlinkSnapshot();
    const validation = validateStarlinkPayload(enriched, previous?.data.aircraft.length);
    for (const warning of validation.warnings) {
      console.warn(`Cron sync-starlink warning: ${warning}`);
    }
    if (!validation.ok) {
      console.error(`Cron sync-starlink rejected upstream payload: ${validation.failures.join('; ')}`);
      return res.status(502).json({
        error: 'Upstream payload failed validation — snapshot not updated',
        reasons: validation.failures,
      });
    }

    // Same-instance fast path (cheap; harmless). The durable cross-instance handoff is Supabase.
    (globalThis as any).__starlinkCache = enriched;

    // Persist durably. saveStarlinkSnapshot never throws and degrades to a no-op if Supabase is
    // unconfigured, so the cron still reports success and the endpoint falls back to direct fetch.
    await saveStarlinkSnapshot(enriched);

    // The 200 body is not captured in runtime logs, so without this line a healthy run is
    // indistinguishable from a silently-degrading one (shrinking fleet, snapshot no-op).
    console.log(`Cron sync-starlink: ${enriched.aircraft.length} aircraft synced at ${enriched.syncedAt}`);

    return res.status(200).json({
      status: 'ok',
      aircraft_count: enriched.aircraft.length,
      fleet_stats: enriched.fleetStats,
      synced_at: enriched.syncedAt,
    });
  } catch (err: any) {
    console.error('Starlink sync error:', err);
    return res.status(500).json({ error: err.message || 'Sync failed' });
  }
}
