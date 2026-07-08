// Web Push subscription endpoint for server-side flight watch alerts.
//
//   GET  /api/push-subscribe            → { configured, vapidPublicKey }  (client bootstrap)
//   POST /api/push-subscribe            → upsert { subscription, watches } by endpoint
//   POST /api/push-subscribe {action:'unsubscribe'} / DELETE → remove by endpoint
//
// GRACEFUL UNCONFIGURED: when Supabase or VAPID env is absent, POST/DELETE return
// { configured:false } with 200 so the client silently falls back to today's in-tab watch
// behaviour instead of surfacing an error. See docs/setup-push-alerts.md (owner actions).
//
// PRIVACY: stores only the push endpoint + its two client keys + watched flight numbers. No
// email, no user id. RLS is service-role only (sql/014_watch_subscriptions.sql).

import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';
import { getSupabase } from './_supabase.js';
import { getVapidPublicKey, isPushConfigured } from './_web-push.js';

const isRateLimited = createRateLimiter('push-subscribe', 20);

const MAX_WATCHES = 10;
const FLIGHT_RE = /^UA\d{1,4}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Known push-service host substrings — sane validation, not an allowlist that breaks new browsers.
// We only require an https URL to a plausible push host; anything wildly off is rejected.
function isValidEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) return false;
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && !!u.hostname && u.hostname.includes('.');
}

function normalizeFlight(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let q = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (q.startsWith('UAL')) q = 'UA' + q.slice(3);
  if (/^\d{1,4}$/.test(q)) q = 'UA' + q;
  return FLIGHT_RE.test(q) ? q : null;
}

interface CleanWatch {
  flight: string;
  date?: string;
  addedAt: string;
}

function sanitizeWatches(raw: unknown): CleanWatch[] {
  if (!Array.isArray(raw)) return [];
  const out: CleanWatch[] = [];
  const seen = new Set<string>();
  for (const w of raw) {
    if (out.length >= MAX_WATCHES) break;
    const flight = normalizeFlight((w as any)?.flight);
    if (!flight) continue;
    const date = typeof (w as any)?.date === 'string' && DATE_RE.test((w as any).date) ? (w as any).date : undefined;
    const key = `${flight}:${date || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ flight, ...(date ? { date } : {}), addedAt: new Date().toISOString() });
  }
  return out;
}

function applyCors(req: VercelRequest, res: VercelResponse): void {
  const origin = req.headers?.origin || '';
  const allowed = origin === 'https://theblueboard.co' || /^http:\/\/localhost(:\d+)?$/.test(origin as string);
  res.setHeader('Access-Control-Allow-Origin', allowed ? (origin as string) : 'https://theblueboard.co');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  // Client bootstrap: hand out the public key + whether background push is available at all.
  if (req.method === 'GET') {
    return res.status(200).json({
      configured: isPushConfigured(),
      vapidPublicKey: getVapidPublicKey(),
    });
  }

  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (isRateLimited(req)) {
    return res.status(429).json({ error: 'Too many requests — try again later' });
  }

  // Unconfigured deployment: report it honestly with 200 so the client falls back to in-tab.
  if (!isPushConfigured() || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return res.status(200).json({ configured: false });
  }

  const body = (req.body || {}) as any;
  const isUnsubscribe = req.method === 'DELETE' || body.action === 'unsubscribe';
  const subscription = body.subscription || {};
  const endpoint = subscription.endpoint;

  if (!isValidEndpoint(endpoint)) {
    return res.status(400).json({ error: 'Invalid or missing subscription endpoint' });
  }

  try {
    const supabase = getSupabase();

    if (isUnsubscribe) {
      const { error } = await supabase.from('watch_subscriptions').delete().eq('endpoint', endpoint);
      if (error) {
        console.error('push-subscribe unsubscribe error:', error.message);
        return res.status(500).json({ error: 'Something went wrong' });
      }
      return res.status(200).json({ configured: true, success: true });
    }

    const p256dh = subscription?.keys?.p256dh;
    const auth = subscription?.keys?.auth;
    if (typeof p256dh !== 'string' || typeof auth !== 'string' || !p256dh || !auth) {
      return res.status(400).json({ error: 'Missing subscription keys' });
    }

    const watches = sanitizeWatches(body.watches);
    // An empty watch list on subscribe means "stop watching everything" → remove the row.
    if (watches.length === 0) {
      const { error } = await supabase.from('watch_subscriptions').delete().eq('endpoint', endpoint);
      if (error) {
        console.error('push-subscribe empty-list delete error:', error.message);
        return res.status(500).json({ error: 'Something went wrong' });
      }
      return res.status(200).json({ configured: true, success: true, removed: true });
    }

    const { error } = await supabase.from('watch_subscriptions').upsert(
      {
        endpoint,
        p256dh,
        auth,
        watches,
        last_seen_at: new Date().toISOString(),
        failed_count: 0,
      },
      { onConflict: 'endpoint' }
    );
    if (error) {
      console.error('push-subscribe upsert error:', error.message);
      return res.status(500).json({ error: 'Something went wrong' });
    }
    return res.status(200).json({ configured: true, success: true, watches: watches.length });
  } catch (e: any) {
    console.error('push-subscribe error:', e?.message || e);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
