// @vitest-environment jsdom
/**
 * "Check a connection" (My Flights).
 *
 * F1: with the payloads /api/flight-times now returns (board gate times + FR24 live overlay), the
 * audit's own pair UA2106 → UA2278 at SFO gets a real verdict instead of "NO DATA".
 * F63: the inputs are 16px on phones (iOS zooms into anything smaller on focus) and their
 * placeholders fit a ~126px input.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const payloads = vi.hoisted(() => ({ byFlight: {} as Record<string, unknown> }));
vi.mock('../src/app/data/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/app/data/api')>()),
  fetchFlightTimes: async (flight: string) => payloads.byFlight[flight],
}));

import { ManualConnectionCheck } from '../src/app/views/myflight/ConnectionPanel';

const triple = (scheduled = '', estimated = '', actual = '') => ({ scheduled, estimated, actual });
function payload(o: {
  flight: string; from: string; to: string; fromTerminal: string; toTerminal: string;
  depSched: string; depEst: string; arrSched: string; arrEst: string; source: string; status: string;
}) {
  return {
    success: true,
    flight: o.flight,
    origin: { iata: o.from, name: '', terminal: o.fromTerminal, gate: '', tz: '' },
    destination: { iata: o.to, name: '', terminal: o.toTerminal, gate: '', tz: '' },
    departure: { gate: triple(o.depSched, o.depEst), takeoff: triple() },
    arrival: { landing: triple(), gate: triple(o.arrSched, o.arrEst) },
    aircraft: 'Airbus A321 NEO', registration: 'N14512', status: o.status,
    cancelled: false, diverted: false, source: o.source, cached: false,
  };
}

afterEach(() => cleanup());

describe('ManualConnectionCheck', () => {
  it('answers the audit repro with a verdict, not NO DATA (F1)', async () => {
    // Values from the real board rows in tests/fixtures/schedule-board-rows.json.
    payloads.byFlight = {
      UA2106: payload({
        flight: 'UA2106', from: 'ORD', to: 'SFO', fromTerminal: '1', toTerminal: '3',
        depSched: '2026-09-27T02:40:00.000Z', depEst: '',
        arrSched: '2026-09-27T07:30:00.000Z', arrEst: '2026-09-27T07:29:00.000Z',
        source: 'schedule-cache+fr24', status: 'en-route',
      }),
      UA2278: payload({
        flight: 'UA2278', from: 'SFO', to: 'ORD', fromTerminal: '2', toTerminal: '1',
        depSched: '2026-09-27T05:35:00.000Z', depEst: '2026-09-27T05:35:00.000Z',
        arrSched: '2026-09-27T09:44:00.000Z', arrEst: '2026-09-27T09:28:00.000Z',
        source: 'schedule-cache', status: 'scheduled',
      }),
    };
    render(<ManualConnectionCheck />);
    fireEvent.change(screen.getByLabelText('Inbound flight number'), { target: { value: 'UA2106' } });
    fireEvent.change(screen.getByLabelText('Outbound flight number'), { target: { value: 'UA2278' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByText(/Inbound arrives after outbound departs/)).toBeTruthy();
    expect(screen.queryByText(/NO DATA/i)).toBeNull();
  });

  it('uses 16px inputs on phones and compact ones from md up, with placeholders that fit (F63)', () => {
    render(<ManualConnectionCheck />);
    for (const label of ['Inbound flight number', 'Outbound flight number']) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      const classes = input.className.split(/\s+/);
      expect(classes).toContain('text-base');
      expect(classes).toContain('md:text-[11px]');
      expect(classes).not.toContain('text-[11px]');
      expect(input.placeholder.length).toBeLessThanOrEqual(12);
    }
  });
});
