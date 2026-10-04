// @vitest-environment jsdom
/**
 * #249 port — the fleet store must reconcile the static fleet database with the live Starlink
 * roster, the way the legacy `loadFleetData()` did:
 *
 *  1. `applyVerifiedStarlinkOverrides` adds evidence-backed tails the upstream tracker is missing
 *     (both on the live path and on the static-roster fallback), without duplicating a tail the
 *     upstream already carries.
 *  2. `applyStarlinkWifiOverlay` relabels `w` to 'Starlink' for every airframe in the Starlink
 *     set, so the WiFi column / aircraft dialog / flight sheet stop showing "ViaSat Ka" beside a
 *     Starlink badge. `/data/fleet.json` is a build artefact that lags retrofits by months.
 */

import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FleetProvider, useFleet } from '../src/app/state/fleet';
import type { FleetValue } from '../src/app/state/fleet';

const ctl = vi.hoisted(() => ({
  fleetDb: [] as unknown[],
  starlink: null as unknown,
  starlinkFails: false,
  fallback: [] as unknown[],
  flights: { N11111: [{ flight_number: 'UA1', origin: 'ORD', destination: 'DEN', departure_ts: 1 }] } as unknown,
  flightsFails: false,
  requests: [] as string[],
}));

vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchFleetDb: async () => ctl.fleetDb,
  fetchFleetSummary: async () => null,
  fetchStarlinkFallback: async () => ctl.fallback,
  // The Express fleet has its own suite (express-fleet-mainline-guard); keep it off fetch() here.
  fetchExpressFleet: async () => [],
}));

// `/api/starlink-data?fields=…` goes through fetch() — modelled the way the endpoint answers:
// the roster without schedules, and the schedules on their own.
function stubFetch() {
  vi.stubGlobal('fetch', async (url: string) => {
    ctl.requests.push(url);
    const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 502, json: async () => body });
    if (url === '/api/starlink-data?fields=roster') {
      if (ctl.starlinkFails) return json({ error: 'down' }, false);
      const { flightsByTail: _omit, ...roster } = ctl.starlink as Record<string, unknown>;
      return json(roster);
    }
    if (url === '/api/starlink-data?fields=flights') {
      if (ctl.flightsFails) return json({ error: 'down' }, false);
      return json({ flightsByTail: ctl.flights, lastUpdated: null, syncedAt: null });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
}

let seen: FleetValue | null = null;
function Probe() {
  seen = useFleet();
  return null;
}

async function mountStore(): Promise<FleetValue> {
  render(
    <FleetProvider>
      <Probe />
    </FleetProvider>,
  );
  await waitFor(() => expect(seen?.loading).toBe(false));
  return seen as FleetValue;
}

const row = (r: string, w: string) => ({ r, t: '737-800', w });
const sl = (tail: string) => ({ tail, fleet: 'Mainline', type: '737-800', wifi: 'Starlink' });

beforeEach(() => {
  seen = null;
  ctl.fleetDb = [row('N11111', 'ViaSatKA'), row('N22222', 'Satl Ku'), row('N76265', 'ViaSatKA')];
  ctl.starlink = { aircraft: [sl('N11111')], fleetStats: null, flightsByTail: {} };
  ctl.starlinkFails = false;
  ctl.fallback = [sl('N11111')];
  ctl.flightsFails = false;
  ctl.requests = [];
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('FleetProvider Starlink reconciliation (#249)', () => {
  it('relabels WiFi to Starlink for tails in the live Starlink set, in fleetDb and fleetByReg', async () => {
    const fleet = await mountStore();
    expect(fleet.fleetByReg.N11111.w).toBe('Starlink');
    expect(fleet.fleetDb.find((a) => a.r === 'N11111')?.w).toBe('Starlink');
    // Not in the Starlink set: left exactly as the database has it.
    expect(fleet.fleetByReg.N22222.w).toBe('Satl Ku');
  });

  it('adds the verified N76265 override on the live path and relabels its WiFi', async () => {
    const fleet = await mountStore();
    expect(fleet.starlink.tails.has('N76265')).toBe(true);
    expect(fleet.starlink.aircraft.filter((a) => a.tail === 'N76265')).toHaveLength(1);
    expect(fleet.fleetByReg.N76265.w).toBe('Starlink');
  });

  it('does not duplicate a tail the upstream roster already carries', async () => {
    ctl.starlink = { aircraft: [sl('N11111'), sl('N76265')], fleetStats: null, flightsByTail: {} };
    const fleet = await mountStore();
    expect(fleet.starlink.aircraft.filter((a) => a.tail === 'N76265')).toHaveLength(1);
  });

  it('applies the override and the overlay on the degraded static-roster fallback too', async () => {
    ctl.starlinkFails = true;
    const fleet = await mountStore();
    expect(fleet.starlink.degraded).toBe(true);
    expect(fleet.starlink.tails.has('N76265')).toBe(true);
    expect(fleet.fleetByReg.N11111.w).toBe('Starlink');
    expect(fleet.fleetByReg.N76265.w).toBe('Starlink');
  });
});

describe('FleetProvider Starlink schedules are lazy (F58)', () => {
  it('boots on the roster alone and never downloads flightsByTail until asked', async () => {
    const fleet = await mountStore();
    expect(ctl.requests).toEqual(['/api/starlink-data?fields=roster']);
    expect(fleet.starlink.flightsStatus).toBe('idle');
    expect(fleet.starlink.flightsByTail).toEqual({});
    expect(fleet.starlink.tails.has('N11111')).toBe(true);
  });

  it('loads the schedules once on demand', async () => {
    const fleet = await mountStore();
    await act(async () => {
      fleet.loadStarlinkFlights();
      fleet.loadStarlinkFlights();
    });
    await waitFor(() => expect(seen?.starlink.flightsStatus).toBe('ready'));
    expect(Object.keys(seen!.starlink.flightsByTail)).toEqual(['N11111']);
    expect(ctl.requests.filter((u) => u.endsWith('fields=flights'))).toHaveLength(1);
    // The roster survives the schedules landing.
    expect(seen!.starlink.tails.has('N11111')).toBe(true);
  });

  it('marks a failed schedules fetch and retries on the next request', async () => {
    ctl.flightsFails = true;
    const fleet = await mountStore();
    await act(async () => fleet.loadStarlinkFlights());
    await waitFor(() => expect(seen?.starlink.flightsStatus).toBe('failed'));
    ctl.flightsFails = false;
    await act(async () => seen!.loadStarlinkFlights());
    await waitFor(() => expect(seen?.starlink.flightsStatus).toBe('ready'));
  });

  it('uses schedules an older server still inlines in the roster', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ ...(ctl.starlink as object), flightsByTail: ctl.flights }) }));
    const fleet = await mountStore();
    expect(fleet.starlink.flightsStatus).toBe('ready');
    expect(Object.keys(fleet.starlink.flightsByTail)).toEqual(['N11111']);
  });
});
