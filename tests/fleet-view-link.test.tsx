// @vitest-environment jsdom
/**
 * The Fleet tab follows a link in place (`useUi().followFleetLink`, src/app/views/FleetView.tsx),
 * and links once to the selected type's fleet page (the second "door", FleetControls).
 *
 * A followed link goes through the same `fleetDeepLinkTarget` path as a cold load of
 * `?type=` / `?filter=` / `?view=`: a known type sets the type filter and clears the status filter,
 * a known status sets the status filter, either opens All Aircraft unless the link names a view,
 * an unknown value changes nothing (filtering to nothing would read as "United has none"), a view
 * sets the sub-view. Before applying itself a followed link puts the tab back where a cold load
 * starts (search, Wi-Fi, status, type, the Express search, a Fleet "Ask the board" answer), so it
 * lands where the same address opened cold does. A link followed before the fleet database has
 * arrived is held and applied when it lands, and the same link followed twice applies twice (the
 * store counts follows in `seq`).
 *
 * Mounted in the real UiProvider; the fleet and feed stores are stubbed with a small database.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { __peekAskStateForTests, __resetAskStateForTests, setAskResult } from '../src/app/state/ask';
import type { FeedValue } from '../src/app/state/feed';
import type { FleetDeepLinks } from '../src/app/state/deep-links';
import type { FleetValue } from '../src/app/state/fleet';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';
import FleetView from '../src/app/views/FleetView';

const ctl = vi.hoisted(() => ({ fleet: null as unknown }));

vi.mock('../src/app/state/fleet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/fleet')>()),
  useFleet: () => ctl.fleet as FleetValue,
}));
vi.mock('../src/app/state/feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/feed')>()),
  useFeed: () => ({ flights: [], lastGoodTs: null }) as unknown as FeedValue,
}));
// The tab's names are in-place links (DashLink → useFollowDeepLink), which need the Schedule store
// and FollowProvider; these tests drive the Fleet link through the UI store, so no link is followed.
// The links themselves are tested with the real providers in tests/fleet-tab-links.test.tsx.
vi.mock('../src/app/state/follow-link', () => ({ useFollowDeepLink: () => () => {} }));

// 6 A319s and 2 737 MAX 9s, the MAX 9s on Starlink.
const FLEET_DB = [
  ...Array.from({ length: 6 }, (_, i) => ({ r: `N10${i}UA`, t: 'A319', w: 'Satl Ku', s: '', d: '2000' })),
  { r: 'N37502', t: '737 MAX 9', w: 'Starlink', s: '', d: '2018' },
  { r: 'N37503', t: '737 MAX 9', w: 'Starlink', s: '', d: '2018' },
];

function fleetValue(db: typeof FLEET_DB, loading = false): FleetValue {
  return {
    fleetDb: db,
    fleetByReg: Object.fromEntries(db.map((a) => [a.r, a])),
    starlink: {
      tails: new Set(['N37502', 'N37503']),
      flightsByTail: {},
      stats: null,
      aircraft: [],
      lastUpdated: null,
      syncedAt: null,
      degraded: false,
    },
    fleetSummary: null,
    special: new Map(),
    loading,
    loadFailed: false,
    retry: () => {},
    expressDb: [],
    expressByReg: {},
    expressStatus: 'ready',
  } as unknown as FleetValue;
}

/** The UI store as the last render saw it. */
const seen: { ui: UiValue | null } = { ui: null };
function Probe() {
  seen.ui = useUi();
  return null;
}

function mount() {
  return render(
    <UiProvider>
      <FleetView />
      <Probe />
    </UiProvider>,
  );
}

function follow(link: FleetDeepLinks) {
  act(() => seen.ui!.followFleetLink(link));
}

/** A link followed while the Fleet tab is already showing (`arriving: false`, ruling 2). */
function followHere(link: FleetDeepLinks) {
  act(() => seen.ui!.followFleetLink(link, { arriving: false }));
}

/** The registrations in the visible sub-view's table. */
function rows(): string[] {
  const panel = document.querySelector('#fleet-lookup-zone [role="tabpanel"][data-state="active"]');
  return [...(panel?.querySelectorAll('tbody tr') ?? [])].map((row) => row.querySelector('td')?.textContent ?? '');
}

const typeSelect = () => screen.getByRole('combobox', { name: 'Fleet type filter' });
const statusSelect = () => screen.getByRole('combobox', { name: 'Fleet status filter' });
const activeSubView = () =>
  document.querySelector('#fleet-lookup-zone [role="tab"][data-state="active"]')?.textContent ?? '';

/** The visitor picks a Fleet sub-view tab (Radix activates a trigger on a primary mouse-down). */
function openSubView(name: RegExp) {
  const tab = [...document.querySelectorAll<HTMLElement>('#fleet-lookup-zone [role="tab"]')].find((el) =>
    name.test(el.textContent ?? ''),
  );
  if (!tab) throw new Error(`no sub-view tab ${name}`);
  fireEvent.mouseDown(tab, { button: 0 });
  expect(activeSubView()).toMatch(name);
}

/** A Composition variant card: the button that IS the type filter. */
function typeCard(type: string): HTMLElement {
  const card = [...document.querySelectorAll<HTMLElement>('button[aria-pressed]')].find(
    (button) => button.lastElementChild?.textContent === type,
  );
  if (!card) throw new Error(`no variant card for ${type}`);
  return card;
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

/**
 * Every `scrollIntoView` (jsdom has none): which element, and how many rows the table showed at
 * that moment, so a test can tell the scroll came after the filter.
 */
const scrolls: { target: string; rows: number }[] = [];

/** A scrolled element, named the way a test reads it: `controls`, `panel:<sub-view>`, or its id. */
function scrollName(element: Element): string {
  if (element.id === 'fleet-controls') return 'controls';
  if (element.getAttribute('role') === 'tabpanel') return `panel:${element.id.replace(/^.*-content-/, '')}`;
  return element.id || element.tagName.toLowerCase();
}

/** Let the frame a scroll waits for go by. */
async function nextFrame() {
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

beforeEach(() => {
  ctl.fleet = fleetValue(FLEET_DB);
  window.history.replaceState(null, '', '/');
  scrolls.length = 0;
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrolls.push({ target: scrollName(this), rows: rows().length });
  };
});

afterEach(() => {
  cleanup();
  seen.ui = null;
  window.history.replaceState(null, '', '/');
  act(() => __resetAskStateForTests());
});

describe('FleetView follows a Fleet link in place', () => {
  it('a known type filters the table to that type', () => {
    mount();
    expect(rows()).toHaveLength(8);

    follow({ filter: 'A319', view: null });

    expect(rows()).toHaveLength(6);
    expect(rows().every((reg) => reg.startsWith('N10'))).toBe(true);
    expect(typeSelect().textContent).toContain('A319');
  });

  it('a type the controls do not offer is ignored, not filtered to nothing', () => {
    mount();
    follow({ filter: 'B789', view: null });
    expect(rows()).toHaveLength(8);
    expect(typeSelect().textContent).toContain('All Types');
  });

  it('a status value sets the status filter, and a later type link clears it', () => {
    mount();
    follow({ filter: 'starlink', view: null });
    expect(rows()).toEqual(['N37502', 'N37503']);
    expect(statusSelect().textContent).toContain('Starlink');

    follow({ filter: 'A319', view: null });
    expect(rows()).toHaveLength(6);
    expect(statusSelect().textContent).toContain('All Status');
  });

  it('a view opens that sub-view', () => {
    mount();
    expect(activeSubView()).toMatch(/^All Aircraft/);
    follow({ filter: null, view: 'special' });
    expect(activeSubView()).toMatch(/^Special/);
  });

  it.each([
    ['United Express', /^United Express/],
    ['Special', /^Special/],
  ])('a type followed from the %s sub-view opens All Aircraft filtered to that type, as a cold load does', (_, from) => {
    mount();
    openSubView(from);

    follow({ filter: 'A319', view: null });

    expect(activeSubView()).toMatch(/^All Aircraft/);
    expect(rows()).toHaveLength(6);
    expect(typeSelect().textContent).toContain('A319');
    expect(screen.getByRole('link', { name: 'About the A319' })).toBeTruthy();
  });

  it('a status value followed from United Express opens All Aircraft too', () => {
    mount();
    openSubView(/^United Express/);
    follow({ filter: 'starlink', view: null });
    expect(activeSubView()).toMatch(/^All Aircraft/);
    expect(rows()).toEqual(['N37502', 'N37503']);
  });

  it('a link that names its own sub-view keeps it: a filter with a view opens that view', () => {
    mount();
    openSubView(/^United Express/);
    follow({ filter: 'A319', view: 'airborne' });
    expect(activeSubView()).toMatch(/^Airborne Now/);
    expect(typeSelect().textContent).toContain('A319');
  });

  it('an unknown value changes nothing, the sub-view included', () => {
    mount();
    openSubView(/^United Express/);
    follow({ filter: 'B789', view: null });
    expect(activeSubView()).toMatch(/^United Express/);
    cleanup();

    mount();
    openSubView(/^Special/);
    follow({ filter: 'B789', view: null });
    expect(activeSubView()).toMatch(/^Special/);
    expect(typeSelect().textContent).toContain('All Types');
  });

  it('the same link followed again, after the visitor cleared the filter, applies again', () => {
    mount();
    follow({ filter: 'A319', view: null });
    expect(rows()).toHaveLength(6);

    // The visitor takes the filter off (the variant card toggles it).
    fireEvent.click(typeCard('A319'));
    expect(rows()).toHaveLength(8);

    follow({ filter: 'A319', view: null });
    expect(rows()).toHaveLength(6);
  });

  it('a link followed before the fleet database arrives is held, then applied when it lands', () => {
    ctl.fleet = fleetValue([], true);
    const view = mount();
    follow({ filter: 'A319', view: 'airborne' });
    expect(rows()).toHaveLength(0);

    ctl.fleet = fleetValue(FLEET_DB);
    view.rerender(
      <UiProvider>
        <FleetView />
        <Probe />
      </UiProvider>,
    );
    // rerender keeps the same UiProvider instance, so the queued link is still in the store.
    expect(seen.ui!.fleetLink?.seq).toBe(1);
    expect(activeSubView()).toMatch(/^Airborne Now/);
    expect(typeSelect().textContent).toContain('A319');
  });

  it('a link followed while a cold-load address waits for the database wins over that address', () => {
    // Opened on ?type=A319, the visitor follows a 737 MAX 9 link before the database lands: the
    // link they just clicked is what they asked for last.
    window.history.replaceState(null, '', '/?tab=fleet&type=A319');
    ctl.fleet = fleetValue([], true);
    const view = mount();
    follow({ filter: '737 MAX 9', view: null });

    ctl.fleet = fleetValue(FLEET_DB);
    view.rerender(
      <UiProvider>
        <FleetView />
        <Probe />
      </UiProvider>,
    );
    expect(rows()).toEqual(['N37502', 'N37503']);
  });

  it('a link already in the store when the view mounts is applied (the tab mounts on first visit)', () => {
    function Follower() {
      const ui = useUi();
      return (
        <button type="button" onClick={() => ui.followFleetLink({ filter: '737 MAX 9', view: null })}>
          follow first
        </button>
      );
    }
    function Lazy() {
      const { fleetLink } = useUi();
      return fleetLink ? <FleetView /> : null;
    }
    render(
      <UiProvider>
        <Follower />
        <Lazy />
      </UiProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'follow first' }));
    expect(rows()).toEqual(['N37502', 'N37503']);
  });
});

describe('the Fleet tab\'s one door to a type\'s fleet page', () => {
  const door = () => screen.queryByRole('link', { name: /^About the / });

  it('selecting 737 MAX 9 shows "About the 737 MAX 9", a plain link to its fleet page', () => {
    mount();
    fireEvent.click(typeCard('737 MAX 9'));
    const link = screen.getByRole('link', { name: 'About the 737 MAX 9' });
    expect(link.getAttribute('href')).toBe('/fleet/737-max-9');
    // It leaves the dashboard: same tab, no in-place handling, quiet (not link colour).
    expect(link.getAttribute('target')).toBeNull();
    expect(link.className.split(/\s+/)).not.toContain('text-primary');
    expect(link.className.split(/\s+/)).toContain('underline');
    // One door, not one per control.
    expect(screen.getAllByRole('link', { name: /^About the / })).toHaveLength(1);
  });

  it('follows the type a link selected', () => {
    mount();
    follow({ filter: 'A319', view: null });
    expect(door()?.getAttribute('href')).toBe('/fleet/a319');
  });

  it('shows none with no type selected, or with only a status filter', () => {
    mount();
    expect(door()).toBeNull();
    follow({ filter: 'starlink', view: null });
    expect(rows()).toHaveLength(2);
    expect(door()).toBeNull();
  });
});

describe('a followed link starts from where a cold load starts', () => {
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

  /** The search box reports upward after its 120 ms debounce. */
  async function typeSearch(value: string) {
    fireEvent.change(screen.getByRole('searchbox', { name: 'Fleet search' }), { target: { value } });
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
  }

  /** Every Fleet filter a visitor can set: type, Wi-Fi, search, the Express search; left on Express. */
  async function dirty() {
    await pick('Fleet type filter', /^A319/);
    await pick('Fleet WiFi filter', 'Satellite Ku');
    await typeSearch('N10');
    openSubView(/^United Express/);
    fireEvent.change(screen.getByRole('searchbox', { name: 'United Express search' }), { target: { value: 'skywest' } });
    expect(screen.getByRole('searchbox', { name: 'United Express search' })).toHaveProperty('value', 'skywest');
  }

  /** What the tab shows, then (switching to it) the Express search: everything a link can touch. */
  function fleetState() {
    const select = (name: string) => screen.queryByRole('combobox', { name })?.textContent ?? null;
    const snapshot = {
      subView: activeSubView(),
      type: select('Fleet type filter'),
      wifi: select('Fleet WiFi filter'),
      status: select('Fleet status filter'),
      search: (screen.queryByRole('searchbox', { name: 'Fleet search' }) as HTMLInputElement | null)?.value ?? null,
      rows: rows(),
      door: screen.queryByRole('link', { name: /^About the / })?.getAttribute('href') ?? null,
    };
    openSubView(/^United Express/);
    const expressSearch = (screen.getByRole('searchbox', { name: 'United Express search' }) as HTMLInputElement).value;
    return { ...snapshot, expressSearch };
  }

  function coldState(address: string) {
    window.history.replaceState(null, '', address);
    mount();
    const result = fleetState();
    cleanup();
    window.history.replaceState(null, '', '/');
    return result;
  }

  it.each([
    ['a type', '/?tab=fleet&type=737%20MAX%209', { filter: '737 MAX 9', view: null }],
    ['a view', '/?tab=fleet&view=special', { filter: null, view: 'special' }],
    ['a status filter', '/?tab=fleet&filter=starlink', { filter: 'starlink', view: null }],
  ] as const)('%s followed from a dirty Fleet tab lands where a cold load of %s does', async (_, address, link) => {
    const cold = coldState(address);
    expect(cold.search).toBe('');
    expect(cold.expressSearch).toBe('');

    mount();
    await dirty();
    follow(link);

    expect(fleetState()).toEqual(cold);
  });

  it('a type followed from the dirty tab shows that type\'s rows and door, nothing else set', async () => {
    mount();
    await dirty();
    follow({ filter: '737 MAX 9', view: null });
    expect(activeSubView()).toMatch(/^All Aircraft/);
    expect(rows()).toEqual(['N37502', 'N37503']);
    expect(screen.getByRole('combobox', { name: 'Fleet WiFi filter' }).textContent).toContain('All WiFi');
    expect((screen.getByRole('searchbox', { name: 'Fleet search' }) as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('link', { name: 'About the 737 MAX 9' })).toBeTruthy();
  });

  it('keeps the sort order the reader chose (a sort is not part of an address)', () => {
    mount();
    const reg = () => screen.getByRole('button', { name: /^Reg/ });
    fireEvent.click(reg()); // Reg is the default column, ascending: a click makes it descending.
    expect(reg().closest('th')?.getAttribute('aria-sort')).toBe('descending');
    follow({ filter: 'A319', view: null });
    expect(reg().closest('th')?.getAttribute('aria-sort')).toBe('descending');
    expect(rows()[0]).toBe('N105UA');
  });

  it('an unknown value leaves every dirty filter as it was', async () => {
    mount();
    await dirty();
    follow({ filter: 'B789', view: null });

    // Still on Express, Express search kept.
    expect(activeSubView()).toMatch(/^United Express/);
    expect(screen.getByRole('searchbox', { name: 'United Express search' })).toHaveProperty('value', 'skywest');
    openSubView(/^All Aircraft/);
    expect(screen.getByRole('combobox', { name: 'Fleet type filter' }).textContent).toContain('A319');
    expect(screen.getByRole('combobox', { name: 'Fleet WiFi filter' }).textContent).toContain('Satellite Ku');
    expect((screen.getByRole('searchbox', { name: 'Fleet search' }) as HTMLInputElement).value).toBe('N10');
    expect(rows()).toHaveLength(6);
  });

  it('clears a Fleet "Ask the board" answer through the store, so no chip describes a filter that is gone', () => {
    mount();
    // "Where is N37502": the answer's tail rides the search box (useAskFleet).
    act(() => {
      setAskResult({ view: 'fleet', filters: { tail: 'N37502' } }, 'rules');
    });
    expect(screen.getByTestId('ask-chips-fleet')).toBeTruthy();
    expect(rows()).toEqual(['N37502']);

    // An unknown value changes nothing, the answer included.
    follow({ filter: 'B789', view: null });
    expect(__peekAskStateForTests().result?.view).toBe('fleet');
    expect(screen.getByTestId('ask-chips-fleet')).toBeTruthy();

    // A view link keeps no filter of the answer's, so the answer goes (the chip row only shows on
    // All Aircraft, so the store is what says it is gone).
    follow({ filter: null, view: 'special' });
    expect(__peekAskStateForTests().result).toBeNull();
    openSubView(/^All Aircraft/);
    expect(screen.queryByTestId('ask-chips-fleet')).toBeNull();
    expect(rows()).toHaveLength(8);
  });

  it('leaves an answer meant for another tab alone', () => {
    mount();
    act(() => {
      setAskResult({ view: 'live', filters: { family: '787' } }, 'rules');
    });
    follow({ filter: 'A319', view: null });
    expect(__peekAskStateForTests().result?.view).toBe('live');
  });
});

describe('"known type" is a type the type select offers', () => {
  // A database type outside the select's list (TYPE_ORDER): the select could not show it, so an
  // address naming it is ignored, cold or followed.
  const WITH_UNLISTED = [...FLEET_DB, { r: 'N999XX', t: '737-600', w: '', s: '', d: '1998' }];

  it('a followed link to it changes nothing', () => {
    ctl.fleet = fleetValue(WITH_UNLISTED);
    mount();
    follow({ filter: '737-600', view: null });
    expect(rows()).toHaveLength(9);
    expect(typeSelect().textContent).toContain('All Types');
  });

  it('a cold load of it changes nothing', () => {
    ctl.fleet = fleetValue(WITH_UNLISTED);
    window.history.replaceState(null, '', '/?tab=fleet&type=737-600');
    mount();
    expect(rows()).toHaveLength(9);
    expect(typeSelect().textContent).toContain('All Types');
  });
});

describe('a link brings the reader to what it set', () => {
  it('a followed type: the controls row, once the table shows that type', async () => {
    mount();
    follow({ filter: 'A319', view: null });
    await nextFrame();
    expect(scrolls).toEqual([{ target: 'controls', rows: 6 }]);
  });

  it('a cold load of the same address: the same target, after the filter', async () => {
    window.history.replaceState(null, '', '/?tab=fleet&type=A319');
    mount();
    await nextFrame();
    expect(scrolls).toEqual([{ target: 'controls', rows: 6 }]);
  });

  it('a status filter lands on the controls row too; a view alone, on that sub-view\'s panel', async () => {
    mount();
    follow({ filter: 'starlink', view: null });
    await nextFrame();
    expect(scrolls.at(-1)).toEqual({ target: 'controls', rows: 2 });

    follow({ filter: null, view: 'special' });
    await nextFrame();
    expect(scrolls.at(-1)?.target).toBe('panel:special');
    expect(activeSubView()).toMatch(/^Special/);
  });

  it('the same link followed twice scrolls twice', async () => {
    mount();
    follow({ filter: 'A319', view: null });
    await nextFrame();
    follow({ filter: 'A319', view: null });
    await nextFrame();
    expect(scrolls.map((s) => s.target)).toEqual(['controls', 'controls']);
  });

  it('a link held until the fleet data loads scrolls when it is applied, not before', async () => {
    ctl.fleet = fleetValue([], true);
    const view = mount();
    follow({ filter: 'A319', view: null });
    await nextFrame();
    expect(scrolls).toEqual([]);

    ctl.fleet = fleetValue(FLEET_DB);
    view.rerender(
      <UiProvider>
        <FleetView />
        <Probe />
      </UiProvider>,
    );
    await nextFrame();
    expect(scrolls).toEqual([{ target: 'controls', rows: 6 }]);
  });

  it('an unknown value scrolls nowhere, followed or cold', async () => {
    mount();
    follow({ filter: 'B789', view: null });
    await nextFrame();
    expect(scrolls).toEqual([]);
    cleanup();

    window.history.replaceState(null, '', '/?tab=fleet&type=B789');
    mount();
    await nextFrame();
    expect(scrolls).toEqual([]);
  });
});

/** Pick an option from one of the Fleet controls' Radix selects, as a mouse does. */
async function pickOption(name: string, option: RegExp | string) {
  await act(async () => {
    fireEvent.pointerDown(screen.getByRole('combobox', { name }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  });
  const item = await screen.findByRole('option', { name: option });
  await act(async () => {
    fireEvent.click(item);
  });
}

/** Type into the Fleet search; it reports upward after its 120 ms debounce. */
async function searchFor(value: string) {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Fleet search' }), { target: { value } });
  await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
}

const wifiSelect = () => screen.getByRole('combobox', { name: 'Fleet WiFi filter' });
const searchBox = () => screen.getByRole('searchbox', { name: 'Fleet search' }) as HTMLInputElement;

describe('a link followed while the Fleet tab is showing resets nothing (ruling 2)', () => {
  it('a type sets the type filter and keeps search and Wi-Fi; nothing scrolls', async () => {
    mount();
    await pickOption('Fleet WiFi filter', 'Satellite Ku');
    await searchFor('N10');
    await nextFrame();
    scrolls.length = 0;

    followHere({ filter: 'A319', view: null });
    await nextFrame();

    expect(typeSelect().textContent).toContain('A319');
    expect(wifiSelect().textContent).toContain('Satellite Ku');
    expect(searchBox().value).toBe('N10');
    expect(rows()).toHaveLength(6);
    expect(activeSubView()).toMatch(/^All Aircraft/);
    expect(scrolls).toEqual([]);
  });

  it('a type keeps the status filter, and a status keeps the type filter', () => {
    mount();
    followHere({ filter: 'starlink', view: null });
    followHere({ filter: '737 MAX 9', view: null });
    expect(statusSelect().textContent).toContain('Starlink');
    expect(typeSelect().textContent).toContain('737 MAX 9');
    expect(rows()).toEqual(['N37502', 'N37503']);

    followHere({ filter: 'active', view: null });
    expect(statusSelect().textContent).toContain('Active');
    expect(typeSelect().textContent).toContain('737 MAX 9');
  });

  it('the same link arriving from another tab resets first (the contrast)', async () => {
    mount();
    await pickOption('Fleet WiFi filter', 'Satellite Ku');
    await searchFor('N10');

    follow({ filter: 'A319', view: null });

    expect(wifiSelect().textContent).toContain('All WiFi');
    expect(searchBox().value).toBe('');
  });

  it('keeps Airborne Now for a type; opens All Aircraft from Special or United Express', () => {
    mount();
    openSubView(/^Airborne Now/);
    followHere({ filter: 'A319', view: null });
    expect(activeSubView()).toMatch(/^Airborne Now/);
    expect(typeSelect().textContent).toContain('A319');

    for (const from of [/^Special/, /^United Express/]) {
      openSubView(from);
      followHere({ filter: '737 MAX 9', view: null });
      expect(activeSubView()).toMatch(/^All Aircraft/);
      expect(rows()).toEqual(['N37502', 'N37503']);
    }
  });

  it('keeps the United Express search when it opens All Aircraft', () => {
    mount();
    openSubView(/^United Express/);
    fireEvent.change(screen.getByRole('searchbox', { name: 'United Express search' }), { target: { value: 'skywest' } });
    followHere({ filter: 'A319', view: null });
    openSubView(/^United Express/);
    expect(screen.getByRole('searchbox', { name: 'United Express search' })).toHaveProperty('value', 'skywest');
  });

  it('a view opens it; an unknown value changes nothing', () => {
    mount();
    followHere({ filter: 'A319', view: null });
    followHere({ filter: null, view: 'special' });
    expect(activeSubView()).toMatch(/^Special/);
    openSubView(/^All Aircraft/);
    expect(typeSelect().textContent).toContain('A319');

    followHere({ filter: 'B789', view: null });
    expect(typeSelect().textContent).toContain('A319');
    expect(rows()).toHaveLength(6);
  });
});

describe('a link held for the fleet database has the cold load\'s budget', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** The fleet database lands. */
  function arrive(view: ReturnType<typeof mount>) {
    ctl.fleet = fleetValue(FLEET_DB);
    view.rerender(
      <UiProvider>
        <FleetView />
        <Probe />
      </UiProvider>,
    );
  }

  it('a database that lands more than 10 s after the follow does not apply it, or scroll', async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    ctl.fleet = fleetValue([], true);
    const view = mount();
    follow({ filter: 'A319', view: null });

    clock.mockReturnValue(start + 10_001);
    arrive(view);
    await nextFrame();

    expect(rows()).toHaveLength(8);
    expect(typeSelect().textContent).toContain('All Types');
    expect(scrolls).toEqual([]);
  });

  it('within 10 s it is applied, as before', async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    ctl.fleet = fleetValue([], true);
    const view = mount();
    follow({ filter: 'A319', view: null });

    clock.mockReturnValue(start + 9_000);
    arrive(view);

    expect(rows()).toHaveLength(6);
  });

  it('on a first visit the budget runs from the mount too: a view that mounts 11 s late still applies it', () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    function Follower() {
      const ui = useUi();
      return (
        <button type="button" onClick={() => ui.followFleetLink({ filter: 'A319', view: null })}>
          follow first
        </button>
      );
    }
    function Lazy({ show }: { show: boolean }) {
      return show ? <FleetView /> : null;
    }
    const tree = (show: boolean) => (
      <UiProvider>
        <Follower />
        <Lazy show={show} />
      </UiProvider>
    );
    const view = render(tree(false));
    fireEvent.click(screen.getByRole('button', { name: 'follow first' }));

    // The tab's code took 11 s to arrive; the database is already there when it mounts.
    clock.mockReturnValue(start + 11_000);
    view.rerender(tree(true));

    expect(rows()).toHaveLength(6);
    expect(typeSelect().textContent).toContain('A319');
  });

  it('a failed load drops it: a later retry that succeeds does not apply it', () => {
    ctl.fleet = { ...fleetValue([]), loadFailed: true } as FleetValue;
    const view = mount();
    follow({ filter: 'A319', view: null });

    arrive(view);

    expect(rows()).toHaveLength(8);
    expect(typeSelect().textContent).toContain('All Types');
  });
});

describe('the cold load\'s Fleet address is the one the page was opened on', () => {
  it('applies once per page load: a remount (the error boundary\'s "Try again") does not apply it again', () => {
    window.history.replaceState(null, '', '/?tab=fleet&type=A319');
    const tree = (key: string) => (
      <UiProvider>
        <FleetView key={key} />
        <Probe />
      </UiProvider>
    );
    const view = render(tree('first'));
    expect(rows()).toHaveLength(6);
    // The reader takes the filter off, then the view is mounted afresh in the same page.
    fireEvent.click(typeCard('A319'));
    expect(rows()).toHaveLength(8);

    view.rerender(tree('again'));

    expect(rows()).toHaveLength(8);
    expect(typeSelect().textContent).toContain('All Types');
  });

  it('a followed link applies once too: a remount does not snap the filters back, or scroll', async () => {
    const tree = (key: string) => (
      <UiProvider>
        <FleetView key={key} />
        <Probe />
      </UiProvider>
    );
    const view = render(tree('first'));
    // Followed from another tab (the Starlink tab's "A319"), applied, then taken off by hand.
    follow({ filter: 'A319', view: null });
    expect(rows()).toHaveLength(6);
    await nextFrame();
    fireEvent.click(typeCard('A319'));
    expect(rows()).toHaveLength(8);
    scrolls.length = 0;

    // The tab throws and the reader presses "Try again": the view mounts afresh, the link still
    // in the store.
    view.rerender(tree('again'));
    await nextFrame();

    expect(rows()).toHaveLength(8);
    expect(typeSelect().textContent).toContain('All Types');
    expect(scrolls).toEqual([]);
  });

  it('a followed link dropped for arriving late stays dropped after a remount', async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    ctl.fleet = fleetValue([], true);
    const tree = (key: string) => (
      <UiProvider>
        <FleetView key={key} />
        <Probe />
      </UiProvider>
    );
    const view = render(tree('first'));
    follow({ filter: 'A319', view: null });
    // The database lands past the link's 10 s: dropped.
    clock.mockReturnValue(start + 10_001);
    ctl.fleet = fleetValue(FLEET_DB);
    view.rerender(tree('first'));
    expect(rows()).toHaveLength(8);
    scrolls.length = 0;

    // A remount must not give it a fresh 10 s from the new mount.
    view.rerender(tree('again'));
    await nextFrame();

    expect(rows()).toHaveLength(8);
    expect(typeSelect().textContent).toContain('All Types');
    expect(scrolls).toEqual([]);
    clock.mockRestore();
  });

  it('still applies when a followed link has since taken it out of the address bar', () => {
    window.history.replaceState(null, '', '/?tab=fleet&type=A319');
    ctl.fleet = fleetValue([], true);
    const view = mount();
    // A link followed to another tab before the database landed (follow-link.tsx) leaves this.
    window.history.pushState(null, '', '/#schedule');

    ctl.fleet = fleetValue(FLEET_DB);
    view.rerender(
      <UiProvider>
        <FleetView />
        <Probe />
      </UiProvider>,
    );

    expect(typeSelect().textContent).toContain('A319');
    expect(rows()).toHaveLength(6);
  });
});
