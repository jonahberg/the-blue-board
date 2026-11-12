// @vitest-environment jsdom
/**
 * A dashboard link followed in place (src/app/features/DashLink.tsx, src/app/state/follow-link.ts).
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

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashLink } from '../src/app/features/DashLink';
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

  it('queues a Fleet link and bumps seq on a repeat click', () => {
    const link = mount('/?tab=fleet&type=A319');
    expect(seen.ui!.fleetLink).toBeNull();

    fireEvent.click(link);
    expect(reachedDocumentPrevented).toBe(true);
    expect(seen.ui!.fleetLink).toEqual({ filter: 'A319', view: null, seq: 1 });
    expect(seen.ui!.tab).toBe('fleet');

    // The same link again applies again: the Fleet view watches `seq`, not the filter.
    fireEvent.click(link);
    expect(seen.ui!.fleetLink).toEqual({ filter: 'A319', view: null, seq: 2 });
    expect(seen.ui!.tab).toBe('fleet');
  });
});

describe('DashLink, everything else is the browser\'s', () => {
  it.each([{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }])(
    'leaves a modified click to the browser (%o)',
    (init) => {
      const link = mount('/?tab=schedule&hub=ORD');

      fireEvent.click(link, init);

      expect(reachedDocumentPrevented).toBe(false);
      expect(seen.ui!.tab).toBe('live');
      expect(seen.schedule!.current.hub).toBe('DEN');
      expect(seen.ui!.aircraftReg).toBeNull();
      expect(seen.ui!.fleetLink).toBeNull();
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

    fireEvent.click(link);

    expect(reachedDocumentPrevented).toBe(false);
    expect(seen.ui!.tab).toBe('live');
    expect(seen.schedule!.current.hub).toBe('DEN');
  });
});
