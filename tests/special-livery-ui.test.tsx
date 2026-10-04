// @vitest-environment jsdom
/**
 * The special-livery badge where people meet it: the flight sheet, and the inert marker the
 * phone board and live sidebar put inside their own buttons.
 *
 * The flight sheet harness mirrors tests/flight-sheet.test.tsx; the panel is wrapped in the
 * TooltipProvider the dashboard shell supplies, because the badge's description is a tooltip.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '../src/components/ui/tooltip';
import type { Flight } from '../src/app/data/types';

const ui = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock('../src/app/state/ui', () => ({ useUi: () => ui }));
const feed = vi.hoisted(() => ({ flights: [] as unknown[] }));
vi.mock('../src/app/state/feed', () => ({ useFeed: () => feed }));
const fleet = vi.hoisted(() => ({
  fleetByReg: {} as Record<string, unknown>,
  starlink: { tails: new Set<string>() },
  special: new Map(),
  loading: false,
}));
vi.mock('../src/app/state/fleet', () => ({ useFleet: () => fleet }));
const watch = vi.hoisted(() => ({ isWatched: () => false, toggle: () => true }));
vi.mock('../src/app/state/watch', () => ({ useWatch: () => watch }));
vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchFlightTimes: async () => ({ success: false, error: 'No schedule data for this flight today.' }),
}));

import { FlightSheet } from '../src/app/features/FlightSheet';
import { SpecialLiveryBadge, SpecialLiveryMarker } from '../src/app/features/SpecialLiveryBadge';
import { liveryForTail } from '../src/lib/special-livery.js';

function flight(overrides: Partial<Flight> = {}): Flight {
  return {
    fr24id: '3c9a77d0', icao24: 'a0b7c4', lat: 40.91, lon: -104.62, hdg: 262, alt: 11278,
    spd: 240, vr: 0, squawk: null, acType: 'B739', reg: 'N75435', origin: 'IAH', dest: 'ORD',
    flightIATA: 'UA1226', onGround: false, callsign: 'UAL1226', airline: 'UAL',
    ...overrides,
  };
}

async function open(f: Flight) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: true, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }));
  Object.assign(ui, {
    selection: { kind: 'flight', flight: f },
    select: () => {},
    focusOn: () => {},
    openAircraft: () => {},
    announce: () => {},
  });
  feed.flights = [f];
  await act(async () => {
    render(
      <TooltipProvider>
        <FlightSheet />
      </TooltipProvider>,
    );
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fleet.fleetByReg = {};
});

describe('flight sheet', () => {
  it('names the special livery of a matched airframe', async () => {
    fleet.fleetByReg = { N75435: { r: 'N75435', t: '737-900ER', c: '20F/45E+/114Y', w: 'Starlink' } };
    await open(flight());
    const badge = screen.getByRole('button', { name: 'Special livery: Continental retro' });
    expect(badge.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('still shows it while the tail is not (yet) matched to the fleet database', async () => {
    await open(flight({ reg: 'N91007', acType: 'B78X' }));
    expect(screen.getByRole('button', { name: 'Special livery: Stars and Stripes' })).toBeTruthy();
  });

  it('shows nothing for a standard-livery tail', async () => {
    await open(flight({ reg: 'N4888U', acType: 'A319' }));
    expect(screen.queryByRole('button', { name: /Special livery/ })).toBeNull();
  });
});

describe('badge and marker', () => {
  it('the compact and icon badges carry the full label as their accessible name', () => {
    render(
      <TooltipProvider>
        <SpecialLiveryBadge livery={liveryForTail('N78285')} variant="compact" />
        <SpecialLiveryBadge livery={liveryForTail('N24988')} variant="icon" />
      </TooltipProvider>,
    );
    const compact = screen.getByRole('button', { name: 'Special livery: Stars and Stripes' });
    expect(compact.textContent).toBe('Stars & Stripes');
    expect(screen.getByRole('button', { name: 'Special livery: The Future is SAF' }).textContent).toBe('');
  });

  it('the marker is inert, with words for a screen reader and a title for a pointer', () => {
    const { container } = render(<SpecialLiveryMarker livery={liveryForTail('N475UA')} />);
    expect(container.querySelector('button')).toBeNull();
    const marker = container.firstElementChild as HTMLElement;
    expect(marker.getAttribute('title')).toBe('Special livery: Friend Ship');
    expect(marker.textContent).toBe('Special livery: Friend Ship');
  });

  it('render nothing without a livery, so plain rows never shift', () => {
    const { container } = render(
      <TooltipProvider>
        <SpecialLiveryBadge livery={null} />
        <SpecialLiveryMarker livery={undefined} />
      </TooltipProvider>,
    );
    expect(container.innerHTML).toBe('');
  });
});
