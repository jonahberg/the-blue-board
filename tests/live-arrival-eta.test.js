// D1 (live audit Sep 28 2026, v1.9.1): UA1215 ALB→ORD was descending through 14,050 ft about
// ten minutes out, yet My Flights read "2h 18m to arrival" — /api/flight-times carried
// AeroDataBox's arrival estimate (17:51Z, status 'expected', real.departure null) for a leg
// that took off at 14:17:40Z and was scheduled in at 16:29Z. Owner rule: while the flight is
// airborne, live data wins — derive the ETA from remaining distance ÷ groundspeed, and ignore
// an ADB estimate that contradicts it by more than 30 minutes.
import { describe, it, expect } from 'vitest';

import {
  LIVE_ETA_ALLOWANCE_MIN,
  liveArrivalEstimate,
  myFlightCountdown,
  myFlightTimes,
  reconcileLiveArrival,
} from '../src/lib/my-flights.js';
import { computeConnectionRisk } from '../src/lib/connection-pairing.js';
import { resolveFlightStatus } from '../src/lib/flight-status-resolve.js';

// The /api/flight-times payload production returned for UA1215 (schedule-cache+fr24 shape).
const UA1215 = {
  success: true,
  flight: 'UA1215',
  origin: { iata: 'ALB', name: 'Albany', terminal: '', gate: '', tz: 'America/New_York' },
  destination: { iata: 'ORD', name: "Chicago O'Hare", terminal: '1', gate: 'C18', tz: 'America/Chicago' },
  departure: {
    gate: { scheduled: '2026-09-28T13:55:00.000Z', estimated: '', actual: '' },
    takeoff: { scheduled: '', estimated: '', actual: '2026-09-28T14:17:40Z' },
  },
  arrival: {
    landing: { scheduled: '', estimated: '', actual: '' },
    gate: { scheduled: '2026-09-28T16:29:00.000Z', estimated: '2026-09-28T17:51:00.000Z', actual: '' },
  },
  aircraft: 'Airbus A320',
  registration: 'N409UA',
  status: 'expected',
  cancelled: false,
  diverted: false,
  source: 'schedule-cache+fr24',
};

// ~45 nm east of O'Hare, descending through 14,050 ft at 280 kt — the live feed's units
// (metres, metres/second) as src/lib/feed-health.js parses them.
const LIVE = {
  fr24id: '3c1a2b', icao24: 'a4f1c2', lat: 41.9742, lon: -86.9, hdg: 270,
  alt: 14050 / 3.28084, spd: 280 / 1.944, vr: -8, squawk: null, acType: 'A320',
  reg: 'N409UA', origin: 'ALB', dest: 'ORD', flightIATA: 'UA1215', onGround: false,
  callsign: 'UAL1215', airline: 'UAL',
};

const NOW = Date.parse('2026-09-28T16:05:00Z');

describe('liveArrivalEstimate', () => {
  it('derives the gate ETA from remaining distance ÷ groundspeed plus an approach/taxi allowance', () => {
    const est = liveArrivalEstimate(LIVE, 'ORD', NOW);
    expect(est).not.toBeNull();
    const minutes = (Date.parse(est.etaISO) - NOW) / 60000;
    // 45 nm at 280 kt ≈ 9.6 min in the air, plus the allowance.
    expect(minutes).toBeGreaterThan(9 + LIVE_ETA_ALLOWANCE_MIN - 1);
    expect(minutes).toBeLessThan(11 + LIVE_ETA_ALLOWANCE_MIN);
  });

  it('declines on the ground, at taxi speed, or without destination coordinates', () => {
    expect(liveArrivalEstimate({ ...LIVE, onGround: true }, 'ORD', NOW)).toBeNull();
    expect(liveArrivalEstimate({ ...LIVE, spd: 10 }, 'ORD', NOW)).toBeNull();
    expect(liveArrivalEstimate(LIVE, 'ZZZ', NOW)).toBeNull();
    expect(liveArrivalEstimate(null, 'ORD', NOW)).toBeNull();
  });
});

describe('reconcileLiveArrival', () => {
  it('replaces an ADB estimate that contradicts the live ETA by more than 30 minutes, and labels it', () => {
    const td = reconcileLiveArrival(UA1215, LIVE, NOW);
    expect(td.arrival.etaSource).toBe('live');
    const minutes = (Date.parse(td.arrival.gate.estimated) - NOW) / 60000;
    expect(minutes).toBeLessThan(30);
    // The input payload is not mutated (it lives in the flight-times cache).
    expect(UA1215.arrival.gate.estimated).toBe('2026-09-28T17:51:00.000Z');
    expect(UA1215.arrival.etaSource).toBeUndefined();
  });

  it('keeps an ADB estimate that agrees with the live ETA within 30 minutes', () => {
    const live = liveArrivalEstimate(LIVE, 'ORD', NOW);
    const close = new Date(Date.parse(live.etaISO) + 12 * 60000).toISOString();
    const agreeing = { ...UA1215, arrival: { ...UA1215.arrival, gate: { ...UA1215.arrival.gate, estimated: close } } };
    const td = reconcileLiveArrival(agreeing, LIVE, NOW);
    expect(td.arrival.gate.estimated).toBe(close);
    expect(td.arrival.etaSource).not.toBe('live');
  });

  it('leaves the payload alone when the flight is not in the live feed or is on the ground', () => {
    expect(reconcileLiveArrival(UA1215, null, NOW)).toBe(UA1215);
    expect(reconcileLiveArrival(UA1215, { ...LIVE, onGround: true }, NOW)).toBe(UA1215);
  });

  it('never touches a leg that already has an actual arrival', () => {
    const landed = { ...UA1215, arrival: { ...UA1215.arrival, gate: { ...UA1215.arrival.gate, actual: '2026-09-28T16:20:00Z' } } };
    expect(reconcileLiveArrival(landed, LIVE, NOW)).toBe(landed);
  });

  it('turns the UA1215 countdown from "2h 18m to arrival" into minutes', () => {
    const before = myFlightTimes(UA1215);
    const status = resolveFlightStatus(UA1215, LIVE);
    expect(myFlightCountdown({ status, ...before, now: Date.parse('2026-09-28T15:33:00Z') }).text).toBe('2h 18m to arrival');
    const after = myFlightTimes(reconcileLiveArrival(UA1215, LIVE, NOW));
    const text = myFlightCountdown({ status, ...after, now: NOW }).text;
    expect(text).toMatch(/^\d{1,2}m to arrival$/);
  });

  it('feeds the live ETA to the connection checker', () => {
    const outbound = {
      success: true,
      origin: { iata: 'ORD', terminal: '1' },
      destination: { iata: 'LGA' },
      departure: { gate: { scheduled: '2026-09-28T17:20:00.000Z', estimated: '', actual: '' } },
      cancelled: false,
      diverted: false,
    };
    const stale = computeConnectionRisk({ hub: 'ORD', inbound: { w: { flight: 'UA1215' }, td: UA1215 }, outbound: { w: { flight: 'UA786' }, td: outbound } });
    const live = computeConnectionRisk({ hub: 'ORD', inbound: { w: { flight: 'UA1215' }, td: reconcileLiveArrival(UA1215, LIVE, NOW) }, outbound: { w: { flight: 'UA786' }, td: outbound } });
    expect(stale.connectionMin).toBeLessThan(0);
    expect(live.connectionMin).toBeGreaterThan(40);
  });
});

describe("a leg with takeoff.actual is never 'expected'", () => {
  it('resolves to en-route even with the live feed dark', () => {
    expect(resolveFlightStatus(UA1215, null)).toBe('en-route');
  });

  it('still reads landed once an arrival actual exists', () => {
    const landed = { ...UA1215, arrival: { ...UA1215.arrival, gate: { ...UA1215.arrival.gate, actual: '2026-09-28T16:20:00Z' } } };
    expect(resolveFlightStatus(landed, null)).toBe('landed');
  });
});
