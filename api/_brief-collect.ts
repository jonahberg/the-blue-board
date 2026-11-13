// Everything the brief is written from, gathered with ZERO new upstream spend.
//
// HOW: the same way api/cron/refresh-metar.ts and api/irops.ts get their data — by asking the site's
// own CDN-cached endpoints, with the exact request the dashboard (or the warm cron) already sends, so
// the answer is almost always a CDN hit somebody else already paid for in time, and on a miss the
// endpoint does its own (free) work exactly as it would for a visitor:
//
//   /api/irops                        s-maxage=900; asks /api/schedule with officialFallback=0,
//                                     providerFallback=0, scraperFallback=0 — never AeroDataBox, never
//                                     the paid FR24 API, never ScrapingBee
//   /api/faa, /api/nas                s-maxage=300; the FAA's free nasstatus.faa.gov feeds
//   /api/metar?ids=<the 9 hubs>       s-maxage=300; byte-identical to refresh-metar's warm request
//   /api/fr24-feed?airline=UAL        s-maxage=15; the free public live feed the Live tab polls
//   /api/starlink-data?fields=roster  the Starlink tails (the dashboard's boot fetch)
//   /data/fleet.json                  static, for matchAircraft (same file the dashboard loads)
//
// plus one Supabase read of airborne_samples (sql/017, written every 5 min by watch-alerts) for the
// "usual for this time of day" comparison. Every request sends `Accept: application/json`, because
// every response varies on Accept (vercel.json) and a different Accept is a different cache entry.
//
// Nothing here throws. A source that fails comes back null and is named in `errors`.

import { getSupabaseAdmin } from './_schedule-snapshots.js';
import { AIRBORNE_SAMPLES_TABLE } from './_airborne-samples.js';
import { parseFr24Feed } from '../src/lib/feed-health.js';
import { airborneNormal, countAirborneAndStarlink, sameClockDaysBefore } from '../src/lib/brief-facts.js';

/** The warm cron's exact METAR query (api/cron/refresh-metar.ts HUB_ICAOS). */
export const BRIEF_METAR_IDS = 'KEWR,KIAH,KORD,KDEN,KSFO,KLAX,KIAD,RJAA,PGUM';

const HEADERS = { Accept: 'application/json', 'User-Agent': 'BlueBoard-Brief/1.0' };

export function siteBaseUrl(): string {
  return process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'https://theblueboard.co';
}

type Fetch = typeof fetch;
type JsonRead = { ok: true; json: any; asOfMs: number } | { ok: false; error: string };

/** One GET of the site's own endpoint. `asOfMs` backs the CDN's Age header out of the clock. */
async function getJson(fetchImpl: Fetch, url: string, timeoutMs: number, nowMs: number): Promise<JsonRead> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(url, { signal: controller.signal, headers: HEADERS });
    if (!resp.ok) {
      await resp.text().catch(() => '');
      return { ok: false, error: `HTTP ${resp.status}` };
    }
    const json = await resp.json();
    const age = Number(resp.headers?.get?.('age'));
    return { ok: true, json, asOfMs: nowMs - (Number.isFinite(age) && age > 0 ? age * 1000 : 0) };
  } catch (e: any) {
    return { ok: false, error: e?.name === 'AbortError' ? 'timeout' : String(e?.message || e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

// Reference data that changes slowly is kept per warm instance: the roster refreshes every 4 h
// upstream, the fleet file only on deploy.
const REF_TTL_MS = { roster: 60 * 60 * 1000, fleet: 6 * 60 * 60 * 1000 };
let rosterCache: { tails: Set<string>; at: number } | null = null;
let fleetCache: { byReg: Record<string, any>; at: number } | null = null;

export function __resetBriefCollectForTests(): void {
  rosterCache = null;
  fleetCache = null;
}

async function starlinkTails(fetchImpl: Fetch, base: string, nowMs: number): Promise<Set<string> | null> {
  if (rosterCache && nowMs - rosterCache.at < REF_TTL_MS.roster) return rosterCache.tails;
  const read = await getJson(fetchImpl, `${base}/api/starlink-data?fields=roster`, 10_000, nowMs);
  if (!read.ok || !Array.isArray(read.json?.aircraft)) return rosterCache?.tails ?? null;
  const tails = new Set<string>(read.json.aircraft.map((a: any) => String(a?.tail || '')).filter(Boolean));
  if (tails.size > 0) rosterCache = { tails, at: nowMs };
  return tails.size > 0 ? tails : rosterCache?.tails ?? null;
}

async function fleetByReg(fetchImpl: Fetch, base: string, nowMs: number): Promise<Record<string, any>> {
  if (fleetCache && nowMs - fleetCache.at < REF_TTL_MS.fleet) return fleetCache.byReg;
  const read = await getJson(fetchImpl, `${base}/data/fleet.json`, 10_000, nowMs);
  if (!read.ok || !Array.isArray(read.json)) return fleetCache?.byReg ?? {};
  const byReg: Record<string, any> = {};
  for (const aircraft of read.json) if (aircraft?.r) byReg[aircraft.r] = aircraft;
  fleetCache = { byReg, at: nowMs };
  return byReg;
}

/**
 * The airborne median at this clock time on each of the previous `days` days: one narrow primary-key
 * range scan per day (±10 minutes, two or three rows each), not a week of rows. "This clock time" is
 * the US wall clock (sameClockDaysBefore), so the week after a clock change compares like with like.
 */
export async function loadAirborneNormal(nowMs: number, days = 7): Promise<{ median: number; days: number } | null> {
  try {
    const supabase = await getSupabaseAdmin();
    if (!supabase || typeof supabase.from !== 'function') return null;
    const windows = Array.from({ length: days }, (_, i) => sameClockDaysBefore(nowMs, i + 1));
    const reads = await Promise.all(windows.map(async (targetMs) => {
      const { data, error } = await supabase
        .from(AIRBORNE_SAMPLES_TABLE)
        .select('sampled_at, airborne')
        .gte('sampled_at', new Date(targetMs - 10 * 60_000).toISOString())
        .lte('sampled_at', new Date(targetMs + 10 * 60_000).toISOString())
        .limit(10);
      if (error) return { targetMs, samples: [] };
      return {
        targetMs,
        samples: ((data || []) as Array<{ sampled_at: string; airborne: number }>).map((r) => ({ t: r.sampled_at, airborne: Number(r.airborne) })),
      };
    }));
    return airborneNormal(reads);
  } catch (e: any) {
    console.warn('brief airborne-normal read threw:', e?.message || e);
    return null;
  }
}

export type CollectedSources = {
  irops: any | null;
  faa: any[] | null;
  nas: any | null;
  metar: any[] | null;
  air: { airborne: number; express: number; starlink: number | null } | null;
  airNormal: { median: number; days: number } | null;
  asOf: Record<string, number | null>;
  errors: Record<string, string>;
};

/** Gather every source in parallel. Never throws. */
export async function collectBriefSources(options: { fetchImpl?: Fetch; nowMs?: number; baseUrl?: string } = {}): Promise<CollectedSources> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowMs = options.nowMs ?? Date.now();
  const base = options.baseUrl ?? siteBaseUrl();
  const errors: Record<string, string> = {};
  const asOf: Record<string, number | null> = {};

  const [irops, faa, nas, metar, feed, normal] = await Promise.all([
    // On a CDN miss /api/irops rebuilds from nine boards (up to ~55 s); 25 s keeps this run inside
    // maxDuration, and the rebuild it started still lands in the CDN for the next run.
    getJson(fetchImpl, `${base}/api/irops`, 25_000, nowMs),
    getJson(fetchImpl, `${base}/api/faa`, 10_000, nowMs),
    getJson(fetchImpl, `${base}/api/nas`, 10_000, nowMs),
    getJson(fetchImpl, `${base}/api/metar?ids=${BRIEF_METAR_IDS}`, 10_000, nowMs),
    getJson(fetchImpl, `${base}/api/fr24-feed?airline=UAL`, 12_000, nowMs),
    loadAirborneNormal(nowMs),
  ]);

  const take = (name: string, read: JsonRead, valid: (j: any) => boolean) => {
    if (!read.ok) { errors[name] = read.error; asOf[name] = null; return null; }
    if (!valid(read.json)) { errors[name] = 'unexpected shape'; asOf[name] = null; return null; }
    asOf[name] = read.asOfMs;
    return read.json;
  };

  const out: CollectedSources = {
    irops: take('irops', irops, (j) => j && typeof j === 'object' && j.hubMetrics && typeof j.hubMetrics === 'object'),
    faa: take('faa', faa, (j) => Array.isArray(j)),
    nas: take('nas', nas, (j) => j && typeof j === 'object' && !Array.isArray(j)),
    metar: take('metar', metar, (j) => Array.isArray(j) && j.length > 0),
    air: null,
    airNormal: normal,
    asOf,
    errors,
  };
  if (!normal) errors.airNormal = 'unavailable';

  const feedJson = take('air', feed, (j) => j && typeof j === 'object');
  if (feedJson) {
    const flights = parseFr24Feed(feedJson);
    if (flights.length === 0) {
      errors.air = 'empty feed';
    } else {
      const [tails, byReg] = await Promise.all([starlinkTails(fetchImpl, base, nowMs), fleetByReg(fetchImpl, base, nowMs)]);
      const counts = countAirborneAndStarlink(flights, tails ?? new Set(), byReg);
      if (counts.airborne > 0) {
        out.air = { airborne: counts.airborne, express: counts.express, starlink: tails ? counts.starlink : null };
        if (!tails) errors.starlink = 'roster unavailable';
      } else {
        errors.air = 'no airborne flights';
      }
    }
  }
  return out;
}
