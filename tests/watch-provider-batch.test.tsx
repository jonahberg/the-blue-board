// @vitest-environment jsdom
/**
 * F2 — a board load changes several watched flights at once, and all of them must survive.
 *
 * The Schedule tab's watched-flight diff walks every row of a landed board and restamps each
 * matched flight. That is ONE event: the shipped dashboard accumulated the changes in an array
 * and saved once, so a board on which three watched flights departed stored three departures.
 * A provider whose per-call snapshot only advances on render stores the last one and loses the
 * rest — and the lost transitions are then re-announced on the next load, because the stored
 * baseline never moved.
 *
 * Two levels here: the brief's repro (two `updateStatus` calls inside one `act`), and the
 * batch entry point the diff actually calls — one read, one reduce, one write.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WatchedFlight } from '../src/app/data/types';
import { WatchProvider, useWatch } from '../src/app/state/watch';
import type { WatchValue } from '../src/app/state/watch';

vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
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

function Probe({ into }: { into: { current: WatchValue | null } }) {
  into.current = useWatch();
  return null;
}

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
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('WatchProvider batched status updates', () => {
  it('keeps both transitions when two statuses change in one render pass', async () => {
    localStorage.setItem(KEY, JSON.stringify([entry('UA1'), entry('UA2')]));
    const tab = await openTab();

    await act(async () => {
      tab.current?.updateStatus('UA1', 'Landed');
      tab.current?.updateStatus('UA2', 'Landed');
    });

    expect(stored().map((e) => [e.flight, e.status])).toEqual([
      ['UA1', 'Landed'],
      ['UA2', 'Landed'],
    ]);
    expect(tab.current?.watched.map((e) => [e.flight, e.status])).toEqual([
      ['UA1', 'Landed'],
      ['UA2', 'Landed'],
    ]);
  });

  it('applies a whole board of changes in a single storage write', async () => {
    localStorage.setItem(KEY, JSON.stringify([entry('UA1'), entry('UA2'), entry('UA3')]));
    const tab = await openTab();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    await act(async () => {
      tab.current?.applyStatusChanges([
        { flight: 'UA1', status: 'Departed' },
        { flight: 'UA2', status: 'Landed' },
        { flight: 'UA3', status: 'Cancelled', route: 'DEN→SFO' },
      ]);
    });

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(stored().map((e) => [e.flight, e.status])).toEqual([
      ['UA1', 'Departed'],
      ['UA2', 'Landed'],
      ['UA3', 'Cancelled'],
    ]);
    expect(stored()[2].route).toBe('DEN→SFO');
    expect(tab.current?.watched.map((e) => e.status)).toEqual(['Departed', 'Landed', 'Cancelled']);
  });

  it('writes nothing when a board restamps statuses that have not moved', async () => {
    localStorage.setItem(KEY, JSON.stringify([entry('UA1'), entry('UA2')]));
    const tab = await openTab();
    const before = tab.current?.watched;
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    await act(async () => {
      tab.current?.applyStatusChanges([
        { flight: 'UA1', status: 'Scheduled' },
        { flight: 'UA2', status: 'Scheduled' },
        // Not watched at all — the diff never sends these, but the guard is the same one
        // `updateStatus()` has always had.
        { flight: 'UA9', status: 'Landed' },
      ]);
    });

    expect(setItem).not.toHaveBeenCalled();
    expect(tab.current?.watched).toBe(before);
  });

  it('reads the latest storage, so a batch cannot clobber another tab either', async () => {
    localStorage.setItem(KEY, JSON.stringify([entry('UA1'), entry('UA2')]));
    const a = await openTab();
    const b = await openTab();

    await act(async () => {
      a.current?.toggle('UA5', 'IAH→LAX', 'Scheduled');
    });

    await act(async () => {
      b.current?.applyStatusChanges([{ flight: 'UA1', status: 'Departed' }]);
    });

    const after = stored();
    expect(after.map((e) => e.flight)).toEqual(['UA5', 'UA1', 'UA2']);
    expect(after.find((e) => e.flight === 'UA1')?.status).toBe('Departed');
  });
});
