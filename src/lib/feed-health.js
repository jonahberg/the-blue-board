// ═══ FR24 LIVE FEED HEALTH ═══
// Pure helpers for the dashboard's live-feed poll loop (src/dashboard/main.js).
//
// Audit Jul 3 2026 (P1: cold-load empty feed → permanent NO DATA): /api/fr24-feed
// occasionally returns a meta-only body ({"full_count":…,"version":…}) with ZERO
// aircraft entries. A 200 with zero UA flights is never legitimate — United always
// has hundreds airborne — so the client must treat it exactly like a 5xx: keep the
// last-good flights, fast-retry, and key the LIVE/STALE chip to actual payload age
// rather than per-response transport signals (x-vercel-cache HIT/STALE was making
// the chip flap every poll while data was seconds old).

/**
 * Parse the raw FR24 feed body into flight objects.
 * Meta keys (full_count / version / stats) and non-array values are skipped;
 * entries without a lat/lon are dropped. Returns [] for meta-only / malformed
 * payloads — the caller must treat that as a FAILED fetch, not an empty sky.
 */
export function parseFr24Feed(data) {
  const parsed = [];
  if (!data || typeof data !== 'object') return parsed;
  for (const [id, arr] of Object.entries(data)) {
    if (id === 'full_count' || id === 'version' || id === 'stats' || !Array.isArray(arr)) continue;
    const f = {
      fr24id: id,
      icao24: arr[0],
      lat: arr[1], lon: arr[2], hdg: arr[3],
      alt: arr[4] ? arr[4] / 3.28084 : 0, // FR24 gives feet, convert to meters for compatibility
      spd: arr[5] ? arr[5] / 1.944 : 0,   // FR24 gives knots, convert to m/s for compatibility
      vr: arr[15] ? arr[15] / 196.85 : 0, // FR24 gives fpm, convert to m/s for compatibility
      // F016: FR24's array carries the transponder squawk at index 6 (a string like "1200" or
      // "7700"); this was hardcoded null, so emergency-squawk alerts (7500/7600/7700) could
      // never fire. Empty/falsy stays null — decodeSquawk() already treats falsy as "no squawk".
      squawk: arr[6] || null,
      acType: arr[8] || '',
      reg: arr[9] || '',
      origin: arr[11] || '',
      dest: arr[12] || '',
      flightIATA: arr[13] || '',
      onGround: arr[14] === 1,
      callsign: arr[16] || '',
      airline: arr[18] || ''
    };
    if (f.lat && f.lon) parsed.push(f);
  }
  return parsed;
}

/**
 * Commit decision for a freshly parsed feed. A zero-flight parse is a FAILURE:
 * the previous flights are kept verbatim (never clobbered by an empty payload).
 * Returns { ok, flights } — ok:false means "schedule a fast retry".
 */
export function applyFeedResult(prevFlights, parsed) {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { ok: false, flights: prevFlights || [] };
  }
  return { ok: true, flights: parsed };
}

/**
 * Freshness threshold for the header chip. Data younger than this is LIVE even
 * if the most recent poll failed — one bad poll against 12-second-old data must
 * not flap the chip to STALE. 3 min ≈ six normal 30s poll cycles.
 */
export const FEED_FRESH_MS = 180000;

/**
 * LIVE/STALE keyed to payload age (ms since the last successfully committed
 * feed), never to transport-level cache headers. Unknown/no prior data → stale.
 */
export function feedFreshness(msSinceLastGood, freshMs = FEED_FRESH_MS) {
  const m = Number(msSinceLastGood);
  if (!Number.isFinite(m)) return 'stale';
  return Math.max(0, m) < freshMs ? 'live' : 'stale';
}

/**
 * Read the server's `X-BB-Feed-Stale` header into milliseconds. /api/fr24-feed sets it
 * (in SECONDS) when it answers a 200 from ITS last-known-good payload because upstream
 * failed — a real body, but already up to FEED_FRESH_MS old. Anything absent, blank,
 * zero, negative, or unparseable means "not a stale-serve" and returns 0, so the poll
 * loop's normal fresh-success path applies unchanged. The caller uses the returned age
 * to backdate lastGoodFeedTs, keeping the LIVE/STALE chip honest about what it is showing.
 */
export function parseStaleHeader(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n * 1000 : 0;
}

/**
 * Fast-retry schedule after a failed/empty poll, separate from the normal 30s
 * cadence: 5s → 10s → 20s, then capped at the normal 30s poll interval.
 */
export const FEED_RETRY_DELAYS_MS = [5000, 10000, 20000, 30000];

export function nextFeedRetryDelay(attempt) {
  const i = Math.min(Math.max(0, Number(attempt) || 0), FEED_RETRY_DELAYS_MS.length - 1);
  return FEED_RETRY_DELAYS_MS[i];
}
