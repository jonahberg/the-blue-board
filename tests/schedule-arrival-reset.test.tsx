// @vitest-environment jsdom
/**
 * Ruling 9 for the Schedule board (links everywhere, part 2): a hub link that arrives at Schedule
 * from another tab ends where a cold load of the same address ends, even when the reader left the
 * board dirty (filters set, Arrivals showing, an "Ask the board" answer applied).
 *
 * Both arms run the real ScheduleView on the real UiProvider, ScheduleProvider and FollowProvider,
 * with `useDeepLinks` wired as Dashboard.tsx wires it (the cold load's reader) and the view kept
 * mounted once visited, as Dashboard.tsx keeps it. The state compared is what the view itself
 * shows: the board (hub, direction, day), every filter control, the search box, the sort (a cold
 * load is Time ascending, the one sort with the NOW line and the scroll to it), the rows it paints
 * and the ask answer.
 *
 * What is stubbed: the schedule API (a small fixed board per hub and direction), the live feed,
 * the fleet, weather, IROPS and watch stores. Not covered: the rest of Dashboard.tsx, a real page
 * load, and the board's own loading policy.
 *
 * Also pinned: a hub link followed while Schedule is showing changes the board and keeps the
 * reader's status, type and search (ruling 2; the new board still resets its four board filters,
 * as any board change does), and the error boundary's remount does not replay the last arrival's
 * reset over an answer applied since.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useCallback, useEffect, useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Each case mounts the whole view and waits out real debounces (about 2 s alone); under a loaded
// machine that has measured three times as long, past the 5 s default.
vi.setConfig({ testTimeout: 20_000 });

import { TooltipProvider } from '@/components/ui/tooltip';
import { DashLink } from '../src/app/features/DashLink';
import { __peekAskStateForTests, __resetAskStateForTests, setAskResult } from '../src/app/state/ask';
import { useDeepLinks } from '../src/app/state/deep-links';
import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider, boardKey, useSchedule } from '../src/app/state/schedule';
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
 * One board per hub and direction: one flight that left early in the hub's day, then three late
 * in it (so none of those has left), one of them canceled and one international, on two aircraft
 * types. The clock is held mid-afternoon at every hub (below), so the board is today's and its
 * NOW line falls after the first row. The numbers say which board they are on (UA1 ORD, UA2 DEN…;
 * the second digit 1 departures, 2 arrivals).
 */
function board({ hub, dir, timestamp }: { hub: string; dir: string; timestamp: number }) {
  const n = { ORD: 1, DEN: 2, SFO: 3 }[hub] ?? 9;
  const d = dir === 'arrivals' ? 2 : 1;
  const at = timestamp + 22 * 3600;
  const row = (i: number, other: string, code: string, status: string, departure = at + i * 600) => ({
    identification: { number: { default: `UA${n}${d}${i}` } },
    status: { text: status },
    aircraft: { model: { code, text: code } },
    airport:
      dir === 'arrivals'
        ? { origin: { code: { iata: other } }, destination: { code: { iata: hub } } }
        : { origin: { code: { iata: hub } }, destination: { code: { iata: other } } },
    time: { scheduled: { departure, arrival: departure + 3 * 3600 } },
  });
  return {
    flights: [
      row(0, 'MSP', 'B738', 'Departed', timestamp + 3600),
      row(1, 'LAX', 'B738', 'Scheduled'),
      row(2, 'LHR', 'B789', 'Canceled'),
      row(3, 'BOS', 'B738', 'Scheduled'),
    ],
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
    sort: sortedBy(panel),
    rows: panel ? [...panel.querySelectorAll('[data-flight-row]')].map((row) => row.getAttribute('data-flight-row')) : null,
    ask: __peekAskStateForTests().result,
  };
}

/** The column the table is sorted by and which way, from its header ("Time ascending"). */
function sortedBy(panel: HTMLElement | null) {
  const th = panel?.querySelector('th[aria-sort="ascending"], th[aria-sort="descending"]');
  return th ? `${th.textContent?.replace(/[↑↓↕]/g, '').trim()} ${th.getAttribute('aria-sort')}` : null;
}

/** Sort the table by a column, as a click on its header does. */
function sortBy(label: string) {
  const th = [...document.querySelectorAll('th[aria-sort]')].find((el) => el.textContent?.replace(/[↑↓↕]/g, '').trim() === label)!;
  fireEvent.click(th.querySelector('button')!);
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

/**
 * Every scroll of the board's table, as the row it was sent to. jsdom has no layout, so each row
 * is given an `offsetTop` from its index (100 + 40 per row) and `scrollTo` records which row the
 * table aimed at (ScheduleTable scrolls to a row's `offsetTop` less 60).
 */
const scrolls: number[] = [];
const ROW_TOP = (index: number) => 100 + 40 * index;
const offsetTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
const scrollToBefore = Element.prototype.scrollTo;

/** The row the NOW divider sits above, the one a cold load of today's board scrolls to. */
function nowRow(): number {
  const divider = document.querySelector('[data-testid="schedule-panel"] tr[aria-label="Current time marker"]');
  return Number(divider?.nextElementSibling?.getAttribute('data-row-index'));
}

/** A frame, then the scroll the table asked for in it. */
async function frames() {
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
}

beforeAll(() => {
  // Mid-afternoon at every hub the tests use (ORD 14:00, DEN 13:00, SFO 12:00): the default day
  // is today, the one board with a NOW line.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T20:00:00Z'));
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const index = this.getAttribute('data-row-index');
      return index === null ? 0 : ROW_TOP(Number(index));
    },
  });
  Element.prototype.scrollTo = function (this: Element, options?: ScrollToOptions | number) {
    if (this.getAttribute('aria-label') !== 'Schedule table, scrollable region' || typeof options !== 'object') return;
    scrolls.push(((options.top ?? 0) + 60 - 100) / 40);
    (this as HTMLElement).scrollTop = options.top ?? 0;
  } as typeof Element.prototype.scrollTo;
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
  scrolls.length = 0;
});

afterAll(() => {
  vi.useRealTimers();
  if (offsetTopDescriptor) Object.defineProperty(HTMLElement.prototype, 'offsetTop', offsetTopDescriptor);
  Element.prototype.scrollTo = scrollToBefore;
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
      sort: 'Time ascending',
      ask: null,
    });
    expect(coldState.rows).toEqual(['UA210', 'UA211', 'UA212', 'UA213']);
  });

  it('from Stats, after the reader left the ORD board on Arrivals with filters set', async () => {
    const coldState = await cold('/?tab=schedule&hub=DEN');

    mountAt('/#schedule', '/?tab=schedule&hub=DEN');
    await settle();
    act(() => seen.schedule!.setCurrent({ dir: 'arrivals' }));
    await settle();
    await dirtyFilters();
    sortBy('Flight');
    await settle();
    expect(state()).toMatchObject({ dir: 'arrivals', status: 'Canceled', routeType: 'International Only', find: 'UA', sort: 'Flight ascending' });
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

  it("another view's answer to \"Ask the board\" survives an arrival at a Schedule view already mounted", async () => {
    mountAt('/#schedule', '/?tab=schedule&hub=DEN');
    await settle();
    act(() => seen.ui!.setTab('live'));
    act(() => {
      setAskResult({ view: 'live', filters: { starlink: true } }, 'rules');
    });
    const liveAnswer = __peekAskStateForTests().result;
    expect(liveAnswer).toMatchObject({ view: 'live' });

    await follow();

    expect(seen.ui!.tab).toBe('schedule');
    expect(__peekAskStateForTests().result).toEqual(liveAnswer);
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

describe('an arrival scrolls the board to NOW, as a cold load does, and only an arrival', () => {
  /** The table's scroll container, where the reader scrolls by hand. */
  const scroller = () =>
    document.querySelector<HTMLElement>('[data-testid="schedule-panel"] [aria-label="Schedule table, scrollable region"]')!;

  /** Mount on ORD's board, then look at DEN's once, so both are loaded this session; back on ORD. */
  async function loadDenThenOrd() {
    mountAt('/#schedule', '/?tab=schedule&hub=DEN');
    await settle();
    act(() => seen.schedule!.setCurrent({ hub: 'DEN' }));
    await settle();
    act(() => seen.schedule!.setCurrent({ hub: 'ORD' }));
    await settle();
  }

  it('a cold load scrolls to the row under the NOW line once (what an arrival must match)', async () => {
    mountAt('/?tab=schedule&hub=DEN', '/#stats');
    await settle();
    await frames();
    expect(nowRow()).toBe(1);
    expect(scrolls).toEqual([1]);
  });

  it('(a) the board was already loaded this session: the arrival scrolls to NOW once', async () => {
    await loadDenThenOrd();
    act(() => seen.ui!.setTab('stats'));
    scroller().scrollTop = 0;
    scrolls.length = 0;

    await follow();
    await frames();

    expect(seen.schedule!.current.hub).toBe('DEN');
    expect(scrolls).toEqual([nowRow()]);
    expect(nowRow()).toBe(1);
  });

  it('(b) the board loads fresh: the store’s own fresh-load scroll runs, and the arrival adds none', async () => {
    mountAt('/#schedule', '/?tab=schedule&hub=DEN');
    await settle();
    act(() => seen.ui!.setTab('stats'));
    scrolls.length = 0;

    await follow();
    await frames();

    expect(seen.schedule!.current.hub).toBe('DEN');
    expect(scrolls).toEqual([nowRow()]);
  });

  it('(c) a hub link followed while Schedule is showing does not scroll', async () => {
    await loadDenThenOrd();
    scroller().scrollTop = 0;
    scrolls.length = 0;

    await follow();
    await frames();

    expect(seen.schedule!.current.hub).toBe('DEN');
    expect(seen.ui!.scheduleLink).toBeNull();
    expect(scrolls).toEqual([]);
  });

  it('(e) a first visit to Schedule, to a board the idle preload loaded: one scroll, to the row under NOW', async () => {
    // The store's idle warm-up (ORD, DEN, EWR departures) runs on `requestIdleCallback`, which
    // jsdom lacks; give it one for this mount. The preload commits boards and raises no scroll.
    const idle = (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback;
    (window as unknown as { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback = (cb) =>
      setTimeout(cb, 0) as unknown as number;
    try {
      mountAt('/#stats', '/?tab=schedule&hub=DEN');
      await settle();
    } finally {
      (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback = idle;
    }
    expect(seen.schedule!.boards[boardKey('DEN', 'departures', 0)]).toBeTruthy();
    expect(document.querySelector('[data-testid="schedule-panel"]')).toBeNull();
    scrolls.length = 0;

    await follow();
    await frames();

    expect(seen.schedule!.current.hub).toBe('DEN');
    expect(scrolls).toEqual([nowRow()]);
    expect(nowRow()).toBe(1);
  });

  it('(f) a first visit to Schedule, to a board that loads fresh: one scroll, the store’s', async () => {
    mountAt('/#stats', '/?tab=schedule&hub=DEN');
    await settle();
    expect(seen.schedule!.boards[boardKey('DEN', 'departures', 0)]).toBeUndefined();
    scrolls.length = 0;

    await follow();
    await frames();

    expect(seen.schedule!.current.hub).toBe('DEN');
    expect(scrolls).toEqual([nowRow()]);
  });

  it('(d) once arrived, the reader scrolls by hand: the board refreshing under them scrolls nothing', async () => {
    await loadDenThenOrd();
    act(() => seen.ui!.setTab('stats'));
    scrolls.length = 0;
    await follow();
    await frames();
    expect(scrolls).toEqual([nowRow()]);

    scroller().scrollTop = 777;
    scrolls.length = 0;
    // What a poll does to the view: the model rebuilt (the feed stub hands a new list each render)
    // on a render the view did not ask for.
    act(() => seen.ui!.announce('a poll landed'));
    await settle();
    await frames();

    expect(scrolls).toEqual([]);
    expect(scroller().scrollTop).toBe(777);
  });
});

describe('what the arrival reset leaves alone', () => {
  it('a hub link followed while Schedule is showing keeps status, type, search and the sort (ruling 2)', async () => {
    mountAt('/#schedule', '/?tab=schedule&hub=DEN');
    await settle();
    await dirtyFilters();
    sortBy('Flight');
    await settle();

    await follow();

    expect(state()).toMatchObject({
      tab: 'schedule',
      hub: 'DEN',
      dir: 'departures',
      day: defaultSchedDayOffset('DEN'),
      // What the reader is looking for stays.
      status: 'Canceled',
      find: 'UA',
      sort: 'Flight ascending',
      // The board changed (ORD to DEN), so its four board filters reset, as any board change
      // resets them (ScheduleView's [hub, dir, day] effect). Not the arrival reset: no seq.
      routeType: 'All Routes',
      wifi: 'All WiFi',
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
