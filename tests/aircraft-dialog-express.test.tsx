// @vitest-environment jsdom
/**
 * D6 (live audit Sep 28 2026): the aircraft dialog for N642SY — a SkyWest E175 on the Starlink
 * roster — said only "Not in mainline fleet database". It now shows what the roster and the
 * live feed know.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ui = vi.hoisted(() => ({
  aircraftReg: 'N642SY' as string | null,
  openAircraft: vi.fn(),
  select: vi.fn(),
  focusOn: vi.fn(),
  setTab: vi.fn(),
  onboardingOpen: false,
  announce: vi.fn(),
}));
vi.mock('../src/app/state/ui', () => ({ useUi: () => ui }));
const feed = vi.hoisted(() => ({ flights: [] as unknown[] }));
vi.mock('../src/app/state/feed', () => ({ useFeed: () => feed }));
const express = vi.hoisted(() => ({ byReg: {} as Record<string, unknown> }));
vi.mock('../src/app/state/fleet', () => ({
  useFleet: () => ({
    fleetByReg: {},
    expressByReg: express.byReg,
    starlink: {
      tails: new Set(['N642SY']),
      aircraft: [{ tail: 'N642SY', fleet: 'Express', type: 'E175SC', operator: 'SkyWest dba UAX' }],
    },
    special: new Map(),
    loading: false,
    loadFailed: false,
    retry: () => {},
  }),
}));
vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ isWatched: () => false, toggle: () => true }) }));

import { TooltipProvider } from '@/components/ui/tooltip';
import AircraftDetailDialog from '../src/app/features/AircraftDetailDialog';

afterEach(() => {
  cleanup();
  express.byReg = {};
  feed.flights = [];
  ui.aircraftReg = 'N642SY';
});

describe('AircraftDetailDialog — United Express Starlink tail (D6)', () => {
  it('shows Starlink, type and operator from the roster instead of only "not in the database"', async () => {
    await act(async () => {
      render(
        <TooltipProvider>
          <AircraftDetailDialog />
        </TooltipProvider>,
      );
    });
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('E175SC');
    expect(dialog.textContent).toContain('SkyWest dba UAX');
    expect(dialog.textContent).toContain('STARLINK');
    expect(dialog.textContent).toContain('United Express');
  });

  it('shows the current flight from the live feed', async () => {
    feed.flights = [{
      fr24id: '3c1a2b', icao24: 'a86b1c', lat: 44.1, lon: -93.2, hdg: 120, alt: 10058, spd: 220, vr: 0,
      squawk: null, acType: 'E75L', reg: 'N642SY', origin: 'MSP', dest: 'ORD', flightIATA: 'UA5712',
      onGround: false, callsign: 'SKW5712', airline: 'SKW',
    }];
    await act(async () => {
      render(
        <TooltipProvider>
          <AircraftDetailDialog />
        </TooltipProvider>,
      );
    });
    expect(screen.getByRole('button', { name: 'View UA5712 on the map' })).toBeTruthy();
  });
});

describe('AircraftDetailDialog — a tail from the United Express fleet', () => {
  const N85377 = {
    r: 'N85377', t: 'E175', tk: 'E175', o: 'SkyWest Airlines', oc: 'SKW', w: '', c: '',
    fs: '2026-10-01T06:00:00Z', ls: '2026-10-04T18:00:24Z', lf: 'UA5928', x: true,
  };

  async function renderDialog() {
    await act(async () => {
      render(
        <TooltipProvider>
          <AircraftDetailDialog />
        </TooltipProvider>,
      );
    });
    return screen.getByRole('dialog');
  }

  it('prefers the Express entry: type, operator, first/last seen and the last United flight', async () => {
    express.byReg = { N85377 };
    ui.aircraftReg = 'N85-377';
    const dialog = await renderDialog();
    const text = dialog.textContent || '';
    expect(text).toContain('E175');
    expect(text).toContain('SkyWest Airlines · United Express');
    expect(text).toContain('UA5928');
    expect(text).toMatch(/First seen\s*(Sep 30|Oct 1), 2026/);
    expect(text).toContain('Last seen');
    expect(text).toContain('Not on the roster');
    expect(text).not.toContain('Not in mainline fleet database');
    // No cabin is verified for it: no Config, no seat count.
    expect(text).not.toContain('Config');
    expect(text).not.toContain('Total Seats');
  });

  it('keeps the live flight button and the roster Starlink for an Express Starlink tail', async () => {
    express.byReg = { N642SY: { ...N85377, r: 'N642SY', w: 'Starlink', lf: 'UA5253' } };
    feed.flights = [{
      fr24id: '3c1a2b', icao24: 'a86b1c', lat: 44.1, lon: -93.2, hdg: 120, alt: 10058, spd: 220, vr: 0,
      squawk: null, acType: 'E75L', reg: 'N642SY', origin: 'MSP', dest: 'ORD', flightIATA: 'UA5712',
      onGround: false, callsign: 'SKW5712', airline: 'SKW',
    }];
    const dialog = await renderDialog();
    expect(dialog.textContent).toContain('STARLINK');
    expect(dialog.textContent).toContain('Yes ⚡');
    expect(screen.getByRole('button', { name: 'View UA5712 on the map' })).toBeTruthy();
  });
});
