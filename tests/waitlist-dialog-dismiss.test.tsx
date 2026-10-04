// @vitest-environment jsdom
/**
 * Closing the waitlist modal persists the 7-day dismissal (F126).
 *
 * `src/app/features/WaitlistDialog.tsx` routes every close — the ✕, Escape and a click on
 * the backdrop — through one `close()` that writes `bb_waitlist_dismissed`. That timestamp
 * is what keeps the passive ask — since Oct 2026 the "Stay in the loop" strip that the five-
 * minute and click-threshold triggers reveal — quiet for 30 days, so a close path that forgets
 * to write it re-asks on the next visit.
 *
 * The modal is opened the way `?waitlist=1` opens it: `setWaitlistOpen(true)` on the real
 * UiProvider.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DISMISS_TTL_MS } from '../src/lib/engagement.js';
import { shouldShowWaitlist, shouldShowWaitlistStrip } from '../src/lib/waitlist-gate.js';
import WaitlistDialog from '../src/app/features/WaitlistDialog';
import { resetEngagement } from '../src/app/state/engagement';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';

const KEY = 'bb_waitlist_dismissed';
const TITLE = /Stay in the loop/;

let ui: UiValue | null = null;
function Probe() {
  ui = useUi();
  return null;
}

async function openWaitlist() {
  await act(async () => {
    render(
      <UiProvider>
        <Probe />
        <WaitlistDialog />
      </UiProvider>,
    );
  });
  await act(async () => ui!.setWaitlistOpen(true));
  expect(screen.getByRole('dialog', { name: TITLE })).toBeTruthy();
}

function expectFreshDismissal(before: number) {
  expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull();
  expect(ui!.waitlistOpen).toBe(false);
  const written = Number(localStorage.getItem(KEY));
  expect(written).toBeGreaterThanOrEqual(before);
  expect(written).toBeLessThanOrEqual(Date.now());
  expect(written - before).toBeLessThan(DISMISS_TTL_MS);
  // …and the next passive ask is suppressed by it: the old modal gate and the strip alike.
  expect(shouldShowWaitlist(localStorage, { shownThisSession: false })).toBe(false);
  expect(shouldShowWaitlistStrip(localStorage, { triggered: true })).toBe(false);
}

beforeEach(() => {
  localStorage.clear();
  // A returning visitor, so the engagement store's first read does not matter here.
  localStorage.setItem('bb-visited', '1');
  localStorage.setItem('bb-onboarded', '1');
  resetEngagement();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  resetEngagement();
  localStorage.clear();
  ui = null;
});

describe('WaitlistDialog close writes the 7-day dismissal', () => {
  it('the ✕ button', async () => {
    await openWaitlist();
    expect(localStorage.getItem(KEY)).toBeNull();
    const before = Date.now();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /close/i }));
    });
    expectFreshDismissal(before);
  });

  it('Escape', async () => {
    await openWaitlist();
    const before = Date.now();
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('dialog', { name: TITLE }), { key: 'Escape' });
    });
    expectFreshDismissal(before);
  });

  it('a click on the backdrop', async () => {
    await openWaitlist();
    const overlay = document.querySelector('[data-slot="dialog-overlay"]');
    expect(overlay, 'the dialog overlay was not rendered').not.toBeNull();
    const before = Date.now();
    await act(async () => {
      // Radix's outside-dismiss listens for pointerdown on the document.
      fireEvent.pointerDown(overlay!);
      fireEvent.pointerUp(overlay!);
      fireEvent.click(overlay!);
    });
    expectFreshDismissal(before);
  });
});
