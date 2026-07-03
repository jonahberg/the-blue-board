import type { VercelRequest, VercelResponse } from '../types.js';
import { isAuthorizedCronRequest } from '../_cron-auth.js';

const HUB_ICAOS = 'KEWR,KIAH,KORD,KDEN,KSFO,KLAX,KIAD,RJAA,PGUM';

/**
 * Cron job to warm the METAR weather cache every 5 minutes.
 * Calls /api/metar internally so the s-maxage=300 CDN cache stays warm AND the per-instance
 * last-known-good store gets populated — making user-facing cache-misses (and slow-AWC blackouts) rare.
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
      headers: { origin: 'https://theblueboard.co' },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      console.error('METAR cache warm failed:', resp.status, await resp.text());
      return res.status(502).json({ error: 'Cache warm failed', status: resp.status });
    }

    const data = await resp.json();
    const stationCount = Array.isArray(data) ? data.length : 0;
    console.log(`METAR cache warmed: ${stationCount} stations`);

    return res.status(200).json({ ok: true, stations: stationCount });
  } catch (e: any) {
    console.error('METAR cron error:', e);
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'METAR cache warm timed out' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
}
