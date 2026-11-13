// @vitest-environment jsdom
/**
 * The Weather tab links the hubs it names (links everywhere, part 2):
 *  - a NAS item's hub tags each go to that hub's card on this tab (`HubStatusLink kind="weather"`),
 *    quiet; the item's title, with whatever facility code the FAA put in it, stays text;
 *  - a hub card's code is the card's identity link, that hub's Schedule board (`HubLink`); the
 *    airport name, the weather and the status line stay text;
 *  - nothing inside the IROPS block's polite live region is a link (ruling 7): the coverage line
 *    and the client fallback's FAA lines stay text.
 *
 * Mounted in the real UiProvider, ScheduleProvider and FollowProvider, as tests/dash-link.test.tsx
 * does, so a click is followed in place through the dashboard's own state.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider, useSchedule } from '../src/app/state/schedule';
import type { ScheduleValue } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';
import type { NasData } from '../src/app/data/types';
import { HubCard } from '../src/app/views/weather/HubCard';
import type { HubCardModel } from '../src/app/views/weather/HubCard';
import { NasPanel } from '../src/app/views/weather/NasPanel';
import { buildHubCardModel } from '../src/lib/weather-cards.js';

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
      <ScheduleProvider defaultHub="DEN">
        <FollowProvider>
          <TooltipProvider>{node}</TooltipProvider>
          <Probe />
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
}

function cancelPageLoads(event: Event) {
  event.preventDefault();
}

beforeEach(() => {
  window.history.replaceState(null, '', '/#weather');
  document.addEventListener('click', cancelPageLoads);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in this test'))));
});

afterEach(() => {
  cleanup();
  document.removeEventListener('click', cancelPageLoads);
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  seen.ui = null;
  seen.schedule = null;
});

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

/** Every element painted in link colour that is not a link or button. */
function linkColourOnPlainText(root: ParentNode = document) {
  return [...root.querySelectorAll('[class]')].filter(
    (el) => classes(el).some((c) => /^text-primary(\/\d+)?$/.test(c)) && !el.closest('a, button'),
  );
}

const NAS = {
  active: [
    { name: 'GS-EWR', reason: 'WX', avgDelay: 62, affectedFacilities: ['EWR'] },
    { name: 'GDP-LGA', reason: 'VOL', affectedFacilities: ['LGA'] },
  ],
  planned: [
    { time: '', event: 'AFTER 1500\t-ORD/IAD GROUND DELAY PROGRAM POSSIBLE', decoded: 'AFTER 1500\t-ORD/IAD GROUND DELAY PROGRAM POSSIBLE', affectedAirports: ['ORD', 'IAD', 'BWI'] },
  ],
} as unknown as NasData;

describe('NasPanel: each hub tag goes to that hub\'s card on this tab', () => {
  it('links every hub tag to /?tab=weather&hub=, quiet, and tags no other airport', () => {
    mount(<NasPanel nas={NAS} />);
    const links = screen.getAllByRole('link').filter((a) => a.hasAttribute('data-hub-status-link'));
    expect(links.map((a) => a.textContent)).toEqual(['EWR', 'ORD', 'IAD']);
    for (const a of links) {
      expect(a.getAttribute('href')).toBe(`/?tab=weather&hub=${a.textContent}`);
      expect(a.getAttribute('data-hub-status-kind')).toBe('weather');
      expect(classes(a)).not.toContain('text-primary');
      expect(classes(a)).toContain('underline');
    }
    expect(screen.queryByRole('link', { name: 'LGA' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'BWI' })).toBeNull();
  });

  it('leaves each title as text, and nothing plain in link colour', () => {
    mount(<NasPanel nas={NAS} />);
    expect(screen.getByText(/^EWR ground stop$/i)).toBeTruthy();
    for (const li of document.querySelectorAll('li')) {
      // Only the tags (and no title words) sit inside a link.
      for (const a of li.querySelectorAll('a')) expect(a.textContent).toMatch(/^[A-Z]{3}$/);
    }
    expect(linkColourOnPlainText()).toEqual([]);
  });

  it('wherever the touch boxes are drawn, a tagged item is 44 px tall and its tags sit apart', () => {
    mount(<NasPanel nas={NAS} />);
    const items = [...document.querySelectorAll('li')];
    const tagged = items.filter((li) => li.querySelector('a[data-hub-status-link]'));
    const untagged = items.filter((li) => !li.querySelector('a[data-hub-status-link]'));
    expect(tagged).toHaveLength(2);
    expect(untagged).toHaveLength(1);
    for (const li of tagged) expect(classes(li)).toEqual(expect.arrayContaining(['min-h-11', 'pointer-fine:md:min-h-0']));
    for (const li of untagged) expect(classes(li)).not.toContain('min-h-11');
    for (const a of document.querySelectorAll('a[data-hub-status-link]')) {
      expect(classes(a)).toEqual(expect.arrayContaining(['ml-5', 'first:ml-1', 'pointer-fine:md:ml-1']));
    }
  });

  it('a click on a tag, with Weather showing, scrolls to that hub\'s card and stays on the tab', () => {
    mount(<NasPanel nas={NAS} />);
    expect(seen.ui!.tab).toBe('weather');
    const before = window.history.length;
    act(() => {
      fireEvent.click(screen.getByRole('link', { name: 'IAD' }));
    });
    expect(seen.ui!.tab).toBe('weather');
    expect(seen.ui!.pendingScroll).toBe('hub-card-IAD');
    expect(window.history.length).toBe(before);
    // The Schedule board is not touched by a Weather card link.
    expect(seen.schedule!.current.hub).toBe('DEN');
  });
});

describe('HubCard: the hub code is the card\'s identity link, its Schedule board', () => {
  const model = (hub: string) =>
    buildHubCardModel({
      hub,
      metar: { fltCat: 'IFR', rawOb: `K${hub} 041251Z 2SM BR OVC008 12/11 A2990` },
      faa: { delays: [{ type: 'GS', reason: 'WX' }] },
    }) as HubCardModel;

  it('links the code to /?tab=schedule&hub=, in link colour, and nothing else on the card', () => {
    mount(<HubCard model={model('EWR')} highlighted={false} />);
    const links = screen.getAllByRole('link').filter((a) => a.hasAttribute('data-hub-link'));
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('EWR');
    expect(links[0].getAttribute('href')).toBe('/?tab=schedule&hub=EWR');
    expect(classes(links[0])).toContain('text-primary');
    // The airport name stays text.
    expect(screen.getByText(model('EWR').name).closest('a')).toBeNull();
    expect(linkColourOnPlainText()).toEqual([]);
  });

  it('marks the header line as a link row, so the runtime guard examines the code', () => {
    mount(<HubCard model={model('ORD')} highlighted={false} />);
    const row = document.querySelector('[data-link-row]');
    expect(row?.querySelector('a[data-hub-link="ORD"]')).toBeTruthy();
  });

  it('a click on the code opens that hub\'s Schedule board, in place', () => {
    mount(<HubCard model={model('SFO')} highlighted={false} />);
    act(() => {
      fireEvent.click(screen.getByRole('link', { name: 'SFO' }));
    });
    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.schedule!.current.hub).toBe('SFO');
  });
});
