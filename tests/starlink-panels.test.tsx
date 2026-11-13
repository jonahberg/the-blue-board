// @vitest-environment jsdom
/**
 * Starlink tab panels rendered from real board/hero models (F3/F98, F99), and every name they
 * print linked to its home (links everywhere, part 1, Nov 12 2026).
 *
 * The links follow in place through the dashboard's own state, so the panels are mounted in the
 * real UiProvider, ScheduleProvider and FollowProvider (as tests/dash-link.test.tsx does), with the Schedule
 * store's watch-list collaborators stubbed. The whole tab (`StarlinkView`) is rendered from a
 * stubbed fleet, feed and prefs store, so the hero's buttons are checked against the roster they
 * filter.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildDeparturesBoard } from '../src/lib/starlink-utils.js';
import { DeparturesBoard } from '../src/app/views/starlink/DeparturesBoard';
import { RosterTable } from '../src/app/views/starlink/RosterTable';
import { SlHero } from '../src/app/views/starlink/SlHero';
import type { RolloutBar } from '../src/app/views/starlink/SlHero';
import { VerificationLedger } from '../src/app/views/starlink/VerificationLedger';
import type { BoardModel, FleetByReg, FlightsByTail } from '../src/app/views/starlink/types';
import type { StarlinkAircraft } from '../src/app/data/types';
import type { FeedValue } from '../src/app/state/feed';
import type { FleetValue } from '../src/app/state/fleet';
import type { PrefsValue } from '../src/app/state/prefs';
import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';
import StarlinkView from '../src/app/views/StarlinkView';

vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ watched: [] }) }));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));

// The whole-tab cases below read these; the single panels never touch them.
const view = vi.hoisted(() => ({
  fleet: null as unknown,
  ledger: {
    disputed: [{ tail: 'N12345', aircraft: '737-900', operator: 'United', verifiedAs: 'Viasat', verifiedAt: '2026-09-01' }],
    summary: { verifiedStarlink: 400, disputed: 1, unverified: 12, totalPlanes: 413 },
  },
}));
vi.mock('../src/app/state/fleet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/fleet')>()),
  useFleet: () => view.fleet as FleetValue,
}));
vi.mock('../src/app/state/feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/feed')>()),
  useFeed: () => ({ flights: [], lastGoodTs: null }) as unknown as FeedValue,
}));
vi.mock('../src/app/state/prefs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/prefs')>()),
  usePrefs: () => ({ homeAirport: '' }) as unknown as PrefsValue,
}));
vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchStarlinkMismatches: () => Promise.resolve(view.ledger),
}));

/** The UI store as the last render saw it. */
let ui: UiValue | null = null;
function Probe() {
  ui = useUi();
  return null;
}

function mount(node: ReactNode) {
  return render(
    <UiProvider>
      <ScheduleProvider>
        <FollowProvider>
          {node}
          <Probe />
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
}

/**
 * Whether the last click still had its default when it reached the document (after React's
 * handler). The listener then cancels it: jsdom cannot load another document.
 */
let reachedDocumentPrevented: boolean | null = null;
function recordClick(event: Event) {
  reachedDocumentPrevented = event.defaultPrevented;
  event.preventDefault();
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  reachedDocumentPrevented = null;
  document.addEventListener('click', recordClick);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in this test'))));
});

afterEach(() => {
  cleanup();
  document.removeEventListener('click', recordClick);
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  ui = null;
  view.fleet = null;
});

/** A link inside a button, or a button inside a link: never (the plan's Global Constraints). */
const nestedControls = (root: ParentNode = document) => root.querySelectorAll('button a, a button').length;

const NOW = 1_700_000_000;

describe('DeparturesBoard', () => {
  it('shows a future departure of an airborne tail as SCHED · inbound, tracking the inbound', () => {
    const board = buildDeparturesBoard(
      {
        N34562: [
          { flight_number: 'UAL2278', origin: 'SFO', destination: 'ORD', departure_ts: NOW + 98 * 60 },
        ],
      },
      { N34562: { type: 'A321neo', fleet: 'Mainline', operator: 'United Airlines' } },
      { N34562: { icao24: 'a4b1c2', origin: 'DEN', dest: 'SFO', flightIATA: 'UA1389' } },
      ['SFO'],
      { now: NOW },
    ) as BoardModel;
    const onTrack = vi.fn();
    mount(
      <DeparturesBoard
        board={board}
        hubCodes={['SFO']}
        hub={null}
        onHub={() => {}}
        windowH={12}
        onWindow={() => {}}
        onShowAll={() => {}}
        freshness="schedule synced 5m ago · airborne live"
        emptyText="No United Starlink departures from the hubs in the next 12h."
        footer="A NOC departures board, not a passenger FIDS."
        tzAbbrev={() => 'PDT'}
        fleetByReg={null}
        onOpenAircraft={() => {}}
        onTrack={onTrack}
      />,
    );
    expect(screen.queryByText('Airborne')).toBeNull();
    // The inbound number is its own element now (a link), so the sentence is read off its span.
    expect(screen.getByText(/^SCHED · inbound/).textContent).toBe('SCHED · inbound on UA1389');
    fireEvent.click(screen.getByText('Track inbound'));
    expect(onTrack.mock.calls[0][0].inbound.icao24).toBe('a4b1c2');
  });
});

describe('DeparturesBoard flight numbers (Nov 2026)', () => {
  function renderBoard(onOpenAircraft = vi.fn()) {
    const board = buildDeparturesBoard(
      {
        N34562: [{ flight_number: 'UAL2278', origin: 'SFO', destination: 'ORD', departure_ts: NOW + 60 * 60 }],
        N801SK: [{ flight_number: 'SKW5408', origin: 'SFO', destination: 'BOI', departure_ts: NOW + 90 * 60 }],
      },
      {
        N34562: { type: 'A321neo', fleet: 'Mainline', operator: 'United Airlines' },
        N801SK: { type: 'E175', fleet: 'Express', operator: 'SkyWest' },
      },
      {},
      ['SFO'],
      { now: NOW },
    ) as BoardModel;
    mount(
      <DeparturesBoard
        board={board}
        hubCodes={['SFO']}
        hub={null}
        onHub={() => {}}
        windowH={12}
        onWindow={() => {}}
        onShowAll={() => {}}
        freshness="schedule synced 5m ago · airborne live"
        emptyText="No United Starlink departures from the hubs in the next 12h."
        footer="A NOC departures board, not a passenger FIDS."
        tzAbbrev={() => 'PDT'}
        fleetByReg={null}
        onOpenAircraft={onOpenAircraft}
        onTrack={() => {}}
      />,
    );
    return onOpenAircraft;
  }

  it('a United number links to its flight page and prints as its ident (UAL2278 reads UA2278); an operating callsign is plain text', () => {
    renderBoard();
    const link = screen.getByRole('link', { name: 'UA2278' });
    expect(link.getAttribute('href')).toBe('/flight/UA2278');
    expect(screen.queryByText('UAL2278')).toBeNull();
    expect(screen.queryByRole('link', { name: 'SKW5408' })).toBeNull();
    const plain = screen.getByText('SKW5408');
    expect(plain.tagName).toBe('SPAN');
    expect(plain.className).not.toMatch(/text-primary/);
  });

  it('the aircraft details button is separate from the link and still opens the aircraft', () => {
    const onOpenAircraft = renderBoard();
    const button = screen.getByRole('button', { name: /Aircraft details: .*N34562/ });
    expect(button.contains(screen.getByRole('link', { name: 'UA2278' }))).toBe(false);
    fireEvent.click(button);
    expect(onOpenAircraft).toHaveBeenCalledWith('N34562');
  });
});

describe('SlHero airborne chip (Nov 2026)', () => {
  it('is named by its visible words plus sr-only ones, not an aria-label over different text', () => {
    const onShowOnMap = vi.fn();
    render(
      <SlHero
        equipped={598}
        bars={null}
        newThisWeek={0}
        airborneCount={298}
        canFilterMap
        verified={594}
        checked={606}
        disputed={5}
        onJumpToLedger={() => {}}
        onShowOnMap={onShowOnMap}
      />,
    );
    const chip = screen.getByRole('button', { name: 'Show 298 Airborne now Starlink aircraft on the live map' });
    expect(chip.getAttribute('aria-label')).toBeNull();
    fireEvent.click(chip);
    expect(onShowOnMap).toHaveBeenCalled();
  });
});

describe('SlHero verification sub-line (F99)', () => {
  it('names its own denominator, which is not the headline count', () => {
    render(
      <SlHero
        equipped={598}
        bars={null}
        newThisWeek={0}
        airborneCount={0}
        canFilterMap
        verified={594}
        checked={606}
        disputed={5}
        onJumpToLedger={() => {}}
        onShowOnMap={() => {}}
      />,
    );
    const sub = document.getElementById('sl-hero-verify-sub') as HTMLElement;
    expect(sub.textContent).toContain('594 of 606 checked verified');
    expect(sub.textContent).toContain('5 disputed');
  });
});

// ── Links everywhere, part 1 (Nov 12 2026) ──────────────────────────────────────────────────
// N75436 is the plan's example: the tracker says "737-900", the fleet database says 737-900ER.
const FLEET_BY_REG = { N75436: { t: '737-900ER' } };
const AIRCRAFT_BY_TAIL = {
  N638SY: { type: 'ERJ-175', fleet: 'Express', operator: 'SkyWest dba United Express' },
  N75436: { type: '737-900', fleet: 'Mainline', operator: 'United Airlines' },
  N37502: { type: '737 MAX 9', fleet: 'Mainline', operator: 'United Airlines' },
};
/** The board row a printed thing sits in (marked for the link audit). */
const boardRow = (el: HTMLElement) => el.closest('[data-link-row]') as HTMLElement;
const isLinked = (el: HTMLElement) => el.closest('a') !== null;

describe('DeparturesBoard links (Nov 12 2026)', () => {
  // An Express leg the feed marks United, and a mainline leg whose aircraft is still flying its
  // inbound SFO→DEN as UA3508.
  const FLIGHTS: FlightsByTail = {
    N638SY: [{ flight_number: 'SKW5415', airline: 'UA', origin: 'ORD', destination: 'DSM', departure_ts: NOW + 60 * 60 }],
    N75436: [{ flight_number: 'UA576', airline: 'UA', origin: 'DEN', destination: 'LHR', departure_ts: NOW + 90 * 60 }],
  };
  const INBOUND = { N75436: { icao24: 'a1b2c3', origin: 'SFO', dest: 'DEN', flightIATA: 'UA3508' } };

  function renderBoard(
    flightsByTail: FlightsByTail = FLIGHTS,
    {
      airborne = INBOUND as Record<string, object>,
      fleetByReg = FLEET_BY_REG as FleetByReg,
      onOpenAircraft = vi.fn(),
    }: { airborne?: Record<string, object>; fleetByReg?: FleetByReg; onOpenAircraft?: (reg: string) => void } = {},
  ) {
    const board = buildDeparturesBoard(flightsByTail, AIRCRAFT_BY_TAIL, airborne, ['ORD', 'DEN'], { now: NOW }) as BoardModel;
    mount(
      <DeparturesBoard
        board={board}
        hubCodes={['ORD', 'DEN']}
        hub={null}
        onHub={() => {}}
        windowH={12}
        onWindow={() => {}}
        onShowAll={() => {}}
        freshness="schedule synced 5m ago · airborne live"
        emptyText="No United Starlink departures from the hubs in the next 12h."
        footer="A NOC departures board, not a passenger FIDS."
        tzAbbrev={() => 'CDT'}
        fleetByReg={fleetByReg}
        onOpenAircraft={onOpenAircraft}
        onTrack={() => {}}
      />,
    );
    return onOpenAircraft;
  }

  it('an Express row the feed marks United prints and links the United number; the operator stays under it', () => {
    renderBoard();
    const link = screen.getByRole('link', { name: 'UA5415' });
    expect(link.getAttribute('href')).toBe('/flight/UA5415');
    expect(link.className).toMatch(/(?:^|\s)text-primary(?:\s|$)/);
    // Above the aircraft button, which a touch screen stretches over the whole row.
    expect(link.className).toMatch(/(?:^|\s)z-10(?:\s|$)/);
    const row = boardRow(link);
    expect(row.textContent).not.toContain('SKW5415');
    expect(row.textContent).toContain('SkyWest');
  });

  it('a row that looks Express but is not marked United prints what the feed sent, plain', () => {
    renderBoard({ N638SY: [{ ...FLIGHTS.N638SY[0], airline: '' }] }, { airborne: {} });
    const plain = screen.getByText('SKW5415');
    expect(plain.tagName).toBe('SPAN');
    expect(isLinked(plain)).toBe(false);
    expect(plain.className).not.toMatch(/text-primary/);
    expect(screen.queryByText('UA5415')).toBeNull();
  });

  it('a hub at either end is a quiet link to its Schedule board; any other airport is plain', () => {
    renderBoard({
      ...FLIGHTS,
      N37502: [{ flight_number: 'UA1001', airline: 'UA', origin: 'ORD', destination: 'DEN', departure_ts: NOW + 120 * 60 }],
    });
    const expressRow = boardRow(screen.getByRole('link', { name: 'UA5415' }));
    const mainlineRow = boardRow(screen.getByRole('link', { name: 'UA576' }));
    const hubRow = boardRow(screen.getByRole('link', { name: 'UA1001' }));

    const ord = within(expressRow).getByRole('link', { name: 'ORD' });
    const den = within(mainlineRow).getByRole('link', { name: 'DEN' });
    expect(ord.getAttribute('href')).toBe('/?tab=schedule&hub=ORD');
    expect(den.getAttribute('href')).toBe('/?tab=schedule&hub=DEN');
    for (const hub of [ord, den]) {
      expect(hub.className).not.toMatch(/(?:^|\s)text-primary(?:\s|$)/);
      // A touch row is one tap target (the aircraft dialog): the hub takes no taps there.
      expect(hub.className).toContain('pointer-coarse:pointer-events-none');
      expect(hub.className).toMatch(/(?:^|\s)z-10(?:\s|$)/);
    }
    // A hub destination links the same way.
    expect(within(hubRow).getByRole('link', { name: 'DEN' }).getAttribute('href')).toBe('/?tab=schedule&hub=DEN');

    expect(isLinked(within(expressRow).getByText('DSM'))).toBe(false);
    expect(isLinked(within(mainlineRow).getByText('LHR'))).toBe(false);
  });

  it("the type links by the fleet database's type for the tail and prints the tracker's words", () => {
    renderBoard();
    const type = screen.getByRole('link', { name: '737-900' });
    expect(type.getAttribute('href')).toBe('/?tab=fleet&type=737-900ER');
    expect(type.className).not.toMatch(/(?:^|\s)text-primary(?:\s|$)/);
    expect(type.className).toContain('pointer-coarse:pointer-events-none');
    expect(isLinked(screen.getByText('ERJ-175'))).toBe(false);
  });

  it('each row has exactly one link-coloured thing, its flight number', () => {
    renderBoard();
    for (const name of ['UA5415', 'UA576']) {
      const link = screen.getByRole('link', { name });
      const marked = boardRow(link).querySelectorAll('.text-primary');
      expect(marked).toHaveLength(1);
      expect(marked[0]).toBe(link);
    }
  });

  it('"inbound on UA3508": the inbound number is a quiet link above the aircraft button', () => {
    renderBoard();
    const inbound = screen.getByRole('link', { name: 'UA3508' });
    expect(inbound.getAttribute('href')).toBe('/flight/UA3508');
    expect(inbound.className).not.toMatch(/(?:^|\s)text-primary(?:\s|$)/);
    expect(inbound.className).toMatch(/(?:^|\s)z-10(?:\s|$)/);
  });

  it("an inbound number prints in the tab's one form: UAL3508 reads UA3508", () => {
    renderBoard(FLIGHTS, { airborne: { N75436: { icao24: 'a1b2c3', origin: 'SFO', dest: 'DEN', callsign: 'UAL3508' } } });
    expect(screen.getByRole('link', { name: 'UA3508' }).getAttribute('href')).toBe('/flight/UA3508');
    expect(screen.queryByText(/UAL3508/)).toBeNull();
  });

  // The live feed is United-only (/api/fr24-feed?airline=UAL), so the inbound leg is United's: on
  // the Nov 12 preview "inbound on YX3568" sat plain beside a linked "inbound on UA4190".
  it('an Express operator number on the inbound leg reads as its United number and links', () => {
    renderBoard(FLIGHTS, { airborne: { N75436: { icao24: 'a1b2c3', origin: 'SFO', dest: 'DEN', flightIATA: 'YX3568' } } });
    expect(screen.getByText(/^SCHED · inbound/).textContent).toBe('SCHED · inbound on UA3568');
    expect(screen.getByRole('link', { name: 'UA3568' }).getAttribute('href')).toBe('/flight/UA3568');
    expect(screen.getByRole('button', { name: /Track inbound/ }).getAttribute('title')).toContain('UA3568');
  });

  // Only the feed's flight number reads that way (links part 2): a callsign is the operator's own
  // radio call, and nothing checked that its digits are the United number.
  it('an Express callsign with no flight number on the inbound leg prints as sent, plain', () => {
    renderBoard(FLIGHTS, { airborne: { N75436: { icao24: 'a1b2c3', origin: 'SFO', dest: 'DEN', callsign: 'RPA3568' } } });
    expect(screen.getByText(/^SCHED · inbound/).textContent).toBe('SCHED · inbound on RPA3568');
    expect(screen.queryByRole('link', { name: /3568/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Track inbound/ }).getAttribute('title')).toContain('RPA3568');
  });

  it('marks every row for the link audit', () => {
    renderBoard();
    const rows = document.querySelectorAll('#sl-board-body [data-link-row]');
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.querySelector('[data-flight-link]')).not.toBeNull();
  });

  it('a tail the fleet database does not know prints its type plain and still opens the aircraft dialog', () => {
    const onOpenAircraft = renderBoard(FLIGHTS, { fleetByReg: null });
    expect(screen.queryByRole('link', { name: '737-900' })).toBeNull();
    expect(isLinked(screen.getByText('737-900'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /Aircraft details: .*N638SY/ }));
    expect(onOpenAircraft).toHaveBeenCalledWith('N638SY');
  });

  it('puts no link inside a button', () => {
    renderBoard();
    expect(nestedControls()).toBe(0);
  });
});

describe('RosterTable links (Nov 12 2026)', () => {
  const ROSTER: StarlinkAircraft[] = [
    { tail: 'N638SY', fleet: 'Express', type: 'ERJ-175', operator: 'SkyWest dba United Express' },
    { tail: 'N75436', fleet: 'Mainline', type: '737-900', operator: 'United Airlines' },
  ];
  const FLIGHTS: FlightsByTail = {
    N638SY: [
      { flight_number: 'SKW5415', airline: 'UA', origin: 'ORD', destination: 'DSM', departure_ts: NOW + 60 * 60 },
      { flight_number: 'SKW5416', airline: 'UA', origin: 'DSM', destination: 'ORD', departure_ts: NOW + 180 * 60 },
    ],
    // The feed's mainline form; the tab prints its United number, UA576.
    N75436: [{ flight_number: 'UAL576', airline: 'UA', origin: 'DEN', destination: 'LHR', departure_ts: NOW + 90 * 60 }],
  };

  function renderRoster(expanded: string | null = null, flightsByTail: FlightsByTail = FLIGHTS) {
    mount(
      <RosterTable
        rows={ROSTER}
        totalRows={ROSTER.length}
        sort={{ col: 'tail', asc: true }}
        onSort={() => {}}
        expanded={expanded}
        onToggleExpand={() => {}}
        airborneByTail={{}}
        conflictTails={new Set()}
        newTails={new Set()}
        flightsByTail={flightsByTail}
        hasLive={false}
        hasFlights
        nowMs={NOW * 1000}
        nowSec={NOW}
        tzAbbrev={() => 'CDT'}
        fleetByReg={FLEET_BY_REG}
        onTrack={() => {}}
        onOpenAircraft={() => {}}
      />,
    );
  }
  const rosterRow = (tail: string) => screen.getByRole('button', { name: tail }).closest('tr') as HTMLElement;
  const upcomingList = () => screen.getByText('Upcoming Flights').nextElementSibling as HTMLElement;

  it('the next-flight number is a quiet link in the one United form; its hub ends are quiet fine-pointer links', () => {
    renderRoster();
    const express = within(rosterRow('N638SY')).getByRole('link', { name: 'UA5415' });
    expect(express.getAttribute('href')).toBe('/flight/UA5415');
    expect(express.className).not.toMatch(/(?:^|\s)text-primary(?:\s|$)/);
    expect(rosterRow('N638SY').textContent).not.toContain('SKW5415');
    const mainline = within(rosterRow('N75436')).getByRole('link', { name: 'UA576' });
    expect(mainline.className).not.toMatch(/(?:^|\s)text-primary(?:\s|$)/);
    expect(rosterRow('N75436').textContent).not.toContain('UAL576');
    // Hub ends link as the board's route does; any other airport stays plain.
    const ord = within(rosterRow('N638SY')).getByRole('link', { name: 'ORD' });
    expect(ord.getAttribute('href')).toBe('/?tab=schedule&hub=ORD');
    expect(ord.className).not.toMatch(/(?:^|\s)text-primary(?:\s|$)/);
    expect(ord.className).toContain('pointer-coarse:pointer-events-none');
    // It takes no taps, so it has no touch box: with a mouse under 768 px one covered the end of the
    // flight number beside it, and a click there opened the hub's board.
    expect(ord.className).not.toMatch(/after:/);
    expect(within(rosterRow('N75436')).getByRole('link', { name: 'DEN' }).getAttribute('href')).toBe('/?tab=schedule&hub=DEN');
    expect(within(rosterRow('N638SY')).queryByRole('link', { name: 'DSM' })).toBeNull();
    expect(within(rosterRow('N75436')).queryByRole('link', { name: 'LHR' })).toBeNull();
    // One link-coloured thing per row: none here, the row is about the tail (a disclosure).
    expect(rosterRow('N638SY').querySelectorAll('.text-primary')).toHaveLength(0);
  });

  it('an Express leg the feed did not mark United prints as sent, plain', () => {
    renderRoster(null, { ...FLIGHTS, N638SY: [{ ...FLIGHTS.N638SY[0], airline: undefined }] });
    expect(isLinked(within(rosterRow('N638SY')).getByText('SKW5415'))).toBe(false);
  });

  it('the type cell links by tail, quietly; a regional type is plain', () => {
    renderRoster();
    const type = within(rosterRow('N75436')).getByRole('link', { name: '737-900' });
    expect(type.getAttribute('href')).toBe('/?tab=fleet&type=737-900ER');
    expect(type.className).not.toMatch(/(?:^|\s)text-primary(?:\s|$)/);
    expect(isLinked(within(rosterRow('N638SY')).getByText('ERJ-175'))).toBe(false);
  });

  it('the tail stays the disclosure button it is', () => {
    renderRoster();
    expect(screen.getByRole('button', { name: 'N75436' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: /N75436/ })).toBeNull();
  });

  it('the expansion links each upcoming number (in link colour) and its hub ends; other airports are plain', () => {
    renderRoster('N638SY');
    const list = upcomingList();
    const numbers = ['UA5415', 'UA5416'].map((name) => within(list).getByRole('link', { name }));
    for (const link of numbers) expect(link.className).toMatch(/(?:^|\s)text-primary(?:\s|$)/);
    expect(numbers[1].getAttribute('href')).toBe('/flight/UA5416');
    expect(list.textContent).not.toContain('SKW');
    const hubs = within(list).getAllByRole('link', { name: 'ORD' });
    expect(hubs).toHaveLength(2);
    for (const hub of hubs) {
      expect(hub.getAttribute('href')).toBe('/?tab=schedule&hub=ORD');
      expect(hub.className).not.toMatch(/(?:^|\s)text-primary(?:\s|$)/);
    }
    expect(within(list).queryByRole('link', { name: 'DSM' })).toBeNull();
    // Wherever the 44 px boxes are drawn (every pointer below `md`, a coarse one at any width) the
    // line's live targets (number, hub ends) sit far enough apart that the boxes never overlap; only a
    // mouse at `md`+, where the boxes are gone, gets the tight line.
    const line = list.querySelector('li')!.className.split(/\s+/);
    expect(line).toEqual(expect.arrayContaining(['gap-x-7', 'pointer-fine:md:gap-x-2', 'min-h-11', 'pointer-fine:md:min-h-0']));
    expect(line.filter((cls) => /^(?:pointer-coarse:|md:|sm:)gap-x-/.test(cls) || cls === 'gap-x-2')).toEqual([]);
    const arrow = list.querySelector('li [aria-hidden="true"]')!.className.split(/\s+/);
    expect(arrow).toEqual(expect.arrayContaining(['mx-3', 'pointer-fine:md:mx-1']));
    expect(arrow.filter((cls) => /^(?:pointer-coarse:|md:|sm:)mx-/.test(cls) || cls === 'mx-1')).toEqual([]);
    // Each line is one flight: one link-coloured thing per line, and each is marked for the audit.
    for (const line of list.querySelectorAll('li')) {
      expect(line.querySelectorAll('.text-primary')).toHaveLength(1);
      expect(line.hasAttribute('data-link-row')).toBe(true);
    }
  });

  it("the expansion's airframe links by tail", () => {
    renderRoster('N75436');
    const airframe = screen.getByText('Airframe').nextElementSibling as HTMLElement;
    const link = within(airframe).getByRole('link', { name: '737-900' });
    expect(link.getAttribute('href')).toBe('/?tab=fleet&type=737-900ER');
    expect(within(upcomingList()).getByRole('link', { name: 'DEN' })).toBeTruthy();
    expect(within(upcomingList()).getByRole('link', { name: 'UA576' }).getAttribute('href')).toBe('/flight/UA576');
    expect(upcomingList().textContent).not.toContain('UAL576');
    expect(within(upcomingList()).queryByRole('link', { name: 'LHR' })).toBeNull();
    expect(nestedControls()).toBe(0);
  });
});

describe('VerificationLedger tails (Nov 12 2026)', () => {
  it('a disputed tail is a link to its aircraft dialog, followed in place', () => {
    mount(
      <VerificationLedger
        id="sl-verification"
        disputed={view.ledger.disputed}
        summary={view.ledger.summary}
        conflicts={new Set()}
      />,
    );
    const tail = screen.getByRole('link', { name: 'N12345' });
    expect(tail.getAttribute('href')).toBe('/?aircraft=N12345');
    expect(tail.className).toMatch(/(?:^|\s)text-primary(?:\s|$)/);

    fireEvent.click(tail);

    expect(reachedDocumentPrevented).toBe(true);
    expect(ui!.aircraftReg).toBe('N12345');
  });
});

describe('SlHero buttons (Nov 12 2026)', () => {
  const BARS: RolloutBar[] = [
    // No fleet-summary: the Express row is a count with no bar (v1.28.2).
    { label: 'Express', installed: 355, total: null, pct: null },
    { label: 'Mainline', installed: 354, total: 368, pct: 96 },
  ];
  function renderHero(handlers: { onShowFleet?: (fleet: 'Mainline' | 'Express') => void; onShowNew?: () => void }) {
    render(
      <SlHero
        equipped={709}
        bars={BARS}
        newThisWeek={7}
        airborneCount={298}
        canFilterMap
        verified={594}
        checked={606}
        disputed={5}
        onJumpToLedger={() => {}}
        onShowOnMap={() => {}}
        {...handlers}
      />,
    );
  }

  it('each bar row is one button that shows that fleet in the roster below', () => {
    const onShowFleet = vi.fn();
    renderHero({ onShowFleet });
    const mainline = screen.getByRole('button', { name: /^Show Mainline aircraft in the roster below/ });
    // Named by its own words plus sr-only ones; the figure it prints is in the name too.
    expect(mainline.getAttribute('aria-label')).toBeNull();
    expect(mainline.textContent).toContain('354 / 368 · 96%');
    fireEvent.click(mainline);
    expect(onShowFleet).toHaveBeenLastCalledWith('Mainline');

    // The count-only Express row is a button as well.
    const express = screen.getByRole('button', { name: /^Show Express aircraft in the roster below/ });
    expect(express.textContent).toContain('355 equipped');
    fireEvent.click(express);
    expect(onShowFleet).toHaveBeenLastCalledWith('Express');
  });

  it('"+N NEW THIS WEEK" is a button named by its visible words plus sr-only ones', () => {
    const onShowNew = vi.fn();
    renderHero({ onShowNew });
    const chip = screen.getByRole('button', { name: 'Show +7 New this week aircraft in the roster below' });
    expect(chip.getAttribute('aria-label')).toBeNull();
    fireEvent.click(chip);
    expect(onShowNew).toHaveBeenCalledTimes(1);
  });

  it('neither is a link', () => {
    renderHero({ onShowFleet: () => {}, onShowNew: () => {} });
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(nestedControls()).toBe(0);
  });

  it('without a handler the row and the chip stay as they were, with no dead button', () => {
    renderHero({});
    expect(screen.queryByRole('button', { name: /roster/ })).toBeNull();
    expect((document.querySelector('[data-bar="Mainline"]') as HTMLElement).textContent).toBe('Mainline354 / 368 · 96%');
    expect(document.getElementById('sl-hero-chips')?.textContent).toContain('+7NEW THIS WEEK');
  });
});

describe('the Starlink tab: the hero filters the roster below, and nothing nests (Nov 12 2026)', () => {
  const nowSec = () => Math.floor(Date.now() / 1000);
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  /** Element.prototype.scrollIntoView, recording what it was called on (jsdom has none). */
  let scrolled: Element[] = [];
  const original = Element.prototype.scrollIntoView;
  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    window.HTMLElement.prototype.hasPointerCapture ??= () => false;
    const roster = [
      { tail: 'N75436', fleet: 'Mainline', type: '737-900', operator: 'United Airlines', dateFound: '2025-03-01' },
      { tail: 'N638SY', fleet: 'Express', type: 'ERJ-175', operator: 'SkyWest dba United Express', dateFound: daysAgo(1) },
      { tail: 'N801SK', fleet: 'Express', type: 'CRJ-550', operator: 'SkyWest dba United Express', dateFound: '2025-02-01' },
    ];
    const fleetDb = [
      { r: 'N75436', t: '737-900ER', w: 'Starlink', s: '', d: '2015' },
      { r: 'N37503', t: '737 MAX 9', w: '', s: '', d: '2018' },
    ];
    view.fleet = {
      fleetDb,
      fleetByReg: Object.fromEntries(fleetDb.map((a) => [a.r, a])),
      starlink: {
        tails: new Set(roster.map((a) => a.tail)),
        flightsByTail: {
          N638SY: [{ flight_number: 'SKW5415', airline: 'UA', origin: 'ORD', destination: 'DSM', departure_ts: nowSec() + 3600 }],
          N75436: [{ flight_number: 'UA576', airline: 'UA', origin: 'DEN', destination: 'LHR', departure_ts: nowSec() + 5400 }],
        },
        flightsStatus: 'ready',
        stats: { total: 3, mainline: 1, express: 2, mainlineTotal: 2, expressTotal: 4, expressPct: 50 },
        aircraft: roster,
        lastUpdated: null,
        syncedAt: null,
        degraded: false,
      },
      fleetSummary: null,
      special: new Map(),
      loading: false,
      loadFailed: false,
      retry: () => {},
      loadStarlinkFlights: () => {},
      expressDb: [],
      expressByReg: {},
      expressStatus: 'ready',
    };
    window.history.replaceState(null, '', '/#starlink');
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });

  const roster = () => screen.getByRole('region', { name: 'Starlink Roster' });
  const rosterTails = () =>
    [...roster().querySelectorAll('tbody button[aria-expanded]')].map((b) => b.textContent?.replace(/[▸▾]/g, '').trim());

  it('the Mainline bar shows only Mainline aircraft in the roster, and scrolls to it', () => {
    mount(<StarlinkView />);
    expect(rosterTails()).toEqual(['N638SY', 'N75436', 'N801SK']);
    fireEvent.click(screen.getByRole('button', { name: /^Show Mainline aircraft in the roster below/ }));
    expect(rosterTails()).toEqual(['N75436']);
    expect(scrolled).toEqual([roster()]);
  });

  it('the Express bar shows only Express aircraft', () => {
    mount(<StarlinkView />);
    fireEvent.click(screen.getByRole('button', { name: /^Show Express aircraft in the roster below/ }));
    expect(rosterTails()).toEqual(['N638SY', 'N801SK']);
  });

  it('"+1 NEW THIS WEEK" turns the roster\'s New this week on and scrolls to it', () => {
    mount(<StarlinkView />);
    const chip = screen.getByRole('button', { name: 'Show +1 New this week aircraft in the roster below' });
    fireEvent.click(chip);
    expect(document.getElementById('sl-filter-new')?.getAttribute('aria-pressed')).toBe('true');
    expect(rosterTails()).toEqual(['N638SY']);
    expect(scrolled).toEqual([roster()]);
    // A second click keeps it on: the chip shows the new aircraft, it does not toggle them.
    fireEvent.click(chip);
    expect(document.getElementById('sl-filter-new')?.getAttribute('aria-pressed')).toBe('true');
  });

  /** Pick an option from one of the roster's Radix selects, as a mouse does. */
  async function pick(name: string, option: string) {
    await act(async () => {
      fireEvent.pointerDown(screen.getByRole('combobox', { name }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    });
    const item = await screen.findByRole('option', { name: option });
    await act(async () => {
      fireEvent.click(item);
    });
  }
  const search = () => screen.getByRole('textbox', { name: 'Search Starlink aircraft' }) as HTMLInputElement;
  const control = (name: string) => screen.getByRole('combobox', { name }).textContent;
  const newOnly = () => document.getElementById('sl-filter-new')?.getAttribute('aria-pressed');

  /** A roster left filtered to nothing a hero button names: a type, an operator, a search, New on. */
  async function staleRoster() {
    await pick('Starlink type filter', 'CRJ-550');
    await pick('Starlink operator filter', 'SkyWest dba United Express');
    fireEvent.change(search(), { target: { value: 'N801' } });
  }

  it.each([
    ['Mainline', ['N75436']],
    ['Express', ['N638SY', 'N801SK']],
  ])('from a stale roster, the %s bar lands on its rows with every other control at rest', async (fleet, tails) => {
    mount(<StarlinkView />);
    await staleRoster();
    expect(rosterTails()).toEqual(['N801SK']);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Show ${fleet} aircraft in the roster below`) }));
    expect(rosterTails()).toEqual(tails);
    expect(screen.queryByText('No aircraft match your filters.')).toBeNull();
    expect(control('Starlink fleet filter')).toBe(fleet);
    expect(control('Starlink type filter')).toBe('All Types');
    expect(control('Starlink operator filter')).toBe('All Operators');
    expect(search().value).toBe('');
    expect(newOnly()).toBe('false');
  });

  it('from a stale roster, "+1 NEW THIS WEEK" lands on the new aircraft with every other control at rest', async () => {
    mount(<StarlinkView />);
    await pick('Starlink fleet filter', 'Mainline');
    await staleRoster();
    expect(rosterTails()).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Show +1 New this week aircraft in the roster below' }));
    expect(rosterTails()).toEqual(['N638SY']);
    expect(control('Starlink fleet filter')).toBe('All Fleets');
    expect(control('Starlink type filter')).toBe('All Types');
    expect(control('Starlink operator filter')).toBe('All Operators');
    expect(search().value).toBe('');
    expect(newOnly()).toBe('true');
  });

  it('every kind of name on the tab links, and no link sits inside a button or a button inside a link', async () => {
    mount(<StarlinkView />);
    // The ledger arrives on its own fetch.
    expect((await screen.findByRole('link', { name: 'N12345' })).getAttribute('href')).toBe('/?aircraft=N12345');
    fireEvent.click(screen.getByRole('button', { name: 'N75436' }));
    expect(screen.getAllByRole('link', { name: 'UA5415' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'ORD' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: '737-900' }).length).toBeGreaterThan(0);
    expect(nestedControls()).toBe(0);
  });
});

describe('VelocityChart', () => {
  it('opens scrolled to the newest months and paints count labels over the line (F29/F76)', async () => {
    const { buildVelocityChart } = await import('../src/lib/starlink-chart.js');
    const { VelocityChart } = await import('../src/app/views/starlink/VelocityChart');
    const months = Array.from({ length: 18 }, (_, i) => ({
      ym: `2025-${String((i % 12) + 1).padStart(2, '0')}`,
      label: i % 12 === 0 ? `JAN ${25 + i / 12}` : 'MON',
      express: 3,
      mainline: 10,
      total: 13,
      cumulative: 13 * (i + 1),
    }));
    const sw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 628 });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 342 });
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render(<VelocityChart model={buildVelocityChart(months, 0) as any} pace={null} />);
      expect(screen.getByTestId('sl-chart-scroller').scrollLeft).toBe(628 - 342);
    } finally {
      if (sw) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', sw);
      if (cw) Object.defineProperty(HTMLElement.prototype, 'clientWidth', cw);
    }
    const svg = document.getElementById('sl-chart') as unknown as SVGElement;
    const line = svg.querySelector('path[fill="none"][stroke-width="2"]') as Element;
    const label = [...svg.querySelectorAll('text')].find((t) => t.textContent === '13') as Element;
    // DOCUMENT_POSITION_FOLLOWING: the label is painted after (on top of) the line.
    expect(line.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(label.getAttribute('paint-order')).toBe('stroke');
  });

  it('never opens with its left edge through a bar or its count label (Nov 2026: "162*" read "62*")', async () => {
    const { buildVelocityChart } = await import('../src/lib/starlink-chart.js');
    const { VelocityChart } = await import('../src/app/views/starlink/VelocityChart');
    const months = Array.from({ length: 18 }, (_, i) => ({
      ym: `2025-${String((i % 12) + 1).padStart(2, '0')}`,
      label: i % 12 === 0 ? `JAN ${25 + i / 12}` : 'MON',
      express: i === 9 ? 160 : 3,
      mainline: 10,
      total: i === 9 ? 170 : 13,
      cumulative: 13 * (i + 1),
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = buildVelocityChart(months, 0) as any;
    const svgWidth = 620;
    const scale = svgWidth / model.width;
    const sw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    const cw = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const rect = Element.prototype.getBoundingClientRect;
    // Every right-pinned offset a phone could land on, from 300 px to 430 px wide.
    for (let client = 300; client <= 430; client += 7) {
      Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => svgWidth });
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => client });
      Element.prototype.getBoundingClientRect = function () {
        return { width: this.tagName.toLowerCase() === 'svg' ? svgWidth : 0 } as DOMRect;
      };
      try {
        const { unmount } = render(<VelocityChart model={model} pace={null} />);
        const left = screen.getByTestId('sl-chart-scroller').scrollLeft;
        expect(left).toBeLessThanOrEqual(svgWidth - client);
        for (const bar of model.bars) {
          const half = bar.countLabel ? (bar.countLabel.text.length * (bar.capped ? 10 : 9) * 0.62) / 2 : 0;
          // The lib's zig-zag runs from x - 2 in 8-unit teeth across the bar (starlink-chart.js).
          const zigTo = bar.zigzag ? bar.x - 2 + 8 * Math.ceil((bar.width + 4) / 8) : bar.x + bar.width;
          const from = Math.min(bar.x - (bar.zigzag ? 2 : 0), bar.countLabel ? bar.countLabel.x - half : bar.x) * scale;
          const to = Math.max(bar.x + bar.width, zigTo, bar.countLabel ? bar.countLabel.x + half : 0) * scale;
          expect(left > from && left < to).toBe(false);
        }
        unmount();
      } finally {
        Element.prototype.getBoundingClientRect = rect;
        if (sw) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', sw);
        if (cw) Object.defineProperty(HTMLElement.prototype, 'clientWidth', cw);
      }
    }
  });
});

describe("VelocityChart target tile (Nov 12 2026: United's target, not a date of ours)", () => {
  it("prints United's stated target from the constant beside the pace tile", async () => {
    const { buildVelocityChart } = await import('../src/lib/starlink-chart.js');
    const { UNITED_STARLINK_TARGET } = await import('../src/lib/starlink-facts.js');
    const { VelocityChart } = await import('../src/app/views/starlink/VelocityChart');
    const months = [{ ym: '2026-11', label: 'NOV 26', express: 1, mainline: 2, total: 3, cumulative: 3 }];
    render(
      <VelocityChart
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model={buildVelocityChart(months, 0) as any}
        pace={{ pace: '~13', paceNote: '8-wk trailing pace', target: UNITED_STARLINK_TARGET }}
      />,
    );
    const stats = document.getElementById('sl-velo-stats') as HTMLElement;
    expect(stats.textContent).toContain("United's target");
    expect(document.getElementById('sl-target')?.textContent).toBe('End of 2027');
    expect(document.getElementById('sl-target-note')?.textContent).toBe('fleet-wide · stated Oct 20, 2026');
    expect(stats.textContent).not.toMatch(/ETA|at current pace/);
    // The pace tile is unchanged.
    expect(document.getElementById('sl-trend-pace')?.textContent).toBe('~13');
  });
});
