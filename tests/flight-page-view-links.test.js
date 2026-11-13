// What the flight page links (src/lib/flight-page-view.js, links everywhere Nov 2026): hub route
// ends to their hub pages, the tail to the dashboard's aircraft dialog when the fleet database or
// the Starlink roster knows it, the type to its fleet page by the fleet database's type for the
// tail (never by a model code), Starlink Wi-Fi to the Starlink tab. DOM-free.
import { describe, expect, it } from 'vitest';

import { D, payloadFor, scheduledCase, ua929Aircraft } from './fixtures/flight-page-fixtures.js';
import { aircraftFacts, indexStarlinkRoster } from '../src/lib/flight-page-data.js';
import {
  LINKED_TAIL_SOURCES,
  aircraftLinks,
  aircraftView,
  airportEnd,
  flightHistoryView,
  flightPageView,
} from '../src/lib/flight-page-view.js';

const FLEET = [
  { r: 'N686UA', t: '767-300ER', w: 'Satl Ku', c: '46J/22PP/43E+/56Y', seats: { J: 46, PP: 22, 'E+': 43, Y: 56 }, tot: 167 },
  { r: 'N37422', t: '737-900ER', w: 'Starlink', tot: 179 },
  { r: 'N73275', t: '737-900', w: 'Satl Ku', tot: 179 },
];
const ROSTER = indexStarlinkRoster([
  { tail: 'N37422', fleet: 'Mainline', type: '737-900' }, // the tracker's words disagree with the database
  { tail: 'N515GJ', fleet: 'Express', type: 'CRJ-550', operator: 'GoJet dba UAX' },
]);

describe('aircraftFacts: the fleet database type for the tail', () => {
  it('takes typeCode from the fleet row, never from the schedule model code or the roster', () => {
    // B739 is both the 737-900 and the 737-900ER; the tail decides.
    expect(aircraftFacts('N37422', { fleet: FLEET, starlink: ROSTER, modelCode: 'B739' })).toMatchObject({ typeCode: '737-900ER', source: 'fleet' });
    expect(aircraftFacts('N73275', { fleet: FLEET, modelCode: 'B739' })).toMatchObject({ typeCode: '737-900', source: 'fleet' });
    expect(aircraftFacts('N686UA', { fleet: FLEET })).toMatchObject({ typeCode: '767-300ER' });
  });

  it('a tail the fleet database does not know has no typeCode, whatever its type text', () => {
    expect(aircraftFacts('N515GJ', { fleet: FLEET, starlink: ROSTER, operator: 'GJS' })).toMatchObject({ typeCode: null, source: 'roster' });
    expect(aircraftFacts('N999ZZ', { fleet: FLEET, modelCode: 'B739' })).toMatchObject({ type: 'B739', typeCode: null, source: 'schedule' });
    expect(aircraftFacts('', { fleet: FLEET, modelText: '737-900ER' })).toMatchObject({ reg: null, typeCode: null });
  });
});

describe('aircraftLinks', () => {
  it('a mainline tail: the tail to the aircraft dialog, the type to its fleet page', () => {
    const facts = aircraftFacts('N37422', { fleet: FLEET, starlink: ROSTER, modelCode: 'B739' });
    expect(aircraftLinks(facts)).toEqual({ reg: '/?aircraft=N37422', type: '/fleet/737-900er', wifi: '/#starlink' });
    expect(aircraftLinks(ua929Aircraft)).toEqual({ reg: '/?aircraft=N686UA', type: '/fleet/767-300er', wifi: null });
  });

  it('a roster Express tail links its tail; its type and operator stay text', () => {
    const facts = aircraftFacts('N515GJ', { fleet: FLEET, starlink: ROSTER, operator: 'GJS' });
    expect(LINKED_TAIL_SOURCES).toEqual(['fleet', 'roster']);
    expect(aircraftLinks(facts)).toEqual({ reg: '/?aircraft=N515GJ', type: null, wifi: '/#starlink' });
  });

  it('a tail only the schedule named, a model code and a missing aircraft print as text', () => {
    const facts = aircraftFacts('N999ZZ', { fleet: FLEET, modelCode: 'B772' });
    expect(aircraftLinks(facts)).toEqual({ reg: null, type: null, wifi: null });
    // A payload without typeCode (an older cached answer) never links by its printed type.
    expect(aircraftLinks({ ...ua929Aircraft, typeCode: undefined }).type).toBeNull();
    expect(aircraftLinks(null)).toEqual({ reg: null, type: null, wifi: null });
  });
});

describe('aircraftView: the card prints the same words, in linkable parts', () => {
  it('splits the type from the seats and operator; the parts read as the summary', () => {
    const view = aircraftView(ua929Aircraft, null, { ident: 'UA929', schedDepMin: D / 60, origin: 'ORD', dest: 'LHR' });
    expect(view.regHref).toBe('/?aircraft=N686UA');
    expect(view.summaryParts).toEqual([
      { text: 'Boeing 767-300ER', href: '/fleet/767-300er' },
      { text: ' · 167 seats', href: null },
    ]);
    expect(view.summaryParts.map((p) => p.text).join('')).toBe(view.summary);

    const express = aircraftView(aircraftFacts('N515GJ', { fleet: FLEET, starlink: ROSTER, operator: 'GJS' }), null, { ident: 'UA4321' });
    expect(express.summaryParts.map((p) => p.text).join('')).toBe(express.summary);
    expect(express.summaryParts.every((p) => p.href === null)).toBe(true);
    expect(express.wifi).toEqual({ text: 'Starlink Wi-Fi', starlink: true, href: '/#starlink' });
  });

  it('no aircraft: one text part, no links', () => {
    const view = aircraftView(null, null, {});
    expect(view.regHref).toBeNull();
    expect(view.summaryParts).toEqual([{ text: view.summary, href: null }]);
  });

  it('the recent legs link their hub ends', () => {
    const dep = D / 60;
    const tail = {
      reg: 'N686UA',
      rows: [
        { flight_no: 'UA930', service_date: '2026-11-10', origin: 'LHR', dest: 'ORD', sched_dep: dep - 600, sched_arr: dep - 120, dep_at: dep - 596, dep_basis: 'gate', arr_at: dep - 120, arr_basis: 'gate', outcome: 'operated', final: true },
        { flight_no: 'UA9999', service_date: '2026-11-09', origin: 'EWR', dest: 'SFO', sched_dep: dep - 3000, sched_arr: dep - 2600, dep_at: dep - 2996, dep_basis: 'gate', arr_at: dep - 2600, arr_basis: 'gate', outcome: 'operated', final: true },
      ],
    };
    const view = aircraftView(ua929Aircraft, tail, { ident: 'UA929', schedDepMin: dep, origin: 'ORD', dest: 'LHR' });
    expect(view.legs.map((l) => [l.flight, l.route.origin, l.route.dest])).toEqual([
      ['UA930', { code: 'LHR', href: null }, { code: 'ORD', href: '/hubs/ord' }],
      ['UA9999', { code: 'EWR', href: '/hubs/ewr' }, { code: 'SFO', href: '/hubs/sfo' }],
    ]);
    // A leg's key (flight, day, origin) stays the same across refreshes, even when its times arrive.
    expect(view.legs.map((l) => l.key)).toEqual(['UA930|2026-11-10|LHR', 'UA9999|2026-11-09|EWR']);
  });
});

describe('route ends', () => {
  it('a hub end links to its hub page; any other airport is text', () => {
    expect(airportEnd('ord')).toEqual({ code: 'ORD', href: '/hubs/ord' });
    expect(airportEnd('GUM')).toEqual({ code: 'GUM', href: '/hubs/gum' });
    expect(airportEnd('LHR')).toEqual({ code: 'LHR', href: null });
    expect(airportEnd('')).toEqual({ code: '', href: null });
  });

  it('the trip block and the 30-day card link the hub ends', () => {
    const { row, nowSec } = scheduledCase();
    const view = flightPageView(payloadFor(row), nowSec);
    expect(view.trip.origin).toMatchObject({ code: 'ORD', href: '/hubs/ord' });
    expect(view.trip.dest).toMatchObject({ code: 'LHR', href: null });
    const history = flightHistoryView({ origin: 'ORD', dest: 'LHR', today: '2026-11-11', rows: [] });
    expect(history.route).toEqual({ origin: { code: 'ORD', href: '/hubs/ord' }, dest: { code: 'LHR', href: null } });
    expect(history.routeLabel).toBe('ORD → LHR');
    // A flight we have prints its route line in city words, not codes: nothing to link there.
    expect(view.route).toBeNull();
  });

  it('a flight we do not have: the last route it flew links its hub ends', () => {
    const view = flightPageView({ v: 1, ident: 'UA929', status: 'not-found', lastSeen: { date: '2026-11-07', origin: 'EWR', dest: 'LHR' } }, D);
    expect(view.status).toBe('not-found');
    expect(view.routeLine).toBe('EWR → LHR');
    expect(view.route).toEqual({ origin: { code: 'EWR', href: '/hubs/ewr' }, dest: { code: 'LHR', href: null } });
    expect(flightPageView({ v: 1, ident: 'UA929', status: 'not-found' }, D).route).toBeNull();
  });
});
