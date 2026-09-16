// @vitest-environment jsdom
/**
 * F1 — a second tab must not delete the first tab's watches.
 *
 * `bb_watched_flights` is shared by every open tab. The shipped dashboard re-read it at the
 * top of `toggleWatchFlight()` and `checkWatchedFlightChanges()`, so two tabs could only ever
 * lose a race, never a whole entry. A provider that keeps a mount-time snapshot and writes it
 * back wholesale silently DELETES whatever the other tab added in between.
 *
 * "Tab B" here is a second `<WatchProvider>` rendered into its own root against the same
 * `localStorage`, which is exactly the shape of the bug: two independent React trees, one
 * storage key. Same-window `setItem` does not fire `storage` (per spec, and jsdom agrees),
 * so the cross-tab notification is simulated with an explicit `StorageEvent`.
 *
 * Every assertion is against STORAGE, not against a rendered list: storage is what the next
 * load reads, and it is where the entry actually goes missing.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WatchedFlight } from '../src/app/data/types';
import { WatchProvider, useWatch } from '../src/app/state/watch';
import type { WatchValue } from '../src/app/state/watch';

vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  // The provider bootstraps push on mount. A deployment without VAPID keys is the quiet
  // path through that effect and keeps this file about the watch list.
  fetchPushConfig: async () => ({ configured: false }),
  postPushSubscribe: async () => ({ success: true }),
}));

const KEY = 'bb_watched_flights';

function entry(flight: string, status = 'Scheduled', ts = 1): WatchedFlight {
  return { flight, route: 'ORD→DEN', status, ts };
}

function stored(): WatchedFlight[] {
  return JSON.parse(localStorage.getItem(KEY) || '[]') as WatchedFlight[];
}

function seed(list: WatchedFlight[]): void {
  localStorage.setItem(KEY, JSON.stringify(list));
}

/** Hands one provider's context value out to the test. */
function Probe({ into }: { into: { current: WatchValue | null } }) {
  into.current = useWatch();
  return null;
}

/** Mount one independent `<WatchProvider>` — one "tab". */
async function openTab(): Promise<{ current: WatchValue | null }> {
  const handle: { current: WatchValue | null } = { current: null };
  await act(async () => {
    render(
      <WatchProvider>
        <Probe into={handle} />
      </WatchProvider>,
    );
  });
  return handle;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('WatchProvider across two tabs', () => {
  it('keeps a flight tab A added when tab B then updates a status', async () => {
    seed([entry('UA1'), entry('UA2')]);

    const a = await openTab();
    const b = await openTab();

    await act(async () => {
      a.current?.toggle('UA3', 'SFO→EWR', 'Scheduled');
    });
    expect(stored().map((e) => e.flight)).toEqual(['UA3', 'UA1', 'UA2']);

    // Tab B has never seen UA3 — its snapshot is the two entries it mounted with.
    await act(async () => {
      b.current?.updateStatus('UA1', 'Departed');
    });

    const after = stored();
    expect(after.map((e) => e.flight)).toEqual(['UA3', 'UA1', 'UA2']);
    expect(after.find((e) => e.flight === 'UA1')?.status).toBe('Departed');
  });

  it('keeps a flight tab A removed removed when tab B then updates a status', async () => {
    seed([entry('UA1'), entry('UA2')]);

    const a = await openTab();
    const b = await openTab();

    await act(async () => {
      a.current?.toggle('UA2');
    });
    expect(stored().map((e) => e.flight)).toEqual(['UA1']);

    await act(async () => {
      b.current?.updateStatus('UA1', 'Departed');
    });

    const after = stored();
    expect(after.map((e) => e.flight)).toEqual(['UA1']);
    expect(after[0].status).toBe('Departed');
  });

  it('keeps a route tab A filled in when tab B then updates a status', async () => {
    seed([{ flight: 'UA1', route: '', status: 'Scheduled', ts: 1 }, entry('UA2')]);

    const a = await openTab();
    const b = await openTab();

    await act(async () => {
      a.current?.updateRoute('UA1', 'ORD→SFO');
    });
    expect(stored()[0].route).toBe('ORD→SFO');

    await act(async () => {
      b.current?.updateStatus('UA2', 'Departed');
    });

    const after = stored();
    expect(after[0].route).toBe('ORD→SFO');
    expect(after[1].status).toBe('Departed');
  });

  it('does not resurrect a list tab A cleared when tab B then adds a flight', async () => {
    seed([entry('UA1'), entry('UA2')]);

    const a = await openTab();
    const b = await openTab();

    await act(async () => {
      a.current?.clearAll();
    });
    expect(stored()).toEqual([]);

    await act(async () => {
      b.current?.toggle('UA9', 'DEN→IAH', 'Scheduled');
    });

    expect(stored().map((e) => e.flight)).toEqual(['UA9']);
  });

  it('reconciles its rendered list when another tab writes the key', async () => {
    seed([entry('UA1')]);
    const a = await openTab();
    expect(a.current?.watched.map((e) => e.flight)).toEqual(['UA1']);

    const next = [entry('UA1'), entry('UA7')];
    await act(async () => {
      // Another tab's write: storage first, then the event the browser would deliver here.
      localStorage.setItem(KEY, JSON.stringify(next));
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: KEY,
          newValue: JSON.stringify(next),
          storageArea: localStorage,
        }),
      );
    });

    expect(a.current?.watched.map((e) => e.flight)).toEqual(['UA1', 'UA7']);
    expect(a.current?.isWatched('UA7')).toBe(true);
  });

  it('reconciles when another tab clears storage entirely (key === null)', async () => {
    seed([entry('UA1')]);
    const a = await openTab();

    await act(async () => {
      localStorage.clear();
      window.dispatchEvent(new StorageEvent('storage', { key: null, storageArea: localStorage }));
    });

    expect(a.current?.watched).toEqual([]);
  });

  it('ignores a storage event for an unrelated key', async () => {
    seed([entry('UA1')]);
    const a = await openTab();

    await act(async () => {
      localStorage.setItem('bb_home_airport', 'ORD');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'bb_home_airport',
          newValue: 'ORD',
          storageArea: localStorage,
        }),
      );
    });

    expect(a.current?.watched.map((e) => e.flight)).toEqual(['UA1']);
  });
});
