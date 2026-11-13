// @vitest-environment jsdom
/**
 * The Fleet tab links the names it prints (links everywhere, part 2, slice 2c).
 *
 *  - Tails go to the aircraft dialog in place (`TailLink`): the row's link-coloured link in the All
 *    Aircraft, Airborne Now and United Express tables and on a Special card.
 *  - A type goes to this tab filtered to it (`TypeLink`, by the row's tail): quiet, and plain text in
 *    a list already filtered to that type (ruling 1). Followed here it sets the type filter and keeps
 *    the rest (ruling 2).
 *  - Route hub ends go to their Schedule board (`HubLink`); a United flight number to its page.
 *  - The "SL" mark goes to the Starlink tab.
 *  - Counts that summarize a list are buttons that set its filter (ruling 7).
 *  - Nothing that is not a link or button is painted in link colour.
 *
 * Mounted in the real UiProvider, ScheduleProvider and FollowProvider, so a click follows the link
 * the way the dashboard does; the fleet and feed stores are stubbed with a small database, and the
 * Schedule store's watch-list collaborators as in tests/entity-links.test.tsx.
 */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedValue } from '../src/app/state/feed';
import type { FleetValue } from '../src/app/state/fleet';
import { FollowProvider } from '../src/app/state/follow-link';
import { ScheduleProvider } from '../src/app/state/schedule';
import { UiProvider, useUi } from '../src/app/state/ui';
import type { UiValue } from '../src/app/state/ui';
import FleetView from '../src/app/views/FleetView';

const ctl = vi.hoisted(() => ({ fleet: null as unknown, flights: [] as unknown[] }));

vi.mock('../src/app/state/fleet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/fleet')>()),
  useFleet: () => ctl.fleet as FleetValue,
}));
vi.mock('../src/app/state/feed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/state/feed')>()),
  useFeed: () => ({ flights: ctl.flights, lastGoodTs: null }) as unknown as FeedValue,
}));
vi.mock('../src/app/state/watch', () => ({ useWatch: () => ({ watched: [] }) }));
vi.mock('../src/app/state/watch-alerts', () => ({ useWatchAlerts: () => ({ observe: () => {} }) }));

// 6 A319s and 2 737 MAX 9s, the MAX 9s on Starlink.
const FLEET_DB = [
  ...Array.from({ length: 6 }, (_, i) => ({ r: `N10${i}UA`, t: 'A319', w: 'Satl Ku', s: '', d: '2000' })),
  { r: 'N37502', t: '737 MAX 9', w: 'Starlink', s: '', d: '2018' },
  { r: 'N37503', t: '737 MAX 9', w: 'Starlink', s: '', d: '2018' },
];

function fleetValue(overrides: Partial<Record<keyof FleetValue, unknown>> = {}): FleetValue {
  return {
    fleetDb: FLEET_DB,
    fleetByReg: Object.fromEntries(FLEET_DB.map((a) => [a.r, a])),
    starlink: {
      tails: new Set(['N37502', 'N37503']),
      flightsByTail: {},
      stats: null,
      aircraft: [],
      lastUpdated: null,
      syncedAt: null,
      degraded: false,
    },
    fleetSummary: null,
    special: new Map(),
    loading: false,
    loadFailed: false,
    retry: () => {},
    expressDb: [],
    expressByReg: {},
    expressStatus: 'ready',
    ...overrides,
  } as unknown as FleetValue;
}

/** The UI store as the last render saw it. */
const seen: { ui: UiValue | null } = { ui: null };
function Probe() {
  seen.ui = useUi();
  return null;
}

/** The dashboard on the Fleet tab (`#fleet`), so a link to it is followed as a stay. */
function mount(url = '/#fleet') {
  window.history.replaceState(null, '', url);
  return render(
    <UiProvider>
      <ScheduleProvider defaultHub="ORD">
        <FollowProvider>
          <FleetView />
          <Probe />
        </FollowProvider>
      </ScheduleProvider>
    </UiProvider>,
  );
}

/** The visible sub-view's panel. */
const panel = () => document.querySelector('#fleet-lookup-zone [role="tabpanel"][data-state="active"]') as HTMLElement;
/** Its body rows. */
const bodyRows = () => [...panel().querySelectorAll('tbody tr')] as HTMLElement[];
/** The row whose first cell starts with `reg`. */
const rowOf = (reg: string) => {
  const row = bodyRows().find((r) => r.querySelector('td')?.textContent?.startsWith(reg));
  if (!row) throw new Error(`no row for ${reg}`);
  return row;
};
const cells = (row: HTMLElement) => [...row.querySelectorAll('td')] as HTMLElement[];
const classesOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/);
/** A bare `underline` class (the quiet tone's at-rest mark), not `hover:underline`. */
const isQuiet = (el: Element) => classesOf(el).includes('underline') && !classesOf(el).includes('text-primary');
const isIdentity = (el: Element) => classesOf(el).includes('text-primary');

const typeSelect = () => screen.getByRole('combobox', { name: 'Fleet type filter' });
const searchBox = () => screen.getByRole('searchbox', { name: 'Fleet search' }) as HTMLInputElement;
const activeSubView = () => document.querySelector('#fleet-lookup-zone [role="tab"][data-state="active"]')?.textContent ?? '';

/** Pick a Fleet sub-view tab, as a mouse does (Radix activates a trigger on a primary mouse-down). */
function openSubView(name: RegExp) {
  const tab = [...document.querySelectorAll<HTMLElement>('#fleet-lookup-zone [role="tab"]')].find((el) =>
    name.test(el.textContent ?? ''),
  )!;
  fireEvent.mouseDown(tab, { button: 0 });
  expect(activeSubView()).toMatch(name);
}

async function searchFor(value: string) {
  fireEvent.change(searchBox(), { target: { value } });
  await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
}

const scrolls: string[] = [];
async function nextFrame() {
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.HTMLElement.prototype.hasPointerCapture ??= () => false;
});

beforeEach(() => {
  ctl.fleet = fleetValue();
  ctl.flights = [];
  scrolls.length = 0;
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    if (this.id === 'fleet-controls') scrolls.push('controls');
    else if (this.getAttribute('role') === 'tabpanel') scrolls.push(`panel:${this.id.replace(/^.*-content-/, '')}`);
    else scrolls.push(this.id || this.tagName.toLowerCase());
  };
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no network in this test'))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  seen.ui = null;
  window.history.replaceState(null, '', '/');
});

describe('All Aircraft', () => {
  it('the tail is the row\'s link-coloured link, to its aircraft dialog, opened in place', () => {
    mount();
    const [regCell] = cells(rowOf('N100UA'));
    const link = within(regCell).getByRole('link', { name: 'N100UA' });
    expect(link.getAttribute('href')).toBe('/?aircraft=N100UA');
    expect(isIdentity(link)).toBe(true);
    // A link, not a button painted like one.
    expect(regCell.querySelector('button')).toBeNull();

    expect(fireEvent.click(link)).toBe(false);
    expect(seen.ui!.aircraftReg).toBe('N100UA');
    expect(seen.ui!.tab).toBe('fleet');
  });

  it('the type is a quiet link to this tab filtered to it; followed here it keeps the search (ruling 2)', async () => {
    mount();
    await searchFor('N');
    await nextFrame();
    scrolls.length = 0;
    const typeCell = cells(rowOf('N37502'))[1];
    const link = within(typeCell).getByRole('link', { name: '737 MAX 9' });
    expect(link.getAttribute('href')).toBe('/?tab=fleet&type=737%20MAX%209');
    expect(isQuiet(link)).toBe(true);

    expect(fireEvent.click(link)).toBe(false);
    await nextFrame();

    expect(typeSelect().textContent).toContain('737 MAX 9');
    expect(searchBox().value).toBe('N');
    expect(bodyRows().map((r) => cells(r)[0].textContent)).toEqual(['N37502', 'N37503']);
    expect(scrolls).toEqual([]);
  });

  it('in a table filtered to a type, the type cells are plain text (ruling 1)', () => {
    mount();
    fireEvent.click(within(cells(rowOf('N37502'))[1]).getByRole('link', { name: '737 MAX 9' }));
    for (const row of bodyRows()) {
      const typeCell = cells(row)[1];
      expect(typeCell.querySelector('a')).toBeNull();
      expect(typeCell.textContent).toBe('737 MAX 9');
      expect(typeCell.querySelector('.underline, .text-primary')).toBeNull();
    }
  });

  it('the SL mark is a quiet link to the Starlink tab, one per Starlink row', () => {
    mount();
    const sl = within(rowOf('N37502')).getByRole('link', { name: 'SL (Starlink tab)' });
    expect(sl.getAttribute('href')).toBe('/#starlink');
    expect(isQuiet(sl)).toBe(true);
    expect(rowOf('N37502').querySelectorAll('a[href="/#starlink"]')).toHaveLength(1);
    expect(rowOf('N100UA').querySelector('a[href="/#starlink"]')).toBeNull();

    expect(fireEvent.click(sl)).toBe(false);
    expect(seen.ui!.tab).toBe('starlink');
  });

  it('one link-coloured link per row, and every link 44 px tall on touch inside its cell', () => {
    mount();
    const row = rowOf('N37502');
    const links = [...row.querySelectorAll('a')];
    expect(links.filter(isIdentity)).toHaveLength(1);
    for (const link of links) {
      // The target is the element itself, relaxed only for a mouse at md+: no `after:` box reaches
      // into a neighbouring cell or row.
      expect(classesOf(link)).toContain('min-h-11');
      expect(classesOf(link)).toContain('pointer-fine:md:min-h-0');
      expect(classesOf(link).filter((c) => c.includes('after:'))).toEqual([]);
    }
  });
});

/** A live-feed row, airborne. */
const airborne = (reg: string, extra: Record<string, unknown>) => ({
  fr24id: `${reg}-fr24`, icao24: `${reg}-icao`, lat: 0, lon: 0, hdg: 0, alt: 10000, spd: 230, vr: 0,
  squawk: null, acType: '', reg, origin: 'ORD', dest: 'DEN', flightIATA: '', callsign: '',
  onGround: false, airline: 'UAL', ...extra,
});

describe('Airborne Now', () => {
  beforeEach(() => {
    ctl.flights = [
      airborne('N100UA', { flightIATA: 'UA100', origin: 'ORD', dest: 'HNL' }),
      airborne('N37502', { callsign: 'UAL200', origin: 'SFO', dest: 'DEN' }),
      airborne('N801SK', { callsign: 'SKW5501', acType: 'E75L' }), // regional: no row
    ];
  });

  it('links the tail (link colour), the type, a United flight number and the hub ends (quiet)', () => {
    mount();
    openSubView(/^Airborne Now/);
    expect(bodyRows()).toHaveLength(2);
    const [reg, type, flight, route] = cells(rowOf('N100UA'));

    const tail = within(reg).getByRole('link', { name: 'N100UA' });
    expect(tail.getAttribute('href')).toBe('/?aircraft=N100UA');
    expect(isIdentity(tail)).toBe(true);
    expect(reg.querySelector('button')).toBeNull();

    const typeLink = within(type).getByRole('link', { name: 'A319' });
    expect(typeLink.getAttribute('href')).toBe('/?tab=fleet&type=A319');
    expect(isQuiet(typeLink)).toBe(true);

    const number = within(flight).getByRole('link', { name: 'UA100' });
    expect(number.getAttribute('href')).toBe('/flight/UA100');
    expect(isQuiet(number)).toBe(true);

    // ORD is a hub: its Schedule board. HNL is not: plain text.
    const ord = within(route).getByRole('link', { name: 'ORD' });
    expect(ord.getAttribute('href')).toBe('/?tab=schedule&hub=ORD');
    expect(isQuiet(ord)).toBe(true);
    expect(within(route).queryByRole('link', { name: 'HNL' })).toBeNull();
    expect(within(route).getByText('HNL').tagName).toBe('SPAN');

    expect(rowOf('N100UA').querySelectorAll('a').length).toBe(4);
    expect([...rowOf('N100UA').querySelectorAll('a')].filter(isIdentity)).toHaveLength(1);
  });

  it('a mainline callsign links to its United number; the SL mark to the Starlink tab', () => {
    mount();
    openSubView(/^Airborne Now/);
    const row = rowOf('N37502');
    expect(within(cells(row)[2]).getByRole('link', { name: 'UAL200' }).getAttribute('href')).toBe('/flight/UA200');
    expect(within(row).getByRole('link', { name: /^SL/ }).getAttribute('href')).toBe('/#starlink');
    // Both route ends are hubs, and both link.
    expect(within(cells(row)[3]).getAllByRole('link').map((a) => a.textContent)).toEqual(['SFO', 'DEN']);
  });

  it('a hub end opens that hub\'s Schedule board in place', () => {
    mount();
    openSubView(/^Airborne Now/);
    expect(fireEvent.click(within(cells(rowOf('N37502'))[3]).getByRole('link', { name: 'DEN' }))).toBe(false);
    expect(seen.ui!.tab).toBe('schedule');
  });

  it('a type followed here keeps Airborne Now, and its cells are then plain (ruling 1)', () => {
    mount();
    openSubView(/^Airborne Now/);
    fireEvent.click(within(cells(rowOf('N100UA'))[1]).getByRole('link', { name: 'A319' }));
    expect(activeSubView()).toMatch(/^Airborne Now/);
    expect(typeSelect().textContent).toContain('A319');
    expect(bodyRows()).toHaveLength(1);
    const typeCell = cells(rowOf('N100UA'))[1];
    expect(typeCell.querySelector('a')).toBeNull();
    expect(typeCell.textContent).toBe('A319');
  });

  it('the hub ends\' touch boxes are spaced apart, tight only for a mouse at md+', () => {
    mount();
    openSubView(/^Airborne Now/);
    const route = cells(rowOf('N37502'))[3];
    const arrow = route.querySelector('[aria-hidden="true"]')!;
    expect(classesOf(arrow)).toEqual(expect.arrayContaining(['mx-3', 'pointer-fine:md:mx-1']));
    // The screen reader hears "SFO to DEN", not a bare "SFO DEN".
    expect(route.textContent).toBe('SFO> to DEN');
  });
});

describe('Special', () => {
  beforeEach(() => {
    ctl.fleet = fleetValue({ special: new Map([['N100UA', { name: 'Sam E. Ashmore', type: 'named' }]]) });
    ctl.flights = [airborne('N100UA', { flightIATA: 'UA576', origin: 'EWR', dest: 'LHR' })];
  });

  /** The card for `reg` (its first one). */
  const cardOf = (reg: string) => {
    const card = [...panel().querySelectorAll('li')].find((li) => li.querySelector(`a[data-tail-link="${reg}"]`));
    if (!card) throw new Error(`no card for ${reg}`);
    return card as HTMLElement;
  };

  it('the tail is the card\'s link-coloured link; the type a quiet link by the tail', () => {
    mount();
    openSubView(/^Special/);
    const card = cardOf('N100UA');
    expect(card.querySelector('button')).toBeNull();
    const tail = within(card).getByRole('link', { name: 'N100UA' });
    expect(tail.getAttribute('href')).toBe('/?aircraft=N100UA');
    expect(isIdentity(tail)).toBe(true);
    const type = within(card).getByRole('link', { name: 'A319' });
    expect(type.getAttribute('href')).toBe('/?tab=fleet&type=A319');
    expect(isQuiet(type)).toBe(true);
    // The delivery year stays plain beside it.
    expect(card.textContent).toContain('A319 · Del 2000');
  });

  it('an airborne card links its United flight number and hub ends, quiet; other airports plain', () => {
    mount();
    openSubView(/^Special/);
    const card = cardOf('N100UA');
    const number = within(card).getByRole('link', { name: 'UA576' });
    expect(number.getAttribute('href')).toBe('/flight/UA576');
    expect(isQuiet(number)).toBe(true);
    expect(within(card).getByRole('link', { name: 'EWR' }).getAttribute('href')).toBe('/?tab=schedule&hub=EWR');
    expect(within(card).queryByRole('link', { name: 'LHR' })).toBeNull();
    expect([...card.querySelectorAll('a')].filter(isIdentity)).toHaveLength(1);
  });

  it('a curated livery off the mainline database: its tail links, its "not in the database" line is plain', () => {
    mount();
    openSubView(/^Special/);
    // N91007 is a curated livery the fixture database does not list.
    const card = cardOf('N91007');
    expect(within(card).getAllByRole('link').map((a) => a.textContent)).toEqual(['N91007']);
    expect(card.textContent).toContain('Not in the mainline fleet database');
  });

  it('a type followed from a card opens All Aircraft filtered to it (ruling 2: Special does not list a type)', () => {
    mount();
    openSubView(/^Special/);
    fireEvent.click(within(cardOf('N100UA')).getByRole('link', { name: 'A319' }));
    expect(activeSubView()).toMatch(/^All Aircraft/);
    expect(typeSelect().textContent).toContain('A319');
    expect(bodyRows()).toHaveLength(6);
  });
});

describe('United Express', () => {
  const EXPRESS = [
    { r: 'N140SY', t: 'E175', tk: 'E175-70', o: 'SkyWest Airlines', oc: 'SKW', w: 'Starlink', c: '', fs: '2026-10-01T05:00:00Z', ls: '2026-10-04T18:13:07Z', lf: 'UA6005', x: true },
    { r: 'N85377', t: 'E175', tk: 'E175', o: 'SkyWest Airlines', oc: 'SKW', w: '', c: '', fs: '2026-10-01T06:00:00Z', ls: '2026-10-02T12:00:00Z', lf: 'UA5928', x: true },
    { r: 'N504GJ', t: 'CRJ550', tk: 'CRJ550', o: 'GoJet Airlines', oc: 'GJS', w: 'Starlink', c: '', fs: '2026-10-01T06:00:00Z', ls: '2026-11-03T12:00:00Z', lf: 'G74576', x: true },
    { r: 'N14148', t: '', tk: '', o: 'CommutAir', oc: 'UCA', w: '', c: '', fs: '2026-10-01T05:00:00Z', ls: '2026-10-04T18:13:06Z', lf: '', x: true },
  ];
  beforeEach(() => {
    ctl.fleet = fleetValue({
      expressDb: EXPRESS,
      expressByReg: Object.fromEntries(EXPRESS.map((e) => [e.r, e])),
    });
  });

  const expressSearch = () => screen.getByRole('searchbox', { name: 'United Express search' }) as HTMLInputElement;
  const chip = (name: RegExp) => screen.getByRole('button', { name });

  it('the tail is the row\'s link-coloured link; a United last flight a quiet link; G7 plain (ruling 4)', () => {
    mount();
    openSubView(/^United Express/);
    const tail = within(cells(rowOf('N140SY'))[0]).getByRole('link', { name: 'N140SY' });
    expect(tail.getAttribute('href')).toBe('/?aircraft=N140SY');
    expect(isIdentity(tail)).toBe(true);
    expect(fireEvent.click(tail)).toBe(false);
    expect(seen.ui!.aircraftReg).toBe('N140SY');

    const lastFlight = within(rowOf('N140SY')).getByRole('link', { name: 'UA6005' });
    expect(lastFlight.getAttribute('href')).toBe('/flight/UA6005');
    expect(isQuiet(lastFlight)).toBe(true);
    // GoJet's own number has no flight page: plain text.
    expect(within(rowOf('N504GJ')).queryByRole('link', { name: 'G74576' })).toBeNull();
    expect(rowOf('N504GJ').textContent).toContain('G74576');
    // The regional type and the operator have no home.
    expect([...rowOf('N140SY').querySelectorAll('a')].map((a) => a.textContent)).toEqual(['N140SY', 'UA6005']);
  });

  it('an operator chip sets the search to its name and, pressed again, clears it', () => {
    mount();
    openSubView(/^United Express/);
    fireEvent.change(expressSearch(), { target: { value: 'zzz' } });
    const skywest = chip(/SkyWest Airlines 2/);
    expect(skywest.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(skywest);
    expect(expressSearch().value).toBe('SkyWest Airlines');
    expect(chip(/SkyWest Airlines 2/).getAttribute('aria-pressed')).toBe('true');
    expect(bodyRows().map((r) => cells(r)[0].textContent)).toEqual(['N140SY', 'N85377']);

    fireEvent.click(chip(/SkyWest Airlines 2/));
    expect(expressSearch().value).toBe('');
    expect(bodyRows()).toHaveLength(4);
  });

  it('a type chip and the Starlink count list exactly what they count', () => {
    mount();
    openSubView(/^United Express/);
    fireEvent.click(chip(/CRJ550 1/));
    expect(bodyRows().map((r) => cells(r)[0].textContent)).toEqual(['N504GJ']);
    // Another chip replaces the search; the first is no longer pressed.
    fireEvent.click(screen.getByRole('button', { name: 'Show 2 Starlink aircraft in the list below' }));
    expect(expressSearch().value).toBe('Starlink');
    expect(bodyRows().map((r) => cells(r)[0].textContent)).toEqual(['N140SY', 'N504GJ']);
    expect(chip(/CRJ550 1/).getAttribute('aria-pressed')).toBe('false');
    expect(chip(/2 Starlink/).getAttribute('aria-pressed')).toBe('true');
  });

  it('the "Unknown type" bucket stays text: no word lists it', () => {
    mount();
    openSubView(/^United Express/);
    expect(screen.queryByRole('button', { name: /Unknown type/ })).toBeNull();
    expect(panel().textContent).toContain('Unknown type 1');
  });

  it('a chip is named by its words plus "Show … aircraft in the list below", and is 44 px tall on touch', () => {
    mount();
    openSubView(/^United Express/);
    const commutair = screen.getByRole('button', { name: 'Show CommutAir 1 aircraft in the list below' });
    expect(commutair.hasAttribute('aria-label')).toBe(false);
    expect(classesOf(commutair)).toEqual(expect.arrayContaining(['min-h-11', 'pointer-fine:md:min-h-0']));
    // Buttons, not links: no link colour, no underline.
    expect(classesOf(commutair)).not.toContain('text-primary');
    expect(classesOf(commutair)).not.toContain('underline');
  });
});

/** A Composition variant card: the button that IS the type filter. */
function typeCard(type: string): HTMLElement {
  const card = [...document.querySelectorAll<HTMLElement>('button[aria-pressed]')].find(
    (button) => button.lastElementChild?.textContent === type,
  );
  if (!card) throw new Error(`no variant card for ${type}`);
  return card;
}

describe('Fleet Pulse', () => {
  beforeEach(() => {
    ctl.flights = [
      airborne('N100UA', { flightIATA: 'UA100' }),
      airborne('N37502', { flightIATA: 'UA200' }),
      airborne('N801SK', { callsign: 'SKW5501', acType: 'E75L' }), // regional: counted, not listed
    ];
  });

  const figureButton = () => screen.getByRole('button', { name: /^3 Airborne: show the Airborne Now list$/ });
  const utilButton = () => screen.getByRole('button', { name: /fleet utilization \(2\/8\): show the Airborne Now list$/ });

  it('the airborne figure and the utilization line are buttons, named by their words, not links', () => {
    mount();
    for (const button of [figureButton(), utilButton()]) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.hasAttribute('aria-label')).toBe(false);
      expect(classesOf(button)).not.toContain('text-primary');
      expect(classesOf(button)).not.toContain('underline');
    }
    // The utilization line is 44 px tall on touch; the figure is taller than that already.
    expect(classesOf(utilButton())).toEqual(expect.arrayContaining(['min-h-11', 'pointer-fine:md:min-h-0']));
  });

  /** What the Fleet tab shows after a frame, then its Express search (read by opening that list). */
  async function fleetState() {
    await nextFrame();
    const result = {
      subView: activeSubView(),
      type: typeSelect().textContent,
      status: screen.getByRole('combobox', { name: 'Fleet status filter' }).textContent,
      wifi: screen.getByRole('combobox', { name: 'Fleet WiFi filter' }).textContent,
      search: searchBox().value,
      rows: bodyRows().map((r) => cells(r)[0].textContent),
      scrolls: [...scrolls],
    };
    openSubView(/^United Express/);
    return { ...result, expressSearch: (screen.getByRole('searchbox', { name: 'United Express search' }) as HTMLInputElement).value };
  }

  it('from a dirty tab, either one lands where a cold load of ?view=airborne lands (ruling 9)', async () => {
    mount('/?tab=fleet&view=airborne');
    const cold = await fleetState();
    cleanup();
    expect(cold.subView).toMatch(/^Airborne Now/);
    // Airborne Now sorts by type: the 737 MAX 9 before the A319.
    expect(cold.rows).toEqual(['N37502', 'N100UA']);
    expect(cold.scrolls).toEqual(['panel:airborne']);

    for (const press of [figureButton, utilButton]) {
      scrolls.length = 0;
      mount();
      // The reader filtered the tab, searched it, and left it on United Express with a search.
      fireEvent.click(typeCard('A319'));
      await searchFor('N10');
      openSubView(/^United Express/);
      fireEvent.change(screen.getByRole('searchbox', { name: 'United Express search' }), { target: { value: 'skywest' } });
      await nextFrame();
      scrolls.length = 0;

      fireEvent.click(press());

      // Every mainline aircraft flying: the utilization's "2" of "2/8".
      expect(await fleetState()).toEqual(cold);
      cleanup();
    }
  });

  it('each type label is a quiet link to this tab filtered to it; followed here it keeps the search', async () => {
    mount();
    await searchFor('N');
    await nextFrame();
    scrolls.length = 0;
    const pulse = document.getElementById('fleet-airborne-count')!.closest('div.flex-col') as HTMLElement;
    const max9 = within(pulse).getByRole('link', { name: '737 MAX 9' });
    expect(max9.getAttribute('href')).toBe('/?tab=fleet&type=737%20MAX%209');
    expect(isQuiet(max9)).toBe(true);
    expect(classesOf(max9)).toEqual(expect.arrayContaining(['min-h-11', 'pointer-fine:md:min-h-0']));
    expect(within(pulse).getAllByRole('link').map((a) => a.textContent)).toEqual(['A319', '737 MAX 9']);

    fireEvent.click(max9);
    await nextFrame();
    expect(typeSelect().textContent).toContain('737 MAX 9');
    expect(searchBox().value).toBe('N');
    expect(scrolls).toEqual([]);
  });

  it('the type the tab is already filtered to prints plain there (ruling 1); the others still link', () => {
    mount();
    fireEvent.click(typeCard('737 MAX 9'));
    const pulse = document.getElementById('fleet-airborne-count')!.closest('div.flex-col') as HTMLElement;
    expect(within(pulse).getAllByRole('link').map((a) => a.textContent)).toEqual(['A319']);
    const plain = within(pulse).getByText('737 MAX 9');
    expect(plain.tagName).toBe('SPAN');
    expect(classesOf(plain)).not.toContain('underline');
  });

  it('before the fleet database can list anything, the counts are text', () => {
    ctl.fleet = fleetValue({ fleetDb: [], fleetByReg: {}, loading: true });
    mount();
    expect(screen.queryByRole('button', { name: /show the Airborne Now list/ })).toBeNull();
    expect(document.getElementById('fleet-airborne-count')!.textContent).toBe('3');
  });
});

describe('Fleet Health', () => {
  const today = new Date().toISOString().slice(0, 10);
  beforeEach(() => {
    // A named aircraft carries its name as a status note, as on the real database: the health
    // panel counts it active, Status "Active" (no note) does not list it.
    const db = [...FLEET_DB.slice(0, 7), { ...FLEET_DB[7], s: '*Sam E. Ashmore' }];
    ctl.fleet = fleetValue({
      fleetDb: db,
      fleetByReg: Object.fromEntries(db.map((a) => [a.r, a])),
      starlink: {
        tails: new Set(['N37502', 'N37503']),
        flightsByTail: {},
        stats: { total: 602, mainline: 247, express: 355, mainlineTotal: 1156, expressTotal: 513 },
        aircraft: [{ tail: 'N37502', fleet: 'Mainline', type: '737 MAX 9', dateFound: today }],
        lastUpdated: null,
        syncedAt: null,
        degraded: false,
      },
    });
  });

  const chipList = () => screen.getByText('Total').closest('ul') as HTMLElement;

  it('"Total" is a quiet link to the Starlink tab, followed in place', () => {
    mount();
    const total = within(chipList()).getByRole('link', { name: '602 Total (Starlink tab)' });
    expect(total.getAttribute('href')).toBe('/#starlink');
    expect(isQuiet(total)).toBe(true);
    expect(classesOf(total)).toEqual(expect.arrayContaining(['min-h-11', 'pointer-fine:md:min-h-0']));
    expect(fireEvent.click(total)).toBe(false);
    expect(seen.ui!.tab).toBe('starlink');
  });

  it('no other chip is a link, and none is painted in link colour', () => {
    mount();
    expect(within(chipList()).getAllByRole('link')).toHaveLength(1);
    expect(within(chipList()).getByText('Mainline')).toBeTruthy();
    expect(within(chipList()).getByText('New (7d)')).toBeTruthy();
    expect(chipList().querySelectorAll('[class*="text-primary"]')).toHaveLength(0);
  });

  it('the health counts and bars stay text: no Status option lists exactly what they count', () => {
    mount();
    const health = screen.getByText('Total Mainline Aircraft').closest('div.flex-col') as HTMLElement;
    expect(health.textContent).toContain('8 active (100.0%) · 0 out of service');
    // Status "Active" lists the 7 aircraft with no note, not the 8 counted active.
    const healthCounts = screen.getByText('Total Mainline Aircraft').parentElement!.parentElement!.parentElement as HTMLElement;
    expect(healthCounts.querySelectorAll('button, a')).toHaveLength(0);
  });
});

describe('Composition and the delivery timeline', () => {
  it('the route callouts are body text, not link colour, and link nothing', () => {
    mount();
    const callout = screen.getByText('ORD-LAX · EWR-SFO · West Coast-HNL');
    expect(classesOf(callout)).not.toContain('text-primary');
    expect(classesOf(callout)).toContain('text-foreground');
    expect(callout.querySelector('a')).toBeNull();
  });

  it('the newest and oldest tails are quiet links to their aircraft dialog; the average is body colour', () => {
    mount();
    const stats = screen.getByText(/^Average:/);
    expect(stats.querySelector('.text-primary')).toBeNull();
    const [newest, oldest] = within(stats).getAllByRole('link');
    expect(newest.getAttribute('href')).toBe('/?aircraft=N37502');
    expect(oldest.getAttribute('href')).toBe('/?aircraft=N100UA');
    for (const link of [newest, oldest]) {
      expect(isQuiet(link)).toBe(true);
      expect(classesOf(link)).toEqual(expect.arrayContaining(['min-h-11', 'pointer-fine:md:min-h-0']));
    }
    expect(stats.textContent).toContain('Newest: N37502 (2018)');
    expect(fireEvent.click(oldest)).toBe(false);
    expect(seen.ui!.aircraftReg).toBe('N100UA');
  });

  it('the variant cards stay the type filter\'s toggles', () => {
    mount();
    const card = typeCard('A319');
    expect(card.tagName).toBe('BUTTON');
    fireEvent.click(card);
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(typeSelect().textContent).toContain('A319');
  });
});
