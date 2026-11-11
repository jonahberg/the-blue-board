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
import { supportUrl } from '@/lib/support-link.js';

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

  // Nov 2026: the phone header is 44 px, so its controls are 36 px surfaces whose `after:` box
  // reaches 4 px out on every side — a 44 × 44 hit area that does not make the header taller.
  // `relative` anchors the box; `z-10` keeps it above the brief row's hit area from below.
  const HIT_BOX_44 = ['relative', 'z-10', 'h-9', 'min-w-9', 'after:absolute', 'after:-inset-1'];

  it('keeps a 44px hit area on coarse pointers at every width (only a fine pointer relaxes it)', () => {
    renderHeader();
    for (const name of ['Find a flight', 'Watched flights (0)', 'What is this dashboard?']) {
      const classes = screen.getByRole('button', { name }).className.split(/\s+/);
      expect(classes).toEqual(expect.arrayContaining(HIT_BOX_44));
      // Width is not input type: the box only comes off for a mouse at md+.
      expect(classes).toContain('pointer-fine:md:after:hidden');
      expect(classes.some((c) => /^md:(after:hidden|min-h-0|min-w-0)$/.test(c))).toBe(false);
    }
  });

  it('on phones swaps the "?" for a labelled support link; the "?" returns from md: up', () => {
    renderHeader();
    const support = screen.getByRole('link', { name: 'Support The Blue Board' });
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
