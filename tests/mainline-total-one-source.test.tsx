// @vitest-environment jsdom
/**
 * ONE mainline total across tabs (Oct 3 2026).
 *
 * The Starlink tab's rollout bar read "Mainline 261 / 1161" while the Fleet and Stats tabs
 * said 1,139 mainline aircraft. 1,161 was the upstream tracker's own census: our fleet
 * database plus 22 tails, 19 of which (16 retired A319/A320s, the undelivered MAX 10, two
 * 787s not yet flying) had no sighting in 89 days. Both tabs now render
 * `starlinkMainlineShare()` over the same inputs, so this mounts both against ONE fleet state
 * whose tracker stats carry a deliberately different mainline total, and requires each to
 * print the database's.
 */

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { FeedValue } from '../src/app/state/feed';
import type { FleetValue } from '../src/app/state/fleet';
import type { PrefsValue } from '../src/app/state/prefs';
import type { UiValue } from '../src/app/state/ui';
import FleetView from '../src/app/views/FleetView';
import StarlinkView from '../src/app/views/StarlinkView';

// 8 mainline airframes, 2 on Starlink; one Starlink mainline tail the database does not list
// (N99999) and two Express tails. The tracker claims 12 mainline aircraft.
const FLEET_DB = [
  ...Array.from({ length: 6 }, (_, i) => ({ r: `N10${i}UA`, t: 'A319', w: 'Satl Ku', s: '', d: '2000' })),
  { r: 'N37502', t: '737 MAX 9', w: 'Starlink', s: '', d: '2018' },
  { r: 'N37503', t: '737 MAX 9', w: 'Starlink', s: '', d: '2018' },
];
const ROSTER = [
  { tail: 'N37502', fleet: 'Mainline', type: '737 MAX 9', operator: 'United Airlines', dateFound: '' },
  { tail: 'N37503', fleet: 'Mainline', type: '737 MAX 9', operator: 'United Airlines', dateFound: '' },
  { tail: 'N99999', fleet: 'Mainline', type: '737 MAX 9', operator: 'United Airlines', dateFound: '' },
  { tail: 'N801SK', fleet: 'Express', type: 'CRJ-550', operator: 'SkyWest', dateFound: '' },
  { tail: 'N802SK', fleet: 'Express', type: 'CRJ-550', operator: 'SkyWest', dateFound: '' },
];
const TRACKER_STATS = {
  total: 5, mainline: 3, express: 2,
  mainlineTotal: 12, expressTotal: 4, fleetTotal: 16, mainlinePct: 25, expressPct: 50,
};

const FLEET = {
  fleetDb: FLEET_DB,
  fleetByReg: Object.fromEntries(FLEET_DB.map((a) => [a.r, a])),
  starlink: {
    tails: new Set(ROSTER.map((a) => a.tail)),
    flightsByTail: {},
    flightsStatus: 'ready',
    stats: TRACKER_STATS,
    aircraft: ROSTER,
    lastUpdated: null,
    syncedAt: null,
    degraded: false,
  },
  fleetSummary: null,
  special: new Map(),
  loading: false,
  loadFailed: false,
  retry: () => {},
  loadStarlinkFlights: () => {},
  expressDb: [],
  expressByReg: {},
  expressStatus: 'ready',
} as unknown as FleetValue;

vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchStarlinkMismatches: () => new Promise(() => {}),
}));
vi.mock('../src/app/state/fleet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/fleet')>()),
  useFleet: () => FLEET,
}));
vi.mock('../src/app/state/feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/feed')>()),
  useFeed: () => ({ flights: [], lastGoodTs: null }) as unknown as FeedValue,
}));
vi.mock('../src/app/state/prefs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/prefs')>()),
  usePrefs: () => ({ homeAirport: 'ORD' }) as unknown as PrefsValue,
}));
vi.mock('../src/app/state/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/ui')>()),
  useUi: () =>
    ({
      tab: 'starlink',
      setTab: () => {},
      select: () => {},
      focusOn: () => {},
      openAircraft: () => {},
      setStarlinkFilter: () => {},
    }) as unknown as UiValue,
}));

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView ??= vi.fn();
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
});

afterEach(cleanup);

describe('one mainline total on the Fleet and Starlink tabs', () => {
  it("the Starlink tab's Mainline bar is the fleet database's count, not the tracker's", () => {
    render(<StarlinkView />);
    const bars = document.getElementById('sl-bars') as HTMLElement;
    expect(bars.textContent).toContain('2 / 8 · 25%');
    expect(bars.textContent).not.toContain('/ 12');
    // Express has no database of ours; it stays the tracker's, and the note says so.
    expect(bars.textContent).toContain('2 / 4 · 50%');
    expect(document.getElementById('sl-bars-note')?.textContent).toBe(
      'Mainline: 2 of 8 aircraft in our fleet database · Express: per the Starlink tracker',
    );
  });

  it('the Fleet tab prints the same total and the same share', () => {
    render(<FleetView />);
    expect(document.body.textContent).toContain('Fleet Overview — 8 Mainline Aircraft');
    expect(document.body.textContent).toContain('2 of 8 aircraft in our fleet database');
    expect(document.body.textContent).not.toMatch(/of 12 mainline/);
  });

  it('both tabs get the share from the one function', async () => {
    const { readFileSync } = await import('node:fs');
    for (const view of ['FleetView.tsx', 'StarlinkView.tsx']) {
      const src = readFileSync(`src/app/views/${view}`, 'utf8');
      expect(src, view).toMatch(/starlinkMainlineShare\(starlink\.stats, fleetDb, starlink\.tails\)/);
    }
  });
});
