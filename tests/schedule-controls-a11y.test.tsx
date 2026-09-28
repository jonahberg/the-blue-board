// @vitest-environment jsdom
// F39: the Departures/Arrivals switch used Radix Tabs with no TabsContent, so every trigger's
// aria-controls pointed at a panel that never exists (axe aria-valid-attr-value, critical).
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';



import { ScheduleControls } from '@/app/views/schedule/ScheduleControls';
import { EMPTY_FILTERS } from '@/app/views/schedule/useBoardModel';

afterEach(cleanup);

function renderControls(onDir = vi.fn()) {
  render(
    <ScheduleControls
      hub="ORD"
      dir="departures"
      day={0}
      filters={EMPTY_FILTERS}
      aircraftOptions={[]}
      drawerOpen={false}
      desktop
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
});
