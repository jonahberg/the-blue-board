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
// Mutable per test: the strip's network chip and stale dimming read these (F5/F91).
const hubState = vi.hoisted(() => ({
  hubs: [] as { hub: string; otp: number | null; source: string | null; asOfMs: number | null }[],
  faaIndex: {} as Record<string, unknown>,
  faaUnknownSince: null as number | null,
  iropsScore: null as number | null,
  /** The current brief's tone, or null while the row is the ticker. */
  briefTone: null as 'calm' | 'watch' | 'disrupted' | null,
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
}
vi.mock('../src/app/state/schedule', () => ({
  useHubHealth: () => ({
    hubs: hubState.hubs,
    byHub: Object.fromEntries(hubState.hubs.map((h) => [h.hub, h.otp])),
  }),
}));
vi.mock('../src/app/state/weather', () => ({
  useWeather: () => ({ faaIndex: hubState.faaIndex, faaUnknownSince: hubState.faaUnknownSince }),
}));
vi.mock('../src/app/state/irops', () => ({
  useIrops: () => ({ loading: false, score: hubState.iropsScore }),
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
const { UiProvider } = await import('../src/app/state/ui');

const classesOf = (el: Element | null) => (el?.getAttribute('class') ?? '').split(/\s+/);

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
    const { container } = render(
      <TooltipProvider>
        <HubHealthStrip />
      </TooltipProvider>,
    );
    const strip = container.querySelector('[aria-label="Hub on-time performance"]');
    expect(classesOf(strip)).toContain('h-7');
    // The 44 px touch chips made this a 45 px row on a phone; no variant may grow it back.
    expect(classesOf(strip).some((c) => /:(h|min-h|py)-/.test(c))).toBe(false);
  });

  it('gives every hub chip 24px for a mouse and the full row for a finger (WCAG 2.5.8)', () => {
    render(
      <TooltipProvider>
        <HubHealthStrip />
      </TooltipProvider>,
    );
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
    render(
      <TooltipProvider>
        <HubHealthStrip />
      </TooltipProvider>,
    );

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
    rerender(
      <TooltipProvider>
        <HubHealthStrip />
      </TooltipProvider>,
    );
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
  });});
