import { describe, it, expect } from 'vitest';

import {
  BOARDING_LEAD_MS,
  MY_FLIGHTS_FAIL_TERMINAL,
  MY_FLIGHTS_PLACEHOLDERS,
  findInboundAircraft,
  findLiveFlight,
  formatCountdown,
  myFlightCountdown,
  myFlightGateLabels,
  myFlightPendingChip,
  myFlightStatusChip,
  myFlightTimes,
  parseQuickAdd,
  resolveMyFlightRoute,
  seatConfigString,
} from '../src/lib/my-flights.js';

const NOW = Date.parse('2026-09-13T18:00:00Z');
const iso = (minutesFromNow) => new Date(NOW + minutesFromNow * 60000).toISOString();

describe('formatCountdown', () => {
  it('clamps a past time to 0m rather than counting negatively', () => {
    expect(formatCountdown(-1)).toBe('0m');
    expect(formatCountdown(0)).toBe('0m');
  });

  it('drops the hour component below an hour', () => {
    expect(formatCountdown(37 * 60000)).toBe('37m');
  });

  it('reads hours and minutes above an hour', () => {
    expect(formatCountdown(2 * 3600000 + 14 * 60000)).toBe('2h 14m');
  });
});

describe('myFlightStatusChip', () => {
  it('names every resolved state', () => {
    expect(myFlightStatusChip('cancelled').text).toBe('CANCELLED');
    expect(myFlightStatusChip('diverted').text).toBe('DIVERTED');
    expect(myFlightStatusChip('landed').text).toBe('LANDED');
    expect(myFlightStatusChip('en-route').text).toBe('EN ROUTE');
    expect(myFlightStatusChip('departed').text).toBe('DEPARTED');
    expect(myFlightStatusChip('delayed').text).toBe('DELAYED');
  });

  it('falls back to SCHEDULED for an unknown or empty state', () => {
    expect(myFlightStatusChip('').text).toBe('SCHEDULED');
    expect(myFlightStatusChip('something-else').text).toBe('SCHEDULED');
  });

  it('carries a tone name, never a colour', () => {
    for (const status of ['cancelled', 'landed', 'en-route', '']) {
      expect(myFlightStatusChip(status).tone).not.toMatch(/#|rgb/);
    }
  });
});

describe('myFlightPendingChip', () => {
  it('keeps saying LOADING below the terminal threshold', () => {
    expect(myFlightPendingChip(0)).toMatchObject({ text: 'LOADING...', terminal: false });
    expect(myFlightPendingChip(MY_FLIGHTS_FAIL_TERMINAL - 1).terminal).toBe(false);
  });

  it('gives up honestly at the threshold', () => {
    expect(myFlightPendingChip(MY_FLIGHTS_FAIL_TERMINAL)).toMatchObject({
      text: 'STATUS UNAVAILABLE',
      terminal: true,
    });
    expect(myFlightPendingChip(9).terminal).toBe(true);
  });
});

describe('myFlightCountdown', () => {
  it('shows no clock for a cancelled or diverted flight', () => {
    expect(myFlightCountdown({ status: 'cancelled', depISO: iso(60), now: NOW }).text).toBe('');
    expect(myFlightCountdown({ status: 'diverted', depISO: iso(60), now: NOW }).text).toBe('');
  });

  it('says Landed and stops', () => {
    expect(myFlightCountdown({ status: 'landed', arrISO: iso(-30), now: NOW }).text).toBe('Landed');
  });

  it('counts an airborne flight down to arrival', () => {
    expect(myFlightCountdown({ status: 'en-route', arrISO: iso(95), now: NOW }).text).toBe(
      '1h 35m to arrival',
    );
    expect(myFlightCountdown({ status: 'departed', arrISO: iso(20), now: NOW }).text).toBe(
      '20m to arrival',
    );
  });

  it('says Arriving once the arrival time has passed', () => {
    expect(myFlightCountdown({ status: 'en-route', arrISO: iso(-5), now: NOW }).text).toBe(
      'Arriving',
    );
  });

  it('counts a scheduled flight to BOARDING first', () => {
    // 90 minutes out, boarding opens 30 before: 60 minutes to boarding.
    expect(myFlightCountdown({ status: 'scheduled', depISO: iso(90), now: NOW }).text).toBe(
      '1h 0m to boarding',
    );
  });

  it('switches to "to departure" once boarding has opened', () => {
    expect(myFlightCountdown({ status: 'scheduled', depISO: iso(20), now: NOW }).text).toBe(
      '20m to departure',
    );
  });

  it('exposes the boarding lead it uses', () => {
    expect(BOARDING_LEAD_MS).toBe(30 * 60000);
  });

  it('says "Expected to depart" once the departure time has passed', () => {
    expect(myFlightCountdown({ status: 'scheduled', depISO: iso(-3), now: NOW }).text).toBe(
      'Expected to depart',
    );
    expect(myFlightCountdown({ status: 'delayed', depISO: iso(-3), now: NOW }).text).toBe(
      'Expected to depart',
    );
  });

  it('never offers a delayed flight a boarding countdown', () => {
    expect(myFlightCountdown({ status: 'delayed', depISO: iso(90), now: NOW }).text).toBe(
      '1h 30m to departure',
    );
  });

  it('returns an empty line rather than NaN when the time is missing or junk', () => {
    expect(myFlightCountdown({ status: 'scheduled', now: NOW }).text).toBe('');
    expect(myFlightCountdown({ status: 'en-route', now: NOW }).text).toBe('');
    expect(myFlightCountdown({ status: 'scheduled', depISO: 'not-a-date', now: NOW }).text).toBe('');
  });
});

describe('myFlightTimes', () => {
  it('prefers the estimated GATE time over the scheduled one', () => {
    const td = {
      departure: { gate: { scheduled: 'S', estimated: 'E' }, takeoff: { estimated: 'T' } },
      arrival: { gate: { scheduled: 'AS' }, landing: { estimated: 'AL' } },
    };
    expect(myFlightTimes(td)).toEqual({ depISO: 'E', arrISO: 'AS' });
  });

  it('never reads a takeoff time as a departure — that was the delay-at-runway bug', () => {
    const td = { departure: { gate: {}, takeoff: { estimated: 'T' } }, arrival: { gate: {}, landing: {} } };
    expect(myFlightTimes(td).depISO).toBe('');
  });

  it('falls back to the landing triple only for arrival', () => {
    const td = { departure: { gate: {} }, arrival: { gate: {}, landing: { scheduled: 'LS' } } };
    expect(myFlightTimes(td).arrISO).toBe('LS');
  });

  it('survives a null payload', () => {
    expect(myFlightTimes(null)).toEqual({ depISO: '', arrISO: '' });
  });
});

describe('resolveMyFlightRoute', () => {
  it('splits the stored route on an arrow or a dash', () => {
    expect(resolveMyFlightRoute('ORD→DEN', null)).toMatchObject({
      origCode: 'ORD',
      destCode: 'DEN',
      needsBackfill: false,
    });
    expect(resolveMyFlightRoute('ORD-DEN', null).destCode).toBe('DEN');
  });

  it('fills both ends from the payload when the watch entry has no route', () => {
    const td = { origin: { iata: 'SFO' }, destination: { iata: 'EWR' } };
    expect(resolveMyFlightRoute('', td)).toMatchObject({
      origCode: 'SFO',
      destCode: 'EWR',
      route: 'SFO→EWR',
      needsBackfill: true,
    });
  });

  it('asks for a backfill over a placeholder route containing "?"', () => {
    const td = { origin: { iata: 'IAH' }, destination: { iata: 'LAX' } };
    expect(resolveMyFlightRoute('?→?', td).needsBackfill).toBe(true);
  });

  it('does not ask for a backfill when only one end is known', () => {
    expect(resolveMyFlightRoute('', { origin: { iata: 'DEN' } }).needsBackfill).toBe(false);
  });
});

describe('myFlightGateLabels', () => {
  it('uses the published terminal and gate', () => {
    const td = {
      success: true,
      origin: { iata: 'ORD', terminal: '2', gate: 'C12' },
      destination: { iata: 'DEN', terminal: 'B', gate: '38' },
    };
    expect(myFlightGateLabels(td)).toEqual({ origin: 'T2 Gate C12', destination: 'TB Gate 38' });
  });

  it('falls back to the United hub terminal when the feed publishes none', () => {
    const td = {
      success: true,
      origin: { iata: 'ORD', gate: 'B6' },
      destination: { iata: 'DEN' },
    };
    // ORD domestic is Terminal 1; DEN has no gate, so it degrades to the terminal alone.
    expect(myFlightGateLabels(td)).toEqual({ origin: 'T1 Gate B6', destination: 'TB' });
  });

  it('picks the international concourse when either end is international', () => {
    const td = {
      success: true,
      origin: { iata: 'IAH', gate: '12' },
      destination: { iata: 'FRA' },
    };
    expect(myFlightGateLabels(td).origin).toBe('TE Gate 12');
  });

  it('shows an em dash rather than inventing a gate', () => {
    expect(myFlightGateLabels(null)).toEqual({ origin: '—', destination: '—' });
    expect(myFlightGateLabels({ success: false })).toEqual({ origin: '—', destination: '—' });
    expect(
      myFlightGateLabels({ success: true, origin: { iata: 'AUS' }, destination: { iata: 'MSY' } }),
    ).toEqual({ origin: '—', destination: '—' });
  });
});

describe('seatConfigString', () => {
  it('joins the seat map', () => {
    expect(seatConfigString({ seats: { F: 20, J: 0, W: 48, Y: 111 } })).toBe('20F/0J/48W/111Y');
  });

  it('falls back to the config string', () => {
    expect(seatConfigString({ c: '16J/48W/115Y' })).toBe('16J/48W/115Y');
  });

  it('is empty for nothing', () => {
    expect(seatConfigString(null)).toBe('');
    expect(seatConfigString({})).toBe('');
  });
});

describe('parseQuickAdd', () => {
  it('normalises the UA prefix and strips spaces', () => {
    expect(parseQuickAdd('ua 1234')).toEqual({ kind: 'flight', flight: 'UA1234' });
    expect(parseQuickAdd('1234')).toEqual({ kind: 'flight', flight: 'UA1234' });
    expect(parseQuickAdd('UAL1234')).toEqual({ kind: 'flight', flight: 'UA1234' });
    expect(parseQuickAdd('UA1234')).toEqual({ kind: 'flight', flight: 'UA1234' });
  });

  it('routes a tail number to the aircraft, not to a nonsense flight', () => {
    // The placeholder rotator advertises "Try a tail number (N37502)"; the shipped box
    // turned that into the flight UAN37502.
    expect(parseQuickAdd('N37502')).toEqual({ kind: 'tail', reg: 'N37502' });
    expect(parseQuickAdd('n12005')).toEqual({ kind: 'tail', reg: 'N12005' });
    expect(parseQuickAdd('N37502')).not.toMatchObject({ kind: 'flight' });
  });

  it('is null for nothing typed', () => {
    expect(parseQuickAdd('')).toBeNull();
    expect(parseQuickAdd('   ')).toBeNull();
    expect(parseQuickAdd(null)).toBeNull();
  });

  it('offers both placeholder hints', () => {
    expect(MY_FLIGHTS_PLACEHOLDERS).toHaveLength(2);
    expect(MY_FLIGHTS_PLACEHOLDERS[0]).toMatch(/UA 1234/);
  });
});

describe('findLiveFlight', () => {
  const flights = [
    { flightIATA: 'UA328', callsign: 'UAL328' },
    { flightIATA: '', callsign: 'UAL1901' },
  ];

  it('matches on the IATA flight number', () => {
    expect(findLiveFlight(flights, 'UA328')).toBe(flights[0]);
  });

  it('matches on the ICAO callsign when the feed publishes no IATA number', () => {
    expect(findLiveFlight(flights, 'UA1901')).toBe(flights[1]);
  });

  it('is null for a flight that is not airborne', () => {
    expect(findLiveFlight(flights, 'UA9999')).toBeNull();
    expect(findLiveFlight(flights, '')).toBeNull();
  });
});

describe('findInboundAircraft', () => {
  const flights = [
    { reg: 'N37-502', flightIATA: 'UA555', dest: 'ORD', onGround: false, origin: 'DEN' },
    { reg: 'N37502', flightIATA: 'UA777', dest: 'DEN', onGround: false, origin: 'ORD' },
  ];

  it('finds the same tail inbound to our origin', () => {
    expect(findInboundAircraft(flights, 'N37502', 'UA100', 'ORD', false)).toBe(flights[0]);
  });

  it('asks nothing once our own flight is airborne', () => {
    expect(findInboundAircraft(flights, 'N37502', 'UA100', 'ORD', true)).toBeNull();
  });

  it('never returns our own flight', () => {
    expect(findInboundAircraft(flights, 'N37502', 'UA555', 'ORD', false)).toBeNull();
  });

  it('ignores a tail on the ground and one going elsewhere', () => {
    const grounded = [{ ...flights[0], onGround: true }];
    expect(findInboundAircraft(grounded, 'N37502', 'UA100', 'ORD', false)).toBeNull();
    expect(findInboundAircraft(flights, 'N37502', 'UA100', 'SFO', false)).toBeNull();
  });

  it('is null without a registration', () => {
    expect(findInboundAircraft(flights, '', 'UA100', 'ORD', false)).toBeNull();
  });
});
