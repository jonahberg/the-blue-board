// POST /api/stripe/webhook
//
// Handles 4 Stripe lifecycle events with signature verification + idempotency:
//   - checkout.session.completed → upsert subscription with active status
//   - customer.subscription.updated → update status, cancel_at_period_end, period_end
//   - customer.subscription.deleted → mark status canceled
//   - invoice.payment_failed → flag status past_due
//
// Idempotency: stripe_events table has PRIMARY KEY on event.id. INSERT ON CONFLICT
// DO NOTHING returns empty result on duplicate, which we use to short-circuit
// without re-processing. Stripe retries up to 3x over 72h.
//
// Raw body: Stripe signature verification requires byte-for-byte exact bytes,
// not the auto-parsed JSON. We disable Vercel's body parser via the config
// export and read the raw stream ourselves.

import type { VercelRequest, VercelResponse } from '../types.js';
import Stripe from 'stripe';
import { getSupabase } from '../_supabase.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY missing');
  return new Stripe(key);
}

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as any) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

async function isAlreadyProcessed(eventId: string): Promise<boolean> {
  // Pre-check duplicate via SELECT (no mutation). The actual idempotency record
  // is INSERTed only after the handler succeeds — see markProcessed.
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('stripe_events')
    .select('id')
    .eq('id', eventId)
    .maybeSingle();
  if (error) {
    // Treat read failures as "not processed" — better to risk re-processing
    // (handlers are idempotent at the row level) than to drop the event.
    console.error('stripe_events SELECT failed (treating as not-processed):', error.message);
    return false;
  }
  return !!data;
}

async function markProcessed(eventId: string, type: string, raw: any): Promise<void> {
  // Called only after the handler succeeded. If this INSERT itself fails, the
  // next Stripe retry will re-run the handler — safe because all our handlers
  // are idempotent (subscription upserts use onConflict: 'user_id', and
  // status updates are keyed on stripe_subscription_id with no stale-state risk).
  const supabase = getSupabase();
  const { error } = await supabase
    .from('stripe_events')
    .insert({ id: eventId, type, raw });
  if (error && (error as any).code !== '23505') {
    // 23505 = unique_violation, expected if a parallel webhook already wrote it.
    // Anything else: log but don't fail the response — the handler already
    // succeeded, returning 500 now would cause Stripe to retry an already-processed event.
    console.error('stripe_events INSERT failed (handler already succeeded):', error.message);
  }
}

// Throws on Supabase write errors so the webhook returns 500 and Stripe retries.
// Without this, transient DB errors (RLS misconfig, schema drift) silently drop
// paid-customer state.
function assertWriteOk(label: string, error: { message: string } | null) {
  if (error) {
    throw new Error(`${label} failed: ${error.message}`);
  }
}

function assertUpdatedRows(label: string, rows: any[] | null | undefined, error: { message: string } | null) {
  assertWriteOk(label, error);
  if (!rows || rows.length === 0) {
    throw new Error(`${label} failed: no matching subscription row`);
  }
}

async function handleCheckoutCompleted(event: Stripe.Event) {
  const session = event.data.object as Stripe.Checkout.Session;
  const userId = session.metadata?.user_id;
  if (!userId || !session.subscription || !session.customer) {
    throw new Error('checkout.session.completed missing required fields');
  }

  const supabase = getSupabase();
  const stripe = getStripe();
  const sub = await stripe.subscriptions.retrieve(session.subscription as string);

  const { error } = await supabase.from('subscriptions').upsert(
    {
      user_id: userId,
      stripe_customer_id: session.customer as string,
      stripe_subscription_id: sub.id,
      status: sub.status,
      cancel_at_period_end: sub.cancel_at_period_end,
      current_period_end: new Date((sub as any).current_period_end * 1000).toISOString(),
      price_id: sub.items.data[0]?.price.id ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
  assertWriteOk('subscriptions upsert (checkout.session.completed)', error);
}

async function handleSubscriptionUpdated(event: Stripe.Event) {
  const sub = event.data.object as Stripe.Subscription;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('subscriptions')
    .update({
      status: sub.status,
      cancel_at_period_end: sub.cancel_at_period_end,
      current_period_end: new Date((sub as any).current_period_end * 1000).toISOString(),
      price_id: sub.items.data[0]?.price.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', sub.id)
    .select('id');
  assertUpdatedRows('subscriptions update (customer.subscription.updated)', data as any[] | null, error);
}

async function handleSubscriptionDeleted(event: Stripe.Event) {
  const sub = event.data.object as Stripe.Subscription;
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', sub.id)
    .select('id');
  assertUpdatedRows('subscriptions update (customer.subscription.deleted)', data as any[] | null, error);
}

async function handlePaymentFailed(event: Stripe.Event) {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId = (invoice as any).subscription as string | null;
  if (!subscriptionId) return;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('subscriptions')
    .update({
      status: 'past_due',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_subscription_id', subscriptionId)
    .select('id');
  assertUpdatedRows('subscriptions update (invoice.payment_failed)', data as any[] | null, error);

  // TODO v1.1: queue an email to the user via Resend
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sigRaw = req.headers['stripe-signature'];
  const signature = Array.isArray(sigRaw) ? sigRaw[0] : sigRaw;
  if (!signature || typeof signature !== 'string') {
    return res.status(400).json({ error: 'Missing stripe-signature' });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET missing');
    return res.status(500).json({ error: 'Webhook not configured' });
  }

  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req);
  } catch (e: any) {
    console.error('Failed to read raw body:', e.message);
    return res.status(400).json({ error: 'Bad request body' });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err: any) {
    console.error('Stripe signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Idempotency: pre-check duplicate via SELECT (no mutation). If a prior
  // run already recorded this event.id, the handler already succeeded — skip.
  // Critical: we INSERT into stripe_events ONLY after the handler succeeds
  // (see markProcessed below). This way, a transient handler failure causes
  // Stripe to retry and re-run the handler, instead of being silently swallowed.
  const alreadyProcessed = await isAlreadyProcessed(event.id);
  if (alreadyProcessed) {
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event);
        break;
      case 'invoice.payment_failed':
        await handlePaymentFailed(event);
        break;
      default:
        // Unknown event type: no-op handler, but still mark processed so we
        // don't re-process on retry.
        break;
    }
    // Record the event AFTER successful handling. If this INSERT itself fails
    // (logged but not thrown), the next Stripe retry re-runs the handler — safe
    // because all handlers are idempotent at the row level.
    await markProcessed(event.id, event.type, event as any);
    return res.status(200).json({ received: true });
  } catch (err: any) {
    console.error(`Stripe webhook handler for ${event.type} failed:`, err.message);
    // Return 500 so Stripe retries the webhook. Crucially, stripe_events was
    // NOT yet updated for this event.id — the retry will run the handler again.
    return res.status(500).json({ error: 'Handler failed' });
  }
}
