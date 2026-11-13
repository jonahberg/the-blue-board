// The fleet type pages' "in the air right now" strip (src/lib/fleet-live.js), over a real trimmed
// read of the free UAL feed and the real registry. Matching must be by tail: the feed's type
// designator cannot tell a 737-900 from a 737-900ER, or a 777-200 from a 777-200ER.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { airborneOfType, feedFlightIdent, fleetLiveListHref, fleetLiveRowLinks, normalizeTail } from '../src/lib/fleet-live.js';
import { isOnGround } from '../src/lib/flight-phase.js';
import { parseFr24Feed } from '../src/lib/feed-health.js';

const FEED = JSON.parse(readFileSync(resolve(__dirname, 'fixtures', 'ual-feed-2026-10-04-trimmed.json'), 'utf8'));
const FLEET = JSON.parse(readFileSync(resolve(__dirname, '..', 'public', 'data', 'fleet.json'), 'utf8'));
const tailsOf = (type) => FLEET.filter((a) => a.t === type).map((a) => a.r);

/** One FR24 feed row: [hex, lat, lon, track, alt ft, speed kt, squawk, radar, type, reg, ts, from, to, flight, onGround, vs, callsign]. */
const feedRow = ({ reg, type = 'B739', from = 'ORD', to = 'LGA', flight = 'UA1', callsign = 'UAL1', ground = 0, alt = 35000, spd = 450 }) => [
  'A00000', 41.9, -87.9, 90, ground ? 0 : alt, ground ? 0 : spd, '', 'T-KORD1', type, reg, 1791000000, from, to, flight, ground, 0, callsign, 0, 'UAL',
];

describe('airborneOfType', () => {
  it('counts a real feed read by tail, with the dashboard’s airborne rule', () => {
    const tails = tailsOf('787-9');
    const result = airborneOfType(FEED, tails);
    const mine = parseFr24Feed(FEED).filter((f) => tails.includes(f.reg));
    expect(mine.length).toBeGreaterThan(0);
    expect(result.airborne).toBe(mine.filter((f) => !isOnGround(f)).length);
    expect(result.onGround).toBe(mine.filter((f) => isOnGround(f)).length);
    expect(result.flights.length).toBe(Math.min(4, result.airborne));
    for (const f of result.flights) {
      expect(tails).toContain(f.reg);
      expect(f.href).toBe(`/?flight=${f.ident}`);
    }
  });

  it('tells types that share a feed designator apart', () => {
    const feed = {
      full_count: 3,
      a: feedRow({ reg: tailsOf('737-900')[0], type: 'B739', flight: 'UA10' }),
      b: feedRow({ reg: tailsOf('737-900ER')[0], type: 'B739', flight: 'UA20' }),
      c: feedRow({ reg: tailsOf('737-900ER')[1], type: 'B739', flight: 'UA30' }),
    };
    expect(airborneOfType(feed, tailsOf('737-900')).airborne).toBe(1);
    expect(airborneOfType(feed, tailsOf('737-900ER')).airborne).toBe(2);
  });

  it('lists routed flights first, by flight number, and counts a tail once', () => {
    const [t1, t2, t3] = tailsOf('787-9');
    const feed = {
      x: feedRow({ reg: t1, flight: 'UA857', from: 'SFO', to: 'PVG' }),
      y: feedRow({ reg: t2, flight: 'UA14', from: '', to: '' }),
      z: feedRow({ reg: t3, flight: 'UA2', from: 'EWR', to: 'TLV' }),
      dup: feedRow({ reg: t3, flight: 'UA2', from: 'EWR', to: 'TLV' }),
    };
    const result = airborneOfType(feed, tailsOf('787-9'));
    expect(result.airborne).toBe(3);
    expect(result.flights.map((f) => f.ident)).toEqual(['UA2', 'UA857', 'UA14']);
    expect(result.flights[0]).toMatchObject({ origin: 'EWR', dest: 'TLV', reg: t3 });
    // Each row's key is its tail (counted once, so unique in the strip): how a refresh finds the
    // reader's row again whatever its flight number or place in the list.
    expect(result.flights.map((f) => f.key)).toEqual([t3, t1, t2]);
  });

  it('a parked aircraft is on the ground, not airborne', () => {
    const [t1] = tailsOf('A320');
    const result = airborneOfType({ g: feedRow({ reg: t1, ground: 1 }) }, tailsOf('A320'));
    expect(result).toEqual({ airborne: 0, onGround: 1, flights: [] });
  });

  it('an empty or meta-only feed is a failed read (null), never "0 airborne"', () => {
    expect(airborneOfType({ full_count: 0, version: 4 }, tailsOf('787-9'))).toBeNull();
    expect(airborneOfType(null, tailsOf('787-9'))).toBeNull();
  });
});

describe('helpers', () => {
  it('normalizes tails and flight numbers', () => {
    expect(normalizeTail(' n12-345 ')).toBe('N12345');
    expect(feedFlightIdent({ flightIATA: 'ua857' })).toBe('UA857');
    expect(feedFlightIdent({ flightIATA: '', callsign: 'UAL2455' })).toBe('UA2455');
    expect(feedFlightIdent({ flightIATA: '', callsign: 'SKW5432' })).toBe('');
  });

  it('falls back to the tail for the deep link when the feed has no flight number', () => {
    const [t1] = tailsOf('787-9');
    const result = airborneOfType({ a: feedRow({ reg: t1, flight: '', callsign: '' }) }, [t1]);
    expect(result.flights[0].href).toBe(`/?flight=${t1}`);
    // feedRow's default route is ORD → LGA: one hub end.
    expect(result.flights[0].links).toEqual({ ident: null, origin: '/hubs/ord', dest: null, reg: `/?aircraft=${t1}`, map: `/?flight=${t1}` });
  });
});

describe('fleetLiveListHref: where the strip count links', () => {
  it('the Fleet tab on its Airborne list, filtered to the type', () => {
    expect(fleetLiveListHref('737 MAX 9')).toBe('/?tab=fleet&type=737%20MAX%209&view=airborne');
    expect(fleetLiveListHref('787-9')).toBe('/?tab=fleet&type=787-9&view=airborne');
  });
  it('a type with no fleet database code has no list: the count is text', () => {
    expect(fleetLiveListHref('B739')).toBeNull();
    expect(fleetLiveListHref(undefined)).toBeNull();
  });
});

describe('fleetLiveRowLinks: what each name in a strip row links to', () => {
  it('number → flight page, hub ends → hub pages, tail → aircraft dialog, row → live map', () => {
    expect(fleetLiveRowLinks({ ident: 'UA857', origin: 'SFO', dest: 'PVG', reg: 'N2331U' })).toEqual({
      ident: '/flight/UA857',
      origin: '/hubs/sfo',
      dest: null, // Shanghai is not a United hub: text
      reg: '/?aircraft=N2331U',
      map: '/?flight=UA857',
    });
    expect(fleetLiveRowLinks({ ident: 'UA2', origin: 'EWR', dest: 'NRT', reg: 'N12345' })).toMatchObject({ origin: '/hubs/ewr', dest: '/hubs/nrt' });
  });

  it('a number the site has no page for, a missing route and a missing tail print as text', () => {
    expect(fleetLiveRowLinks({ ident: '', origin: '', dest: '', reg: 'N2331U' })).toEqual({
      ident: null, origin: null, dest: null, reg: '/?aircraft=N2331U', map: '/?flight=N2331U',
    });
    expect(fleetLiveRowLinks({ ident: 'UA857H', origin: 'LHR', dest: 'CDG', reg: '' })).toMatchObject({ ident: null, origin: null, dest: null, reg: null });
    // An operating callsign is not widened to a United number here (ruling 4).
    expect(fleetLiveRowLinks({ ident: 'SKW5415', origin: 'DEN', dest: 'ASE', reg: 'N612UX' }).ident).toBeNull();
  });

  it('airborneOfType carries each row its links, and `href` stays the live-map link', () => {
    const [t1] = tailsOf('787-9');
    const result = airborneOfType({ x: feedRow({ reg: t1, flight: 'UA857', from: 'SFO', to: 'PVG' }) }, [t1]);
    expect(result.flights[0].links).toEqual(fleetLiveRowLinks(result.flights[0]));
    expect(result.flights[0].href).toBe(result.flights[0].links.map);
  });
});
