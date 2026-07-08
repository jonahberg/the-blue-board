// F003/F055 (2026-07-08 review): Check-a-Connection must never render a green
// "SAFE" verdict for a cancelled/diverted leg or from NaN gate-time math, and must
// label the MCT figure as conservative comfort guidance rather than a published
// minimum. These tests pin the pure verdict logic.
import { describe, it, expect } from 'vitest';
import { classifyConnection, MIN_CONNECTION_TIMES, TERMINAL_WALK_TIMES, CONN_COLORS } from '../src/lib/connection-risk.js';

const base = {
  arrMs: Date.parse('2026-07-08T18:00:00Z'),
  depMs: Date.parse('2026-07-08T20:00:00Z'), // 120 min later
  mct: 75,
  walkTime: 12,
  inboundFlight: 'UA100',
  outboundFlight: 'UA200',
};

describe('classifyConnection — cancelled / diverted never SAFE (F003)', () => {
  it('cancelled inbound → AT RISK, red, names the flight, never SAFE', () => {
    const r = classifyConnection({ ...base, inboundCancelled: true });
    expect(r.state).toBe('disrupted');
    expect(r.risk).toBe('AT RISK');
    expect(r.color).toBe(CONN_COLORS.risk);
    expect(r.label).toContain('UA100');
    expect(r.label).toContain('cancelled');
    expect(r.risk).not.toBe('SAFE');
  });

  it('cancelled outbound → AT RISK and names the outbound flight', () => {
    const r = classifyConnection({ ...base, outboundCancelled: true });
    expect(r.state).toBe('disrupted');
    expect(r.label).toContain('UA200');
  });

  it('diverted leg → AT RISK, never SAFE (even with a comfortable buffer)', () => {
    const r = classifyConnection({ ...base, inboundDiverted: true });
    expect(r.state).toBe('disrupted');
    expect(r.risk).toBe('AT RISK');
    expect(r.label).toContain('diverted');
  });

  it('cancellation overrides an otherwise-comfortable buffer', () => {
    // 120 min connection, 12 walk → buffer 108 > mct 75 would be SAFE if scored.
    const safe = classifyConnection(base);
    expect(safe.risk).toBe('SAFE');
    const cancelled = classifyConnection({ ...base, outboundCancelled: true });
    expect(cancelled.risk).toBe('AT RISK');
  });
});

describe('classifyConnection — missing/NaN times are insufficient, never SAFE (F003)', () => {
  it('NaN arrival → insufficient (neutral), never SAFE', () => {
    const r = classifyConnection({ ...base, arrMs: NaN });
    expect(r.state).toBe('insufficient');
    expect(r.risk).not.toBe('SAFE');
    expect(r.color).toBe(CONN_COLORS.neutral);
    expect(r.connectionMin).toBeNull();
    expect(r.hasData).toBe(false);
  });

  it('undefined departure → insufficient, never SAFE', () => {
    const r = classifyConnection({ ...base, depMs: undefined });
    expect(r.state).toBe('insufficient');
    expect(r.risk).not.toBe('SAFE');
  });

  it('both times absent → insufficient', () => {
    const r = classifyConnection({ ...base, arrMs: NaN, depMs: NaN });
    expect(r.state).toBe('insufficient');
  });
});

describe('classifyConnection — scored buffers', () => {
  it('comfortable buffer → SAFE, green', () => {
    const r = classifyConnection(base);
    expect(r.state).toBe('scored');
    expect(r.risk).toBe('SAFE');
    expect(r.color).toBe(CONN_COLORS.safe);
    expect(r.connectionMin).toBe(120);
    expect(r.buffer).toBe(108);
  });

  it('tight buffer (< mct but >= mct/2) → MODERATE, yellow', () => {
    // connection 60 min, walk 12 → buffer 48; mct 75 → 48 < 75 and 48 >= 37.5.
    const r = classifyConnection({ ...base, depMs: base.arrMs + 60 * 60000 });
    expect(r.risk).toBe('MODERATE');
    expect(r.color).toBe(CONN_COLORS.moderate);
  });

  it('very tight buffer (< mct/2) → HIGH, red', () => {
    // connection 40 min, walk 12 → buffer 28; mct 75 → 28 < 37.5.
    const r = classifyConnection({ ...base, depMs: base.arrMs + 40 * 60000 });
    expect(r.risk).toBe('HIGH');
    expect(r.color).toBe(CONN_COLORS.risk);
  });

  it('outbound departs before inbound arrives → MISSED, red', () => {
    const r = classifyConnection({ ...base, depMs: base.arrMs - 30 * 60000 });
    expect(r.risk).toBe('MISSED');
    expect(r.color).toBe(CONN_COLORS.risk);
    expect(r.connectionMin).toBeLessThanOrEqual(0);
  });
});

describe('MCT + walk tables are intact after the lib extraction', () => {
  it('ORD dom-dom comfort guidance is the padded 75 (labeled honestly in the UI)', () => {
    expect(MIN_CONNECTION_TIMES.ORD.dd).toBe(75);
    expect(MIN_CONNECTION_TIMES.LAX.dd).toBe(75);
    expect(MIN_CONNECTION_TIMES.GUM.dd).toBe(45);
  });
  it('terminal walk tables carry hub defaults', () => {
    expect(TERMINAL_WALK_TIMES.ORD.default).toBe(12);
    expect(TERMINAL_WALK_TIMES.EWR['B-C']).toBe(8);
  });
});
