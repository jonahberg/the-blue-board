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
vi.mock('../src/app/state/fleet', () => ({
  useFleet: () => ({
    fleetByReg: {},
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

afterEach(() => cleanup());

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
