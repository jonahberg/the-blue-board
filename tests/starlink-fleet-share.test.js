import { describe, it, expect } from 'vitest';
import fleetDb from '../public/data/fleet.json';
import starlinkLive from '../src/data/starlink-live.json';
import { hubs } from '../src/data/hubs/index.js';
import { STARLINK_FLEET_SHARE_PCT } from '../src/data/starlink-facts.js';
import { starlinkExpressCounts, starlinkFleetSharePct } from '../src/lib/starlink-facts.js';

// Oct 3 2026: seven hub pages said "~24% of the combined fleet", hand-typed, while the live
// roster was 616 of ~1,650 (≈37%). The share is now computed at build from the same roster
// snapshot as the fleet guides' per-type counts. These tests recompute it independently and
// require every hub sentence to print exactly that.

/** Every Starlink share phrase a hub page can carry: "24% of the fleet", "~37% of the combined fleet". */
const SHARE_RE = /(\d+)% of the (?:combined )?fleet/g;

function hubText(hub) {
  return [hub.contentHtml ?? '', ...(hub.faqSchema ?? []).map((f) => f.answer ?? '')].join('\n');
}

describe('build-time Starlink fleet share', () => {
  it('the committed roster carries a plausible Express block from the same snapshot', () => {
    const { express } = starlinkLive.roster;
    expect(Number.isInteger(express.installed)).toBe(true);
    expect(Number.isInteger(express.total)).toBe(true);
    expect(express.total).toBeGreaterThan(0);
    expect(express.installed).toBeLessThanOrEqual(express.total);
  });

  it('is (roster tails inside fleet.json + Express equipped) ÷ (fleet.json + Express fleet)', () => {
    const roster = new Set(starlinkLive.roster.tails);
    const mainline = fleetDb.filter((a) => roster.has(a.r)).length;
    const { installed, total } = starlinkLive.roster.express;
    const expected = Math.round(((mainline + installed) / (fleetDb.length + total)) * 100);
    expect(STARLINK_FLEET_SHARE_PCT).toBe(expected);
    expect(STARLINK_FLEET_SHARE_PCT).toBeGreaterThan(0);
    expect(STARLINK_FLEET_SHARE_PCT).toBeLessThanOrEqual(100);
  });
});

describe('hub pages print the computed share, never a hand-typed one', () => {
  // A fresh non-global regex: `.test()` on the /g one would carry lastIndex between hubs.
  const withShare = Object.entries(hubs).filter(([, hub]) => new RegExp(SHARE_RE.source).test(hubText(hub)));

  it('the seven hubs that state a share still do', () => {
    expect(withShare.map(([code]) => code).sort()).toEqual(['den', 'ewr', 'iad', 'iah', 'lax', 'ord', 'sfo']);
  });

  it.each(Object.keys(hubs))('%s: every "N% of the fleet" is the computed share', (code) => {
    const text = hubText(hubs[code]);
    for (const m of text.matchAll(SHARE_RE)) {
      expect(Number(m[1]), m[0]).toBe(STARLINK_FLEET_SHARE_PCT);
      expect(m[0]).toContain('combined fleet');
    }
    expect(text).not.toMatch(/\$\{|NaN|undefined%/);
  });
});

describe('starlinkExpressCounts', () => {
  it('reads fleetStats.express from the upstream /api/data payload', () => {
    expect(starlinkExpressCounts({ fleetStats: { express: { total: 513, starlink: 353, unverified: 2 } } }))
      .toEqual({ installed: 353, total: 513 });
  });

  it('is null for a missing or implausible block', () => {
    expect(starlinkExpressCounts({})).toBeNull();
    expect(starlinkExpressCounts({ fleetStats: { express: { total: 0, starlink: 0 } } })).toBeNull();
    expect(starlinkExpressCounts({ fleetStats: { express: { total: 10, starlink: 11 } } })).toBeNull();
    expect(starlinkExpressCounts({ fleetStats: { express: { total: '513', starlink: 3.5 } } })).toBeNull();
  });
});

describe('starlinkFleetSharePct', () => {
  const DB = [{ r: 'N1' }, { r: 'N2' }, { r: 'N3' }, { r: 'N4' }];

  it("uses the fleet database as the mainline population and ignores roster tails outside it", () => {
    // (1 mainline in the DB + 3 Express) ÷ (4 + 6) = 40 %; N9 is not in the database.
    expect(starlinkFleetSharePct(DB, ['n1', 'N9'], { installed: 3, total: 6 })).toBe(40);
  });

  it('is null without an Express denominator or a fleet database', () => {
    expect(starlinkFleetSharePct(DB, ['N1'], null)).toBeNull();
    expect(starlinkFleetSharePct(DB, ['N1'], { installed: 0, total: 0 })).toBeNull();
    expect(starlinkFleetSharePct([], ['N1'], { installed: 1, total: 2 })).toBeNull();
  });
});
