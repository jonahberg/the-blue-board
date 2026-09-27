// @vitest-environment jsdom
/**
 * The dashboard header's search button is the only search entry point on a phone. Below `sm`
 * its visible label is `display:none`, which also removes it from the accessibility tree —
 * v1.8.0 shipped it announcing as a bare "button" (axe button-name, critical).
 *
 * jsdom does not apply Tailwind, so `getByRole(..., { name })` would pass even with the bug
 * (the `hidden sm:inline` span still counts as text here). The name therefore has to come
 * from an attribute that does not depend on layout, and that is what is asserted.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('../src/app/state/feed', () => ({
  useFeed: () => ({ flights: [], freshness: 'live', countdown: 30 }),
}));
vi.mock('../src/app/state/watch', () => ({
  useWatch: () => ({ watched: [] }),
}));

const { Header } = await import('../src/app/shell/Header');
const { UiProvider } = await import('../src/app/state/ui');
const { PrefsProvider } = await import('../src/app/state/prefs');

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

afterEach(cleanup);

describe('Header search button', () => {
  it('carries its accessible name as an attribute, independent of the hidden label', () => {
    renderHeader();
    const button = screen.getByRole('button', { name: 'Find a flight' });
    expect(button.getAttribute('aria-label')).toBe('Find a flight');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('hides the ⌘K glyph from assistive tech (the shortcut is exposed via aria-keyshortcuts)', () => {
    renderHeader();
    const button = screen.getByRole('button', { name: 'Find a flight' });
    expect(button.querySelector('kbd')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.getAttribute('aria-keyshortcuts')).toMatch(/Meta\+K/);
  });

  it('keeps the 44px touch floor on coarse pointers at every width (only a fine pointer relaxes it)', () => {
    renderHeader();
    for (const name of ['Find a flight', 'Watched flights (0)', 'What is this dashboard?']) {
      const classes = screen.getByRole('button', { name }).className.split(/\s+/);
      expect(classes).toContain('min-h-11');
      expect(classes).not.toContain('md:min-h-0');
      expect(classes).toContain('pointer-fine:md:min-h-0');
    }
  });
});
