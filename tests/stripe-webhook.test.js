/**
 * POST /api/stripe-webhook (Nov 2026, "cover a day").
 *
 *  1. The Stripe-Signature check: HMAC-SHA256 over `<t>.<raw body>`, every v1, constant time,
 *     5-minute tolerance. Signatures here are computed in the test with the real algorithm.
 *  2. The raw body: read from the request stream, never from `req.body`, and proven on a real
 *     HTTP request both bare and after the INSTALLED @vercel/node helpers have read and restored
 *     it (their `readBody`/`restoreBody` source is lifted from node_modules at test time, so a
 *     change there fails here). The body is pretty-printed and carries a é escape, so a
 *     parsed-and-re-serialized body would not verify.
 *  3. What is stored (an allowlist: no email, no customer, no card), what is refused, and that
 *     it is idempotent on redelivery and monotonic on refunds — against an in-memory table.
 */

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { supportUrl } from '../src/lib/support-link.js';

const db = vi.hoisted(() => ({ rows: [], fail: null, calls: [] }));

vi.mock('../api/_supabase.js', () => ({
  getSupabase: () => ({
    from: (table) => ({
      async upsert(row, opts) {
        db.calls.push({ op: 'upsert', table, row, opts });
        if (db.fail) return { error: db.fail };
        if (db.rows.some((r) => r.session_id === row.session_id)) return { error: null };
        db.rows.push({ ...row, refunded: false, amount_refunded_cents: 0, hidden: false });
        return { error: null };
      },
      update(values) {
        const filters = [];
        const chain = {
          eq(col, val) {
            filters.push((r) => r[col] === val);
            return chain;
          },
          lt(col, val) {
            filters.push((r) => r[col] < val);
            return chain;
          },
          async select() {
            db.calls.push({ op: 'update', table, values });
            if (db.fail) return { data: null, error: db.fail };
            const hit = db.rows.filter((r) => filters.every((f) => f(r)));
            for (const r of hit) Object.assign(r, values);
            return { data: hit.map((r) => ({ id: r.session_id })), error: null };
          },
        };
        return chain;
      },
    }),
  }),
}));

const {
  default: handler,
  BodyError,
  DEFAULT_NAME_FIELD_KEY,
  SIGNATURE_TOLERANCE_SEC,
  displayNameFromSession,
  handleStripeEvent,
  parseSignatureHeader,
  placementFromSession,
  readRawBody,
  verifyStripeSignature,
} = await import('../api/stripe-webhook.js');

const SECRET = 'whsec_test_cover_a_day';
const nowSec = () => Math.floor(Date.now() / 1000);

function sign(body, { t = nowSec(), secret = SECRET } = {}) {
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

let seq = 0;
function sessionEvent({ type = 'checkout.session.completed', livemode = true, id, sessionId = 'cs_live_a1B2c3', ...session } = {}) {
  seq += 1;
  return {
    id: id ?? `evt_1Cover${seq}`,
    object: 'event',
    type,
    livemode,
    created: 1_794_250_000,
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        mode: 'payment',
        payment_status: 'paid',
        amount_total: 1700,
        currency: 'usd',
        payment_intent: 'pi_3Cover',
        payment_link: 'plink_1Support',
        // supportUrl() puts the placement label here (src/lib/support-link.js).
        client_reference_id: 'deep-use-prompt',
        metadata: {},
        customer: 'cus_Secret',
        customer_email: 'dana@example.com',
        customer_details: { email: 'dana@example.com', name: 'Dana Realname', address: { postal_code: '60601' } },
        custom_fields: [
          { key: 'displayname', type: 'text', label: { type: 'custom', custom: 'Name to show' }, optional: true, text: { value: '  Dana   R. ' } },
        ],
        ...session,
      },
    },
  };
}

function refundEvent({ amountRefunded, refunded, livemode = true, paymentIntent = 'pi_3Cover' }) {
  seq += 1;
  return {
    id: `evt_1Refund${seq}`,
    object: 'event',
    type: 'charge.refunded',
    livemode,
    created: 1_794_260_000,
    data: { object: { id: 'ch_1', object: 'charge', payment_intent: paymentIntent, amount: 5000, amount_refunded: amountRefunded, refunded, billing_details: { email: 'dana@example.com' } } },
  };
}

/** Stripe-style bytes: pretty-printed, plus a field with a é escape re-serializing would drop. */
function rawBodyOf(event) {
  return JSON.stringify(event, null, 2).replace('"object": "event",', '"object": "event",\n  "note": "caf\\u00e9",');
}

function makeReq(body, headers = {}, method = 'POST') {
  const req = new PassThrough();
  req.method = method;
  req.headers = { 'content-type': 'application/json; charset=utf-8', ...headers };
  req.end(body);
  return req;
}

function createRes() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

async function post(event, { headers, raw = rawBodyOf(event) } = {}) {
  const res = createRes();
  await handler(makeReq(raw, { 'stripe-signature': sign(raw), ...headers }), res);
  return res;
}

beforeEach(() => {
  db.rows.length = 0;
  db.calls.length = 0;
  db.fail = null;
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('STRIPE_NAME_FIELD_KEY', '');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('verifyStripeSignature', () => {
  const body = Buffer.from('{"id":"evt_1","type":"ping"}');

  it('accepts Stripe\'s v1 HMAC-SHA256 over `<t>.<body>`', () => {
    expect(verifyStripeSignature(body, sign(body), SECRET)).toEqual({ ok: true, timestamp: expect.any(Number) });
  });

  it('rejects a different secret, a changed body, a missing header, and a header with no v1', () => {
    expect(verifyStripeSignature(body, sign(body, { secret: 'whsec_other' }), SECRET).ok).toBe(false);
    expect(verifyStripeSignature(Buffer.from(`${body} `), sign(body), SECRET).ok).toBe(false);
    expect(verifyStripeSignature(body, undefined, SECRET).ok).toBe(false);
    const t = nowSec();
    const v0 = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
    expect(verifyStripeSignature(body, `t=${t},v0=${v0}`, SECRET)).toEqual({ ok: false, reason: 'no v1 signature' });
    expect(verifyStripeSignature(body, sign(body), '').ok).toBe(false);
    expect(verifyStripeSignature(Buffer.alloc(0), sign(''), SECRET)).toEqual({ ok: false, reason: 'empty body' });
  });

  it('holds a 5-minute tolerance either side of now (replays and clock games)', () => {
    expect(SIGNATURE_TOLERANCE_SEC).toBe(300);
    const now = 1_800_000_000;
    const at = (t) => verifyStripeSignature(body, sign(body, { t }), SECRET, { nowSec: now }).ok;
    expect(at(now - 299)).toBe(true);
    expect(at(now - 300)).toBe(true);
    expect(at(now - 301)).toBe(false);
    expect(at(now + 301)).toBe(false);
  });

  it('accepts any matching v1 (secret rotation sends two) and skips malformed ones safely', () => {
    const t = nowSec();
    const good = createHmac('sha256', SECRET).update(`${t}.${body}`).digest('hex');
    expect(verifyStripeSignature(body, `t=${t},v1=${'0'.repeat(64)},v1=${good}`, SECRET).ok).toBe(true);
    // A short or non-hex v1 never reaches timingSafeEqual (which throws on a length mismatch).
    expect(verifyStripeSignature(body, `t=${t},v1=abc,v1=${'z'.repeat(64)}`, SECRET).ok).toBe(false);
  });

  it('parses the header shape loosely but only trusts digits for t', () => {
    expect(parseSignatureHeader('t=123, v1=aa ,v1=bb,v0=cc')).toEqual({ t: 123, v1: ['aa', 'bb'] });
    expect(parseSignatureHeader('t=12x,v1=aa')).toEqual({ t: null, v1: ['aa'] });
    expect(parseSignatureHeader(['t=5,v1=a'])).toEqual({ t: 5, v1: ['a'] });
    expect(parseSignatureHeader(null)).toEqual({ t: null, v1: [] });
  });
});

describe('the raw body', () => {
  it('a re-serialized body would NOT verify (so these tests discriminate)', () => {
    const raw = rawBodyOf(sessionEvent());
    expect(JSON.stringify(JSON.parse(raw))).not.toBe(raw);
    const header = sign(raw);
    expect(verifyStripeSignature(Buffer.from(raw), header, SECRET).ok).toBe(true);
    expect(verifyStripeSignature(Buffer.from(JSON.stringify(JSON.parse(raw))), header, SECRET).ok).toBe(false);
  });

  // The installed @vercel/node helpers, lifted from its dist so this follows the package.
  const devServer = readFileSync(join(process.cwd(), 'node_modules/@vercel/node/dist/dev-server.mjs'), 'utf8');
  const lift = (name) => {
    const m = devServer.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
    if (!m) throw new Error(`@vercel/node no longer defines ${name}() — re-check how the raw body is read`);
    return m[0];
  };

  it('finds @vercel/node\'s read-then-restore helpers in the installed package', () => {
    expect(lift('restoreBody')).toMatch(/name === "data" \|\| name === "end"/);
    expect(lift('addHelpers')).toMatch(/await readBody\(req\)/);
  });

  async function serveOnce(prepare) {
    const server = http.createServer(async (req, res) => {
      await prepare(req);
      res.status = (code) => {
        res.statusCode = code;
        return res;
      };
      res.json = (payload) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(payload));
        return res;
      };
      await handler(req, res);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return server;
  }

  async function postTo(server, raw, signature) {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/stripe-webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', 'stripe-signature': signature },
      body: raw,
    });
    return { status: response.status, body: await response.json() };
  }

  it('verifies on a real HTTP request with no helpers', async () => {
    const server = await serveOnce(async () => {});
    try {
      const event = sessionEvent();
      const raw = rawBodyOf(event);
      expect(await postTo(server, raw, sign(raw))).toEqual({ status: 200, body: { received: true, stored: true } });
      expect(db.rows).toHaveLength(1);
    } finally {
      server.close();
    }
  });

  it('verifies on a real HTTP request AFTER @vercel/node has read and restored the body, ignoring the parsed req.body', async () => {
    const { streamToBuffer } = await import('@vercel/build-utils');
    // Test-only: evaluates the helper source shipped in node_modules (trusted, local), so the
    // proof runs the package's own code rather than a copy that could drift from it.
    const readBody = new Function(
      'PassThrough',
      'streamToBuffer',
      `${lift('serializeBody')}\n${lift('restoreBody')}\n${lift('readBody')}\nreturn readBody;`,
    )(PassThrough, streamToBuffer);

    let consumedByHelpers = null;
    const server = await serveOnce(async (req) => {
      // What addHelpers does for a request with a content-type: read it all, restore it, and
      // back a lazy `req.body` with the parsed JSON.
      const body = await readBody(req);
      consumedByHelpers = body.toString('utf8');
      Object.defineProperty(req, 'body', { value: JSON.parse(body.toString('utf8')), configurable: true });
    });
    try {
      const raw = rawBodyOf(sessionEvent());
      expect(await postTo(server, raw, sign(raw))).toEqual({ status: 200, body: { received: true, stored: true } });
      expect(consumedByHelpers).toBe(raw);
      expect(db.rows).toHaveLength(1);
      // A wrong signature is still refused on this path.
      expect((await postTo(server, raw, sign(raw, { secret: 'whsec_other' }))).status).toBe(400);
    } finally {
      server.close();
    }
  });

  it('fails closed: a stalled stream times out, a huge one is refused, a missing stream is refused', async () => {
    const stalled = new PassThrough();
    await expect(readRawBody(stalled, { timeoutMs: 20 })).rejects.toMatchObject({ status: 408 });
    const huge = new PassThrough();
    huge.end(Buffer.alloc(2048));
    await expect(readRawBody(huge, { limit: 1024 })).rejects.toMatchObject({ status: 413 });
    await expect(readRawBody({})).rejects.toBeInstanceOf(BodyError);

    const res = createRes();
    await handler(makeReq(Buffer.alloc(300 * 1024, 32), { 'stripe-signature': 't=1,v1=00' }), res);
    expect(res.statusCode).toBe(413);
  });
});

describe('the handler', () => {
  it('answers 405 to anything but POST, and is never cached', async () => {
    const res = createRes();
    await handler(makeReq('', {}, 'GET'), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('refuses every event with 503 while STRIPE_WEBHOOK_SECRET is unset', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
    const res = await post(sessionEvent());
    expect(res.statusCode).toBe(503);
    expect(db.rows).toHaveLength(0);
  });

  it('refuses a bad signature with 400 and stores nothing', async () => {
    const event = sessionEvent();
    const raw = rawBodyOf(event);
    const res = createRes();
    await handler(makeReq(raw, { 'stripe-signature': sign(raw, { secret: 'whsec_nope' }) }), res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid signature' });
    expect(db.calls).toHaveLength(0);

    const stale = createRes();
    await handler(makeReq(raw, { 'stripe-signature': sign(raw, { t: nowSec() - 301 }) }), stale);
    expect(stale.statusCode).toBe(400);
  });

  it('refuses signed bytes that are not JSON, and JSON that is not an event', async () => {
    expect((await post(null, { raw: 'not json' })).statusCode).toBe(400);
    expect((await post(null, { raw: '{"hello":"world"}' })).statusCode).toBe(400);
  });

  it('stores a paid Payment Link session field by field: no email, customer or address', async () => {
    const res = await post(sessionEvent());
    expect(res.statusCode).toBe(200);
    expect(db.rows).toHaveLength(1);
    const [row] = db.rows;
    expect(row).toMatchObject({
      session_id: 'cs_live_a1B2c3',
      payment_intent_id: 'pi_3Cover',
      payment_link_id: 'plink_1Support',
      amount_cents: 1700,
      currency: 'usd',
      paid_at: new Date(1_794_250_000 * 1000).toISOString(),
      livemode: true,
      placement: 'deep-use-prompt',
      recurring: false,
      display_name: 'Dana R.',
    });
    expect(Object.keys(db.calls[0].row).sort()).toEqual(
      ['amount_cents', 'currency', 'display_name', 'event_id', 'livemode', 'paid_at', 'payment_intent_id', 'payment_link_id', 'placement', 'recurring', 'session_id'].sort(),
    );
    const stored = JSON.stringify(db.calls[0].row);
    for (const secret of ['dana@example.com', 'Dana Realname', 'cus_Secret', '60601']) expect(stored).not.toContain(secret);
    expect(db.calls[0].opts).toEqual({ onConflict: 'session_id', ignoreDuplicates: true });
  });

  it('logs nothing from the payload', async () => {
    db.fail = { code: 'XX000', message: 'boom' };
    await post(sessionEvent());
    const logged = JSON.stringify([...console.error.mock.calls, ...console.warn.mock.calls]);
    expect(logged).not.toContain('dana@example.com');
    expect(logged).not.toContain('Dana');
  });

  it('is idempotent: a redelivered event, or a second event for the same session, adds nothing', async () => {
    const event = sessionEvent();
    await post(event);
    await post(event);
    await post(sessionEvent({ type: 'checkout.session.async_payment_succeeded' }));
    expect(db.rows).toHaveLength(1);
  });

  it('stores a delayed-method session when it succeeds, not when it completes unpaid', async () => {
    expect((await post(sessionEvent({ payment_status: 'unpaid' }))).body).toEqual({ received: true, ignored: 'unpaid' });
    expect(db.rows).toHaveLength(0);
    await post(sessionEvent({ type: 'checkout.session.async_payment_succeeded' }));
    expect(db.rows).toHaveLength(1);
  });

  it('ignores sessions that are not from a Payment Link, and event types it does not use', async () => {
    expect((await post(sessionEvent({ payment_link: null }))).body.ignored).toBe('not-a-payment-link');
    expect((await post({ ...sessionEvent(), type: 'customer.created' })).body.ignored).toBe('event-type');
    expect(db.rows).toHaveLength(0);
  });

  it('ignores test-mode events in production, and keeps them (marked) elsewhere', async () => {
    expect((await post(sessionEvent({ livemode: false }))).body).toEqual({ received: true, ignored: 'test-mode' });
    expect(db.rows).toHaveLength(0);
    vi.stubEnv('VERCEL_ENV', 'preview');
    await post(sessionEvent({ livemode: false, sessionId: 'cs_test_x9' }));
    expect(db.rows).toEqual([expect.objectContaining({ session_id: 'cs_test_x9', livemode: false })]);
  });

  it('marks subscriptions recurring and keeps non-USD rows (the reader counts USD only)', async () => {
    await post(sessionEvent({ mode: 'subscription', payment_intent: null, currency: 'EUR', sessionId: 'cs_live_sub' }));
    expect(db.rows[0]).toMatchObject({ recurring: true, currency: 'eur', payment_intent_id: null });
  });

  it('answers 500 when the write fails, so Stripe retries (also before sql/023 is applied)', async () => {
    db.fail = { code: '42P01', message: 'relation "supporter_payments" does not exist' };
    expect((await post(sessionEvent())).statusCode).toBe(500);
    db.fail = { code: '23505', message: 'duplicate key value violates unique constraint' };
    expect((await post(sessionEvent())).statusCode).toBe(200);
  });

  it('refunds only ever raise the refunded amount, matched on the payment intent', async () => {
    await post(sessionEvent({ amount_total: 5000 }));
    await post(refundEvent({ amountRefunded: 2000, refunded: false }));
    expect(db.rows[0]).toMatchObject({ amount_refunded_cents: 2000, refunded: false });
    await post(refundEvent({ amountRefunded: 5000, refunded: true }));
    expect(db.rows[0]).toMatchObject({ amount_refunded_cents: 5000, refunded: true });
    // A late, smaller partial refund arriving after the full one changes nothing.
    const late = await post(refundEvent({ amountRefunded: 2000, refunded: false }));
    expect(late.body).toEqual({ received: true, refunded: 0 });
    expect(db.rows[0]).toMatchObject({ amount_refunded_cents: 5000, refunded: true });
  });

  it('acknowledges a refund for a payment it never stored, and ignores test-mode refunds in production', async () => {
    expect((await post(refundEvent({ amountRefunded: 100, refunded: false, paymentIntent: 'pi_Unknown' }))).body).toEqual({ received: true, refunded: 0 });
    expect((await post(refundEvent({ amountRefunded: 100, refunded: false, livemode: false }))).body.ignored).toBe('test-mode');
  });
});

describe('fields read defensively', () => {
  it('reads the display name from the configured custom field key, default `displayname`', () => {
    expect(DEFAULT_NAME_FIELD_KEY).toBe('displayname');
    const session = sessionEvent().data.object;
    expect(displayNameFromSession(session)).toBe('Dana R.');
    vi.stubEnv('STRIPE_NAME_FIELD_KEY', 'nameonsite');
    expect(displayNameFromSession(session)).toBeNull();
    const renamed = { custom_fields: [{ key: 'nameonsite', type: 'text', text: { value: 'Lee' } }] };
    expect(displayNameFromSession(renamed)).toBe('Lee');
  });

  it('survives odd shapes and caps a long name at 100 characters', () => {
    expect(displayNameFromSession({})).toBeNull();
    expect(displayNameFromSession({ custom_fields: 'nope' })).toBeNull();
    expect(displayNameFromSession({ custom_fields: [{ key: 'displayname', type: 'dropdown', dropdown: { value: 'x' } }] })).toBeNull();
    expect(displayNameFromSession({ custom_fields: [{ key: 'displayname', type: 'text', text: { value: 42 } }] })).toBeNull();
    expect(displayNameFromSession({ custom_fields: [{ key: 'displayname', type: 'text', text: { value: 'é'.repeat(150) } }] })).toHaveLength(100);
  });

  it('stores the client_reference_id supportUrl() sets as the placement, only if it passes the helper\'s rule', () => {
    expect(placementFromSession({ client_reference_id: 'deep-use-prompt' })).toBe('deep-use-prompt');
    const fromLink = new URL(supportUrl('landed-toast')).searchParams.get('client_reference_id');
    expect(placementFromSession({ client_reference_id: fromLink })).toBe('landed-toast');
    for (const bad of ['has spaces', '<b>', 'x'.repeat(41), '', 42, null]) {
      expect(placementFromSession({ client_reference_id: bad })).toBeNull();
    }
    // UTM codes are not on the session; nothing else is read.
    expect(placementFromSession({ metadata: { utm_content: 'about' } })).toBeNull();
    expect(placementFromSession({})).toBeNull();
  });

  it('handleStripeEvent refuses a non-event outright', async () => {
    expect((await handleStripeEvent(null)).status).toBe(400);
    expect((await handleStripeEvent({ id: 'nope', type: 'x' })).status).toBe(400);
  });
});
