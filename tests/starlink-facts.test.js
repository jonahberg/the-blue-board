import { describe, it, expect } from 'vitest';
import { starlinkLabel, starlinkAsOf, isPlausibleStarlinkCount } from '../src/lib/starlink-facts.js';
import {
  STARLINK_EQUIPPED_SCOPE as LIB_SCOPE, chooseStarlinkLive, chooseStarlinkRoster, servedStarlinkSyncedAt,
  starlinkCountFromServed, starlinkExpressCountsFromServed, starlinkRosterTailsFromServed,
} from '../src/lib/starlink-facts.js';
import {
  STARLINK_EQUIPPED, STARLINK_EQUIPPED_AS_OF_DAY, STARLINK_EQUIPPED_AS_OF_ISO, STARLINK_EQUIPPED_SCOPE,
  STARLINK_EQUIPPED_SOURCE, STARLINK_MAINLINE_EQUIPPED, STARLINK_BY_TYPE,
} from '../src/data/starlink-facts.js';

describe('starlink-facts helpers', () => {
  it('floors the label to the nearest 25', () => {
    expect(starlinkLabel(513)).toBe('500+');
    expect(starlinkLabel(425)).toBe('425+');
    expect(starlinkLabel(499)).toBe('475+');
    expect(starlinkLabel(1000)).toBe('1000+');
  });

  it('formats the as-of month in UTC', () => {
    expect(starlinkAsOf(new Date('2026-08-11T00:30:00Z'))).toBe('August 2026');
    expect(starlinkAsOf(new Date('2026-12-31T23:59:00Z'))).toBe('December 2026');
  });

  it('accepts only integers between the committed floor and the fleet ceiling', () => {
    expect(isPlausibleStarlinkCount(513, 428)).toBe(true);
    expect(isPlausibleStarlinkCount(428, 428)).toBe(true);
    expect(isPlausibleStarlinkCount(427, 428)).toBe(false); // never go backwards
    expect(isPlausibleStarlinkCount(2501, 428)).toBe(false); // > entire fleet
    expect(isPlausibleStarlinkCount(0, 428)).toBe(false);
    expect(isPlausibleStarlinkCount(undefined, 428)).toBe(false);
    expect(isPlausibleStarlinkCount(513.5, 428)).toBe(false);
  });
});

// Nov 2026: the build's sources in order — tracker, then the site's own snapshot, then the committed
// file — each figure dated by its source (scripts/refresh-starlink-facts.mjs).

const NOW = new Date('2026-11-11T22:00:00Z');
// The shape /api/starlink-data?fields=roster served on Nov 11 2026 (trimmed).
const served = (over = {}) => ({
  aircraft: [
    { tail: 'N12216', fleet: 'Mainline' }, { tail: 'n13248', fleet: 'mainline' }, { tail: 'N103SY', fleet: 'Express' },
  ],
  fleetStats: { total: 681, mainline: 326, express: 355, expressTotal: 513, mainlineTotal: 1168 },
  lastUpdated: '2026-10-27T05:05:51.855Z',
  syncedAt: '2026-11-11T00:00:19.635Z',
  servedFrom: 'supabase-stale',
  ...over,
});

describe('build-time Starlink sources', () => {
  it('reads a served snapshot, and refuses the static fallback or a payload without a sync time', () => {
    expect(servedStarlinkSyncedAt(served())?.toISOString()).toBe('2026-11-11T00:00:19.635Z');
    expect(servedStarlinkSyncedAt(served({ servedFrom: 'static', syncedAt: '' }))).toBeNull();
    expect(servedStarlinkSyncedAt(served({ syncedAt: '' }))).toBeNull();
    expect(starlinkCountFromServed(served())).toBe(681);
    expect(starlinkCountFromServed(served({ servedFrom: 'static' }))).toBeNull();
    expect(starlinkRosterTailsFromServed(served())).toEqual(['N12216', 'N13248']);
    expect(starlinkExpressCountsFromServed(served())).toEqual({ installed: 355, total: 513 });
  });

  it('the tracker first, dated by its own generatedAt', () => {
    const summary = { airlines: [{ code: 'UA', installed: 690 }], generatedAt: '2026-11-11T21:55:00Z' };
    expect(chooseStarlinkLive({ summary, served: served(), committedCount: 602, now: NOW })).toEqual({
      count: 690, label: '675+', asOf: 'November 2026', asOfDate: '2026-11-11T21:55:00.000Z',
      scope: 'mainline + Express', source: 'unitedstarlinktracker.com', fetchedAt: NOW.toISOString(),
    });
  });

  it("dates a tracker count by the fetch when the tracker's generatedAt is missing or more than a day off", () => {
    const stale = { airlines: [{ code: 'UA', installed: 690 }], generatedAt: '2026-10-27T05:05:51Z' };
    expect(chooseStarlinkLive({ summary: stale, committedCount: 602, now: NOW })).toMatchObject({ asOfDate: NOW.toISOString(), asOf: 'November 2026' });
    const none = { airlines: [{ code: 'UA', installed: 690 }] };
    expect(chooseStarlinkLive({ summary: none, committedCount: 602, now: NOW }).asOfDate).toBe(NOW.toISOString());
  });

  it('the snapshot when the tracker is down (Nov 11 2026), dated by its sync, not the build', () => {
    const live = chooseStarlinkLive({ summary: null, served: served(), committedCount: 602, now: NOW });
    expect(live).toMatchObject({ count: 681, label: '675+', asOfDate: '2026-11-11T00:00:19.635Z', source: 'theblueboard.co snapshot' });
    // An implausible tracker answer (below the committed floor) also falls through to the snapshot.
    const low = { airlines: [{ code: 'UA', installed: 500 }] };
    expect(chooseStarlinkLive({ summary: low, served: served(), committedCount: 602, now: NOW }).count).toBe(681);
  });

  it('null (keep the committed file) when neither source is plausible', () => {
    expect(chooseStarlinkLive({ summary: null, served: null, committedCount: 602, now: NOW })).toBeNull();
    expect(chooseStarlinkLive({ summary: null, served: served({ servedFrom: 'static', syncedAt: '' }), committedCount: 602 })).toBeNull();
    expect(chooseStarlinkLive({ summary: null, served: served({ fleetStats: { total: 590 } }), committedCount: 602 })).toBeNull();
  });

  it('the roster: tracker, then the snapshot (with its sync time), else null', () => {
    const upstream = {
      starlinkPlanes: [{ TailNumber: 'N1', fleet: 'mainline' }, { TailNumber: 'N2', fleet: 'mainline' }],
      fleetStats: { express: { starlink: 356, total: 513 } },
    };
    expect(chooseStarlinkRoster({ upstream, served: served(), committedLength: 2, now: NOW })).toEqual({
      syncedAt: NOW.toISOString(), tails: ['N1', 'N2'], express: { installed: 356, total: 513 }, source: 'unitedstarlinktracker.com',
    });
    expect(chooseStarlinkRoster({ upstream: null, served: served(), committedLength: 2, now: NOW })).toEqual({
      syncedAt: '2026-11-11T00:00:19.635Z', tails: ['N12216', 'N13248'], express: { installed: 355, total: 513 }, source: 'theblueboard.co snapshot',
    });
    // A roster under 90% of the committed one is a partial feed, from either source.
    expect(chooseStarlinkRoster({ upstream: null, served: served(), committedLength: 263, now: NOW })).toBeNull();
  });
});

describe('src/data/starlink-facts.js labels', () => {
  it('exposes the scope and a dated as-of for the /fleet tile, from whatever the build wrote', () => {
    expect(STARLINK_EQUIPPED_SCOPE).toBe(LIB_SCOPE);
    expect(STARLINK_EQUIPPED_SCOPE).toBe('mainline + Express');
    expect(Number.isInteger(STARLINK_EQUIPPED)).toBe(true);
    expect(Date.parse(STARLINK_EQUIPPED_AS_OF_ISO)).not.toBeNaN();
    expect(STARLINK_EQUIPPED_AS_OF_DAY).toMatch(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
    expect(['unitedstarlinktracker.com', 'theblueboard.co snapshot']).toContain(STARLINK_EQUIPPED_SOURCE);
  });

  it('the mainline-only count is the sum of the per-type "N of the M", and below the combined count', () => {
    const sum = Object.values(STARLINK_BY_TYPE).reduce((n, r) => n + r.equipped, 0);
    expect(STARLINK_MAINLINE_EQUIPPED).toBe(sum);
    expect(STARLINK_MAINLINE_EQUIPPED).toBeLessThan(STARLINK_EQUIPPED);
  });
});
