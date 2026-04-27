// Shared cron / deploy-hook authorization helper.
//
// Why timing-safe: the prior pattern (`req.headers.authorization === \`Bearer ${secret}\``)
// short-circuits on the first mismatched byte, leaking secret-prefix length via
// response timing. crypto.timingSafeEqual always takes the same time regardless
// of where the strings differ. Closes TODOs.md item #6.
//
// Length leak: comparing buffer lengths before timingSafeEqual leaks the length
// of the provided value vs the secret. This is acceptable: secret length is
// fixed at deploy time, so length is not a useful signal for an attacker.
// What matters is that the byte-by-byte compare doesn't short-circuit.

import crypto from 'node:crypto';

interface MinimalRequest {
  headers?: Record<string, string | string[] | undefined>;
}

const BEARER_PREFIX = 'Bearer ';

export function isAuthorizedCronRequest(req: MinimalRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const raw = req?.headers?.authorization;
  const headerValue = Array.isArray(raw) ? raw[0] : raw;
  if (typeof headerValue !== 'string') return false;
  if (!headerValue.startsWith(BEARER_PREFIX)) return false;

  const provided = headerValue.slice(BEARER_PREFIX.length);
  const providedBuf = Buffer.from(provided, 'utf8');
  const secretBuf = Buffer.from(secret, 'utf8');

  if (providedBuf.length !== secretBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, secretBuf);
}
