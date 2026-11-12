// @vitest-environment jsdom
/**
 * The in-place follow (src/app/state/follow-link.tsx) beyond what a link sets, which
 * tests/dash-link.test.tsx and tests/deep-link-equivalence.test.tsx cover.
 *
 *  - `follow` comes from a context whose value never changes, so a link does not re-render when
 *    unrelated UI or Schedule state changes, and a follow still reads the stores as they are now.
 *
 * Mounted in the real UiProvider, ScheduleProvider and FollowProvider; the Schedule store's
 * watch-list collaborators are stubbed (the real ones poll), as in tests/dash-link.test.tsx.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashLink } from '../src/app/features/DashLink';
import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider, useSchedule } from '../src/app/state/schedule';
import type { ScheduleValue } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';

vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ watched: [] }) }));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));
// The render counter: DashLink builds its classes with `cn` on every render, and nothing else in
// this tree calls it. (A <Profiler> does not see a context-only re-render here.)
const cnCalls = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/lib/utils', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lib/utils')>();
  return {
    ...real,
    cn: (...args: Parameters<typeof real.cn>) => {
      cnCalls.count += 1;
      return real.cn(...args);
    },
  };
});

/** The two stores as the last render saw them. */
const seen: { ui: UiValue | null; schedule: ScheduleValue | null } = { ui: null, schedule: null };
function Probe() {
  seen.ui = useUi();
  seen.schedule = useSchedule();
  return null;
}

/** Renders of the counted link, from its first mount. */
const linkRenders = () => cnCalls.count;

/**
 * One counted link to `href` beside the probe. Its parent reads no store, so anything that
 * re-renders the link is the link's own subscription.
 */
function mount(href: string) {
  render(
    <UiProvider>
      <ScheduleProvider defaultHub="DEN">
        <FollowProvider>
          <Probe />
          <DashLink href={href}>go</DashLink>
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
  return screen.getByRole('link', { name: 'go' });
}

function recordClick(event: Event) {
  // jsdom cannot load another document and says so on the console.
  event.preventDefault();
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  cnCalls.count = 0;
  document.addEventListener('click', recordClick);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in this test'))));
});

afterEach(() => {
  cleanup();
  document.removeEventListener('click', recordClick);
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  seen.ui = null;
  seen.schedule = null;
});

describe('follow is its own context', () => {
  it('a link does not re-render when unrelated UI or Schedule state changes', () => {
    mount('/?tab=schedule&hub=ORD');
    expect(linkRenders()).toBe(1);

    act(() => seen.ui!.setTab('fleet'));
    act(() => seen.ui!.announce('Something happened'));
    act(() => seen.ui!.setSearchOpen(true));
    act(() => seen.ui!.openAircraft('N78501'));
    act(() => seen.ui!.select({ kind: 'ident', ident: 'UA1' }));
    act(() => seen.schedule!.setCurrent({ dir: 'arrivals', day: 1 }));

    expect(seen.ui!.tab).toBe('fleet');
    expect(seen.schedule!.current.dir).toBe('arrivals');
    expect(linkRenders()).toBe(1);
  });

  it('following still works after the stores have changed under it', () => {
    const link = mount('/?tab=schedule&hub=ORD');
    act(() => seen.ui!.setTab('fleet'));
    act(() => seen.schedule!.setCurrent({ hub: 'IAH' }));

    fireEvent.click(link);

    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.schedule!.current.hub).toBe('ORD');
    // The click changed the stores, not the link.
    expect(linkRenders()).toBe(1);
  });

  it('throws outside its provider, as the stores do', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<DashLink href="/#live">x</DashLink>)).toThrow(/outside <FollowProvider>/);
    vi.restoreAllMocks();
  });
});
