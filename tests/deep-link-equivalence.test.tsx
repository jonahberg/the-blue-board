// @vitest-environment jsdom
/**
 * The spec's third guard: a dashboard address opened cold and the same address clicked in place
 * end in the same state (docs/superpowers/specs/2026-11-12-links-everywhere-design.md, "Guards").
 *
 * Both arms run the dashboard's real stores and readers:
 *  - the real UiProvider and ScheduleProvider (tab, Schedule board, aircraft dialog, Fleet link);
 *  - `useDeepLinks` wired exactly as Dashboard.tsx wires it (the cold load's reader);
 *  - the real FleetView, mounted on the first visit to the Fleet tab and kept mounted after, as
 *    Dashboard.tsx does (it reads `?type=` / `?filter=` / `?view=` itself, and the followed link);
 *  - a real DashLink for the in-place click.
 * What is stubbed: the fleet database and the live feed (a small fixed database), the watch list
 * and watched-flight alerts (the Schedule store's collaborators; the real ones poll), and fetch.
 *
 * What this does NOT cover: the rest of Dashboard.tsx (the shell, the lazy tab registry, the other
 * views and providers), the Schedule board's own loading, and anything a real browser adds (the
 * address bar, history, a real page load). An in-place click does not rewrite the query
 * (Task 3 ruling), so the two arms differ in `location.search`; that is not compared.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useCallback, useEffect, useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashLink } from '../src/app/features/DashLink';
import { useDeepLinks } from '../src/app/state/deep-links';
import type { FeedValue } from '../src/app/state/feed';
import type { FleetValue } from '../src/app/state/fleet';
import { ScheduleProvider, useSchedule } from '../src/app/state/schedule';
import type { ScheduleValue } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';
import type { TabId } from '../src/app/tabs';
import FleetView from '../src/app/views/FleetView';

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
        <Shell href={href} />
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
    aircraft: seen.ui!.aircraftReg,
    fleetType: lookup?.querySelector('[aria-label="Fleet type filter"]')?.textContent ?? null,
    fleetStatus: lookup?.querySelector('[aria-label="Fleet status filter"]')?.textContent ?? null,
    fleetSubView: lookup?.querySelector('[role="tab"][data-state="active"]')?.textContent ?? null,
    fleetRows: panel ? panel.querySelectorAll('tbody tr').length : null,
  };
}

/** Open `address` cold. */
function cold(address: string) {
  mountAt(address, '/#stats');
  const result = state();
  cleanup();
  return result;
}

/**
 * Start on Stats at `/`, then click a link to `address`. `fleetVisited` visits Fleet first, so the
 * view is already mounted; `fleetLeftOn` also leaves it on that sub-view tab before going to Stats.
 */
function inPlace(address: string, { fleetVisited = false, fleetLeftOn = null as RegExp | null } = {}) {
  mountAt('/#stats', address);
  if (fleetVisited || fleetLeftOn) {
    act(() => seen.ui!.setTab('fleet'));
    if (fleetLeftOn) {
      const tab = [...document.querySelectorAll<HTMLElement>('#fleet-lookup-zone [role="tab"]')].find((el) =>
        fleetLeftOn.test(el.textContent ?? ''),
      )!;
      fireEvent.mouseDown(tab, { button: 0 });
      expect(state().fleetSubView).toMatch(fleetLeftOn);
    }
    act(() => seen.ui!.setTab('stats'));
  }
  expect(seen.ui!.tab).toBe('stats');
  fireEvent.click(screen.getByRole('link', { name: 'follow' }));
  expect(reachedDocumentPrevented, 'the click was followed in place').toBe(true);
  const result = state();
  cleanup();
  return result;
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
  it('/?tab=schedule&hub=DEN: the Schedule tab on the DEN board', () => {
    const coldState = cold('/?tab=schedule&hub=DEN');
    expect(coldState).toMatchObject({ tab: 'schedule', scheduleHub: 'DEN', aircraft: null });
    expect(inPlace('/?tab=schedule&hub=DEN')).toEqual(coldState);
  });

  it('/?tab=fleet&type=A319: the Fleet tab filtered to the A319', () => {
    const coldState = cold('/?tab=fleet&type=A319');
    expect(coldState).toMatchObject({
      tab: 'fleet',
      fleetType: expect.stringContaining('A319'),
      fleetSubView: expect.stringMatching(/^All Aircraft/),
      fleetRows: 6,
    });
    // Mounted by the click (first visit) and already mounted (an earlier visit).
    expect(inPlace('/?tab=fleet&type=A319')).toEqual(coldState);
    expect(inPlace('/?tab=fleet&type=A319', { fleetVisited: true })).toEqual(coldState);
    // Left on a sub-view that would not show the filter: the link opens All Aircraft, as cold.
    expect(inPlace('/?tab=fleet&type=A319', { fleetLeftOn: /^United Express/ })).toEqual(coldState);
    expect(inPlace('/?tab=fleet&type=A319', { fleetLeftOn: /^Special/ })).toEqual(coldState);
  });

  it('/?tab=fleet&view=special: the Fleet tab on the Special sub-view, unfiltered', () => {
    const coldState = cold('/?tab=fleet&view=special');
    expect(coldState).toMatchObject({
      tab: 'fleet',
      fleetType: expect.stringContaining('All Types'),
      fleetSubView: expect.stringMatching(/^Special/),
    });
    expect(inPlace('/?tab=fleet&view=special')).toEqual(coldState);
    expect(inPlace('/?tab=fleet&view=special', { fleetVisited: true })).toEqual(coldState);
  });

  it('/?aircraft=N78501: both open the aircraft dialog; the tab is the one stated difference', () => {
    const coldState = cold('/?aircraft=N78501');
    const clicked = inPlace('/?aircraft=N78501');
    expect(coldState.aircraft).toBe('N78501');
    expect(clicked.aircraft).toBe('N78501');
    // Cold: the default tab. In place: the tab you were on (an aircraft link is an overlay).
    expect(coldState.tab).toBe('live');
    expect(clicked.tab).toBe('stats');
    expect({ ...clicked, tab: coldState.tab }).toEqual(coldState);
  });
});
