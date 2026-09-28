// @vitest-environment jsdom
/**
 * F152 — the whole island mounts, and every tab renders without tripping its error boundary.
 *
 * Every view is a `React.lazy` chunk (src/app/tabs.ts), so until now no test had ever rendered
 * MyFlights, Live, Schedule, Fleet, Weather, Stats or Sources, nor the real provider tree in
 * Dashboard.tsx — which is exactly where the v1.8.0 black page came from.
 *
 * This renders the REAL <Dashboard/> (every provider, the shell, the overlays) with `fetch`
 * stubbed at the network edge: the live feed answers with FR24-shaped rows, the static
 * `/data/*.json` files are served from `public/data` (the real build inputs), and every other
 * `/api/*` answers 503 — an upstream outage is a state production really reaches, and each
 * view must survive it. Then it walks every tab through the real tab bar.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import Dashboard from '../src/app/Dashboard';
import { TABS } from '../src/app/tabs';

function row(flight: string, reg: string, lat: number, lon: number): unknown[] {
  return ['A1B2C3', lat, lon, 270, 35000, 450, '2341', 'F-KORD1', 'B39M', reg, 1727380000, 'ORD', 'SFO', flight, 0, 0, `UAL${flight.slice(2)}`, 0, 'UAL'];
}
const FEED = {
  full_count: 12000,
  version: 4,
  '3a1b2c': row('UA123', 'N37502', 41.97, -87.9),
  '3a1b2d': row('UA456', 'N27213', 39.8, -104.7),
};

const ctl = vi.hoisted(() => ({ statsThrows: false }));

// A switch, not a replacement: the real StatsView renders unless a test asks it to crash.
vi.mock('../src/app/views/StatsView', async (importOriginal) => {
  const real = (await importOriginal<typeof import('../src/app/views/StatsView')>()).default;
  return {
    default: function MaybeCrashingStatsView() {
      if (ctl.statsThrows) throw new Error('boom: stats view');
      return real();
    },
  };
});

const PUBLIC_DATA = resolve(__dirname, '..', 'public', 'data');
const requested: string[] = [];

function respond(url: string): Response {
  requested.push(url);
  const path = url.replace(/^https?:\/\/[^/]+/, '');
  if (path.startsWith('/api/fr24-feed')) return Response.json(FEED);
  const data = path.match(/^\/data\/(fleet|starlink)\.json/);
  if (data) return new Response(readFileSync(resolve(PUBLIC_DATA, `${data[1]}.json`), 'utf8'), { headers: { 'Content-Type': 'application/json' } });
  if (path.startsWith('/data/news-latest.json')) return Response.json([]);
  return Response.json({ error: 'upstream unavailable' }, { status: 503 });
}

const consoleErrors: string[] = [];

beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => respond(String(input instanceof Request ? input.url : input))));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
  if (!window.matchMedia) {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }));
  }
  Element.prototype.scrollIntoView ??= () => {};
  // Returning visitor: no welcome dialog, so the tab bar is reachable.
  localStorage.setItem('bb-onboarded', 'true');
  localStorage.setItem('bb-visited', 'true');
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  cleanup();
  ctl.statsThrows = false;
  consoleErrors.length = 0;
});

afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

/** Click a tab in the real tab bar and wait for its lazy view to leave the Suspense skeleton. */
async function openTab(label: string) {
  const tabList = screen.getAllByRole('tablist')[0];
  const trigger = within(tabList).getByRole('tab', { name: new RegExp(label.replace(/[·]/g, '.'), 'i') });
  await act(async () => {
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
  });
  const panel = await vi.waitFor(
    () => {
      const el = document.querySelector('[role="tabpanel"][data-state="active"]');
      if (!el || !el.textContent?.trim()) throw new Error(`${label} not rendered yet`);
      return el as HTMLElement;
    },
    { timeout: 4000 },
  );
  return { trigger, panel };
}

describe('<Dashboard/> smoke', () => {
  it('mounts the real provider tree, then renders every tab without an error boundary firing', async () => {
    await act(async () => {
      render(<Dashboard />);
    });

    expect(screen.queryByText(/The dashboard hit an error/)).toBeNull();
    expect(requested.some((u) => u.includes('/api/fr24-feed'))).toBe(true);

    for (const tab of TABS) {
      const { trigger, panel } = await openTab(tab.label);
      expect(trigger.getAttribute('aria-selected'), tab.id).toBe('true');
      expect(panel.textContent, `${tab.id} fell into its error boundary`).not.toMatch(/hit an error/);
    }

    expect(screen.queryByText(/hit an error/)).toBeNull();
    expect(consoleErrors.filter((e) => e.includes('[ErrorBoundary]'))).toEqual([]);
  }, 20000);

  it('a crashing view takes down only its own tab, not the dashboard', async () => {
    ctl.statsThrows = true;
    await act(async () => {
      render(<Dashboard />);
    });
    const { panel } = await openTab('Stats');
    expect(panel.textContent).toMatch(/This tab hit an error/);
    expect(screen.queryByText(/The dashboard hit an error/)).toBeNull();

    // The rest of the island still works: another tab renders normally.
    const sources = await openTab('Sources');
    expect(sources.panel.textContent).not.toMatch(/hit an error/);
  }, 20000);
});
