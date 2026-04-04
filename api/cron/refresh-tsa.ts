import type { VercelRequest, VercelResponse } from '../types.js';

/**
 * Cron job to warm the TSA wait times cache every 5 minutes.
 * Calls the /api/tsa endpoint internally to trigger a fresh fetch.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret
  const authHeader = req.headers['authorization'];
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
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

    const resp = await fetch(`${baseUrl}/api/tsa`, {
      signal: controller.signal,
      headers: { origin: 'https://theblueboard.co' },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      console.error('TSA cache warm failed:', resp.status, await resp.text());
      return res.status(502).json({ error: 'Cache warm failed', status: resp.status });
    }

    const data = await resp.json();
    const hubCount = data.hubs ? Object.keys(data.hubs).length : 0;
    console.log(`TSA cache warmed: ${hubCount} hubs, refreshed at ${data.lastRefreshed}`);

    return res.status(200).json({ ok: true, hubs: hubCount, refreshed: data.lastRefreshed });
  } catch (e: any) {
    console.error('TSA cron error:', e);
    if (e.name === 'AbortError') {
      return res.status(504).json({ error: 'TSA cache warm timed out' });
    }
    return res.status(500).json({ error: 'Internal error' });
  }
}
