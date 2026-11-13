// @vitest-environment jsdom
/**
 * Ruling 9 for the Schedule board (links everywhere, part 2): a hub link that arrives at Schedule
 * from another tab ends where a cold load of the same address ends, even when the reader left the
 * board dirty (filters set, Arrivals showing, an "Ask the board" answer applied).
 *
 * Both arms run the real ScheduleView on the real UiProvider, ScheduleProvider and FollowProvider,
 * with `useDeepLinks` wired as Dashboard.tsx wires it (the cold load's reader) and the view kept
 * mounted once visited, as Dashboard.tsx keeps it. The state compared is what the view itself
 * shows: the board (hub, direction, day), every filter control, the search box, the rows it paints
 * and the ask answer.
 *
 * What is stubbed: the schedule API (a small fixed board per hub and direction), the live feed,
 * the fleet, weather, IROPS and watch stores. Not covered: the rest of Dashboard.tsx, a real page
 * load, and the board's own loading policy.
 *
 * Also pinned: a hub link followed while Schedule is showing changes the board and keeps the
 * filters (ruling 2), and the error boundary's remount does not replay the last arrival's reset
 * over an answer applied since.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useCallback, useEffect, useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { DashLink } from '../src/app/features/DashLink';
import { __peekAskStateForTests, __resetAskStateForTests, setAskResult } from '../src/app/state/ask';
import { useDeepLinks } from '../src/app/state/deep-links';
import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider, useSchedule } from '../src/app/state/schedule';
import type { ScheduleValue } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';
import type { TabId } from '../src/app/tabs';
import ScheduleView from '../src/app/views/ScheduleView';
import { defaultSchedDayOffset } from '../src/lib/hubTz.js';

vi.mock('../src/app/state/watch', () => ({
  useWatch: () => ({ watched: [], isWatched: () => false, toggle: () => {}, add: () => true }),
}));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));
vi.mock('../src/app/state/feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/feed')>()),
  useFeed: () => ({ flights: [], lastGoodTs: null, lookupReg: () => null }),
}));
vi.mock('../src/app/state/fleet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/fleet')>()),
  useFleet: () => FLEET,
}));
vi.mock('../src/app/state/weather', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/weather')>()),
  useWeather: () => ({ faaIndex: {}, weatherOpsByHub: {}, nas: null }),
}));
vi.mock('../src/app/state/irops', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/irops')>()),
  useIrops: () => ({ data: null, hubRates: {} }),
}));
vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchSchedule: (params: { hub: string; dir: string; timestamp: number }) => Promise.resolve(board(params)),
}));

const FLEET = vi.hoisted(() => ({
  fleetDb: [],
  fleetByReg: {},
  starlink: { tails: new Set<string>(), flightsByTail: {}, stats: null, aircraft: [], lastUpdated: null, syncedAt: null, degraded: false },
  fleetSummary: null,
  special: new Map(),
  loading: false,
  loadFailed: false,
  retry: () => {},
  expressDb: [],
  expressByReg: {},
  expressStatus: 'ready',
}));

/**
 * One board per hub and direction: three flights late in the hub's day (so none has left), one of
 * them canceled and one international, on two aircraft types. The numbers say which board they
 * are on (UA1 ORD, UA2 DEN…; the second digit 1 departures, 2 arrivals).
 */
function board({ hub, dir, timestamp }: { hub: string; dir: string; timestamp: number }) {
  const n = { ORD: 1, DEN: 2, SFO: 3 }[hub] ?? 9;
  const d = dir === 'arrivals' ? 2 : 1;
  const at = timestamp + 22 * 3600;
  const row = (i: number, other: string, code: string, status: string) => ({
    identification: { number: { default: `UA${n}${d}${i}` } },
    status: { text: status },
    aircraft: { model: { code, text: code } },
    airport:
      dir === 'arrivals'
        ? { origin: { code: { iata: other } }, destination: { code: { iata: hub } } }
        : { origin: { code: { iata: hub } }, destination: { code: { iata: other } } },
    time: { scheduled: { departure: at + i * 600, arrival: at + i * 600 + 3 * 3600 } },
  });
  return {
    flights: [row(1, 'LAX', 'B738', 'Scheduled'), row(2, 'LHR', 'B789', 'Canceled'), row(3, 'BOS', 'B738', 'Scheduled')],
    meta: { generatedAt: new Date().toISOString() },
  };
}

const seen: { ui: UiValue | null; schedule: ScheduleValue | null; remount: (() => void) | null } = {
  ui: null,
  schedule: null,
  remount: null,
};

/** Dashboard.tsx's deep-link wiring and its keep-mounted-once-visited Schedule view. */
function Shell({ href }: { href: string }) {
  const ui = useUi();
  const schedule = useSchedule();
  seen.ui = ui;
  seen.schedule = schedule;
  const { setCurrent } = schedule;
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set<TabId>([ui.tab]));
  // The error boundary's "Try again" remounts the view under a new key.
  const [generation, setGeneration] = useState(0);
  seen.remount = () => setGeneration((g) => g + 1);
  useEffect(() => {
    setVisited((current) => (current.has(ui.tab) ? current : new Set(current).add(ui.tab)));
  }, [ui.tab]);

  useDeepLinks({
    flights: [],
    setTab: ui.setTab,
    select: ui.select,
    openAircraft: ui.openAircraft,
    openFr24: ui.openFr24,
    setWaitlistOpen: ui.setWaitlistOpen,
    setScheduleHub: useCallback((hub: string) => setCurrent({ hub }), [setCurrent]),
    announce: ui.announce,
    addWatch: () => true,
  });

  return (
    <>
      <DashLink href={href}>follow</DashLink>
      {visited.has('schedule') || ui.tab === 'schedule' ? (
        <div data-testid="schedule-panel" hidden={ui.tab !== 'schedule'}>
          <ScheduleView key={generation} />
        </div>
      ) : null}
    </>
  );
}

function mountAt(url: string, href: string) {
  window.history.replaceState(null, '', url);
  render(
    <UiProvider>
      <ScheduleProvider defaultHub="ORD">
        <FollowProvider>
          <TooltipProvider>
            <Shell href={href} />
          </TooltipProvider>
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
}

/** Let the board load, the 120 ms filter debounce run and the ask settle. */
async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));
  }
}

/** What the Schedule view shows, read back from its own controls and rows. */
function state() {
  const panel = document.querySelector<HTMLElement>('[data-testid="schedule-panel"]');
  const control = (id: string) => panel?.querySelector(`#${id}`)?.textContent ?? null;
  return {
    tab: seen.ui!.tab,
    hub: seen.schedule!.current.hub,
    dir: seen.schedule!.current.dir,
    day: seen.schedule!.current.day,
    find: panel?.querySelector<HTMLInputElement>('input[aria-label="Find in board"]')?.value ?? null,
    status: control('sched-status'),
    aircraft: control('sched-aircraft'),
    fleetFamily: control('sched-fleet-family'),
    routeType: control('sched-route-type'),
    wifi: control('sched-starlink'),
    timeRange: control('sched-timerange'),
    risk: control('sched-risk'),
    rows: panel ? [...panel.querySelectorAll('[data-flight-row]')].map((row) => row.getAttribute('data-flight-row')) : null,
    ask: __peekAskStateForTests().result,
  };
}

/** Pick an option from one of the board's advanced-filter selects, as a mouse does. */
async function pick(id: string, option: string) {
  await act(async () => {
    fireEvent.pointerDown(document.getElementById(id)!, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  });
  const item = await screen.findByRole('option', { name: option });
  await act(async () => {
    fireEvent.click(item);
  });
}

/** Open the board's filter panel, set status, route type and Wi-Fi, and type a search. */
async function dirtyFilters() {
  fireEvent.click(screen.getByRole('button', { name: /^Filter: Fleet, Aircraft, Starlink/ }));
  await pick('sched-status', 'Canceled');
  await pick('sched-route-type', 'International Only');
  await pick('sched-starlink', 'Non-Starlink');
  fireEvent.change(screen.getByRole('textbox', { name: 'Find in board' }), { target: { value: 'UA' } });
  await settle();
}

async function cold(address: string) {
  mountAt(address, '/#stats');
  await settle();
  const result = state();
  cleanup();
  __resetAskStateForTests();
  return result;
}

async function follow() {
  fireEvent.click(screen.getByRole('link', { name: 'follow' }));
  await settle();
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= vi.fn();
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.releasePointerCapture ??= () => {};
  // The desktop board (its filter panel is inline, its rows a table): the view's one query.
  window.matchMedia = ((query: string) => ({
    matches: /min-width:\s*768px/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  __resetAskStateForTests();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  seen.ui = null;
  seen.schedule = null;
  seen.remount = null;
});

describe('a hub link arriving at Schedule ends where a cold load of its address ends', () => {
  it('/?tab=schedule&hub=DEN cold: DEN, Departures, its default day, no filter, every row', async () => {
    const coldState = await cold('/?tab=schedule&hub=DEN');
    expect(coldState).toMatchObject({
      tab: 'schedule',
      hub: 'DEN',
      dir: 'departures',
      day: defaultSchedDayOffset('DEN'),
      find: '',
      status: 'All Status',
      routeType: 'All Routes',
      wifi: 'All WiFi',
      ask: null,
    });
    expect(coldState.rows).toEqual(['UA211', 'UA212', 'UA213']);
  });

  it('from Stats, after the reader left the ORD board on Arrivals with filters set', async () => {
    const coldState = await cold('/?tab=schedule&hub=DEN');

    mountAt('/#schedule', '/?tab=schedule&hub=DEN');
    await settle();
    act(() => seen.schedule!.setCurrent({ dir: 'arrivals' }));
    await settle();
    await dirtyFilters();
    expect(state()).toMatchObject({ dir: 'arrivals', status: 'Canceled', routeType: 'International Only', find: 'UA' });
    expect(state().rows).toEqual(['UA122']);

    act(() => seen.ui!.setTab('stats'));
    await follow();

    expect(state()).toEqual(coldState);
  });

  it('from Stats, after the reader left the DEN board itself filtered: the four board filters go too', async () => {
    const coldState = await cold('/?tab=schedule&hub=DEN');

    // The board the link names, already showing: hub, direction and day do not change, so the
    // board-change reset never fires. Only the arrival's own reset can clear these.
    mountAt('/?tab=schedule&hub=DEN', '/?tab=schedule&hub=DEN');
    await settle();
    await dirtyFilters();
    expect(state()).toMatchObject({ hub: 'DEN', dir: 'departures', routeType: 'International Only', wifi: 'Non-Starlink' });

    act(() => seen.ui!.setTab('stats'));
    await follow();

    expect(state()).toEqual(coldState);
  });

  it('from Stats, with an answer to "Ask the board" applied on that same board: the answer goes', async () => {
    const coldState = await cold('/?tab=schedule&hub=DEN');

    mountAt('/?tab=schedule&hub=DEN', '/?tab=schedule&hub=DEN');
    await settle();
    act(() => {
      setAskResult({ view: 'schedule', filters: { hub: 'DEN', direction: 'departures', status: 'canceled' } }, 'rules');
    });
    await settle();
    expect(state().ask).not.toBeNull();
    expect(state()).toMatchObject({ hub: 'DEN', status: 'Canceled' });

    act(() => seen.ui!.setTab('stats'));
    await follow();

    expect(state()).toEqual(coldState);
  });

  it('on a first visit to Schedule: the view the link mounts lands as cold', async () => {
    const coldState = await cold('/?tab=schedule&hub=DEN');
    mountAt('/#stats', '/?tab=schedule&hub=DEN');
    await settle();
    expect(document.querySelector('[data-testid="schedule-panel"]')).toBeNull();

    await follow();

    expect(state()).toEqual(coldState);
  });
});

describe('what the arrival reset leaves alone', () => {
  it('a hub link followed while Schedule is showing changes the board and keeps every filter (ruling 2)', async () => {
    mountAt('/#schedule', '/?tab=schedule&hub=DEN');
    await settle();
    await dirtyFilters();

    await follow();

    expect(state()).toMatchObject({
      tab: 'schedule',
      hub: 'DEN',
      dir: 'departures',
      day: defaultSchedDayOffset('DEN'),
      status: 'Canceled',
      find: 'UA',
    });
    expect(seen.ui!.scheduleLink).toBeNull();
  });

  it("the error boundary's remount does not replay the last arrival over an answer applied since", async () => {
    mountAt('/#stats', '/?tab=schedule&hub=DEN');
    await settle();
    await follow();
    expect(seen.ui!.scheduleLink?.seq).toBe(1);

    act(() => {
      setAskResult({ view: 'schedule', filters: { hub: 'DEN', direction: 'departures', status: 'canceled' } }, 'rules');
    });
    await settle();
    expect(state()).toMatchObject({ status: 'Canceled' });

    act(() => seen.remount!());
    await settle();

    expect(state().ask).not.toBeNull();
    expect(state()).toMatchObject({ hub: 'DEN', status: 'Canceled', rows: ['UA212'] });
  });
});
