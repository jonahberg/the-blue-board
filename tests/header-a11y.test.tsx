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

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { HELP_COVER_LABEL } from '@/lib/cover-a-day.js';
import { supportUrl } from '@/lib/support-link.js';
import { SUPPORT_CLICK_EVENT, installSupportClickTracking } from '@/lib/support-tracking.js';

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

// Nov 2026: the phone header is 44 px, so its controls are 36 px surfaces whose `after:` box
// reaches 4 px past the border on every side (5 px from inside the 1 px border, where a
// pseudo-element is measured) — a 44 × 44 hit area that does not make the header taller.
// `relative` anchors the box; `z-10` keeps it above the brief row's hit area from below.
const HIT_BOX_44 = ['relative', 'z-10', 'h-9', 'min-w-9', 'after:absolute', 'after:-inset-[5px]'];

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

  it('on phones swaps the "?" for a labelled support button; the "?" returns from md: up', () => {
    renderHeader();
    // The site-wide "cover a day" wording (Nov 2026); an icon-only control, so the name is its label.
    // Since Nov 22 2026 it opens the "Cover a day" sheet rather than linking to Stripe
    // (tests/support-sheet.test.tsx): a button, with no address and no `data-support`.
    expect(screen.queryByRole('link', { name: 'Cover a day of The Blue Board' })).toBeNull();
    const support = screen.getByRole('button', { name: 'Cover a day of The Blue Board' });
    expect(support.tagName).toBe('BUTTON');
    expect(support.getAttribute('title')).toBe('Cover a day of The Blue Board');
    expect(support.hasAttribute('href')).toBe(false);
    expect(support.hasAttribute('data-support')).toBe(false);
    expect(support.getAttribute('aria-haspopup')).toBe('dialog');
    // A neutral "support" icon, not the old coffee cup; the name comes from aria-label.
    expect(support.querySelector('svg')?.getAttribute('class')).toContain('lucide-hand-heart');
    expect(support.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    const supportClasses = support.className.split(/\s+/);
    expect(supportClasses).toContain('md:hidden');
    expect(supportClasses).toEqual(expect.arrayContaining(HIT_BOX_44));
    const help = screen.getByRole('button', { name: 'What is this dashboard?' }).className.split(/\s+/);
    expect(help).toContain('hidden');
    expect(help).toContain('md:inline-flex');
  });
});

// Nov 22 2026: desktop (two thirds of visitors) had no visible way to give before the
// five-minute strip. From `md:` up the header carries a labelled link, words from 1081 px,
// icon + tooltip below that (measured: the words ran into the wordmark at 1024 px).
describe('Header desktop support link', () => {
  const BANNED = /\bdonat(?:e|es|ed|ion|ions|ing)\b|support the project|server costs?|\bconsider\b|chip in|coffee/i;
  const desktopLink = () => document.querySelector<HTMLAnchorElement>('a[data-support="desktop-header"]')!;

  it('is the any-amount link labelled desktop-header, named by its own words', () => {
    renderHeader();
    const link = screen.getByRole('link', { name: HELP_COVER_LABEL });
    expect(link).toBe(desktopLink());
    expect(link.getAttribute('href')).toBe(supportUrl('desktop-header'));
    const params = new URL(link.getAttribute('href')!).searchParams;
    expect(params.get('utm_content')).toBe('desktop-header');
    expect(params.get('client_reference_id')).toBe('desktop-header');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    // No aria-label over the visible words (WCAG 2.5.3); the words are the shared constant.
    expect(link.getAttribute('aria-label')).toBeNull();
    expect(link.textContent).toBe(HELP_COVER_LABEL);
    expect(link.textContent).not.toMatch(BANNED);
    expect(link.querySelector('svg')?.getAttribute('class')).toContain('lucide-hand-heart');
    expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows from md: up, where the phone icon is hidden, with the header controls\' 44px touch box', () => {
    renderHeader();
    const classes = desktopLink().className.split(/\s+/);
    expect(classes).toContain('hidden');
    expect(classes).toContain('md:inline-flex');
    expect(classes).toEqual(expect.arrayContaining(HIT_BOX_44));
    expect(classes).toContain('pointer-fine:md:after:hidden');
    // Quiet like its neighbours: a ghost control in muted text, never a filled button.
    expect(desktopLink().getAttribute('data-variant')).toBe('ghost');
    expect(classes).toContain('text-muted-foreground');
    // Below 1081 px the words are sr-only (still the name), never display:none.
    const label = desktopLink().querySelector('span')!.className.split(/\s+/);
    expect(label).toContain('max-[1081px]:sr-only');
    expect(label.some((c) => /^([\w-]+:|max-\[\d+px\]:|min-\[\d+px\]:)?hidden$/.test(c))).toBe(false);
    // The phone icon is its own control, hidden from md: up. Since Nov 22 2026 it is a button
    // that opens the "Cover a day" sheet (tests/support-sheet.test.tsx), so no element carries
    // the bare `mobile-header` label any more.
    const phone = screen.getByRole('button', { name: 'Cover a day of The Blue Board' });
    expect(phone).not.toBe(desktopLink());
    expect(phone.className.split(/\s+/)).toContain('md:hidden');
    expect(document.querySelector('[data-support="mobile-header"]')).toBeNull();
  });

  it('is counted as a support_click from desktop-header', () => {
    renderHeader();
    const send = vi.fn();
    installSupportClickTracking(document, send);
    // jsdom cannot navigate; stop the default after the capture-phase listener has counted it.
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener('click', stop);
    try {
      fireEvent.click(desktopLink());
    } finally {
      document.removeEventListener('click', stop);
    }
    expect(send).toHaveBeenCalledWith(SUPPORT_CLICK_EVENT, { from: 'desktop-header' });
  });

  it('says its words in a tooltip only while they are not on screen', async () => {
    // Radix positions the tooltip with floating-ui, which needs a ResizeObserver jsdom lacks.
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    renderHeader();
    // jsdom has no matchMedia, so this is the narrow case: focus opens the tooltip.
    fireEvent.focus(desktopLink());
    expect((await screen.findByRole('tooltip')).textContent).toBe(HELP_COVER_LABEL);
    cleanup();

    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(min-width: 1081px)',
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    try {
      renderHeader();
      fireEvent.focus(desktopLink());
      expect(screen.queryByRole('tooltip')).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
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
