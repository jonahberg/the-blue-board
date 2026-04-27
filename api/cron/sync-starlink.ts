// Vercel Cron Job: syncs Starlink aircraft data from unitedstarlinktracker.com
// Writes enriched data (aircraft list, fleet stats, flights) to /tmp for edge caching
// Config in vercel.json: { "path": "/api/cron/sync-starlink", "schedule": "0 */4 * * *" }

import type { VercelRequest, VercelResponse } from '../types.js';
import { isAuthorizedCronRequest } from '../_cron-auth.js';

const UPSTREAM_URL = 'https://unitedstarlinktracker.com/api/data';

export default async function handler(req: VercelRequest, res: VercelResponse) {
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

    const upstream = await resp.json() as {
      totalCount: number;
      starlinkPlanes: Array<{ TailNumber: string; Aircraft: string; fleet: string; OperatedBy: string }>;
      lastUpdated: string;
      fleetStats: { mainline: { total: number; starlink: number }; express: { total: number; starlink: number }; combined: { total: number; starlink: number } };
      flightsByTail: Record<string, Array<{ flight_number: string; departure_airport: string; arrival_airport: string; departure_time: string }>>;
    };

    // Transform to our format: keep backwards-compatible starlink.json shape + extras
    // Upstream uses: TailNumber, Aircraft (=type), fleet ("express"/"mainline"), OperatedBy
    const aircraft = (upstream.starlinkPlanes || []).map(p => ({
      tail: p.TailNumber,
      fleet: (p.fleet || 'express').charAt(0).toUpperCase() + (p.fleet || 'express').slice(1),
      type: p.Aircraft || 'Unknown',
      operator: p.OperatedBy || 'United Airlines',
    }));

    // Normalize fleet stats to simple counts
    const fs = upstream.fleetStats;
    const fleetStats = fs ? {
      mainline: fs.mainline?.starlink ?? 0,
      express: fs.express?.starlink ?? 0,
      total: fs.combined?.starlink ?? aircraft.length,
      mainlineTotal: fs.mainline?.total ?? 0,
      expressTotal: fs.express?.total ?? 0,
    } : null;

    // Normalize flight fields (upstream uses departure_airport/arrival_airport)
    const flightsByTail: Record<string, Array<{ flight_number: string; origin: string; destination: string; departure_time: string }>> = {};
    for (const [tail, flights] of Object.entries(upstream.flightsByTail || {})) {
      flightsByTail[tail] = flights.map((f: any) => ({
        flight_number: f.flight_number,
        origin: f.departure_airport || f.origin || '',
        destination: f.arrival_airport || f.destination || '',
        departure_time: f.departure_time || '',
      }));
    }

    const enriched = {
      aircraft,
      totalCount: upstream.totalCount || aircraft.length,
      fleetStats,
      flightsByTail,
      lastUpdated: upstream.lastUpdated || new Date().toISOString(),
      syncedAt: new Date().toISOString(),
    };

    // Store in global for the /api/starlink-data endpoint to serve
    (globalThis as any).__starlinkCache = enriched;

    return res.status(200).json({
      status: 'ok',
      aircraft_count: aircraft.length,
      fleet_stats: upstream.fleetStats,
      synced_at: enriched.syncedAt,
    });
  } catch (err: any) {
    console.error('Starlink sync error:', err);
    return res.status(500).json({ error: err.message || 'Sync failed' });
  }
}
