// @vitest-environment jsdom
/**
 * Links everywhere, part 2: the Live sidebar links what its search rows name (the links plan,
 * slice 2a).
 *
 *  - A search row stays one stretched button (it shows the flight on the map) with the flight
 *    number's link above it, as before. Its hub ends and its tail are now links too, siblings of
 *    the button above it (`z-10`), and like every secondary name in a row that is one tap target
 *    they take no taps on a coarse pointer (`finePointerOnly`, ruling 3). An operating callsign
 *    (SKW5575) stays plain (ruling 4); a non-hub end stays plain.
 *  - "Check the Schedule tab →" was a button drawn as a link; it is a real link to `/#schedule`.
 *  - Below `lg` the sidebar is the Filters sheet, a modal sheet LiveView holds open itself: a link
 *    followed in place from it closes the sheet, so the reader is not left behind it.
 *  - Hub-traffic and phase rows stay filter toggles, and nothing in them is in link colour.
 *
 * Mounted in the real UiProvider, ScheduleProvider and FollowProvider, so a click is followed in
 * place through the dashboard's own state.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Flight } from '../src/app/data/types';
import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider, useSchedule } from '../src/app/state/schedule';
import type { ScheduleValue } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';
import { LiveSidebar } from '../src/app/views/live/LiveSidebar';

vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ watched: [] }) }));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));

const seen: { ui: UiValue | null; schedule: ScheduleValue | null } = { ui: null, schedule: null };
function Probe() {
  seen.ui = useUi();
  seen.schedule = useSchedule();
  return null;
}

function mount(node: ReactNode) {
  return render(
    <UiProvider>
      <ScheduleProvider defaultHub="ORD">
        <FollowProvider>
          {node}
          <Probe />
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
}

const FLIGHTS = [
  { fr24id: 'a', flightIATA: 'UA576', callsign: 'UAL576', origin: 'ORD', dest: 'SFO', reg: 'N37502' },
  { fr24id: 'b', flightIATA: '', callsign: 'SKW5575', origin: 'ROC', dest: 'DEN', reg: 'N613UX' },
] as unknown as Flight[];

function renderSidebar({ onSelect = vi.fn(), onFollowInPlace }: { onSelect?: () => void; onFollowInPlace?: () => void } = {}) {
  mount(
    <LiveSidebar
      flights={FLIGHTS}
      filtered={FLIGHTS}
      hubCodes={['ORD', 'DEN', 'SFO']}
      hubFilter=""
      phaseFilter=""
      phaseCounts={{}}
      onHubFilter={vi.fn()}
      onPhaseFilter={vi.fn()}
      onClearFilters={vi.fn()}
      onSelect={onSelect}
      onFollowInPlace={onFollowInPlace}
    />,
  );
}

/** Type into the search and wait out its 150 ms debounce. */
async function search(query: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Search the live feed' }), { target: { value: query } });
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 200)));
}

const rowOf = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('li')].find((li) => li.textContent?.includes(text))!;
const hrefs = (scope: Element) => [...scope.querySelectorAll('a')].map((a) => a.getAttribute('href'));
const linkNamed = (scope: Element, text: string) =>
  [...scope.querySelectorAll('a')].find((a) => a.textContent?.trim() === text) ?? null;

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }) as typeof requestAnimationFrame;
});
afterEach(() => {
  cleanup();
  seen.ui = null;
  seen.schedule = null;
});

describe('a Live search row links its flight, its hub ends and its tail', () => {
  it('UA576 ORD→SFO N37502: four links, the button between them showing the flight on the map', async () => {
    renderSidebar();
    await search('57');
    const row = rowOf('UA576');
    expect(hrefs(row)).toEqual(['/flight/UA576', '/?tab=schedule&hub=ORD', '/?tab=schedule&hub=SFO', '/?aircraft=N37502']);
    // No link inside the button; the button still has its name.
    const button = row.querySelector('button')!;
    expect(button.querySelector('a')).toBeNull();
    expect(button.textContent).toMatch(/Show UA576 on the map/);
  });

  it('an operating callsign and a non-hub end stay plain; the other hub and the tail link', async () => {
    renderSidebar();
    await search('57');
    const row = rowOf('SKW5575');
    expect(hrefs(row)).toEqual(['/?tab=schedule&hub=DEN', '/?aircraft=N613UX']);
    expect(linkNamed(row, 'ROC')).toBeNull();
  });

  it('the hub ends and the tail are quiet, take no taps on touch, and sit above the row button', async () => {
    renderSidebar();
    await search('57');
    const row = rowOf('UA576');
    const secondary = [...row.querySelectorAll('a')].filter((a) => !a.getAttribute('href')!.startsWith('/flight/'));
    expect(secondary).toHaveLength(3);
    for (const a of secondary) {
      const classes = a.className.split(/\s+/);
      expect(classes).toContain('pointer-coarse:pointer-events-none');
      expect(classes).toContain('z-10');
      expect(classes).not.toContain('text-primary');
    }
  });

  it('the rest of the row still shows the flight on the map', async () => {
    const onSelect = vi.fn();
    renderSidebar({ onSelect });
    await search('57');
    fireEvent.click(rowOf('UA576').querySelector('button')!);
    expect(onSelect).toHaveBeenCalledWith(FLIGHTS[0]);
  });

  it('a hub end followed in place opens that hub’s Schedule board, no reload', async () => {
    renderSidebar();
    await search('57');
    fireEvent.click(linkNamed(rowOf('UA576'), 'SFO')!);
    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.schedule!.current).toMatchObject({ hub: 'SFO', dir: 'departures' });
  });
});

describe('"Check the Schedule tab →"', () => {
  it('is a real link to the Schedule tab, followed in place', async () => {
    renderSidebar();
    await search('ZZZ');
    const link = screen.getByRole('link', { name: /Check the Schedule tab/ });
    expect(link.getAttribute('href')).toBe('/#schedule');
    fireEvent.click(link);
    expect(seen.ui!.tab).toBe('schedule');
  });
});

describe('in the Filters sheet (below lg), a link followed in place closes the sheet', () => {
  it('a hub end, the tail and "Check the Schedule tab" each close it', async () => {
    const onFollowInPlace = vi.fn();
    renderSidebar({ onFollowInPlace });
    await search('57');
    fireEvent.click(linkNamed(rowOf('UA576'), 'SFO')!);
    expect(onFollowInPlace).toHaveBeenCalledTimes(1);

    fireEvent.click(linkNamed(rowOf('UA576'), 'N37502')!);
    expect(onFollowInPlace).toHaveBeenCalledTimes(2);
    expect(seen.ui!.aircraftReg).toBe('N37502');

    await search('ZZZ');
    fireEvent.click(screen.getByRole('link', { name: /Check the Schedule tab/ }));
    expect(onFollowInPlace).toHaveBeenCalledTimes(3);
  });

  it('a click left to the browser (a new tab, the flight page) leaves the sheet open', async () => {
    const onFollowInPlace = vi.fn();
    renderSidebar({ onFollowInPlace });
    await search('57');
    const prevent = (event: Event) => event.preventDefault();
    document.addEventListener('click', prevent);
    try {
      fireEvent.click(linkNamed(rowOf('UA576'), 'SFO')!, { metaKey: true });
      fireEvent.click(linkNamed(rowOf('UA576'), 'UA576')!);
    } finally {
      document.removeEventListener('click', prevent);
    }
    expect(onFollowInPlace).not.toHaveBeenCalled();
  });
});

describe('only the Filters sheet follows as from an overlay (fromOverlay closes the flight sheet)', () => {
  it('the desktop sidebar does not: a hub end or a tail followed leaves the flight sheet open', async () => {
    renderSidebar();
    await search('57');
    act(() => seen.ui!.select({ kind: 'ident', ident: 'UA1' }));

    fireEvent.click(linkNamed(rowOf('UA576'), 'N37502')!);
    expect(seen.ui!.aircraftReg).toBe('N37502');
    expect(seen.ui!.selection).toEqual({ kind: 'ident', ident: 'UA1' });

    fireEvent.click(linkNamed(rowOf('UA576'), 'SFO')!);
    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.ui!.selection).toEqual({ kind: 'ident', ident: 'UA1' });
  });

  it('the Filters sheet does: a hub end followed from it closes the flight sheet as well', async () => {
    renderSidebar({ onFollowInPlace: vi.fn() });
    await search('57');
    act(() => seen.ui!.select({ kind: 'ident', ident: 'UA1' }));

    fireEvent.click(linkNamed(rowOf('UA576'), 'SFO')!);
    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.ui!.selection).toBeNull();
  });
});

describe('hub-traffic and phase rows stay filter toggles, with nothing in link colour', () => {
  it('no link in them, and no text-primary', () => {
    renderSidebar();
    for (const name of ['Hub traffic', 'Phase']) {
      const section = screen.getByRole('heading', { name }).closest('section')!;
      expect(section.querySelectorAll('a')).toHaveLength(0);
      expect(section.querySelector('.text-primary')).toBeNull();
    }
  });
});
