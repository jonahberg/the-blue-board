// @vitest-environment jsdom
/**
 * The Fleet tab follows a link in place (`useUi().followFleetLink`, src/app/views/FleetView.tsx),
 * and links once to the selected type's fleet page (the second "door", FleetControls).
 *
 * A followed link goes through the same `resolveFleetDeepLinkFilter` path as a cold load of
 * `?type=` / `?filter=` / `?view=`: a known type sets the type filter and clears the status filter,
 * a known status sets the status filter, an unknown value changes nothing (filtering to nothing
 * would read as "United has none"), a view sets the sub-view. A link followed before the fleet
 * database has arrived is held and applied when it lands, and the same link followed twice
 * applies twice (the store counts follows in `seq`).
 *
 * Mounted in the real UiProvider; the fleet and feed stores are stubbed with a small database.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

/** The registrations in the visible sub-view's table. */
function rows(): string[] {
  const panel = document.querySelector('#fleet-lookup-zone [role="tabpanel"][data-state="active"]');
  return [...(panel?.querySelectorAll('tbody tr') ?? [])].map((row) => row.querySelector('td')?.textContent ?? '');
}

const typeSelect = () => screen.getByRole('combobox', { name: 'Fleet type filter' });
const statusSelect = () => screen.getByRole('combobox', { name: 'Fleet status filter' });
const activeSubView = () =>
  document.querySelector('#fleet-lookup-zone [role="tab"][data-state="active"]')?.textContent ?? '';

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

beforeEach(() => {
  ctl.fleet = fleetValue(FLEET_DB);
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  seen.ui = null;
  window.history.replaceState(null, '', '/');
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
