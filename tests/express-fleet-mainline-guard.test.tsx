// @vitest-environment jsdom
/**
 * The United Express fleet must not move a single mainline number.
 *
 * `FleetProvider` loads `/api/express-fleet` beside the mainline database and exposes it as a
 * SEPARATE index (`expressDb` / `expressByReg`). Everything the "1,139 mainline" figure, the
 * utilisation and the Starlink counts hang off — `fleetDb`, `fleetByReg`, `starlink`, and
 * `matchAircraft()` over `fleetByReg` — must come out identical whether the Express fleet loaded,
 * failed, or is still in flight, and `computeLiveStats()` must report the same utilisation.
 */

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { matchAircraft } from '../src/lib/fleet-match.js';
import { computeLiveStats } from '../src/lib/live-stats.js';
import { matchExpress } from '../src/lib/express-fleet.js';
import { FleetProvider, useFleet } from '../src/app/state/fleet';
import type { FleetValue } from '../src/app/state/fleet';

const ctl = vi.hoisted(() => ({
  expressMode: 'ok' as 'ok' | 'fail' | 'pending',
  expressTails: [] as unknown[],
}));

vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchFleetDb: async () => [
    { r: 'N37502', t: '737 MAX 9', w: 'ViaSatKA', d: '2018' },
    { r: 'N14512', t: 'A321neo', w: 'ViaSatKA', d: '2024' },
    { r: 'N77430', t: '737-900ER', w: 'Satl Ku', d: '2009' },
  ],
  fetchFleetSummary: async () => null,
  fetchStarlinkRoster: async () => ({
    aircraft: [
      { tail: 'N37502', fleet: 'Mainline', type: '737 MAX 9' },
      { tail: 'N140SY', fleet: 'Express', type: 'E175SC', operator: 'SkyWest dba UAX' },
    ],
    fleetStats: null,
    lastUpdated: null,
    syncedAt: null,
  }),
  fetchStarlinkFallback: async () => [],
  fetchExpressFleet: () => {
    if (ctl.expressMode === 'fail') return Promise.reject(new Error('down'));
    if (ctl.expressMode === 'pending') return new Promise(() => {});
    return Promise.resolve(ctl.expressTails);
  },
}));

let seen: FleetValue | null = null;
function Probe() {
  seen = useFleet();
  return null;
}
function current(): FleetValue {
  if (!seen) throw new Error('FleetProvider did not render');
  return seen;
}

async function mount(mode: 'ok' | 'fail' | 'pending'): Promise<FleetValue> {
  ctl.expressMode = mode;
  seen = null;
  render(
    <FleetProvider>
      <Probe />
    </FleetProvider>,
  );
  await waitFor(() => expect(seen?.loading).toBe(false));
  if (mode !== 'pending') {
    await waitFor(() => expect(seen?.expressStatus).toBe(mode === 'ok' ? 'ready' : 'failed'));
  }
  const value = current();
  cleanup();
  return value;
}

/** Feed rows: two mainline jets, two Express jets (one on the Starlink roster), one on the ground. */
const flight = (reg: string, callsign: string, acType: string, onGround = false) => ({
  fr24id: reg, icao24: '', lat: 41, lon: -87, hdg: 90, alt: onGround ? 0 : 10000, spd: onGround ? 0 : 230,
  vr: 0, squawk: null, acType, reg, origin: 'ORD', dest: 'DEN', flightIATA: `UA${callsign.slice(3)}`,
  callsign, onGround, airline: 'UAL',
});
const FLIGHTS = [
  flight('N37502', 'UAL1', 'B39M'),
  flight('N14512', 'UAL2', 'A21N'),
  flight('N85377', 'SKW5575', 'E75L'),
  flight('N140SY', 'SKW6005', 'E75L'),
  flight('N77430', 'UAL3', 'B739', true),
];

function liveStats(fleet: FleetValue) {
  return computeLiveStats(FLIGHTS, FLIGHTS, fleet.fleetDb.length, fleet.starlink.tails, {
    matchAircraft: (f: unknown) => matchAircraft(f, fleet.fleetByReg),
    isFiltered: false,
  });
}

beforeEach(() => {
  ctl.expressTails = [
    { r: 'N85377', op: 'SKW', ft: null, m: 'E175', lf: 'UA5575', fs: '2026-10-01T06:00:00Z', ls: '2026-10-04T18:00:24Z' },
    { r: 'N140SY', op: 'SKW', ft: null, m: 'E175', lf: 'UA6005', fs: '2026-10-01T05:00:00Z', ls: '2026-10-04T18:13:07Z' },
  ];
});

afterEach(() => cleanup());

describe('the United Express fleet leaves every mainline number alone', () => {
  it('fleetDb, fleetByReg and the Starlink roster are identical with Express loaded, failed or pending', async () => {
    const loaded = await mount('ok');
    const failed = await mount('fail');
    const pending = await mount('pending');

    for (const other of [failed, pending]) {
      expect(other.fleetDb).toEqual(loaded.fleetDb);
      expect(other.fleetByReg).toEqual(loaded.fleetByReg);
      expect([...other.starlink.tails].sort()).toEqual([...loaded.starlink.tails].sort());
      expect(other.starlink.aircraft).toEqual(loaded.starlink.aircraft);
    }
    expect(loaded.fleetDb).toHaveLength(3);
    // No Express tail ever lands in the mainline index.
    expect(Object.keys(loaded.fleetByReg).sort()).toEqual(['N14512', 'N37502', 'N77430']);
  });

  it('exposes the Express fleet only through its own index', async () => {
    const loaded = await mount('ok');
    expect(loaded.expressDb.map((e) => e.r)).toEqual(['N140SY', 'N85377']);
    expect(matchExpress(FLIGHTS[2], loaded.expressByReg)?.o).toBe('SkyWest Airlines');
    expect(loaded.expressByReg.N140SY.w).toBe('Starlink');
    // matchAircraft stays mainline-only.
    expect(matchAircraft(FLIGHTS[2], loaded.fleetByReg)).toBeNull();
    expect(matchAircraft(FLIGHTS[3], loaded.fleetByReg)).toBeNull();

    // A failed /api/express-fleet still knows the roster's Express tails, and nothing more.
    const failed = await mount('fail');
    expect(failed.expressDb.map((e) => e.r)).toEqual(['N140SY']);
  });

  it('computeLiveStats reports the same utilisation and counts either way', async () => {
    const loaded = await mount('ok');
    const failed = await mount('fail');
    const a = liveStats(loaded);
    const b = liveStats(failed);
    expect(a).toEqual(b);
    // 2 of 3 mainline airframes airborne; the Express jets are not "in the fleet".
    expect(a.utilization).toBe('67%');
  });
});
