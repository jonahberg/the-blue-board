// One read of the complete United live feed for the server-side consumers (the schedule's
// live-feed rescue, the watch-alerts cron, the warm-schedules sightings backstop). The two FR24
// requests and the merge rule live in src/lib/united-feed.js; api/fr24-feed.ts makes the same two
// requests through its own retry/deadline machinery.
//
// The operator request is best-effort: if it fails, the United payload is returned alone, exactly
// what these readers got before it existed. Only the United request decides success.

import { mergeUnitedFeed, unitedFeedUrls } from '../src/lib/united-feed.js';

/**
 * Operator kill switch for the second request: FR24_EXPRESS_OPERATOR_FEED=0 (or off/false/no)
 * goes back to airline=UAL alone, without a deploy, if FR24 ever objects to the extra read.
 */
export function expressOperatorFeedEnabled(): boolean {
  const v = String(process.env.FR24_EXPRESS_OPERATOR_FEED ?? '').trim().toLowerCase();
  return !(v === '0' || v === 'off' || v === 'false' || v === 'no');
}

const HEADERS = {
  'User-Agent': 'TheBlueBoardDashboard/1.0 (https://theblueboard.co)',
  Accept: 'application/json',
};

async function fetchFeedJson(url: string, timeoutMs: number): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: controller.signal, headers: HEADERS });
    if (!resp.ok) {
      await resp.text().catch(() => '');
      return null;
    }
    return (await resp.json()) as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The merged United feed payload (raw FR24 shape), or null when the United request answered with
 * an HTTP error. Network errors and timeouts on the United request THROW, as a bare fetch did, so
 * each caller keeps its own catch. The operator request never throws.
 */
export async function fetchUnitedFeed(timeoutMs: number): Promise<Record<string, unknown> | null> {
  const urls = unitedFeedUrls();
  const expressTask = expressOperatorFeedEnabled()
    ? fetchFeedJson(urls.express, timeoutMs).catch(() => null)
    : Promise.resolve(null);
  const united = await fetchFeedJson(urls.united, timeoutMs);
  if (!united) return null;
  return mergeUnitedFeed(united, await expressTask).payload;
}
