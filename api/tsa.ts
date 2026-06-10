import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';
import { CacheStore } from './_cache.js';

const isRateLimited = createRateLimiter('tsa', 30);

// 5-minute TTL, 10-minute stale grace
const cache = new CacheStore<TsaResponse>('tsa', { defaultTTL: 300_000 });
const STALE_GRACE_MS = 600_000;

// United hub IATA codes
const UNITED_HUBS = ['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX'];
const CACHE_KEY = 'all-hubs';

interface TsaResponse {
  hubs: Record<string, {
    standardWait: number | null;
    precheckWait: number | null;
    lastUpdated: string | null;
    reports: Array<{ wait: number; precheck: boolean; created: string }>;
  }>;
  lastRefreshed: string;
  // True when the MyTSA upstream returned nothing usable for any hub. MyTSA was decommissioned
  // (the endpoint 302s to the TSA homepage), so this is currently always true in production —
  // the flag lets consumers say "wait times unavailable" instead of rendering all-null as fresh
  // data stamped `lastRefreshed: now`. (Audit: tsa-serves-dead-upstream-as-fresh.)
  feedDown: boolean;
}

/** True when no hub has any wait data or reports — the dead-upstream signature. */
export function computeTsaFeedDown(hubs: TsaResponse['hubs']): boolean {
  const codes = Object.keys(hubs);
  if (codes.length === 0) return true;
  return codes.every((c) => {
    const h = hubs[c];
    return h.standardWait === null && h.precheckWait === null && (h.reports?.length ?? 0) === 0;
  });
}

/**
 * Fetch wait times from the MyTSA government API for all United hubs.
 * The API returns crowdsourced wait time reports in 10-minute buckets.
 * We fetch both standard and PreCheck wait times per hub.
 */
async function fetchMyTsaData(): Promise<TsaResponse> {
  const hubs: TsaResponse['hubs'] = {};
  const now = new Date().toISOString();

  // Fetch all hubs in parallel — standard and precheck for each
  const fetches = UNITED_HUBS.flatMap((code) => [
    fetchHubWaitTimes(code, false),
    fetchHubWaitTimes(code, true),
  ]);

  const results = await Promise.allSettled(fetches);

  for (let i = 0; i < UNITED_HUBS.length; i++) {
    const code = UNITED_HUBS[i];
    const standardResult = results[i * 2];
    const precheckResult = results[i * 2 + 1];

    const standardReports = standardResult.status === 'fulfilled' ? standardResult.value : [];
    const precheckReports = precheckResult.status === 'fulfilled' ? precheckResult.value : [];

    // Get the most recent report for each type
    const latestStandard = standardReports.length > 0 ? standardReports[0] : null;
    const latestPrecheck = precheckReports.length > 0 ? precheckReports[0] : null;

    const allReports = [
      ...standardReports.map((r) => ({ wait: r.waitMinutes, precheck: false, created: r.createdAt })),
      ...precheckReports.map((r) => ({ wait: r.waitMinutes, precheck: true, created: r.createdAt })),
    ].sort((a, b) => new Date(b.created).getTime() - new Date(a.created).getTime());

    hubs[code] = {
      standardWait: latestStandard?.waitMinutes ?? null,
      precheckWait: latestPrecheck?.waitMinutes ?? null,
      lastUpdated: allReports.length > 0 ? allReports[0].created : null,
      reports: allReports.slice(0, 5), // Keep last 5 reports
    };
  }

  return { hubs, lastRefreshed: now, feedDown: computeTsaFeedDown(hubs) };
}

/**
 * Fetch wait time reports from MyTSA for a single airport.
 * The API returns the last 25 reported wait times.
 * Wait time values: 0 = no wait, 1 = 1-10 min, 2 = 11-20 min, etc.
 */
async function fetchHubWaitTimes(
  airportCode: string,
  precheck: boolean
): Promise<Array<{ waitMinutes: number; createdAt: string }>> {
  const params = new URLSearchParams({
    ap: airportCode,
    output: 'json',
  });
  if (precheck) params.set('pc', '1');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const resp = await fetch(
      `https://apps.tsa.dhs.gov/MyTSAWebService/GetTSOWaitTimes.ashx?${params}`,
      { signal: controller.signal }
    );

    if (!resp.ok) return [];

    const data = await resp.json();

    // The API returns an array of wait time objects
    // Each has: Created_Datetime, Wait_Time (0-based bucket), Airport_Code
    if (!Array.isArray(data)) return [];

    return data
      .filter((entry: any) => entry && Number.isInteger(entry.Wait_Time) && entry.Wait_Time >= 0)
      .map((entry: any) => ({
        // Convert bucket to midpoint minutes: 0=0, 1=5, 2=15, 3=25, etc.
        waitMinutes: entry.Wait_Time === 0 ? 0 : entry.Wait_Time * 10 - 5,
        createdAt: entry.Created_Datetime || new Date().toISOString(),
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin = req.headers?.origin || '';
  if (origin && origin !== 'https://theblueboard.co' && !/^http:\/\/localhost(:\d+)?$/.test(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (isRateLimited(req)) {
    return res.status(429).json({ error: 'Rate limited — try again shortly' });
  }

  // Try fresh cache first
  const cached = cache.get(CACHE_KEY);
  if (cached) {
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(cached);
  }

  try {
    const data = await fetchMyTsaData();
    cache.set(CACHE_KEY, data);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(data);
  } catch (e: any) {
    console.error('TSA API error:', e);

    // Try stale cache as fallback
    const stale = cache.getStale(CACHE_KEY, STALE_GRACE_MS);
    if (stale) {
      res.setHeader('X-TSA-Data-Stale', 'true');
      res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
      return res.status(200).json(stale);
    }

    return res.status(502).json({ error: 'TSA data temporarily unavailable' });
  }
}
