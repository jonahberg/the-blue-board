/**
 * ONE definition each for "fleet utilization" and "Starlink %" (F8/F67/F92/F93/F101).
 *
 * The Live stat bar (`computeLiveStats`), the Stats card and the Fleet pulse (both
 * `fleetUtilization` over `isAirborne` flights) used three formulas and quoted 25 %, 25 % and
 * 20 % at the same instant. The fixture below is the production mix that made them diverge:
 * an Express E75L, a mainline MAX 9 newer than fleet.json, and one parked aircraft the feed
 * never flagged onGround.
 */
import { describe, expect, it } from 'vitest';

import { matchAircraft } from '../src/lib/fleet-match.js';
import {
  FLEET_DB_AS_OF,
  fleetUtilization,
  formatFleetAsOf,
  starlinkMainlineShare,
  starlinkShareCaption,
} from '../src/lib/fleet-utils.js';
import { computeLiveStats, isAirborne } from '../src/lib/live-stats.js';
import { airborneByTail } from '../src/lib/starlink-view.js';
import { makeIsStarlinkFlight } from '../src/app/views/live/starlink-match.ts';

const FLEET_DB = Array.from({ length: 10 }, (_, i) => ({ r: `N10${i}UA`, t: 'A319' }));
const fleetByReg = Object.fromEntries(FLEET_DB.map((a) => [a.r, a]));
const match = (f) => matchAircraft(f, fleetByReg);

// Live-feed shape: metres and m/s.
const f = (reg, callsign, acType, over = {}) => ({
  reg, callsign, acType, icao24: '', alt: 10000, vr: 0, spd: 230, onGround: false, ...over,
});
const FEED = [
  f('N100UA', 'UAL1', 'A319'),
  f('N101UA', 'UAL2', 'A319'),
  f('N57480', 'UAL2435', 'B39M'), // mainline, not in fleet.json
  f('N801SK', 'SKW5501', 'E75L'), // United Express
  f('N102UA', 'UAL3', 'A319', { alt: 0, spd: 3 }), // parked, onGround not set
];

describe('fleetUtilization — the one definition', () => {
  it('counts matched mainline airframes over the fleet database and splits the rest', () => {
    const airborne = FEED.filter(isAirborne);
    expect(airborne).toHaveLength(4);
    expect(fleetUtilization(airborne, FLEET_DB.length, match)).toEqual({
      matched: 2, notInDb: 1, regional: 1, total: 10, pct: 20,
    });
  });

  it('is null (not 0 %) until the fleet database loads', () => {
    expect(fleetUtilization(FEED, 0, match).pct).toBeNull();
  });

  it('Live bar, Stats card and Fleet pulse quote the same figure for the same feed', () => {
    const live = computeLiveStats(FEED, FEED, FLEET_DB.length, new Set(), {
      matchAircraft: match,
      isFiltered: false,
    });
    // Stats and Fleet both run fleetUtilization over FEED.filter(isAirborne).
    const shared = fleetUtilization(FEED.filter(isAirborne), FLEET_DB.length, match);
    expect(live.utilization).toBe(`${shared.pct}%`);
    expect(live.airborne).toBe(FEED.filter(isAirborne).length);
  });
});

describe('Starlink matching — the one predicate (F101)', () => {
  it('the stat bar, the map predicate and the Starlink tab agree on awkward rows', () => {
    const tails = new Set(['N100UA', 'N37440']);
    const flights = [
      f('N100UA', 'UAL1', 'A319'),
      f('n-37440', 'UAL9', 'B39M'), // hyphenated / lower-case, and not in fleet.json
      f('', 'UAL7', 'A319'), // no reg at all
    ];
    const isStarlink = makeIsStarlinkFlight(tails, fleetByReg);
    const bar = computeLiveStats(flights, flights, FLEET_DB.length, isStarlink, {
      matchAircraft: match,
      isFiltered: false,
    }).starlink;
    const barFromSet = computeLiveStats(flights, flights, FLEET_DB.length, tails, {
      matchAircraft: match,
      isFiltered: false,
    }).starlink;
    const map = flights.filter(isStarlink).length;
    const tab = Object.keys(airborneByTail(flights, isStarlink, (fl) => match(fl)?.r)).length;
    expect([bar, barFromSet, tab]).toEqual([map, map, map]);
    expect(map).toBe(2);
  });
});

describe('starlinkMainlineShare — the one Starlink %', () => {
  it("uses the tracker's own mainline population when it has one", () => {
    expect(
      starlinkMainlineShare({ mainline: 247, mainlineTotal: 1156 }, FLEET_DB, new Set()),
    ).toEqual({ count: 247, total: 1156, pct: 21, source: 'tracker' });
  });

  it('otherwise counts roster tails INSIDE the fleet database, never the whole roster', () => {
    const tails = new Set(['N100UA', 'N101UA', 'N99999']); // N99999 is not in the database
    expect(starlinkMainlineShare(null, FLEET_DB, tails)).toEqual({ count: 2, total: 10, pct: 20, source: 'fleet-db' });
  });

  it('is null before either source has loaded', () => {
    expect(starlinkMainlineShare(null, [], new Set(['N1']))).toBeNull();
    expect(starlinkMainlineShare({ mainline: 5, mainlineTotal: 0 }, [], new Set())).toBeNull();
  });
});

describe('fleet database age (F86)', () => {
  it('is a real date and renders as a day-month-year label in every timezone', () => {
    expect(FLEET_DB_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatFleetAsOf('2026-02-12')).toBe('12 Feb 2026');
  });
});

// D15 (live audit Sep 28 2026): the Fleet card printed "22% (250/1157)" directly under
// "1078 total" — two different denominators, neither labelled.
describe('starlinkShareCaption — the denominator says whose it is', () => {
  it('names the Starlink tracker when its mainline total is the denominator', () => {
    const share = starlinkMainlineShare({ mainline: 250, mainlineTotal: 1157 }, FLEET_DB, new Set());
    expect(share.source).toBe('tracker');
    expect(starlinkShareCaption(share)).toBe('250 of 1,157 mainline aircraft per the Starlink tracker');
  });

  it('names our fleet database when that is the denominator', () => {
    const share = starlinkMainlineShare(null, FLEET_DB, new Set(['N100UA', 'N101UA']));
    expect(share.source).toBe('fleet-db');
    expect(starlinkShareCaption(share)).toBe('2 of 10 aircraft in our fleet database');
  });

  it('is empty without a share', () => {
    expect(starlinkShareCaption(null)).toBe('');
  });
});
