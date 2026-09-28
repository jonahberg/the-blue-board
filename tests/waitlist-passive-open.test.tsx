// @vitest-environment jsdom
/**
 * The passive waitlist trigger (T2, the click threshold) used to open the modal on the
 * threshold click itself — mid tab-switch, since tab and bottom-nav clicks counted — and
 * Radix then focused the email field, raising a phone's soft keyboard over a form the visitor
 * never asked for (audit F19/F26). Three behaviours are pinned here with the real store,
 * the real gate and the real Radix dialog:
 *   1. navigation clicks (tabs, nav, dialogs) do not advance the counter;
 *   2. reaching the threshold opens nothing until the clicking pauses, and a passive open
 *      focuses the dialog, not the input;
 *   3. `?waitlist=1` (someone who came for the form) still focuses the email field.
 */

import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import WaitlistDialog, { T2_SETTLE_MS } from '../src/app/features/WaitlistDialog';
import { countsAsEngagement, resetEngagement, useEngagement } from '../src/app/state/engagement';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';

let ui: UiValue | null = null;
let clicks = 0;
function Probe() {
  ui = useUi();
  clicks = useEngagement().clicks;
  return null;
}

function mount() {
  return render(
    <UiProvider>
      <nav aria-label="Dashboard navigation">
        <button type="button" role="tab" id="tab">
          Schedule
        </button>
      </nav>
      <button type="button" id="content">
        a flight row
      </button>
      <Probe />
      <WaitlistDialog />
    </UiProvider>,
  );
}

function click(id: string, times = 1) {
  const el = document.getElementById(id)!;
  for (let i = 0; i < times; i += 1) act(() => el.click());
}

const dialogOpen = () => document.querySelector('[role="dialog"]') !== null;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetEngagement();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetEngagement();
  localStorage.clear();
  ui = null;
});

describe('countsAsEngagement', () => {
  it('rejects tab, nav and dialog clicks and accepts content clicks', () => {
    document.body.innerHTML = `
      <nav><a id="n">x</a></nav><div role="tablist"><button role="tab" id="t">t</button></div>
      <div role="dialog"><button id="d">ok</button></div><div data-no-engagement><i id="o"></i></div>
      <main><button id="c">row</button></main>`;
    for (const id of ['n', 't', 'd', 'o']) expect(countsAsEngagement(document.getElementById(id))).toBe(false);
    expect(countsAsEngagement(document.getElementById('c'))).toBe(true);
    expect(countsAsEngagement(null)).toBe(true);
    document.body.innerHTML = '';
  });
});

describe('WaitlistDialog passive trigger (T2)', () => {
  it('does not count tab switches towards the threshold', () => {
    mount();
    click('tab', 25);
    expect(clicks).toBe(0);
    act(() => vi.advanceTimersByTime(T2_SETTLE_MS * 2));
    expect(dialogOpen()).toBe(false);
  });

  it('waits for the clicking to pause, then opens without focusing the email field', () => {
    mount();
    // A first-time visitor's threshold is 20 (bb-visited unset).
    click('content', 20);
    expect(clicks).toBe(20);
    expect(dialogOpen()).toBe(false);

    // Still clicking: the wait restarts.
    act(() => vi.advanceTimersByTime(T2_SETTLE_MS - 100));
    click('content');
    act(() => vi.advanceTimersByTime(T2_SETTLE_MS - 100));
    expect(dialogOpen()).toBe(false);

    act(() => vi.advanceTimersByTime(200));
    expect(dialogOpen()).toBe(true);
    const email = document.getElementById('waitlist-email');
    expect(email).not.toBeNull();
    expect(document.activeElement).not.toBe(email);
    expect(document.activeElement?.getAttribute('role')).toBe('dialog');
  });

  it('keeps autofocus on the email field for ?waitlist=1', () => {
    mount();
    act(() => ui!.setWaitlistOpen(true));
    act(() => vi.advanceTimersByTime(0));
    expect(dialogOpen()).toBe(true);
    expect(document.activeElement?.id).toBe('waitlist-email');
  });
});
