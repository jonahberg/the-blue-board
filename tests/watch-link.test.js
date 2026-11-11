// ?watch=UA929 — the flight page's "Watch this flight" link into the dashboard
// (src/lib/watch-link.js). The page builds it and the dashboard reads it with the same module;
// these pin the strict reading and the round trip.
import { describe, expect, it } from 'vitest';

import {
  WATCH_DEP_FUTURE_SEC,
  WATCH_DEP_PAST_SEC,
  parseWatchLink,
  watchLinkHref,
  withoutWatchParams,
} from '../src/lib/watch-link.js';
import { flightPageView } from '../src/lib/flight-page-view.js';
import { D, inAirCase, payloadFor, scheduledCase } from './fixtures/flight-page-fixtures.js';

const NOW_SEC = 1_762_800_000;
const read = (qs) => parseWatchLink(new URLSearchParams(qs), NOW_SEC);

describe('parseWatchLink', () => {
  it('reads a canonical flight, its route and a pinned departure', () => {
    expect(read(`watch=UA929&route=ORD-SFO&dep=${NOW_SEC + 3600}`)).toEqual({ flight: 'UA929', route: 'ORD→SFO', dep: NOW_SEC + 3600 });
    expect(read('watch=ua5103')).toEqual({ flight: 'UA5103', route: '', dep: 0 });
  });

  it('ignores anything that is not a canonical United flight number', () => {
    for (const bad of ['', 'UAL929', '929', 'UA0929', 'UA 929', 'UA12345', 'AA100', 'UA929H', '<script>', 'UA929;DROP']) {
      expect(read(`watch=${encodeURIComponent(bad)}`), bad).toBeNull();
    }
    expect(read('flight=UA929')).toBeNull();
  });

  it('drops a bad route or an implausible departure on its own, keeping the flight', () => {
    expect(read('watch=UA929&route=ORD-ORD').route).toBe('');
    expect(read('watch=UA929&route=ORDSFO').route).toBe('');
    expect(read('watch=UA929&route=O<D-SFO').route).toBe('');
    expect(read(`watch=UA929&dep=${NOW_SEC - WATCH_DEP_PAST_SEC - 1}`).dep).toBe(0);
    expect(read(`watch=UA929&dep=${NOW_SEC + WATCH_DEP_FUTURE_SEC + 1}`).dep).toBe(0);
    expect(read('watch=UA929&dep=1e10').dep).toBe(0);
    expect(read('watch=UA929&dep=-5').dep).toBe(0);
  });
});

describe('watchLinkHref', () => {
  it('opens My Flights on first paint and round-trips through the parser', () => {
    const href = watchLinkHref({ flight: 'UA929', route: 'ORD→SFO', dep: NOW_SEC + 600 });
    expect(href).toBe(`/?watch=UA929&route=ORD-SFO&dep=${NOW_SEC + 600}#myflight`);
    const url = new URL(href, 'https://theblueboard.co');
    expect(url.hash).toBe('#myflight');
    expect(parseWatchLink(url.searchParams, NOW_SEC)).toEqual({ flight: 'UA929', route: 'ORD→SFO', dep: NOW_SEC + 600 });
  });

  it('leaves out a route or departure it does not have', () => {
    expect(watchLinkHref({ flight: 'UA1', route: '', dep: 0 })).toBe('/?watch=UA1#myflight');
  });

  it('is what the flight page links to, pinned to the leg only before it leaves', () => {
    const { row, nowSec } = scheduledCase();
    const view = flightPageView(payloadFor(row), nowSec);
    expect(view.watch).toEqual({ flight: 'UA929', route: 'ORD→LHR', dep: D });
    const link = parseWatchLink(new URL(watchLinkHref(view.watch), 'https://x').searchParams, nowSec);
    expect(link).toEqual({ flight: 'UA929', route: 'ORD→LHR', dep: D });

    // In the air: no pin, so the dashboard's first answer picks the leg (as a fresh eye-button watch does).
    const air = inAirCase();
    expect(flightPageView(payloadFor(air.row), air.nowSec).watch).toEqual({ flight: 'UA929', route: 'ORD→LHR', dep: 0 });
  });
});

describe('withoutWatchParams', () => {
  it('removes watch, route and dep and keeps everything else, hash included', () => {
    expect(withoutWatchParams({ pathname: '/', search: '?utm_source=sms&watch=UA929&route=ORD-SFO&dep=1', hash: '#myflight' }))
      .toBe('/?utm_source=sms#myflight');
    expect(withoutWatchParams({ pathname: '/', search: '?watch=nonsense', hash: '' })).toBe('/');
  });

  it('touches nothing without a ?watch=', () => {
    expect(withoutWatchParams({ pathname: '/', search: '?route=ORD-SFO', hash: '' })).toBeNull();
  });
});
