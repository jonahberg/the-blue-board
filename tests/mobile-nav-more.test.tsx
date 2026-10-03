// @vitest-environment jsdom
/**
 * The phone "More" sheet carries About and Support (v1.11.3, audit Oct 3 2026).
 *
 * The ⓘ menu (About, Disclaimer, Donate, the Supporters Wall behind About) lives in the
 * attribution strip, which is hidden below `md:`. On a phone the More sheet listed Fleet,
 * Starlink, Stats and Sources and nothing else, so the About dialog — with the "do not use this
 * for operational or safety-critical decisions" line — and every donate link were unreachable
 * for roughly a third of visitors.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import DisclaimerDialog from '../src/app/features/DisclaimerDialog';
import { MobileNav } from '../src/app/shell/MobileNav';
import { UiProvider } from '../src/app/state/ui';

afterEach(cleanup);

function mount() {
  return render(
    <UiProvider>
      <MobileNav tab="live" onSelect={() => {}} />
      <DisclaimerDialog />
    </UiProvider>,
  );
}

function openMore() {
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  return screen.getByRole('dialog', { name: 'More' });
}

describe('MobileNav More sheet', () => {
  it('lists About and a Support link next to the overflow tabs', () => {
    mount();
    const sheet = openMore();
    expect(within(sheet).getByRole('button', { name: 'Sources' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'About' })).toBeTruthy();

    const support = within(sheet).getByRole('link', { name: /Support The Blue Board/ });
    expect(support.getAttribute('href')).toBe('https://buymeacoffee.com/notjbg');
    expect(support.getAttribute('target')).toBe('_blank');
    expect(support.getAttribute('rel')).toBe('noopener noreferrer');
    // The delegated support_click tracker labels the placement from this attribute.
    expect(support.getAttribute('data-support')).toBe('mobile-more');
  });

  it('gives both new rows the same 44px touch target as the tab rows', () => {
    mount();
    const sheet = openMore();
    for (const el of [
      within(sheet).getByRole('button', { name: 'About' }),
      within(sheet).getByRole('link', { name: /Support The Blue Board/ }),
    ]) {
      expect(el.className).toMatch(/\bmin-h-11\b/);
      expect(el.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('About closes the sheet and opens the About dialog with the safety line', async () => {
    mount();
    const sheet = openMore();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'About' }));
    });
    const about = await screen.findByRole('dialog', { name: /About The Blue Board/ });
    expect(about.textContent).toMatch(/Do not use this dashboard for operational or safety-critical decisions/);
    expect(screen.queryByRole('dialog', { name: 'More' })).toBeNull();
  });

  it('never opens anything by itself', () => {
    mount();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
