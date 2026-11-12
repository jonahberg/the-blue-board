// @vitest-environment jsdom
/**
 * The Starlink tab against the tracker's fleet-summary as it answered on Nov 12 2026.
 *
 * Three things the owner approved that day, end to end through the view:
 *  - the Express bar is the two-cabin regional fleet from that one payload (354 / 368 · 96%),
 *    not the tracker's 355 over its 513 (69%);
 *  - the velocity card's second tile is United's stated target, not "~Sep '31";
 *  - Alaska and Hawaiian are one industry row (147 / 418 · 35%) and the card is
 *    "Starlink Coverage · United vs Alaska".
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { FeedValue } from '../src/app/state/feed';
import type { FleetValue } from '../src/app/state/fleet';
import type { PrefsValue } from '../src/app/state/prefs';
import type { UiValue } from '../src/app/state/ui';
import StarlinkView from '../src/app/views/StarlinkView';

const FLEET_SUMMARY = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/fleet-summary-2026-11-12.json'), 'utf8'),
);

// Two mainline airframes, one on Starlink, plus dated Express tails so the pace tiles render.
const FLEET_DB = [
  { r: 'N37502', t: '737 MAX 9', w: 'Starlink', s: '', d: '2018' },
  { r: 'N37503', t: '737 MAX 9', w: '', s: '', d: '2018' },
];
const ROSTER = [
  { tail: 'N37502', fleet: 'Mainline', type: '737 MAX 9', operator: 'United Airlines', dateFound: '2026-10-20' },
  ...Array.from({ length: 6 }, (_, i) => ({
    tail: `N80${i}SK`, fleet: 'Express', type: 'CRJ-550', operator: 'SkyWest', dateFound: `2026-10-${10 + i}`,
  })),
];
// The tracker's own Express figures, deliberately the live ones: 355 equipped of 513 (69%).
const STATS = { total: 681, mainline: 326, express: 355, mainlineTotal: 1168, expressTotal: 513, expressPct: 69 };

const state = vi.hoisted(() => ({ fleetSummary: null as unknown }));

vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchStarlinkMismatches: () => new Promise(() => {}),
}));
vi.mock('../src/app/state/fleet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/fleet')>()),
  useFleet: () =>
    ({
      fleetDb: FLEET_DB,
      fleetByReg: Object.fromEntries(FLEET_DB.map((a) => [a.r, a])),
      starlink: {
        tails: new Set(ROSTER.map((a) => a.tail)),
        flightsByTail: {},
        flightsStatus: 'ready',
        stats: STATS,
        aircraft: ROSTER,
        lastUpdated: null,
        syncedAt: null,
        degraded: false,
      },
      fleetSummary: state.fleetSummary,
      special: new Map(),
      loading: false,
      loadFailed: false,
      retry: () => {},
      loadStarlinkFlights: () => {},
      expressDb: [],
      expressByReg: {},
      expressStatus: 'ready',
    }) as unknown as FleetValue,
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

afterEach(() => {
  cleanup();
  state.fleetSummary = null;
});

const text = (id: string) => document.getElementById(id)?.textContent ?? null;

describe('the Starlink tab on the Nov 12 2026 fleet-summary', () => {
  it('Express bar: 354 / 368 · 96% from the one payload, and the note says what it counts', () => {
    state.fleetSummary = FLEET_SUMMARY;
    render(<StarlinkView />);
    const express = document.querySelector('#sl-bars [data-bar="Express"]') as HTMLElement;
    expect(express.textContent).toBe('Express354 / 368 · 96%');
    expect(document.getElementById('sl-bars')?.textContent).not.toMatch(/513|69%/);
    expect(text('sl-bars-note')).toBe(
      'Mainline: 1 of 2 aircraft in our fleet database · Express: per the Starlink tracker. ' +
        'Express counts two-cabin regional jets, the planes United has said will get Starlink. ' +
        'The 145 single-cabin CRJ-200s and ERJ-145s are left out.',
    );
  });

  it('Express bar without the payload: the equipped count, no bar, no percentage', () => {
    render(<StarlinkView />);
    const express = document.querySelector('#sl-bars [data-bar="Express"]') as HTMLElement;
    expect(express.textContent).toBe('Express355 equipped');
    expect(express.querySelector('.bg-bb-ok')).toBeNull();
    // The Mainline bar is untouched.
    const mainline = document.querySelector('#sl-bars [data-bar="Mainline"]') as HTMLElement;
    expect(mainline.textContent).toBe('Mainline1 / 2 · 50%');
  });

  it("the second velocity tile is United's target and no date of ours appears", () => {
    render(<StarlinkView />);
    const stats = document.getElementById('sl-velo-stats') as HTMLElement;
    expect(stats.textContent).toContain("United's target");
    expect(text('sl-target')).toBe('End of 2027');
    expect(text('sl-target-note')).toBe('fleet-wide · stated Oct 20, 2026');
    expect(document.body.textContent).not.toMatch(/ETA|at current pace|~[A-Z]{3} '\d\d/);
  });

  it('industry card: United vs the merged Alaska row, with the Hawaiian sentence', () => {
    state.fleetSummary = FLEET_SUMMARY;
    render(<StarlinkView />);
    expect(text('sl-industry-title')).toBe('Starlink Coverage · United vs Alaska');
    const rows = [...document.querySelectorAll('#sl-industry-bars [data-carrier]')] as HTMLElement[];
    expect(rows.map((r) => r.dataset.carrier)).toEqual(['UA', 'AS+HA']);
    const alaska = rows[1];
    // Seen: the code. Heard: the name. Hovered: the name.
    expect(alaska.querySelector('[aria-hidden="true"]')?.textContent).toBe('AS+HA');
    expect(alaska.querySelector('.sr-only')?.textContent).toBe('Alaska Airlines + Hawaiian Airlines');
    expect(alaska.querySelector('[title]')?.getAttribute('title')).toBe('Alaska Airlines + Hawaiian Airlines');
    expect(alaska.textContent).toContain('147 / 418 · 35%');
    expect(text('sl-industry-note')).toContain(
      'Alaska includes Hawaiian, which flies under the Alaska code since April 2026.',
    );
  });

  it('industry card with Alaska alone: its own row, the old title, no Hawaiian sentence', () => {
    state.fleetSummary = {
      airlines: FLEET_SUMMARY.airlines.filter((a: { code: string }) => a.code !== 'HA'),
    };
    render(<StarlinkView />);
    expect(text('sl-industry-title')).toBe('Industry · Starlink Coverage');
    const rows = [...document.querySelectorAll('#sl-industry-bars [data-carrier]')] as HTMLElement[];
    expect(rows.map((r) => r.dataset.carrier)).toEqual(['UA', 'AS']);
    expect(rows[1].textContent).toContain('105 / 354 · 30%');
    expect(text('sl-industry-note')).not.toContain('Hawaiian');
  });
});
