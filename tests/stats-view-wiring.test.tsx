// @vitest-environment jsdom
/**
 * The Stats tab wires its headline cards to their links (src/lib/stats-links.js): mounted whole,
 * from a stubbed feed and fleet database, `StatsView` renders exactly the two card links with
 * their addresses, and the "Fleet Utilization" card renders none while it has no figure (the
 * fleet database has not loaded). tests/stats-links-view.test.tsx covers the cards' markup; this
 * pins that StatsView hands them their links at all.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedValue } from '../src/app/state/feed';
import type { FleetValue } from '../src/app/state/fleet';
import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider } from '../src/app/state/schedule';
import { UiProvider } from '../src/app/state/ui';
import StatsView from '../src/app/views/StatsView';

vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ watched: [] }) }));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));

const stub = vi.hoisted(() => ({ flights: [] as unknown[], fleetDb: [] as { r: string; t: string; d?: string }[] }));

vi.mock('../src/app/state/feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/feed')>()),
  useFeed: () => ({ flights: stub.flights, lastGoodTs: null }) as unknown as FeedValue,
}));
vi.mock('../src/app/state/fleet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/fleet')>()),
  useFleet: () =>
    ({
      fleetDb: stub.fleetDb,
      fleetByReg: Object.fromEntries(stub.fleetDb.map((a) => [a.r, a])),
      starlink: { tails: new Set<string>() },
    }) as unknown as FleetValue,
}));

function mount() {
  return render(
    <UiProvider>
      <ScheduleProvider>
        <FollowProvider>
          <StatsView />
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
}

/** The card links: the headline cards are the tab's only `dt` elements. */
const cardLinks = () => [...document.querySelectorAll('dt a')].map((a) => [a.firstChild?.textContent, a.getAttribute('href')]);

beforeEach(() => {
  window.history.replaceState(null, '', '/#stats');
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in this test'))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  stub.flights = [];
  stub.fleetDb = [];
});

describe('StatsView: the headline cards get their links', () => {
  it('links "Flights Airborne" and "Fleet Utilization" when both have a figure, and no other card', () => {
    stub.fleetDb = [
      { r: 'N12345', t: '737-900ER', d: '2012' },
      { r: 'N23456', t: 'A319', d: '2000' },
    ];
    stub.flights = [{ reg: 'N12345', alt: 10000, spd: 400, vr: 0, onGround: false, origin: 'ORD', dest: 'DEN' }];
    mount();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(cardLinks()).toEqual([
      ['Flights Airborne', '/#live'],
      ['Fleet Utilization', '/?tab=fleet&view=airborne'],
    ]);
  });

  it('renders no "Fleet Utilization" link while the fleet database has not loaded (the card reads "—")', () => {
    mount();
    const card = screen.getByText('Fleet Utilization').closest('[data-slot="card"]');
    expect(card?.querySelector('dd')?.textContent).toBe('—');
    expect(cardLinks()).toEqual([['Flights Airborne', '/#live']]);
  });
});
