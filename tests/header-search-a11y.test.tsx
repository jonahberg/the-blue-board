// @vitest-environment jsdom
/**
 * The header's "Find a flight" button must have an accessible name at every width (F34).
 *
 * Below `sm` the button collapses to the magnifier alone. While the "Find a flight" label was
 * `hidden sm:inline` that left the button with NO accessible name on a phone. Since Nov 2026 the
 * label is `max-sm:sr-only`: invisible below `sm` but still read, so the button is named by its
 * own words at every width and carries no aria-label (which, over the visible "⌘K" hint, failed
 * WCAG 2.5.3). jsdom does not apply Tailwind breakpoints, so the class is what is asserted.
 *
 * The feed and watch providers are stubbed (they poll and bootstrap push); prefs and ui are
 * the real ones.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '../src/components/ui/tooltip';
import { Header } from '../src/app/shell/Header';
import { PrefsProvider } from '../src/app/state/prefs';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';

vi.mock('../src/app/state/feed', () => ({
  useFeed: () => ({
    flights: [],
    lastGoodTs: null,
    freshness: 'live',
    countdown: 30,
    retrying: false,
    refreshing: false,
    failed: false,
    error: null,
    refresh: () => {},
    lookupReg: () => null,
  }),
}));

vi.mock('../src/app/state/watch', () => ({
  useWatch: () => ({ watched: [] }),
}));

let ui: UiValue | null = null;
function Probe() {
  ui = useUi();
  return null;
}

function renderHeader() {
  render(
    <UiProvider>
      <PrefsProvider>
        <TooltipProvider>
          <Probe />
          <Header onOpenWatch={() => {}} watchOpen={false} onOpenHelp={() => {}} />
        </TooltipProvider>
      </PrefsProvider>
    </UiProvider>,
  );
}

/** The search trigger, found by its ⌘K hint rather than by the name under test. */
function searchButton(): HTMLButtonElement {
  const kbd = [...document.querySelectorAll('header kbd')].find((el) => el.textContent?.includes('⌘K'));
  const button = kbd?.closest('button');
  if (!button) throw new Error('header search button not found');
  return button as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
  ui = null;
  window.history.replaceState(null, '', '/');
});

describe('header search button', () => {
  it('opens the search palette', () => {
    renderHeader();
    fireEvent.click(searchButton());
    expect(ui!.searchOpen).toBe(true);
  });

  it('every other icon-only header control already carries an aria-label', () => {
    renderHeader();
    expect(screen.getByRole('button', { name: /Watched flights/ }).getAttribute('aria-label')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'What is this dashboard?' })).toBeTruthy();
  });

  // Header.tsx's search <Button> once had a `hidden` label and no aria-label, so at phone width
  // its only text was the aria-hidden icon. Its label now stays in the tree at every width.
  it('is named "Find a flight" by its own label text, never by an aria-label', () => {
    renderHeader();
    const button = searchButton();
    expect(button.getAttribute('aria-label')).toBeNull();
    expect(screen.getByRole('button', { name: 'Find a flight' })).toBe(button);
    const label = [...button.querySelectorAll('span')].find((el) => el.textContent === 'Find a flight');
    expect(label?.className).toContain('max-sm:sr-only');
    expect(label?.className.split(/\s+/)).not.toContain('hidden');
  });
});
