// @vitest-environment jsdom
/**
 * The Starlink tab says how old its SCHEDULE is (v1.28.0), not the tracker's frozen `lastUpdated`.
 *
 * Before: "updated 16d ago" above live-looking rows (the tracker's own field, frozen at
 * 2026-10-27), a footer promising a cache "up to 6h" old while the tracker was down for a day,
 * "No United Starlink departures …" once the stored schedule had simply run out, and a source line
 * that said "live" whenever the field was missing. The words now come from src/lib/starlink-roster.js
 * (starlinkScheduleFreshness / starlinkBoardFooter / starlinkBoardEmptyText), fed the sync time and
 * the serving tier that /api/starlink-data puts in its body. Production does not send `servedFrom`
 * yet, so every case is also rendered without it.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedValue } from '../src/app/state/feed';
import type { FleetValue, StarlinkState } from '../src/app/state/fleet';
import type { PrefsValue } from '../src/app/state/prefs';
import type { UiValue } from '../src/app/state/ui';
import StarlinkView from '../src/app/views/StarlinkView';

const NOW_MS = Date.UTC(2026, 10, 11, 22, 0, 0);
const H = 3600;
const iso = (hoursAgo: number) => new Date(NOW_MS - hoursAgo * H * 1000).toISOString();

const state = vi.hoisted(() => ({ starlink: null as unknown }));

vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchStarlinkMismatches: () => Promise.resolve({ disputed: [], summary: null }),
}));

vi.mock('../src/app/state/fleet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/fleet')>()),
  useFleet: () =>
    ({
      fleetDb: [],
      fleetByReg: {},
      starlink: state.starlink,
      fleetSummary: null,
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
  useFeed: () => ({ flights: [] }) as unknown as FeedValue,
}));

vi.mock('../src/app/state/prefs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/prefs')>()),
  usePrefs: () => ({ homeAirport: '' }) as unknown as PrefsValue,
}));

// The tab's names are in-place links (DashLink → useFollowDeepLink), which need the Schedule and UI
// stores this file stubs; following one is tests/dash-link.test.tsx's subject, not this file's.
vi.mock('../src/app/state/follow-link', () => ({ useFollowDeepLink: () => () => {} }));
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

/** One mainline tail with one ORD departure `depInHours` from now. */
function starlink(over: Partial<StarlinkState> & { depInHours?: number }): StarlinkState {
  const { depInHours = 3, ...rest } = over;
  return {
    tails: new Set(['N12345']),
    flightsByTail: {
      N12345: [
        { flight_number: 'UAL1234', origin: 'ORD', destination: 'SFO', departure_ts: NOW_MS / 1000 + depInHours * H },
      ],
    },
    flightsStatus: 'ready',
    stats: null,
    aircraft: [{ tail: 'N12345', fleet: 'Mainline', type: '737-800', operator: 'United Airlines', dateFound: '2026-10-01' }],
    // The tracker's own field, frozen 16 days ago: nothing on the tab may read it as freshness.
    lastUpdated: iso(16 * 24),
    syncedAt: null,
    servedFrom: null,
    flightsSyncedAt: null,
    flightsServedFrom: null,
    degraded: false,
    ...rest,
  };
}

const subtitle = () => document.getElementById('sl-board-updated')?.textContent ?? '';
const footer = () => document.querySelector('#sl-board > p:last-child')?.textContent ?? '';
const sourceLine = () => document.getElementById('sl-source')?.textContent?.replace(/\s+/g, ' ') ?? '';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW_MS);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Starlink tab: the schedule says how old it is', () => {
  it('fresh: a recent sync from a fresh tier', () => {
    state.starlink = starlink({ syncedAt: iso(2), servedFrom: 'supabase', flightsSyncedAt: iso(2), flightsServedFrom: 'supabase' });
    render(<StarlinkView />);
    expect(subtitle()).toBe('schedule synced 2h ago · airborne live');
    expect(footer()).toContain("Times are scheduled, from the tracker's schedule synced 2h ago.");
    expect(footer()).not.toMatch(/up to 6h|cache/);
    expect(sourceLine()).toContain('· schedule synced 2h ago · airborne live ·');
    expect(sourceLine()).not.toMatch(/16d|Updated/);
    // On the board, printed as its United ident (the feed sent UAL1234; the roster's next-flight
    // cell links the same number since Nov 12 2026).
    expect(within(document.getElementById('sl-board') as HTMLElement).getByRole('link', { name: 'UA1234' })).toBeTruthy();
  });

  it('stale: the tracker did not answer and the stored schedule is 22 h old', () => {
    state.starlink = starlink({
      syncedAt: iso(22),
      servedFrom: 'supabase-stale',
      flightsSyncedAt: iso(22),
      flightsServedFrom: 'supabase-stale',
    });
    render(<StarlinkView />);
    expect(subtitle()).toBe('tracker offline, schedule from 22h ago');
    expect(footer()).toContain('from the last schedule we have (synced 22h ago; the tracker is offline)');
    // The rows are still real scheduled departures, so they still show.
    // On the board, printed as its United ident (the feed sent UAL1234; the roster's next-flight
    // cell links the same number since Nov 12 2026).
    expect(within(document.getElementById('sl-board') as HTMLElement).getByRole('link', { name: 'UA1234' })).toBeTruthy();
  });

  it('offline: the stored schedule has run out, so the empty board says so instead of "no departures"', () => {
    state.starlink = starlink({
      depInHours: -6,
      syncedAt: iso(70),
      servedFrom: 'supabase-stale',
      flightsSyncedAt: iso(70),
      flightsServedFrom: 'supabase-stale',
    });
    render(<StarlinkView />);
    expect(
      screen.getByText(
        'The Starlink schedule feed is offline and the last schedule we have (synced 3d ago) has run out, so this board cannot show departures.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/^No United Starlink departures/)).toBeNull();
  });

  it('an empty window on a schedule that still reaches ahead is still "no departures"', () => {
    state.starlink = starlink({ depInHours: 30, syncedAt: iso(1), servedFrom: 'memory', flightsSyncedAt: iso(1), flightsServedFrom: 'memory' });
    render(<StarlinkView />);
    expect(screen.getByText('No United Starlink departures from the hubs in the next 12h.')).toBeTruthy();
  });

  it("the board reads the schedule response's own sync; the source line the roster's", () => {
    state.starlink = starlink({ syncedAt: iso(5), servedFrom: 'supabase', flightsSyncedAt: iso(1), flightsServedFrom: 'memory' });
    render(<StarlinkView />);
    expect(subtitle()).toBe('schedule synced 1h ago · airborne live');
    expect(sourceLine()).toContain('schedule synced 5h ago');
  });

  describe('fields absent (production before this release: no servedFrom)', () => {
    it('a sync time alone still dates the schedule; over 6 h reads as the tracker offline', () => {
      state.starlink = starlink({ syncedAt: iso(22), flightsSyncedAt: iso(22) });
      render(<StarlinkView />);
      expect(subtitle()).toBe('tracker offline, schedule from 22h ago');
    });

    it('a recent sync time alone reads as synced', () => {
      state.starlink = starlink({ syncedAt: iso(3) });
      render(<StarlinkView />);
      expect(subtitle()).toBe('schedule synced 3h ago · airborne live');
    });

    it('no sync time at all: "scheduled times", no age claimed anywhere, and never "live"', () => {
      state.starlink = starlink({});
      render(<StarlinkView />);
      expect(subtitle()).toBe('scheduled times');
      expect(footer()).toContain('Times are scheduled. Airborne marks come from the live flight feed');
      expect(footer()).not.toMatch(/synced|up to 6h|cache/);
      // The source line names its source and its count, and claims no freshness it cannot back.
      expect(sourceLine()).toMatch(/Starlink data via unitedstarlinktracker\.com · 1 aircraft/);
      expect(sourceLine()).not.toMatch(/live|Updated|16d/);
    });
  });
});
