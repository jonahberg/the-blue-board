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

afterEach(() => {
  (FLEET as { fleetSummary: unknown }).fleetSummary = null;
});

const expressRow = () => document.querySelector('#sl-bars [data-bar="Express"]') as HTMLElement;

describe('one mainline total on the Fleet and Starlink tabs', () => {
  it("the Starlink tab's Mainline bar is the fleet database's count, not the tracker's", () => {
    render(<StarlinkView />);
    const bars = document.getElementById('sl-bars') as HTMLElement;
    expect(bars.textContent).toContain('2 / 8 · 25%');
    expect(bars.textContent).not.toContain('/ 12');
  });

  // Nov 12 2026: the tracker's Express total (4 here, 513 live) counts single-cabin jets, and
  // with no fleet-summary there is no denominator the bar may use.
  it('without a fleet-summary the Express row is the equipped count: no bar, no percentage', () => {
    render(<StarlinkView />);
    const row = expressRow();
    expect(row.textContent).toBe('Express2 equipped');
    expect(row.textContent).not.toContain('%');
    expect(row.textContent).not.toContain('/ 4');
    expect(row.querySelector('.bg-bb-ok')).toBeNull();
    expect(document.getElementById('sl-bars-note')?.textContent).toBe(
      'Mainline: 2 of 8 aircraft in our fleet database · Express: equipped count per the Starlink tracker',
    );
  });

  it("with a fleet-summary both Express numbers are its UA regional families'", () => {
    (FLEET as { fleetSummary: unknown }).fleetSummary = {
      airlines: [
        {
          code: 'UA', name: 'United Airlines', installed: 5, total: 20, percentage: 25,
          families: [
            { family: 'E175', body: 'regional', installed: 3, total: 4, percentage: 75 },
            { family: 'E170', body: 'regional', installed: 0, total: 2, percentage: 0 },
            { family: 'CRJ-200', body: 'regional', installed: 0, total: 9, percentage: 0 },
            { family: 'B737-MAX9', body: 'narrowbody', installed: 2, total: 5, percentage: 40 },
          ],
        },
      ],
    };
    render(<StarlinkView />);
    const row = expressRow();
    // 3 of the 6 two-cabin jets, never the tracker's 2 equipped over its 4.
    expect(row.textContent).toBe('Express3 / 6 · 50%');
    expect(row.querySelector('.bg-bb-ok')).not.toBeNull();
    expect(document.getElementById('sl-bars-note')?.textContent).toBe(
      'Mainline: 2 of 8 aircraft in our fleet database · Express: per the Starlink tracker. ' +
        'Express counts two-cabin regional jets, the planes United has said will get Starlink. ' +
        'The 9 single-cabin CRJ-200s are left out.',
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

/**
 * ONE Express share across tabs (Nov 12 2026). The Fleet tab's "Express Fleet" chip printed the
 * tracker's 69% (355 / 513, single-cabin jets included) while the Starlink tab's Express bar
 * printed 96% of the two-cabin regional fleet. Both now come from `expressStarlinkScope()` over
 * the same fleet-summary payload, and neither prints a share without it. The tracker stats here
 * carry a deliberately different `expressPct` (50) and `expressTotal` (4).
 */
describe('one Express share on the Fleet and Starlink tabs', () => {
  // 3 of 7 two-cabin regional jets (43%), plus 9 single-cabin jets the share leaves out.
  const SUMMARY = {
    airlines: [
      {
        code: 'UA', name: 'United Airlines', installed: 5, total: 25, percentage: 20,
        families: [
          { family: 'E175', body: 'regional', installed: 3, total: 5, percentage: 60 },
          { family: 'CRJ-700', body: 'regional', installed: 0, total: 2, percentage: 0 },
          { family: 'ERJ-145', body: 'regional', installed: 0, total: 9, percentage: 0 },
          { family: 'B737-MAX9', body: 'narrowbody', installed: 2, total: 9, percentage: 22 },
        ],
      },
    ],
  };
  const chipValue = (label: string) => {
    const chip = [...document.querySelectorAll('li')].find(
      (li) => li.lastElementChild?.textContent === label,
    );
    return chip ? chip.firstElementChild?.textContent ?? null : null;
  };
  const percents = (text: string) => [...text.matchAll(/(\d+)%/g)].map((m) => m[1]);

  it('the Fleet chip and the Starlink bar print the same Express percentage', () => {
    (FLEET as { fleetSummary: unknown }).fleetSummary = SUMMARY;
    render(<StarlinkView />);
    const barPct = percents(expressRow().textContent ?? '');
    cleanup();
    render(<FleetView />);
    const chip = chipValue('Express Fleet');
    expect(barPct).toEqual(['43']);
    expect(chip).toBe('43%');
    expect(chip).toBe(`${barPct[0]}%`);
    // Never the tracker's own share.
    expect(chip).not.toBe('50%');
  });

  it('without a fleet-summary neither tab prints an Express percentage', () => {
    render(<StarlinkView />);
    expect(percents(expressRow().textContent ?? '')).toEqual([]);
    cleanup();
    render(<FleetView />);
    expect(chipValue('Express Fleet')).toBeNull();
    // The Express COUNT chip and the Mainline share are still there.
    expect(chipValue('Express')).toBe('2');
    expect(chipValue('Mainline Fleet')).toBe('25%');
    expect(document.body.textContent).not.toContain('50%');
  });

  it('both tabs get the Express share from the one function over the one payload', async () => {
    const { readFileSync } = await import('node:fs');
    for (const view of ['FleetView.tsx', 'StarlinkView.tsx']) {
      const src = readFileSync(`src/app/views/${view}`, 'utf8');
      expect(src, view).toMatch(/expressStarlinkScope\(fleetSummary\?\.airlines \?\? null\)/);
      expect(src, view).not.toMatch(/stats\.expressPct|stats\.expressTotal/);
    }
  });
});
