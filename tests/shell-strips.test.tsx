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

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('../src/app/data/api', () => ({
  fetchNewsLatest: () =>
    Promise.resolve([{ title: 'United adds a new Pacific route from SFO', slug: 'new-pacific-route' }]),
}));
// Mutable per test: the strip's network chip and stale dimming read these (F5/F91).
const hubState = vi.hoisted(() => ({
  hubs: [] as { hub: string; otp: number | null; source: string | null; asOfMs: number | null }[],
  faaIndex: {} as Record<string, unknown>,
  faaUnknownSince: null as number | null,
  iropsScore: null as number | null,
  /** The current brief's tone, or null while the row is the ticker. */
  briefTone: null as 'calm' | 'watch' | 'disrupted' | null,
  /** `/api/irops` as the strip reads it (`data.hubMetrics`); null before the server answers. */
  iropsData: null as { hubMetrics: Record<string, Record<string, unknown>> } | null,
}));
function resetHubState() {
  const now = Date.now();
  hubState.hubs = [
    { hub: 'ORD', otp: 83, source: 'server', asOfMs: now - 5 * 60_000 },
    { hub: 'DEN', otp: 71, source: 'server', asOfMs: now - 5 * 60_000 },
  ];
  hubState.faaIndex = {};
  hubState.faaUnknownSince = null;
  hubState.iropsScore = null;
  hubState.briefTone = null;
  hubState.iropsData = null;
}
// A hub chip is followed in place (useFollowDeepLink), which selects the board through the
// Schedule store's setCurrent.
const setCurrent = vi.hoisted(() => vi.fn());
vi.mock('../src/app/state/schedule', () => ({
  useHubHealth: () => ({
    hubs: hubState.hubs,
    byHub: Object.fromEntries(hubState.hubs.map((h) => [h.hub, h.otp])),
  }),
  useSchedule: () => ({ setCurrent }),
}));
vi.mock('../src/app/state/weather', () => ({
  useWeather: () => ({ faaIndex: hubState.faaIndex, faaUnknownSince: hubState.faaUnknownSince }),
}));
vi.mock('../src/app/state/irops', () => ({
  useIrops: () => ({ loading: false, score: hubState.iropsScore, data: hubState.iropsData }),
}));
vi.mock('../src/app/state/prefs', () => ({ usePrefs: () => ({ homeAirport: '' }) }));
vi.mock('../src/app/state/brief', () => ({
  useBrief: () => ({
    view: hubState.briefTone ? { status: 'ready', tone: hubState.briefTone } : { status: 'unavailable' },
  }),
}));

const { default: NewsBanner } = await import('../src/app/features/NewsBanner');
const { default: TipStrip } = await import('../src/app/features/TipStrip');
const { HubHealthStrip } = await import('../src/app/shell/HubHealthStrip');
const { UiProvider, useUi } = await import('../src/app/state/ui');
const { FollowProvider } = await import('../src/app/state/follow-link');

const classesOf = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

/** The tab as the last render saw it. */
const seenUi: { tab: string | null } = { tab: null };
function TabProbe() {
  seenUi.tab = useUi().tab;
  return null;
}

/** The strip as the shell mounts it: inside the UI store, the follow provider and the tooltip provider. */
function Strip() {
  return (
    <UiProvider>
      <FollowProvider>
        <TooltipProvider>
          <HubHealthStrip />
        </TooltipProvider>
        <TabProbe />
      </FollowProvider>
    </UiProvider>
  );
}

/** A chip's sr-only words other than where it goes: the reasons and readings it states. */
const readingWords = (chip: Element) =>
  [...chip.querySelectorAll('.sr-only:not([data-chip-destination])')].map((el) => el.textContent);

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetHubState();
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

  it('shows ONE engagement line at a time at every width: support strip, waitlist strip, news, tip (Oct 2026 phones; Nov 2026 everywhere)', () => {
    const support = jsx.indexOf('<SupportStrip');
    const waitlist = jsx.indexOf('<WaitlistStrip');
    const news = jsx.indexOf('<NewsBanner');
    const tip = jsx.indexOf('<TipStrip');
    // The deep-use support ask (Nov 2026) leads the slot: on the visits it is the ask it must be
    // the line that shows, not one hidden behind the news (it reports `shown` when it renders).
    expect(support).toBeGreaterThan(jsx.indexOf('</Tabs>'));
    expect(support).toBeLessThan(waitlist);
    expect(jsx.lastIndexOf('<div', support)).toBe(jsx.lastIndexOf('<div', waitlist));
    expect(waitlist).toBeLessThan(news);
    expect(news).toBeLessThan(tip);
    // The four share one wrapper whose rule hides every child after the first present. It is
    // unprefixed: a breakpoint variant (the old `max-md:`) would let a desktop stack all three.
    const slotOpen = jsx.lastIndexOf('<div', waitlist);
    const slotTag = jsx.slice(slotOpen, waitlist);
    const classes = (slotTag.match(/className="([^"]*)"/)?.[1] ?? '').split(/\s+/);
    expect(classes).toContain('[&>*~*]:hidden');
    expect(classes.some((c) => c !== '[&>*~*]:hidden' && c.endsWith(':[&>*~*]:hidden'))).toBe(false);
    expect(jsx.indexOf('</div>', tip)).toBeLessThan(jsx.indexOf('<Attribution'));
  });

  it('hides the news on the phone Live tab only, keeping it mounted so the tip still waits (Nov 2026)', () => {
    const news = jsx.slice(jsx.indexOf('<NewsBanner'), jsx.indexOf('/>', jsx.indexOf('<NewsBanner')));
    // Hidden by CSS below lg on Live, never unmounted: an unmounted news strip would make the tip
    // the slot's first child and hand it the 32 px back.
    expect(news).toMatch(/className=\{tab === 'live' \? 'max-lg:hidden' : undefined\}/);
    expect(news).not.toMatch(/\{tab !== 'live'/);
    // The support and waitlist strips take no such rule.
    for (const tag of ['<SupportStrip', '<WaitlistStrip', '<TipStrip']) {
      const el = jsx.slice(jsx.indexOf(tag), jsx.indexOf('/>', jsx.indexOf(tag)));
      expect(el).not.toMatch(/hidden/);
    }
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
      // 32 px + 7 px each way, measured from inside the button's 1 px border = 44 (Nov 2026: the
      // old -inset-y-1.5 measured 42 with elementFromPoint).
      expect.arrayContaining(['relative', 'h-8', 'min-w-11', 'after:absolute', 'after:-inset-y-[7px]']),
    );
  });
});

describe('NewsBanner hidden by the shell', () => {
  it('takes the shell\'s class on its own row, beside its 32px height', async () => {
    render(<NewsBanner className="max-lg:hidden" />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    const row = screen.getByRole('link', { name: /new Pacific route/ }).parentElement;
    expect(classesOf(row)).toEqual(expect.arrayContaining(['h-8', 'max-lg:hidden']));
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
    expect(classesOf(dismiss)).toEqual(expect.arrayContaining(['relative', 'h-8', 'after:-inset-y-[7px]']));
  });
});

describe('HubHealthStrip', () => {
  it('is one 28px row at every width and pointer, like the brief row above it (Nov 2026)', () => {
    const { container } = render(<Strip />);
    const strip = container.querySelector('[aria-label="Hub on-time performance"]');
    expect(classesOf(strip)).toContain('h-7');
    // The 44 px touch chips made this a 45 px row on a phone; no variant may grow it back.
    expect(classesOf(strip).some((c) => /:(h|min-h|py)-/.test(c))).toBe(false);
  });

  it('gives every hub chip 24px for a mouse and the full row for a finger (WCAG 2.5.8)', () => {
    render(<Strip />);
    for (const hub of ['ORD', 'DEN']) {
      const chip = screen.getByRole('link', { name: new RegExp(hub) });
      // A finger gets the row's whole 27 px inside its border and a wider pad. The row scrolls
      // sideways, which clips any hit box poking out of it, so the chip itself is the target.
      expect(classesOf(chip)).toEqual(
        expect.arrayContaining(['min-h-6', 'pointer-coarse:self-stretch', 'pointer-coarse:px-2']),
      );
      // Keyed to the pointer, never to width: a tablet at md is still a touch screen.
      expect(classesOf(chip).some((c) => /^md:min-h/.test(c))).toBe(false);
    }
  });

  const renderStrip = () =>
    render(<Strip />);

  it('labels the network chip from the on-time readings alone when nothing else is wrong', () => {
    renderStrip();
    expect(screen.getByText('Smooth Ops')).toBeTruthy();
  });

  it('never reads Smooth Ops while the IROPS score is high (F5/F33)', () => {
    hubState.iropsScore = 90;
    renderStrip();
    expect(screen.queryByText('Smooth Ops')).toBeNull();
  });

  it('says the FAA status is unknown, not Smooth Ops, while the FAA answer is stale (neutral, with an icon)', () => {
    const since = Date.now() - 40 * 60_000;
    hubState.faaUnknownSince = since;
    const { container, rerender } = renderStrip();
    expect(screen.queryByText('Smooth Ops')).toBeNull();
    const chip = screen.getByText(/^FAA status unknown since \d\d:\d\d$/);
    const wrapper = chip.parentElement!;
    expect(classesOf(wrapper)).toContain('text-muted-foreground');
    expect(wrapper.className).not.toMatch(/bb-ok|bb-warn|destructive/);
    expect(wrapper.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    // A poll that changes nothing about the state changes nothing in this live region.
    const before = container.textContent;
    rerender(<Strip />);
    expect(container.textContent).toBe(before);
  });

  it('a disruption other signals show still wins over "unknown"', () => {
    hubState.faaUnknownSince = Date.now() - 40 * 60_000;
    hubState.iropsScore = 90;
    renderStrip();
    expect(screen.queryByText(/FAA status unknown/)).toBeNull();
    expect(screen.getByText('Disrupted')).toBeTruthy();
  });

  it('drops the network chip while a current brief above says the same thing (Nov 2026)', () => {
    hubState.iropsScore = 90; // Disrupted
    hubState.briefTone = 'disrupted';
    renderStrip();
    expect(screen.queryByText('Disrupted')).toBeNull();
  });

  it('keeps the network chip when the brief disagrees with it, or when there is no brief', () => {
    hubState.iropsScore = 90; // Disrupted, live
    hubState.briefTone = 'watch'; // a snapshot written before it got worse
    const { unmount } = renderStrip();
    expect(screen.getByText('Disrupted')).toBeTruthy();
    unmount();
    hubState.briefTone = null;
    renderStrip();
    expect(screen.getByText('Disrupted')).toBeTruthy();
  });

  it('always keeps "FAA status unknown", which the brief does not say', () => {
    hubState.faaUnknownSince = Date.now() - 40 * 60_000;
    hubState.briefTone = 'calm';
    renderStrip();
    expect(screen.getByText(/^FAA status unknown since \d\d:\d\d$/)).toBeTruthy();
  });

  it('marks a chip whose reading comes from an hours-old board, without dimming its number (F91)', () => {
    hubState.hubs[1] = { ...hubState.hubs[1], asOfMs: Date.now() - 3 * 60 * 60_000 };
    renderStrip();
    const den = screen.getByRole('link', { name: /DEN/ });
    const ord = screen.getByRole('link', { name: /ORD/ });
    // A word and an icon, not only a fainter chip (DESIGN.md: never a visual-only signal).
    expect(den.textContent).toContain('(stale reading)');
    expect(den.querySelector('svg[data-stale-reading]')?.getAttribute('aria-hidden')).toBe('true');
    expect(ord.textContent).not.toContain('stale');
    expect(ord.querySelector('svg[data-stale-reading]')).toBeNull();
    // The percentage keeps full contrast: neither the chip nor the number is dimmed (axe
    // color-contrast measured 3.82:1 for the 60% chip). Only the glyph recedes.
    expect(classesOf(den)).not.toContain('opacity-60');
    const pct = [...den.querySelectorAll('span')].find((el) => /%$/.test(el.textContent ?? ''))!;
    expect(classesOf(pct)).not.toContain('opacity-60');
    expect(den.querySelector('[aria-hidden="true"].opacity-60')).not.toBeNull();
    // The sr-only words are absolutely positioned: a positioned chip keeps them inside the
    // sideways scroller (unpositioned, they widened a 390 px phone page to 585 px).
    expect(classesOf(den)).toContain('relative');
    expect(ord.querySelector('.opacity-60')).toBeNull();
  });
});

describe('HubHealthStrip: why a hub has no on-time figure (v1.28.0)', () => {
  const renderStrip = () =>
    render(<Strip />);
  const chip = (hub: string) => screen.getByRole('link', { name: new RegExp(`^${hub}`) });
  /** The tooltip opens on keyboard focus, as it does for a mouse; a tap navigates instead. */
  const tooltipFor = async (hub: string) => {
    await act(async () => {
      chip(hub).focus();
      await vi.runAllTimersAsync();
    });
    return screen.getAllByRole('tooltip').map((t) => t.textContent ?? '').join(' ');
  };
  const gum = (over: Record<string, unknown> = {}) => ({
    total: 9, operated: 0, onTime: 0, cancellations: 0, generatedAt: 1794434424,
    departureTimesSeen: 0, departedWithoutTime: 2, pastDueUntimed: 4, boardDayOffset: 0, ...over,
  });
  const nrt = (over: Record<string, unknown> = {}) => ({
    total: 12, operated: 1, onTime: 1, cancellations: 0, generatedAt: 1794432632,
    departureTimesSeen: 1, departedWithoutTime: 0, pastDueUntimed: 0, boardDayOffset: 0, ...over,
  });

  beforeEach(() => {
    // Radix positions an open tooltip with floating-ui, which needs a ResizeObserver jsdom lacks.
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    hubState.hubs = [
      { hub: 'ORD', otp: 86, source: 'server', asOfMs: Date.now() - 5 * 60_000 },
      { hub: 'NRT', otp: null, source: null, asOfMs: null },
      { hub: 'GUM', otp: null, source: null, asOfMs: null },
    ];
  });

  it('Guam (no actual times): "n/a" on the chip, the reason in its name and its tooltip', async () => {
    hubState.iropsData = { hubMetrics: { ORD: { total: 640, operated: 359, onTime: 309, departureTimesSeen: 600, boardDayOffset: 0 }, NRT: nrt(), GUM: gum() } };
    renderStrip();
    const link = chip('GUM');
    expect(link.textContent).toContain('n/a');
    expect(link.textContent).not.toContain('—');
    // Visible words plus sr-only words, never an aria-label over different text.
    expect(link.hasAttribute('aria-label')).toBe(false);
    expect(readingWords(link)).toEqual(['(no on-time figure: the feed sends no departure times)']);
    // A tap opens GUM's board in place (the hub guide is one link further, in the board's header).
    expect(link.getAttribute('href')).toBe('/?tab=schedule&hub=GUM');
    expect(await tooltipFor('GUM')).toContain(
      'The schedule feed sends no actual departure times for GUM, so there is no on-time figure.',
    );
  });

  it('too few departures yet: the dash stays, the count is in the tooltip only', async () => {
    hubState.iropsData = { hubMetrics: { NRT: nrt(), GUM: gum() } };
    renderStrip();
    const link = chip('NRT');
    expect(link.textContent).toContain('—');
    expect(readingWords(link)).toEqual(['(too few departures yet for an on-time figure)']);
    expect(await tooltipFor('NRT')).toContain('1 of 12 NRT departures have left so far today; an on-time figure needs 5.');
  });

  it('a poll that only moves a count changes nothing in this live region', () => {
    hubState.iropsData = { hubMetrics: { NRT: nrt(), GUM: gum() } };
    const { container, rerender } = renderStrip();
    const before = container.textContent;
    hubState.iropsData = { hubMetrics: { NRT: nrt({ operated: 3, onTime: 3 }), GUM: gum({ pastDueUntimed: 6 }) } };
    rerender(<Strip />);
    expect(container.textContent).toBe(before);
  });

  it('fields absent (the payload production sends today): the bare dash and the old tooltip, no reason claimed', async () => {
    // No departureTimesSeen / boardDayOffset: GUM would otherwise read "0 of 9 … have left so far
    // today", which the feed cannot know.
    const old = (m: Record<string, unknown>) => {
      const { departureTimesSeen: _a, departedWithoutTime: _b, pastDueUntimed: _c, boardDayOffset: _d, ...rest } = m;
      return rest;
    };
    hubState.iropsData = { hubMetrics: { NRT: old(nrt()), GUM: old(gum()) } };
    renderStrip();
    for (const hub of ['NRT', 'GUM']) {
      expect(chip(hub).textContent).toContain('—');
      expect(chip(hub).textContent).not.toContain('n/a');
      expect(readingWords(chip(hub))).toEqual([]);
    }
    expect(await tooltipFor('GUM')).toContain('No on-time reading yet');
  });

  it('before the server answers: the bare dash, never "no departures board"', async () => {
    hubState.iropsData = null;
    renderStrip();
    expect(chip('GUM').textContent).toContain('—');
    expect(readingWords(chip('GUM'))).toEqual([]);
    const tip = await tooltipFor('GUM');
    expect(tip).toContain('No on-time reading yet');
    expect(tip).not.toMatch(/departures board/);
  });

  it('a reading from yesterday\'s board says so, in the name and the tooltip', async () => {
    hubState.iropsData = {
      hubMetrics: { ORD: { total: 640, operated: 359, onTime: 309, departureTimesSeen: 600, boardDayOffset: -1 }, NRT: nrt(), GUM: gum() },
    };
    renderStrip();
    expect(chip('ORD').textContent).toContain('86%');
    expect(readingWords(chip('ORD'))).toEqual(["(yesterday's departures)"]);
    expect(await tooltipFor('ORD')).toContain("86% of yesterday's operated departures within 30 min of schedule");
  });

  it('a hub with a reading never shows a reason, whatever its metrics say', () => {
    hubState.hubs[2] = { hub: 'GUM', otp: 74, source: 'client', asOfMs: Date.now() - 60_000 };
    hubState.iropsData = { hubMetrics: { NRT: nrt(), GUM: gum() } };
    renderStrip();
    expect(chip('GUM').textContent).toContain('74%');
    expect(chip('GUM').textContent).not.toContain('n/a');
    expect(readingWords(chip('GUM'))).toEqual([]);
  });
});

describe('HubHealthStrip: a chip opens that hub\'s schedule board, in place (Nov 12 2026)', () => {
  /** Whether the last click still had its default when it reached the document (after React). */
  let reachedDocumentPrevented: boolean | null = null;
  function recordClick(event: Event) {
    reachedDocumentPrevented = event.defaultPrevented;
    // jsdom cannot load another document and says so on the console.
    event.preventDefault();
  }

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    window.history.replaceState(null, '', '/');
    setCurrent.mockClear();
    seenUi.tab = null;
    reachedDocumentPrevented = null;
    document.addEventListener('click', recordClick);
  });
  afterEach(() => {
    document.removeEventListener('click', recordClick);
    vi.unstubAllGlobals();
    window.history.replaceState(null, '', '/');
  });

  it('each chip is a real address: that hub\'s Schedule board', () => {
    render(<Strip />);
    for (const hub of ['ORD', 'DEN']) {
      expect(screen.getByRole('link', { name: new RegExp(`^${hub}`) }).getAttribute('href')).toBe(`/?tab=schedule&hub=${hub}`);
    }
  });

  it('a click selects the board and the Schedule tab without leaving the page', () => {
    render(<Strip />);
    expect(seenUi.tab).toBe('live');
    act(() => {
      screen.getByRole('link', { name: /^DEN/ }).click();
    });
    expect(reachedDocumentPrevented).toBe(true);
    // Departures, as a cold load opens it: the chip's figure is operated departures.
    expect(setCurrent).toHaveBeenCalledWith({ hub: 'DEN', dir: 'departures' });
    expect(seenUi.tab).toBe('schedule');
  });

  it('a modified click is the browser\'s (a new tab gets the address)', () => {
    render(<Strip />);
    act(() => {
      screen
        .getByRole('link', { name: /^ORD/ })
        .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true }));
    });
    expect(reachedDocumentPrevented).toBe(false);
    expect(setCurrent).not.toHaveBeenCalled();
    expect(seenUi.tab).toBe('live');
  });

  it('its name carries the hub, its figure and where it goes; the tooltip says it too', async () => {
    render(<Strip />);
    const ord = screen.getByRole('link', { name: /^ORD.*83%.*\(schedule board\)$/ });
    // Visible words plus fixed sr-only words, never an aria-label over different text.
    expect(ord.hasAttribute('aria-label')).toBe(false);
    expect(ord.querySelector('[data-chip-destination]')?.textContent).toBe('(schedule board)');
    await act(async () => {
      ord.focus();
      await vi.runAllTimersAsync();
    });
    const tip = screen.getAllByRole('tooltip').map((t) => t.textContent ?? '').join(' ');
    expect(tip).toContain('United at ORD · schedule board');
    // Before 06:00 hub-local the board that opens is yesterday's, so the chip never says "today's".
    expect(tip).not.toMatch(/hub guide|today's/);
    expect(ord.textContent).not.toMatch(/today's/);
  });

  /** Focus the chip and let its tooltip open (the provider's delay), as a tab or a tap does. */
  async function focusWithTooltip(chip: HTMLElement) {
    await act(async () => {
      chip.focus();
      await vi.runAllTimersAsync();
    });
    expect(screen.getAllByRole('tooltip').map((t) => t.textContent).join(' ')).toContain('United at DEN');
  }

  it('after a tap or click the chip lets go of focus, so its tooltip does not sit over the board', async () => {
    render(<Strip />);
    const den = screen.getByRole('link', { name: /^DEN/ });
    await focusWithTooltip(den);

    // A pointer's click counts itself in `detail`.
    await act(async () => {
      fireEvent.click(den, { detail: 1 });
      await vi.runAllTimersAsync();
    });

    expect(seenUi.tab).toBe('schedule');
    expect(document.activeElement).not.toBe(den);
    expect(screen.queryAllByRole('tooltip')).toHaveLength(0);
  });

  it('after a tap on a touch screen the tooltip stays shut over the board the chip opened', async () => {
    render(<Strip />);
    const den = screen.getByRole('link', { name: /^DEN/ });

    // A real tap (tests/tap-tooltip.test.tsx): focus lands after pointerup, which opens the tooltip,
    // then the click. The shared trigger would toggle it open after the click; a chip followed in
    // place closes it instead.
    await act(async () => {
      fireEvent.pointerDown(den, { pointerType: 'touch', button: 0 });
      fireEvent.pointerUp(den, { pointerType: 'touch', button: 0 });
      den.focus();
      fireEvent.click(den, { detail: 1 });
      await vi.runAllTimersAsync();
    });

    expect(seenUi.tab).toBe('schedule');
    expect(document.activeElement).not.toBe(den);
    expect(screen.queryAllByRole('tooltip')).toHaveLength(0);
  });

  it('Enter on a focused chip keeps focus, and its tooltip, on the chip', async () => {
    render(<Strip />);
    const den = screen.getByRole('link', { name: /^DEN/ });
    await focusWithTooltip(den);

    // A keyboard activation is a click with no pointer: `detail` 0.
    await act(async () => {
      fireEvent.click(den, { detail: 0 });
      await vi.runAllTimersAsync();
    });

    expect(seenUi.tab).toBe('schedule');
    expect(document.activeElement).toBe(den);
    expect(screen.getAllByRole('tooltip').map((t) => t.textContent).join(' ')).toContain('United at DEN');
  });

  it('keeps every class and size of the chip (tuned Nov 11 2026)', () => {
    render(<Strip />);
    const chip = screen.getByRole('link', { name: /^ORD/ });
    expect(classesOf(chip)).toEqual(
      expect.arrayContaining(['relative', 'flex', 'min-h-6', 'shrink-0', 'items-center', 'gap-1', 'rounded-md', 'px-1.5', 'no-underline', 'hover:bg-accent', 'pointer-coarse:self-stretch', 'pointer-coarse:px-2']),
    );
  });
});
