import type { VercelRequest, VercelResponse } from '../_types.js';
import { isAuthorizedCronRequest } from '../_cron-auth.js';

const HUB_ICAOS = 'KEWR,KIAH,KORD,KDEN,KSFO,KLAX,KIAD,RJAA,PGUM';

/**
 * Cron job to warm the METAR weather cache every 5 minutes.
 * Calls /api/metar internally so the per-instance last-known-good store gets populated for
 * every hub — making slow-AWC blackouts rare — and warms the CDN entry for the page-load
 * hub request: the nine hubs in collectMetarStations() order (tests pin the two together),
 * with the client's `Accept: application/json` (every response varies on Accept).
 * Later client cycles that add non-hub stations to the first chunk miss the CDN warm by
 * design; they still benefit from the last-known-good store.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Timing-safe, fails closed when CRON_SECRET is unset
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const baseUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);

    const resp = await fetch(`${baseUrl}/api/metar?ids=${HUB_ICAOS}`, {
      signal: controller.signal,
      headers: { origin: 'https://theblueboard.co', Accept: 'application/json' },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      console.error('METAR cache warm failed:', resp.status, await resp.text());
      return res.status(502).json({ error: 'Cache warm failed', status: resp.status });
    }

    const data = await resp.json();
    const records: any[] = Array.isArray(data) ? data : [];
    const stationCount = records.length;
    const got = new Set(records.map((r) => String(r?.icaoId || r?.stationId || r?.id || '').toUpperCase()));
    const missing = HUB_ICAOS.split(',').filter((id) => !got.has(id));
    console.log(`METAR cache warmed: ${stationCount} stations`);
    // Name the gap so a short run (8 of 9 on the Sep 26 deploy) can be diagnosed from logs.
    if (missing.length) console.warn(`METAR cache warm missing ${missing.join(',')}`);

    return res.status(200).json({ ok: true, stations: stationCount, missing });
  } catch (e: any) {
    console.error('METAR cron error:', e);
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'METAR cache warm timed out' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
}
