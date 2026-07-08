import { describe, it, expect } from 'vitest';
import {
  parseFr24Feed,
  applyFeedResult,
  feedFreshness,
  nextFeedRetryDelay,
  FEED_FRESH_MS,
  FEED_RETRY_DELAYS_MS,
} from '../src/lib/feed-health.js';

// Live-observed degraded body (audit Jul 3 2026): /api/fr24-feed returned a 200 whose
// JSON contained ONLY meta keys and zero aircraft entries.
const META_ONLY_PAYLOAD = { full_count: 22684, version: 4 };

// One healthy FR24 feed entry, index-mapped like the upstream array format:
// [icao24, lat, lon, hdg, alt_ft, spd_kt, squawk, _, acType, reg, _, origin, dest, flightIATA, onGround, vr_fpm, callsign, _, airline]
const HEALTHY_ENTRY = [
  'a1b2c3', 41.97, -87.9, 270, 36000, 450, '1200', null,
  'B739', 'N37462', null, 'ORD', 'SFO', 'UA123', 0, -704, 'UAL123', null, 'UAL',
];

describe('parseFr24Feed', () => {
  it('parses a healthy payload into flight objects with unit conversions', () => {
    const parsed = parseFr24Feed({ full_count: 22684, version: 4, abc123: HEALTHY_ENTRY });
    expect(parsed).toHaveLength(1);
    const f = parsed[0];
    expect(f.fr24id).toBe('abc123');
    expect(f.icao24).toBe('a1b2c3');
    expect(f.callsign).toBe('UAL123');
    expect(f.flightIATA).toBe('UA123');
    expect(f.origin).toBe('ORD');
    expect(f.dest).toBe('SFO');
    expect(f.onGround).toBe(false);
    expect(f.alt).toBeCloseTo(36000 / 3.28084, 3); // feet → meters
    expect(f.spd).toBeCloseTo(450 / 1.944, 3);     // knots → m/s
    expect(f.vr).toBeCloseTo(-704 / 196.85, 3);    // fpm → m/s
    expect(f.squawk).toBe('1200');                 // F016 — squawk read from arr[6], not hardcoded null
  });

  // F016: parser used to hardcode squawk:null, so emergency squawks (7500/7600/7700) could
  // never reach decodeSquawk() in main.js. Verify both the alert codes and the empty case.
  it('parses squawk from index 6, including emergency codes, and nulls it when absent', () => {
    const emergencyEntry = [...HEALTHY_ENTRY];
    emergencyEntry[6] = '7700';
    const parsed = parseFr24Feed({ abc123: emergencyEntry });
    expect(parsed[0].squawk).toBe('7700');

    const noSquawkEntry = [...HEALTHY_ENTRY];
    noSquawkEntry[6] = '';
    expect(parseFr24Feed({ abc123: noSquawkEntry })[0].squawk).toBeNull();

    const nullSquawkEntry = [...HEALTHY_ENTRY];
    nullSquawkEntry[6] = null;
    expect(parseFr24Feed({ abc123: nullSquawkEntry })[0].squawk).toBeNull();
  });

  it('returns [] for the meta-only payload seen live (zero aircraft entries)', () => {
    expect(parseFr24Feed(META_ONLY_PAYLOAD)).toEqual([]);
  });

  it('skips meta keys, non-array values, and entries without a position', () => {
    const parsed = parseFr24Feed({
      full_count: 1,
      version: 4,
      stats: { total: 1 },
      junk: 'not-an-array',
      noPos: ['a1b2c3', 0, 0, 90, 30000, 400, null, null, 'B738', 'N12345', null, 'DEN', 'IAH', 'UA9', 0, 0, 'UAL9', null, 'UAL'],
      good: HEALTHY_ENTRY,
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].fr24id).toBe('good');
  });

  it('returns [] for null / undefined / non-object payloads', () => {
    expect(parseFr24Feed(null)).toEqual([]);
    expect(parseFr24Feed(undefined)).toEqual([]);
    expect(parseFr24Feed('oops')).toEqual([]);
  });
});

describe('applyFeedResult — zero-flight payload treated as failure', () => {
  const prev = [{ fr24id: 'prev1' }, { fr24id: 'prev2' }];

  it('does NOT clobber existing flights when the parse is empty', () => {
    const res = applyFeedResult(prev, []);
    expect(res.ok).toBe(false);
    expect(res.flights).toBe(prev); // same reference — previous data kept verbatim
  });

  it('flags the meta-only payload as a failed fetch end-to-end', () => {
    const res = applyFeedResult(prev, parseFr24Feed(META_ONLY_PAYLOAD));
    expect(res.ok).toBe(false);
    expect(res.flights).toEqual(prev);
  });

  it('commits a non-empty parse', () => {
    const parsed = parseFr24Feed({ abc: HEALTHY_ENTRY });
    const res = applyFeedResult(prev, parsed);
    expect(res.ok).toBe(true);
    expect(res.flights).toBe(parsed);
  });

  it('never returns undefined flights on a cold-load failure (no prior data)', () => {
    expect(applyFeedResult(undefined, []).flights).toEqual([]);
    expect(applyFeedResult(null, parseFr24Feed(META_ONLY_PAYLOAD)).flights).toEqual([]);
  });
});

describe('feedFreshness — chip keyed to payload age, not transport signals', () => {
  it('is LIVE while data is younger than the threshold', () => {
    expect(feedFreshness(0)).toBe('live');
    expect(feedFreshness(12000)).toBe('live');          // the live-observed 12s-old payload
    expect(feedFreshness(FEED_FRESH_MS - 1)).toBe('live');
  });

  it('is STALE at and beyond the threshold', () => {
    expect(feedFreshness(FEED_FRESH_MS)).toBe('stale');
    expect(feedFreshness(FEED_FRESH_MS * 10)).toBe('stale');
  });

  it('is STALE when there is no known last-good feed', () => {
    expect(feedFreshness(Infinity)).toBe('stale');
    expect(feedFreshness(NaN)).toBe('stale');
    expect(feedFreshness(undefined)).toBe('stale');
  });

  it('clamps negative ages (clock skew) to fresh', () => {
    expect(feedFreshness(-5000)).toBe('live');
  });

  it('threshold sits in the sensible 2-3 minute band', () => {
    expect(FEED_FRESH_MS).toBeGreaterThanOrEqual(120000);
    expect(FEED_FRESH_MS).toBeLessThanOrEqual(180000);
  });
});

describe('nextFeedRetryDelay — fast retry with backoff', () => {
  it('starts at ~5s and backs off', () => {
    expect(nextFeedRetryDelay(0)).toBe(5000);
    expect(nextFeedRetryDelay(1)).toBe(10000);
    expect(nextFeedRetryDelay(2)).toBe(20000);
  });

  it('caps at the normal 30s poll interval', () => {
    expect(nextFeedRetryDelay(3)).toBe(30000);
    expect(nextFeedRetryDelay(99)).toBe(30000);
  });

  it('tolerates garbage attempt counts', () => {
    expect(nextFeedRetryDelay(-1)).toBe(FEED_RETRY_DELAYS_MS[0]);
    expect(nextFeedRetryDelay(undefined)).toBe(FEED_RETRY_DELAYS_MS[0]);
  });
});
