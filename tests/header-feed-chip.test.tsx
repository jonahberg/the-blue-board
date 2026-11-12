// @vitest-environment jsdom
/**
 * The header's feed chip. Until the first poll answers it reads LOADING, quiet and uncoloured: the
 * red NO DATA used to greet every visitor for the second before the feed landed. NO DATA is for a
 * feed that answered (or failed) with nothing; LIVE / STALE key off the age of the newest data.
 * Every state carries a glyph as well as its colour (DESIGN.md: colour is never the only signal).
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';

const feed = vi.hoisted(() => ({
  flights: [] as unknown[],
  freshness: 'stale' as 'live' | 'stale',
  countdown: 30 as number | null,
  failed: false,
  lastGoodTs: null as number | null,
}));
vi.mock('../src/app/state/feed', () => ({ useFeed: () => feed }));
vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ watched: [] }) }));

const { Header } = await import('../src/app/shell/Header');
const { UiProvider } = await import('../src/app/state/ui');
const { PrefsProvider } = await import('../src/app/state/prefs');

function chip(): HTMLElement {
  render(
    <TooltipProvider>
      <UiProvider>
        <PrefsProvider>
          <Header onOpenWatch={() => {}} watchOpen={false} onOpenHelp={() => {}} />
        </PrefsProvider>
      </UiProvider>
    </TooltipProvider>,
  );
  return document.querySelector('header [data-slot="badge"]') as HTMLElement;
}

afterEach(() => {
  cleanup();
  Object.assign(feed, { flights: [], freshness: 'stale', countdown: 30, failed: false, lastGoodTs: null });
});

describe('Header feed chip', () => {
  it('reads LOADING, uncoloured, until the first poll answers', () => {
    const el = chip();
    expect(el.textContent).toContain('LOADING');
    expect(el.textContent).not.toMatch(/NO DATA|LIVE|STALE/);
    expect(el.className).toContain('text-muted-foreground');
    expect(el.className).not.toMatch(/text-destructive|text-bb-ok|text-bb-warn/);
    // A glyph beside the word, hidden from assistive tech.
    const glyph = el.querySelector('[aria-hidden="true"]');
    expect(glyph?.textContent).toBe('○');
    // No flight count while nothing has loaded.
    expect(el.textContent).not.toContain('flights');
  });

  it('reads NO DATA once a poll has failed with nothing to show', () => {
    feed.failed = true;
    const el = chip();
    expect(el.textContent).toContain('NO DATA');
    expect(el.className).toContain('text-destructive');
    expect(el.querySelector('[aria-hidden="true"]')?.textContent).toBe('■');
  });

  it('reads NO DATA when the feed answered with no flights (not LOADING forever)', () => {
    feed.lastGoodTs = Date.now();
    expect(chip().textContent).toContain('NO DATA');
  });

  it('reads LIVE with the flight count once flights arrive', () => {
    Object.assign(feed, { flights: [{}, {}, {}], freshness: 'live', lastGoodTs: Date.now() });
    const el = chip();
    expect(el.textContent).toContain('LIVE');
    expect(el.textContent).toContain('3 flights');
    expect(el.className).toContain('text-bb-ok');
  });

  it('reads STALE when the newest data is old, even with flights on screen', () => {
    Object.assign(feed, { flights: [{}], freshness: 'stale', lastGoodTs: Date.now() - 10 * 60_000 });
    const el = chip();
    expect(el.textContent).toContain('STALE');
    expect(el.className).toContain('text-bb-warn');
    expect(el.querySelector('[aria-hidden="true"]')?.textContent).toBe('▲');
  });
});
