// @vitest-environment jsdom
/**
 * The Fleet tab links the names it prints (links everywhere, part 2, slice 2c).
 *
 *  - Tails go to the aircraft dialog in place (`TailLink`): the row's link-coloured link in the All
 *    Aircraft, Airborne Now and United Express tables and on a Special card.
 *  - A type goes to this tab filtered to it (`TypeLink`, by the row's tail): quiet, and plain text in
 *    a list already filtered to that type (ruling 1). Followed here it sets the type filter and keeps
 *    the rest (ruling 2).
 *  - Route hub ends go to their Schedule board (`HubLink`); a United flight number to its page.
 *  - The "SL" mark goes to the Starlink tab.
 *  - Counts that summarize a list are buttons that set its filter (ruling 7).
 *  - Nothing that is not a link or button is painted in link colour.
 *
 * Mounted in the real UiProvider, ScheduleProvider and FollowProvider, so a click follows the link
 * the way the dashboard does; the fleet and feed stores are stubbed with a small database, and the
 * Schedule store's watch-list collaborators as in tests/entity-links.test.tsx.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedValue } from '../src/app/state/feed';
import type { FleetValue } from '../src/app/state/fleet';
import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';
import FleetView from '../src/app/views/FleetView';

const ctl = vi.hoisted(() => ({ fleet: null as unknown, flights: [] as unknown[] }));

vi.mock('../src/app/state/fleet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/fleet')>()),
  useFleet: () => ctl.fleet as FleetValue,
}));
vi.mock('../src/app/state/feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/feed')>()),
  useFeed: () => ({ flights: ctl.flights, lastGoodTs: null }) as unknown as FeedValue,
}));
vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ watched: [] }) }));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));

// 6 A319s and 2 737 MAX 9s, the MAX 9s on Starlink.
const FLEET_DB = [
  ...Array.from({ length: 6 }, (_, i) => ({ r: `N10${i}UA`, t: 'A319', w: 'Satl Ku', s: '', d: '2000' })),
  { r: 'N37502', t: '737 MAX 9', w: 'Starlink', s: '', d: '2018' },
  { r: 'N37503', t: '737 MAX 9', w: 'Starlink', s: '', d: '2018' },
];

function fleetValue(overrides: Partial<Record<keyof FleetValue, unknown>> = {}): FleetValue {
  return {
    fleetDb: FLEET_DB,
    fleetByReg: Object.fromEntries(FLEET_DB.map((a) => [a.r, a])),
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
    loading: false,
    loadFailed: false,
    retry: () => {},
    expressDb: [],
    expressByReg: {},
    expressStatus: 'ready',
    ...overrides,
  } as unknown as FleetValue;
}

/** The UI store as the last render saw it. */
const seen: { ui: UiValue | null } = { ui: null };
function Probe() {
  seen.ui = useUi();
  return null;
}

/** The dashboard on the Fleet tab (`#fleet`), so a link to it is followed as a stay. */
function mount(url = '/#fleet') {
  window.history.replaceState(null, '', url);
  return render(
    <UiProvider>
      <ScheduleProvider defaultHub="ORD">
        <FollowProvider>
          <FleetView />
          <Probe />
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
}

/** The visible sub-view's panel. */
const panel = () => document.querySelector('#fleet-lookup-zone [role="tabpanel"][data-state="active"]') as HTMLElement;
/** Its body rows. */
const bodyRows = () => [...panel().querySelectorAll('tbody tr')] as HTMLElement[];
/** The row whose first cell starts with `reg`. */
const rowOf = (reg: string) => {
  const row = bodyRows().find((r) => r.querySelector('td')?.textContent?.startsWith(reg));
  if (!row) throw new Error(`no row for ${reg}`);
  return row;
};
const cells = (row: HTMLElement) => [...row.querySelectorAll('td')] as HTMLElement[];
const classesOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/);
/** A bare `underline` class (the quiet tone's at-rest mark), not `hover:underline`. */
const isQuiet = (el: Element) => classesOf(el).includes('underline') && !classesOf(el).includes('text-primary');
const isIdentity = (el: Element) => classesOf(el).includes('text-primary');

const typeSelect = () => screen.getByRole('combobox', { name: 'Fleet type filter' });
const searchBox = () => screen.getByRole('searchbox', { name: 'Fleet search' }) as HTMLInputElement;
const activeSubView = () => document.querySelector('#fleet-lookup-zone [role="tab"][data-state="active"]')?.textContent ?? '';

/** Pick a Fleet sub-view tab, as a mouse does (Radix activates a trigger on a primary mouse-down). */
function openSubView(name: RegExp) {
  const tab = [...document.querySelectorAll<HTMLElement>('#fleet-lookup-zone [role="tab"]')].find((el) =>
    name.test(el.textContent ?? ''),
  )!;
  fireEvent.mouseDown(tab, { button: 0 });
  expect(activeSubView()).toMatch(name);
}

async function searchFor(value: string) {
  fireEvent.change(searchBox(), { target: { value } });
  await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
}

const scrolls: string[] = [];
async function nextFrame() {
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
});

beforeEach(() => {
  ctl.fleet = fleetValue();
  ctl.flights = [];
  scrolls.length = 0;
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    if (this.id === 'fleet-controls') scrolls.push('controls');
    else if (this.getAttribute('role') === 'tabpanel') scrolls.push(`panel:${this.id.replace(/^.*-content-/, '')}`);
    else scrolls.push(this.id || this.tagName.toLowerCase());
  };
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in this test'))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  seen.ui = null;
  window.history.replaceState(null, '', '/');
});

describe('All Aircraft', () => {
  it('the tail is the row\'s link-coloured link, to its aircraft dialog, opened in place', () => {
    mount();
    const [regCell] = cells(rowOf('N100UA'));
    const link = within(regCell).getByRole('link', { name: 'N100UA' });
    expect(link.getAttribute('href')).toBe('/?aircraft=N100UA');
    expect(isIdentity(link)).toBe(true);
    // A link, not a button painted like one.
    expect(regCell.querySelector('button')).toBeNull();

    expect(fireEvent.click(link)).toBe(false);
    expect(seen.ui!.aircraftReg).toBe('N100UA');
    expect(seen.ui!.tab).toBe('fleet');
  });

  it('the type is a quiet link to this tab filtered to it; followed here it keeps the search (ruling 2)', async () => {
    mount();
    await searchFor('N');
    await nextFrame();
    scrolls.length = 0;
    const typeCell = cells(rowOf('N37502'))[1];
    const link = within(typeCell).getByRole('link', { name: '737 MAX 9' });
    expect(link.getAttribute('href')).toBe('/?tab=fleet&type=737%20MAX%209');
    expect(isQuiet(link)).toBe(true);

    expect(fireEvent.click(link)).toBe(false);
    await nextFrame();

    expect(typeSelect().textContent).toContain('737 MAX 9');
    expect(searchBox().value).toBe('N');
    expect(bodyRows().map((r) => cells(r)[0].textContent)).toEqual(['N37502', 'N37503']);
    expect(scrolls).toEqual([]);
  });

  it('in a table filtered to a type, the type cells are plain text (ruling 1)', () => {
    mount();
    fireEvent.click(within(cells(rowOf('N37502'))[1]).getByRole('link', { name: '737 MAX 9' }));
    for (const row of bodyRows()) {
      const typeCell = cells(row)[1];
      expect(typeCell.querySelector('a')).toBeNull();
      expect(typeCell.textContent).toBe('737 MAX 9');
      expect(typeCell.querySelector('.underline, .text-primary')).toBeNull();
    }
  });

  it('the SL mark is a quiet link to the Starlink tab, one per Starlink row', () => {
    mount();
    const sl = within(rowOf('N37502')).getByRole('link', { name: /^SL/ });
    expect(sl.getAttribute('href')).toBe('/#starlink');
    expect(sl.textContent).toBe('SL (Starlink tab)');
    expect(isQuiet(sl)).toBe(true);
    expect(rowOf('N37502').querySelectorAll('a[href="/#starlink"]')).toHaveLength(1);
    expect(rowOf('N100UA').querySelector('a[href="/#starlink"]')).toBeNull();

    expect(fireEvent.click(sl)).toBe(false);
    expect(seen.ui!.tab).toBe('starlink');
  });

  it('one link-coloured link per row, and every link 44 px tall on touch inside its cell', () => {
    mount();
    const row = rowOf('N37502');
    const links = [...row.querySelectorAll('a')];
    expect(links.filter(isIdentity)).toHaveLength(1);
    for (const link of links) {
      // The target is the element itself, relaxed only for a mouse at md+: no `after:` box reaches
      // into a neighbouring cell or row.
      expect(classesOf(link)).toContain('min-h-11');
      expect(classesOf(link)).toContain('pointer-fine:md:min-h-0');
      expect(classesOf(link).filter((c) => c.includes('after:'))).toEqual([]);
    }
  });
});
