// @vitest-environment jsdom
/**
 * Focus after a link followed on the tab already showing (a stay, the links plan's ruling 2).
 *
 * A stay moves no focus while the followed link is still on the page. But the link often leaves:
 * a type cell in the Fleet table turns to text once its type is the filter (ruling 1), and a hub
 * link in a Schedule row is replaced with the new board's rows. Focus then fell to <body>, and the
 * next Tab started again from the top of the page. Now, when focus was on the link (or in the panel,
 * or already lost) and is lost once the destination has applied and painted, it goes to the tab's
 * panel, as an arrival's does: no scroll, nothing said. A link that survives keeps focus, and a
 * link outside the panel that lets go of focus itself (the hub strip's chip) is left alone.
 *
 * The real FleetView and ScheduleView, in Radix tab panels marked as Dashboard.tsx marks them, on
 * the real UiProvider, ScheduleProvider and FollowProvider. Their data stores are stubbed.
 *
 * Frames run by hand. A browser commits the click's own update before the next frame, but the
 * Fleet view applies the type in an effect whose update can render after that frame; so each case
 * runs a frame before React commits anything (inside the click's `act`), the worst order, and the
 * rest after.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DashLink, dashLinkClick } from '../src/app/features/DashLink';
import { FollowProvider, useFollowDeepLink } from '../src/app/state/follow-link';
import { ScheduleProvider, useSchedule } from '../src/app/state/schedule';
import type { ScheduleValue } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';
import type { TabId } from '../src/app/tabs';
import FleetView from '../src/app/views/FleetView';
import ScheduleView from '../src/app/views/ScheduleView';

vi.setConfig({ testTimeout: 20_000 });

vi.mock('../src/app/state/watch', () => ({
  useWatch: () => ({ watched: [], isWatched: () => false, toggle: () => {}, add: () => true }),
}));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));
vi.mock('../src/app/state/feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/feed')>()),
  useFeed: () => ({ flights: [], lastGoodTs: null, lookupReg: () => null }),
}));
vi.mock('../src/app/state/fleet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/fleet')>()),
  useFleet: () => FLEET,
}));
vi.mock('../src/app/state/weather', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/weather')>()),
  useWeather: () => ({ faaIndex: {}, weatherOpsByHub: {}, nas: null }),
}));
vi.mock('../src/app/state/irops', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/irops')>()),
  useIrops: () => ({ data: null, hubRates: {} }),
}));
vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchSchedule: (params: { hub: string; dir: string; timestamp: number }) => Promise.resolve(board(params)),
}));

// 6 A319s and 2 737 MAX 9s.
const FLEET = vi.hoisted(() => {
  const db = [
    ...Array.from({ length: 6 }, (_, i) => ({ r: `N10${i}UA`, t: 'A319', w: 'Satl Ku', s: '', d: '2000' })),
    { r: 'N37502', t: '737 MAX 9', w: 'Starlink', s: '', d: '2018' },
    { r: 'N37503', t: '737 MAX 9', w: 'Starlink', s: '', d: '2018' },
  ];
  return {
    fleetDb: db,
    fleetByReg: Object.fromEntries(db.map((a) => [a.r, a])),
    starlink: { tails: new Set<string>(), flightsByTail: {}, stats: null, aircraft: [], lastUpdated: null, syncedAt: null, degraded: false },
    fleetSummary: null,
    special: new Map(),
    loading: false,
    loadFailed: false,
    retry: () => {},
    expressDb: [],
    expressByReg: {},
    expressStatus: 'ready',
  };
});

/** Each hub's board: departures to LAX (a hub, so a link) and MSP (not one), late in the day. */
function board({ hub, dir, timestamp }: { hub: string; dir: string; timestamp: number }) {
  const at = timestamp + 22 * 3600;
  const row = (i: number, other: string) => ({
    identification: { number: { default: `UA${hub === 'ORD' ? 1 : 2}0${i}` } },
    status: { text: 'Scheduled' },
    aircraft: { model: { code: 'B738', text: 'B738' } },
    airport:
      dir === 'arrivals'
        ? { origin: { code: { iata: other } }, destination: { code: { iata: hub } } }
        : { origin: { code: { iata: hub } }, destination: { code: { iata: other } } },
    time: { scheduled: { departure: at + i * 600, arrival: at + i * 600 + 3 * 3600 } },
  });
  return { flights: [row(1, 'LAX'), row(2, 'MSP')], meta: { generatedAt: new Date().toISOString() } };
}

const seen: { ui: UiValue | null; schedule: ScheduleValue | null } = { ui: null, schedule: null };

/**
 * The hub strip's chip (shell/HubHealthStrip.tsx `chipClick`): followed in place, then, after a
 * pointer's click (`detail` > 0), it blurs itself so its tooltip shuts.
 */
function Chip({ href, children }: { href: string; children: string }) {
  const follow = useFollowDeepLink();
  return (
    <a
      href={href}
      onClick={(event) => {
        if (dashLinkClick(follow, href)(event) && event.detail > 0) event.currentTarget.blur();
      }}
    >
      {children}
    </a>
  );
}

/**
 * Dashboard.tsx's shell in miniature: a hub chip outside the panels, and one panel per tab,
 * marked `data-tab-panel`, holding the view under test.
 */
function Shell({ view }: { view: 'fleet' | 'schedule' | 'weather' }) {
  const ui = useUi();
  seen.ui = ui;
  seen.schedule = useSchedule();
  return (
    <>
      <header>
        <Chip href="/?tab=schedule&hub=DEN">DEN chip</Chip>
      </header>
      <Tabs value={ui.tab} onValueChange={(value) => ui.setTab(value as TabId)}>
        {(['fleet', 'schedule', 'weather'] as const).map((id) => (
          <TabsContent key={id} value={id} forceMount data-tab-panel={id}>
            {id !== view ? null : id === 'fleet' ? (
              <FleetView />
            ) : id === 'schedule' ? (
              <ScheduleView />
            ) : (
              <DashLink href="/?tab=weather&section=nas">NAS status</DashLink>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );
}

function mount(view: 'fleet' | 'schedule' | 'weather') {
  window.history.replaceState(null, '', `/#${view}`);
  render(
    <UiProvider>
      <ScheduleProvider defaultHub="ORD">
        <FollowProvider>
          <TooltipProvider>
            <Shell view={view} />
          </TooltipProvider>
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
}

const panel = (id: TabId) => document.querySelector<HTMLElement>(`[data-tab-panel="${id}"]`)!;

// ── Frames by hand ──────────────────────────────────────────────────────────────────────────
let frames: FrameRequestCallback[] = [];
const realRaf = globalThis.requestAnimationFrame;
/** Run the frame callbacks asked for so far (each may ask for the next frame). */
function runFrame() {
  const due = frames;
  frames = [];
  for (const callback of due) callback(0);
}
/** Several frames, each inside `act` so whatever a callback sets renders. */
async function runFrames(n = 4) {
  for (let i = 0; i < n; i += 1) {
    await act(async () => {
      runFrame();
    });
  }
}

/**
 * Click a link the way a browser can order it at worst: a frame runs before React has rendered
 * anything the click asked for (inside the `act`, nothing commits until it ends), then the rest.
 */
async function followInBrowserOrder(link: HTMLElement, init?: MouseEventInit) {
  act(() => {
    fireEvent.click(link, init);
    runFrame();
  });
  await runFrames();
}

/** Let the Schedule board load and the filter debounce run. */
async function settle() {
  for (let i = 0; i < 3; i += 1) {
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, 150)));
  }
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.scrollTo ??= () => {};
  // The desktop Schedule board (its rows a table).
  window.matchMedia = ((query: string) => ({
    matches: /min-width:\s*768px/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  frames = [];
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  }) as typeof requestAnimationFrame;
  window.localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in this test'))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  globalThis.requestAnimationFrame = realRaf;
  window.history.replaceState(null, '', '/');
  seen.ui = null;
  seen.schedule = null;
});

describe('a link followed on the tab already showing, which then leaves the page', () => {
  it('a type in the Fleet table: the cell turns to text, and focus goes to the Fleet panel', async () => {
    mount('fleet');
    await runFrames();
    const row = [...panel('fleet').querySelectorAll('tbody tr')].find((tr) => tr.textContent?.startsWith('N37502'))!;
    const link = within(row as HTMLElement).getByRole('link', { name: '737 MAX 9' });
    link.focus();
    expect(document.activeElement).toBe(link);

    await followInBrowserOrder(link);

    // The follow applied (the type is the filter, so the cell is text) and focus did not fall to <body>.
    expect(seen.ui!.tab).toBe('fleet');
    expect(link.isConnected).toBe(false);
    expect(screen.getByRole('combobox', { name: 'Fleet type filter' }).textContent).toContain('737 MAX 9');
    expect(document.activeElement).toBe(panel('fleet'));
    // Nothing was said: a stay announces nothing.
    expect(seen.ui!.announcement).toBe('');
  });

  it('a hub in a Schedule row: the board changes, every row is replaced, and focus goes to the Schedule panel', async () => {
    mount('schedule');
    await settle();
    await runFrames();
    expect(seen.schedule!.current.hub).toBe('ORD');
    const link = within(panel('schedule')).getByRole('link', { name: 'LAX' });
    link.focus();

    await followInBrowserOrder(link);
    await settle();
    await runFrames();

    expect(seen.ui!.tab).toBe('schedule');
    expect(seen.schedule!.current.hub).toBe('LAX');
    expect(link.isConnected).toBe(false);
    expect(document.activeElement).toBe(panel('schedule'));
  });
});

describe('a link followed on the tab already showing, which stays', () => {
  it('a link still on the page keeps focus', async () => {
    mount('weather');
    await runFrames();
    const link = screen.getByRole('link', { name: 'NAS status' });
    link.focus();

    await followInBrowserOrder(link);

    expect(seen.ui!.tab).toBe('weather');
    expect(link.isConnected).toBe(true);
    expect(document.activeElement).toBe(link);
  });

  it('a link outside the panel that lets go of focus after the click (the hub chip) is left alone, as on an arrival', async () => {
    mount('schedule');
    await settle();
    await runFrames();
    const chip = screen.getByRole('link', { name: 'DEN chip' });
    chip.focus();

    // A pointer's click (`detail: 1`): the chip lets go of focus after the follow.
    await followInBrowserOrder(chip, { detail: 1 });

    expect(seen.schedule!.current.hub).toBe('DEN');
    expect(document.activeElement).toBe(document.body);
  });
});
