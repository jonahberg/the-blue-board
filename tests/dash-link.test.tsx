// @vitest-environment jsdom
/**
 * A dashboard link followed in place (src/app/features/DashLink.tsx, src/app/state/follow-link.tsx).
 *
 * An unmodified primary click on an address `resolveDeepLink` can apply goes through the
 * dashboard's own state (tab, Schedule board, Fleet link, aircraft dialog) and never reloads the
 * page. A modified or middle click, and any address the resolver turns down, is left to the
 * browser with the address untouched (the plan's Review Focus 1 and 5).
 *
 * Mounted in the real UiProvider and ScheduleProvider, the two stores a link drives, and the
 * FollowProvider that hands every link its `follow`. The
 * Schedule store's own collaborators are stubbed: a link never reaches the watch list or the
 * watched-flight alerts, and the real ones poll the network.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashLink, dashLinkClick } from '../src/app/features/DashLink';
import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider, useSchedule } from '../src/app/state/schedule';
import type { ScheduleValue } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';

vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ watched: [] }) }));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));

/** The two stores as the last render saw them. */
const seen: { ui: UiValue | null; schedule: ScheduleValue | null } = { ui: null, schedule: null };

function Probe() {
  seen.ui = useUi();
  seen.schedule = useSchedule();
  return null;
}

/** The link to `href`, inside the providers, with the Schedule board on DEN so ORD is a change. */
function mount(href: string) {
  render(
    <UiProvider>
      <ScheduleProvider defaultHub="DEN">
        <FollowProvider>
          <DashLink href={href}>go</DashLink>
          <Probe />
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
  return screen.getByRole('link', { name: 'go' });
}

/**
 * Whether the last click still had its default when it reached the document, which is after
 * React's handler. The listener then cancels it, because jsdom cannot load another document and
 * says so on the console.
 */
let reachedDocumentPrevented: boolean | null = null;
function recordClick(event: Event) {
  reachedDocumentPrevented = event.defaultPrevented;
  event.preventDefault();
}

/**
 * Everything a link can change, read back after a click: the stores, the address and the history.
 * A click left to the browser must leave all of it as it was.
 */
function everything() {
  const ui = seen.ui!;
  return {
    tab: ui.tab,
    pendingScroll: ui.pendingScroll,
    aircraft: ui.aircraftReg,
    fleetLink: ui.fleetLink,
    scheduleLink: ui.scheduleLink,
    announcement: ui.announcement,
    board: seen.schedule!.current,
    address: `${window.location.pathname}${window.location.search}${window.location.hash}`,
    historyLength: window.history.length,
  };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  reachedDocumentPrevented = null;
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

describe('DashLink, an unmodified primary click', () => {
  it('follows a dashboard address in place', () => {
    // Opened on the Fleet tab: an aircraft link is an overlay and keeps the tab you were on.
    window.history.replaceState(null, '', '/#fleet');
    const link = mount('/?aircraft=N78501');
    expect(link.getAttribute('href')).toBe('/?aircraft=N78501');
    expect(seen.ui!.tab).toBe('fleet');

    fireEvent.click(link);

    expect(reachedDocumentPrevented).toBe(true);
    expect(seen.ui!.aircraftReg).toBe('N78501');
    expect(seen.ui!.tab).toBe('fleet');
  });

  it('switches tab and board for a hub address', () => {
    const link = mount('/?tab=schedule&hub=ORD');
    expect(seen.ui!.tab).toBe('live');
    expect(seen.schedule!.current.hub).toBe('DEN');

    fireEvent.click(link);

    expect(reachedDocumentPrevented).toBe(true);
    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.schedule!.current.hub).toBe('ORD');
  });

  it('opens a hub\'s Departures whichever direction the board was left on', () => {
    const link = mount('/?tab=schedule&hub=ORD');
    act(() => seen.schedule!.setCurrent({ dir: 'arrivals' }));

    fireEvent.click(link);

    expect(seen.schedule!.current).toMatchObject({ hub: 'ORD', dir: 'departures' });
  });

  it('queues a Fleet link and bumps seq on a repeat click', () => {
    const link = mount('/?tab=fleet&type=A319');
    expect(seen.ui!.fleetLink).toBeNull();

    fireEvent.click(link);
    expect(reachedDocumentPrevented).toBe(true);
    // From Live: the link arrives at Fleet.
    expect(seen.ui!.fleetLink).toEqual({ filter: 'A319', view: null, seq: 1, arriving: true, at: expect.any(Number) });
    expect(seen.ui!.tab).toBe('fleet');

    // The same link again applies again: the Fleet view watches `seq`, not the filter. Fleet is
    // showing now, so this one does not arrive (the Fleet view resets nothing for it).
    fireEvent.click(link);
    expect(seen.ui!.fleetLink).toEqual({ filter: 'A319', view: null, seq: 2, arriving: false, at: expect.any(Number) });
    expect(seen.ui!.tab).toBe('fleet');
  });

  it('a hub link arriving at Schedule bumps scheduleLink; one followed on Schedule does not', () => {
    const link = mount('/?tab=schedule&hub=ORD');
    expect(seen.ui!.scheduleLink).toBeNull();

    fireEvent.click(link);
    expect(seen.ui!.scheduleLink).toEqual({ hub: 'ORD', seq: 1 });

    // Schedule is showing now: the board changes hub, the Schedule view keeps its filters.
    act(() => seen.schedule!.setCurrent({ hub: 'DEN' }));
    fireEvent.click(link);
    expect(seen.schedule!.current.hub).toBe('ORD');
    expect(seen.ui!.scheduleLink).toEqual({ hub: 'ORD', seq: 1 });
  });

  it("a hub link followed on Schedule changes the hub and keeps the reader's direction and day", () => {
    const link = mount('/?tab=schedule&hub=ORD');
    act(() => seen.ui!.setTab('schedule'));
    act(() => seen.schedule!.setCurrent({ dir: 'arrivals', day: 1 }));
    const before = window.history.length;

    fireEvent.click(link);

    expect(seen.schedule!.current).toEqual({ hub: 'ORD', dir: 'arrivals', day: 1 });
    expect(window.history.length).toBe(before);
    expect(seen.ui!.announcement).toBe('');
  });
});

describe('DashLink, everything else is the browser\'s', () => {
  it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
    'leaves a modified click to the browser (%o)',
    (init) => {
      const link = mount('/?tab=schedule&hub=ORD');
      const before = everything();

      fireEvent.click(link, init);

      expect(reachedDocumentPrevented).toBe(false);
      expect(seen.ui!.tab).toBe('live');
      expect(seen.schedule!.current.hub).toBe('DEN');
      expect(everything()).toEqual(before);
    },
  );

  it.each([
    // A hub page, a flight page and another origin are page loads.
    '/hubs/ord',
    '/flight/UA576',
    'https://example.com/?tab=schedule&hub=ORD',
    // A dashboard address carrying more than an in-place follow can apply loads whole.
    '/?tab=schedule&hub=ORD&flight=UA576',
  ])('does not intercept an address it cannot follow in place (%s)', (href) => {
    const link = mount(href);
    const before = everything();

    fireEvent.click(link);

    expect(reachedDocumentPrevented).toBe(false);
    expect(seen.ui!.tab).toBe('live');
    expect(seen.schedule!.current.hub).toBe('DEN');
    expect(everything()).toEqual(before);
  });

  it('leaves alone a click something earlier already cancelled, and changes nothing', () => {
    const link = mount('/?tab=schedule&hub=ORD');
    const before = everything();
    // A capture listener above the dashboard (a dialog's outside-click guard, say) has handled it.
    const cancelFirst = (event: Event) => event.preventDefault();
    document.addEventListener('click', cancelFirst, { capture: true });
    try {
      fireEvent.click(link);
    } finally {
      document.removeEventListener('click', cancelFirst, { capture: true });
    }

    expect(everything()).toEqual(before);
  });
});

describe('dashLinkClick returns whether it followed the link', () => {
  /** A React click event as the handler reads it. */
  function click(init: Partial<{ defaultPrevented: boolean; button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) {
    const event = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...init, preventDefault: vi.fn() };
    return event as typeof event & Parameters<ReturnType<typeof dashLinkClick>>[0];
  }

  it('true, with the default prevented and the intent followed, for a plain click it can follow', () => {
    const follow = vi.fn();
    const event = click();
    expect(dashLinkClick(follow, '/?tab=schedule&hub=ORD')(event)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(follow).toHaveBeenCalledWith(expect.objectContaining({ tab: 'schedule', scheduleHub: 'ORD' }));
  });

  it.each([
    ['already cancelled', { defaultPrevented: true }],
    ['a middle click', { button: 1 }],
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
  ])('false, touching nothing, for a click %s', (_, init) => {
    const follow = vi.fn();
    const event = click(init);
    expect(dashLinkClick(follow, '/?tab=schedule&hub=ORD')(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(follow).not.toHaveBeenCalled();
  });

  it('false, touching nothing, for an address the resolver turns down', () => {
    const follow = vi.fn();
    const event = click();
    expect(dashLinkClick(follow, '/hubs/ord')(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(follow).not.toHaveBeenCalled();
  });
});
