// @vitest-environment jsdom
/**
 * F152 — the published deep-link surface (src/app/state/deep-links.ts, inventory §16).
 *
 * Push notifications link to `/?flight=` (api/cron/watch-alerts.ts, public/sw.js), hub pages
 * link to `?tab=irops` / `?tab=schedule&hub=`, and none of that was tested. The hook is
 * driven here exactly as Dashboard.tsx drives it: real URL, spy callbacks, and a `flights`
 * prop that starts empty (cold load, feed not answered) and then fills.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Flight } from '../src/app/data/types';
import { readFleetDeepLinks, resolveDeepLink, useDeepLinks } from '../src/app/state/deep-links';
import { resolveTabParam } from '../src/app/tabs';

/** A parseFr24Feed-shaped flight. */
function flight(flightIATA: string, callsign: string, reg: string): Flight {
  return {
    fr24id: `id-${reg}`, icao24: 'A1B2C3', lat: 41.97, lon: -87.9, hdg: 270, alt: 10668, spd: 231, vr: 0,
    squawk: '2341', acType: 'B39M', reg, origin: 'ORD', dest: 'SFO', flightIATA, onGround: false, callsign, airline: 'UAL',
  } as unknown as Flight;
}

const FEED = [flight('UA123', 'UAL123', 'N37502'), flight('UA2', 'UAL2', 'N27213')];

function makeDeps() {
  return {
    setTab: vi.fn(),
    select: vi.fn(),
    openAircraft: vi.fn(),
    openFr24: vi.fn(),
    setWaitlistOpen: vi.fn(),
    setScheduleHub: vi.fn(),
    announce: vi.fn(),
    addWatch: vi.fn((..._args: [string, string, string, number]) => true),
  };
}
type Deps = ReturnType<typeof makeDeps>;

function Harness({ flights, deps }: { flights: Flight[]; deps: Deps }) {
  useDeepLinks({ flights, ...deps });
  return null;
}

function mountAt(url: string, flights: Flight[] = []) {
  window.history.replaceState(null, '', url);
  const deps = makeDeps();
  const view = render(<Harness flights={flights} deps={deps} />);
  return { deps, rerender: (next: Flight[]) => view.rerender(<Harness flights={next} deps={deps} />) };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('?tab= and #hash', () => {
  it('?tab=schedule selects the Schedule tab', () => {
    const { deps } = mountAt('/?tab=schedule');
    expect(deps.setTab).toHaveBeenCalledWith('schedule', undefined);
  });

  it('?tab=irops lands on Weather scrolled to the IROPS section', () => {
    const { deps } = mountAt('/?tab=irops');
    expect(deps.setTab).toHaveBeenCalledWith('weather', { scrollTo: 'irops-section' });
  });

  it('?tab=irops&hub= still lands on the IROPS section (the hub only picks the board)', () => {
    const { deps } = mountAt('/?tab=irops&hub=den');
    expect(deps.setTab).toHaveBeenCalledWith('weather', { scrollTo: 'irops-section' });
    expect(deps.setScheduleHub).toHaveBeenCalledWith('DEN');
  });

  it('?tab=weather&hub= lands on that hub\'s card; a hub without a card just opens the tab', () => {
    expect(mountAt('/?tab=weather&hub=ewr').deps.setTab).toHaveBeenCalledWith('weather', { scrollTo: 'hub-card-EWR' });
    cleanup();
    expect(mountAt('/?tab=weather&hub=bos').deps.setTab).toHaveBeenCalledWith('weather', undefined);
    cleanup();
    expect(mountAt('/?tab=weather').deps.setTab).toHaveBeenCalledWith('weather', undefined);
  });

  it('?tab=weather&section=nas lands on the NAS status panel', () => {
    const { deps } = mountAt('/?tab=weather&section=nas');
    expect(deps.setTab).toHaveBeenCalledWith('weather', { scrollTo: 'nas-section' });
  });

  it('an unknown ?tab= is ignored', () => {
    const { deps } = mountAt('/?tab=nonsense');
    expect(deps.setTab).not.toHaveBeenCalled();
  });

  it('resolves every published hash, the tab- prefix and the analytics alias', () => {
    for (const id of ['live', 'myflight', 'schedule', 'fleet', 'starlink', 'weather', 'stats', 'sources']) {
      expect(resolveTabParam(`#${id}`)).toBe(id);
    }
    expect(resolveTabParam('#tab-analytics')).toBe('stats');
    expect(resolveTabParam('IROPS')).toBe('weather');
    expect(resolveTabParam('')).toBeNull();
  });

  it('a later hashchange switches tab without rewriting the hash', () => {
    const { deps } = mountAt('/');
    act(() => {
      window.location.hash = '#fleet';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(deps.setTab).toHaveBeenCalledWith('fleet', { hash: false });
  });
});

describe('?hub=, ?view=starlink, ?aircraft=, ?waitlist=1', () => {
  it('?tab=schedule&hub=den selects the DEN board on the Schedule tab', () => {
    const { deps } = mountAt('/?tab=schedule&hub=den');
    expect(deps.setScheduleHub).toHaveBeenCalledWith('DEN');
    expect(deps.setTab).toHaveBeenCalledWith('schedule');
  });

  it('?hub= alone picks the board but does not switch tab', () => {
    const { deps } = mountAt('/?hub=ewr');
    expect(deps.setScheduleHub).toHaveBeenCalledWith('EWR');
    expect(deps.setTab).not.toHaveBeenCalled();
  });

  it('?view=starlink routes to the Starlink tab; fleet sub-views do not route', () => {
    expect(mountAt('/?view=Starlink').deps.setTab).toHaveBeenCalledWith('starlink');
    cleanup();
    expect(mountAt('/?view=airborne').deps.setTab).not.toHaveBeenCalled();
  });

  it('?aircraft= opens the aircraft dialog, upper-cased', () => {
    const { deps } = mountAt('/?aircraft=n37502');
    expect(deps.openAircraft).toHaveBeenCalledWith('N37502');
  });

  it('?waitlist=1 opens the waitlist dialog; other values do not', () => {
    expect(mountAt('/?waitlist=1').deps.setWaitlistOpen).toHaveBeenCalledWith(true);
    cleanup();
    expect(mountAt('/?waitlist=true').deps.setWaitlistOpen).not.toHaveBeenCalled();
  });

  it('applies once on mount and never re-reads the URL', () => {
    const { deps, rerender } = mountAt('/?tab=stats');
    window.history.replaceState(null, '', '/?tab=fleet');
    rerender(FEED);
    expect(deps.setTab).toHaveBeenCalledTimes(1);
    expect(deps.setTab).toHaveBeenCalledWith('stats', undefined);
  });
});

describe('?watch= (the flight page\'s "Watch this flight")', () => {
  it('watches the flight through the store\'s add path, opens My Flights and strips the link', () => {
    const dep = Math.floor(Date.now() / 1000) + 3 * 3600;
    const { deps } = mountAt(`/?utm_source=flight-page&watch=UA929&route=ORD-LHR&dep=${dep}#myflight`);
    expect(deps.addWatch).toHaveBeenCalledTimes(1);
    expect(deps.addWatch).toHaveBeenCalledWith('UA929', 'ORD→LHR', '', dep);
    expect(deps.setTab).toHaveBeenLastCalledWith('myflight');
    expect(deps.announce).toHaveBeenCalledWith('Watching UA929');
    expect(window.location.search).toBe('?utm_source=flight-page');
    expect(window.location.hash).toBe('#myflight');
  });

  it('says so, and still opens My Flights, when the flight is already watched', () => {
    window.history.replaceState(null, '', '/?watch=UA929');
    const deps = makeDeps();
    deps.addWatch.mockReturnValue(false);
    render(<Harness flights={[]} deps={deps} />);
    expect(deps.setTab).toHaveBeenCalledWith('myflight');
    expect(deps.announce).toHaveBeenCalledWith('UA929 is already on your watch list');
  });

  it('ignores a value that is not a canonical flight number, and still clears it from the address', () => {
    for (const bad of ['UAL929', '929', 'UA0929', 'AA100', '%3Cscript%3E', '']) {
      const { deps } = mountAt(`/?watch=${bad}&route=ORD-LHR`);
      expect(deps.addWatch, bad).not.toHaveBeenCalled();
      expect(deps.setTab, bad).not.toHaveBeenCalled();
      expect(deps.announce, bad).not.toHaveBeenCalled();
      expect(window.location.search, bad).toBe('');
      cleanup();
    }
  });

  it('applies once: a later render with the same URL does not add again', () => {
    const { deps, rerender } = mountAt('/?watch=UA1');
    window.history.replaceState(null, '', '/?watch=UA1');
    rerender(FEED);
    expect(deps.addWatch).toHaveBeenCalledTimes(1);
  });
});

describe('?flight= / ?q= (latched until the feed answers)', () => {
  it('waits for a non-empty feed, then selects the airborne flight', () => {
    const { deps, rerender } = mountAt('/?flight=UA123');
    expect(deps.select).not.toHaveBeenCalled();
    expect(deps.openFr24).not.toHaveBeenCalled();

    rerender(FEED);
    expect(deps.select).toHaveBeenCalledTimes(1);
    expect(deps.select.mock.calls[0][0]).toMatchObject({ kind: 'flight', flight: { reg: 'N37502' } });
  });

  it('normalises bare numbers, UAL callsigns and spaces', () => {
    for (const raw of ['123', 'UAL123', 'ua%20123']) {
      const { deps, rerender } = mountAt(`/?flight=${raw}`);
      rerender(FEED);
      expect(deps.select.mock.calls[0]?.[0]?.flight?.flightIATA, raw).toBe('UA123');
      cleanup();
    }
  });

  it('?q= is an alias and a registration also matches', () => {
    const { deps, rerender } = mountAt('/?q=n27213');
    rerender(FEED);
    expect(deps.select.mock.calls[0][0].flight.flightIATA).toBe('UA2');
  });

  it('offers a lookup when the flight is not airborne', () => {
    const { deps, rerender } = mountAt('/?flight=UA9999');
    rerender(FEED);
    expect(deps.select).not.toHaveBeenCalled();
    expect(deps.openFr24).toHaveBeenCalledWith('UA9999');
  });

  it('resolves only once, even as later polls arrive', () => {
    const { deps, rerender } = mountAt('/?flight=UA123');
    rerender(FEED);
    rerender([...FEED]);
    rerender([...FEED]);
    expect(deps.select).toHaveBeenCalledTimes(1);
  });
});

describe('readFleetDeepLinks', () => {
  it('reads ?type= (preferred) or ?filter=, and only the fleet sub-views', () => {
    window.history.replaceState(null, '', '/?type=B39M&filter=starlink&view=special');
    expect(readFleetDeepLinks()).toEqual({ filter: 'B39M', view: 'special' });
    window.history.replaceState(null, '', '/?filter=starlink&view=AIRBORNE');
    expect(readFleetDeepLinks()).toEqual({ filter: 'starlink', view: 'airborne' });
    window.history.replaceState(null, '', '/?view=starlink');
    expect(readFleetDeepLinks()).toEqual({ filter: null, view: null });
  });

  it('reads ?view=express — the United Express sub-view — and does not route on it', () => {
    window.history.replaceState(null, '', '/?tab=fleet&view=Express');
    expect(readFleetDeepLinks()).toEqual({ filter: null, view: 'express' });
    expect(mountAt('/?view=express').deps.setTab).not.toHaveBeenCalled();
  });
});

describe('resolveDeepLink (the brief chips follow the same resolver a cold load uses)', () => {
  it('resolves every chip href shape', () => {
    expect(resolveDeepLink('/?tab=schedule&hub=ord')).toEqual({ tab: 'schedule', scrollTo: null, scheduleHub: 'ORD' });
    expect(resolveDeepLink('/?tab=irops')).toEqual({ tab: 'weather', scrollTo: 'irops-section', scheduleHub: null });
    expect(resolveDeepLink('/?tab=weather&hub=EWR')).toEqual({ tab: 'weather', scrollTo: 'hub-card-EWR', scheduleHub: null });
    expect(resolveDeepLink('/?tab=weather&section=nas')).toEqual({ tab: 'weather', scrollTo: 'nas-section', scheduleHub: null });
    expect(resolveDeepLink('/#live')).toEqual({ tab: 'live', scrollTo: null, scheduleHub: null });
    expect(resolveDeepLink('/#starlink')).toEqual({ tab: 'starlink', scrollTo: null, scheduleHub: null });
    expect(resolveDeepLink('/?nothing=1')).toBeNull();
  });
});
