// @vitest-environment jsdom
/**
 * The Fleet tab rendered against the real fleet helpers (F13, F86, F92, F93).
 *
 *  - `?tab=fleet&filter=starlink` (the hub pages' CTA) lands on a Starlink-filtered table.
 *  - The pulse splits unmatched aircraft into "not in fleet DB" (mainline types under a UAL
 *    callsign) and "regional/partner", and its utilisation is `fleetUtilization()`.
 *  - The Starlink ring and the "Mainline Fleet" chip quote the same percentage.
 *  - The database's age is stated, not "updated daily".
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedValue } from '../src/app/state/feed';
import type { FleetValue } from '../src/app/state/fleet';
import type { UiValue } from '../src/app/state/ui';
import FleetView from '../src/app/views/FleetView';

const ctl = vi.hoisted(() => ({ fleet: null as unknown, flights: [] as unknown[] }));

vi.mock('../src/app/state/fleet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/fleet')>()),
  useFleet: () => ctl.fleet as FleetValue,
}));
vi.mock('../src/app/state/feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/feed')>()),
  useFeed: () => ({ flights: ctl.flights, lastGoodTs: null }) as unknown as FeedValue,
}));
vi.mock('../src/app/state/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/ui')>()),
  useUi: () => ({ openAircraft: () => {}, setTab: () => {} }) as unknown as UiValue,
}));

// 8 mainline airframes, 2 on Starlink; one more Starlink tail the database does not list.
const FLEET_DB = [
  ...Array.from({ length: 6 }, (_, i) => ({ r: `N10${i}UA`, t: 'A319', w: 'Satl Ku', s: '', d: '2000' })),
  { r: 'N37502', t: '737 MAX 9', w: 'Starlink', s: '', d: '2018' },
  { r: 'N37503', t: '737 MAX 9', w: 'Starlink', s: '', d: '2018' },
];
const TAILS = new Set(['N37502', 'N37503', 'N99999']);

const flight = (reg: string, callsign: string, acType: string) => ({
  fr24id: reg + callsign, icao24: '', lat: 0, lon: 0, hdg: 0, alt: 10000, spd: 230, vr: 0,
  squawk: null, acType, reg, origin: 'ORD', dest: 'DEN', flightIATA: '', callsign,
  onGround: false, airline: 'UAL',
});

function fleetValue(stats: unknown = null): FleetValue {
  return {
    fleetDb: FLEET_DB,
    fleetByReg: Object.fromEntries(FLEET_DB.map((a) => [a.r, a])),
    starlink: {
      tails: TAILS,
      flightsByTail: {},
      stats,
      aircraft: [...TAILS].map((tail) => ({ tail, fleet: 'Mainline', type: '737 MAX 9' })),
      lastUpdated: null,
      syncedAt: null,
      degraded: false,
    },
    fleetSummary: null,
    special: new Map(),
    loading: false,
    loadFailed: false,
    retry: () => {},
  } as unknown as FleetValue;
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= vi.fn();
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
});

beforeEach(() => {
  ctl.fleet = fleetValue();
  ctl.flights = [
    flight('N100UA', 'UAL1', 'A319'), // mainline, matched
    flight('N101UA', 'UAL2', 'A319'), // mainline, matched
    flight('N57480', 'UAL2435', 'B39M'), // mainline, missing from the database
    flight('N801SK', 'SKW5501', 'E75L'), // regional
  ];
  window.history.replaceState(null, '', '/');
});

afterEach(cleanup);

describe('FleetView', () => {
  // Verified live on v1.8.3 (231 rows, Status: Starlink) — F13(a) did not reproduce; this pins it.
  it('applies ?filter=starlink from the hub pages', async () => {
    window.history.replaceState(null, '', '/?tab=fleet&filter=starlink');
    render(<FleetView />);
    await waitFor(() => expect(screen.getByText('(2)', { exact: false })).toBeTruthy());
    const rows = document.querySelectorAll('#fleet-lookup-zone tbody tr');
    expect([...rows].map((r) => r.textContent).join(' ')).toContain('N37502');
    expect(rows.length).toBe(2);
  });

  it('splits unmatched airborne aircraft and uses the shared utilisation', () => {
    render(<FleetView />);
    expect(
      screen.getByText('2 mainline matched · 1 not in fleet DB · 1 regional/partner'),
    ).toBeTruthy();
    expect(screen.getByText('25% fleet utilization (2/8)')).toBeTruthy();
  });

  it('shows ONE Starlink share on the ring and the Mainline Fleet chip (tracker stats)', () => {
    ctl.fleet = fleetValue({ total: 3, mainline: 247, mainlineTotal: 1156, express: 0, expressTotal: 0 });
    render(<FleetView />);
    // D15: the tracker's denominator is named, not a bare "(247/1156)" under the DB total.
    expect(screen.getByText('247 of 1,156 mainline aircraft per the Starlink tracker')).toBeTruthy();
    const chip = screen.getByText('Mainline Fleet').parentElement as HTMLElement;
    expect(chip.textContent).toContain('21%');
  });

  it('falls back to the fleet database on both sides of the ratio without tracker stats', () => {
    render(<FleetView />);
    // 2 of the 8 database airframes are on the roster; N99999 is not in the database.
    expect(screen.getByText('2 of 8 aircraft in our fleet database')).toBeTruthy();
  });

  it('states the database age instead of claiming daily updates (F86)', () => {
    render(<FleetView />);
    const lookup = document.getElementById('fleet-lookup-zone') as HTMLElement;
    expect(lookup.textContent).not.toMatch(/updated daily/i);
    expect(lookup.querySelector('time')?.getAttribute('dateTime')).toBe('2026-09-28');
    // Node 24 / current ICU abbreviate September as "Sept" in en-GB; Bun's ICU says "Sep".
    expect(lookup.textContent).toMatch(/as of 28 Sept? 2026/);
  });
});
