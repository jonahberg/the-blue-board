// @vitest-environment jsdom
/**
 * A followed link that changes the tab, in a shell built the way Dashboard.tsx builds it: the
 * real tab bar and tab panels (Radix, `forceMount`), the real `useDeepLinks` listener, and the
 * real UiProvider, ScheduleProvider and FollowProvider.
 *
 *  - Back: the link leaves ONE history entry, the path plus the new tab's hash with the dashboard's
 *    own deep-link parameters dropped, so Back returns to the tab the reader was on. An aircraft
 *    link and a link to the tab already showing leave none; the tab bar keeps replacing.
 *  - Focus and words: a link inside the panel it hides moves focus to the panel it opens, a frame
 *    later; a header link keeps focus; the polite region says where the link went.
 *
 * jsdom applies no stylesheet, so a hidden panel's link keeps focus here where a browser would drop
 * it to <body>; the follow handles both (focus inside the panel being left, or lost).
 *
 * Back is jsdom's own `history.back()`, which fires `popstate` and `hashchange` as a browser does.
 * The Schedule store's watch-list collaborators are stubbed (the real ones poll).
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useCallback } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Tabs, TabsContent } from '@/components/ui/tabs';
import { DashLink } from '../src/app/features/DashLink';
import { TailLink, TypeLink } from '../src/app/features/EntityLinks';
import { TabBar } from '../src/app/shell/TabBar';
import { useDeepLinks } from '../src/app/state/deep-links';
import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider, useSchedule } from '../src/app/state/schedule';
import type { ScheduleValue } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';
import { TABS } from '../src/app/tabs';
import type { TabId } from '../src/app/tabs';

vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ watched: [] }) }));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));

const seen: { ui: UiValue | null; schedule: ScheduleValue | null } = { ui: null, schedule: null };

/**
 * Dashboard.tsx's shell in miniature: a header link outside the panels (as a hub chip is), the tab
 * bar, and one panel per tab with the Starlink panel's links inside it.
 */
function Shell() {
  const ui = useUi();
  const schedule = useSchedule();
  seen.ui = ui;
  seen.schedule = schedule;
  const { setCurrent } = schedule;
  useDeepLinks({
    flights: [],
    setTab: ui.setTab,
    select: ui.select,
    openAircraft: ui.openAircraft,
    openFr24: ui.openFr24,
    setWaitlistOpen: ui.setWaitlistOpen,
    setScheduleHub: useCallback((hub: string) => setCurrent({ hub }), [setCurrent]),
    announce: ui.announce,
    addWatch: () => true,
  });
  return (
    <>
      <header>
        <DashLink href="/?tab=schedule&hub=DEN">DEN chip</DashLink>
      </header>
      {/* An overlay's links (the flight sheet, the aircraft dialog), outside every panel. */}
      <div role="dialog" aria-label="overlay">
        <DashLink href="/?tab=schedule&hub=ORD" fromOverlay>
          ORD in the sheet
        </DashLink>
        <TypeLink typeCode="737 MAX 9" fromOverlay>
          737 MAX 9 in the dialog
        </TypeLink>
        <TailLink reg="N78501" fromOverlay>
          N78501 in the sheet
        </TailLink>
      </div>
      <Tabs value={ui.tab} onValueChange={(value) => ui.setTab(value as TabId)}>
        <TabBar />
        {TABS.map(({ id }) => (
          <TabsContent key={id} value={id} forceMount data-tab-panel={id}>
            {id === 'starlink' ? (
              <>
                <DashLink href="/?tab=schedule&hub=ORD">ORD</DashLink>
                <DashLink href="/?aircraft=N78501">N78501</DashLink>
                <DashLink href="/?tab=fleet&type=737%20MAX%209">737 MAX 9</DashLink>
              </>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}

function mountAt(url: string) {
  window.history.replaceState(null, '', url);
  render(
    <UiProvider>
      <ScheduleProvider defaultHub="IAH">
        <FollowProvider>
          <Shell />
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
}

const address = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

/** The browser's Back button: jsdom traverses the history and fires popstate and hashchange. */
async function back() {
  await act(async () => {
    window.history.back();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

/** The page's `popstate` / `hashchange` listeners, in the order they were registered. */
type HistoryListener = { type: 'popstate' | 'hashchange'; listener: EventListenerOrEventListenerObject };

/** Record every history listener the dashboard registers from now on (call before mounting). */
function recordHistoryListeners() {
  const listeners: HistoryListener[] = [];
  const add = window.addEventListener.bind(window);
  const spy = vi.spyOn(window, 'addEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === 'popstate' || type === 'hashchange') listeners.push({ type, listener });
    add(type, listener, options);
  }) as typeof window.addEventListener);
  return { listeners, restore: () => spy.mockRestore() };
}

/**
 * Back or Forward the way a browser delivers it: the entry's address is restored, then `popstate`
 * and `hashchange` fire, and between one listener and the next the browser runs a microtask
 * checkpoint, where React commits a tab change a listener asked for (popstate and hashchange are
 * discrete events). jsdom calls every listener in one stack, with no checkpoint, so its own
 * `history.back()` cannot show an order bug; here each listener runs in its own `act`.
 */
async function browserHistoryMove(address: string, listeners: HistoryListener[]) {
  window.history.replaceState(null, '', address);
  for (const type of ['popstate', 'hashchange'] as const) {
    for (const entry of listeners.filter((l) => l.type === type)) {
      const event = type === 'popstate' ? new PopStateEvent('popstate') : new HashChangeEvent('hashchange');
      await act(async () => {
        if (typeof entry.listener === 'function') entry.listener.call(window, event);
        else entry.listener.handleEvent(event);
      });
    }
  }
}

/** After the frame a follow waits for before it moves focus. */
async function nextFrame() {
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

const panel = (id: TabId) => document.querySelector<HTMLElement>(`[data-tab-panel="${id}"]`)!;

/** A primary mouse press on a tab, which is how Radix activates it. */
function pickTab(name: string) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 });
}

function recordClick(event: Event) {
  // jsdom cannot load another document and says so on the console.
  event.preventDefault();
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

beforeEach(() => {
  // A fresh entry drops any forward entries an earlier Back left, so a push grows the history.
  window.history.pushState(null, '', '/');
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

describe('Back after a followed link', () => {
  it('a link that changes the tab leaves one entry; Back returns to the tab you were on', async () => {
    mountAt('/?utm_source=email#starlink');
    expect(seen.ui!.tab).toBe('starlink');
    const before = window.history.length;

    fireEvent.click(screen.getByRole('link', { name: 'ORD' }));

    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.schedule!.current.hub).toBe('ORD');
    expect(window.history.length).toBe(before + 1);
    expect(address()).toBe('/?utm_source=email#schedule');

    await back();

    expect(seen.ui!.tab).toBe('starlink');
    expect(address()).toBe('/?utm_source=email#starlink');
  });

  it("drops the dashboard's own parameters from the new entry and keeps the rest", async () => {
    // A cold load of ?view=starlink shows the Starlink tab and stamps its hash.
    mountAt('/?view=starlink&utm_source=email');
    expect(seen.ui!.tab).toBe('starlink');
    expect(address()).toBe('/?view=starlink&utm_source=email#starlink');
    const before = window.history.length;

    fireEvent.click(screen.getByRole('link', { name: 'ORD' }));

    expect(window.history.length).toBe(before + 1);
    expect(address()).toBe('/?utm_source=email#schedule');

    await back();

    expect(seen.ui!.tab).toBe('starlink');
    expect(address()).toBe('/?view=starlink&utm_source=email#starlink');
  });

  it('from a fresh / with no hash: the entry left names its tab, so Back finds Live again', async () => {
    mountAt('/');
    expect(seen.ui!.tab).toBe('live');
    expect(window.location.hash).toBe('');
    const before = window.history.length;

    fireEvent.click(screen.getByRole('link', { name: 'DEN chip' }));

    expect(seen.ui!.tab).toBe('schedule');
    expect(window.history.length).toBe(before + 1);

    await back();

    expect(seen.ui!.tab).toBe('live');
    expect(address()).toBe('/#live');
  });

  it('an aircraft link opens its dialog and leaves the history alone', () => {
    mountAt('/#starlink');
    const before = window.history.length;

    fireEvent.click(screen.getByRole('link', { name: 'N78501' }));

    expect(seen.ui!.aircraftReg).toBe('N78501');
    expect(seen.ui!.tab).toBe('starlink');
    expect(window.history.length).toBe(before);
    expect(address()).toBe('/#starlink');
  });

  it('a browser that refuses the history call still follows the link, without the entry', async () => {
    mountAt('/#starlink');
    const before = window.history.length;
    const refuse = () => {
      throw new DOMException('Attempt to use history.pushState() more than 100 times per 30 seconds', 'SecurityError');
    };
    const push = vi.spyOn(window.history, 'pushState').mockImplementation(refuse);
    try {
      const ord = screen.getByRole('link', { name: 'ORD' });
      ord.focus();
      fireEvent.click(ord);
      await nextFrame();

      expect(push).toHaveBeenCalled();
      expect(seen.ui!.tab).toBe('schedule');
      expect(seen.schedule!.current.hub).toBe('ORD');
      expect(seen.ui!.announcement).toBe('Schedule, ORD');
      expect(document.activeElement).toBe(panel('schedule'));
      expect(window.history.length).toBe(before);
    } finally {
      push.mockRestore();
    }
  });

  it('the tab bar still replaces, and a link to the tab now showing leaves no entry', () => {
    mountAt('/#starlink');
    const before = window.history.length;

    pickTab('Schedule');

    expect(seen.ui!.tab).toBe('schedule');
    expect(window.history.length).toBe(before);
    expect(address()).toBe('/#schedule');

    // The follow reads the tab as it is now (Schedule, set after it mounted): a new board on the
    // tab already showing is not a place to go back from.
    fireEvent.click(screen.getByRole('link', { name: 'DEN chip' }));

    expect(seen.schedule!.current.hub).toBe('DEN');
    expect(window.history.length).toBe(before);
    expect(address()).toBe('/#schedule');
  });
});

describe('a link followed from inside an overlay (fromOverlay)', () => {
  it('a hub link in the flight sheet over Live: the sheet closes, Schedule shows that hub, focus goes to its panel', async () => {
    mountAt('/#live');
    act(() => seen.ui!.select({ kind: 'ident', ident: 'UA1' }));
    const before = window.history.length;
    const link = screen.getByRole('link', { name: 'ORD in the sheet' });
    link.focus();

    fireEvent.click(link);
    await nextFrame();

    expect(seen.ui!.selection).toBeNull();
    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.schedule!.current).toMatchObject({ hub: 'ORD', dir: 'departures' });
    expect(seen.ui!.scheduleLink).toEqual({ hub: 'ORD', seq: 1 });
    expect(seen.ui!.announcement).toBe('Schedule, ORD');
    // Focus was in the overlay, outside every panel: it still moves, to the panel shown.
    expect(document.activeElement).toBe(panel('schedule'));
    expect(window.history.length).toBe(before + 1);
  });

  it('a type link in the aircraft dialog over Fleet: the dialog closes and it lands as an arrival, with no history entry', async () => {
    mountAt('/#fleet');
    act(() => seen.ui!.openAircraft('N37502'));
    const before = window.history.length;
    const link = screen.getByRole('link', { name: '737 MAX 9 in the dialog' });
    link.focus();

    fireEvent.click(link);
    await nextFrame();

    expect(seen.ui!.aircraftReg).toBeNull();
    expect(seen.ui!.tab).toBe('fleet');
    expect(seen.ui!.fleetLink).toMatchObject({ filter: '737 MAX 9', arriving: true });
    expect(seen.ui!.announcement).toBe('Fleet, 737 MAX 9');
    expect(document.activeElement).toBe(panel('fleet'));
    expect(window.history.length).toBe(before);
    expect(address()).toBe('/#fleet');
  });

  it('a hub link in an overlay over Schedule bumps scheduleLink (an arrival); the same link outside one does not', async () => {
    mountAt('/#schedule');
    act(() => seen.ui!.select({ kind: 'ident', ident: 'UA1' }));
    fireEvent.click(screen.getByRole('link', { name: 'ORD in the sheet' }));
    expect(seen.ui!.scheduleLink).toEqual({ hub: 'ORD', seq: 1 });
    expect(seen.ui!.announcement).toBe('Schedule, ORD');

    fireEvent.click(screen.getByRole('link', { name: 'DEN chip' }));
    expect(seen.schedule!.current.hub).toBe('DEN');
    expect(seen.ui!.scheduleLink).toEqual({ hub: 'ORD', seq: 1 });
  });

  it('a tail link replaces every overlay with its aircraft dialog, on the tab already showing', async () => {
    mountAt('/#live');
    act(() => {
      seen.ui!.select({ kind: 'ident', ident: 'UA1' });
      seen.ui!.openFr24('UA9');
      seen.ui!.openDelayExplain({ flight: 'UA1' });
      seen.ui!.setSearchOpen(true);
    });
    const before = window.history.length;

    fireEvent.click(screen.getByRole('link', { name: 'N78501 in the sheet' }));
    await nextFrame();

    expect(seen.ui!).toMatchObject({
      selection: null,
      fr24Query: null,
      delayExplain: null,
      searchOpen: false,
      aircraftReg: 'N78501',
      tab: 'live',
      announcement: '',
    });
    expect(window.history.length).toBe(before);
  });

  it('a modified click on an overlay link is still the browser\'s, and closes nothing', () => {
    mountAt('/#live');
    act(() => seen.ui!.select({ kind: 'ident', ident: 'UA1' }));
    fireEvent.click(screen.getByRole('link', { name: 'ORD in the sheet' }), { metaKey: true });
    expect(seen.ui!.selection).toEqual({ kind: 'ident', ident: 'UA1' });
    expect(seen.ui!.tab).toBe('live');
  });
});

describe('focus and the announcement after a followed link', () => {
  it('a hub link inside the panel it hides: focus moves to the Schedule panel, and it says so', async () => {
    mountAt('/#starlink');
    const ord = screen.getByRole('link', { name: 'ORD' });
    ord.focus();

    fireEvent.click(ord);
    await nextFrame();

    expect(seen.ui!.tab).toBe('schedule');
    expect(document.activeElement).toBe(panel('schedule'));
    expect(seen.ui!.announcement).toBe('Schedule, ORD');
  });

  it('a type link says the tab and the type', async () => {
    mountAt('/#starlink');
    const type = screen.getByRole('link', { name: '737 MAX 9' });
    type.focus();

    fireEvent.click(type);
    await nextFrame();

    expect(seen.ui!.tab).toBe('fleet');
    expect(document.activeElement).toBe(panel('fleet'));
    expect(seen.ui!.announcement).toBe('Fleet, 737 MAX 9');
  });

  it('a header link activated from the keyboard keeps focus on itself', async () => {
    mountAt('/#starlink');
    const chip = screen.getByRole('link', { name: 'DEN chip' });
    chip.focus();

    // Enter on a focused link is a click with no pointer (detail 0).
    fireEvent.click(chip, { detail: 0 });
    await nextFrame();

    expect(seen.ui!.tab).toBe('schedule');
    expect(document.activeElement).toBe(chip);
    expect(seen.ui!.announcement).toBe('Schedule, DEN');
  });

  it('focus already lost (on <body>) goes to the panel the link opens', async () => {
    mountAt('/#starlink');
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    fireEvent.click(screen.getByRole('link', { name: 'DEN chip' }));
    await nextFrame();

    expect(document.activeElement).toBe(panel('schedule'));
  });

  it('an aircraft link changes no tab: focus stays and nothing is said', async () => {
    mountAt('/#starlink');
    const tail = screen.getByRole('link', { name: 'N78501' });
    tail.focus();

    fireEvent.click(tail);
    await nextFrame();

    expect(document.activeElement).toBe(tail);
    expect(seen.ui!.announcement).toBe('');
  });

  it('Back says the tab it returns to, once, and moves focus to its panel; Forward does the same', async () => {
    mountAt('/#starlink');
    const ord = screen.getByRole('link', { name: 'ORD' });
    ord.focus();
    fireEvent.click(ord);
    await nextFrame();
    expect(document.activeElement).toBe(panel('schedule'));

    await back();
    await nextFrame();

    expect(seen.ui!.tab).toBe('starlink');
    // Exactly the tab's name: popstate and hashchange both fired, and it was said once (a second
    // announcement of the same words would carry the repeat mark).
    expect(seen.ui!.announcement).toBe('Starlink');
    expect(document.activeElement).toBe(panel('starlink'));

    await act(async () => {
      window.history.forward();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await nextFrame();

    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.ui!.announcement).toBe('Schedule');
    expect(document.activeElement).toBe(panel('schedule'));
  });

  it("Back and Forward in a browser's order (the tab change commits between listeners) say the tab and move focus", async () => {
    const { listeners, restore } = recordHistoryListeners();
    try {
      mountAt('/#starlink');
      expect(listeners.length).toBeGreaterThan(0);
      const ord = screen.getByRole('link', { name: 'ORD' });
      ord.focus();
      fireEvent.click(ord);
      await nextFrame();
      expect(document.activeElement).toBe(panel('schedule'));

      await browserHistoryMove('/#starlink', listeners);
      await nextFrame();

      expect(seen.ui!.tab).toBe('starlink');
      expect(seen.ui!.announcement).toBe('Starlink');
      expect(document.activeElement).toBe(panel('starlink'));

      await browserHistoryMove('/#schedule', listeners);
      await nextFrame();

      expect(seen.ui!.tab).toBe('schedule');
      expect(seen.ui!.announcement).toBe('Schedule');
      expect(document.activeElement).toBe(panel('schedule'));
    } finally {
      restore();
    }
  });

  it('Back with focus outside the panels says the tab and leaves focus where it is', async () => {
    mountAt('/#starlink');
    const chip = screen.getByRole('link', { name: 'DEN chip' });
    chip.focus();
    fireEvent.click(chip, { detail: 0 });
    await nextFrame();
    expect(document.activeElement).toBe(chip);

    await back();
    await nextFrame();

    expect(seen.ui!.tab).toBe('starlink');
    expect(seen.ui!.announcement).toBe('Starlink');
    expect(document.activeElement).toBe(chip);
  });

  it('a later hash change (an in-page #tab anchor) shows the tab without rewriting the address', async () => {
    mountAt('/#starlink');
    const replace = vi.spyOn(window.history, 'replaceState');
    try {
      await act(async () => {
        window.location.hash = '#fleet';
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(seen.ui!.tab).toBe('fleet');
      expect(seen.ui!.announcement).toBe('Fleet');
      expect(address()).toBe('/#fleet');
      expect(replace).not.toHaveBeenCalled();
    } finally {
      replace.mockRestore();
    }
  });

  it('the tab bar says nothing and leaves focus on the tab', async () => {
    mountAt('/#starlink');
    const trigger = screen.getByRole('tab', { name: 'Schedule' });
    trigger.focus();

    pickTab('Schedule');
    await nextFrame();

    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.ui!.announcement).toBe('');
    expect(document.activeElement).toBe(trigger);
  });

  it('a link to the tab already showing moves nothing and says nothing', async () => {
    mountAt('/#schedule');
    const chip = screen.getByRole('link', { name: 'DEN chip' });
    chip.focus();

    fireEvent.click(chip);
    await nextFrame();

    expect(seen.schedule!.current.hub).toBe('DEN');
    expect(document.activeElement).toBe(chip);
    expect(seen.ui!.announcement).toBe('');
  });
});
