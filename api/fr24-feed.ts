import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';
import { CacheStore } from './_cache.js';
import { waitUntil } from '@vercel/functions';
import { parseFr24Feed, FEED_FRESH_MS } from '../src/lib/feed-health.js';
import { recordFeedSightings } from './_reg-sightings.js';

const isRateLimited = createRateLimiter('fr24-feed', 30);

const feedCache = new CacheStore('fr24-feed', { maxSize: 1, defaultTTL: 15_000 });
const feedFetching = new Map<string, Promise<any>>();

class EmptyFeedError extends Error {
  constructor() { super('Upstream returned empty feed'); this.name = 'EmptyFeedError'; }
}

const FR24_UPSTREAM_TIMEOUT_MS = 15_000;

// Wall-clock budget for ALL upstream work in one invocation, retry included. vercel.json caps this
// function at maxDuration: 30, and the platform kill lands BEFORE our catch runs — so an invocation
// that spends the whole 30s upstream never reaches the stale-serve fallback, which is exactly the
// slowest failure mode stale-serve exists for (a slow empty 200 + a hung retry is ~30.4s of naive
// per-attempt timeouts). Every attempt is clamped to what is left of this deadline, and the retry is
// skipped outright when it cannot fit, leaving ~5s for the catch, JSON serialization and teardown.
const FR24_UPSTREAM_DEADLINE_MS = 25_000;

// Gap between the two upstream attempts. FR24's empty responses are served fast (they are not
// timeouts), so a short pause is enough to land on a different upstream shard/refresh tick.
// Overridable via FR24_EMPTY_RETRY_DELAY_MS so tests can zero it instead of burning real seconds.
const FR24_EMPTY_RETRY_DELAY_DEFAULT_MS = 400;

// Last successful UNITED payload, kept so a failing upstream can be papered over with a
// recent-but-real feed instead of a 503 that blanks nothing but still counts as an outage.
//
// A single slot, not a map keyed by the request's `airline`: this endpoint is unauthenticated and
// that param is caller-controlled, so a per-airline store (however carefully LRU'd) hands anyone a
// free way to disarm the fallback — eight curl requests with other real ICAO codes recency-evict
// UAL, and the next real outage 503s the dashboard. Every product consumer asks for UAL
// (src/dashboard/main.js, public/js/hub-live-data.js, public/js/newark-live.js), so the one payload
// worth remembering is the one nobody can name their way out of.
let lastGoodUal: { payload: any; at: number } | null = null;

// Shared parsing for this handler's numeric env knobs. A DEFINED-BUT-BLANK variable (Vercel stores
// an empty string when an env row exists with no value) must read as UNSET: Number('') is 0, which
// on the stale-serve knob would silently arm the kill switch on a deploy nobody meant to change.
// An explicit '0' is still honoured as 0; garbage and negatives fall back to the default.
function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const configured = Number(raw);
  return Number.isFinite(configured) && configured >= 0 ? configured : fallback;
}

// How old a last-known-good payload may be and still be served as a 200. The default IS the client's
// own FEED_FRESH_MS (src/lib/feed-health.js), imported rather than re-typed so the two can never
// drift: the LIVE/STALE chip is keyed to payload age, so a payload inside that window is exactly
// what the client would still be calling "live" if its own last poll had succeeded. An explicit 0
// disables stale-serve (operator wants hard failures).
//
// CLAMPED to that same FEED_FRESH_MS, because the knob only ever moves in the dangerous direction:
// an operator reaching for it during an outage would type something like 3600000, and hour-old
// positions served as a clean 200 are not just a lying LIVE chip — the client stamps that payload
// into the reg-sightings ledger as a fresh flight→tail sighting. The env var can therefore only
// TIGHTEN the ceiling (0 = kill switch, still honoured), never loosen it.
function getStaleServeMaxMs(): number {
  return Math.min(envMs('FR24_FEED_STALE_SERVE_MAX_MS', FEED_FRESH_MS), FEED_FRESH_MS);
}

function getEmptyRetryDelayMs(): number {
  return envMs('FR24_EMPTY_RETRY_DELAY_MS', FR24_EMPTY_RETRY_DELAY_DEFAULT_MS);
}

/**
 * Test helper: clear every module-level feed store so one test's payloads cannot leak into the next
 * (repo convention: __resetRateLimitersForTests, __resetAdbSpendForTests). Without it, test files
 * have to encode "which airline codes are still cold" as declaration order. Production never calls it.
 */
export function __resetFeedStateForTests(): void {
  lastGoodUal = null;
  feedCache.clear();
  feedFetching.clear();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin = req.headers?.origin || '';
  if (origin && origin !== 'https://theblueboard.co' && !/^http:\/\/localhost(:\d+)?$/.test(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (isRateLimited(req)) {
    return res.status(429).json({ error: 'Rate limited — try again shortly' });
  }

  // Normalize BEFORE the regex: a repeated query param (?airline=a&airline=b) arrives as a string[],
  // and a bare `?airline` can arrive as ''/true depending on the parser. Since this block now sits
  // OUTSIDE the try (see below), a non-string reaching .test()/.toUpperCase() would surface as an
  // unhandled 500 instead of the intended 400 — a crafted query must not be able to crash the route.
  const rawAirline = req.query?.airline as unknown;
  const airlineParam = Array.isArray(rawAirline) ? rawAirline[0] : rawAirline;
  const airline = typeof airlineParam === 'string' && airlineParam ? airlineParam : 'UAL';
  // Validate airline: 2-4 letter ICAO code. Validation + cacheKey live ABOVE the try so the catch
  // can look up this airline's last-known-good payload; an invalid code has no feed to fall back
  // to and keeps its plain 400.
  if (!/^[A-Z0-9]{2,4}$/i.test(airline)) {
    return res.status(400).json({ error: 'Invalid airline code' });
  }

  const normalizedAirline = airline.toUpperCase();
  const cacheKey = `feed:${normalizedAirline}`;
  // Every resilience mechanism below (fresh cache, last-known-good, stale-serve, the empty-feed
  // retry) is UNITED-ONLY. The endpoint still answers any validated code for compatibility, but a
  // caller-controlled key must never occupy or evict the state real users depend on: feedCache holds
  // exactly one entry, so alternating codes would thrash it into uselessness, and a per-airline
  // last-known-good store is evictable by anyone with curl. Non-UAL requests are therefore
  // rate-limited, validated pass-throughs — no cache read, no cache write, no stale fallback. That
  // costs them nothing real: "an empty feed is never truth" is a claim about United specifically, so
  // for any other code an empty sky can be the honest answer and a 5xx the honest failure.
  const isUal = normalizedAirline === 'UAL';

  try {
    // Return cached if fresh
    const hit = isUal ? feedCache.get(cacheKey) : null;
    if (hit) {
      res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
      return res.status(200).json(hit);
    }

    // Dedup: if already fetching, wait for that. This one DOES stay per-airline — it holds only
    // promises for requests currently in flight and deletes itself in a finally, so it can neither
    // grow unbounded nor evict anything; sharing a concurrent fetch is pure upstream-amplification
    // relief, which matters most for exactly the caller-supplied codes that get no caching.
    const inFlight = feedFetching.get(cacheKey);
    if (inFlight) {
      const data = await inFlight;
      res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
      return res.status(200).json(data);
    }

    // One upstream attempt, with its OWN controller/timeout — a retried attempt must never inherit
    // the first attempt's already-armed (or already-fired) abort signal.
    const fetchUpstreamOnce = async (deadline: number) => {
      const controller = new AbortController();
      // Clamp each attempt to whatever is left of the invocation budget, never just its own 15s:
      // two naive 15s attempts overshoot maxDuration and the platform kills us before the catch
      // can stale-serve. The 2s floor keeps a nearly-spent budget making a real (if brief) attempt
      // rather than aborting on arrival.
      const attemptTimeoutMs = Math.max(2000, Math.min(FR24_UPSTREAM_TIMEOUT_MS, deadline - Date.now()));
      const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
      try {
        const upstream = await fetch(`https://data-cloud.flightradar24.com/zones/fcgi/feed.js?airline=${encodeURIComponent(normalizedAirline)}`, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'TheBlueBoardDashboard/1.0 (https://theblueboard.co)',
            'Accept': 'application/json'
          }
        });
        if (!upstream.ok) {
          // Drain before discarding: an undrained body keeps its socket checked out of the agent
          // pool until GC, and this branch is the one that fires in bursts (sustained upstream 5xx).
          // Same reason the AeroDataBox fetcher reads the body on its !ok path.
          await upstream.text().catch(() => '');
          throw new Error('Upstream service unavailable');
        }
        return await upstream.json();
      } finally {
        clearTimeout(timeout);
      }
    };

    const doFetch = async () => {
      // The feed occasionally 200s with a meta-only body ({full_count, version} and zero
      // aircraft entries). Caching/serving that as success wipes the client's map and boards
      // ("NO DATA" cold-load bug, Jul 3 2026 audit). United always has aircraft airborne, so an
      // empty feed is an upstream glitch, never truth — surface it as an error so the client's
      // failure/retry path handles it and CDN/browser caches never store the empty body.
      //
      // Retry once before giving up: an Aug 4 2026 probe of the upstream (12 sequential fetches:
      // 708, 0, 0, 706, 708, 0, 0, 0, 0, 0, 712, 0) shows the empties are a fast upstream glitch,
      // and a single re-ask recovers whenever the streak is only one deep. Streaks of 2-5 are
      // common though, which is why the retry alone is not the fix — the catch's last-known-good
      // fallback is (this pass turned ~20% of requests into 503s, Jul 3 → Aug 4 2026).
      //
      // "Empty" is decided by the CLIENT's own parseFr24Feed, not by counting array-valued keys.
      // The two disagree on a degraded payload of aircraft entries with null positions: key-counting
      // calls that a success, so it would be cached, written to the last-known-good slot and then
      // stale-served for the next three minutes — while every client that receives it parses zero
      // flights and renders NO DATA. A permanent lie is strictly worse than the 503 this guard was
      // built to raise, so the server's success predicate has to be the client's.
      const deadline = Date.now() + FR24_UPSTREAM_DEADLINE_MS;
      let payload = await fetchUpstreamOnce(deadline);
      let parsed = parseFr24Feed(payload);
      if (parsed.length === 0) {
        const retryDelayMs = getEmptyRetryDelayMs();
        // The retry is UNITED-ONLY. "Empty is never truth" is a claim about UA specifically (always
        // hundreds airborne); for any other caller-supplied code an empty feed may be the honest
        // answer, and re-asking would just double the upstream amplification an attacker gets for
        // free from the open `airline` param. Also skip it when the remaining budget cannot hold the
        // pause plus a meaningful attempt — better to fall to stale-serve than be killed mid-retry.
        const canRetry = isUal && (deadline - Date.now()) >= retryDelayMs + 2000;
        if (!canRetry) throw new EmptyFeedError();
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        payload = await fetchUpstreamOnce(deadline);
        parsed = parseFr24Feed(payload);
        if (parsed.length === 0) throw new EmptyFeedError();
      }
      // Phase 2: harvest flight→tail sightings from every FRESH feed fetch (cache hits carry
      // nothing new). Throttled inside recordFeedSightings (≤1 upsert/min/instance) and
      // fire-and-forget — sighting capture must never delay or fail the feed serve. Reuses the
      // parse above rather than re-parsing ~700 aircraft a second time.
      const sightingsTask = recordFeedSightings(parsed);
      try { waitUntil(sightingsTask); } catch { /* waitUntil unavailable (local dev) — promise still runs best-effort */ }
      return payload;
    };

    try {
      const inFlightRequest = doFetch();
      feedFetching.set(cacheKey, inFlightRequest);
      const data = await inFlightRequest;
      if (isUal) {
        feedCache.set(cacheKey, data);
        lastGoodUal = { payload: data, at: Date.now() };
      }
      res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=30');
      return res.status(200).json(data);
    } finally {
      feedFetching.delete(cacheKey);
    }
  } catch (e: any) {
    // Bounded stale-serve, ahead of every error response. Whatever the failure mode (empty feed,
    // upstream timeout, upstream 5xx), a real payload from ≤3 min ago beats an error the client can
    // only answer by holding the SAME payload it already has — 1,062 of ~5,200 requests/24h were
    // 503ing this way (Aug 4 2026). The ceiling is the client's own FEED_FRESH_MS, so the LIVE chip
    // can never overclaim by more than one fresh-window. Deliberately NOT feedCache.set: caching
    // this would restart the 15s fresh window on old data and stop us from re-trying upstream on
    // the next poll. UAL-only, for the reason spelled out at `isUal` above.
    const lastGood = isUal ? lastGoodUal : null;
    const staleServeMaxMs = getStaleServeMaxMs();
    if (lastGood && staleServeMaxMs > 0) {
      const ageMs = Math.max(0, Date.now() - lastGood.at);
      if (ageMs <= staleServeMaxMs) {
        const ageSec = Math.round(ageMs / 1000);
        // warn, not error: from the caller's side this request SUCCEEDED. Logging it at error level
        // (as this path originally did) leaves the error feed unable to tell a real outage from one
        // absorbed by stale-serve — and shrinking the first number is the entire point of this pass.
        console.warn(`FR24 feed upstream failed — served last-known-good (${ageSec}s old):`, e?.message || e);
        // Let the CDN share this body for whatever is LEFT of its freshness window, capped at the
        // 15s the fresh path uses. Unconditional no-store made every client in an outage re-ask the
        // origin independently — the stampede the stale body exists to absorb — while an unclamped
        // TTL could let an edge serve a payload past the age the client would still call live.
        // Nothing left → no-store: an expired body must never be cacheable.
        const shareable = Math.max(0, Math.min(15, Math.floor((staleServeMaxMs - ageMs) / 1000)));
        res.setHeader('Cache-Control', shareable > 0 ? `s-maxage=${shareable}` : 'no-store');
        res.setHeader('X-BB-Feed-Stale', String(ageSec));
        return res.status(200).json(lastGood.payload);
      }
    }

    // Past here the request genuinely fails — these are the entries the error feed should count.
    console.error('FR24 feed error:', e);
    if (e.name === 'AbortError') return res.status(504).json({ error: 'Upstream timeout' });
    if (e.name === 'EmptyFeedError') {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ error: 'Upstream returned empty feed' });
    }
    return res.status(502).json({ error: 'Upstream service unavailable' });
  }
}
