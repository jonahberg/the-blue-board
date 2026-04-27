// /api/pro/push-subscribe — register a push subscription for the auth Pro user.
//
// Two delivery modes (per Eng Review D3):
//   - delivery='push': installed-PWA users with a real PushSubscription
//   - delivery='email': iOS users who skipped install (fallback to Resend email)
//
// The fallback row uses a synthetic endpoint 'email:{user_email}' so the same
// alert dispatcher handles both paths uniformly.

import type { VercelRequest, VercelResponse } from '../types.js';
import { getSupabase } from '../_supabase.js';
import { getProSession } from '../_auth.js';
import { isProEnabled } from '../_kill-switch.js';

const ALLOWED_ORIGINS = new Set([
  'https://theblueboard.co',
  'https://www.theblueboard.co',
]);
const LOCALHOST_RE = /^http:\/\/localhost(:\d+)?$/;

function applyCors(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers?.origin || '';
  const ok = typeof origin === 'string' && (ALLOWED_ORIGINS.has(origin) || LOCALHOST_RE.test(origin));
  res.setHeader('Access-Control-Allow-Origin', ok ? origin : 'https://theblueboard.co');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const session = await getProSession(req);
  if (!session) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!session.pro) {
    res.status(403).json({ error: 'Pro subscription required' });
    return;
  }
  if (!isProEnabled('push')) {
    res.status(503).json({ error: 'Push notifications temporarily disabled' });
    return;
  }

  const delivery = req.body?.delivery;
  const userAgent = typeof req.body?.user_agent === 'string' ? req.body.user_agent.slice(0, 500) : null;

  if (delivery !== 'push' && delivery !== 'email') {
    res.status(400).json({ error: 'delivery must be "push" or "email"' });
    return;
  }

  let endpoint: string;
  let keys: Record<string, string>;

  if (delivery === 'push') {
    const sub = req.body?.subscription;
    if (!sub || typeof sub.endpoint !== 'string' || !sub.keys) {
      res.status(400).json({ error: 'subscription.endpoint and subscription.keys required' });
      return;
    }
    endpoint = sub.endpoint;
    keys = sub.keys;
  } else {
    // email fallback — synthetic endpoint keyed by user email
    endpoint = 'email:' + session.email;
    keys = {};
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        user_id: session.userId,
        endpoint,
        keys,
        delivery,
        user_agent: userAgent,
      },
      { onConflict: 'user_id,endpoint' }
    );

  if (error) {
    console.error('push_subscriptions upsert failed:', error.message);
    res.status(500).json({ error: 'Could not register subscription' });
    return;
  }

  res.status(201).json({ ok: true, delivery });
}
