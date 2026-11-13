// @vitest-environment jsdom
/**
 * The Sources tab (links everywhere, part 2):
 *  - a card's name links to the dashboard view that shows that source's data
 *    (src/lib/sources-links.js), quiet, followed in place; a source no view shows keeps a plain
 *    name, and the card's own external links are unchanged;
 *  - nothing that is not a link is painted in link colour: the two section headings and the
 *    "Disclaimer:" label are body colour.
 *
 * Mounted in the real UiProvider, ScheduleProvider and FollowProvider, as tests/dash-link.test.tsx
 * does.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';
import SourcesView from '../src/app/views/SourcesView';
import { SOURCE_VIEW_LINKS } from '../src/lib/sources-links.js';

vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ watched: [] }) }));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));

let ui: UiValue | null = null;
function Probe() {
  ui = useUi();
  return null;
}

function mount() {
  return render(
    <UiProvider>
      <ScheduleProvider>
        <FollowProvider>
          <SourcesView />
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
  window.history.replaceState(null, '', '/#sources');
  document.addEventListener('click', cancelPageLoads);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in this test'))));
});

afterEach(() => {
  cleanup();
  document.removeEventListener('click', cancelPageLoads);
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  ui = null;
});

const classes = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);
/** The dashboard links in the cards' headings: the source names. */
const nameLinks = () => [...document.querySelectorAll('h3 a')];

describe('SourcesView: a card names the view that shows its data', () => {
  it('links the seven names a view shows, each to that view, and no other name', () => {
    mount();
    const links = nameLinks();
    expect(Object.fromEntries(links.map((a) => [a.firstChild?.textContent, a.getAttribute('href')]))).toEqual(
      Object.fromEntries(Object.entries(SOURCE_VIEW_LINKS).map(([name, link]) => [name, link.href])),
    );
    for (const name of ['Basemap — CARTO / OpenStreetMap', 'Route Estimation — Algorithmic', 'r/UnitedAirlines']) {
      const heading = screen.getByRole('heading', { level: 3, name: (accessibleName) => accessibleName.startsWith(name) });
      expect(heading.querySelector('a'), name).toBeNull();
    }
  });

  it('names each link by the source and where it goes', () => {
    mount();
    expect(screen.getByRole('link', { name: 'NAS Status — FAA (Weather tab, NAS status)' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Flight Schedule — AeroDataBox (Schedule tab)' })).toBeTruthy();
  });

  it('the names are quiet links: body colour with the muted underline', () => {
    mount();
    for (const a of nameLinks()) {
      expect(classes(a)).not.toContain('text-primary');
      expect(classes(a)).toContain('underline');
    }
  });

  it('keeps the freshness badge outside the link', () => {
    mount();
    for (const a of nameLinks()) expect(a.textContent).not.toMatch(/LIVE|DAILY|SNAPSHOT/);
  });

  it('keeps every external source link as it was', () => {
    mount();
    const external = [...document.querySelectorAll('a[target="_blank"]')];
    expect(external.length).toBeGreaterThanOrEqual(12);
    for (const a of external) expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('a click on the FAA NAS name opens the Weather tab at the NAS panel, in place', () => {
    mount();
    act(() => {
      fireEvent.click(screen.getByRole('link', { name: 'NAS Status — FAA (Weather tab, NAS status)' }));
    });
    expect(ui!.tab).toBe('weather');
    expect(ui!.pendingScroll).toBe('nas-section');
  });

  it('a click on the fleet database name opens the Fleet tab, in place', () => {
    mount();
    act(() => {
      fireEvent.click(screen.getByRole('link', { name: /^Fleet Database — United Fleet Site/ }));
    });
    expect(ui!.tab).toBe('fleet');
  });
});

describe('SourcesView: link colour means link', () => {
  it('paints no heading, label or other plain text in link colour', () => {
    mount();
    const plain = [...document.querySelectorAll('[class]')].filter(
      (el) => classes(el).some((c) => /^text-primary(\/\d+)?$/.test(c)) && !el.closest('a, button'),
    );
    expect(plain).toEqual([]);
  });

  it('the section headings and the disclaimer label are body colour', () => {
    mount();
    for (const name of [/Data Sources & Credits/, /Community/]) {
      expect(classes(screen.getByRole('heading', { level: 2, name }))).not.toContain('text-primary');
    }
    expect(classes(screen.getByText('Disclaimer:'))).toContain('text-foreground');
  });
});
