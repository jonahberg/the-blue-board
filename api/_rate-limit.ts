// Shared IP-based rate limiter for API endpoints
// In-memory Map with periodic TTL cleanup

interface MinimalRequest {
  headers?: Record<string, string | string[] | undefined>;
}

const stores = new Map<string, Map<string, number[]>>();
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 300_000; // 5 minutes

function getClientIp(req: MinimalRequest): string {
  // Prefer x-real-ip (set by Vercel edge, not spoofable) over x-forwarded-for
  const realIp = req.headers?.['x-real-ip'];
  if (realIp) return Array.isArray(realIp) ? realIp[0] : realIp;
  const xff = req.headers?.['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : (typeof xff === 'string' ? xff : '');
  return raw.split(',')[0]?.trim() || 'unknown';
}

/**
 * Create a rate limiter for an endpoint.
 * @param name - Endpoint name (for separate stores)
 * @param maxPerMinute - Max requests per IP per 60s window
 * @returns Returns true if rate limited
 */
export function createRateLimiter(name: string, maxPerMinute: number = 60): (req: MinimalRequest) => boolean {
  if (!stores.has(name)) stores.set(name, new Map());

  return function isRateLimited(req: MinimalRequest): boolean {
    const now = Date.now();
    const store = stores.get(name)!;
    const ip = getClientIp(req);

    if (!store.has(ip)) store.set(ip, []);
    const log = store.get(ip)!;

    // Evict entries older than 60s
    while (log.length && log[0] < now - 60_000) log.shift();

    if (log.length >= maxPerMinute) return true;
    log.push(now);

    // Periodic cleanup: remove stale IPs across all stores
    if (now - lastCleanup > CLEANUP_INTERVAL) {
      lastCleanup = now;
      for (const [, s] of stores) {
        for (const [k, v] of s) {
          while (v.length && v[0] < now - 60_000) v.shift();
          if (!v.length) s.delete(k);
        }
      }
    }

    return false;
  };
}

/**
 * Test helper: clear all in-memory rate-limit state. Without this, every test request shares the
 * same `unknown` IP bucket and the per-60s window accumulates across a suite run, intermittently
 * tipping later tests into a spurious 429. Production never calls this.
 */
export function __resetRateLimitersForTests(): void {
  // Clear each named store's per-IP buckets, but keep the store entries themselves — the limiter
  // closure captured by createRateLimiter does `stores.get(name)!` and assumes the entry exists.
  for (const [, store] of stores) store.clear();
}
