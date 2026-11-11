// @vitest-environment jsdom
/**
 * The "What is this dashboard?" dialog's wiring, rendered for real (F123, F144; Nov 2026).
 *
 * Until Nov 2026 this was the first-visit welcome and it opened by itself over the live map.
 * The map is the first impression now: the dialog opens ONLY when asked (the header "?" and
 * the phone "More" sheet both call `setOnboardingOpen(true)`). What this file pins:
 *
 *   - it never opens by itself — not on a first visit, not for a returning visitor, not on a
 *     deep-link arrival, and not when the waitlist dialog closes (that used to bring it up);
 *   - the engagement store still records the visit, before reading nothing that depends on it,
 *     so a first-timer's waitlist threshold is still 20;
 *   - opened on request, its one dismiss still writes `bb-onboarded` and
 *     `bb_onboarding_dismissed`, so a returning visitor's storage reads as it always did;
 *   - the hub picker is re-seeded from the live preference every time it opens, so a hub
 *     changed from the header is shown — and not reverted by the dismiss.
 *
 * Everything runs through the real UiProvider, PrefsProvider and engagement store against
 * jsdom's localStorage, so an empty store is exactly a first-time visitor.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Onboarding from '../src/app/features/Onboarding';
import { engagementSnapshot, initEngagement, resetEngagement } from '../src/app/state/engagement';
import { PrefsProvider, usePrefs } from '../src/app/state/prefs';
import type { PrefsValue } from '../src/app/state/prefs';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';

const TITLE = /^The Blue Board$/;

let ui: UiValue | null = null;
let prefs: PrefsValue | null = null;

function Probe() {
  ui = useUi();
  prefs = usePrefs();
  return null;
}

function mount() {
  return render(
    <UiProvider>
      <PrefsProvider>
        <Probe />
        <Onboarding />
      </PrefsProvider>
    </UiProvider>,
  );
}

function dialogShown(): boolean {
  return screen.queryByRole('dialog', { name: TITLE }) !== null;
}

/** The picker trigger's visible text — Radix renders the selected item's label into it. */
function pickerText(): string {
  return document.getElementById('onboarding-home-hub')?.textContent ?? '';
}

function dismissWithButton() {
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
}

beforeEach(() => {
  localStorage.clear();
  resetEngagement();
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  cleanup();
  resetEngagement();
  localStorage.clear();
  ui = null;
  prefs = null;
});

describe('The dialog never opens by itself (Nov 2026: the live map is the first impression)', () => {
  it('stays closed on a first visit, with nothing in storage', async () => {
    await act(async () => {
      mount();
      initEngagement();
    });
    expect(dialogShown()).toBe(false);
    expect(ui!.onboardingOpen).toBe(false);
  });

  it('stays closed for a returning visitor who never dismissed it', async () => {
    // Before Nov 2026 this visitor (arrived on a deep link once, never saw the welcome) got
    // the modal on their next bare visit.
    localStorage.setItem('bb-visited', '1');
    await act(async () => {
      mount();
      initEngagement();
    });
    expect(dialogShown()).toBe(false);
  });

  it('stays closed when the waitlist dialog opens and closes', async () => {
    await act(async () => {
      mount();
      initEngagement();
    });
    await act(async () => ui!.setWaitlistOpen(true));
    await act(async () => ui!.setWaitlistOpen(false));
    expect(ui!.onboardingOpen).toBe(false);
    expect(dialogShown()).toBe(false);
  });

  it('stays closed on a deep-link arrival, and the visit is still recorded', async () => {
    window.history.replaceState(null, '', '/?hub=den');
    await act(async () => {
      mount();
      initEngagement();
    });
    expect(dialogShown()).toBe(false);
    expect(localStorage.getItem('bb-visited')).toBe('1');
  });

  it('a first-timer still gets the 20-click waitlist threshold: the visit is recorded after it is read', () => {
    initEngagement();
    expect(engagementSnapshot().triggerClicks).toBe(20);
    expect(localStorage.getItem('bb-visited')).toBe('1');
  });
});

describe('Opened on request', () => {
  it('opens from setOnboardingOpen(true) — the header "?" and the More sheet — and closes on Done', async () => {
    await act(async () => {
      mount();
    });
    await act(async () => ui!.setOnboardingOpen(true));
    expect(dialogShown()).toBe(true);
    // An orientation and the hub picker, not the old six-row feature list.
    expect(screen.getByText('Schedule')).toBeTruthy();
    expect(screen.getByLabelText('Home hub')).toBeTruthy();

    await act(async () => dismissWithButton());
    expect(dialogShown()).toBe(false);
    expect(ui!.onboardingOpen).toBe(false);
  });

  it('still writes the old onboarding keys on dismiss, so a returning visitor’s storage reads as before', async () => {
    await act(async () => {
      mount();
    });
    await act(async () => ui!.setOnboardingOpen(true));
    await act(async () => dismissWithButton());
    expect(localStorage.getItem('bb-onboarded')).toBe('1');
    expect(Number(localStorage.getItem('bb_onboarding_dismissed'))).toBeGreaterThan(0);
  });

  it('reopens after a dismissal', async () => {
    await act(async () => {
      mount();
    });
    await act(async () => ui!.setOnboardingOpen(true));
    await act(async () => dismissWithButton());
    await act(async () => ui!.setOnboardingOpen(true));
    expect(dialogShown()).toBe(true);
  });
});

describe('The hub picker is re-seeded from the live preference', () => {
  it('shows the current hub each time it opens, and dismissing keeps it', async () => {
    localStorage.setItem('bb_home_airport', 'ORD');
    await act(async () => {
      mount();
    });
    await act(async () => ui!.setOnboardingOpen(true));
    expect(dialogShown()).toBe(true);
    expect(pickerText()).toContain('ORD');

    await act(async () => dismissWithButton());
    expect(prefs!.homeAirport).toBe('ORD');

    // The header's hub picker changes the preference while the dialog is closed.
    await act(async () => prefs!.setHomeAirport('SFO'));
    await act(async () => ui!.setOnboardingOpen(true));
    expect(dialogShown()).toBe(true);
    expect(pickerText()).toContain('SFO');
    expect(pickerText()).not.toContain('ORD');

    // Dismissing writes the picker's value back — it must not revert the header's choice.
    await act(async () => dismissWithButton());
    expect(prefs!.homeAirport).toBe('SFO');
    expect(localStorage.getItem('bb_home_airport')).toBe('SFO');
  });

  it('Done on "No preference" saves no hub', async () => {
    await act(async () => {
      mount();
    });
    await act(async () => ui!.setOnboardingOpen(true));
    await act(async () => dismissWithButton());
    expect(prefs!.homeAirport).toBe('');
    expect(localStorage.getItem('bb_home_airport')).toBe(null);
  });
});

describe('one list of home hubs', () => {
  it('the dialog and the phone More sheet offer HOME_HUB_OPTIONS, which matches the header cycle', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const { HOME_HUB_OPTIONS } = await import('../src/lib/home-hub-options.js');
    const { HOME_HUB_CYCLE } = await import('../src/lib/home-airport.js');
    for (const file of ['src/app/features/Onboarding.tsx', 'src/app/shell/MobileNav.tsx']) {
      const source = readFileSync(resolve(__dirname, '..', file), 'utf8');
      expect(source, file).toMatch(/import \{ HOME_HUB_OPTIONS \} from '@\/lib\/home-hub-options\.js'/);
      expect(source, file).toMatch(/HOME_HUB_OPTIONS\.map\(/);
      // No second hand-written copy of the rows.
      expect(source, file).not.toMatch(/name: 'Tokyo Narita'/);
    }
    expect(HOME_HUB_OPTIONS.map((o: { code: string }) => o.code)).toEqual(HOME_HUB_CYCLE.filter(Boolean));
  });
});
