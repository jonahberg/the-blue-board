// @vitest-environment jsdom
/**
 * The header's "Find a flight" button must have an accessible name at every width (F34).
 *
 * Below `sm` the button collapses to the 🔍 alone: the "Find a flight" label is
 * `hidden sm:inline` and the magnifier is `aria-hidden`. On a phone that leaves the button
 * with NO accessible name — a screen reader announces just "button". jsdom does not apply
 * Tailwind breakpoints, so the visible-text name would still be computed here; the only
 * width-independent guarantee is an explicit `aria-label`, and that is what is asserted.
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

  // KNOWN PRODUCT BUG (cross-file request to the src/app/shell owner): Header.tsx's search
  // <Button> has no aria-label, so at phone width its only text is the aria-hidden 🔍.
  // Fix: add `aria-label="Find a flight"` to that Button. When that lands, `it.fails`
  // starts failing — flip it to a plain `it`.
  it.fails('has an explicit aria-label, so it is named even when the label text is hidden', () => {
    renderHeader();
    const label = searchButton().getAttribute('aria-label');
    expect(label).toMatch(/find a flight|search/i);
  });
});
