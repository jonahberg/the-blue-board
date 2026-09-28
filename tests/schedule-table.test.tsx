// @vitest-environment jsdom
// ScheduleTable behaviour: painted row window (F56), empty states (F14), column alignment (F64).
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { ScheduleTable } from '@/app/views/schedule/ScheduleTable';
import type { EmptyReason, ScheduleTableHandle } from '@/app/views/schedule/ScheduleTable';
import type { RowModel } from '@/app/views/schedule/useBoardModel';

afterEach(cleanup);

// jsdom has no layout; the table only needs these to exist.
Element.prototype.scrollIntoView = vi.fn();
globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
  cb(0);
  return 0;
}) as typeof requestAnimationFrame;

function rowModel(i: number): RowModel {
  const ident = `UA${1000 + i}`;
  return {
    ident,
    key: `${ident}-${i}`,
    raw: {},
    timeText: '12:00',
    dateChip: null,
    actualLine: null,
    derivedActual: false,
    routeLine: 'ORD → DEN',
    routeSub: null,
    acCode: 'B738',
    acText: '',
    acShort: '',
    reg: '',
    regFromLive: false,
    gate: '—',
    status: { key: 'scheduled', cls: 'scheduled', text: 'Scheduled', presumed: false, asOf: false, live: false },
    fleet: null,
    swap: null,
    special: null,
    faaContext: null,
    delay: { kind: 'none' },
    watchRoute: 'ORD→DEN',
    effectiveTime: 0,
  } as RowModel;
}

function renderTable({
  rows = Array.from({ length: 640 }, (_, i) => rowModel(i)),
  dividerIndex = 300,
  emptyReason = 'filtered' as EmptyReason,
  onClearFilters = vi.fn(),
} = {}) {
  const ref = createRef<ScheduleTableHandle>();
  render(
    <TooltipProvider>
      <ScheduleTable
        ref={ref}
        rows={rows}
        dividerIndex={dividerIndex}
        dividerLabel="20:52 PDT"
        firstFutureIndex={dividerIndex}
        sort={{ column: 'time', asc: true }}
        onSort={vi.fn()}
        isWatched={() => false}
        onToggleWatch={vi.fn()}
        onOpenAircraft={vi.fn()}
        onExplainDelay={vi.fn()}
        boardAsOf="9:17 PM CDT"
        windowKey="ORD:departures:0"
        emptyReason={emptyReason}
        emptySubject="EWR arrivals for tomorrow (Mon, Sep 28)"
        onClearFilters={onClearFilters}
      />
    </TooltipProvider>,
  );
  return ref;
}

const paintedFlights = () => document.querySelectorAll('[data-flight-row]').length;

describe('ScheduleTable row window (F56)', () => {
  it('paints a bounded window around NOW instead of all 640 rows', () => {
    renderTable();
    expect(paintedFlights()).toBe(150);
    expect(document.querySelector('[data-row-index="300"]')).not.toBeNull();
    expect(screen.getByText('── NOW · 20:52 PDT ──')).toBeTruthy();
  });

  it('shows earlier / later / all on request', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: /Show earlier flights \(270\)/ }));
    expect(paintedFlights()).toBe(300);
    fireEvent.click(screen.getByRole('button', { name: /Show later flights/ }));
    expect(paintedFlights()).toBe(450);
    fireEvent.click(screen.getAllByRole('button', { name: 'Show all 640' })[0]);
    expect(paintedFlights()).toBe(640);
    expect(screen.queryByRole('button', { name: /Show (earlier|later) flights/ })).toBeNull();
  });

  it('reveals a searched-for flight outside the window', () => {
    const ref = renderTable();
    expect(document.querySelector('[data-flight-row="UA1005"]')).toBeNull();
    let found = false;
    act(() => {
      found = ref.current!.revealFlight('UA1005');
    });
    expect(found).toBe(true);
    expect(document.querySelector('[data-flight-row="UA1005"]')).not.toBeNull();
    expect(ref.current!.revealFlight('UA9999')).toBe(false);
  });

  it('paints a small board in full with no window controls', () => {
    renderTable({ rows: Array.from({ length: 40 }, (_, i) => rowModel(i)), dividerIndex: 10 });
    expect(paintedFlights()).toBe(40);
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });
});

describe('ScheduleTable empty states (F14)', () => {
  it('filters hid every row: says so and offers to clear them', () => {
    const onClearFilters = vi.fn();
    renderTable({ rows: [], emptyReason: 'filtered', onClearFilters });
    expect(screen.getByText('No flights match your filters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClearFilters).toHaveBeenCalled();
  });

  it('the provider failed (partial, first_page_failed): blames the provider, not the filters', () => {
    renderTable({ rows: [], emptyReason: 'upstream' });
    expect(screen.getByText(/Couldn't load EWR arrivals for tomorrow/)).toBeTruthy();
    expect(screen.queryByText('No flights match your filters')).toBeNull();
  });

  it('nothing published yet: says the board is not listed yet', () => {
    renderTable({ rows: [], emptyReason: 'none' });
    expect(screen.getByText(/No United flights listed for EWR arrivals for tomorrow/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });
});

describe('ScheduleTable columns (F64)', () => {
  it('right-aligns the Delay / Risk header over its right-aligned values and caps Status', () => {
    renderTable({ rows: [rowModel(0)], dividerIndex: -1 });
    const headers = [...document.querySelectorAll('th')];
    const delay = headers.find((th) => th.textContent === 'Delay / Risk')!;
    expect(delay.className).toMatch(/\btext-right\b/);
    expect(delay.className).not.toMatch(/\btext-left\b/);
    const status = headers.find((th) => th.textContent?.startsWith('Status'))!;
    expect(status.className).toMatch(/w-\[9rem\]/);
  });
});
