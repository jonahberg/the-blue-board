// @vitest-environment jsdom
/**
 * Phone QA Oct 4 2026 (390px iOS, 00:36–01:10Z): six watched flights, four landings, and no correct
 * in-tab alert in 30 minutes — alerts only ran on Schedule-board reloads, which never happen on
 * their own, while the My Flights cards (polling /api/flight-times) showed "Landed" within a minute
 * or two. The alert provider now polls those answers itself, whatever tab is open, and a second
 * source reporting the same landing does not fire again.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WatchedFlight } from '../src/app/data/types';

const ui = vi.hoisted(() => ({ announce: vi.fn(), select: vi.fn(), showBmacToast: vi.fn() }));
vi.mock('../src/app/state/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/ui')>()),
  useUi: () => ui,
}));
const feed = vi.hoisted(() => ({ flights: [] as unknown[] }));
vi.mock('../src/app/state/feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/feed')>()),
  useFeed: () => feed,
}));
const api = vi.hoisted(() => ({ fetchFlightTimes: vi.fn() }));
vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchPushConfig: async () => ({ configured: false }),
  postPushSubscribe: async () => ({ success: true }),
  fetchFlightTimes: api.fetchFlightTimes,
}));

import { WatchProvider } from '../src/app/state/watch';
import { WatchAlertsProvider, useWatchAlerts } from '../src/app/state/watch-alerts';
import type { WatchAlertsValue } from '../src/app/state/watch-alerts';
import { clearFlightTimesCache } from '../src/app/views/myflight/useFlightTimes';

const KEY = 'bb_watched_flights';
const DEP = Math.floor(Date.now() / 1000) - 2 * 3600;
const iso = (sec: number) => new Date(sec * 1000).toISOString();

function landedTimes() {
  return {
    success: true, flight: 'UA2059', status: 'landed', cancelled: false, diverted: false,
    origin: { iata: 'ROC', gate: '', tz: 'America/New_York' }, destination: { iata: 'ORD', tz: 'America/Chicago' },
    departure: { gate: { scheduled: iso(DEP), estimated: '', actual: iso(DEP + 300) }, takeoff: {} },
    arrival: { gate: { scheduled: iso(DEP + 5400), estimated: '', actual: iso(DEP + 5000) }, landing: {} },
    registration: 'N12345',
  };
}

function Probe({ into }: { into: { current: WatchAlertsValue | null } }) {
  into.current = useWatchAlerts();
  return null;
}

beforeEach(() => {
  localStorage.clear();
  clearFlightTimesCache();
  vi.clearAllMocks();
  const watched: WatchedFlight[] = [{ flight: 'UA2059', route: 'ROC→ORD', status: 'En Route', ts: 1, dep: DEP }];
  localStorage.setItem(KEY, JSON.stringify(watched));
  api.fetchFlightTimes.mockResolvedValue(landedTimes());
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('in-tab watch alerts from the My Flights polling path', () => {
  it('alerts the landing without any Schedule board, once, with the toast', async () => {
    const handle: { current: WatchAlertsValue | null } = { current: null };
    await act(async () => {
      render(
        <WatchProvider>
          <WatchAlertsProvider>
            <Probe into={handle} />
          </WatchAlertsProvider>
        </WatchProvider>,
      );
    });
    await act(async () => { await Promise.resolve(); });

    expect(api.fetchFlightTimes).toHaveBeenCalledWith('UA2059', undefined, undefined);
    expect(ui.announce).toHaveBeenCalledTimes(1);
    expect(ui.announce).toHaveBeenCalledWith('🔔 UA2059 ROC→ORD: Landed (was: En Route)');
    expect(handle.current?.alert?.message).toBe('🔔 UA2059 ROC→ORD: Landed (was: En Route)');
    expect(ui.showBmacToast).toHaveBeenCalledWith('UA2059');
    expect((JSON.parse(localStorage.getItem(KEY) || '[]') as WatchedFlight[])[0].status).toBe('Landed');

    // The Schedule board now loads and reports the same landing ("Arrived"): nothing new.
    await act(async () => {
      handle.current?.observe([{ flight: 'UA2059', phase: 'landed', key: 'landed', text: 'Arrived', dep: DEP, delayMin: 5, route: 'ROC→ORD' }]);
    });
    // …and a stale row still saying "En route" is neither news nor a step back.
    await act(async () => {
      handle.current?.observe([{ flight: 'UA2059', phase: 'departed', key: 'enroute', text: 'En route', dep: DEP, delayMin: 5, route: 'ROC→ORD' }]);
    });
    expect(ui.announce).toHaveBeenCalledTimes(1);
    expect(ui.showBmacToast).toHaveBeenCalledTimes(1);
    expect((JSON.parse(localStorage.getItem(KEY) || '[]') as WatchedFlight[])[0].status).toBe('Landed');
  });
});
