// Shared cron authorization: timing-safe Bearer comparison against CRON_SECRET that fails
// CLOSED when the secret is unset. A plain `auth !== `Bearer ${process.env.CRON_SECRET}``
// with the env var missing compares against the literal string "Bearer undefined" — a
// guessable constant that authenticates anyone. Used by the cron handlers and by
// /api/schedule's forceRefresh gate.

import { timingSafeEqual } from 'node:crypto';

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** True only when CRON_SECRET is configured AND the authorization header matches it. */
export function isAuthorizedCronRequest(req: { headers?: Record<string, string | string[] | undefined> }): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const raw = req.headers?.authorization;
  const auth = Array.isArray(raw) ? raw[0] || '' : raw || '';
  return timingSafeEqualStr(auth, `Bearer ${secret}`);
}
