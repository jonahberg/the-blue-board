// @vitest-environment jsdom
// The phone board (audit Oct 3 2026): below `md` the schedule paints a two-line list instead
// of a 1,065 px table whose status, tail and watch columns sat off-screen.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';

import { TooltipProvider } from '@/components/ui/tooltip';
import { ScheduleTable } from '@/app/views/schedule/ScheduleTable';
import type { ScheduleTableHandle } from '@/app/views/schedule/ScheduleTable';
import { SchedulePhoneRow } from '@/app/views/schedule/SchedulePhoneRow';
import type { RowModel } from '@/app/views/schedule/useBoardModel';

afterEach(cleanup);

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
    timeText: '18:48',
    dateChip: null,
    actualLine: null,
    derivedActual: false,
    actualFromRunway: false,
    routeLine: 'ROC → ORD',
    routeSub: 'Rochester',
    acCode: 'B753',
    acText: 'Boeing 757-300',
    acShort: '757-300',
    reg: 'N57868',
    regFromLive: false,
    gate: 'T1',
    status: { key: 'scheduled', cls: 'scheduled', text: 'Scheduled', presumed: false, asOf: false, live: false },
    fleet: { badge: '24F/54E+/156Y', starlink: false, enrich: '24F/54E+/156Y · ViaSat Ka · AVOD · Del 2001', source: 'fleet' },
    swap: null,
    special: null,
    faaContext: null,
    delay: { kind: 'none' },
    watchRoute: 'ROC→ORD',
    effectiveTime: 0,
    ...patch,
  } as RowModel;
}

const departedLate = rowModel(59, {
  ident: 'UA2059',
  actualLine: { text: '→ 22:16 (+208m)', early: false },
  status: { key: 'departed', cls: 'departed', text: 'Departed', presumed: false, asOf: false, live: true },
  delay: { kind: 'delta', text: '+208m', minutes: 208, title: 'Actual departure 208 min after schedule' },
});

function renderRow(row: RowModel, overrides: Partial<Parameters<typeof SchedulePhoneRow>[0]> = {}) {
  const props = {
    row,
    index: 0,
    watched: false,
    boardAsOf: '7:33 PM CDT',
    onOpenFlight: vi.fn(),
    onToggleWatch: vi.fn(),
    onExplainDelay: vi.fn(),
    ...overrides,
  };
  render(
    <ol>
      <SchedulePhoneRow {...props} />
    </ol>,
  );
  return props;
}

describe('SchedulePhoneRow', () => {
  it('line 1 carries time, flight, route, status pill with LIVE, and the delay', () => {
    renderRow(departedLate);
    const item = screen.getByRole('listitem');
    expect(item.getAttribute('data-flight-row')).toBe('UA2059');
    expect(within(item).getByText('18:48')).toBeTruthy();
    // The changed time under it, without repeating the minutes the delay already shows.
    expect(item.textContent).toContain('→22:16');
    expect(item.textContent).not.toContain('(+208m)');
    expect(within(item).getByText('ROC → ORD')).toBeTruthy();
    const pill = within(item).getByText('Departed');
    expect(pill.className).toMatch(/\bborder-bb-ok\/40\b/);
    expect(within(item).getByText('LIVE')).toBeTruthy();
    const delay = within(item).getByText('+208m').closest('[title]')!;
    expect(delay.className).toMatch(/\btext-destructive\b/);
    expect(delay.className).toMatch(/\bwhitespace-nowrap\b/);
  });

  it('line 2 is tail · type · seats · Wi-Fi', () => {
    renderRow(departedLate);
    const item = screen.getByRole('listitem');
    for (const text of ['N57868', '757-300', '24F/54E+/156Y', 'ViaSat Ka']) {
      expect(within(item).getByText(text)).toBeTruthy();
    }
    // The IFE code and the delivery year are desktop detail, not phone line 2.
    expect(item.textContent).not.toContain('AVOD');
    expect(item.textContent).not.toContain('Del 2001');
  });

  it('badges Starlink instead of printing a Wi-Fi string', () => {
    renderRow(
      rowModel(1, {
        fleet: {
          badge: '20F/45E+/114Y',
          starlink: true,
          enrich: '20F/45E+/114Y · Starlink · ⚡ Starlink · AVOD · Del 2009',
          source: 'fleet',
        },
      }),
    );
    const item = screen.getByRole('listitem');
    const starlink = within(item).getByText('Starlink');
    expect(starlink.className).toMatch(/\btext-bb-starlink\b/);
    expect(within(item).getAllByText(/Starlink/)).toHaveLength(1);
  });

  it('the watch eye is a 44px toggle named for its flight', () => {
    const props = renderRow(departedLate, { watched: true });
    const eye = screen.getByRole('button', { name: 'Watch UA2059' });
    expect(eye.getAttribute('aria-pressed')).toBe('true');
    expect(eye.className).toMatch(/\bsize-11\b/);
    expect(eye.className).not.toMatch(/pointer-fine:md:size-7/);
    fireEvent.click(eye);
    expect(props.onToggleWatch).toHaveBeenCalledWith(departedLate);
    expect(props.onOpenFlight).not.toHaveBeenCalled();
  });

  it('a tap on the row opens the flight sheet through a named, stretched button', () => {
    const props = renderRow(departedLate);
    const open = screen.getByRole('button', { name: 'UA2059 flight details' });
    expect(open.className).toMatch(/after:absolute/);
    expect(open.className).toMatch(/after:inset-0/);
    fireEvent.click(open);
    expect(props.onOpenFlight).toHaveBeenCalledWith(departedLate);
  });

  it('a prediction reads RISK and opens the delay explanation, not the sheet', () => {
    const context = { flight: 'UA1002' };
    const props = renderRow(
      rowModel(2, {
        delay: {
          kind: 'risk',
          risk: { score: 70, label: 'HIGH', color: 'red', factors: [], components: [] },
          context,
        },
      }),
    );
    const risk = screen.getByRole('button', { name: /RISK: HIGH/ });
    fireEvent.click(risk);
    expect(props.onExplainDelay).toHaveBeenCalledWith(context);
    expect(props.onOpenFlight).not.toHaveBeenCalled();
  });

  it('spells out a presumed status for assistive tech, not just an asterisk', () => {
    renderRow(
      rowModel(3, {
        status: { key: 'departed', cls: 'departed', text: 'Departed', presumed: true, asOf: false, live: false },
      }),
    );
    expect(screen.getByRole('listitem').textContent).toContain('Departed*');
    expect(screen.getByText(/presumed — no live update/)).toBeTruthy();
  });

  it('prints the flight number without the provider suffix, but watches and opens the raw one', () => {
    const suffixed = rowModel(5, { ident: 'UA526H', identDisplay: 'UA526' });
    const props = renderRow(suffixed);
    const item = screen.getByRole('listitem');
    expect(item.getAttribute('data-flight-row')).toBe('UA526H');
    expect(item.textContent).not.toContain('UA526H');
    fireEvent.click(screen.getByRole('button', { name: 'UA526 flight details' }));
    expect(props.onOpenFlight).toHaveBeenCalledWith(suffixed);
    fireEvent.click(screen.getByRole('button', { name: 'Watch UA526' }));
    expect(props.onToggleWatch).toHaveBeenCalledWith(suffixed);
    expect((vi.mocked(props.onToggleWatch).mock.calls[0][0] as RowModel).ident).toBe('UA526H');
  });

  it('a landing the live feed proved reads Landed* and says so, not "no live update"', () => {
    renderRow(
      rowModel(6, {
        status: { key: 'landed', cls: 'landed', text: 'Landed', presumed: true, asOf: false, live: false, seenLanded: true },
      }),
    );
    const item = screen.getByRole('listitem');
    expect(item.textContent).toContain('Landed*');
    expect(screen.getByText(/seen landing on the live feed/)).toBeTruthy();
    expect(item.textContent).not.toMatch(/no live update/);
  });

  it('a wheels-up delay carries a marker with words for it', () => {
    renderRow(
      rowModel(7, {
        actualFromRunway: true,
        delay: {
          kind: 'delta',
          text: '+38m',
          minutes: 38,
          title: 'Wheels-up vs scheduled departure — includes taxi-out (the provider sent no separate gate time)',
          basis: 'runway',
        },
      }),
    );
    const figure = screen.getByText('+38m').closest('[title]')!;
    expect(figure.getAttribute('title')).toMatch(/Wheels-up/);
    expect(figure.textContent).toContain('(from takeoff time; includes taxi)');
    expect(figure.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('a touchdown delay on an arrivals board says so', () => {
    renderRow(
      rowModel(8, {
        actualFromRunway: true,
        delay: { kind: 'delta', text: '+12m', minutes: 12, title: 'Touchdown vs scheduled arrival', basis: 'runway' },
      }),
      { dir: 'arrivals' },
    );
    expect(screen.getByText('+12m').closest('[title]')!.textContent).toContain('(from touchdown time; before taxi-in)');
  });

  it('a floor reads ≥ on screen and "at least" to a screen reader', () => {
    renderRow(
      rowModel(9, {
        status: { key: 'landed', cls: 'landed', text: 'Landed', presumed: true, asOf: false, live: false, seenLanded: true },
        delay: { kind: 'delta', text: '≥+66m', minutes: 66, title: 'Landed — at least this late', basis: 'sighting', bound: 'lower' },
      }),
    );
    const figure = screen.getByText('+66m').closest('[title]')!;
    expect(figure.textContent).toContain('≥');
    expect(figure.textContent).toContain('at least');
    // The glyph itself is hidden from assistive tech: the words replace it.
    expect([...figure.querySelectorAll('[aria-hidden="true"]')].map((n) => n.textContent?.trim())).toContain('≥');
    // No runway marker on a sighting-based floor.
    expect(figure.querySelector('svg')).toBeNull();
  });

  it('an Express tail the Starlink roster knows shows the Starlink badge on line 2', () => {
    renderRow(
      rowModel(10, {
        reg: 'N140SY',
        acCode: 'E75L',
        acShort: 'E175',
        fleet: { badge: 'Starlink', starlink: true, enrich: '⚡ Starlink', source: 'starlink-roster' },
      }),
    );
    const item = screen.getByRole('listitem');
    expect(within(item).getByText('N140SY')).toBeTruthy();
    expect(within(item).getByText('E175')).toBeTruthy();
    const starlink = within(item).getByText('Starlink');
    expect(starlink.className).toMatch(/\btext-bb-starlink\b/);
    expect(within(item).getAllByText(/Starlink/)).toHaveLength(1);
  });

  it('shows a swap with its direction in words', () => {
    renderRow(
      rowModel(4, {
        swap: { oldType: 'B739', newType: 'B738', reg: 'N12345', impacts: [], tone: 'downgrade' },
      }),
    );
    expect(screen.getByText('B739 → B738 · downgrade')).toBeTruthy();
  });
});

function renderBoard(rows: RowModel[], dividerIndex: number) {
  const ref = createRef<ScheduleTableHandle>();
  const onOpenFlight = vi.fn();
  render(
    <TooltipProvider>
      <ScheduleTable
        ref={ref}
        compact
        onOpenFlight={onOpenFlight}
        rows={rows}
        dividerIndex={dividerIndex}
        dividerLabel="20:52 CDT"
        firstFutureIndex={dividerIndex}
        sort={{ column: 'time', asc: true }}
        onSort={vi.fn()}
        isWatched={() => false}
        onToggleWatch={vi.fn()}
        onOpenAircraft={vi.fn()}
        onExplainDelay={vi.fn()}
        boardAsOf="9:17 PM CDT"
        windowKey="ORD:departures:0"
        emptyReason="filtered"
        emptySubject="today's ORD departures"
        onClearFilters={vi.fn()}
      />
    </TooltipProvider>,
  );
  return { ref, onOpenFlight };
}

describe('ScheduleTable compact (phone) mode', () => {
  it('paints a list, not a table, and keeps the same painted window around NOW', () => {
    renderBoard(Array.from({ length: 640 }, (_, i) => rowModel(i)), 300);
    expect(document.querySelector('table')).toBeNull();
    const list = screen.getByRole('list', { name: 'Flights' });
    expect(list.tagName).toBe('OL');
    expect(document.querySelectorAll('[data-flight-row]')).toHaveLength(150);
    expect(document.querySelector('[data-row-index="300"]')).not.toBeNull();
    expect(screen.getByText('── NOW · 20:52 CDT ──')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Show earlier flights \(270\)/ }));
    expect(document.querySelectorAll('[data-flight-row]')).toHaveLength(300);
  });

  it('the palette can still reveal a row outside the window', () => {
    const { ref } = renderBoard(Array.from({ length: 640 }, (_, i) => rowModel(i)), 300);
    expect(document.querySelector('[data-flight-row="UA1005"]')).toBeNull();
    act(() => {
      ref.current!.revealFlight('UA1005');
    });
    expect(document.querySelector('[data-flight-row="UA1005"]')).not.toBeNull();
  });

  it('a row tap reaches the board owner with that row', () => {
    const rows = [rowModel(0), departedLate];
    const { onOpenFlight } = renderBoard(rows, -1);
    fireEvent.click(screen.getByRole('button', { name: 'UA2059 flight details' }));
    expect(onOpenFlight).toHaveBeenCalledWith(departedLate);
  });

  it('keeps the filtered empty state', () => {
    renderBoard([], -1);
    expect(screen.getByText('No flights match your filters')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeTruthy();
  });
});
