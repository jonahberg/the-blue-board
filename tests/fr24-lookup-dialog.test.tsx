// @vitest-environment jsdom
/**
 * F0 (Sep 2026 audit) — `/?flight=UA2278` opened the lookup dialog on "UA2278 LANDED … N24542"
 * while tonight's UA2278 had not left the gate: FR24's summary lists only legs that have
 * operated, and the dialog presented yesterday's as the flight. /api/fr24-flight now flags such
 * an answer `previousLeg`; the dialog must say it is the last completed leg, with its date.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const lookup = vi.hoisted(() => ({ response: null as unknown }));

// One stable object: the dialog's effect depends on `openFr24`/`announce`, and fresh functions
// per render would re-run the lookup forever.
const ui = vi.hoisted(() => ({ fr24Query: 'UA2278', openFr24: () => {}, openAircraft: () => {}, announce: () => {} }));
vi.mock('../src/app/state/ui', () => ({ useUi: () => ui }));
const fleet = vi.hoisted(() => ({ fleetDb: [] }));
vi.mock('../src/app/state/fleet', () => ({ useFleet: () => fleet }));
vi.mock('../src/app/data/api', () => ({ fetchFr24Flight: async () => lookup.response }));

import Fr24LookupDialog from '../src/app/features/Fr24LookupDialog';

/** /api/fr24-flight's answer for UA2278 at 2026-09-27T04:33Z (normalised yesterday's leg). */
function response(previousLeg: boolean) {
  return {
    success: true,
    source: 'fr24-official-summary',
    liveLeg: false,
    legDate: '2026-09-26T06:02:02Z',
    previousLeg,
    cached: false,
    flight: {
      flightNumber: 'UA2278',
      callsign: 'UAL2278',
      status: 'landed',
      origin: { iata: 'SFO', icao: 'KSFO', name: '' },
      destination: { iata: 'ORD', icao: 'KORD', name: '' },
      aircraft: { type: 'A21N', reg: 'N24542' },
      departure: { scheduled: '', actual: '2026-09-26T06:02:02Z' },
      arrival: { scheduled: '', estimated: '', actual: '2026-09-26T09:38:04Z' },
      position: null,
      flightId: '3c9a1f2e',
    },
  };
}

afterEach(() => cleanup());

describe('Fr24LookupDialog previous-leg label (F0)', () => {
  it('labels an earlier completed leg as "Last operated <date>", not as the flight', async () => {
    lookup.response = response(true);
    render(<Fr24LookupDialog />);
    expect(await screen.findByText(/Last operated/)).toBeTruthy();
    expect(screen.getByText(/not today.s flight/)).toBeTruthy();
    // The landing is shown as what it is — an actual — not as an arrival estimate.
    expect(screen.getByText('Arr Actual')).toBeTruthy();
    expect(screen.queryByText('Arr Est')).toBeNull();
  });

  it('says nothing extra about a current leg', async () => {
    lookup.response = response(false);
    render(<Fr24LookupDialog />);
    expect(await screen.findByText('Arr Actual')).toBeTruthy();
    expect(screen.queryByText(/Last operated/)).toBeNull();
  });
});
