// Live audit Oct 4 2026, findings 5 and 6: Express Wi-Fi missing on the board, and the wording /
// label inconsistencies (En Route vs En route, a city where a code belongs, provider suffixes on
// flight numbers, two different Starlink-airborne counts).
import { describe, it, expect } from 'vitest';
import { buildScheduleRow, fleetCell, routeCell } from '../src/lib/schedule-row-model.js';
import { classifySchedStatus } from '../src/lib/schedule-status.js';
import { airborneByTail } from '../src/lib/starlink-view.js';
import { isAirborne } from '../src/lib/live-stats.js';

describe('Express Starlink tails show Wi-Fi on the board (finding 5)', () => {
  // N140SY (SkyWest E175): "—" on the board, equipped on the Starlink tab, "Starlink likely" in My Flights.
  const starlinkTails = new Set(['N140SY', 'N37502']);
  const fleetByReg = { N37502: { r: 'N37502', c: '739', seats: { J: 20, Y: 159 }, w: 'Starlink' } };

  it('a tail the mainline fleet database does not know but the Starlink roster does reads Starlink', () => {
    expect(fleetCell('N140SY', fleetByReg, starlinkTails)).toEqual({
      badge: 'Starlink', starlink: true, enrich: '⚡ Starlink', source: 'starlink-roster',
    });
  });

  it('mainline rows still come from the fleet database, and unknown non-Starlink tails stay "—"', () => {
    expect(fleetCell('N37502', fleetByReg, starlinkTails)).toMatchObject({ badge: '739', starlink: true, source: 'fleet' });
    expect(fleetCell('N999SY', fleetByReg, starlinkTails)).toBeNull();
  });
});

describe('one spelling, codes not cities, no provider suffixes (finding 6)', () => {
  const st = (text, generic) => ({ generic: { status: { text: generic, diverted: false }, type: '' }, text });
  const fl = (status) => ({ status, time: { scheduled: { arrival: 1791074760 }, real: { departure: 1791070000 } } });

  it('"En route" (served-board repair), "enroute" (provider) and the sighting path all read "En Route"', () => {
    for (const status of [st('en route', 'en-route'), st('enroute', 'en-route'), { ...st('en route', 'en-route'), live: true }]) {
      expect(classifySchedStatus(fl(status), 'arrivals', 1791074000).text).toBe('En Route');
    }
    expect(classifySchedStatus(fl(st('approaching', 'en-route')), 'arrivals', 1791074000).text).toBe('Approaching');
  });

  it('a route with only an airport NAME shows the code when the name is unambiguous (DEN UA599 "San Francisco → DEN")', () => {
    const ua599 = { airport: { origin: { code: { iata: '' }, name: 'San Francisco' }, destination: { code: { iata: 'DEN' } } } };
    expect(routeCell(ua599, 'DEN', 'arrivals')).toEqual({ routeLine: 'SFO → DEN', routeSub: 'San Francisco' });
    // Ambiguous names stay names: Washington is Dulles or Reagan, Portland is PDX or PWM.
    const named = (name) => routeCell({ airport: { origin: { code: { iata: '' }, name } } }, 'ORD', 'arrivals').routeLine;
    expect(named('Washington')).toBe('Washington → ORD');
    expect(named('Portland')).toBe('Portland → ORD');
  });

  it('a placeholder "Unknown" airport is no airport', () => {
    const unknown = { airport: { origin: { code: { iata: 'EWR' } }, destination: { code: { iata: '' }, name: 'Unknown' } } };
    expect(routeCell(unknown, 'EWR', 'departures').routeLine).toBe('EWR → —');
  });

  it('prints "UA526" for the provider\'s "UA526H" but keeps the raw ident for the key and the watch list', () => {
    const flight = {
      identification: { number: { default: 'UA526H' } },
      status: st('expected', 'scheduled'),
      time: { scheduled: { departure: 1791068100 } },
      airport: { origin: { code: { iata: 'ORD' } }, destination: { code: { iata: 'FWA' } } },
    };
    const m = buildScheduleRow(flight, { hub: 'ORD', dir: 'departures', timeZone: 'UTC', status: classifySchedStatus(flight, 'departures', 1791060000) });
    expect(m.identDisplay).toBe('UA526');
    expect(m.ident).toBe('UA526H');
    expect(m.key.startsWith('UA526H-')).toBe(true);
  });

  it('the Starlink tab counts airborne the way Stats does: not on the ground (flag, or < 100 ft and < 50 kt)', () => {
    const tails = new Set(['N37502', 'N26902', 'N140SY']);
    const feed = [
      { reg: 'N37502', onGround: false, alt: 35000, spd: 230, vr: 0 }, // cruising
      { reg: 'N26902', onGround: false, alt: 0, spd: 5, vr: 0 },       // taxiing, flag not set
      { reg: 'N140SY', onGround: true, alt: 0, spd: 0, vr: 0 },        // parked
    ];
    const tab = Object.keys(airborneByTail(feed, tails));
    const stats = feed.filter(isAirborne).filter((f) => tails.has(f.reg)).map((f) => f.reg);
    expect(tab).toEqual(['N37502']);
    expect(tab).toEqual(stats);
  });
});
