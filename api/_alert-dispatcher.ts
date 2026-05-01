// Alert dispatcher: sends a notification to a user via web push and/or email.
//
// Used by the risk-monitor cron when a flight crosses the alert threshold.
// Reads push_subscriptions for the user; routes by delivery type:
//   - delivery='push' → web push via VAPID-signed request (web-push lib)
//   - delivery='email' → Resend email (the iOS-non-installer fallback path)
//
// Per Eng Review D3: iOS Safari requires PWA install for push. Users who
// skip install are stored as delivery='email' in push_subscriptions so they
// still get notified.
//
// Failures are isolated per-subscription — a single expired endpoint doesn't
// stop the rest. Failure counts surface in the cron's response for monitoring.

import { getSupabase } from './_supabase.js';

interface PushSubRow {
  endpoint: string;
  keys: { p256dh?: string; auth?: string };
  delivery: 'push' | 'email';
}

export interface AlertPayload {
  userId: string;
  email: string;
  flightNumber: string;
  title: string;
  body: string;
  url: string;
}

export interface DispatchResult {
  pushSent: number;
  emailSent: number;
  failures: number;
}

const FROM_ADDRESS = 'Jonah @ The Blue Board <hello@theblueboard.co>';

let webPushConfigured = false;
async function getWebPush() {
  const wp = (await import('web-push')).default;
  if (!webPushConfigured) {
    const subject = process.env.VAPID_SUBJECT || 'mailto:hello@theblueboard.co';
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (!pub || !priv) {
      throw new Error('VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY missing');
    }
    wp.setVapidDetails(subject, pub, priv);
    webPushConfigured = true;
  }
  return wp;
}

async function sendOnePush(sub: PushSubRow, payload: AlertPayload): Promise<boolean> {
  const wp = await getWebPush();
  const data = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url,
    flight: payload.flightNumber,
  });
  await wp.sendNotification(
    {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh ?? '', auth: sub.keys.auth ?? '' },
    },
    data
  );
  return true;
}

async function sendOneEmail(toAddress: string, payload: AlertPayload): Promise<boolean> {
  if (!toAddress) return false;
  if (!process.env.RESEND_API_KEY) return false;
  const { Resend } = await import('resend');
  const resend = new Resend(process.env.RESEND_API_KEY);
  const html =
    `<p style="font-family:-apple-system,sans-serif;font-size:16px;color:#e0e0e0;background:#0a0e1a;padding:24px;">` +
    `<strong>${escapeHtml(payload.title)}</strong><br><br>` +
    `${escapeHtml(payload.body)}<br><br>` +
    `<a href="${escapeHtml(payload.url)}" style="color:#4a90d9">Open The Blue Board →</a>` +
    `</p>`;
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: toAddress,
    subject: payload.title,
    html,
  });
  return !error;
}

// Email-fallback subscriptions encode the recipient address in the endpoint
// as 'email:foo@bar.com' (see api/pro/push-subscribe.ts). Extract it. This
// keeps the dispatcher decoupled from the auth user table for v1 — the cron
// doesn't have to batch-load auth.users to get email addresses.
function extractEmailFromEndpoint(endpoint: string, fallback: string): string {
  if (endpoint.startsWith('email:')) return endpoint.slice('email:'.length);
  return fallback;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function deleteDeadPushEndpoint(endpoint: string) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', endpoint);
  if (error) {
    console.error('dead push subscription cleanup failed:', error.message);
  }
}

function isDeadPushEndpointError(err: any): boolean {
  return err?.statusCode === 404 || err?.statusCode === 410;
}

export async function dispatchAlert(payload: AlertPayload): Promise<DispatchResult> {
  const supabase = getSupabase();
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('*')
    .eq('user_id', payload.userId);

  if (error) {
    console.error('push_subscriptions lookup failed:', error.message);
    return { pushSent: 0, emailSent: 0, failures: 0 };
  }

  let pushSent = 0;
  let emailSent = 0;
  let failures = 0;

  for (const sub of (subs ?? []) as PushSubRow[]) {
    try {
      if (sub.delivery === 'push') {
        await sendOnePush(sub, payload);
        pushSent++;
      } else if (sub.delivery === 'email') {
        const toAddress = extractEmailFromEndpoint(sub.endpoint, payload.email);
        const ok = await sendOneEmail(toAddress, payload);
        if (ok) emailSent++;
        else failures++;
      }
    } catch (err: any) {
      console.error('alert dispatch failed for endpoint:', sub.endpoint, err.message);
      if (sub.delivery === 'push' && isDeadPushEndpointError(err)) {
        await deleteDeadPushEndpoint(sub.endpoint);
      }
      failures++;
    }
  }

  return { pushSent, emailSent, failures };
}
