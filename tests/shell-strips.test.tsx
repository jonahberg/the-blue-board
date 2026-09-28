// @vitest-environment jsdom
/**
 * The dashboard's late-arriving strips and their tap targets.
 *
 *  - F57/F31: the news banner (after an idle-time fetch) and the tip strip (after 2 s) used to
 *    insert ABOVE the header/tab panel and shove the map down mid-load (CLS ≈ 0.11 on a phone),
 *    each 53 px tall because a 44 px button set the row height. They now live in the slot
 *    below the tab panel, as single 32 px rows whose dismiss buttons keep a 44 px hit area
 *    through an `after:` box.
 *  - F25/F70: the news headline link was a 17 px line box and the hub chips 20 px; both now
 *    clear WCAG 2.5.8's 24 px.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('../src/app/data/api', () => ({
  fetchNewsLatest: () =>
    Promise.resolve([{ title: 'United adds a new Pacific route from SFO', slug: 'new-pacific-route' }]),
}));
vi.mock('../src/app/state/schedule', () => ({
  useHubHealth: () => ({
    hubs: [
      { hub: 'ORD', otp: 83, source: 'server' },
      { hub: 'DEN', otp: 71, source: 'server' },
    ],
    byHub: { ORD: 83, DEN: 71 },
  }),
}));
vi.mock('../src/app/state/weather', () => ({ useWeather: () => ({ faaIndex: {} }) }));
vi.mock('../src/app/state/irops', () => ({ useIrops: () => ({ loading: false }) }));
vi.mock('../src/app/state/prefs', () => ({ usePrefs: () => ({ homeAirport: '' }) }));

const { default: NewsBanner } = await import('../src/app/features/NewsBanner');
const { default: TipStrip } = await import('../src/app/features/TipStrip');
const { HubHealthStrip } = await import('../src/app/shell/HubHealthStrip');
const { UiProvider } = await import('../src/app/state/ui');

const classesOf = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  localStorage.clear();
});

describe('Dashboard layout', () => {
  const src = readFileSync(resolve(__dirname, '../src/app/Dashboard.tsx'), 'utf8');
  const jsx = src.slice(src.indexOf('return (', src.indexOf('function DashboardShell')));

  it('mounts the late strips below the tab panel, never above the header or the panel', () => {
    const header = jsx.indexOf('<Header');
    const tabsEnd = jsx.indexOf('</Tabs>');
    const news = jsx.indexOf('<NewsBanner');
    const tip = jsx.indexOf('<TipStrip');
    const attribution = jsx.indexOf('<Attribution');
    expect(header).toBeGreaterThan(-1);
    expect(news).toBeGreaterThan(tabsEnd);
    expect(tip).toBeGreaterThan(tabsEnd);
    expect(news).toBeLessThan(attribution);
    expect(tip).toBeLessThan(attribution);
  });
});

describe('NewsBanner', () => {
  it('is one 32px row whose headline link fills it and whose dismiss keeps a 44px hit area', async () => {
    render(<NewsBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    const headline = screen.getByRole('link', { name: /new Pacific route/ });
    const row = headline.parentElement;
    expect(classesOf(row)).toContain('h-8');
    expect(classesOf(headline)).toEqual(expect.arrayContaining(['flex', 'h-full', 'items-center']));
    // The truncation lives on the text, not on the (now flex) link.
    expect(classesOf(headline.querySelector('span'))).toContain('truncate');

    const dismiss = screen.getByRole('button', { name: 'Dismiss news' });
    expect(classesOf(dismiss)).toEqual(
      expect.arrayContaining(['relative', 'h-8', 'min-w-11', 'after:absolute', 'after:-inset-y-1.5']),
    );
  });
});

describe('TipStrip', () => {
  it('is one 32px row once it appears', async () => {
    render(
      <UiProvider>
        <TipStrip />
      </UiProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    const dismiss = screen.getByRole('button', { name: 'Dismiss tips' });
    expect(classesOf(dismiss.parentElement)).toContain('h-8');
    expect(classesOf(dismiss)).toEqual(expect.arrayContaining(['relative', 'h-8', 'after:-inset-y-1.5']));
  });
});

describe('HubHealthStrip', () => {
  it('gives every hub chip at least a 24px target', () => {
    render(
      <TooltipProvider>
        <HubHealthStrip />
      </TooltipProvider>,
    );
    for (const hub of ['ORD', 'DEN']) {
      const chip = screen.getByRole('link', { name: new RegExp(hub) });
      expect(classesOf(chip)).toContain('min-h-6');
    }
  });
});
