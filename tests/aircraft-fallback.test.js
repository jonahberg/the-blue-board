// D6 (live audit Sep 28 2026): the aircraft dialog for a United Express Starlink tail (N642SY,
// a SkyWest E175) said only "Not in mainline fleet database" — while the Starlink roster knows
// its type and operator and the live feed may have it airborne. Roster rows are the
// production shape (public/data/starlink.json); the flight row is the live-feed shape.
import { describe, it, expect } from 'vitest';

import { nonMainlineAircraftSummary } from '../src/lib/fleet-view.js';

const ROSTER = [
  { tail: 'N64322', fleet: 'Mainline', type: 'A321-271NY(XLR)', operator: 'United Airlines' },
  { tail: 'N642SY', fleet: 'Express', type: 'E175SC', operator: 'SkyWest dba UAX' },
];
const LIVE = {
  fr24id: '3c1a2b', icao24: 'a86b1c', lat: 44.1, lon: -93.2, hdg: 120, alt: 10058, spd: 220, vr: 0,
  squawk: null, acType: 'E75L', reg: 'N642SY', origin: 'MSP', dest: 'ORD', flightIATA: 'UA5712',
  onGround: false, callsign: 'SKW5712', airline: 'SKW',
};

describe('nonMainlineAircraftSummary', () => {
  it('falls back to the Starlink roster: Starlink yes, type, operator', () => {
    const s = nonMainlineAircraftSummary('N642SY', ROSTER, null);
    expect(s.starlink).toBe(true);
    expect(s.type).toBe('E175SC');
    expect(s.operator).toBe('SkyWest dba UAX');
    expect(s.fleet).toBe('Express');
    expect(s.flight).toBeNull();
  });

  it('adds the current flight from the live feed', () => {
    const s = nonMainlineAircraftSummary('N642SY', ROSTER, LIVE);
    expect(s.flight).toEqual({ ident: 'UA5712', origin: 'MSP', dest: 'ORD' });
  });

  it('uses the live feed alone for a tail the roster does not know', () => {
    const s = nonMainlineAircraftSummary('N642SY', [], LIVE);
    expect(s.starlink).toBe(false);
    expect(s.type).toBe('E75L');
    expect(s.flight.ident).toBe('UA5712');
  });

  it('is null when neither source knows the tail', () => {
    expect(nonMainlineAircraftSummary('N99999', ROSTER, null)).toBeNull();
  });

  it('matches the roster regardless of dash or case', () => {
    expect(nonMainlineAircraftSummary('n642sy', [{ ...ROSTER[1], tail: 'N642-SY' }], null)?.starlink).toBe(true);
  });
});
