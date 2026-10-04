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

function rowModel(i: number, patch: Partial<RowModel> = {}): RowModel {
  const ident = patch.ident ?? `UA${1000 + i}`;
  return {
    ident,
    identDisplay: ident,
    key: `${ident}-${i}`,
    raw: {},
    timeText: '12:00',
    dateChip: null,
    actualLine: null,
    derivedActual: false,
    actualFromRunway: false,
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
    ...patch,
  } as RowModel;
}

function renderTable({
  rows = Array.from({ length: 640 }, (_, i) => rowModel(i)),
  dividerIndex = 300,
  emptyReason = 'filtered' as EmptyReason,
  onClearFilters = vi.fn(),
  onToggleWatch = vi.fn(),
  dir = 'departures' as 'departures' | 'arrivals',
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
        onToggleWatch={onToggleWatch}
        onOpenAircraft={vi.fn()}
        onExplainDelay={vi.fn()}
        boardAsOf="9:17 PM CDT"
        windowKey="ORD:departures:0"
        dir={dir}
        emptyReason={emptyReason}
        emptySubject="tomorrow's EWR arrivals (Mon, Sep 28)"
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
    expect(screen.getAllByRole('button', { name: 'Show all 640' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 640' }));
    expect(paintedFlights()).toBe(640);
    expect(screen.queryByRole('button', { name: /Show (earlier|later) flights/ })).toBeNull();
    // Paints all 640 rows in jsdom (~0.6s alone); with the whole suite sharing the CPU under
    // --sequence.shuffle it measured 6-7s, past the 5s default.
  }, 20_000);

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
    expect(screen.getByText(/Couldn't load tomorrow's EWR arrivals/)).toBeTruthy();
    expect(screen.queryByText('No flights match your filters')).toBeNull();
  });

  it('nothing published yet: says the board is not listed yet', () => {
    renderTable({ rows: [], emptyReason: 'none' });
    expect(screen.getByText(/No United flights listed for tomorrow's EWR arrivals/)).toBeTruthy();
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

describe('ScheduleTable evidence markers (v1.13.0)', () => {
  it('prints the flight number without the provider suffix; the row and the watch keep the raw one', () => {
    const onToggleWatch = vi.fn();
    const row = rowModel(0, { ident: 'UA526H', identDisplay: 'UA526' });
    renderTable({ rows: [row], dividerIndex: -1, onToggleWatch });
    const tr = document.querySelector('[data-flight-row]')!;
    expect(tr.getAttribute('data-flight-row')).toBe('UA526H');
    expect(tr.textContent).toContain('UA526');
    expect(tr.textContent).not.toContain('UA526H');
    fireEvent.click(screen.getByRole('button', { name: 'Watch UA526' }));
    expect(onToggleWatch.mock.calls[0][0].ident).toBe('UA526H');
  });

  it('a landing the live feed proved: Landed* with "seen landing", never "presumed (no live update)"', () => {
    renderTable({
      rows: [
        rowModel(0, {
          status: { key: 'landed', cls: 'landed', text: 'Landed', presumed: true, asOf: false, live: false, seenLanded: true },
        }),
      ],
      dividerIndex: -1,
    });
    const tr = document.querySelector('[data-flight-row]')!;
    expect(tr.textContent).toContain('Landed*');
    expect(tr.textContent).toContain('seen landing on the live feed');
    expect(tr.textContent).not.toMatch(/no live update/);
    expect(screen.getByText('seen landing').getAttribute('title')).toMatch(/on the ground at the destination/);
  });

  it('a plain presumed row still says presumed (no live update)', () => {
    renderTable({
      rows: [
        rowModel(0, {
          status: { key: 'landed', cls: 'landed', text: 'Landed', presumed: true, asOf: false, live: false },
        }),
      ],
      dividerIndex: -1,
    });
    expect(screen.getByText('presumed (no live update)')).toBeTruthy();
  });

  it('a wheels-up delay gets a marker and words; a floor reads ≥ with "at least"', () => {
    renderTable({
      rows: [
        rowModel(0, {
          actualFromRunway: true,
          delay: { kind: 'delta', text: '+38m', minutes: 38, title: 'Wheels-up vs scheduled departure', basis: 'runway' },
        }),
        rowModel(1, {
          delay: { kind: 'delta', text: '≥+66m', minutes: 66, title: 'At least this late', basis: 'sighting', bound: 'lower' },
        }),
      ],
      dividerIndex: -1,
    });
    const runway = screen.getByText('+38m').closest('[title]')!;
    expect(runway.textContent).toContain('(from takeoff time; includes taxi)');
    expect(runway.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    const floor = screen.getByText('+66m').closest('[title]')!;
    expect(floor.textContent).toMatch(/≥\s*at least \+66m/);
    expect(floor.className).toMatch(/\bwhitespace-nowrap\b/);
    expect(floor.querySelector('svg')).toBeNull();
  });

  it('on an arrivals board a runway delay is a touchdown', () => {
    renderTable({
      rows: [
        rowModel(0, {
          actualFromRunway: true,
          delay: { kind: 'delta', text: '+12m', minutes: 12, title: 'Touchdown vs scheduled arrival', basis: 'runway' },
        }),
      ],
      dividerIndex: -1,
      dir: 'arrivals',
    });
    expect(screen.getByText('+12m').closest('[title]')!.textContent).toContain('(from touchdown time; before taxi-in)');
  });
});
