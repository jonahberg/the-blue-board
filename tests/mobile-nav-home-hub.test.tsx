// @vitest-environment jsdom
/**
 * Phones can set a home hub directly (Nov 2026). The header's hub button is `hidden md:inline-flex`,
 * so on a phone the only way was More → "What is this dashboard?". The More sheet now carries a
 * "Home hub" row: the same picker, the same nine hubs, the same `setHomeAirport`.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { MobileNav } from '../src/app/shell/MobileNav';
import { PrefsProvider, usePrefs } from '../src/app/state/prefs';
import { UiProvider } from '../src/app/state/ui';
import { HOME_HUB_OPTIONS } from '../src/lib/home-hub-options.js';
import { HOME_HUB_CYCLE } from '../src/lib/home-airport.js';

beforeAll(() => {
  Element.prototype.scrollIntoView ??= vi.fn();
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
  window.HTMLElement.prototype.releasePointerCapture ??= () => {};
});
beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

let current = '';
function HomeProbe() {
  current = usePrefs().homeAirport;
  return null;
}

function mount() {
  return render(
    <PrefsProvider>
      <UiProvider>
        <MobileNav tab="live" onSelect={() => {}} />
        <HomeProbe />
      </UiProvider>
    </PrefsProvider>,
  );
}

function openMore() {
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  return screen.getByRole('dialog', { name: 'More' });
}

async function pick(trigger: HTMLElement, optionName: RegExp | string) {
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  });
  const option = await screen.findByRole('option', { name: optionName });
  await act(async () => {
    fireEvent.click(option);
  });
}

describe('MobileNav More sheet: Home hub', () => {
  it('offers the nine hubs (the header cycle, minus its no-preference slot)', () => {
    expect(HOME_HUB_OPTIONS.map((o) => o.code)).toEqual(HOME_HUB_CYCLE.filter(Boolean));
  });

  it('has a labelled picker with a 44px touch target, showing "No preference" when none is set', () => {
    mount();
    const sheet = openMore();
    const trigger = within(sheet).getByRole('combobox', { name: 'Home hub' });
    expect(trigger.className).toMatch(/\bmin-h-11\b/);
    expect(trigger.textContent).toBe('No preference');
  });

  it('saves the picked hub through the same setter (and storage) the dialog uses', async () => {
    mount();
    const sheet = openMore();
    await pick(within(sheet).getByRole('combobox', { name: 'Home hub' }), /EWR — Newark/);
    expect(current).toBe('EWR');
    expect(window.localStorage.getItem('bb_home_airport')).toBe('EWR');
    expect(within(sheet).getByRole('combobox', { name: 'Home hub' }).textContent).toBe('EWR — Newark');
  });

  it('"No preference" clears a hub that was set', async () => {
    window.localStorage.setItem('bb_home_airport', 'DEN');
    mount();
    const sheet = openMore();
    const trigger = within(sheet).getByRole('combobox', { name: 'Home hub' });
    expect(trigger.textContent).toBe('DEN — Denver');
    await pick(trigger, 'No preference');
    expect(current).toBe('');
    expect(window.localStorage.getItem('bb_home_airport')).toBe(null);
  });
});
