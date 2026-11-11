// @vitest-environment jsdom
/**
 * `WatchValue.add` — the `?watch=` deep link's way in (the flight page's "Watch this flight").
 *
 * The flight page used to write `bb_watched_flights` itself, so the push subscription never
 * heard about the flight. The deep link now adds through the eye buttons' own path, and it does
 * so on mount — before `/api/push-subscribe` has said whether the server has keys. A change made
 * then is remembered and mirrored once the answer arrives, instead of being silently dropped.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WatchedFlight } from '../src/app/data/types';
import { WatchProvider, useWatch } from '../src/app/state/watch';
import type { WatchValue } from '../src/app/state/watch';

const push = vi.hoisted(() => ({
  resolveConfig: null as null | ((c: { configured: boolean; vapidPublicKey?: string }) => void),
  post: vi.fn(async (_body: unknown) => ({ success: true })),
}));

vi.mock('../src/app/data/api', async (importOriginal) => {
  return {
    ...(await importOriginal<typeof import('../src/app/data/api')>()),
    fetchPushConfig: () => new Promise((resolve) => { push.resolveConfig = resolve; }),
    postPushSubscribe: (body: unknown) => push.post(body),
  };
});

const KEY = 'bb_watched_flights';
const stored = (): WatchedFlight[] => JSON.parse(localStorage.getItem(KEY) || '[]') as WatchedFlight[];

function Probe({ into }: { into: { current: WatchValue | null } }) {
  into.current = useWatch();
  return null;
}

/** A browser whose viewer already granted notifications and holds a push subscription. */
function grantedBrowser() {
  const subscription = {
    endpoint: 'https://push.example/abc',
    toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true),
  };
  const registration = { pushManager: { getSubscription: vi.fn(async () => subscription), subscribe: vi.fn() } };
  vi.stubGlobal('Notification', { permission: 'granted', requestPermission: vi.fn() });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve(registration) } });
  vi.stubGlobal('PushManager', function PushManager() {});
}

beforeEach(() => {
  localStorage.clear();
  push.post.mockClear();
  push.resolveConfig = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  // jsdom has no serviceWorker of its own: remove the stub.
  delete (navigator as unknown as Record<string, unknown>).serviceWorker;
  localStorage.clear();
});

async function mount() {
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

describe('WatchProvider.add', () => {
  it('adds once, with the pinned leg, and never removes a flight already watched', async () => {
    const watch = await mount();
    let added = false;
    act(() => {
      added = watch.current!.add('UA929', 'ORD→LHR', '', 1_794_433_500);
    });
    expect(added).toBe(true);
    expect(stored()).toEqual([expect.objectContaining({ flight: 'UA929', route: 'ORD→LHR', status: '', dep: 1_794_433_500 })]);
    expect(watch.current!.justAddedFirst).toBe(true);

    act(() => {
      added = watch.current!.add('UA929', 'ORD→LHR');
    });
    expect(added).toBe(false);
    expect(stored()).toHaveLength(1);
  });

  it('checks storage, not the render: a flight another tab (or an earlier visit) stored is not re-added', async () => {
    localStorage.setItem(KEY, JSON.stringify([{ flight: 'UA929', route: 'ORD→LHR', status: 'Departed', ts: 5 }]));
    const watch = await mount();
    let added = true;
    act(() => {
      added = watch.current!.add('UA929', 'ORD→LHR');
    });
    expect(added).toBe(false);
    expect(stored()).toEqual([{ flight: 'UA929', route: 'ORD→LHR', status: 'Departed', ts: 5 }]);
  });

  it('mirrors a flight added before /api/push-subscribe answered, once it does', async () => {
    grantedBrowser();
    const watch = await mount();
    act(() => {
      watch.current!.add('UA929', 'ORD→LHR', '', 0);
    });
    // Not known yet whether the server has keys: nothing sent, nothing lost.
    await act(async () => {});
    expect(push.post).not.toHaveBeenCalled();

    await act(async () => {
      push.resolveConfig!({ configured: true, vapidPublicKey: 'BAAA' });
    });
    await act(async () => {});
    expect(push.post).toHaveBeenCalledTimes(1);
    expect(push.post).toHaveBeenCalledWith({
      subscription: { endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } },
      watches: [{ flight: 'UA929' }],
    });
  });

  it('sends nothing when the server answers that push is not configured', async () => {
    grantedBrowser();
    const watch = await mount();
    act(() => {
      watch.current!.add('UA929');
    });
    await act(async () => {
      push.resolveConfig!({ configured: false });
    });
    await act(async () => {});
    expect(push.post).not.toHaveBeenCalled();
  });
});
