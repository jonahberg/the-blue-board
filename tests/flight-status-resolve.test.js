import { describe, it, expect } from 'vitest';
import { resolveFlightStatus } from '../src/lib/flight-status-resolve.js';

describe('resolveFlightStatus', () => {
  it('returns empty string for missing or failed time-data', () => {
    expect(resolveFlightStatus(null, null)).toBe('');
    expect(resolveFlightStatus(undefined, null)).toBe('');
    expect(resolveFlightStatus({ success: false }, null)).toBe('');
  });

  it('takes cancelled/diverted precedence over everything', () => {
    expect(resolveFlightStatus({ cancelled: true, status: 'Landed' }, { onGround: true })).toBe('cancelled');
    expect(resolveFlightStatus({ diverted: true, status: 'Landed' }, { onGround: true })).toBe('diverted');
  });

  it('maps provider status text to states', () => {
    expect(resolveFlightStatus({ status: 'Landed' }, null)).toBe('landed');
    expect(resolveFlightStatus({ status: 'Arrived' }, null)).toBe('landed');
    expect(resolveFlightStatus({ status: 'En-Route' }, null)).toBe('en-route');
    expect(resolveFlightStatus({ status: 'Airborne' }, null)).toBe('en-route');
    expect(resolveFlightStatus({ status: 'In Flight' }, null)).toBe('en-route');
    expect(resolveFlightStatus({ status: 'Departed' }, null)).toBe('departed');
    expect(resolveFlightStatus({ status: 'Taxiing' }, null)).toBe('departed');
    expect(resolveFlightStatus({ status: 'Delayed' }, null)).toBe('delayed');
  });

  it('cross-references the live feed when status text is absent', () => {
    expect(resolveFlightStatus({ status: 'Scheduled' }, { onGround: false })).toBe('en-route');
  });

  it('onGround with an actual departure time means it has flown and landed', () => {
    const td = { status: 'Scheduled', departure: { takeoff: { actual: '2026-07-10T12:00:00Z' } } };
    expect(resolveFlightStatus(td, { onGround: true })).toBe('landed');
    const td2 = { status: 'Scheduled', departure: { gate: { actual: '2026-07-10T12:00:00Z' } } };
    expect(resolveFlightStatus(td2, { onGround: true })).toBe('landed');
  });

  it('onGround with no actual departure stays scheduled (never phantom-lands a parked jet)', () => {
    expect(resolveFlightStatus({ status: 'Scheduled', departure: {} }, { onGround: true })).toBe('scheduled');
  });

  it('measures delay at the GATE (scheduled vs estimated), at the 15-minute boundary', () => {
    const base = new Date('2026-07-10T12:00:00Z');
    const at = (min) => new Date(base.getTime() + min * 60000).toISOString();
    const mk = (est) => ({ status: 'Scheduled', departure: { gate: { scheduled: base.toISOString(), estimated: est } } });
    expect(resolveFlightStatus(mk(at(14)), null)).toBe('scheduled'); // 14 min: below threshold
    expect(resolveFlightStatus(mk(at(15)), null)).toBe('delayed');   // 15 min: at threshold
    expect(resolveFlightStatus(mk(at(60)), null)).toBe('delayed');
  });

  it('does NOT mint delayed from a late runway/takeoff estimate (incident #1 field-choice guard)', () => {
    // gate scheduled == gate estimated (on time at the gate), but takeoff.estimated is far later.
    // The runway time must never drive the delay decision.
    const td = {
      status: 'Scheduled',
      departure: {
        gate: { scheduled: '2026-07-10T12:00:00Z', estimated: '2026-07-10T12:00:00Z' },
        takeoff: { estimated: '2026-07-10T13:30:00Z' },
      },
    };
    expect(resolveFlightStatus(td, null)).toBe('scheduled');
  });
});
