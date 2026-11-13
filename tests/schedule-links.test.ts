// @vitest-environment jsdom
/**
 * Links everywhere, part 2 (Schedule, Live, Watch): what a Schedule row links, decided in the row
 * model rather than in the component (the links plan; the repo rule that logic lives in src/lib).
 *
 *  - The route's ends: the board's own hub is plain (ruling 1); the other end links to its board
 *    only when it is one of the nine hubs (`routeEnds`).
 *  - The aircraft type: by the tail only (`fleetTypeCodeFor`), never from the feed's ICAO code or
 *    provider text (ruling 5). A319 and A320 are ICAO codes AND fleet type codes, so a row with no
 *    tail must not link them.
 *  - The FAA context: each airport in it carries its code and the status link's kind, so the
 *    component never parses "Ground Stop at EWR, avg 45 min" (`scheduleFaaParts`). The joined text
 *    stays exactly what `getFAADelayContext` printed.
 *  - The Starlink mark: one link per row, to the Starlink tab (`starlinkHref`).
 *  (The tab addresses themselves: tests/tab-links.test.js.)
 */

import { describe, expect, it } from 'vitest';

import { faaContextText, faaDelayContextParts, getFAADelayContext } from '../src/lib/faa-context.js';
import { buildScheduleRow as buildRow, routeCell, routeEnds, scheduleFaaParts } from '../src/lib/schedule-row-model.js';
import { STARLINK_TAB_HREF } from '../src/lib/starlink-link.js';

const flight = (origin: unknown, destination: unknown) => ({ airport: { origin, destination } });
/** The row model, read field by field (the lib's JSDoc types the whole row as `object`). */
const buildScheduleRow = (f: object, ctx: object) => buildRow(f, ctx) as Record<string, unknown>;
const at = (iata: string, name = '') => ({ code: { iata }, name });

describe('routeEnds: the board side is plain, the other end links only when it is another hub', () => {
  it('departures from ORD to DEN: DEN links, ORD (the board) is plain', () => {
    expect(routeEnds(flight(at('ORD'), at('DEN', 'Denver International Airport')), 'ORD', 'departures')).toEqual({
      from: { text: 'ORD', hub: null },
      to: { text: 'DEN', hub: 'DEN' },
    });
  });

  it('arrivals into DEN from SFO: SFO links, DEN (the board) is plain', () => {
    expect(routeEnds(flight(at('SFO'), at('DEN')), 'DEN', 'arrivals')).toEqual({
      from: { text: 'SFO', hub: 'SFO' },
      to: { text: 'DEN', hub: null },
    });
  });

  it('a non-hub other end is plain', () => {
    expect(routeEnds(flight(at('ORD'), at('KEF', 'Keflavik International Airport')), 'ORD', 'departures').to).toEqual({
      text: 'KEF',
      hub: null,
    });
    expect(routeEnds(flight(at('ROC'), at('ORD')), 'ORD', 'arrivals').from).toEqual({ text: 'ROC', hub: null });
  });

  it("the board's own hub at the other end too is still plain (ORD → ORD)", () => {
    expect(routeEnds(flight(at('ORD'), at('ORD')), 'ORD', 'departures')).toEqual({
      from: { text: 'ORD', hub: null },
      to: { text: 'ORD', hub: null },
    });
  });

  it('an end printed as a name (no code) or a dash never links', () => {
    expect(routeEnds(flight(at('ORD'), { code: { iata: '' }, name: 'Somewhere Regional Airport' }), 'ORD', 'departures').to).toEqual({
      text: 'Somewhere Regional',
      hub: null,
    });
    expect(routeEnds({}, 'ORD', 'departures').to).toEqual({ text: '—', hub: null });
  });

  it('a hub code recovered from the airport name links like a code', () => {
    // routeCell recovers a missing code from an unambiguous name ("Denver International Airport"
    // is DEN); the link follows what prints.
    const denver = flight(at('ORD'), { code: { iata: '' }, name: 'Denver International Airport' });
    expect(routeCell(denver, 'ORD', 'departures').routeLine).toBe('ORD → DEN');
    expect(routeEnds(denver, 'ORD', 'departures').to).toEqual({ text: 'DEN', hub: 'DEN' });
  });

  it('prints exactly what routeLine prints, end for end', () => {
    const cases: [object, string, 'departures' | 'arrivals'][] = [
      [flight(at('ORD'), at('DEN')), 'ORD', 'departures'],
      [flight(at('SFO'), at('DEN')), 'DEN', 'arrivals'],
      [flight(at('ORD'), { code: { iata: '' }, name: 'Unknown' }), 'ORD', 'departures'],
      [{}, 'EWR', 'arrivals'],
    ];
    for (const [f, hub, dir] of cases) {
      const ends = routeEnds(f, hub, dir);
      expect(`${ends.from.text} → ${ends.to.text}`).toBe(routeCell(f, hub, dir).routeLine);
    }
  });
});

describe('scheduleFaaParts: the code beside the words, with the status link chosen', () => {
  const index = {
    EWR: { airportCode: 'EWR', delays: [{ type: 'ground_stop', avgDelay: 45 }] },
    LGA: { airportCode: 'LGA', delays: [{ type: 'ground_delay', avgDelay: 18 }] },
    ORD: { airportCode: 'ORD', delays: [{ type: 'Ground Delay Program' }] },
  };

  it('a hub links to its Weather card, any other airport to the NAS panel', () => {
    expect(scheduleFaaParts(index, 'EWR', 'LGA')).toEqual([
      { lead: 'Ground Stop at ', code: 'EWR', tail: ', avg 45 min', kind: 'weather' },
      { lead: 'GDP at ', code: 'LGA', tail: ', avg 18 min', kind: 'nas' },
    ]);
  });

  it('joins to exactly the sentence getFAADelayContext prints', () => {
    for (const [o, d] of [
      ['EWR', 'ORD'],
      ['EWR', 'LGA'],
      ['DEN', 'LAX'],
      [undefined, 'ORD'],
    ] as [string | undefined, string | undefined][]) {
      expect(faaContextText(faaDelayContextParts(index, o, d))).toBe(getFAADelayContext(index, o, d));
      expect(faaContextText(scheduleFaaParts(index, o, d))).toBe(getFAADelayContext(index, o, d));
    }
    expect(scheduleFaaParts(index, 'DEN', 'LAX')).toEqual([]);
  });
});

describe('buildScheduleRow: the link decisions it carries', () => {
  const base = {
    identification: { number: { default: 'UA912' } },
    aircraft: { model: { code: 'A319', text: 'Airbus A319' } },
    airport: { origin: at('ORD'), destination: at('DEN') },
    time: { scheduled: { departure: 1_800_000_000 } },
  };
  const ctx = {
    hub: 'ORD',
    dir: 'departures',
    timeZone: 'America/Chicago',
    status: { key: 'scheduled', text: 'Scheduled', cls: 'scheduled' },
    fleetByReg: {
      N37502: { t: '737 MAX 9', c: '20F/159Y' },
      N75436: { t: '737-900ER' },
    },
    starlinkTails: new Set(['N37502']),
  };

  it('links the type by the tail, whatever the feed printed', () => {
    const row = buildScheduleRow({ ...base, aircraft: { model: { code: 'B739', text: 'Boeing 737-900' } } }, { ...ctx, reg: 'N75436' });
    expect(row.typeCode).toBe('737-900ER');
  });

  it('a row with no tail never links its type, not even an A319 (an ICAO code and a type code at once)', () => {
    expect(buildScheduleRow(base, { ...ctx, reg: '' }).typeCode).toBeNull();
  });

  it('a tail the fleet database does not know (an Express tail), or no database yet, links no type', () => {
    expect(buildScheduleRow(base, { ...ctx, reg: 'N140SY' }).typeCode).toBeNull();
    expect(buildScheduleRow(base, { ...ctx, reg: 'N37502', fleetByReg: {} }).typeCode).toBeNull();
  });

  it('carries the route ends', () => {
    expect(buildScheduleRow(base, { ...ctx, reg: '' }).routeEnds).toEqual({
      from: { text: 'ORD', hub: null },
      to: { text: 'DEN', hub: 'DEN' },
    });
  });

  it('carries the FAA parts it was given, and none by default', () => {
    const parts = [{ lead: 'GDP at ', code: 'DEN', tail: '', kind: 'weather' }];
    expect(buildScheduleRow(base, { ...ctx, faaContext: 'GDP at DEN', faaParts: parts }).faaParts).toEqual(parts);
    expect(buildScheduleRow(base, ctx).faaParts).toEqual([]);
  });

  it('links its Starlink mark to the Starlink tab only when the tail is a Starlink tail', () => {
    expect(buildScheduleRow(base, { ...ctx, reg: 'N37502' }).starlinkHref).toBe(STARLINK_TAB_HREF);
    expect(buildScheduleRow(base, { ...ctx, reg: 'N75436' }).starlinkHref).toBeNull();
    expect(buildScheduleRow(base, { ...ctx, reg: '' }).starlinkHref).toBeNull();
  });
});
