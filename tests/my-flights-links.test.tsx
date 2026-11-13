// @vitest-environment jsdom
/**
 * The names a My Flights card, its Aircraft Journey and its connection cards print, linked to
 * their homes (links everywhere, part 2): a hub end to its Schedule board, the type to the Fleet tab
 * filtered to it, the tail to the aircraft dialog, a United flight number to its flight page, and
 * the Starlink badge to the Starlink tab. Everything else stays plain, and nothing that is not a
 * link is painted in link colour.
 *
 * Rendered with the follow stubbed: where a click lands is the foundation's, tested in
 * tests/follow-link-tabs.test.tsx; this is what links and where to.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Flight } from '../src/app/data/types';

vi.mock('../src/app/state/follow-link', () => ({ useFollowDeepLink: () => () => {} }));
vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchCheckFlight: () => new Promise(() => {}),
  fetchPredictFlight: () => new Promise(() => {}),
}));

import { TooltipProvider } from '@/components/ui/tooltip';
import { ConnectionCard } from '../src/app/views/myflight/ConnectionPanel';
import type { ConnectionPair, ConnectionRisk } from '../src/app/views/myflight/ConnectionPanel';
import { FlightCard } from '../src/app/views/myflight/FlightCard';
import type { MyFlightCardModel } from '../src/app/views/myflight/FlightCard';
import { JourneyChain } from '../src/app/views/myflight/JourneyChain';
import type { JourneySegment } from '../src/app/views/myflight/useAircraftJourney';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => cleanup());

const inbound = (overrides: Partial<Flight> = {}): Flight => ({
  fr24id: 'x', icao24: 'a', lat: 40, lon: -100, hdg: 90, alt: 10000, spd: 200, vr: 0, squawk: null,
  acType: 'B39M', reg: 'N37502', origin: 'SFO', dest: 'ORD', flightIATA: 'UA999', onGround: false,
  callsign: 'UAL999', airline: 'UAL',
  ...overrides,
});

function model(overrides: Partial<MyFlightCardModel> = {}): MyFlightCardModel {
  return {
    entry: { flight: 'UA1234', route: 'ORD→EUG', status: '', ts: 0 },
    td: { success: true, departure: { gate: {} }, arrival: { gate: {} } } as MyFlightCardModel['td'],
    failures: 0,
    origCode: 'ORD',
    destCode: 'EUG',
    origCity: 'Chicago',
    destCity: 'EUG',
    resolvedStatus: 'scheduled',
    reg: 'N37502',
    liveFlight: null,
    aircraft: { r: 'N37502', t: '737 MAX 9' } as MyFlightCardModel['aircraft'],
    typeCode: '737 MAX 9',
    isStarlink: true,
    inbound: inbound(),
    journeySegments: [],
    risk: null,
    riskNA: false,
    explainContext: null,
    ...overrides,
  };
}

function card(overrides: Partial<MyFlightCardModel> = {}) {
  render(
    <TooltipProvider>
      <FlightCard model={model(overrides)} now={0} onViewOnMap={() => {}} onAircraftDetail={() => {}} onExplain={() => {}} onUnwatch={() => {}} />
    </TooltipProvider>,
  );
}

/** A Starlink badge rendered as a link keeps its own colour on hover, never a Badge variant's. */
function expectStarlinkHover(badge: HTMLElement) {
  const classes = badge.className.split(/\s+/);
  expect(classes.filter((c) => c.startsWith('[a]:hover:'))).toEqual(
    expect.arrayContaining([expect.stringMatching(/^\[a\]:hover:bg-bb-starlink\//)]),
  );
  expect(classes.some((c) => /primary-fill|muted/.test(c) && c.includes('hover'))).toBe(false);
}

const href = (name: string | RegExp) => screen.getByRole('link', { name }).getAttribute('href');
const isQuiet = (el: HTMLElement) => el.className.includes('text-inherit') && !el.className.includes('text-primary');

describe('a watched flight card', () => {
  it('links the hub end of its route to the board and prints a non-hub end plain', () => {
    card();
    const route = screen.getByText(/Chicago/).closest('div')!;
    expect(within(route).getByRole('link', { name: 'ORD' }).getAttribute('href')).toBe('/?tab=schedule&hub=ORD');
    expect(within(route).queryByRole('link', { name: 'EUG' })).toBeNull();
    expect(route.textContent).toBe('Chicago (ORD) → EUG');
  });

  it('links the type to the Fleet tab and the tail to its aircraft dialog, both quiet', () => {
    card();
    const type = screen.getByRole('link', { name: '737 MAX 9' });
    expect(type.getAttribute('href')).toBe('/?tab=fleet&type=737%20MAX%209');
    const tail = screen.getByRole('link', { name: 'N37502' });
    expect(tail.getAttribute('href')).toBe('/?aircraft=N37502');
    expect(isQuiet(type)).toBe(true);
    expect(isQuiet(tail)).toBe(true);
  });

  it('the Starlink badge is a quiet link to the Starlink tab', () => {
    card();
    const badge = screen.getByRole('link', { name: 'Starlink Confirmed' });
    expect(badge.getAttribute('href')).toBe('/#starlink');
    expect(badge.className).not.toContain('text-primary');
    expect(badge.className).toContain('overflow-visible');
    // The outline variant would grey it on hover (`[a]:hover:text-muted-foreground`).
    expectStarlinkHover(badge);
    expect(badge.className.split(/\s+/)).toContain('[a]:hover:text-bb-starlink');
  });

  it("Where's My Plane?: the inbound number and its hub ends link; the heading is body colour", () => {
    card();
    const box = screen.getByRole('heading', { name: 'Where’s My Plane?' }).parentElement!;
    expect(screen.getByRole('heading', { name: 'Where’s My Plane?' }).className).not.toContain('text-primary');
    expect(within(box).getByRole('link', { name: 'UA999' }).getAttribute('href')).toBe('/flight/UA999');
    expect(isQuiet(within(box).getByRole('link', { name: 'UA999' }))).toBe(true);
    expect(within(box).getByRole('link', { name: 'SFO' }).getAttribute('href')).toBe('/?tab=schedule&hub=SFO');
    expect(within(box).getByRole('link', { name: 'ORD' }).getAttribute('href')).toBe('/?tab=schedule&hub=ORD');
  });

  it('an inbound flying under an operating number with no United number stays plain (ruling 4)', () => {
    card({ inbound: inbound({ flightIATA: 'G73375' }) });
    expect(screen.queryByRole('link', { name: 'G73375' })).toBeNull();
    expect(screen.getByText('G73375').tagName).toBe('SPAN');
  });

  it("a provider's type text with no tail the fleet knows prints plain", () => {
    card({ aircraft: undefined, typeCode: null, reg: '', td: { success: true, aircraft: 'Boeing 737-900', departure: { gate: {} }, arrival: { gate: {} } } as MyFlightCardModel['td'] });
    expect(screen.queryByRole('link', { name: 'Boeing 737-900' })).toBeNull();
    expect(screen.getByText('Boeing 737-900')).toBeTruthy();
  });

  it('the header flight number is still its one link-coloured link', () => {
    card();
    const own = screen.getByRole('heading', { level: 2 });
    expect(within(own).getByRole('link', { name: 'UA1234' }).className).toContain('text-primary');
  });
});

describe('the Aircraft Journey', () => {
  const segment = (flightNumber: string, origin: string, destination: string): JourneySegment =>
    ({ flightNumber, origin, destination, status: 'landed', delayMin: 0 }) as JourneySegment;

  function journey(segments: JourneySegment[]) {
    render(<JourneyChain reg="N37502" segments={segments} flight="UA1234" origCode="ORD" destCode="EUG" />);
  }

  it("the heading's tail opens the aircraft dialog", () => {
    journey([segment('UA100', 'DEN', 'ORD')]);
    const heading = screen.getByRole('heading', { name: /Aircraft Journey/ });
    expect(within(heading).getByRole('link', { name: 'N37502' }).getAttribute('href')).toBe('/?aircraft=N37502');
  });

  it("each earlier leg links its United number (link colour) and its hub ends; a callsign stays plain", () => {
    journey([segment('SKW5123', 'EUG', 'DEN'), segment('UA100', 'DEN', 'ORD')]);
    const legs = screen.getAllByRole('listitem');
    const united = legs.find((li) => li.textContent?.includes('UA100'))!;
    expect(within(united).getByRole('link', { name: 'UA100' }).getAttribute('href')).toBe('/flight/UA100');
    expect(within(united).getByRole('link', { name: 'UA100' }).className).toContain('text-primary');
    expect(within(united).getByRole('link', { name: 'DEN' }).getAttribute('href')).toBe('/?tab=schedule&hub=DEN');
    expect(within(united).getByRole('link', { name: 'ORD' }).getAttribute('href')).toBe('/?tab=schedule&hub=ORD');
    const express = legs.find((li) => li.textContent?.includes('SKW5123'))!;
    expect(within(express).queryByRole('link', { name: 'SKW5123' })).toBeNull();
    expect(within(express).queryByRole('link', { name: 'EUG' })).toBeNull();
    // A leg line is 44 px tall wherever touch boxes are drawn, so one line's boxes never cover the next.
    expect(united.className).toContain('min-h-11');
    expect(united.className).toContain('pointer-fine:md:min-h-0');
  });

  it("the card's own flight and route stay plain: the card's header is that flight's link", () => {
    journey([segment('UA100', 'DEN', 'ORD')]);
    const own = screen.getByText('Your flight').closest('li')!;
    expect(within(own).queryAllByRole('link')).toHaveLength(0);
  });
});

describe('a connection card', () => {
  const risk: ConnectionRisk = {
    state: 'scored', hasData: true, risk: 'OK', color: '#22c55e', label: 'Comfortable', connectionMin: 90,
    buffer: 30, mct: 50, walkTime: 10, inTerminal: '1', outTerminal: '2',
  };
  const conn = (origin: string, hub: string, destination: string): ConnectionPair => ({
    hub,
    inbound: { w: { flight: 'UA1' }, td: { origin: { iata: origin } } },
    outbound: { w: { flight: 'UA2' }, td: { destination: { iata: destination } } },
  });

  it('links the meeting hub once (the title), each leg number, and a hub far end', () => {
    render(<ConnectionCard conn={conn('SFO', 'ORD', 'EUG')} risk={risk} />);
    expect(screen.getAllByRole('link', { name: 'ORD' })).toHaveLength(1);
    expect(href('ORD')).toBe('/?tab=schedule&hub=ORD');
    expect(screen.getByRole('link', { name: 'ORD' }).closest('span')!.textContent).toMatch(/^Connection at ORD/);
    expect(href('UA1')).toBe('/flight/UA1');
    expect(href('UA2')).toBe('/flight/UA2');
    expect(href('SFO')).toBe('/?tab=schedule&hub=SFO');
    expect(screen.queryByRole('link', { name: 'EUG' })).toBeNull();
  });

  it('a round trip links its far end once', () => {
    render(<ConnectionCard conn={conn('SFO', 'ORD', 'SFO')} risk={risk} />);
    expect(screen.getAllByRole('link', { name: 'SFO' })).toHaveLength(1);
  });

  it('a manual check meeting away from the hubs names the airport plain', () => {
    render(<ConnectionCard conn={conn('SFO', 'MSP', 'DEN')} risk={risk} />);
    expect(screen.queryByRole('link', { name: 'MSP' })).toBeNull();
    expect(href('DEN')).toBe('/?tab=schedule&hub=DEN');
  });
});
