// @vitest-environment jsdom
/**
 * The flight detail panel.
 *
 * F20 (Sep 2026 audit): on a phone every "View on map" / "Track" / "Centre map" centred the map
 * and then opened this panel full-screen on top of it (at 768px the 448px right panel covered
 * the centred plane). Below 1024px it is now a bottom sheet that peeks at 40dvh, leaving the
 * map's centre visible; it expands on request and drops back to the peek on "Centre map".
 * F10/F71: an unmatched 787-9 was labelled "likely United Express".
 * F11: times are labelled in the airport's zone even when the payload carries none.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Flight } from '../src/app/data/types';

const h = vi.hoisted(() => ({
  focusOn: vi.fn(),
  times: null as unknown,
}));

const ui = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock('../src/app/state/ui', () => ({ useUi: () => ui }));
const feed = vi.hoisted(() => ({ flights: [] as unknown[] }));
vi.mock('../src/app/state/feed', () => ({ useFeed: () => feed }));
const fleet = vi.hoisted(() => ({
  fleetByReg: {},
  starlink: { tails: new Set<string>() },
  special: new Map(),
  loading: false,
}));
vi.mock('../src/app/state/fleet', () => ({ useFleet: () => fleet }));
const watch = vi.hoisted(() => ({ isWatched: () => false, toggle: () => true }));
vi.mock('../src/app/state/watch', () => ({ useWatch: () => watch }));
vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchFlightTimes: async () => h.times,
}));

import { FlightSheet } from '../src/app/features/FlightSheet';

function flight(overrides: Partial<Flight> = {}): Flight {
  return {
    fr24id: '3c9a77d0', icao24: 'a0b7c4', lat: 40.91, lon: -104.62, hdg: 262, alt: 11278,
    spd: 240, vr: 0, squawk: null, acType: 'A21N', reg: 'N14512', origin: 'ORD', dest: 'SFO',
    flightIATA: 'UA2106', onGround: false, callsign: 'UAL2106', airline: 'UAL',
    ...overrides,
  };
}

/** A phone (390px) or a desktop (1280px) viewport, as matchMedia sees it. */
function viewport(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      matches: width >= min, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    };
  });
}

async function open(f: Flight) {
  Object.assign(ui, {
    selection: { kind: 'flight', flight: f },
    select: () => {},
    focusOn: h.focusOn,
    openAircraft: () => {},
    announce: () => {},
  });
  feed.flights = [f];
  await act(async () => {
    render(<FlightSheet />);
  });
}

const dialog = () => document.querySelector('[data-slot="sheet-content"]') as HTMLElement;

beforeEach(() => {
  h.focusOn.mockReset();
  h.times = { success: false, error: 'No schedule data for this flight today.' };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FlightSheet on a phone (F20)', () => {
  it('opens as a bottom peek that leaves the map centre visible', async () => {
    viewport(390);
    await open(flight());
    expect(dialog().getAttribute('data-side')).toBe('bottom');
    expect(dialog().className).toContain('max-h-[40dvh]');
    expect(dialog().className).not.toMatch(/(^|\s)w-full(\s|$)/);
  });

  it('expands on request and drops back to the peek on "Centre map"', async () => {
    viewport(390);
    await open(flight());
    fireEvent.click(screen.getByRole('button', { name: 'More details' }));
    expect(dialog().className).toContain('max-h-[85dvh]');

    fireEvent.click(screen.getByRole('button', { name: 'Centre map' }));
    expect(h.focusOn).toHaveBeenCalledWith(40.91, -104.62);
    expect(dialog().className).toContain('max-h-[40dvh]');
  });

  it('stays a right-hand panel on a desktop', async () => {
    viewport(1280);
    await open(flight());
    expect(dialog().getAttribute('data-side')).toBe('right');
    expect(screen.queryByRole('button', { name: 'More details' })).toBeNull();
  });
});

describe('FlightSheet aircraft line for a tail missing from the fleet DB (F10/F71)', () => {
  it('a 787-9 is a recent delivery, never "United Express"', async () => {
    viewport(1280);
    await open(flight({ acType: 'B789', reg: 'N71108', flightIATA: 'UA28', origin: 'SIN', dest: 'SFO' }));
    expect(screen.getByText(/N71108 \(not yet in fleet DB \(recent delivery\?\)\)/)).toBeTruthy();
    expect(screen.queryByText(/United Express/)).toBeNull();
  });

  it('a 737 MAX 9 likewise', async () => {
    viewport(1280);
    await open(flight({ acType: 'B39M', reg: 'N17475' }));
    expect(screen.queryByText(/United Express/)).toBeNull();
  });

  it('an E175 is labelled United Express', async () => {
    viewport(1280);
    await open(flight({ acType: 'E75L', reg: 'N612UX' }));
    expect(screen.getByText(/United Express \(regional\)/)).toBeTruthy();
  });
});

describe('FlightSheet times (F11)', () => {
  it('labels an ORD takeoff in Chicago time even when the payload has no tz', async () => {
    viewport(1280);
    h.times = {
      success: true, source: 'fr24', flight: 'UA2106',
      origin: { iata: 'ORD', name: '', terminal: '', gate: '', tz: '' },
      destination: { iata: 'SFO', name: '', terminal: '', gate: '', tz: '' },
      departure: { gate: { scheduled: '', estimated: '', actual: '' }, takeoff: { scheduled: '', estimated: '', actual: '2026-09-27T03:17:53Z' } },
      arrival: { landing: { scheduled: '', estimated: '', actual: '' }, gate: { scheduled: '', estimated: '', actual: '' } },
    };
    await open(flight());
    expect(await screen.findByText('10:17 PM CDT')).toBeTruthy();
    expect(screen.getByText(/Flightradar24 live tracking/)).toBeTruthy();
  });
});
