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

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedValue } from '../src/app/state/feed';
import type { FleetValue } from '../src/app/state/fleet';
import type { UiValue } from '../src/app/state/ui';
import FleetView from '../src/app/views/FleetView';

const ctl = vi.hoisted(() => ({ fleet: null as unknown, flights: [] as unknown[], opened: [] as string[] }));

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
  useUi: () => ({ openAircraft: (reg: string) => ctl.opened.push(reg), setTab: () => {} }) as unknown as UiValue,
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
    expressDb: [],
    expressByReg: {},
    expressStatus: 'ready',
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
  ctl.opened = [];
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

  it('shows ONE Starlink share on the ring and the Mainline Fleet chip, over the fleet DB', () => {
    // The tracker's own (larger) mainline census is present but NOT used: the ring's
    // denominator is the database total printed above it.
    ctl.fleet = fleetValue({ total: 3, mainline: 247, mainlineTotal: 1156, express: 0, expressTotal: 0 });
    render(<FleetView />);
    expect(screen.getByText('2 of 8 aircraft in our fleet database')).toBeTruthy();
    expect(screen.queryByText(/1,156/)).toBeNull();
    const chip = screen.getByText('Mainline Fleet').parentElement as HTMLElement;
    expect(chip.textContent).toContain('25%');
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

describe('FleetView — the United Express sub-tab', () => {
  // buildExpressFleet() output: two discovered tails (one on the Starlink roster), one with no type.
  const EXPRESS = [
    { r: 'N140SY', t: 'E175', tk: 'E175SC', o: 'SkyWest Airlines', oc: 'SKW', w: 'Starlink', c: '', fs: '2026-10-01T05:00:00Z', ls: '2026-10-04T18:13:07Z', lf: 'UA6005', x: true },
    { r: 'N14148', t: '', tk: '', o: 'CommutAir', oc: 'UCA', w: '', c: '', fs: '2026-10-01T05:00:00Z', ls: '2026-10-04T18:13:06Z', lf: 'UA4226', x: true },
    { r: 'N85377', t: 'E175', tk: 'E175', o: 'SkyWest Airlines', oc: 'SKW', w: '', c: '', fs: '2026-10-01T06:00:00Z', ls: '2026-10-02T12:00:00Z', lf: 'UA5928', x: true },
  ];

  function withExpress() {
    ctl.fleet = {
      ...(fleetValue() as object),
      expressDb: EXPRESS,
      expressByReg: Object.fromEntries(EXPRESS.map((e) => [e.r, e])),
      expressStatus: 'ready',
    };
  }

  const expressPanel = () => document.querySelector('[role="tabpanel"][data-state="active"]') as HTMLElement;

  it('?view=express opens a separate list; All Aircraft keeps the mainline count', async () => {
    withExpress();
    window.history.replaceState(null, '', '/?tab=fleet&view=express');
    render(<FleetView />);
    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'United Express search' })).toBeTruthy());
    expect(screen.getByRole('tab', { name: /All Aircraft \(8\)/ })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /United Express \(3\)/ })).toBeTruthy();
    expect(screen.getByText('Fleet Overview — 8 Mainline Aircraft')).toBeTruthy();

    const panel = expressPanel();
    expect(panel.textContent).toContain('3 aircraft');
    expect(panel.textContent).toContain('1 Starlink');
    expect(panel.textContent).toContain('SkyWest Airlines 2');
    expect(panel.textContent).toContain('Unknown type 1');
    expect(panel.textContent).toContain('about 3 of ~513 aircraft');
    expect(panel.querySelectorAll('tbody tr')).toHaveLength(3);
    // The mainline filters do not apply here and are not shown.
    expect(screen.queryByRole('searchbox', { name: 'Fleet search' })).toBeNull();
    // No cabin is verified: no Config column of dashes.
    expect(panel.querySelector('thead')?.textContent).not.toContain('Config');
  });

  it('searches, and a registration opens the aircraft dialog', async () => {
    withExpress();
    window.history.replaceState(null, '', '/?tab=fleet&view=express');
    render(<FleetView />);
    const box = await screen.findByRole('searchbox', { name: 'United Express search' });
    fireEvent.change(box, { target: { value: 'commutair' } });
    const rows = expressPanel().querySelectorAll('tbody tr');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain('N14148');
    fireEvent.click(screen.getByRole('button', { name: 'N14148' }));
    expect(ctl.opened).toEqual(['N14148']);

    fireEvent.change(box, { target: { value: 'zzz' } });
    expect(expressPanel().textContent).toContain('No United Express aircraft match');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(expressPanel().querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('shows a verified cabin column and "No Wi-Fi" once the fleet has them', async () => {
    const crj = { r: 'N946SW', t: 'CRJ200', tk: 'CRJ200', o: 'SkyWest Airlines', oc: 'SKW', w: 'None', c: '50Y', seats: { Y: 50 }, tot: 50, fs: '2026-10-01T06:00:00Z', ls: '2026-10-04T18:13:07Z', lf: 'UA5102', x: true };
    withExpress();
    const list = [...EXPRESS, crj];
    ctl.fleet = { ...(ctl.fleet as object), expressDb: list, expressByReg: Object.fromEntries(list.map((e) => [e.r, e])) };
    window.history.replaceState(null, '', '/?tab=fleet&view=express');
    render(<FleetView />);
    const box = await screen.findByRole('searchbox', { name: 'United Express search' });
    expect(expressPanel().querySelector('thead')?.textContent).toContain('Config');
    const crjRow = [...expressPanel().querySelectorAll('tbody tr')].find((r) => r.textContent?.includes('N946SW'))!;
    expect(crjRow.textContent).toContain('No Wi-Fi');
    expect(crjRow.textContent).toContain('50Y');
    // The column is decided over the whole fleet: a search that hides the CRJ keeps it.
    fireEvent.change(box, { target: { value: 'commutair' } });
    expect(expressPanel().querySelector('thead')?.textContent).toContain('Config');
    // An unknown Wi-Fi is a dash, never "No Wi-Fi".
    expect(expressPanel().querySelector('tbody tr')?.textContent).not.toContain('No Wi-Fi');
  });

  it('sorts by a header button, with aria-sort on the cell', async () => {
    withExpress();
    window.history.replaceState(null, '', '/?tab=fleet&view=express');
    render(<FleetView />);
    await screen.findByRole('searchbox', { name: 'United Express search' });
    const lastSeen = screen.getByRole('button', { name: /Last seen/ });
    fireEvent.click(lastSeen);
    fireEvent.click(lastSeen);
    expect(lastSeen.closest('th')?.getAttribute('aria-sort')).toBe('descending');
    const regs = [...expressPanel().querySelectorAll('tbody tr')].map((r) => r.querySelector('button')?.textContent);
    expect(regs).toEqual(['N140SY', 'N14148', 'N85377']);
  });
});
