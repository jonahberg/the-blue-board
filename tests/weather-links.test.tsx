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
    // Four hubs on one item, after a title long enough to wrap on a phone.
    { time: '', event: 'AFTER 1800\t-NORTHEAST AND MIDWEST AIRPORTS GROUND STOP/DELAY PROGRAM POSSIBLE FOR THUNDERSTORMS', decoded: 'AFTER 1800\t-NORTHEAST AND MIDWEST AIRPORTS GROUND STOP/DELAY PROGRAM POSSIBLE FOR THUNDERSTORMS', affectedAirports: ['ORD', 'IAD', 'DEN', 'IAH'] },
  ],
} as unknown as NasData;

describe('NasPanel: each hub tag goes to that hub\'s card on this tab', () => {
  it('links every hub tag to /?tab=weather&hub=, quiet, and tags no other airport', () => {
    mount(<NasPanel nas={NAS} />);
    const links = screen.getAllByRole('link').filter((a) => a.hasAttribute('data-hub-status-link'));
    expect(links.map((a) => a.textContent)).toEqual(['EWR', 'ORD', 'IAD', 'ORD', 'IAD', 'DEN', 'IAH']);
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

  it('an item\'s tags sit in their own link row after the title, which stays outside it', () => {
    mount(<NasPanel nas={NAS} />);
    const items = [...document.querySelectorAll('li')];
    const tagged = items.filter((li) => li.querySelector('a[data-hub-status-link]'));
    const untagged = items.filter((li) => !li.querySelector('a[data-hub-status-link]'));
    expect(tagged).toHaveLength(3);
    expect(untagged).toHaveLength(1);
    for (const li of tagged) {
      const rows = li.querySelectorAll('[data-link-row]');
      expect(rows).toHaveLength(1);
      // The row holds the tags and nothing else: every child is a tag link, every tag is in it.
      const children = [...rows[0].children];
      expect(children.every((c) => c.matches('a[data-hub-status-link]'))).toBe(true);
      expect(children).toHaveLength(li.querySelectorAll('a[data-hub-status-link]').length);
      expect(rows[0].textContent).toMatch(/^([A-Z]{3})+$/);
      // The title's words are outside the row, so a guard rule can excuse them and not a tag.
      expect(rows[0].parentElement?.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    }
    for (const li of untagged) expect(li.querySelector('[data-link-row]')).toBeNull();
  });

  it('each tag is itself a 44 px square target until a mouse at md (pinned by min-h-11 and min-w-11), with no after: box', () => {
    // An element box cannot overlap its neighbour the way a 44 px after: box on a 16 px line did,
    // however the tags wrap; the classes are the only way to pin the size in jsdom.
    mount(<NasPanel nas={NAS} />);
    for (const a of document.querySelectorAll('a[data-hub-status-link]')) {
      expect(classes(a)).toEqual(expect.arrayContaining(['min-h-11', 'min-w-11']));
      expect(classes(a).some((c) => c.startsWith('after:'))).toBe(false);
    }
  });

  it('a tag reads as a quiet link, not a badge: no pill background', () => {
    mount(<NasPanel nas={NAS} />);
    for (const a of document.querySelectorAll('a[data-hub-status-link]')) {
      expect(classes(a).some((c) => /^bg-/.test(c))).toBe(false);
    }
  });

  it('a click on a tag, with Weather showing, asks for that hub\'s card (pendingScroll) and stays on the tab', () => {
    mount(<NasPanel nas={NAS} />);
    expect(seen.ui!.tab).toBe('weather');
    const before = window.history.length;
    act(() => {
      fireEvent.click(screen.getAllByRole('link', { name: 'IAD' })[0]);
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
