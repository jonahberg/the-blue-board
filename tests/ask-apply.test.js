// Ask the board — applying an answer (src/lib/ask-apply.js). Pins how each filter becomes something a
// view already does: the live map's one predicate (family, type, Starlink, region incl. the
// antimeridian boxes, air/ground, route ends, direction at a hub), the schedule board's patch onto
// its own filters and its predicate for the rest (late and on time on the stat strip's own rule),
// and the Fleet tab's search.
import { describe, expect, it } from 'vitest';

import {
  aircraftInFamily,
  aircraftIsType,
  fleetAskPatch,
  inRegion,
  makeLiveAskPredicate,
  makeScheduleAskPredicate,
  rowIsLate,
  rowIsOnTime,
  scheduleAskPatch,
  scheduleControlledFilters,
} from '../src/lib/ask-apply.js';
import { filterFleetData } from '../src/lib/fleet-utils.js';

const flight = (patch = {}) => ({ acType: 'B789', origin: 'EWR', dest: 'LHR', onGround: false, lat: 52, lon: -30, reg: 'N24976', ...patch });

describe('aircraft matching', () => {
  it('families from the ICAO designator, MAX and CRJ included', () => {
    expect(aircraftInFamily('B789', '787')).toBe(true);
    expect(aircraftInFamily('B38M', '737')).toBe(true);
    expect(aircraftInFamily('B38M', '737MAX')).toBe(true);
    expect(aircraftInFamily('B738', '737MAX')).toBe(false);
    expect(aircraftInFamily('A21N', 'A320')).toBe(true);
    expect(aircraftInFamily('E75L', 'E175')).toBe(true);
    expect(aircraftInFamily('CRJ7', 'CRJ')).toBe(true);
    expect(aircraftInFamily('', '737MAX', 'Boeing 737 MAX 9')).toBe(true);
  });
  it('types from the designator, or from the model text when the code is blank — 787-9 never matches 787-10', () => {
    expect(aircraftIsType('B789', 'B789')).toBe(true);
    expect(aircraftIsType('789', 'B789')).toBe(true);
    expect(aircraftIsType('B78X', 'B789')).toBe(false);
    expect(aircraftIsType('', 'B789', 'Boeing 787-9')).toBe(true);
    expect(aircraftIsType('', 'B788', 'Boeing 787-10')).toBe(false);
    expect(aircraftIsType('', 'B38M', 'Boeing 737 MAX 8')).toBe(true);
  });
});

describe('inRegion', () => {
  it('ordinary boxes', () => {
    expect(inRegion(52, -30, 'europe')).toBe(true);
    expect(inRegion(40, -100, 'europe')).toBe(false);
    expect(inRegion(39.8, -104.7, 'us')).toBe(true);
  });
  it('boxes that cross the antimeridian (Oceania, Pacific) wrap', () => {
    expect(inRegion(21.3, -157.9, 'pacific')).toBe(true); // Honolulu
    expect(inRegion(13.5, 144.8, 'pacific')).toBe(true); // Guam
    expect(inRegion(40, 0, 'pacific')).toBe(false);
    expect(inRegion(-17.8, 177.4, 'oceania')).toBe(true); // Nadi
    expect(inRegion(-33.9, 151.2, 'oceania')).toBe(true); // Sydney
    expect(inRegion(21.3, 202.1, 'pacific')).toBe(true); // a longitude already past 180
  });
  it('a missing position is never inside', () => {
    expect(inRegion(Number.NaN, 0, 'europe')).toBe(false);
  });
});

describe('the live map predicate', () => {
  const starlinkTails = new Set(['N24976']);
  const isStarlink = (f) => starlinkTails.has(f.reg);
  it('starlink 787s over the atlantic', () => {
    const p = makeLiveAskPredicate({ family: '787', starlink: true, region: 'europe' }, { isStarlink });
    expect(p(flight())).toBe(true);
    expect(p(flight({ reg: 'N12345' }))).toBe(false); // no Starlink
    expect(p(flight({ acType: 'B77W' }))).toBe(false); // not a 787
    expect(p(flight({ lat: 40, lon: -100 }))).toBe(false); // over Kansas
  });
  it('without Starlink, and with no roster to ask, a Starlink filter matches nothing rather than everything', () => {
    expect(makeLiveAskPredicate({ starlink: false }, { isStarlink })(flight())).toBe(false);
    expect(makeLiveAskPredicate({ starlink: true }, {})(flight())).toBe(false);
  });
  it('in the air / on the ground, route ends, and a direction at the hub', () => {
    expect(makeLiveAskPredicate({ airborne: false })(flight({ onGround: true }))).toBe(true);
    expect(makeLiveAskPredicate({ airborne: true })(flight({ onGround: true }))).toBe(false);
    expect(makeLiveAskPredicate({ origin: 'EWR', destination: 'LHR' })(flight())).toBe(true);
    expect(makeLiveAskPredicate({ destination: 'FRA' })(flight())).toBe(false);
    expect(makeLiveAskPredicate({ hub: 'EWR', direction: 'departures' })(flight())).toBe(true);
    expect(makeLiveAskPredicate({ hub: 'EWR', direction: 'arrivals' })(flight())).toBe(false);
  });
  it('the hub itself is left to the sidebar\'s hub filter', () => {
    expect(makeLiveAskPredicate({ hub: 'DEN' })(flight())).toBe(true);
  });
});

describe('the schedule board', () => {
  it('sets the board\'s own filters where it has them, and clears the rest', () => {
    expect(scheduleAskPatch({ status: 'canceled', family: '787', starlink: true })).toEqual({
      status: 'canceled', aircraft: '', fleetFamily: '787', routeType: '', starlink: 'starlink', timeRange: '', risk: '', search: '',
    });
    expect(scheduleAskPatch({ status: 'delayed', family: '737MAX', starlink: false })).toEqual({
      status: '', aircraft: '', fleetFamily: '', routeType: '', starlink: 'no-starlink', timeRange: '', risk: '', search: '',
    });
    expect(scheduleControlledFilters({ status: 'canceled', family: 'E175' })).toEqual({ status: { field: 'status', value: 'canceled' } });
  });
  it('needs no predicate when the board\'s own filters say it all', () => {
    expect(makeScheduleAskPredicate({ hub: 'DEN', status: 'canceled', family: '787' }, 'departures')).toBeNull();
  });

  const row = ({ code = 'B789', text = '', orig = 'SFO', dest = 'DEN', sched = 1000, real, est } = {}) => ({
    aircraft: { model: { code, text } },
    airport: { origin: { code: { iata: orig } }, destination: { code: { iata: dest } } },
    time: { scheduled: { arrival: sched, departure: sched }, real: { arrival: real, departure: real }, estimated: { arrival: est } },
  });
  const landed = { key: 'landed', cls: 'landed' };
  it('late is the stat strip\'s rule: landed past 30 minutes, or not operated and printed as delayed', () => {
    expect(rowIsLate(row({ real: 1000 + 31 * 60 }), 'arrivals', landed)).toBe(true);
    expect(rowIsLate(row({ real: 1000 + 10 * 60 }), 'arrivals', landed)).toBe(false);
    expect(rowIsLate(row(), 'arrivals', { key: 'estimated', cls: 'delayed' })).toBe(true); // estimate past schedule
    expect(rowIsLate(row(), 'arrivals', { key: 'delayed', cls: 'delayed' })).toBe(true);
    expect(rowIsLate(row(), 'arrivals', { key: 'scheduled', cls: 'scheduled' })).toBe(false);
    // Still in the air, estimated 46 minutes behind: late; 10 minutes behind: not.
    expect(rowIsLate(row({ est: 1000 + 46 * 60 }), 'arrivals', { key: 'enroute', cls: 'enroute' })).toBe(true);
    expect(rowIsLate(row({ est: 1000 + 10 * 60 }), 'arrivals', { key: 'enroute', cls: 'enroute' })).toBe(false);
    expect(rowIsLate(row(), 'arrivals', { key: 'canceled', cls: 'canceled' })).toBe(false);
    expect(rowIsOnTime(row({ real: 1000 + 5 * 60 }), 'arrivals', landed)).toBe(true);
    expect(rowIsOnTime(row(), 'arrivals', { key: 'scheduled' })).toBe(false);
  });
  it('the predicate: late arrivals from SFO on 737 MAX', () => {
    const p = makeScheduleAskPredicate({ status: 'delayed', origin: 'SFO', family: '737MAX' }, 'arrivals');
    const classify = () => landed;
    expect(p(row({ code: 'B39M', real: 1000 + 45 * 60 }), { classify })).toBe(true);
    expect(p(row({ code: 'B738', real: 1000 + 45 * 60 }), { classify })).toBe(false);
    expect(p(row({ code: 'B39M', orig: 'LAX', real: 1000 + 45 * 60 }), { classify })).toBe(false);
    expect(p(row({ code: 'B39M', real: 1000 }), { classify })).toBe(false);
  });
});

describe('the Fleet tab', () => {
  const db = [
    { r: 'N12001', t: '787-10', c: '44J/21PP/36E+/217Y', w: 'ViaSatKA' },
    { r: 'N24976', t: '787-9', c: '48J/21PP/39E+/149Y', w: 'Starlink' },
    { r: 'N37502', t: '737 MAX 8', c: '16F/54E+/96Y', w: 'ViaSatKA' },
    { r: 'N4888U', t: 'A319', c: '12F/36E+/78Y', w: 'Satl Ku' },
    { r: 'N44501', t: 'A321neo', c: '20F/57E+/123Y', w: 'ViaSatKA' },
  ];
  const run = (filters) => {
    const p = fleetAskPatch(filters);
    return filterFleetData(db, { type: p.type, wifi: p.wifi, status: p.status, search: p.search, starlinkTails: new Set(['N24976']), specialAircraftSet: new Set() }).map((a) => a.r);
  };
  it('a type, a family, a tail and Starlink each become the table\'s own search or status', () => {
    expect(run({ type: 'B789' })).toEqual(['N24976']);
    expect(run({ type: 'B78X' })).toEqual(['N12001']);
    expect(run({ family: '787' })).toEqual(['N12001', 'N24976']);
    expect(run({ family: '737MAX' })).toEqual(['N37502']);
    expect(run({ family: 'A320' })).toEqual(['N4888U', 'N44501']);
    expect(run({ tail: 'N4888U' })).toEqual(['N4888U']);
    expect(run({ starlink: true })).toEqual(['N24976']);
  });
});
