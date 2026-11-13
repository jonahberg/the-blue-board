// @vitest-environment jsdom
/**
 * Links everywhere, part 2: every name a Schedule row prints that has a home links to it, on the
 * desktop table and on the phone row (the links plan, slice 2a).
 *
 *  - the other end of the route, when it is another hub → its Schedule board (quiet); the board's
 *    own hub is plain (ruling 1);
 *  - the tail and a swap's tail → the aircraft dialog, a real `<a href="/?aircraft=…">` followed in
 *    place (quiet; the flight number is the row's one blue link);
 *  - the type → the Fleet tab filtered to the type the TAIL has (ruling 5), else plain;
 *  - each airport code in the FAA line → its Weather card (a hub) or the NAS panel (any other);
 *  - the ⚡ Starlink mark → the Starlink tab, once per row;
 *  - on the phone row, every one of those takes no taps on a coarse pointer (`finePointerOnly`,
 *    ruling 3): the row is one tap target and only the flight number sits above it.
 *
 * Mounted in the real UiProvider, ScheduleProvider and FollowProvider (as tests/starlink-panels
 * does), so a click is followed in place through the dashboard's own state.
 */

import { act, cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import { SchedulePhoneRow } from '../src/app/views/schedule/SchedulePhoneRow';
import { ScheduleStats } from '../src/app/views/schedule/ScheduleStats';
import { ScheduleTable } from '../src/app/views/schedule/ScheduleTable';
import type { ScheduleTableHandle } from '../src/app/views/schedule/ScheduleTable';
import type { RowModel } from '../src/app/views/schedule/useBoardModel';
import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';

vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ watched: [] }) }));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));

Element.prototype.scrollIntoView = vi.fn();
globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
  cb(0);
  return 0;
}) as typeof requestAnimationFrame;

let ui: UiValue | null = null;
function Probe() {
  ui = useUi();
  return null;
}

function mount(node: ReactNode) {
  return render(
    <UiProvider>
      <ScheduleProvider defaultHub="ORD">
        <FollowProvider>
          <TooltipProvider>{node}</TooltipProvider>
          <Probe />
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
}

/** A row as `buildScheduleRow` shapes it: ORD → DEN on N37502, a Starlink 737 MAX 9, with an FAA line. */
function linkedRow(patch: Partial<RowModel> = {}): RowModel {
  return {
    ident: 'UA576',
    identDisplay: 'UA576',
    key: 'UA576-1',
    raw: {},
    timeText: '12:00',
    dateChip: null,
    actualLine: null,
    derivedActual: false,
    actualFromRunway: false,
    routeLine: 'ORD → DEN',
    routeSub: 'Denver',
    routeEnds: { from: { text: 'ORD', hub: null }, to: { text: 'DEN', hub: 'DEN' } },
    acCode: 'B39M',
    acText: 'Boeing 737 MAX 9',
    acShort: '737 MAX 9',
    typeCode: '737 MAX 9',
    reg: 'N37502',
    regFromLive: false,
    gate: 'T1 · C18',
    status: { key: 'delayed', cls: 'delayed', text: 'Delayed', presumed: false, asOf: false, live: false },
    fleet: { badge: '20F/159Y', starlink: true, enrich: '20F/159Y · Starlink · ⚡ Starlink · AVOD', source: 'fleet' },
    starlinkHref: '/#starlink',
    swap: null,
    special: null,
    faaContext: 'Ground Stop at EWR, avg 45 min · GDP at LGA',
    faaParts: [
      { lead: 'Ground Stop at ', code: 'EWR', tail: ', avg 45 min', kind: 'weather' },
      { lead: 'GDP at ', code: 'LGA', tail: '', kind: 'nas' },
    ],
    delay: { kind: 'none' },
    watchRoute: 'ORD→DEN',
    effectiveTime: 0,
    ...patch,
  } as RowModel;
}

function renderTable(rows: RowModel[], compact = false) {
  const ref = createRef<ScheduleTableHandle>();
  return mount(
    <ScheduleTable
      ref={ref}
      rows={rows}
      dividerIndex={-1}
      dividerLabel=""
      firstFutureIndex={-1}
      sort={{ column: 'time', asc: true }}
      onSort={vi.fn()}
      isWatched={() => false}
      onToggleWatch={vi.fn()}
      onExplainDelay={vi.fn()}
      boardAsOf="9:17 PM CDT"
      windowKey="ORD:departures:0"
      emptyReason="filtered"
      emptySubject="today's ORD departures"
      onClearFilters={vi.fn()}
      compact={compact}
      onOpenFlight={vi.fn()}
    />,
  );
}

const hrefs = (scope: HTMLElement) => [...scope.querySelectorAll('a')].map((a) => a.getAttribute('href'));
const linkNamed = (scope: HTMLElement, text: string) =>
  [...scope.querySelectorAll('a')].find((a) => a.textContent?.trim() === text) ?? null;
/** True when `text` is printed in `scope` and never inside a link. */
function plain(scope: HTMLElement, text: string) {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const hits: Node[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue?.includes(text)) hits.push(node);
  }
  return hits.length > 0 && hits.every((node) => !node.parentElement?.closest('a'));
}

beforeEach(() => {
  window.history.replaceState(null, '', '/#schedule');
});
afterEach(() => {
  cleanup();
  ui = null;
});

describe('the desktop Schedule row links what it names', () => {
  it('links the flight, the other hub, the tail, the type, the FAA codes and Starlink, once each', () => {
    renderTable([linkedRow()]);
    const row = document.querySelector<HTMLElement>('[data-flight-row="UA576"]')!;
    expect(hrefs(row)).toEqual([
      '/flight/UA576',
      '/?tab=schedule&hub=DEN',
      '/?tab=fleet&type=737%20MAX%209',
      '/?aircraft=N37502',
      '/#starlink',
      '/?tab=weather&hub=EWR',
      '/?tab=weather&section=nas',
    ]);
    // The board's own hub prints plain (ruling 1).
    expect(plain(row, 'ORD')).toBe(true);
  });

  it('paints only the flight number in link colour; every other link is quiet', () => {
    renderTable([linkedRow()]);
    const row = document.querySelector<HTMLElement>('[data-flight-row="UA576"]')!;
    const blue = [...row.querySelectorAll('a')].filter((a) => a.className.split(/\s+/).includes('text-primary'));
    expect(blue.map((a) => a.textContent)).toEqual(['UA576']);
  });

  it('the Fleet cell repeats Starlink plain: one Starlink link per row', () => {
    renderTable([linkedRow()]);
    const row = document.querySelector<HTMLElement>('[data-flight-row="UA576"]')!;
    expect(row.querySelectorAll('a[href="/#starlink"]')).toHaveLength(1);
    expect(row.querySelector('a[href="/#starlink"]')!.closest('td')).toBe(linkNamed(row, 'N37502')!.closest('td'));
  });

  it('the Starlink link never sits in a truncating line: an Express line ends in it, and a clip would hide it', () => {
    renderTable([
      linkedRow({ fleet: { badge: 'E175', starlink: true, enrich: 'E175 · SkyWest Airlines · ⚡ Starlink', source: 'express' } }),
    ]);
    const link = document.querySelector<HTMLElement>('a[href="/#starlink"]')!;
    expect(link.textContent).toBe('Starlink');
    expect(link.closest('.truncate')).toBeNull();
    // The words before it still print, and they are what truncates.
    expect(link.closest('[title]')!.textContent).toBe('E175 · SkyWest Airlines · Starlink');
  });

  it('a Starlink link after words on its line takes a touch box, not height: the row does not grow on a tablet', () => {
    renderTable([linkedRow()]);
    const classes = document.querySelector<HTMLElement>('a[href="/#starlink"]')!.className.split(/\s+/);
    // `box`: an after: box over the line, the element its text's height.
    expect(classes).toContain('after:h-11');
    expect(classes).not.toContain('min-h-11');
  });

  it("a Starlink link that opens its line (a roster-only tail) is a 44 px element, as its box would cover the tail's", () => {
    renderTable([linkedRow({ fleet: { badge: 'Starlink', starlink: true, enrich: '⚡ Starlink', source: 'starlink-roster' } })]);
    const classes = document.querySelector<HTMLElement>('a[href="/#starlink"]')!.className.split(/\s+/);
    expect(classes).toContain('min-h-11');
    expect(classes).not.toContain('after:h-11');
  });

  it('a type the tail does not decide, a non-hub end and a row with no Starlink stay plain', () => {
    renderTable([
      linkedRow({
        routeLine: 'ORD → KEF',
        routeEnds: { from: { text: 'ORD', hub: null }, to: { text: 'KEF', hub: null } },
        typeCode: null,
        acCode: 'A319',
        reg: '',
        fleet: null,
        starlinkHref: null,
        faaContext: null,
        faaParts: [],
      }),
    ]);
    const row = document.querySelector<HTMLElement>('[data-flight-row="UA576"]')!;
    expect(hrefs(row)).toEqual(['/flight/UA576']);
    expect(plain(row, 'KEF')).toBe(true);
    expect(plain(row, 'A319')).toBe(true);
  });

  it('a tail from live tracking is a quiet link like any other, its explanation still there', () => {
    renderTable([linkedRow({ regFromLive: true })]);
    const tail = linkNamed(document.body, 'N37502')!;
    expect(tail.className).not.toMatch(/decoration-dotted/);
    expect(tail.className).not.toMatch(/(^|\s)text-primary(\s|$)/);
    expect(screen.getByText(/tail from live flight tracking/i)).toBeTruthy();
  });

  it("a swap's tail is a link to its aircraft dialog; the swap's type names stay plain", () => {
    renderTable([
      linkedRow({
        swap: { oldType: '737-900', newType: '737-800', reg: 'N12345', impacts: [], tone: 'downgrade' },
      }),
    ]);
    const row = document.querySelector<HTMLElement>('[data-flight-row="UA576"]')!;
    expect(linkNamed(row, 'N12345')?.getAttribute('href')).toBe('/?aircraft=N12345');
    expect(plain(row, '737-900')).toBe(true);
    expect(plain(row, '737-800')).toBe(true);
  });

  it('a tail followed in place opens the aircraft dialog, no reload', () => {
    renderTable([linkedRow()]);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    act(() => {
      linkNamed(document.body, 'N37502')!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(ui!.aircraftReg).toBe('N37502');
  });

  it('the NOW divider is not painted in link colour', () => {
    const ref = createRef<ScheduleTableHandle>();
    mount(
      <ScheduleTable
        ref={ref}
        rows={[linkedRow(), linkedRow({ ident: 'UA577', identDisplay: 'UA577', key: 'UA577-2' })]}
        dividerIndex={1}
        dividerLabel="12:30 CST"
        firstFutureIndex={1}
        sort={{ column: 'time', asc: true }}
        onSort={vi.fn()}
        isWatched={() => false}
        onToggleWatch={vi.fn()}
        onExplainDelay={vi.fn()}
        boardAsOf=""
        windowKey="k"
        emptyReason="filtered"
        emptySubject=""
        onClearFilters={vi.fn()}
      />,
    );
    expect(screen.getByText('── NOW · 12:30 CST ──').className).not.toMatch(/(^|\s)text-primary(\s|$)/);
  });
});

describe('the phone Schedule row: the same links, inert on a coarse pointer', () => {
  function renderPhone(row: RowModel) {
    return mount(
      <ol>
        <SchedulePhoneRow
          row={row}
          index={0}
          watched={false}
          boardAsOf=""
          onOpenFlight={vi.fn()}
          onToggleWatch={vi.fn()}
          onExplainDelay={vi.fn()}
        />
      </ol>,
    );
  }

  it('links the other hub, the tail, the type, the FAA codes and Starlink', () => {
    renderPhone(linkedRow());
    const row = document.querySelector<HTMLElement>('[data-flight-row="UA576"]')!;
    expect(hrefs(row).sort()).toEqual(
      [
        '/flight/UA576',
        '/?tab=schedule&hub=DEN',
        '/?aircraft=N37502',
        '/?tab=fleet&type=737%20MAX%209',
        '/#starlink',
        '/?tab=weather&hub=EWR',
        '/?tab=weather&section=nas',
      ].sort(),
    );
    expect(plain(row, 'ORD')).toBe(true);
  });

  it('every link but the flight number takes no taps on a coarse pointer and sits above the row button', () => {
    renderPhone(linkedRow());
    const row = document.querySelector<HTMLElement>('[data-flight-row="UA576"]')!;
    const secondary = [...row.querySelectorAll('a')].filter((a) => a.getAttribute('href') !== '/flight/UA576');
    // DEN, the tail, the type, Starlink and the two FAA codes.
    expect(secondary).toHaveLength(6);
    for (const a of secondary) {
      const classes = a.className.split(/\s+/);
      expect(classes, a.getAttribute('href')!).toContain('pointer-coarse:pointer-events-none');
      expect(classes, a.getAttribute('href')!).toContain('pointer-coarse:no-underline');
      expect(classes, a.getAttribute('href')!).toContain('z-10');
      // No touch box: a link that takes no taps needs none, and it would cover the number beside it.
      expect(a.className, a.getAttribute('href')!).not.toMatch(/after:h-11/);
    }
  });

  it('the tail has lost its dotted underline; a live-tracking tail still says so', () => {
    renderPhone(linkedRow({ regFromLive: true }));
    const tail = linkNamed(document.body, 'N37502')!;
    expect(tail.className).not.toMatch(/decoration-dotted/);
    expect(screen.getByText(/tail from live flight tracking/i)).toBeTruthy();
  });

  it('the NOW divider of the phone list is not painted in link colour', () => {
    const ref = createRef<ScheduleTableHandle>();
    mount(
      <ScheduleTable
        ref={ref}
        rows={[linkedRow(), linkedRow({ ident: 'UA577', identDisplay: 'UA577', key: 'UA577-2' })]}
        dividerIndex={1}
        dividerLabel="12:30 CST"
        firstFutureIndex={1}
        sort={{ column: 'time', asc: true }}
        onSort={vi.fn()}
        isWatched={() => false}
        onToggleWatch={vi.fn()}
        onExplainDelay={vi.fn()}
        boardAsOf=""
        windowKey="k"
        emptyReason="filtered"
        emptySubject=""
        onClearFilters={vi.fn()}
        compact
        onOpenFlight={vi.fn()}
      />,
    );
    expect(screen.getByText('── NOW · 12:30 CST ──').className).not.toMatch(/(^|\s)text-primary(\s|$)/);
  });
});

describe("the stat strip's FAA note links the board's hub to its Weather card", () => {
  const stats = {
    total: 3, onTime: 1, late: 0, untimed: 0, inAir: 0, upcoming: 1, canceled: 1, canceledUncertain: 0,
    canceledConfirmed: 1, presumed: 0, operated: 1, otp: 100, uncategorized: 0,
  };

  it.each([false, true])('compact %s: "ORD under FAA delay program", ORD a quiet link to /?tab=weather&hub=ORD', (compact) => {
    mount(<ScheduleStats stats={stats} dir="departures" dayLabel="Thu, Nov 12" hub="ORD" hubDisruptionMinutes={75} compact={compact} />);
    const link = document.querySelector<HTMLAnchorElement>('a[data-hub-status-link="ORD"]')!;
    expect(link.getAttribute('href')).toBe('/?tab=weather&hub=ORD');
    expect(link.className.split(/\s+/)).not.toContain('text-primary');
    expect(link.parentElement!.textContent).toMatch(/^ORD under FAA delay program \(avg 75min\) — statuses may lag\.$/);
  });

  it('the cards stay text: none is a link (the Canceled figure counts confirmed only; its filter also matches Likely Canceled)', () => {
    mount(<ScheduleStats stats={stats} dir="departures" dayLabel="Thu, Nov 12" hub="ORD" hubDisruptionMinutes={0} />);
    expect(document.querySelectorAll('a')).toHaveLength(0);
  });
});
