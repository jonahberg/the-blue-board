// Proxy endpoint for the unitedstarlinktracker.com verification ledger.
//
// Upstream /api/mismatches tracks community-spreadsheet Starlink claims that
// official united.com verification OVERRULED. These tails are ALREADY EXCLUDED
// from the ~400 served by /api/data, so this endpoint is a data-integrity record
// of "claims we (and upstream) deliberately do NOT serve" — not a correction to
// the main fleet count.
//
// Upstream sends `Cache-Control: no-store`, so we keep a long in-memory cache
// (45 min) to avoid hammering it every time a visitor opens the STARLINK tab.
// Mirrors the api/check-flight.ts skeleton: GET-only, origin-locked, IP rate
// limited, ~4s AbortController, negative cache on connection failure.

import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';
import { normalizeType, normalizeOperator } from './_starlink-normalize.js';

const UPSTREAM_URL = 'https://unitedstarlinktracker.com/api/mismatches';
const isRateLimited = createRateLimiter('starlink-mismatches', 20);

const CACHE_TTL = 45 * 60 * 1000; // 45 min — upstream is no-store; the ledger changes slowly.
const NEGATIVE_TTL = 60 * 1000;   // short-circuit window after a connection failure.

interface DisputedRow {
  tail: string;        // normalised (trimmed + upper-cased) registration
  aircraft: string;    // normalizeType()
  operator: string;    // normalizeOperator()
  verifiedAs: string;  // what official verification found instead (e.g. "Viasat", "Thales")
  verifiedAt: string;  // ISO 8601 or ''
  dateFound: string;   // original community sighting date (YYYY-MM-DD) or ''
}

interface VerifySummary {
  verifiedStarlink: number;
  disputed: number;
  unverified: number;
  totalPlanes: number;
  generatedAt: string; // ISO 8601
}

interface AdaptedResponse {
  summary: VerifySummary;
  disputed: DisputedRow[];
}

let cache: { data: AdaptedResponse; ts: number } | null = null;
let upstreamUnhealthyUntil = 0;

// Test-only: reset module-level state. Imported by tests/starlink-mismatches.test.js.
export function _resetCacheForTest(): void {
  cache = null;
  upstreamUnhealthyUntil = 0;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

// Accept an upstream epoch (seconds or ms) or an ISO/date string; emit an ISO string or ''.
function toIso(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    const sec = v > 1e12 ? Math.round(v / 1000) : Math.round(v);
    return new Date(sec * 1000).toISOString();
  }
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

// Adapt the (loosely documented) upstream payload into our stable contract. Tolerant of missing
// fields and of several plausible key spellings: every field defaults rather than throws, so a
// shape drift degrades to an empty/partial ledger (hidden panel) instead of a 502.
function adapt(u: any): AdaptedResponse {
  const rawList: any[] =
    Array.isArray(u?.disputed) ? u.disputed
    : Array.isArray(u?.mismatches) ? u.mismatches
    : Array.isArray(u?.planes) ? u.planes
    : Array.isArray(u) ? u
    : [];

  const disputed: DisputedRow[] = rawList
    .map((r) => ({
      tail: str(r?.tail ?? r?.TailNumber ?? r?.tail_number).toUpperCase(),
      aircraft: normalizeType(r?.aircraft ?? r?.Aircraft ?? r?.aircraft_type),
      operator: normalizeOperator(r?.operator ?? r?.OperatedBy ?? r?.operated_by),
      verifiedAs: str(r?.verifiedAs ?? r?.verified_as ?? r?.VerifiedAs) || 'Not Starlink',
      verifiedAt: toIso(r?.verifiedAt ?? r?.verified_at ?? r?.VerifiedAt),
      dateFound: str(r?.dateFound ?? r?.DateFound ?? r?.date_found),
    }))
    .filter((d) => d.tail);

  const s = u?.summary ?? u?.stats ?? {};
  const summary: VerifySummary = {
    verifiedStarlink: num(s?.verifiedStarlink ?? s?.verified_starlink ?? s?.verified),
    disputed: num(s?.disputed ?? s?.disputed_count ?? s?.mismatches_count) || disputed.length,
    unverified: num(s?.unverified ?? s?.unverified_count),
    totalPlanes: num(s?.totalPlanes ?? s?.total_planes ?? s?.total),
    generatedAt: toIso(s?.generatedAt ?? s?.generated_at ?? u?.generatedAt) || new Date().toISOString(),
  };

  return { summary, disputed };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin as string | undefined;
  if (origin && origin !== 'https://theblueboard.co' && !/^http:\/\/localhost(:\d+)?$/.test(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.setHeader('Access-Control-Allow-Origin', origin || 'https://theblueboard.co');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Rate limit before the cache lookup so the endpoint's per-IP cost is bounded even on hits.
    if (isRateLimited(req)) {
      return res.status(429).json({ error: 'Too many requests' });
    }

    if (cache && Date.now() - cache.ts < CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, s-maxage=2700, stale-while-revalidate=600');
      return res.status(200).json(cache.data);
    }

    // Don't re-attempt a known-dead host inside the negative-cache window.
    if (Date.now() < upstreamUnhealthyUntil) {
      return res.status(502).json({ error: 'Mismatch service unavailable' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const resp = await fetch(UPSTREAM_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'BlueBoard-StarlinkMismatches/1.0' },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return res.status(resp.status).json({ error: `Upstream returned ${resp.status}` });
    }

    const adapted = adapt(await resp.json());

    upstreamUnhealthyUntil = 0;
    cache = { data: adapted, ts: Date.now() };

    res.setHeader('Cache-Control', 'public, s-maxage=2700, stale-while-revalidate=600');
    return res.status(200).json(adapted);
  } catch (err: any) {
    upstreamUnhealthyUntil = Date.now() + NEGATIVE_TTL;
    console.error('Starlink-mismatches error:', err);
    return res.status(502).json({ error: 'Mismatch service unavailable' });
  }
}
