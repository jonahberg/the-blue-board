// @vitest-environment jsdom
/**
 * A link followed from inside an overlay, with the real overlay (links part 2, slice 2d): the
 * flight sheet, the aircraft dialog, the FR24 lookup, the delay explanation and the brief sheet,
 * each mounted in the real UiProvider, ScheduleProvider and FollowProvider over a shell of tab
 * panels built the way Dashboard.tsx builds them (Radix `TabsContent`, `forceMount`,
 * `data-tab-panel`).
 *
 * The question each test answers: after the follow closes the overlay (through the store, as its
 * own close does) and the Radix content unmounts, where does focus end? The dialog and sheet
 * wrappers hand focus back to the element that opened the overlay when focus was lost
 * (src/lib/focus-return.js); the follow moves focus to the destination panel a frame later. These
 * pin that the panel wins, including when the opener sits in the destination panel itself.
 *
 * jsdom runs no exit animation, so the content unmounts in the same commit as the close and the
 * wrapper's hand-back runs before the follow's frame; in a browser the frame comes first and the
 * hand-back (after the 100 to 200 ms exit animation) finds focus already on the panel. Both orders
 * are checked here only in the first; the second was checked in Chrome (the slice report).
 *
 * The feed, fleet and watch stores are stubbed (the real ones poll), as are the APIs the overlays
 * call when they open.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Flight } from '../src/app/data/types';

const data = vi.hoisted(() => ({
  flights: [] as unknown[],
  fr24: null as unknown,
}));
const brief = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('../src/app/state/feed', () => ({ useFeed: () => ({ flights: data.flights }) }));
vi.mock('../src/app/state/watch', () => ({
  useWatch: () => ({ watched: [], isWatched: () => false, toggle: () => true }),
}));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));
const MAINLINE = {
  r: 'N37502', t: '737 MAX 9', a: '3501', d: '2018', s: 'Active', c: '20F/48E+/111Y', w: 'Satl Ku',
  i: 'PDE', p: 'Yes', seats: { F: 20, 'E+': 48, Y: 111 }, tot: 179,
};
vi.mock('../src/app/state/fleet', () => ({
  useFleet: () => ({
    fleetDb: [MAINLINE],
    fleetByReg: { N37502: MAINLINE },
    expressByReg: {},
    starlink: { tails: new Set<string>(), aircraft: [] },
    special: new Map(),
    loading: false,
    loadFailed: false,
    retry: () => {},
  }),
}));
vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchFlightTimes: () => new Promise(() => {}),
  fetchFr24Flight: async () => data.fr24,
  postDelayExplain: () => new Promise(() => {}),
}));
vi.mock('../src/app/state/brief', () => ({ useBrief: () => brief.current }));
vi.mock('../src/lib/brief-chips.js', () => ({
  itemChips: () => [
    { id: 'board', label: 'ORD 81%', tone: 'plain', title: 'ORD on time', target: { href: '/?tab=schedule&hub=ORD', tab: 'schedule' } },
  ],
}));

import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import AircraftDetailDialog from '../src/app/features/AircraftDetailDialog';
import { BriefBody } from '../src/app/features/BriefPanel';
import BriefSheet from '../src/app/features/BriefSheet';
import DelayExplainDialog from '../src/app/features/DelayExplainDialog';
import { FlightSheet } from '../src/app/features/FlightSheet';
import Fr24LookupDialog from '../src/app/features/Fr24LookupDialog';
import type { BriefReady } from '../src/app/state/brief';
import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider, useSchedule } from '../src/app/state/schedule';
import type { ScheduleValue } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';
import { TABS } from '../src/app/tabs';
import type { TabId } from '../src/app/tabs';

const seen: { ui: UiValue | null; schedule: ScheduleValue | null } = { ui: null, schedule: null };

const VIEW: BriefReady = {
  status: 'ready',
  headline: 'Operations are normal.',
  tone: 'calm',
  source: 'template',
  items: [{ text: 'One fact.', factIds: ['board'] }],
  travelerNote: null,
  facts: [],
  factsById: new Map(),
  factCount: 1,
  generatedAtMs: Date.parse('2026-11-12T18:00:00Z'),
  checkedAtMs: Date.parse('2026-11-12T18:00:00Z'),
  nextUpdateAtMs: null,
  hasRadio: false,
};

/**
 * Dashboard.tsx's shell in miniature: one panel per tab, each with a button that opens an overlay
 * from inside it (the opener the dialog wrappers remember), and the real overlays.
 */
function Shell({ briefOpen = false, sidebarBrief = false }: { briefOpen?: boolean; sidebarBrief?: boolean }) {
  const ui = useUi();
  seen.ui = ui;
  seen.schedule = useSchedule();
  // The brief store's sheet state, held here (the real store fetches the brief), before anything
  // below reads it.
  const [sheetOpen, setSheetOpen] = useState(briefOpen);
  brief.current = { view: VIEW, sheetOpen, setSheetOpen };
  return (
    <TooltipProvider>
      <Tabs value={ui.tab} onValueChange={(value) => ui.setTab(value as TabId)}>
        {TABS.map(({ id }) => (
          <TabsContent key={id} value={id} forceMount data-tab-panel={id}>
            <button type="button" onClick={() => ui.openAircraft('N37502')}>
              Open N37502 from {id}
            </button>
            {id === 'live' && sidebarBrief ? (
              <BriefBody view={VIEW} variant="sidebar" renderHeadline={(text) => <h2>{text}</h2>} />
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
      <FlightSheet />
      <AircraftDetailDialog />
      <Fr24LookupDialog />
      <DelayExplainDialog />
      <BriefSheet />
    </TooltipProvider>
  );
}

function mountAt(url: string, props: { briefOpen?: boolean; sidebarBrief?: boolean } = {}) {
  window.history.replaceState(null, '', url);
  render(
    <UiProvider>
      <ScheduleProvider defaultHub="IAH">
        <FollowProvider>
          <Shell {...props} />
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
}

const panel = (id: TabId) => document.querySelector<HTMLElement>(`[data-tab-panel="${id}"]`)!;

/** A frame, then long enough for the overlay to unmount and any focus hand-back to run, then a frame. */
async function settle() {
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

/** A keyboard user's Enter on a focused link: the browser turns it into a primary click. */
function activate(link: HTMLElement) {
  link.focus();
  fireEvent.click(link);
}

const airborne = (overrides: Partial<Flight> = {}): Flight => ({
  fr24id: '3c9a77d0', icao24: 'a0b7c4', lat: 40.91, lon: -104.62, hdg: 262, alt: 11278, spd: 240, vr: 0,
  squawk: null, acType: 'B39M', reg: 'N37502', origin: 'ORD', dest: 'SFO', flightIATA: 'UA2106',
  onGround: false, callsign: 'UAL2106', airline: 'UAL',
  ...overrides,
});

function recordClick(event: Event) {
  // jsdom cannot load another document and says so on the console.
  event.preventDefault();
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  window.history.pushState(null, '', '/');
  document.addEventListener('click', recordClick);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in this test'))));
  // A desktop: the flight sheet and the brief sheet are right-hand panels.
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      matches: 1280 >= min, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    };
  });
  data.flights = [airborne()];
  data.fr24 = null;
});

afterEach(() => {
  cleanup();
  document.removeEventListener('click', recordClick);
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  seen.ui = null;
  seen.schedule = null;
  brief.current = null;
});

describe('the flight sheet', () => {
  it('a hub link over Live: the sheet closes, Schedule shows that hub, it is said, focus is on the Schedule panel', async () => {
    mountAt('/#live');
    act(() => seen.ui!.select({ kind: 'flight', flight: airborne() }));
    await settle();

    activate(screen.getByRole('link', { name: 'ORD' }));
    await settle();

    expect(seen.ui!.selection).toBeNull();
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.schedule!.current).toMatchObject({ hub: 'ORD', dir: 'departures' });
    expect(seen.ui!.announcement).toBe('Schedule, ORD');
    expect(document.activeElement).toBe(panel('schedule'));
  });

  it('opened from a control in the Live panel: focus still ends on the Schedule panel, not back on the opener', async () => {
    mountAt('/#live');
    const opener = screen.getByRole('button', { name: 'Open N37502 from live' });
    opener.focus();
    act(() => seen.ui!.select({ kind: 'flight', flight: airborne() }));
    await settle();

    activate(screen.getByRole('link', { name: 'SFO' }));
    await settle();

    expect(seen.ui!.tab).toBe('schedule');
    expect(document.activeElement).toBe(panel('schedule'));
  });

  it('a hub link over Schedule itself lands as an arrival: the filters reset, it is said, focus moves', async () => {
    mountAt('/#schedule');
    act(() => seen.ui!.select({ kind: 'flight', flight: airborne() }));
    await settle();

    activate(screen.getByRole('link', { name: 'ORD' }));
    await settle();

    expect(seen.ui!.scheduleLink).toEqual({ hub: 'ORD', seq: 1 });
    expect(seen.ui!.announcement).toBe('Schedule, ORD');
    expect(document.activeElement).toBe(panel('schedule'));
  });

  it('a tail link opens the aircraft dialog over the sheet, which stays; Escape returns to the tail', async () => {
    // The controller's exception to "fromOverlay on every overlay link": the sheet's tail opens
    // the dialog over the still-open sheet, as its button did, so the reader keeps their flight.
    mountAt('/#live');
    const before = window.history.length;
    act(() => seen.ui!.select({ kind: 'flight', flight: airborne() }));
    await settle();

    const tail = screen.getByRole('link', { name: 'N37502' });
    activate(tail);
    await settle();

    expect(seen.ui!.aircraftReg).toBe('N37502');
    expect(seen.ui!.selection).not.toBeNull();
    expect(document.querySelector('[data-slot="sheet-content"]')).not.toBeNull();
    expect(seen.ui!.tab).toBe('live');
    expect(seen.ui!.announcement).toBe('');
    expect(window.history.length).toBe(before);
    const dialog = screen.getByRole('dialog', { name: 'N37502' });
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await settle();

    expect(seen.ui!.aircraftReg).toBeNull();
    expect(seen.ui!.selection).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'N37502' }));
  });
});

describe('the aircraft dialog', () => {
  it('opened from a row in the Fleet panel, its type door lands on Fleet, focus on the panel, not the row', async () => {
    mountAt('/#fleet');
    const opener = screen.getByRole('button', { name: 'Open N37502 from fleet' });
    opener.focus();
    fireEvent.click(opener);
    await settle();
    expect(screen.getByRole('dialog', { name: 'N37502' }).contains(document.activeElement)).toBe(true);

    activate(screen.getByRole('link', { name: 'All 737 MAX 9 in the fleet' }));
    await settle();

    expect(seen.ui!.aircraftReg).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(seen.ui!.tab).toBe('fleet');
    expect(seen.ui!.fleetLink).toMatchObject({ filter: '737 MAX 9', arriving: true });
    expect(seen.ui!.announcement).toBe('Fleet, 737 MAX 9');
    expect(document.activeElement).toBe(panel('fleet'));
  });

  it('over another tab: the door changes the tab and focus goes to the Fleet panel', async () => {
    mountAt('/#myflight');
    fireEvent.click(screen.getByRole('button', { name: 'Open N37502 from myflight' }));
    await settle();

    activate(screen.getByRole('link', { name: 'All 737 MAX 9 in the fleet' }));
    await settle();

    expect(seen.ui!.tab).toBe('fleet');
    expect(document.activeElement).toBe(panel('fleet'));
  });
});

describe('the FR24 lookup', () => {
  beforeEach(() => {
    data.fr24 = {
      success: true,
      source: 'fr24-official-summary',
      cached: false,
      flight: {
        flightNumber: 'UA2278', callsign: 'UAL2278', status: 'landed',
        origin: { iata: 'SFO', name: '' }, destination: { iata: 'DEN', name: '' },
        aircraft: { type: 'B39M', reg: 'N37502' },
        departure: { scheduled: '', actual: '' }, arrival: { scheduled: '', estimated: '', actual: '' },
      },
    };
  });

  it('a hub link: the dialog closes, Schedule shows the hub, focus is on the Schedule panel', async () => {
    mountAt('/#live');
    act(() => seen.ui!.openFr24('UA2278'));
    await settle();

    activate(await screen.findByRole('link', { name: 'DEN' }));
    await settle();

    expect(seen.ui!.fr24Query).toBeNull();
    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.schedule!.current.hub).toBe('DEN');
    expect(document.activeElement).toBe(panel('schedule'));
  });

  it('a tail link replaces the lookup with the aircraft dialog', async () => {
    mountAt('/#live');
    act(() => seen.ui!.openFr24('UA2278'));
    await settle();

    activate(await screen.findByRole('link', { name: 'N37502' }));
    await settle();

    expect(seen.ui!.fr24Query).toBeNull();
    expect(seen.ui!.aircraftReg).toBe('N37502');
    expect(screen.getByRole('dialog', { name: 'N37502' }).contains(document.activeElement)).toBe(true);
  });
  it('the tail closes only the lookup: a flight sheet open under it stays open, as with the old button', async () => {
    mountAt('/#live');
    act(() => seen.ui!.select({ kind: 'flight', flight: airborne() }));
    await settle();
    act(() => seen.ui!.openFr24('UA2278'));
    await settle();

    const tails = await screen.findAllByRole('link', { name: 'N37502' });
    // The sheet's own tail is first in the page; the lookup's is inside its dialog.
    const lookupTail = tails.find((a) => a.closest('[data-slot="dialog-content"]'))!;
    activate(lookupTail);
    await settle();

    expect(seen.ui!.fr24Query).toBeNull();
    expect(seen.ui!.aircraftReg).toBe('N37502');
    expect(seen.ui!.selection).not.toBeNull();
    expect(document.querySelector('[data-slot="sheet-content"]')).not.toBeNull();
  });
});

describe('the delay explanation', () => {
  it("splits the route, links its hub ends, and a hub link lands on that hub's board", async () => {
    mountAt('/#myflight');
    act(() => seen.ui!.openDelayExplain({ flight: 'UA1234', route: 'ORD→EUG', riskLabel: 'MOD', riskScore: 42, hub: 'ORD' }));
    await settle();

    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('ORD→EUG · Score 42/100');
    expect(screen.queryByRole('link', { name: 'EUG' })).toBeNull();
    // On touch the hub link is 44 px tall itself (`hit="inline"`), not a centred 44 px box that
    // would reach up over the title's flight number, and the line sits a little lower.
    const ord = screen.getByRole('link', { name: 'ORD' });
    expect(ord.className).toContain('min-h-11');
    expect(ord.className).not.toContain('after:h-11');
    expect(ord.closest('p')!.className.split(/\s+/)).toEqual(expect.arrayContaining(['mt-1', 'pointer-fine:md:mt-0']));

    activate(screen.getByRole('link', { name: 'ORD' }));
    await settle();

    expect(seen.ui!.delayExplain).toBeNull();
    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.schedule!.current.hub).toBe('ORD');
    expect(seen.ui!.announcement).toBe('Schedule, ORD');
    expect(document.activeElement).toBe(panel('schedule'));
  });

  it('a route that is not two codes joined by the arrow prints as it came, with no links', async () => {
    mountAt('/#myflight');
    act(() => seen.ui!.openDelayExplain({ flight: 'UA1234', route: 'ORD-DEN', riskLabel: 'LOW', riskScore: 10 }));
    await settle();
    expect(screen.getByRole('dialog').textContent).toContain('ORD-DEN · Score 10/100');
    expect(screen.queryByRole('link', { name: 'ORD' })).toBeNull();
  });
});

describe('the brief sheet (carried-over fix)', () => {
  it('over Live: a board chip closes the sheet, shows Schedule, says it, and focus is on the Schedule panel', async () => {
    mountAt('/#live', { briefOpen: true });
    await settle();

    activate(screen.getByRole('link', { name: 'ORD 81%' }));
    await settle();

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.schedule!.current.hub).toBe('ORD');
    expect(seen.ui!.announcement).toBe('Schedule, ORD');
    expect(document.activeElement).toBe(panel('schedule'));
  });

  it('over Schedule itself: the chip lands as an arrival, so it is said and the board filters reset', async () => {
    mountAt('/#schedule', { briefOpen: true });
    await settle();

    activate(screen.getByRole('link', { name: 'ORD 81%' }));
    await settle();

    expect(seen.ui!.scheduleLink).toEqual({ hub: 'ORD', seq: 1 });
    expect(seen.ui!.announcement).toBe('Schedule, ORD');
    expect(document.activeElement).toBe(panel('schedule'));
  });

  it('the sidebar brief is not an overlay: its chip follows as any link on the page does', async () => {
    mountAt('/#live', { sidebarBrief: true });
    act(() => seen.ui!.select({ kind: 'flight', flight: airborne() }));
    await settle();
    // The chip is inside the Live panel, the panel the follow hides: focus moves with it.
    activate(screen.getByRole('link', { name: 'ORD 81%' }));
    await settle();
    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.ui!.announcement).toBe('Schedule, ORD');
    expect(document.activeElement).toBe(panel('schedule'));
    // Not followed as from an overlay: the flight sheet beside it is left open, as before.
    expect(seen.ui!.selection).not.toBeNull();
  });
});
