// @vitest-environment jsdom
// F39: the Departures/Arrivals switch used Radix Tabs with no TabsContent, so every trigger's
// aria-controls pointed at a panel that never exists (axe aria-valid-attr-value, critical).
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';



import { ScheduleControls } from '@/app/views/schedule/ScheduleControls';
import { EMPTY_FILTERS } from '@/app/views/schedule/useBoardModel';

afterEach(cleanup);

function renderControls(onDir = vi.fn(), { hub = 'ORD', desktop = true }: { hub?: string; desktop?: boolean } = {}) {
  render(
    <ScheduleControls
      hub={hub}
      dir="departures"
      day={0}
      filters={EMPTY_FILTERS}
      aircraftOptions={[]}
      drawerOpen={false}
      desktop={desktop}
      loading={false}
      showJumpToNow
      onHub={vi.fn()}
      onDir={onDir}
      onDay={vi.fn()}
      onFilters={vi.fn()}
      onDrawerOpen={vi.fn()}
      onRefresh={vi.fn()}
      onJumpToNow={vi.fn()}
    />,
  );
  return onDir;
}

describe('ScheduleControls a11y', () => {
  it('every aria-controls resolves to an element in the document', () => {
    const { container } = { container: document.body };
    renderControls();
    const refs = [...container.querySelectorAll('[aria-controls]')];
    for (const el of refs) {
      const id = el.getAttribute('aria-controls')!;
      // The advanced-filters toggle points at the desktop panel, rendered hidden but present.
      expect(document.getElementById(id), `aria-controls="${id}"`).not.toBeNull();
    }
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('switches direction and cannot be toggled to empty', () => {
    const onDir = renderControls();
    const group = screen.getByLabelText('Board direction');
    const arrivals = [...group.querySelectorAll('button')].find((b) => b.textContent === 'Arrivals')!;
    const departures = [...group.querySelectorAll('button')].find((b) => b.textContent === 'Departures')!;
    fireEvent.click(arrivals);
    expect(onDir).toHaveBeenCalledWith('arrivals');
    onDir.mockClear();
    fireEvent.click(departures); // already selected: Radix would emit '' — must be ignored
    expect(onDir).not.toHaveBeenCalled();
  });

  it("'Find in board…' fits its phone-width box (D13)", () => {
    // Live audit Sep 28 2026: at 16px monospace below md the 14-character placeholder was cut
    // off in the 136px box. Monospace glyphs are ~0.6em; the input has ~24px of padding.
    renderControls();
    const input = screen.getByLabelText('Find in board') as HTMLInputElement;
    const classes = input.className.split(/\s+/);
    const phoneWidth = classes.find((c) => /^w-/.test(c))!;
    const rem = phoneWidth === 'w-44' ? 11 : Number((phoneWidth.match(/^w-\[(\d+(?:\.\d+)?)rem\]$/) || [])[1]);
    expect(Number.isFinite(rem)).toBe(true);
    expect(input.placeholder.length * 16 * 0.6 + 24).toBeLessThanOrEqual(rem * 16);
  });
});

describe('the Schedule header\'s one door to the hub guide', () => {
  it('names the hub beside the board selector and goes to its hub page, a plain link that leaves the dashboard', () => {
    renderControls();
    const link = screen.getByRole('link', { name: 'ORD hub guide' });
    expect(link.getAttribute('href')).toBe('/hubs/ord');
    expect(link.getAttribute('target')).toBeNull();
    // Quiet: body colour with an underline, not link colour (one link-coloured link per row).
    const classes = link.className.split(/\s+/);
    expect(classes).not.toContain('text-primary');
    expect(classes).toContain('underline');
    // 44 px on touch, relaxed only for a mouse at md+ (DESIGN.md Responsive).
    expect(classes).toEqual(expect.arrayContaining(['min-h-11', 'pointer-fine:md:min-h-0']));
    // Beside the hub selector, in the same group.
    const select = screen.getByRole('combobox', { name: 'Schedule hub' });
    expect(select.nextElementSibling).toBe(link);
  });

  it('follows the board: DEN links to the DEN guide', () => {
    renderControls(vi.fn(), { hub: 'DEN' });
    expect(screen.getByRole('link', { name: 'DEN hub guide' }).getAttribute('href')).toBe('/hubs/den');
  });

  it('shows no door for "All hubs", and none in the phone toolbar (its rows are full; the stat strip carries it there)', () => {
    renderControls(vi.fn(), { hub: '' });
    expect(screen.queryByRole('link', { name: /hub guide/ })).toBeNull();
    cleanup();
    renderControls(vi.fn(), { desktop: false });
    expect(screen.queryByRole('link', { name: /hub guide/ })).toBeNull();
  });
});
