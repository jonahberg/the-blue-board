// The 24-hour airborne graph is only honest if its server samples count the way the Live tab's
// stat bar counts. These tests pin that: the server's `countAirborne()` and the bar's
// `computeLiveStats().airborne` give the same number over the same unfiltered feed — a trimmed
// real read of the free `airline=UAL` feed (Oct 4 2026) plus synthetic edge rows.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { countAirborne, isExpressCallsign, sampleMinuteIso, EXPRESS_CALLSIGN_PREFIXES } from '../src/lib/airborne-count.js';
import { computeLiveStats, isAirborne } from '../src/lib/live-stats.js';
import { parseFr24Feed } from '../src/lib/feed-health.js';

const RAW = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/ual-feed-2026-10-04-trimmed.json'), 'utf8'));
const deps = { matchAircraft: () => null, isFiltered: false };

/** The fixture plus rows a real feed can carry and the definitions must agree on. */
function feedWithEdges() {
  const raw = { ...RAW };
  // [icao24, lat, lon, hdg, alt ft, spd kt, squawk, radar, type, reg, ts, origin, dest, flight, onGround, vr fpm, callsign, ?, airline]
  // Not flagged on the ground, but parked by telemetry (0 ft, 0 kt) → Ground by getPhase.
  raw.edge_parked = ['AAA001', 41.97, -87.9, 0, 0, 0, '', '', 'B739', 'N1', 0, 'ORD', 'SFO', 'UA9001', 0, 0, 'UAL9001', 0, 'UAL'];
  // Low and slow but NOT stopped (taxi at 12 kt): Ground by telemetry.
  raw.edge_taxi = ['AAA002', 41.97, -87.9, 90, 0, 12, '', '', 'E75L', 'N2', 0, 'ORD', 'MSP', 'UA9002', 0, 0, 'SKW9002', 0, 'UAL'];
  // Flagged on the ground even though the altitude reads high (a stale altitude): Ground by flag.
  raw.edge_flag = ['AAA003', 41.97, -87.9, 90, 35000, 0, '', '', 'B772', 'N3', 0, 'ORD', 'LHR', 'UA9003', 1, 0, 'UAL9003', 0, 'UAL'];
  // Airborne at 300 ft on the climb-out: airborne.
  raw.edge_climb = ['AAA004', 41.97, -87.9, 90, 300, 160, '', '', 'B38M', 'N4', 0, 'ORD', 'DEN', 'UA9004', 0, 2500, 'UAL9004', 0, 'UAL'];
  // No position → dropped by parseFr24Feed for BOTH callers (never counted at all).
  raw.edge_nopos = ['AAA005', 0, 0, 90, 30000, 450, '', '', 'B789', 'N5', 0, 'ORD', 'NRT', 'UA9005', 0, 0, 'UAL9005', 0, 'UAL'];
  // Airborne with no callsign: counts as airborne, and as mainline (not Express).
  raw.edge_nocs = ['AAA006', 40.0, -90.0, 90, 31000, 450, '', '', 'B739', 'N6', 0, 'ORD', 'LAX', '', 0, 0, '', 0, 'UAL'];
  return raw;
}

describe('countAirborne — the same number as the Live stat bar', () => {
  it('matches computeLiveStats().airborne on the unfiltered real feed', () => {
    const flights = parseFr24Feed(RAW);
    expect(flights.length).toBeGreaterThan(50);
    const bar = computeLiveStats(flights, flights, 0, () => false, deps);
    const server = countAirborne(flights);
    expect(server.airborne).toBe(bar.airborne);
    expect(server.ground).toBe(bar.ground);
    expect(bar.airborneAll).toBe(server.airborne);
    // Not a vacuous agreement: the fixture really has both kinds.
    expect(server.airborne).toBeGreaterThan(0);
    expect(server.ground).toBeGreaterThan(0);
  });

  it('matches on the edge rows (telemetry-ground, flag-ground, low climb, no position, no callsign)', () => {
    const flights = parseFr24Feed(feedWithEdges());
    const bar = computeLiveStats(flights, flights, 0, () => false, deps);
    const server = countAirborne(flights);
    expect(server.airborne).toBe(bar.airborne);
    expect(server.ground).toBe(bar.ground);
    expect(server.airborne).toBe(flights.filter(isAirborne).length);
    // The no-position row never reaches either count.
    expect(flights.some((f) => f.fr24id === 'edge_nopos')).toBe(false);
    expect(server.total).toBe(flights.length);
  });

  it('airborneAll ignores the bar filter; airborne follows it', () => {
    const flights = parseFr24Feed(feedWithEdges());
    const filtered = flights.filter((f) => f.dest === 'SFO');
    const bar = computeLiveStats(flights, filtered, 0, () => false, { ...deps, isFiltered: true });
    expect(bar.airborne).toBe(countAirborne(filtered).airborne);
    expect(bar.airborneAll).toBe(countAirborne(flights).airborne);
    expect(bar.airborneAll).toBeGreaterThan(bar.airborne);
  });

  it('splits airborne into mainline + Express by callsign, summing exactly', () => {
    const flights = parseFr24Feed(feedWithEdges());
    const c = countAirborne(flights);
    expect(c.mainline + c.express).toBe(c.airborne);
    const expectedExpress = flights.filter((f) => isAirborne(f) && /^(SKW|RPA|GJS|UCA|ASH|AWI|ASQ|LOF)/.test(f.callsign)).length;
    expect(c.express).toBe(expectedExpress);
    expect(c.express).toBeGreaterThan(0);
  });

  it('is 0/0 for an empty or missing feed (the caller treats that as a failed read)', () => {
    expect(countAirborne([])).toEqual({ airborne: 0, ground: 0, total: 0, mainline: 0, express: 0 });
    expect(countAirborne(undefined)).toEqual({ airborne: 0, ground: 0, total: 0, mainline: 0, express: 0 });
  });
});

describe('isExpressCallsign', () => {
  it('knows every United Express operator prefix', () => {
    for (const p of EXPRESS_CALLSIGN_PREFIXES) expect(isExpressCallsign(`${p}123`)).toBe(true);
    expect(isExpressCallsign('skw5432')).toBe(true);
  });

  it('is false for mainline, empty and foreign callsigns', () => {
    expect(isExpressCallsign('UAL1')).toBe(false);
    expect(isExpressCallsign('')).toBe(false);
    expect(isExpressCallsign(null)).toBe(false);
    expect(isExpressCallsign('DAL100')).toBe(false);
  });
});

describe('sampleMinuteIso', () => {
  it('floors to the whole minute', () => {
    expect(sampleMinuteIso(Date.parse('2026-10-04T12:05:03.812Z'))).toBe('2026-10-04T12:05:00.000Z');
    expect(sampleMinuteIso(Date.parse('2026-10-04T12:05:59.999Z'))).toBe('2026-10-04T12:05:00.000Z');
    expect(sampleMinuteIso(Date.parse('2026-10-04T12:05:00.000Z'))).toBe('2026-10-04T12:05:00.000Z');
  });

  it('is null for garbage', () => {
    expect(sampleMinuteIso(NaN)).toBeNull();
    expect(sampleMinuteIso('soon')).toBeNull();
  });
});
