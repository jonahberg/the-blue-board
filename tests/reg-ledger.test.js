import { describe, it, expect } from 'vitest';
import {
  normalizeFlightNum, recordSightings, lookupReg, pruneLedger, deserializeLedger,
} from '../src/lib/reg-ledger.js';

const H = 3600e3;

describe('normalizeFlightNum', () => {
  it('normalizes UA/UAL variants with spaces and leading zeros', () => {
    expect(normalizeFlightNum('UA123')).toBe('UA123');
    expect(normalizeFlightNum('ua 123')).toBe('UA123');
    expect(normalizeFlightNum('UAL0123')).toBe('UA123');
    expect(normalizeFlightNum('UA 0042')).toBe('UA42');
  });
  it('rejects non-mainline and garbage', () => {
    expect(normalizeFlightNum('G7929')).toBeNull();   // United Express operator ident
    expect(normalizeFlightNum('NK3005')).toBeNull();
    expect(normalizeFlightNum('UA')).toBeNull();
    expect(normalizeFlightNum('')).toBeNull();
    expect(normalizeFlightNum(null)).toBeNull();
    expect(normalizeFlightNum('UA12345')).toBeNull(); // >4 digits
  });
});

describe('recordSightings', () => {
  it('records by flightIATA, falls back to callsign, skips reg-less flights', () => {
    const ledger = {};
    recordSightings(ledger, [
      { flightIATA: 'UA123', callsign: 'UAL123', reg: 'N12345' },
      { flightIATA: '', callsign: 'UAL456', reg: 'N45678' },
      { flightIATA: 'UA789', callsign: 'UAL789', reg: '' },
    ], 1000);
    expect(ledger.UA123).toEqual({ reg: 'N12345', seenAt: 1000 });
    expect(ledger.UA456).toEqual({ reg: 'N45678', seenAt: 1000 });
    expect(ledger.UA789).toBeUndefined();
  });
  it('latest sighting wins', () => {
    const ledger = { UA123: { reg: 'N11111', seenAt: 1000 } };
    recordSightings(ledger, [{ flightIATA: 'UA123', reg: 'N22222' }], 2000);
    expect(ledger.UA123).toEqual({ reg: 'N22222', seenAt: 2000 });
  });
});

describe('lookupReg — sighting must fall inside this flight instance', () => {
  const dep = 1_750_000_000;            // scheduled departure (unix seconds)
  const arr = dep + 4 * 3600;           // scheduled arrival
  const ledgerAt = (seenAt) => ({ UA123: { reg: 'N12345', seenAt } });

  it('fills when seen between departure and arrival', () => {
    expect(lookupReg(ledgerAt(dep * 1000 + H), 'UA 123', dep, arr)).toBe('N12345');
  });
  it('allows taxi-out (2h before dep) and post-arrival (3h after)', () => {
    expect(lookupReg(ledgerAt(dep * 1000 - 1.9 * H), 'UA123', dep, arr)).toBe('N12345');
    expect(lookupReg(ledgerAt(arr * 1000 + 2.9 * H), 'UA123', dep, arr)).toBe('N12345');
  });
  it("never pins another day's tail on this flight number", () => {
    expect(lookupReg(ledgerAt(dep * 1000 - 24 * H), 'UA123', dep, arr)).toBeNull();
    expect(lookupReg(ledgerAt(arr * 1000 + 24 * H), 'UA123', dep, arr)).toBeNull();
  });
  it('uses a 16h span when arrival is missing', () => {
    expect(lookupReg(ledgerAt(dep * 1000 + 10 * H), 'UA123', dep, null)).toBe('N12345');
    expect(lookupReg(ledgerAt(dep * 1000 + 20 * H), 'UA123', dep, null)).toBeNull();
  });
  it('returns null without a scheduled departure, unknown key, or malformed entry', () => {
    expect(lookupReg(ledgerAt(dep * 1000), 'UA123', 0, arr)).toBeNull();
    expect(lookupReg({}, 'UA123', dep, arr)).toBeNull();
    expect(lookupReg({ UA123: { reg: 'N1', seenAt: 'nope' } }, 'UA123', dep, arr)).toBeNull();
  });
});

describe('pruneLedger', () => {
  it('drops entries older than 36h and caps at 1500 newest', () => {
    const now = 100 * H;
    const ledger = { OLD: { reg: 'N1', seenAt: now - 37 * H }, NEW: { reg: 'N2', seenAt: now - H } };
    for (let i = 0; i < 1600; i++) ledger[`UA${i}`] = { reg: 'N3', seenAt: now - 2 * H - i };
    pruneLedger(ledger, now);
    expect(ledger.OLD).toBeUndefined();
    expect(ledger.NEW).toBeDefined();
    expect(Object.keys(ledger).length).toBe(1500);
  });
});

describe('deserializeLedger', () => {
  it('round-trips valid entries and rejects malformed ones', () => {
    const json = JSON.stringify({
      UA123: { reg: 'N12345', seenAt: 1000 },
      BAD1: { reg: 42, seenAt: 1000 },
      BAD2: { reg: 'N1' },
    });
    expect(deserializeLedger(json)).toEqual({ UA123: { reg: 'N12345', seenAt: 1000 } });
  });
  it('returns {} for garbage, arrays, null', () => {
    expect(deserializeLedger('not json')).toEqual({});
    expect(deserializeLedger('[1,2]')).toEqual({});
    expect(deserializeLedger(null)).toEqual({});
  });
});

describe('the ledger is keyed per leg (F15)', () => {
  const H = 3600e3;
  const T = 1_750_000_000; // seconds

  it('records a routed sighting under flight + origin + dest, and a route-less one under the number', () => {
    const ledger = {};
    recordSightings(ledger, [
      { flightIATA: 'UA123', reg: 'N76265', origin: 'san', dest: 'SFO' },
      { flightIATA: 'UA456', reg: 'N1' },
    ], 1000);
    expect(ledger['UA123|SAN|SFO']).toEqual({ reg: 'N76265', seenAt: 1000, origin: 'SAN', dest: 'SFO' });
    expect(ledger.UA456).toEqual({ reg: 'N1', seenAt: 1000 });
  });

  it('never pins the SAN→SFO tail onto the SFO→ORD leg flown an hour later under the same number', () => {
    const ledger = {};
    // Seen at T on SAN→SFO; the SFO→ORD leg departs at T+1h (inside the time window).
    recordSightings(ledger, [{ flightIATA: 'UA123', reg: 'N76265', origin: 'SAN', dest: 'SFO' }], T * 1000);
    expect(lookupReg(ledger, 'UA123', T + 3600, T + 5 * 3600, 'SFO', 'ORD')).toBeNull();
    expect(lookupReg(ledger, 'UA123', T - 1800, T + 1800, 'SAN', 'SFO')).toBe('N76265');
  });

  it('keeps both legs of a multi-leg number instead of the later overwriting the earlier', () => {
    const ledger = {};
    recordSightings(ledger, [{ flightIATA: 'UA123', reg: 'N11111', origin: 'SAN', dest: 'SFO' }], T * 1000);
    recordSightings(ledger, [{ flightIATA: 'UA123', reg: 'N22222', origin: 'SFO', dest: 'ORD' }], T * 1000 + H);
    expect(lookupReg(ledger, 'UA123', T - 1800, T + 1800, 'SAN', 'SFO')).toBe('N11111');
    expect(lookupReg(ledger, 'UA123', T + 3600, T + 5 * 3600, 'SFO', 'ORD')).toBe('N22222');
  });

  it('a route-less sighting still fills any leg, and a row with one unknown end checks the other', () => {
    const ledger = { UA123: { reg: 'N33333', seenAt: T * 1000 } };
    expect(lookupReg(ledger, 'UA123', T, T + 3600, 'SFO', 'ORD')).toBe('N33333');
    const routed = { 'UA123|SAN|SFO': { reg: 'N44444', seenAt: T * 1000, origin: 'SAN', dest: 'SFO' } };
    expect(lookupReg(routed, 'UA123', T, T + 3600, '', 'SFO')).toBe('N44444');
    expect(lookupReg(routed, 'UA123', T, T + 3600, '', 'ORD')).toBeNull();
  });

  it('round-trips the leg through storage', () => {
    const ledger = { 'UA1|SAN|SFO': { reg: 'N1', seenAt: 5, origin: 'SAN', dest: 'SFO' } };
    expect(deserializeLedger(JSON.stringify(ledger))).toEqual(ledger);
  });
});
