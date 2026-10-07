// @vitest-environment jsdom
/**
 * The deep-use donation prompt (Oct 2026), with the real store, the real trigger, the real
 * strip and the real Radix dialog:
 *   1. a heavy user who has never answered gets the prompt — not the email strip;
 *   2. it waits for a pause and never opens over another dialog;
 *   3. "Maybe later" / Escape and Donate store their answers, and the strip does not come up
 *      in the same visit;
 *   4. on a later visit inside the cooldown the strip is the ask again.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const track = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/track.js', () => ({ track }));
vi.mock('../src/app/data/api', () => ({ postWaitlist: vi.fn(async () => ({ success: true })) }));

import DonatePrompt from '../src/app/features/DonatePrompt';
import WaitlistStrip from '../src/app/features/WaitlistStrip';
import { STORAGE_KEYS } from '../src/app/state/storage';
import { T2_SETTLE_MS, resetDeepUseAsk } from '../src/app/state/deep-use';
import { resetEngagement } from '../src/app/state/engagement';
import { UiProvider } from '../src/app/state/ui';
import {
  DONATE_PROMPT_STORAGE_KEY,
  DONATE_QUIET_MS,
  donatePromptRecord,
  parseDonatePromptRecord,
} from '../src/lib/donate-prompt.js';
import { TRIGGER_TIME_MS } from '../src/lib/engagement.js';

const DAY = 24 * 60 * 60 * 1000;

function tree(extra: React.ReactNode = null) {
  return (
    <UiProvider>
      <button type="button" id="content">
        a flight row
      </button>
      {extra}
      <WaitlistStrip />
      <DonatePrompt />
    </UiProvider>
  );
}

const mount = (extra: React.ReactNode = null) => render(tree(extra));

const prompt = () => screen.queryByRole('dialog', { name: 'Keep The Blue Board going' });
const strip = () => screen.queryByRole('button', { name: 'Get updates' });
const stored = () => parseDonatePromptRecord(localStorage.getItem(DONATE_PROMPT_STORAGE_KEY));

/** T1, then the pause the prompt waits for (plus one poll). */
function reachDeepUseAndPause() {
  act(() => vi.advanceTimersByTime(TRIGGER_TIME_MS as number));
  act(() => vi.advanceTimersByTime(DONATE_QUIET_MS + 1000));
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetDeepUseAsk();
  resetEngagement();
  track.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetDeepUseAsk();
  resetEngagement();
  localStorage.clear();
});

describe('DonatePrompt', () => {
  it('uses the same storage key the dashboard writes', () => {
    expect(STORAGE_KEYS.donatePrompt).toBe(DONATE_PROMPT_STORAGE_KEY);
  });

  it('opens for a heavy user after a pause, instead of the email strip', () => {
    mount();
    act(() => vi.advanceTimersByTime((TRIGGER_TIME_MS as number) - 1000));
    expect(prompt()).toBeNull();
    reachDeepUseAndPause();
    expect(prompt()).not.toBeNull();
    expect(strip()).toBeNull();
    const link = screen.getByRole('link', { name: 'Donate to keep it going' });
    expect(link.getAttribute('href')).toBe('https://buymeacoffee.com/notjbg');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('data-support')).toBe('deep-use-prompt');
    expect(track).toHaveBeenCalledWith('donate_prompt', { action: 'shown' });
  });

  it('T2 counts too: twenty taps, a settle, then the pause', () => {
    mount();
    const row = document.getElementById('content')!;
    for (let i = 0; i < 20; i += 1) act(() => row.click());
    act(() => vi.advanceTimersByTime(T2_SETTLE_MS));
    act(() => vi.advanceTimersByTime(DONATE_QUIET_MS + 1000));
    expect(prompt()).not.toBeNull();
  });

  it('keeps waiting while the visitor is still scrolling or tapping', () => {
    mount();
    act(() => vi.advanceTimersByTime(TRIGGER_TIME_MS as number));
    for (let i = 0; i < 5; i += 1) {
      act(() => vi.advanceTimersByTime(DONATE_QUIET_MS - 1000));
      act(() => {
        window.dispatchEvent(new Event('scroll'));
      });
    }
    expect(prompt()).toBeNull();
    act(() => vi.advanceTimersByTime(DONATE_QUIET_MS + 1000));
    expect(prompt()).not.toBeNull();
  });

  it('never opens over another dialog, and opens once it has gone', () => {
    const view = mount(<div role="dialog" aria-label="Flight UA1" />);
    reachDeepUseAndPause();
    act(() => vi.advanceTimersByTime(60_000));
    expect(prompt()).toBeNull();
    view.rerender(tree(null));
    act(() => vi.advanceTimersByTime(DONATE_QUIET_MS + 1000));
    expect(prompt()).not.toBeNull();
  });

  it('"Maybe later" stores the answer, closes, and the strip does not follow this visit', () => {
    mount();
    reachDeepUseAndPause();
    fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));
    expect(prompt()).toBeNull();
    expect(stored()?.outcome).toBe('later');
    expect(track).toHaveBeenCalledWith('donate_prompt', { action: 'later' });
    act(() => vi.advanceTimersByTime(TRIGGER_TIME_MS as number));
    expect(prompt()).toBeNull();
    expect(strip()).toBeNull();
  });

  it('Escape counts as "Maybe later"', () => {
    mount();
    reachDeepUseAndPause();
    fireEvent.keyDown(prompt()!, { key: 'Escape' });
    expect(prompt()).toBeNull();
    expect(stored()?.outcome).toBe('later');
  });

  it('Donate stores the tap and closes', () => {
    mount();
    reachDeepUseAndPause();
    fireEvent.click(screen.getByRole('link', { name: 'Donate to keep it going' }));
    expect(prompt()).toBeNull();
    expect(stored()?.outcome).toBe('donate');
    expect(track).toHaveBeenCalledWith('donate_prompt', { action: 'donate' });
  });

  it('on a later visit inside the cooldown the email strip is the ask', () => {
    localStorage.setItem(DONATE_PROMPT_STORAGE_KEY, donatePromptRecord('later', Date.now() - 3 * DAY));
    mount();
    reachDeepUseAndPause();
    expect(prompt()).toBeNull();
    expect(strip()).not.toBeNull();
  });
});
