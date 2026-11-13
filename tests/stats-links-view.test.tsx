// @vitest-environment jsdom
/**
 * The Stats tab links the things it names (links everywhere, part 2):
 *  - the two headline cards whose destination lists exactly what they count (src/lib/stats-links.js);
 *  - each Live Fleet Utilization and Average Fleet Age row's type, the row's identity, to the Fleet
 *    tab filtered to it (figures and bars stay text);
 *  - the hub matrix's headers to each hub's Schedule board: the row header is the row's identity
 *    link, the column headers quiet; cells and totals stay text;
 *  - Top Routes' hub ends, quiet; a non-hub end stays text, and the count is body colour.
 *
 * Mounted in the real UiProvider, ScheduleProvider and FollowProvider, as tests/dash-link.test.tsx
 * does, so a click is followed in place through the dashboard's own state.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider, useSchedule } from '../src/app/state/schedule';
import type { ScheduleValue } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';
import { HubMatrix } from '../src/app/views/stats/HubMatrix';
import type { MatrixModel } from '../src/app/views/stats/HubMatrix';
import { MetricCards } from '../src/app/views/stats/MetricCards';
import { AgeBars, RouteBars } from '../src/app/views/stats/RouteBars';
import { UtilizationChart } from '../src/app/views/stats/UtilizationChart';
import { TYPE_ORDER, avgAgeByType, hubMatrix, topRoutes } from '../src/lib/analytics.js';
import { HUB_ORDER } from '../src/lib/hub-health.js';
import { metricLink } from '../src/lib/stats-links.js';

vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ watched: [] }) }));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));

const HUBS = HUB_ORDER as string[];

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
          {node}
          <Probe />
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
}

/** jsdom cannot load another document; a click that reaches the document is cancelled there. */
function cancelPageLoads(event: Event) {
  event.preventDefault();
}

beforeEach(() => {
  window.history.replaceState(null, '', '/#stats');
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
const nestedControls = () => document.querySelectorAll('button a, a button, a a').length;

/** Every element painted in link colour that is not a link or button. */
function linkColourOnPlainText(root: ParentNode = document) {
  return [...root.querySelectorAll('[class]')].filter(
    (el) => classes(el).some((c) => /^text-primary(\/\d+)?$/.test(c)) && !el.closest('a, button'),
  );
}

describe('MetricCards: a card links only when its destination lists what it counts', () => {
  const metrics = () =>
    [
      { label: 'Flights Airborne', value: '241' },
      { label: 'Fleet Utilization', value: '38%', sub: '312 of 820 mainline aircraft' },
      { label: 'Avg Fleet Age', value: '15.2y' },
      { label: 'Starlink Coverage', value: '24%', sub: '58 of 241 airborne' },
    ].map((m) => ({ ...m, link: metricLink(m.label, m.value) }));

  it('links "Flights Airborne" and "Fleet Utilization" and leaves the other two as text', () => {
    mount(<MetricCards metrics={metrics()} />);
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/#live', '/?tab=fleet&view=airborne']);
    expect(screen.getByRole('link', { name: 'Flights Airborne (Live tab)' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Fleet Utilization (Fleet tab, Airborne)' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Avg Fleet Age|Starlink Coverage/ })).toBeNull();
  });

  it('keeps each card a dt then its dds, with the link inside the dt', () => {
    mount(<MetricCards metrics={metrics()} />);
    const groups = [...(document.querySelector('dl') as HTMLElement).children];
    expect(groups).toHaveLength(4);
    for (const group of groups) {
      const tags = [...group.children].map((c) => c.tagName);
      expect(tags[0]).toBe('DT');
      expect(tags.slice(1).every((t) => t === 'DD')).toBe(true);
    }
    for (const link of screen.getAllByRole('link')) expect(link.parentElement?.tagName).toBe('DT');
  });

  it('a linked card is one target: the link is stretched over the card, which it is positioned in', () => {
    mount(<MetricCards metrics={metrics()} />);
    for (const link of screen.getAllByRole('link')) {
      expect(classes(link)).toEqual(expect.arrayContaining(['text-primary', 'after:absolute', 'after:inset-0']));
      expect(classes(link)).not.toContain('relative');
      expect(classes(link.closest('[data-slot="card"]'))).toContain('relative');
    }
    // An unlinked card is not positioned for a stretched link it does not have.
    const plain = screen.getByText('Avg Fleet Age').closest('[data-slot="card"]');
    expect(classes(plain)).not.toContain('relative');
  });

  it('a click on "Flights Airborne" opens the Live tab in place', () => {
    mount(<MetricCards metrics={metrics()} />);
    act(() => {
      fireEvent.click(screen.getByRole('link', { name: 'Flights Airborne (Live tab)' }));
    });
    expect(seen.ui!.tab).toBe('live');
  });

  it('a click on "Fleet Utilization" opens the Fleet tab and asks for its Airborne view', () => {
    mount(<MetricCards metrics={metrics()} />);
    act(() => {
      fireEvent.click(screen.getByRole('link', { name: 'Fleet Utilization (Fleet tab, Airborne)' }));
    });
    expect(seen.ui!.tab).toBe('fleet');
    expect(seen.ui!.fleetLink).toMatchObject({ filter: null, view: 'airborne', arriving: true });
  });

  it('renders no link while the utilisation figure is still "—"', () => {
    mount(<MetricCards metrics={[{ label: 'Fleet Utilization', value: '—', link: metricLink('Fleet Utilization', '—') }]} />);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('UtilizationChart and AgeBars: the type is the row\'s identity link', () => {
  const utilRows = () => TYPE_ORDER.map((type, i) => ({ type, flying: i, total: 20, pct: i * 5 }));

  it('links every one of the 19 types to the Fleet tab filtered to it, in link colour', () => {
    mount(<UtilizationChart rows={utilRows()} />);
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(TYPE_ORDER);
    for (const [i, link] of links.entries()) {
      expect(link.getAttribute('href')).toBe(`/?tab=fleet&type=${encodeURIComponent(TYPE_ORDER[i])}`);
      expect(classes(link)).toContain('text-primary');
      // The type is never clipped: `truncate` would clip the link's touch box too.
      expect(classes(link)).not.toContain('truncate');
    }
    expect(linkColourOnPlainText()).toEqual([]);
  });

  it('leaves the figures and bars as text', () => {
    mount(<UtilizationChart rows={utilRows()} />);
    for (const li of document.querySelectorAll('li')) expect(li.querySelectorAll('a')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /%/ })).toBeNull();
  });

  it('each row is 44 px tall wherever the touch box is drawn, so no two rows\' boxes overlap', () => {
    mount(<UtilizationChart rows={utilRows()} />);
    for (const li of document.querySelectorAll('li')) {
      expect(classes(li)).toEqual(expect.arrayContaining(['min-h-11', 'pointer-fine:md:min-h-0']));
    }
  });

  it('a click on a type opens the Fleet tab filtered to it, in place', () => {
    mount(<UtilizationChart rows={utilRows()} />);
    act(() => {
      fireEvent.click(screen.getByRole('link', { name: '737 MAX 9' }));
    });
    expect(seen.ui!.tab).toBe('fleet');
    expect(seen.ui!.fleetLink).toMatchObject({ filter: '737 MAX 9', view: null });
  });

  it('AgeBars links each type the same way and leaves the years as text', () => {
    const { rows } = avgAgeByType([{ t: '737-900ER', d: '2009' }, { t: 'A319', d: '1998' }], 2026) as {
      rows: { type: string; avg: string | number }[];
    };
    mount(<AgeBars rows={rows} />);
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual(TYPE_ORDER);
    expect(links.every((a) => classes(a).includes('text-primary') && !classes(a).includes('truncate'))).toBe(true);
    expect(screen.queryByRole('link', { name: /y$/ })).toBeNull();
    for (const li of document.querySelectorAll('li')) {
      expect(classes(li)).toEqual(expect.arrayContaining(['min-h-11', 'pointer-fine:md:min-h-0']));
    }
    expect(linkColourOnPlainText()).toEqual([]);
  });
});

describe('HubMatrix: headers link to each hub\'s Schedule board', () => {
  const model = () =>
    hubMatrix(
      [
        { origin: 'ORD', dest: 'DEN' },
        { origin: 'ORD', dest: 'DEN' },
        { origin: 'SFO', dest: 'EWR' },
      ],
      HUBS,
    ) as MatrixModel;

  it('every row header is the row\'s identity link (link colour), every column header quiet', () => {
    mount(<HubMatrix hubs={HUBS} model={model()} />);
    const rowLinks = [...document.querySelectorAll('th[scope="row"] a')];
    const colLinks = [...document.querySelectorAll('th[scope="col"] a')];
    expect(rowLinks.map((a) => a.textContent)).toEqual(HUBS);
    expect(colLinks.map((a) => a.textContent)).toEqual(HUBS);
    for (const a of [...rowLinks, ...colLinks]) {
      expect(a.getAttribute('href')).toBe(`/?tab=schedule&hub=${a.textContent}`);
    }
    for (const a of rowLinks) expect(classes(a)).toContain('text-primary');
    for (const a of colLinks) {
      expect(classes(a)).not.toContain('text-primary');
      expect(classes(a)).toContain('underline');
    }
  });

  it('leaves the corner label, the cells and the totals as text, and no plain text in link colour', () => {
    mount(<HubMatrix hubs={HUBS} model={model()} />);
    expect(document.querySelectorAll('td a')).toHaveLength(0);
    expect(screen.getAllByRole('link')).toHaveLength(HUBS.length * 2);
    expect(linkColourOnPlainText()).toEqual([]);
  });

  it('each header link is its own 44 by 44 target until a mouse at md, and fills its cell', () => {
    mount(<HubMatrix hubs={HUBS} model={model()} />);
    for (const a of document.querySelectorAll('th a')) {
      expect(classes(a)).toEqual(
        expect.arrayContaining(['flex', 'min-h-11', 'min-w-11', 'pointer-fine:md:min-h-0', 'pointer-fine:md:min-w-0']),
      );
      // No after: box: the matrix scrolls in its own region, which would clip one.
      expect(classes(a).some((c) => c.startsWith('after:'))).toBe(false);
      expect(classes(a.closest('th'))).toContain('p-0');
    }
  });

  it('a click on a row header opens that hub\'s Schedule board, in place', () => {
    mount(<HubMatrix hubs={HUBS} model={model()} />);
    act(() => {
      fireEvent.click(document.querySelector('th[scope="row"] a[href="/?tab=schedule&hub=SFO"]') as Element);
    });
    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.schedule!.current.hub).toBe('SFO');
  });
});

describe('RouteBars: hub ends link, quiet; other airports and the count stay text', () => {
  const rows = () =>
    topRoutes(
      [
        { origin: 'ORD', dest: 'DEN' },
        { origin: 'ORD', dest: 'DEN' },
        { origin: 'EWR', dest: 'LHR' },
        { origin: 'BOS', dest: 'MCO' },
      ],
      15,
    ) as { route: string; origin: string; dest: string; count: number }[];

  it('links each hub end to its Schedule board and leaves a non-hub end plain', () => {
    mount(<RouteBars rows={rows()} />);
    const items = [...document.querySelectorAll('li')];
    const hrefs = (li: Element) => [...li.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs(items[0])).toEqual(['/?tab=schedule&hub=ORD', '/?tab=schedule&hub=DEN']);
    expect(hrefs(items[1])).toEqual(['/?tab=schedule&hub=EWR']);
    expect(hrefs(items[2])).toEqual([]);
    expect(items[1].textContent).toContain('LHR');
    expect(items[2].textContent).toContain('BOS');
    expect(items[2].textContent).toContain('MCO');
  });

  it('the hub ends are quiet, and the count is body colour', () => {
    mount(<RouteBars rows={rows()} />);
    for (const a of screen.getAllByRole('link')) {
      expect(classes(a)).not.toContain('text-primary');
      expect(classes(a)).toContain('underline');
    }
    expect(linkColourOnPlainText()).toEqual([]);
  });

  it('wherever the touch boxes are drawn a row is 44 px tall and the two ends sit apart', () => {
    mount(<RouteBars rows={rows()} />);
    for (const li of document.querySelectorAll('li')) {
      expect(classes(li)).toEqual(expect.arrayContaining(['min-h-11', 'pointer-fine:md:min-h-0']));
    }
    const arrow = [...document.querySelectorAll('li span[aria-hidden="true"]')].find((s) => s.textContent === '→');
    expect(classes(arrow ?? null)).toEqual(expect.arrayContaining(['mx-3', 'pointer-fine:md:mx-0']));
  });

  it('a click on a hub end opens its Schedule board, in place', () => {
    mount(<RouteBars rows={rows()} />);
    act(() => {
      fireEvent.click(screen.getAllByRole('link', { name: 'EWR' })[0]);
    });
    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.schedule!.current.hub).toBe('EWR');
  });

  it('never nests a link in a control', () => {
    mount(
      <>
        <RouteBars rows={rows()} />
        <HubMatrix hubs={HUBS} model={hubMatrix([], HUBS) as MatrixModel} />
      </>,
    );
    expect(nestedControls()).toBe(0);
  });
});
