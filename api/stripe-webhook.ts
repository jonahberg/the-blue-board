// Stripe → supporter_payments, for "cover a day" (src/lib/cover-a-day.js, sql/023).
// POST /api/stripe-webhook   (called by Stripe only; every request must carry a valid signature)
//
// EVENTS
//   checkout.session.completed            a Payment Link checkout finished. Stored only when
//   checkout.session.async_payment_succeeded  payment_status is 'paid' and it came from a Payment
//                                         Link; a delayed method (bank debit) arrives 'unpaid' on
//                                         .completed and is stored on .async_payment_succeeded.
//   charge.refunded                       raises the row's refunded amount (matched on the payment
//                                         intent); a full refund takes the payment out of coverage.
//   anything else                         200, ignored.
//
// SIGNATURE (no Stripe SDK). Stripe signs `<t>.<raw body>` with HMAC-SHA256 under the endpoint's
// signing secret (STRIPE_WEBHOOK_SECRET, `whsec_…`) and sends `Stripe-Signature: t=…,v1=…[,v1=…]`.
// This checks every v1 in constant time, rejects a timestamp more than 5 minutes from now (replay),
// and rejects anything else with a 400 before the body is parsed.
//
// RAW BODY. The signature is over the exact bytes Stripe sent; JSON.stringify(req.body) is not those
// bytes (Stripe pretty-prints, escapes, orders). In this project's Vercel functions (default-export
// `(req, res)` handlers, @vercel/node helpers on) the helpers read the whole body first to back the
// lazy `req.body`, then RESTORE it: `restoreBody` re-routes `req.on('data' | 'end')` to a replay
// stream. So `readRawBody` listens for exactly those events and never touches `req.body`. It fails
// closed: an empty, oversized or stalled body never verifies. tests/stripe-webhook.test.js runs the
// installed @vercel/node `restoreBody` over a real HTTP request to prove it.
//
// STORED: event id, session id, payment intent id, Payment Link id, amount (cents), currency, paid
// time (the event's `created`), live/test, placement (the link's `client_reference_id`, src/lib/support-link.js),
// recurring, refund state, and the display name from the Payment Link's custom text field
// (STRIPE_NAME_FIELD_KEY, default `displayname`). NEVER stored or logged: the email address, the
// customer, card or billing details, or the payload itself.
//
// IN PRODUCTION (VERCEL_ENV=production) a test-mode event is acknowledged and ignored. Idempotent:
// one row per session (`on conflict (session_id) do nothing`), so a redelivery inserts nothing, and a
// refund only ever raises the refunded amount. A failed write answers 500 so Stripe retries (it
// does for up to three days), which is also what happens before sql/023 is applied.

import { createHmac, timingSafeEqual } from 'node:crypto';

import type { VercelRequest, VercelResponse } from './_types.js';
import { getSupabase } from './_supabase.js';
import { PLACEMENT_LABEL_RE } from '../src/lib/support-link.js';
import { collapseWhitespace } from '../src/lib/supporter-name.js';

export const SIGNATURE_TOLERANCE_SEC = 5 * 60;
/** Stripe events are a few KB; anything this large is not one. */
export const MAX_BODY_BYTES = 256 * 1024;
export const BODY_TIMEOUT_MS = 5000;
export const DEFAULT_NAME_FIELD_KEY = 'displayname';
export const SUPPORTER_TABLE = 'supporter_payments';

const SESSION_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded']);
const NAME_MAX = 100;

export class BodyError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * The request body exactly as sent. See the header: works on a bare IncomingMessage and on one
 * whose body @vercel/node's helpers have already read and restored.
 */
export function readRawBody(
  req: any,
  { limit = MAX_BODY_BYTES, timeoutMs = BODY_TIMEOUT_MS }: { limit?: number; timeoutMs?: number } = {},
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!req || typeof req.on !== 'function') {
      reject(new BodyError(400, 'no request body stream'));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error: Error | null, body?: Buffer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(body as Buffer);
    };
    const timer = setTimeout(() => finish(new BodyError(408, 'request body timed out')), timeoutMs);
    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
      size += buf.length;
      if (size > limit) {
        finish(new BodyError(413, 'request body too large'));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => finish(null, Buffer.concat(chunks)));
    req.on('error', () => finish(new BodyError(400, 'request body stream failed')));
  });
}

/** `t=…,v1=…,v1=…,v0=…` → the timestamp and every v1 signature. */
export function parseSignatureHeader(header: unknown): { t: number | null; v1: string[] } {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return { t: null, v1: [] };
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of value.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (key === 't' && /^\d{1,12}$/.test(val)) t = Number(val);
    else if (key === 'v1' && val) v1.push(val);
  }
  return { t, v1 };
}

export type SignatureCheck = { ok: true; timestamp: number } | { ok: false; reason: string };

/**
 * Stripe's v1 scheme: HMAC-SHA256(secret, `${t}.${rawBody}`), hex, compared in constant time
 * against every v1 in the header, with the timestamp inside the tolerance.
 */
export function verifyStripeSignature(
  rawBody: Buffer,
  header: unknown,
  secret: string,
  { nowSec = Math.floor(Date.now() / 1000), toleranceSec = SIGNATURE_TOLERANCE_SEC }: { nowSec?: number; toleranceSec?: number } = {},
): SignatureCheck {
  if (!secret) return { ok: false, reason: 'no secret' };
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return { ok: false, reason: 'empty body' };
  const { t, v1 } = parseSignatureHeader(header);
  if (t === null) return { ok: false, reason: 'no timestamp' };
  if (!v1.length) return { ok: false, reason: 'no v1 signature' };
  if (Math.abs(nowSec - t) > toleranceSec) return { ok: false, reason: 'timestamp outside tolerance' };
  const expected = createHmac('sha256', secret).update(`${t}.`, 'utf8').update(rawBody).digest();
  for (const candidate of v1) {
    if (!/^[0-9a-f]{64}$/i.test(candidate)) continue;
    const given = Buffer.from(candidate, 'hex');
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true, timestamp: t };
  }
  return { ok: false, reason: 'no matching v1 signature' };
}

/** The Payment Link custom field that holds the display name. */
export function nameFieldKey(): string {
  const configured = String(process.env.STRIPE_NAME_FIELD_KEY ?? '').trim();
  return configured || DEFAULT_NAME_FIELD_KEY;
}

/** The typed display name, whitespace-collapsed and capped, or null. Read defensively. */
export function displayNameFromSession(session: any, key: string = nameFieldKey()): string | null {
  const fields = Array.isArray(session?.custom_fields) ? session.custom_fields : [];
  const field = fields.find((f: any) => f && f.key === key && f.type === 'text');
  const raw = field?.text?.value;
  if (typeof raw !== 'string') return null;
  const name = [...collapseWhitespace(raw)].slice(0, NAME_MAX).join('');
  return name || null;
}

/**
 * The placement label: the `client_reference_id` that `supportUrl()` (src/lib/support-link.js)
 * puts on every donate link, kept only if it passes the same rule the helper applies
 * (`PLACEMENT_LABEL_RE`). Stripe documents a Payment Link's UTM codes on the after-payment
 * redirect URL, not on the session, which is why the label travels this way. Null for a link
 * opened without one (an old bookmark, a bare link).
 */
export function placementFromSession(session: any): string | null {
  const candidate = session?.client_reference_id;
  return typeof candidate === 'string' && PLACEMENT_LABEL_RE.test(candidate) ? candidate : null;
}

const idOf = (value: any, prefix: string): string | null => {
  const id = typeof value === 'string' ? value : typeof value?.id === 'string' ? value.id : null;
  return id && id.startsWith(prefix) && /^[A-Za-z0-9_]+$/.test(id) ? id : null;
};

export type SupporterRow = {
  event_id: string;
  session_id: string;
  payment_intent_id: string | null;
  payment_link_id: string | null;
  amount_cents: number;
  currency: string;
  paid_at: string;
  livemode: boolean;
  placement: string | null;
  recurring: boolean;
  display_name: string | null;
};

/**
 * The row for a paid Payment Link session, or the reason it is not stored. Builds the row field
 * by field from an allowlist: nothing else from the session (email, customer, address) can reach
 * the table.
 */
export function supporterRowFromEvent(event: any): { row: SupporterRow } | { skip: string } {
  const session = event?.data?.object;
  if (!session || session.object !== 'checkout.session') return { skip: 'not-a-session' };
  if (session.payment_status !== 'paid') return { skip: 'unpaid' };
  const sessionId = idOf(session.id, 'cs_');
  if (!sessionId) return { skip: 'bad-session-id' };
  const paymentLink = idOf(session.payment_link, 'plink_');
  if (!paymentLink) return { skip: 'not-a-payment-link' };
  const amount = session.amount_total;
  if (!Number.isInteger(amount) || amount < 0) return { skip: 'no-amount' };
  const currency = typeof session.currency === 'string' ? session.currency.toLowerCase() : '';
  if (!/^[a-z]{3}$/.test(currency)) return { skip: 'no-currency' };
  const created = Number.isInteger(event.created) && event.created > 0 ? event.created * 1000 : Date.now();
  return {
    row: {
      event_id: event.id,
      session_id: sessionId,
      payment_intent_id: idOf(session.payment_intent, 'pi_'),
      payment_link_id: paymentLink,
      amount_cents: amount,
      currency,
      paid_at: new Date(created).toISOString(),
      livemode: event.livemode === true,
      placement: placementFromSession(session),
      recurring: session.mode === 'subscription',
      display_name: displayNameFromSession(session),
    },
  };
}

type Outcome = { status: number; body: Record<string, unknown> };

const ok = (extra: Record<string, unknown> = {}): Outcome => ({ status: 200, body: { received: true, ...extra } });

async function storeSession(event: any): Promise<Outcome> {
  const built = supporterRowFromEvent(event);
  if ('skip' in built) return ok({ ignored: built.skip });
  const { error } = await getSupabase()
    .from(SUPPORTER_TABLE)
    .upsert(built.row, { onConflict: 'session_id', ignoreDuplicates: true });
  // 23505: the same event id under a different session (cannot happen with real Stripe ids) —
  // still a duplicate, never a reason for Stripe to retry.
  if (error && error.code !== '23505') {
    console.error(`stripe-webhook: storing ${event.type} failed:`, error.code || '', error.message || error);
    return { status: 500, body: { error: 'Store failed' } };
  }
  return ok({ stored: true });
}

async function storeRefund(event: any): Promise<Outcome> {
  const charge = event?.data?.object;
  if (!charge || charge.object !== 'charge') return ok({ ignored: 'not-a-charge' });
  const paymentIntent = idOf(charge.payment_intent, 'pi_');
  const refundedCents = charge.amount_refunded;
  if (!paymentIntent || !Number.isInteger(refundedCents) || refundedCents <= 0) return ok({ ignored: 'no-refund' });
  // Only ever RAISE the refunded amount, so a late, smaller partial refund cannot undo a bigger one.
  const { data, error } = await getSupabase()
    .from(SUPPORTER_TABLE)
    .update({ amount_refunded_cents: refundedCents, refunded: charge.refunded === true })
    .eq('payment_intent_id', paymentIntent)
    .lt('amount_refunded_cents', refundedCents)
    .select('id');
  if (error) {
    console.error('stripe-webhook: storing a refund failed:', error.code || '', error.message || error);
    return { status: 500, body: { error: 'Store failed' } };
  }
  return ok({ refunded: Array.isArray(data) ? data.length : 0 });
}

/** Route one verified, parsed event. Exported for the tests. */
export async function handleStripeEvent(event: any, { production = process.env.VERCEL_ENV === 'production' } = {}): Promise<Outcome> {
  if (!event || typeof event !== 'object' || typeof event.id !== 'string' || !/^evt_[A-Za-z0-9_]+$/.test(event.id) || typeof event.type !== 'string') {
    return { status: 400, body: { error: 'Not a Stripe event' } };
  }
  if (production && event.livemode !== true) return ok({ ignored: 'test-mode' });
  if (SESSION_EVENTS.has(event.type)) return storeSession(event);
  if (event.type === 'charge.refunded') return storeRefund(event);
  return ok({ ignored: 'event-type' });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!secret) {
    console.error('stripe-webhook: STRIPE_WEBHOOK_SECRET is not set; refusing every event');
    return res.status(503).json({ error: 'Webhook not configured' });
  }

  let raw: Buffer;
  try {
    raw = await readRawBody(req);
  } catch (e: any) {
    return res.status(e instanceof BodyError ? e.status : 400).json({ error: 'Unreadable body' });
  }

  const check = verifyStripeSignature(raw, req.headers?.['stripe-signature'], secret);
  if (!check.ok) {
    console.warn(`stripe-webhook: rejected (${check.reason})`);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event: any;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  let outcome: Outcome;
  try {
    outcome = await handleStripeEvent(event);
  } catch (e: any) {
    // getSupabase() throws when the project is not configured; Stripe should retry, not drop it.
    console.error('stripe-webhook: handling failed:', e?.message || e);
    outcome = { status: 500, body: { error: 'Store failed' } };
  }
  return res.status(outcome.status).json(outcome.body);
}
