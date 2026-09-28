// @vitest-environment jsdom
/**
 * The onboarding overlay's wiring, rendered for real (F123, F144).
 *
 * The pure rules — `onboardingMayOpen()` and `onboardingHubSeed()` — are unit-tested in
 * tests/popup-triggers.test.js and tests/engagement.test.js. What those cannot see is whether
 * `src/app/features/Onboarding.tsx` actually applies them:
 *
 *   - it waits for the waitlist to close before auto-opening (`waitlistOpen` in the deps);
 *   - it auto-opens at most once per load, so closing the waitlist never resurrects a
 *     welcome the visitor already dismissed;
 *   - the header's "?" (`setOnboardingOpen(true)`) still reopens it after that;
 *   - the hub picker is re-seeded from the live preference every time it opens, so a hub
 *     changed from the header is shown — and not reverted by the dismiss.
 *
 * Everything runs through the real UiProvider, PrefsProvider and engagement store against
 * jsdom's localStorage, so an empty store is exactly a first-time visitor.
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import Onboarding from '../src/app/features/Onboarding';
import { resetEngagement } from '../src/app/state/engagement';
import { PrefsProvider, usePrefs } from '../src/app/state/prefs';
import type { PrefsValue } from '../src/app/state/prefs';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';

const TITLE = /Welcome to The Blue Board/;

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
  fireEvent.click(screen.getByRole('button', { name: /Fly the Friendly Skies/ }));
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

describe('Onboarding auto-open yields to the waitlist', () => {
  it('opens on a first visit when nothing else is up', async () => {
    await act(async () => {
      mount();
    });
    expect(dialogShown()).toBe(true);
    expect(ui!.onboardingOpen).toBe(true);
  });

  it('stays closed while the waitlist is open, and comes up once it closes', async () => {
    // `?waitlist=1` is the real path that has the waitlist up at mount: deep-links.ts flips
    // it before the engagement store is ready. A layout effect lands it in the same slot.
    function WaitlistFirst() {
      const u = useUi();
      useLayoutEffect(() => {
        u.setWaitlistOpen(true);
      }, []);
      return null;
    }
    await act(async () => {
      render(
        <UiProvider>
          <PrefsProvider>
            <Probe />
            <WaitlistFirst />
            <Onboarding />
          </PrefsProvider>
        </UiProvider>,
      );
    });

    expect(ui!.waitlistOpen).toBe(true);
    expect(dialogShown()).toBe(false);
    expect(ui!.onboardingOpen).toBe(false);

    await act(async () => ui!.setWaitlistOpen(false));
    expect(ui!.onboardingOpen).toBe(true);
    expect(dialogShown()).toBe(true);
  });

  it('does not come back when the waitlist closes after the welcome was dismissed', async () => {
    await act(async () => {
      mount();
    });
    expect(dialogShown()).toBe(true);

    await act(async () => dismissWithButton());
    expect(dialogShown()).toBe(false);

    // 20 clicks later the waitlist opens, and the visitor closes it.
    await act(async () => ui!.setWaitlistOpen(true));
    await act(async () => ui!.setWaitlistOpen(false));

    expect(ui!.onboardingOpen).toBe(false);
    expect(dialogShown()).toBe(false);
  });

  it('the header "?" still reopens it after a dismissal', async () => {
    await act(async () => {
      mount();
    });
    await act(async () => dismissWithButton());
    expect(dialogShown()).toBe(false);

    await act(async () => ui!.setOnboardingOpen(true));
    expect(dialogShown()).toBe(true);
  });

  it('does not auto-open for a visitor who has already onboarded', async () => {
    localStorage.setItem('bb-visited', '1');
    localStorage.setItem('bb-onboarded', '1');
    await act(async () => {
      mount();
    });
    expect(dialogShown()).toBe(false);
  });
});

describe('Onboarding re-seeds the hub picker from the live preference', () => {
  it('shows the current hub each time it opens, and dismissing keeps it', async () => {
    localStorage.setItem('bb_home_airport', 'ORD');
    await act(async () => {
      mount();
    });
    expect(dialogShown()).toBe(true);
    expect(pickerText()).toContain('ORD');

    await act(async () => dismissWithButton());
    expect(prefs!.homeAirport).toBe('ORD');

    // The header's hub picker changes the preference while the overlay is closed.
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
});

describe('Onboarding stays down on a deep-link arrival (F45)', () => {
  it('does not open over the view a ?hub= link was sent for, but still records the visit', async () => {
    window.history.replaceState(null, '', '/?hub=den');
    await act(async () => {
      mount();
    });
    expect(dialogShown()).toBe(false);
    expect(ui!.onboardingOpen).toBe(false);
    // The visit is marked either way, so the waitlist threshold reads the same as before.
    expect(localStorage.getItem('bb-visited')).toBe('1');
  });

  it('opens on the next bare visit, since the welcome was never dismissed', async () => {
    localStorage.setItem('bb-visited', '1');
    await act(async () => {
      mount();
    });
    expect(dialogShown()).toBe(true);
  });
});
