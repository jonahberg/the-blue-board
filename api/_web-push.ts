// Shared Web Push (VAPID) configuration + send helper.
//
// GRACEFUL UNCONFIGURED: the VAPID keys and the WEB_PUSH_CONTACT are OWNER ACTIONS that may not
// exist yet (see docs/setup-push-alerts.md). Every surface must detect the unconfigured state and
// degrade to today's in-tab behaviour, never error. isPushConfigured() is that single detector.

import webpush from 'web-push';
import { endpointHostForLog, isAllowedPushEndpoint } from './_push-endpoint.js';

export function getVapidPublicKey(): string {
  return process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '';
}

/** True only when all three VAPID env vars are present. The public key is public by design. */
export function isPushConfigured(): boolean {
  return Boolean(
    process.env.WEB_PUSH_VAPID_PUBLIC_KEY &&
      process.env.WEB_PUSH_VAPID_PRIVATE_KEY &&
      process.env.WEB_PUSH_CONTACT
  );
}

let vapidReady = false;

/** Configure web-push's VAPID details once. Returns false when unconfigured. */
export function ensureVapidConfigured(): boolean {
  if (!isPushConfigured()) return false;
  if (!vapidReady) {
    const contact = process.env.WEB_PUSH_CONTACT!;
    // web-push requires the subject to be a mailto: or https: URL.
    const subject = /^(mailto:|https:)/i.test(contact) ? contact : `mailto:${contact}`;
    webpush.setVapidDetails(
      subject,
      process.env.WEB_PUSH_VAPID_PUBLIC_KEY!,
      process.env.WEB_PUSH_VAPID_PRIVATE_KEY!
    );
    vapidReady = true;
  }
  return true;
}

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushSendResult {
  ok: boolean;
  /** HTTP status from the push service (0 on transport error). 404/410 mean the sub is dead. */
  statusCode: number;
  gone: boolean;
}

/**
 * Send one push. Never throws — returns a structured result the caller uses to prune dead
 * subscriptions (404/410 → gone). Assumes ensureVapidConfigured() already returned true.
 *
 * An endpoint that is not on a known push service (api/_push-endpoint.ts) is never contacted: a
 * row stored before that allowlist existed must not make the cron POST to an arbitrary URL. It is
 * reported as an ordinary failure (not `gone`), so watch-alerts' failed_count bookkeeping prunes it
 * after a few runs rather than this check deleting rows on its own.
 */
export async function sendPush(target: PushTarget, payload: object): Promise<PushSendResult> {
  if (!isAllowedPushEndpoint(target?.endpoint)) {
    console.warn(`sendPush: skipped an endpoint that is not a known push service (host: ${endpointHostForLog(target?.endpoint)})`);
    return { ok: false, statusCode: 0, gone: false };
  }
  try {
    const res = await webpush.sendNotification(
      { endpoint: target.endpoint, keys: target.keys },
      JSON.stringify(payload),
      { TTL: 3600 }
    );
    return { ok: true, statusCode: res.statusCode || 201, gone: false };
  } catch (e: any) {
    const statusCode = Number(e?.statusCode) || 0;
    return { ok: false, statusCode, gone: statusCode === 404 || statusCode === 410 };
  }
}
