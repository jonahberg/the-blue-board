// @vitest-environment jsdom
/**
 * The dashboard header's search button is the only search entry point on a phone. v1.8.0 hid
 * its visible label with `display:none` below `sm`, which also removed it from the accessibility
 * tree, and it announced as a bare "button" (axe button-name, critical). An aria-label fixed
 * that, but over the visible "Find a flight ⌘K" it announced different words from the ones on
 * screen (axe label-content-name-mismatch, WCAG 2.5.3, Nov 2026). The name now comes from the
 * label itself, which is `sr-only` below `sm` — never `hidden`.
 *
 * jsdom does not apply Tailwind, so `getByRole(..., { name })` would pass even with a `hidden`
 * label. The class that keeps the label in the tree at every width is what is asserted.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { supportUrl } from '@/lib/support-link.js';

vi.mock('../src/app/state/feed', () => ({
  useFeed: () => ({ flights: [], freshness: 'live', countdown: 30 }),
}));
const watch = vi.hoisted(() => ({ watched: [] as { flight: string }[] }));
vi.mock('../src/app/state/watch', () => ({
  useWatch: () => watch,
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

afterEach(() => {
  cleanup();
  watch.watched = [];
});

describe('Header search button', () => {
  it('is named by its own label, kept in the accessibility tree at every width', () => {
    renderHeader();
    const button = screen.getByRole('button', { name: 'Find a flight' });
    // No aria-label to drift from the visible words (WCAG 2.5.3).
    expect(button.getAttribute('aria-label')).toBeNull();
    const label = [...button.querySelectorAll('span')].find((el) => el.textContent === 'Find a flight')!;
    const classes = label.className.split(/\s+/);
    // Below `sm` the label is visually hidden but still read: sr-only, never display:none.
    expect(classes).toContain('max-sm:sr-only');
    expect(classes.some((c) => /^(max-sm:)?hidden$/.test(c))).toBe(false);
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('hides the ⌘K glyph from assistive tech (the shortcut is exposed via aria-keyshortcuts)', () => {
    renderHeader();
    const button = screen.getByRole('button', { name: 'Find a flight' });
    expect(button.querySelector('kbd')?.getAttribute('aria-hidden')).toBe('true');
    expect(button.getAttribute('aria-keyshortcuts')).toMatch(/Meta\+K/);
  });

  // Nov 2026: the phone header is 44 px, so its controls are 36 px surfaces whose `after:` box
  // reaches 4 px past the border on every side (5 px from inside the 1 px border, where a
  // pseudo-element is measured) — a 44 × 44 hit area that does not make the header taller.
  // `relative` anchors the box; `z-10` keeps it above the brief row's hit area from below.
  const HIT_BOX_44 = ['relative', 'z-10', 'h-9', 'min-w-9', 'after:absolute', 'after:-inset-[5px]'];

  it('keeps a 44px hit area on coarse pointers at every width (only a fine pointer relaxes it)', () => {
    renderHeader();
    for (const name of ['Find a flight', 'Watched flights', 'What is this dashboard?']) {
      const classes = screen.getByRole('button', { name }).className.split(/\s+/);
      expect(classes).toEqual(expect.arrayContaining(HIT_BOX_44));
      // Width is not input type: the box only comes off for a mouse at md+.
      expect(classes).toContain('pointer-fine:md:after:hidden');
      expect(classes.some((c) => /^md:(after:hidden|min-h-0|min-w-0)$/.test(c))).toBe(false);
    }
  });

  it('on phones swaps the "?" for a labelled support link; the "?" returns from md: up', () => {
    renderHeader();
    // The site-wide "cover a day" wording (Nov 2026); an icon-only link, so the name is its label.
    const support = screen.getByRole('link', { name: 'Cover a day of The Blue Board' });
    expect(support.getAttribute('title')).toBe('Cover a day of The Blue Board');
    expect(support.getAttribute('href')).toBe(supportUrl('mobile-header'));
    // A neutral "support" icon, not the old coffee cup; the name comes from aria-label.
    expect(support.querySelector('svg')?.getAttribute('class')).toContain('lucide-hand-heart');
    expect(support.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(support.getAttribute('target')).toBe('_blank');
    expect(support.getAttribute('rel')).toContain('noopener');
    expect(support.getAttribute('data-support')).toBe('mobile-header');
    const supportClasses = support.className.split(/\s+/);
    expect(supportClasses).toContain('md:hidden');
    expect(supportClasses).toEqual(expect.arrayContaining(HIT_BOX_44));
    const help = screen.getByRole('button', { name: 'What is this dashboard?' }).className.split(/\s+/);
    expect(help).toContain('hidden');
    expect(help).toContain('md:inline-flex');
  });
});

describe('Header wordmark', () => {
  it('is named by its own words plus its purpose, with no aria-label over different text (WCAG 2.5.3)', () => {
    renderHeader();
    const home = screen.getByRole('link', { name: /^The Blue Board\b.*back to the live map$/ });
    expect(home.getAttribute('href')).toBe('#live');
    expect(home.getAttribute('aria-label')).toBeNull();
    // The capitals are CSS: a screen reader reads a name, not an acronym.
    const word = [...home.querySelectorAll('span')].find((el) => el.textContent === 'The Blue Board')!;
    expect(word.className.split(/\s+/)).toContain('uppercase');
  });
});

describe('Header watch button', () => {
  it('is named by its words with the count it shows among them, not an aria-label over the count (WCAG 2.5.3)', () => {
    watch.watched = [{ flight: 'UA1' }, { flight: 'UA2' }];
    renderHeader();
    const button = screen.getByRole('button', { name: 'Watched flights 2' });
    expect(button.getAttribute('aria-label')).toBeNull();
    expect(button.getAttribute('aria-controls')).toBe('watch-panel');
  });
});
