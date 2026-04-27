// POST /api/stripe/checkout
//
// Creates a Stripe Checkout session for the authenticated user. Founding price
// ($5.99) for first 100 active subscriptions, regular price ($7.99) thereafter.
// Reuses existing Stripe customer if one matches the user's email; otherwise
// creates a new customer. Passes user_id in metadata so the webhook handler
// can link the subscription back to our auth.users row.
//
// Auth: Bearer token (Supabase access_token). Kill switches: PRO_ENABLED +
// PRO_FEATURE_CHECKOUT_ENABLED.

import type { VercelRequest, VercelResponse } from '../types.js';
import Stripe from 'stripe';
import { getSupabase } from '../_supabase.js';
import { getAuthUser } from '../_auth.js';
import { isProEnabled } from '../_kill-switch.js';

const FOUNDING_LIMIT = 100;
const ALLOWED_ORIGINS = new Set([
  'https://theblueboard.co',
  'https://www.theblueboard.co',
]);
const LOCALHOST_RE = /^http:\/\/localhost(:\d+)?$/;

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY missing');
  return new Stripe(key);
}

function getBaseUrl(req: VercelRequest): string {
  const origin = req.headers?.origin;
  if (typeof origin === 'string' && (ALLOWED_ORIGINS.has(origin) || LOCALHOST_RE.test(origin))) {
    return origin;
  }
  return 'https://theblueboard.co';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isProEnabled('checkout')) {
    return res.status(503).json({ error: 'Pro checkout temporarily disabled' });
  }

  const user = await getAuthUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = getSupabase();

  // Block double-subscribe
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('status, current_period_end')
    .eq('user_id', user.id)
    .maybeSingle();

  if (
    existing &&
    existing.status === 'active' &&
    new Date(existing.current_period_end).getTime() > Date.now()
  ) {
    return res.status(409).json({ error: 'You already have an active Pro subscription' });
  }

  // Founding-price gating — count ACTIVE subscriptions only. Including canceled
  // or incomplete rows would let abandoned checkouts push real users to regular
  // pricing before 100 actual paying subscribers exist.
  const { count } = await supabase
    .from('subscriptions')
    .select('*', { count: 'exact', head: true })
    .in('status', ['active', 'trialing', 'past_due']);
  const activeCount = count ?? 0;

  const priceId =
    activeCount < FOUNDING_LIMIT
      ? process.env.STRIPE_PRICE_ID_FOUNDING
      : process.env.STRIPE_PRICE_ID_REGULAR;

  if (!priceId) {
    console.error('Missing STRIPE_PRICE_ID_FOUNDING or STRIPE_PRICE_ID_REGULAR');
    return res.status(500).json({ error: 'Pricing not configured' });
  }

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (e: any) {
    console.error('Stripe init failed:', e.message);
    return res.status(500).json({ error: 'Payments not configured' });
  }

  try {
    // Find or create Stripe customer
    let customerId: string;
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    } else {
      const created = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id },
      });
      customerId = created.id;
    }

    const baseUrl = getBaseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/pro/flights?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/pro?checkout=canceled`,
      metadata: { user_id: user.id, founding: String(activeCount < FOUNDING_LIMIT) },
      subscription_data: {
        metadata: { user_id: user.id },
      },
      allow_promotion_codes: false,
    });

    return res.status(200).json({ id: session.id, url: session.url });
  } catch (err: any) {
    console.error('Stripe checkout error:', err.message);
    return res.status(500).json({ error: 'Could not create checkout session' });
  }
}
