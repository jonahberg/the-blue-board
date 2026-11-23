// @vitest-environment jsdom
/**
 * The Thanksgiving turkey in the DOM (Nov 22 2026): the dashboard's `TurkeyEgg` and the shared
 * player, src/scripts/turkey-egg.ts. Rules and choreography are tested DOM-free in
 * tests/holiday-egg.test.js; this file is about what reaches the page:
 *
 *  - nothing renders and no timer runs on an ordinary day; it renders on the day and with
 *    `?gobble=1` (in the query or trapped after the '#');
 *  - it is `aria-hidden`, takes no pointer events, holds nothing focusable and no live region,
 *    and the wordmark link's name and behaviour are unchanged;
 *  - with reduced motion it is a still peek and runs no timer;
 *  - one timer at a time, stopped while the tab is hidden and on unmount;
 *  - the run is clamped to the measured gap, and a narrow gap only peeks.
 *
 * jsdom has no layout, so the gap is stubbed with getBoundingClientRect where it matters.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { MAX_RUN_PX, TURKEY, nextPeekDelayMs, stepsMs, runSteps, turkeyPlan } from '@/lib/holiday-egg.js';
import { mountTurkey, mountTurkeysOnPage } from '../src/scripts/turkey-egg';

vi.mock('../src/app/state/feed', () => ({
  useFeed: () => ({ flights: [], freshness: 'live', countdown: 30 }),
}));
vi.mock('../src/app/state/watch', () => ({
  useWatch: () => ({ watched: [] }),
}));

const { TurkeyEgg, resetGobblePreview } = await import('../src/app/shell/TurkeyEgg');
const { Header } = await import('../src/app/shell/Header');
const { UiProvider } = await import('../src/app/state/ui');
const { PrefsProvider } = await import('../src/app/state/prefs');

const ORDINARY = new Date(2026, 10, 22, 10, 0).getTime(); // Sunday Nov 22 2026, local
const THANKSGIVING = new Date(2026, 10, 26, 10, 0).getTime(); // Thursday Nov 26 2026, local

const egg = () => document.querySelector<HTMLElement>('.bb-turkey');

/** Every player mounted directly in this file, stopped after each test. */
const mounted: Array<() => void> = [];
function mount(root: HTMLElement, opts?: { random?: () => number }) {
  const stop = mountTurkey(root, opts);
  mounted.push(stop);
  return stop;
}
const mover = () => egg()!.querySelector<HTMLElement>('.bb-turkey-mover')!;

function setAddress(path: string) {
  window.history.replaceState(null, '', path);
  resetGobblePreview();
}

function stubReducedMotion(reduce: boolean) {
  const listeners = new Set<() => void>();
  const mq = {
    matches: reduce,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal('matchMedia', (query: string) => (query.includes('reduced-motion') ? mq : { ...mq, matches: false }));
  return {
    set(next: boolean) {
      mq.matches = next;
      for (const fn of listeners) fn();
    },
    listeners,
  };
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Stub layout: the wordmark ends at `right`, the next element starts at `nextLeft`. */
function stubGap(wordmark: Element, next: Element, right: number, nextLeft: number) {
  wordmark.getBoundingClientRect = () => ({ left: 20, right, top: 14, bottom: 30, width: right - 20, height: 16, x: 20, y: 14, toJSON() {} }) as DOMRect;
  next.getBoundingClientRect = () =>
    ({ left: nextLeft, right: nextLeft + 60, top: 12, bottom: 32, width: 60, height: 20, x: nextLeft, y: 12, toJSON() {} }) as DOMRect;
}

/** A header like the dashboard's: link > wordmark > egg box, then the controls. */
function harness(gap: number) {
  document.body.innerHTML = `
    <header>
      <a href="#live" id="link"><span id="wordmark" class="relative">The Blue Board<span class="bb-turkey"></span></span></a>
      <div id="hidden-thing" style="display:none"></div>
      <div id="controls"><button>Find a flight</button></div>
    </header>`;
  const wordmark = document.getElementById('wordmark')!;
  const controls = document.getElementById('controls')!;
  document.getElementById('hidden-thing')!.getBoundingClientRect = () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
  stubGap(wordmark, controls, 130, 130 + gap);
  return { root: egg()!, link: document.getElementById('link')!, wordmark, controls };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  setAddress('/');
});

afterEach(() => {
  while (mounted.length) mounted.pop()!();
  cleanup();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setHidden(false);
  setAddress('/');
});

describe('TurkeyEgg — when it shows', () => {
  it('renders nothing, and starts no timer, on an ordinary day', () => {
    vi.setSystemTime(ORDINARY);
    const { container } = render(<TurkeyEgg now={ORDINARY} />);
    expect(container.innerHTML).toBe('');
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(120_000));
    expect(container.innerHTML).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('renders on Thanksgiving, by the local date', () => {
    vi.setSystemTime(THANKSGIVING);
    render(<TurkeyEgg now={THANKSGIVING} />);
    expect(egg()).not.toBeNull();
    expect(egg()!.querySelector('svg')).not.toBeNull();
    expect(egg()!.querySelectorAll('.tk-leg')).toHaveLength(2);
  });

  it('renders on an ordinary day with ?gobble=1, in the query or trapped after the "#"', () => {
    for (const path of ['/?gobble=1', '/?utm_source=x&gobble=1#fleet', '/#live?gobble=1', '/#schedule&gobble=1']) {
      setAddress(path);
      const { unmount } = render(<TurkeyEgg now={ORDINARY} />);
      expect(egg(), path).not.toBeNull();
      unmount();
    }
    setAddress('/?gobble=0');
    const { container } = render(<TurkeyEgg now={ORDINARY} />);
    expect(container.innerHTML).toBe('');
  });

  it('arrives at local midnight and leaves at the next one, off the clock it is given', () => {
    const { rerender } = render(<TurkeyEgg now={new Date(2026, 10, 25, 23, 59, 59, 999).getTime()} />);
    expect(egg()).toBeNull();
    rerender(<TurkeyEgg now={new Date(2026, 10, 26, 0, 0, 0, 0).getTime()} />);
    expect(egg()).not.toBeNull();
    rerender(<TurkeyEgg now={new Date(2026, 10, 27, 0, 0, 0, 0).getTime()} />);
    expect(egg()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('TurkeyEgg — it never gets in the way', () => {
  it('is aria-hidden, holds nothing focusable, no live region and no words', () => {
    render(<TurkeyEgg now={THANKSGIVING} />);
    const box = egg()!;
    expect(box.getAttribute('aria-hidden')).toBe('true');
    expect(box.querySelectorAll('a, button, input, select, textarea, [tabindex], [aria-live], [role]')).toHaveLength(0);
    expect(box.textContent).toBe('');
  });

  it('takes no pointer events, is absolutely positioned and clips its contents (global.css)', () => {
    render(<TurkeyEgg now={THANKSGIVING} />);
    expect(egg()!.className.split(/\s+/)).toContain('bb-turkey');
    const css = readFileSync(resolve(__dirname, '../src/styles/global.css'), 'utf8');
    const rule = css.match(/\n\.bb-turkey \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule![1]).toMatch(/position: absolute;/);
    expect(rule![1]).toMatch(/left: 100%;/);
    expect(rule![1]).toMatch(/overflow: hidden;/);
    expect(rule![1]).toMatch(/pointer-events: none;/);
  });

  it('animates only transform: no keyframe or transition of its own touches layout or colour', () => {
    const css = readFileSync(resolve(__dirname, '../src/styles/global.css'), 'utf8');
    const keyframes = [...css.matchAll(/@keyframes bb-turkey-[\w-]+ \{([\s\S]*?)\n\}/g)].map((m) => m[1]);
    expect(keyframes.length).toBeGreaterThanOrEqual(4);
    for (const body of keyframes) {
      const props = [...body.matchAll(/([a-z-]+):/g)].map((m) => m[1]);
      expect(props.every((p) => p === 'transform' || p === 'opacity'), props.join(',')).toBe(true);
    }
    expect(css).toMatch(/\.bb-turkey-mover \{[^}]*transition-property: transform;/);
  });
});

describe('TurkeyEgg in the Header on Thanksgiving', () => {
  function renderHeader() {
    return render(
      <TooltipProvider>
        <UiProvider>
          <PrefsProvider>
            <Header onOpenWatch={() => {}} watchOpen={false} onOpenHelp={() => {}} />
          </PrefsProvider>
        </UiProvider>
      </TooltipProvider>,
    );
  }
  const wordmarkLink = () => document.querySelector<HTMLAnchorElement>('header a[href="#live"]')!;
  /** The wordmark link's accessible name, as testing-library computes it for getByRole. */
  function linkName(): string {
    let found = '';
    screen.getByRole('link', {
      name: (name, el) => {
        if (el === wordmarkLink()) found = name;
        return el === wordmarkLink();
      },
    });
    return found;
  }

  it('sits inside the wordmark and leaves the link\'s name and address as they were', () => {
    vi.setSystemTime(ORDINARY);
    renderHeader();
    expect(egg()).toBeNull();
    const ordinaryName = linkName();
    cleanup();

    vi.setSystemTime(THANKSGIVING);
    renderHeader();
    const box = egg()!;
    expect(box).not.toBeNull();
    expect(wordmarkLink().contains(box)).toBe(true);
    expect(box.parentElement!.firstChild!.textContent).toBe('The Blue Board');
    expect(box.parentElement!.className.split(/\s+/)).toContain('relative');
    expect(linkName()).toBe(ordinaryName);
    expect(ordinaryName).toMatch(/^The Blue Board/);
    expect(wordmarkLink().getAttribute('href')).toBe('#live');
    expect(screen.getByRole('link', { name: ordinaryName })).toBe(wordmarkLink());
  });

  it('does not stop or prevent a tap on the wordmark', () => {
    vi.setSystemTime(THANKSGIVING);
    renderHeader();
    const enter = new Event('pointerenter', { cancelable: true });
    wordmarkLink().dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    wordmarkLink().dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });
});

describe('TurkeyEgg — timers', () => {
  it('runs one timer (the intro, 2 s on), and clears it on unmount', () => {
    const { unmount } = render(<TurkeyEgg now={THANKSGIVING} />);
    expect(vi.getTimerCount()).toBe(1);
    expect(egg()!.dataset.step).toBe('hidden');
    act(() => vi.advanceTimersByTime(1999));
    expect(egg()!.dataset.step).toBe('hidden');
    act(() => vi.advanceTimersByTime(1));
    expect(egg()!.dataset.step).toBe('peek');
    expect(vi.getTimerCount()).toBe(1);
    const box = egg()!;
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(box.innerHTML).toBe('');
  });

  it('a parent re-render (the header ticks every second) never restarts it', () => {
    const { rerender } = render(<TurkeyEgg now={THANKSGIVING} />);
    act(() => vi.advanceTimersByTime(2000));
    expect(egg()!.dataset.step).toBe('peek');
    for (let s = 1; s <= 3; s += 1) rerender(<TurkeyEgg now={THANKSGIVING + s * 1000} />);
    expect(egg()!.dataset.step).toBe('peek');
    expect(vi.getTimerCount()).toBe(1);
  });
});

describe('TurkeyEgg — reduced motion', () => {
  it('is a still peek: no timer, no pose, no transition, all day', () => {
    stubReducedMotion(true);
    render(<TurkeyEgg now={THANKSGIVING} />);
    expect(egg()!.dataset.step).toBe('still-peek');
    expect(egg()!.dataset.pose).toBe('still');
    expect(mover().style.transitionDuration).toBe('0ms');
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.pointerEnter(egg()!.closest('span')!.parentElement ?? document.body);
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(egg()!.dataset.step).toBe('still-peek');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('switching reduced motion on mid-run stops the run and leaves the still peek', () => {
    const motion = stubReducedMotion(false);
    const { root } = harness(400);
    const stop = mount(root, { random: () => 0 });
    vi.advanceTimersByTime(2000 + 2100);
    expect(root.dataset.step).toBe('out');
    expect(root.dataset.pose).toBe('run');
    motion.set(true);
    expect(root.dataset.step).toBe('still-peek');
    expect(vi.getTimerCount()).toBe(0);
    motion.set(false);
    expect(root.dataset.step).toBe('hidden');
    expect(vi.getTimerCount()).toBe(1);
    stop();
    expect(motion.listeners.size).toBe(0);
  });
});

describe('mountTurkey — the show, clamped to the gap', () => {
  const at = (root: HTMLElement) => root.querySelector<HTMLElement>('.bb-turkey-mover')!.style.transform;

  it('plays peek, look, duck, out, turn, back, then hides and waits 60–90 s to peek again', () => {
    const { root } = harness(400); // a desktop gap: the run is capped
    const plan = turkeyPlan(400);
    const steps = runSteps(plan);
    const stop = mount(root, { random: () => 0 });
    expect(root.style.width).toBe(`${plan.room}px`);
    expect(at(root)).toBe(`translateX(${plan.hiddenX}px) scaleX(1)`);

    vi.advanceTimersByTime(2000);
    const seen: string[] = [];
    for (const step of steps) {
      expect(root.dataset.step).toBe(step.name);
      expect(at(root)).toBe(`translateX(${step.x}px) scaleX(${step.face})`);
      expect(root.dataset.pose).toBe(step.pose);
      seen.push(`${step.name}@${step.x}`);
      vi.advanceTimersByTime(step.ms);
    }
    expect(seen).toContain(`out@${MAX_RUN_PX}`);
    expect(root.dataset.step).toBe('hidden');
    expect(at(root)).toBe(`translateX(${plan.hiddenX}px) scaleX(1)`);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(nextPeekDelayMs(() => 0) - 1);
    expect(root.dataset.step).toBe('hidden');
    vi.advanceTimersByTime(1);
    expect(root.dataset.step).toBe('peek');
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never runs past the gap: the far point puts its right edge on the box edge, 4 px short', () => {
    const { root } = harness(80);
    mount(root);
    vi.advanceTimersByTime(2000);
    while (root.dataset.step !== 'out') vi.advanceTimersByTime(50);
    const plan = turkeyPlan(80);
    expect(at(root)).toBe(`translateX(${plan.farX}px) scaleX(1)`);
    expect(plan.farX + TURKEY.width).toBe(80 - 4);
    expect(root.style.width).toBe('76px');
  });

  it('with a phone-narrow gap it only peeks', () => {
    const { root } = harness(24);
    mount(root);
    vi.advanceTimersByTime(2000);
    const names = new Set<string>();
    for (let t = 0; t < 4000; t += 50) {
      names.add(root.dataset.step!);
      vi.advanceTimersByTime(50);
    }
    expect([...names]).toEqual(expect.arrayContaining(['peek', 'look', 'duck', 'hidden']));
    expect(names.has('out')).toBe(false);
  });

  it('skips elements that are not displayed when it measures', () => {
    const { root } = harness(120);
    mount(root);
    expect(root.style.width).toBe('116px');
  });

  it('a hover or a tap sends it on the full run at once; while it runs, more do nothing', () => {
    const { root, link } = harness(400);
    mount(root, { random: () => 0 });
    fireEvent.pointerEnter(link);
    expect(root.dataset.step).toBe('peek');
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(300);
    fireEvent.pointerEnter(link);
    fireEvent.pointerEnter(link);
    expect(root.dataset.step).toBe('peek');
    expect(vi.getTimerCount()).toBe(1);
    // It runs to the end once, and no intro follows it.
    vi.advanceTimersByTime(stepsMs(runSteps(turkeyPlan(400))) - 300);
    expect(root.dataset.step).toBe('hidden');
    vi.advanceTimersByTime(59_999);
    expect(root.dataset.step).toBe('hidden');
  });

  it('stops while the tab is hidden and picks up when it is back', () => {
    const { root, link } = harness(400);
    mount(root, { random: () => 0 });
    vi.advanceTimersByTime(2000 + 2500);
    expect(root.dataset.step).toBe('out');
    setHidden(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(root.dataset.step).toBe('hidden');
    fireEvent.pointerEnter(link);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10 * 60_000);
    expect(root.dataset.step).toBe('hidden');
    setHidden(false);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(root.dataset.step).toBe('peek');
  });

  it('waits for the tab to be seen before its intro', () => {
    const { root } = harness(400);
    setHidden(true);
    mount(root);
    expect(vi.getTimerCount()).toBe(0);
    setHidden(false);
    vi.advanceTimersByTime(2000);
    expect(root.dataset.step).toBe('peek');
  });
});

describe('mountTurkeysOnPage — the content pages', () => {
  function page() {
    document.body.innerHTML = `
      <header><a href="/"><span><span class="relative inline-block" data-turkey-wordmark>The Blue Board</span></span></a><nav>x</nav></header>`;
  }

  it('adds nothing and runs nothing on an ordinary day', () => {
    page();
    expect(mountTurkeysOnPage(document, new Date(ORDINARY))).toEqual([]);
    expect(egg()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('on the day, or with ?gobble=1, puts an aria-hidden box in the wordmark, and cleans it up', () => {
    page();
    const stops = mountTurkeysOnPage(document, new Date(THANKSGIVING));
    expect(stops).toHaveLength(1);
    expect(egg()!.getAttribute('aria-hidden')).toBe('true');
    expect(egg()!.parentElement!.hasAttribute('data-turkey-wordmark')).toBe(true);
    for (const stop of stops) stop();
    expect(egg()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    setAddress('/fleet?gobble=1');
    page();
    expect(mountTurkeysOnPage(document, new Date(ORDINARY))).toHaveLength(1);
    expect(egg()).not.toBeNull();
  });
});
