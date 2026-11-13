// @vitest-environment jsdom
/**
 * The spec's third guard: a dashboard address opened cold and the same address clicked in place
 * end in the same state (docs/superpowers/specs/2026-11-12-links-everywhere-design.md, "Guards").
 *
 * Both arms run the dashboard's real stores and readers:
 *  - the real UiProvider and ScheduleProvider (tab, Schedule board, aircraft dialog, Fleet link),
 *    and the real FollowProvider, which follows the link;
 *  - `useDeepLinks` wired exactly as Dashboard.tsx wires it (the cold load's reader);
 *  - the real FleetView, mounted on the first visit to the Fleet tab and kept mounted after, as
 *    Dashboard.tsx does (it reads `?type=` / `?filter=` / `?view=` itself, and the followed link);
 *  - a real DashLink for the in-place click.
 * The Fleet cases also start from a Fleet tab the visitor has already filtered (type, Wi-Fi, search,
 * the Express search, left on United Express): a followed link first puts the tab back where a cold
 * load starts, so that history does not show.
 * What is stubbed: the fleet database and the live feed (a small fixed database), the watch list
 * and watched-flight alerts (the Schedule store's collaborators; the real ones poll), and fetch.
 *
 * A link followed on the tab already showing is not an arrival and is not compared with a cold
 * load: it changes what it names and keeps the rest (the links plan, ruling 2), pinned at the end.
 * So is a cold load's Fleet address that a link followed before the fleet data landed has taken out
 * of the address bar: it still applies (the UI store holds it from startup).
 *
 * What this does NOT cover: the rest of Dashboard.tsx (the shell, the lazy tab registry, the other
 * views and providers), the Schedule board's own loading, and anything a real browser adds (the
 * address bar, history, a real page load). The two arms' addresses differ by design and are not
 * compared: a cold load keeps its query, and an in-place click that changes the tab leaves a new
 * history entry without the dashboard's own parameters (tests/follow-link-tabs.test.tsx).
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useCallback, useEffect, useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashLink } from '../src/app/features/DashLink';
import { useDeepLinks } from '../src/app/state/deep-links';
import { FollowProvider } from '../src/app/state/follow-link';
import type { FeedValue } from '../src/app/state/feed';
import type { FleetValue } from '../src/app/state/fleet';
import { ScheduleProvider, useSchedule } from '../src/app/state/schedule';
import type { ScheduleValue } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';
import type { TabId } from '../src/app/tabs';
import FleetView from '../src/app/views/FleetView';
import { defaultSchedDayOffset } from '../src/lib/hubTz.js';

vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ watched: [], add: () => true }) }));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));
vi.mock('../src/app/state/fleet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/fleet')>()),
  useFleet: () => FLEET,
}));
vi.mock('../src/app/state/feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/feed')>()),
  useFeed: () => ({ flights: [], lastGoodTs: null }) as unknown as FeedValue,
}));

const FLEET_DB = [
  ...Array.from({ length: 6 }, (_, i) => ({ r: `N10${i}UA`, t: 'A319', w: 'Satl Ku', s: '', d: '2000' })),
  { r: 'N78501', t: '777-200ER', w: 'Satl Ku', s: '', d: '1998' },
  { r: 'N37502', t: '737 MAX 9', w: 'Starlink', s: '', d: '2018' },
];
const FLEET = vi.hoisted(() => ({}) as FleetValue);
Object.assign(FLEET, {
  fleetDb: FLEET_DB,
  fleetByReg: Object.fromEntries(FLEET_DB.map((a) => [a.r, a])),
  starlink: { tails: new Set(['N37502']), flightsByTail: {}, stats: null, aircraft: [], lastUpdated: null, syncedAt: null, degraded: false },
  fleetSummary: null,
  special: new Map(),
  loading: false,
  loadFailed: false,
  retry: () => {},
  expressDb: [],
  expressByReg: {},
  expressStatus: 'ready',
});

/** The two stores as the last render saw them. */
const seen: { ui: UiValue | null; schedule: ScheduleValue | null } = { ui: null, schedule: null };

/** Dashboard.tsx's deep-link wiring and its keep-mounted-once-visited Fleet view, and nothing else. */
function Shell({ href }: { href: string }) {
  const ui = useUi();
  const schedule = useSchedule();
  seen.ui = ui;
  seen.schedule = schedule;
  const { setCurrent } = schedule;
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set<TabId>([ui.tab]));
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
      {visited.has('fleet') ? (
        <div data-testid="fleet-panel" data-active={ui.tab === 'fleet'}>
          <FleetView />
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
          <Shell href={href} />
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
}

/** Everything a link can set, read back from the stores and the Fleet view's own controls. */
function state() {
  const lookup = document.getElementById('fleet-lookup-zone');
  const panel = lookup?.querySelector('[role="tabpanel"][data-state="active"]');
  return {
    tab: seen.ui!.tab,
    scheduleHub: seen.schedule!.current.hub,
    scheduleDir: seen.schedule!.current.dir,
    scheduleDay: seen.schedule!.current.day,
    aircraft: seen.ui!.aircraftReg,
    fleetType: lookup?.querySelector('[aria-label="Fleet type filter"]')?.textContent ?? null,
    fleetStatus: lookup?.querySelector('[aria-label="Fleet status filter"]')?.textContent ?? null,
    fleetSubView: lookup?.querySelector('[role="tab"][data-state="active"]')?.textContent ?? null,
    fleetWifi: lookup?.querySelector('[aria-label="Fleet WiFi filter"]')?.textContent ?? null,
    fleetSearch: lookup?.querySelector<HTMLInputElement>('[aria-label="Fleet search"]')?.value ?? null,
    fleetRows: panel ? panel.querySelectorAll('tbody tr').length : null,
  };
}

/** Pick a Fleet sub-view tab, as a mouse does (Radix activates a trigger on a primary mouse-down). */
function openFleetSubView(name: RegExp) {
  const tab = [...document.querySelectorAll<HTMLElement>('#fleet-lookup-zone [role="tab"]')].find((el) =>
    name.test(el.textContent ?? ''),
  )!;
  fireEvent.mouseDown(tab, { button: 0 });
  expect(state().fleetSubView).toMatch(name);
}

/**
 * Every element scrolled into view since the address was opened or the link clicked (jsdom has no
 * `scrollIntoView`): `controls` for the Fleet controls row, `panel:<sub-view>` for a sub-view.
 */
const scrolls: string[] = [];
function recordScroll(this: Element) {
  if (this.id === 'fleet-controls') scrolls.push('controls');
  else if (this.getAttribute('role') === 'tabpanel') scrolls.push(`panel:${this.id.replace(/^.*-content-/, '')}`);
  else scrolls.push(this.id || this.tagName.toLowerCase());
}

/**
 * After the frame a scroll waits for: `state()`, where the tab scrolled, then the Express list's
 * own search, read by opening that sub-view (the last step, after the scroll is recorded).
 */
async function finalState() {
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const result = { ...state(), fleetScrolls: [...scrolls] };
  if (!document.getElementById('fleet-lookup-zone')) return { ...result, fleetExpressSearch: null };
  openFleetSubView(/^United Express/);
  const box = screen.getByRole('searchbox', { name: 'United Express search' }) as HTMLInputElement;
  return { ...result, fleetExpressSearch: box.value };
}

/** Open `address` cold. */
async function cold(address: string) {
  scrolls.length = 0;
  mountAt(address, '/#stats');
  const result = await finalState();
  cleanup();
  return result;
}

/**
 * Start on Stats at `/`, then click a link to `address`. `fleetVisited` visits Fleet first, so the
 * view is already mounted; `fleetLeftOn` also leaves it on that sub-view tab before going to Stats.
 */
async function inPlace(address: string, { fleetVisited = false, fleetLeftOn = null as RegExp | null } = {}) {
  mountAt('/#stats', address);
  if (fleetVisited || fleetLeftOn) {
    act(() => seen.ui!.setTab('fleet'));
    if (fleetLeftOn) openFleetSubView(fleetLeftOn);
    act(() => seen.ui!.setTab('stats'));
  }
  return followAndRead();
}

/** From Stats, click the link, and read the end state. */
async function followAndRead() {
  expect(seen.ui!.tab).toBe('stats');
  scrolls.length = 0;
  fireEvent.click(screen.getByRole('link', { name: 'follow' }));
  expect(reachedDocumentPrevented, 'the click was followed in place').toBe(true);
  const result = await finalState();
  cleanup();
  return result;
}

/** Pick an option from one of the Fleet controls' Radix selects, as a mouse does. */
async function pick(name: string, option: RegExp | string) {
  await act(async () => {
    fireEvent.pointerDown(screen.getByRole('combobox', { name }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  });
  const item = await screen.findByRole('option', { name: option });
  await act(async () => {
    fireEvent.click(item);
  });
}

/**
 * Start on Stats at `/` after a visit to Fleet that set every filter a visitor can set (type A319,
 * Wi-Fi, search text, the Express search) and left it on United Express, then click a link.
 */
async function inPlaceFromDirtyFleet(address: string) {
  mountAt('/#stats', address);
  act(() => seen.ui!.setTab('fleet'));
  await pick('Fleet type filter', /^A319/);
  await pick('Fleet WiFi filter', 'Satellite Ku');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Fleet search' }), { target: { value: 'N10' } });
  // The search box reports upward after its 120 ms debounce.
  await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
  expect(state()).toMatchObject({ fleetType: expect.stringContaining('A319'), fleetWifi: 'Satellite Ku', fleetSearch: 'N10' });
  openFleetSubView(/^United Express/);
  fireEvent.change(screen.getByRole('searchbox', { name: 'United Express search' }), { target: { value: 'skywest' } });
  act(() => seen.ui!.setTab('stats'));
  return followAndRead();
}

/**
 * Start on Stats at `/` after the reader has looked at the Schedule board on Arrivals for tomorrow
 * (a day no hub defaults to), then click a link.
 */
async function inPlaceFromDirtySchedule(address: string) {
  mountAt('/#stats', address);
  act(() => seen.ui!.setTab('schedule'));
  act(() => seen.schedule!.setCurrent({ dir: 'arrivals', day: 1 }));
  expect(seen.schedule!.current).toMatchObject({ dir: 'arrivals', day: 1 });
  act(() => seen.ui!.setTab('stats'));
  return followAndRead();
}

let reachedDocumentPrevented: boolean | null = null;
function recordClick(event: Event) {
  reachedDocumentPrevented = event.defaultPrevented;
  event.preventDefault();
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
  scrolls.length = 0;
  Element.prototype.scrollIntoView = recordScroll;
  window.history.replaceState(null, '', '/');
  reachedDocumentPrevented = null;
  document.addEventListener('click', recordClick);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in this test'))));
});

afterEach(() => {
  cleanup();
  document.removeEventListener('click', recordClick);
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  seen.ui = null;
  seen.schedule = null;
});

describe('a cold load and an in-place click of the same address end in the same state', () => {
  it('/?tab=schedule&hub=DEN: the Schedule tab on the DEN board, Departures, its default day', async () => {
    const coldState = await cold('/?tab=schedule&hub=DEN');
    expect(coldState).toMatchObject({
      tab: 'schedule',
      scheduleHub: 'DEN',
      scheduleDir: 'departures',
      scheduleDay: defaultSchedDayOffset('DEN'),
      aircraft: null,
      fleetScrolls: [],
    });
    expect(await inPlace('/?tab=schedule&hub=DEN')).toEqual(coldState);
    // Left on Arrivals for tomorrow: the link still opens DEN's departures on its default day.
    expect(await inPlaceFromDirtySchedule('/?tab=schedule&hub=DEN')).toEqual(coldState);
  });

  it('/?tab=fleet&type=A319: the Fleet tab filtered to the A319, scrolled to its controls row', async () => {
    const coldState = await cold('/?tab=fleet&type=A319');
    expect(coldState).toMatchObject({
      tab: 'fleet',
      fleetType: expect.stringContaining('A319'),
      fleetSubView: expect.stringMatching(/^All Aircraft/),
      fleetRows: 6,
      // The tab brings the reader to the filter it set, not the pulse cards at its top.
      fleetScrolls: ['controls'],
    });
    // Mounted by the click (first visit) and already mounted (an earlier visit).
    expect(await inPlace('/?tab=fleet&type=A319')).toEqual(coldState);
    expect(await inPlace('/?tab=fleet&type=A319', { fleetVisited: true })).toEqual(coldState);
    // Left on a sub-view that would not show the filter: the link opens All Aircraft, as cold.
    expect(await inPlace('/?tab=fleet&type=A319', { fleetLeftOn: /^United Express/ })).toEqual(coldState);
    expect(await inPlace('/?tab=fleet&type=A319', { fleetLeftOn: /^Special/ })).toEqual(coldState);
  });

  it('/?tab=fleet&view=special: the Fleet tab on the Special sub-view, unfiltered, scrolled to that panel', async () => {
    const coldState = await cold('/?tab=fleet&view=special');
    expect(coldState).toMatchObject({
      tab: 'fleet',
      fleetType: expect.stringContaining('All Types'),
      fleetSubView: expect.stringMatching(/^Special/),
      fleetScrolls: ['panel:special'],
    });
    expect(await inPlace('/?tab=fleet&view=special')).toEqual(coldState);
    expect(await inPlace('/?tab=fleet&view=special', { fleetVisited: true })).toEqual(coldState);
  });

  it.each(['/?tab=fleet&type=737%20MAX%209', '/?tab=fleet&view=special', '/?tab=fleet&filter=starlink'])(
    '%s followed from a Fleet tab with every filter set lands where the cold load does',
    async (address) => {
      const coldState = await cold(address);
      expect(coldState).toMatchObject({ fleetWifi: 'All WiFi', fleetSearch: '', fleetExpressSearch: '' });
      expect(coldState.fleetScrolls).toEqual([address.includes('view=') ? 'panel:special' : 'controls']);
      expect(await inPlaceFromDirtyFleet(address)).toEqual(coldState);
    },
  );

  it('/?tab=fleet&type=B789: a type the controls do not offer is ignored either way, and scrolls nowhere', async () => {
    const coldState = await cold('/?tab=fleet&type=B789');
    expect(coldState).toMatchObject({
      tab: 'fleet',
      fleetType: expect.stringContaining('All Types'),
      fleetRows: 8,
      fleetScrolls: [],
    });
    expect(await inPlace('/?tab=fleet&type=B789')).toEqual(coldState);
  });

  it('/?aircraft=N78501: both open the aircraft dialog; the tab is the one stated difference', async () => {
    const coldState = await cold('/?aircraft=N78501');
    const clicked = await inPlace('/?aircraft=N78501');
    expect(coldState.aircraft).toBe('N78501');
    expect(coldState.fleetScrolls).toEqual([]);
    expect(clicked.aircraft).toBe('N78501');
    // Cold: the default tab. In place: the tab you were on (an aircraft link is an overlay).
    expect(coldState.tab).toBe('live');
    expect(clicked.tab).toBe('stats');
    expect({ ...clicked, tab: coldState.tab }).toEqual(coldState);
  });
});

describe('a link followed on the tab already showing changes what it names and resets nothing (ruling 2)', () => {
  it('/?tab=fleet&type=737%20MAX%209 from a filtered Fleet tab: the type changes, Wi-Fi and search stay', async () => {
    mountAt('/#stats', '/?tab=fleet&type=737%20MAX%209');
    act(() => seen.ui!.setTab('fleet'));
    await pick('Fleet WiFi filter', 'Starlink');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Fleet search' }), { target: { value: 'N37' } });
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    const before = window.history.length;
    scrolls.length = 0;

    fireEvent.click(screen.getByRole('link', { name: 'follow' }));
    expect(reachedDocumentPrevented).toBe(true);
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

    expect(state()).toMatchObject({
      tab: 'fleet',
      fleetType: expect.stringContaining('737 MAX 9'),
      fleetWifi: 'Starlink',
      fleetSearch: 'N37',
      fleetRows: 1,
    });
    expect(scrolls).toEqual([]);
    expect(window.history.length).toBe(before);
  });

  it('/?tab=schedule&hub=DEN from the Schedule tab on Arrivals for tomorrow: the hub changes, the rest stays', () => {
    mountAt('/#stats', '/?tab=schedule&hub=DEN');
    act(() => seen.ui!.setTab('schedule'));
    act(() => seen.schedule!.setCurrent({ dir: 'arrivals', day: 1 }));

    fireEvent.click(screen.getByRole('link', { name: 'follow' }));

    expect(state()).toMatchObject({ tab: 'schedule', scheduleHub: 'DEN', scheduleDir: 'arrivals', scheduleDay: 1 });
    expect(seen.ui!.scheduleLink).toBeNull();
  });
});

describe("a cold load's Fleet address survives a link followed before the fleet data arrives", () => {
  it('/?tab=fleet&type=A319, a follow to Schedule, the data lands, then Fleet: filtered to the A319 as cold', async () => {
    const coldState = await cold('/?tab=fleet&type=A319');

    const loaded = { fleetDb: FLEET.fleetDb, fleetByReg: FLEET.fleetByReg, loading: FLEET.loading };
    Object.assign(FLEET, { fleetDb: [], fleetByReg: {}, loading: true });
    try {
      mountAt('/?tab=fleet&type=A319', '/?tab=schedule&hub=DEN');
      expect(seen.ui!.tab).toBe('fleet');
      expect(state().fleetRows).toBe(0);

      fireEvent.click(screen.getByRole('link', { name: 'follow' }));
      expect(seen.ui!.tab).toBe('schedule');
      // The follow's history entry dropped the dashboard's own parameters.
      expect(window.location.search).toBe('');

      // The fleet data lands while Schedule is showing (any render reads the store again).
      Object.assign(FLEET, loaded);
      act(() => seen.ui!.announce('fleet data landed'));
      act(() => seen.ui!.setTab('fleet'));
      const after = await finalState();
      cleanup();

      const fleetOnly = ({ fleetType, fleetStatus, fleetSubView, fleetWifi, fleetSearch, fleetRows, fleetExpressSearch }: typeof after) => ({
        fleetType,
        fleetStatus,
        fleetSubView,
        fleetWifi,
        fleetSearch,
        fleetRows,
        fleetExpressSearch,
      });
      expect(fleetOnly(after)).toEqual(fleetOnly(coldState));
      expect(after.fleetType).toContain('A319');
    } finally {
      Object.assign(FLEET, loaded);
    }
  });
});
