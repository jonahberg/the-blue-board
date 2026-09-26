import { describe, it, expect } from 'vitest';

import {
  AGE_CHIP_THRESHOLD_SECONDS,
  MAX_SCHEDULE_RETRIES,
  activeAdvFilterCount,
  advFilterLabel,
  aggCacheKey,
  boardAsOfMs,
  boardLoadMessage,
  completenessSuffix,
  describeBoardCondition,
  formatBoardAsOf,
  hubTzAbbrev,
  retryDelayMs,
  serverClockOffsetSec,
  shouldAutoScroll,
  shouldRetryPartial,
  swapStorageKey,
  swapSummary,
} from '../src/lib/schedule-load.js';

describe('cache + storage keys are the shipped strings', () => {
  it('aggregation cache key', () => {
    expect(aggCacheKey('ORD', 'departures', 1757649600)).toBe('agg-ORD-departures-1757649600');
  });

  it('swap snapshot key uses underscores and a signed day offset', () => {
    expect(swapStorageKey('ORD', 'departures', 0)).toBe('bb_sched_ORD_departures_0');
    expect(swapStorageKey('DEN', 'arrivals', -1)).toBe('bb_sched_DEN_arrivals_-1');
  });
});

describe('retry ladder', () => {
  it('never waits before the first attempt', () => {
    expect(retryDelayMs(0)).toBe(0);
    expect(retryDelayMs(-1)).toBe(0);
  });

  it('doubles then caps at 4 s', () => {
    expect(retryDelayMs(1)).toBe(1000);
    expect(retryDelayMs(2)).toBe(2000);
    expect(retryDelayMs(3)).toBe(4000);
    expect(retryDelayMs(9)).toBe(4000);
  });

  it('retries a partial board that lost pages', () => {
    const result = { partial: true, total: 400, meta: { partialReason: 'page_fetch_failed' } };
    expect(shouldRetryPartial(result, 0)).toBe(true);
    expect(shouldRetryPartial(result, 1)).toBe(true);
  });

  it('stops on the last attempt', () => {
    const result = { partial: true, total: 400, meta: { partialReason: 'page_fetch_failed' } };
    expect(shouldRetryPartial(result, MAX_SCHEDULE_RETRIES - 1)).toBe(false);
  });

  it('does not hammer a first-page outage that returned nothing', () => {
    const result = { partial: true, total: 0, meta: { partialReason: 'first_page_failed' } };
    expect(shouldRetryPartial(result, 0)).toBe(false);
  });

  it('still retries a first-page failure that produced some flights', () => {
    const result = { partial: true, total: 120, meta: { partialReason: 'first_page_failed' } };
    expect(shouldRetryPartial(result, 0)).toBe(true);
  });

  it('never retries a complete board', () => {
    expect(shouldRetryPartial({ partial: false, total: 600 }, 0)).toBe(false);
    expect(shouldRetryPartial(null, 0)).toBe(false);
  });
});

describe('server clock offset', () => {
  it('is the device clock minus (Date + Age)', () => {
    // Server served at t=1000 s, sat 30 s in a CDN cache, device thinks it is t=1100 s.
    const offset = serverClockOffsetSec(1000 * 1000, 30, 1100 * 1000);
    expect(offset).toBe(1100 - 1030);
  });

  it('treats a missing Age as zero', () => {
    expect(serverClockOffsetSec(1000 * 1000, null, 1000 * 1000)).toBe(0);
    expect(serverClockOffsetSec(1000 * 1000, Number.NaN, 1000 * 1000)).toBe(0);
  });

  it('returns null for an unusable Date header so the caller keeps its offset', () => {
    expect(serverClockOffsetSec(Number.NaN, 0)).toBeNull();
    expect(serverClockOffsetSec(0, 0)).toBeNull();
  });
});

describe('board "as of" instant', () => {
  it('prefers meta.generatedAt', () => {
    const generatedAt = '2026-09-13T18:12:00.000Z';
    expect(boardAsOfMs({ generatedAt }, 1_700_000_000_000)).toBe(Date.parse(generatedAt));
  });

  it('falls back to fetch time minus dataAge', () => {
    expect(boardAsOfMs({ dataAge: 600 }, 1_700_000_000_000)).toBe(1_700_000_000_000 - 600_000);
  });

  it('keeps a dataAge of 0 (a just-written snapshot is still stamped)', () => {
    expect(boardAsOfMs({ dataAge: 0 }, 1_700_000_000_000)).toBe(1_700_000_000_000);
  });

  it('falls back to the fetch time when the meta carries nothing usable', () => {
    expect(boardAsOfMs(null, 1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(boardAsOfMs({ generatedAt: 'not a date' }, 1_700_000_000_000)).toBe(1_700_000_000_000);
  });
});

describe('hub-local formatting', () => {
  it('formats the as-of stamp as h:mm A TZ in the hub zone', () => {
    // 2026-09-13T23:12:00Z is 18:12 in Chicago (CDT).
    const text = formatBoardAsOf(Date.parse('2026-09-13T23:12:00Z'), 'America/Chicago');
    expect(text).toMatch(/^6:12 ?\s?PM\s+CDT$/);
  });

  it('degrades to a local time rather than throwing on a bad zone', () => {
    expect(formatBoardAsOf(Date.parse('2026-09-13T23:12:00Z'), 'Not/AZone')).toMatch(/\d/);
  });

  it('reads a timezone abbreviation', () => {
    expect(hubTzAbbrev('America/Chicago', new Date('2026-09-13T23:12:00Z'))).toBe('CDT');
    expect(hubTzAbbrev('Not/AZone')).toBe('');
  });
});

describe('completeness suffix', () => {
  it('reports what loaded on a partial board', () => {
    expect(completenessSuffix({ partial: true, degraded: false, meta: { completeness: 0.87 } })).toBe(
      ' 87% loaded.',
    );
  });

  it('says "previously loaded" when the board is degraded AND partial', () => {
    expect(completenessSuffix({ partial: true, degraded: true, meta: { completeness: 0.42 } })).toBe(
      ' 42% previously loaded.',
    );
  });

  it('says nothing for a degraded but complete board', () => {
    expect(completenessSuffix({ partial: false, degraded: true, meta: { completeness: 1 } })).toBe('');
  });

  it('is suppressed for actual_only_official', () => {
    expect(
      completenessSuffix({
        partial: true,
        degraded: false,
        meta: { completeness: 0.5, partialReason: 'actual_only_official' },
      }),
    ).toBe('');
  });

  it('is empty when the API sent no completeness', () => {
    expect(completenessSuffix({ partial: true, degraded: false, meta: {} })).toBe('');
  });
});

describe('staleness / degradation ladder', () => {
  const asOf = '7:12 PM CDT';

  it('a clean fresh board shows nothing at all', () => {
    const out = describeBoardCondition({ meta: { dataAge: 60 } }, { asOf });
    expect(out.kind).toBe('none');
    expect(out.message).toBe('');
  });

  it('a clean board past the 600 s threshold shows the muted age chip', () => {
    const out = describeBoardCondition(
      { meta: { dataAge: AGE_CHIP_THRESHOLD_SECONDS + 1 } },
      { asOf },
    );
    expect(out.kind).toBe('age-chip');
    expect(out.message).toBe('data as of 7:12 PM CDT');
    expect(out.tone).toBe('muted');
  });

  it('a degraded board states the absolute time and the consequence', () => {
    const out = describeBoardCondition({ degraded: true, meta: { dataAge: 7200 } }, { asOf });
    expect(out.kind).toBe('banner');
    expect(out.message).toBe(
      'Statuses as of 7:12 PM CDT (2h old) — showing the latest data we have.',
    );
    expect(out.tone).toBe('aging');
    expect(out.icon).toBe('⏳');
  });

  it('a degraded AND partial board says so', () => {
    const out = describeBoardCondition(
      { degraded: true, partial: true, meta: { dataAge: 7200 } },
      { asOf },
    );
    expect(out.message).toContain('partial board, 2h old');
  });

  it('a degraded board with dataAge 0 still renders with age context', () => {
    const out = describeBoardCondition({ degraded: true, meta: { dataAge: 0 } }, { asOf });
    expect(out.message).toContain('just now');
    expect(out.tone).toBe('degraded');
  });

  it('a complete-but-stale board gets the same sentence, not "flights may be missing"', () => {
    const out = describeBoardCondition({ stale: true, meta: { dataAge: 30000 } }, { asOf });
    expect(out.message).toBe(
      'Statuses as of 7:12 PM CDT (8h old) — showing the latest data we have.',
    );
    expect(out.tone).toBe('stale');
    expect(out.icon).toBe('⚠️');
  });

  it('reports live-feed rescue rows', () => {
    const out = describeBoardCondition(
      { partial: true, meta: { liveFeedFallbackAdded: 7 } },
      { asOf },
    );
    expect(out.message).toBe(
      'Added 7 live active flight(s) while the full schedule feed recovers.',
    );
  });

  it('maps every partialReason to its sentence', () => {
    const say = (partialReason, extra = {}) =>
      describeBoardCondition({ partial: true, meta: { partialReason, ...extra } }, { asOf }).message;
    expect(say('live_feed_fallback')).toBe(
      'Showing live active flights while the full schedule feed recovers.',
    );
    expect(say('deadline_exceeded')).toBe('The request timed out before all pages were fetched.');
    expect(say('first_page_failed')).toBe('The upstream data source is not responding.');
    expect(say('actual_only_official')).toBe(
      'Showing same-day actual flight times; scheduled times are unavailable.',
    );
    expect(say('page_fetch_failed', { pagesFailed: 3 })).toBe('3 page(s) failed to load.');
    expect(say('page_fetch_failed')).toBe('Some page(s) failed to load.');
  });

  it('falls back to the generic sentence for an unknown reason', () => {
    const out = describeBoardCondition({ partial: true, meta: { partialReason: 'who_knows' } }, { asOf });
    expect(out.message).toBe('Some flights may be missing.');
    expect(out.tone).toBe('partial');
    expect(out.icon).toBe('⚠️');
  });

  it('never conveys severity by colour alone — every banner carries an icon and words', () => {
    for (const result of [
      { degraded: true, meta: { dataAge: 30000 } },
      { degraded: true, meta: { dataAge: 7200 } },
      { degraded: true, meta: { dataAge: 10 } },
      { partial: true, meta: {} },
    ]) {
      const out = describeBoardCondition(result, { asOf });
      expect(out.icon).not.toBe('');
      expect(out.message.length).toBeGreaterThan(10);
    }
  });
});

describe('cache indicator (legacy main.js:4763)', () => {
  it('names the cache and the raw UA flight count, verbatim', () => {
    expect(boardLoadMessage({ fromCache: true, count: 412 }))
      .toBe('\u26a1 Served from cache \u00b7 412 UA flights');
  });

  it('says nothing for a board that was actually fetched', () => {
    expect(boardLoadMessage({ fromCache: false, count: 412 })).toBe('');
    expect(boardLoadMessage({})).toBe('');
  });

  it('still reports an empty cached board rather than a blank count', () => {
    expect(boardLoadMessage({ fromCache: true, count: 0 }))
      .toBe('\u26a1 Served from cache \u00b7 0 UA flights');
    expect(boardLoadMessage({ fromCache: true }))
      .toBe('\u26a1 Served from cache \u00b7 0 UA flights');
  });
});

describe('advanced filter count + label', () => {
  it('counts each set filter once', () => {
    expect(activeAdvFilterCount({})).toBe(0);
    expect(activeAdvFilterCount(null)).toBe(0);
    expect(activeAdvFilterCount({ status: 'delayed', starlink: 'starlink' })).toBe(2);
    expect(
      activeAdvFilterCount({
        status: 'delayed',
        aircraft: 'B738',
        fleetFamily: '737',
        routeType: 'domestic',
        starlink: 'starlink',
        timeRange: 'morning',
        risk: 'high',
        search: 'ORD',
      }),
    ).toBe(8);
  });

  it('ignores a whitespace-only search', () => {
    expect(activeAdvFilterCount({ search: '   ' })).toBe(0);
    expect(activeAdvFilterCount({ search: 'den' })).toBe(1);
  });

  it('labels the toggle with the active count once anything is set', () => {
    expect(advFilterLabel(0, false)).toBe('Filter: Fleet, Aircraft, Starlink… ▾');
    expect(advFilterLabel(0, true)).toBe('Less Filters ▴');
    expect(advFilterLabel(2, false)).toBe('Filters (2 active) ▾');
    expect(advFilterLabel(2, true)).toBe('Filters (2 active) ▴');
  });
});

describe('equipment-swap summary', () => {
  const impacts = {
    down: [{ cls: 'downgrade', text: 'Smaller cabin' }],
    up: [{ cls: 'upgrade', text: 'Starlink' }],
    flat: [{ cls: 'lateral', text: 'Same config' }],
  };

  it('is null with no swaps', () => {
    expect(swapSummary([], () => [])).toBeNull();
    expect(swapSummary(null, () => [])).toBeNull();
  });

  it('counts upgrades and downgrades, and pluralises', () => {
    const swaps = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const out = swapSummary(swaps, (s) =>
      s.id === 'a' ? impacts.down : s.id === 'b' ? impacts.up : impacts.flat,
    );
    expect(out).toMatchObject({ total: 3, upgrades: 1, downgrades: 1 });
    expect(out.text).toBe('3 equipment swaps detected');
  });

  it('uses the singular for one swap', () => {
    expect(swapSummary([{ id: 'a' }], () => impacts.up).text).toBe('1 equipment swap detected');
  });

  it('counts a downgrade even when the same swap also upgrades something', () => {
    const out = swapSummary([{ id: 'a' }], () => [...impacts.down, ...impacts.up]);
    expect(out).toMatchObject({ downgrades: 1, upgrades: 0 });
  });
});

describe('board-scoped NOW autoscroll', () => {
  it('fires for the board the signal names', () => {
    expect(shouldAutoScroll({ key: 'ORD-departures-0', n: 1 }, 'ORD-departures-0', 0)).toBe(true);
  });

  it('does NOT fire for a different board', () => {
    // A load the viewer navigated away from still completes and still raises a signal.
    // Without the key on it, that straggler would yank whatever board they ARE reading
    // down to its NOW line — the page fighting the viewer.
    expect(shouldAutoScroll({ key: 'DEN-departures-0', n: 1 }, 'ORD-departures-0', 0)).toBe(false);
    expect(shouldAutoScroll({ key: 'ORD-arrivals-0', n: 1 }, 'ORD-departures-0', 0)).toBe(false);
    expect(shouldAutoScroll({ key: 'ORD-departures--1', n: 1 }, 'ORD-departures-0', 0)).toBe(false);
  });

  it('fires once per signal', () => {
    expect(shouldAutoScroll({ key: 'ORD-departures-0', n: 3 }, 'ORD-departures-0', 3)).toBe(false);
    expect(shouldAutoScroll({ key: 'ORD-departures-0', n: 4 }, 'ORD-departures-0', 3)).toBe(true);
  });

  it('is inert with no signal yet', () => {
    expect(shouldAutoScroll(null, 'ORD-departures-0', 0)).toBe(false);
    expect(shouldAutoScroll({ key: '', n: 1 }, 'ORD-departures-0', 0)).toBe(false);
    expect(shouldAutoScroll({ key: 'ORD-departures-0', n: 0 }, 'ORD-departures-0', 0)).toBe(false);
  });
});
