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

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FleetProvider, useFleet } from '../src/app/state/fleet';
import type { FleetValue } from '../src/app/state/fleet';

const ctl = vi.hoisted(() => ({
  fleetDb: [] as unknown[],
  starlink: null as unknown,
  starlinkFails: false,
  fallback: [] as unknown[],
}));

vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchFleetDb: async () => ctl.fleetDb,
  fetchFleetSummary: async () => null,
  fetchStarlinkData: async () => {
    if (ctl.starlinkFails) throw new Error('starlink-data down');
    return ctl.starlink;
  },
  fetchStarlinkFallback: async () => ctl.fallback,
}));

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
});

afterEach(cleanup);

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
