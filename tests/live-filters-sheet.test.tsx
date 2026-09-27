// @vitest-environment jsdom
/**
 * The Live tab's phone "Filters" sheet (audit F22/F23). Opening it used to focus the search
 * input — Radix's default is the first tabbable element — which raises the soft keyboard over
 * the filters the visitor opened the sheet to tap, and the input's `text-sm` override made it
 * 14 px on phones, below the 16 px at which iOS Safari zooms the page on focus.
 *
 * Rendered with the real Sheet, the real sidebar and the same `onOpenAutoFocus` handler
 * LiveView passes.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { focusContentOnOpen } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { LiveSidebar } from '../src/app/views/live/LiveSidebar';

const noop = () => {};

function FiltersSheet({ autoFocus }: { autoFocus?: (event: Event) => void }) {
  return (
    <Sheet open>
      <SheetContent side="bottom" onOpenAutoFocus={autoFocus}>
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <LiveSidebar
          flights={[]}
          filtered={[]}
          hubCodes={['ORD', 'DEN']}
          hubFilter=""
          phaseFilter=""
          phaseCounts={{}}
          onHubFilter={noop}
          onPhaseFilter={noop}
          onClearFilters={noop}
          onSelect={noop}
          onGoToSchedule={noop}
        />
      </SheetContent>
    </Sheet>
  );
}

afterEach(cleanup);

describe('Live filters sheet', () => {
  it('without the handler, Radix would focus the search input (the bug being guarded)', () => {
    render(<FiltersSheet />);
    expect(document.activeElement).toBe(screen.getByLabelText('Search the live feed'));
  });

  it('with focusContentOnOpen, focus lands on the sheet itself, not the input', () => {
    render(<FiltersSheet autoFocus={focusContentOnOpen} />);
    const input = screen.getByLabelText('Search the live feed');
    expect(document.activeElement).not.toBe(input);
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('LiveView passes that handler to its mobile SheetContent', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../src/app/views/LiveView.tsx'), 'utf8');
    expect(src).toMatch(/<SheetContent[\s\S]*?onOpenAutoFocus=\{focusContentOnOpen\}/);
  });

  it('the search input is 16px on phones (text-base) and only drops to text-sm at md', () => {
    render(<FiltersSheet autoFocus={focusContentOnOpen} />);
    const classes = screen.getByLabelText('Search the live feed').className.split(/\s+/);
    expect(classes).toContain('text-base');
    expect(classes).toContain('md:text-sm');
    expect(classes).not.toContain('text-sm');
  });
});
