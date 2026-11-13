// @vitest-environment jsdom
/**
 * The aircraft dialog for a mainline tail links the names it prints (links part 2, slice 2d): the
 * link row's "All <type> in the fleet" door (the type in the title is a tooltip term, a button, so
 * the type's link lives in the link row), the Starlink badge, a ★ name, and the live flight's
 * number, split out of the block that sends the map to the aircraft.
 */
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ui = vi.hoisted(() => ({
  aircraftReg: 'N37502' as string | null,
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
const fleet = vi.hoisted(() => ({
  fleetByReg: {
    N37502: { r: 'N37502', t: '737 MAX 9', a: '3501', d: '2018', s: 'Active', c: '20F/48E+/111Y', w: 'Satl Ku', i: 'PDE', p: 'Yes', seats: { F: 20, 'E+': 48, Y: 111 }, tot: 179 },
  } as Record<string, unknown>,
  special: new Map([['N37502', { name: 'Star of the Show', type: 'named' }]]),
}));
vi.mock('../src/app/state/fleet', () => ({
  useFleet: () => ({
    fleetByReg: fleet.fleetByReg,
    expressByReg: {},
    starlink: { tails: new Set(['N37502']), aircraft: [] },
    special: fleet.special,
    loading: false,
    loadFailed: false,
    retry: () => {},
  }),
}));
vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ isWatched: () => false, toggle: () => true }) }));
vi.mock('../src/app/state/follow-link', () => ({ useFollowDeepLink: () => () => {} }));

import { TooltipProvider } from '@/components/ui/tooltip';
import AircraftDetailDialog from '../src/app/features/AircraftDetailDialog';

afterEach(() => {
  cleanup();
  feed.flights = [];
});

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

describe('AircraftDetailDialog, a mainline tail', () => {
  it('the link row has one quiet door to every aircraft of the type', async () => {
    await renderDialog();
    const door = screen.getByRole('link', { name: 'All 737 MAX 9 in the fleet' });
    expect(door.getAttribute('href')).toBe('/?tab=fleet&type=737%20MAX%209');
    expect(door.className).not.toContain('text-primary');
    // Beside Planespotters and FlightAware.
    expect(door.parentElement).toBe(screen.getByRole('link', { name: 'FlightAware ↗' }).parentElement);
  });

  it('the title type stays the tooltip term, with no link inside it', async () => {
    const dialog = await renderDialog();
    const description = within(dialog).getByText('737 MAX 9', { selector: 'button, button *' }).closest('p, div')!;
    expect(description.querySelector('a')).toBeNull();
  });

  it('the Starlink badge and the ★ name are quiet links to the Starlink tab and the special view', async () => {
    await renderDialog();
    expect(screen.getByRole('link', { name: 'STARLINK' }).getAttribute('href')).toBe('/#starlink');
    expect(screen.getByRole('link', { name: 'Star of the Show' }).getAttribute('href')).toBe('/?tab=fleet&view=special');
  });

  it('the live block: its number links to the flight page beside the map button, which keeps the rest', async () => {
    feed.flights = [{
      fr24id: '3c', icao24: 'a', lat: 40, lon: -100, hdg: 90, alt: 10000, spd: 220, vr: 0, squawk: null,
      acType: 'B39M', reg: 'N37502', origin: 'DEN', dest: 'SEA', flightIATA: 'UA360', onGround: false,
      callsign: 'UAL360', airline: 'UAL',
    }];
    await renderDialog();
    const button = screen.getByRole('button', { name: 'View on map: UA360' });
    const number = screen.getByRole('link', { name: 'UA360' });
    expect(number.getAttribute('href')).toBe('/flight/UA360');
    expect(button.contains(number)).toBe(false);
    // The button is stretched over the whole block; the number sits above it.
    expect(button.className).toContain('after:inset-0');
    expect(number.className).toContain('z-10');
    // Nothing inside the button is in link colour, and the block's hub codes stay its text.
    expect(button.closest('div.relative')!.querySelectorAll('.text-primary')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'DEN' })).toBeNull();
  });

  it('a live flight under a callsign with no United number prints it plain inside the block', async () => {
    feed.flights = [{
      fr24id: '3c', icao24: 'a', lat: 40, lon: -100, hdg: 90, alt: 10000, spd: 220, vr: 0, squawk: null,
      acType: 'B39M', reg: 'N37502', origin: 'DEN', dest: 'SEA', flightIATA: '', onGround: false,
      callsign: 'N37502', airline: 'UAL',
    }];
    await renderDialog();
    expect(screen.getByRole('button', { name: 'View on map: N37502' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'N37502' })).toBeNull();
  });
});
