import { describe, it, expect } from 'vitest';
import {
  delayBucket,
  delayEscalation,
  isForwardTransition,
  laterPhase,
  phaseOfStatusKey,
  phaseOfStatusText,
} from '../src/lib/watch-rules.js';
import { applyLegEvidence, legFromPayload, mergeLegRows, resolveLegState, sightingLegEvidence } from '../src/lib/watch-leg.js';

describe('watch-rules: phases', () => {
  it('maps every vocabulary a watch sees onto one phase', () => {
    const cases = {
      scheduled: ['Scheduled', 'expected', 'Expected', 'On time', 'Boarding', 'Delayed', 'estimated', 'gateclosed'],
      departed: ['Departed', 'departed', 'En Route', 'En route', 'en-route', 'Enroute', 'Approaching', 'airborne', 'active'],
      landed: ['Landed', 'landed', 'Arrived', 'arrived'],
      cancelled: ['Canceled', 'cancelled', 'CANCELED'],
      likely_canceled: ['Likely Canceled', 'canceled_uncertain', 'CanceledUncertain'],
      diverted: ['Diverted'],
      unknown: ['', 'Unknown', 'N/A', '—', null, undefined],
    };
    for (const [phase, words] of Object.entries(cases)) {
      for (const w of words) expect([w, phaseOfStatusText(w)]).toEqual([w, phase]);
    }
  });
  it('maps the board classifier keys', () => {
    expect(['scheduled', 'estimated', 'delayed'].map(phaseOfStatusKey)).toEqual(['scheduled', 'scheduled', 'scheduled']);
    expect(['departed', 'enroute'].map(phaseOfStatusKey)).toEqual(['departed', 'departed']);
    expect(phaseOfStatusKey('landed')).toBe('landed');
    expect(phaseOfStatusKey('canceled')).toBe('cancelled');
    expect(phaseOfStatusKey('canceled_uncertain')).toBe('likely_canceled');
    expect(phaseOfStatusKey('unknown')).toBe('unknown');
  });
  it('forward only; never into or out of unknown; terminal is terminal', () => {
    expect(isForwardTransition('scheduled', 'departed')).toBe(true);
    expect(isForwardTransition('scheduled', 'landed')).toBe(true);
    expect(isForwardTransition('likely_canceled', 'departed')).toBe(true);
    expect(isForwardTransition('likely_canceled', 'cancelled')).toBe(true);
    expect(isForwardTransition('departed', 'landed')).toBe(true);
    expect(isForwardTransition('departed', 'diverted')).toBe(true);
    expect(isForwardTransition('landed', 'diverted')).toBe(true);
    expect(isForwardTransition('scheduled', 'likely_canceled')).toBe(false);
    expect(isForwardTransition('landed', 'departed')).toBe(false);
    expect(isForwardTransition('landed', 'scheduled')).toBe(false);
    expect(isForwardTransition('landed', 'cancelled')).toBe(false);
    expect(isForwardTransition('cancelled', 'departed')).toBe(false);
    expect(isForwardTransition('unknown', 'departed')).toBe(false);
    expect(isForwardTransition('departed', 'unknown')).toBe(false);
    expect(isForwardTransition('departed', 'departed')).toBe(false);
  });
  it('laterPhase keeps the furthest-along phase', () => {
    expect(laterPhase('landed', 'departed')).toBe('landed');
    expect(laterPhase('departed', 'landed')).toBe('landed');
    expect(laterPhase('scheduled', 'likely_canceled')).toBe('likely_canceled');
    expect(laterPhase('likely_canceled', 'scheduled')).toBe('scheduled');
    expect(laterPhase('departed', 'unknown')).toBe('departed');
    expect(laterPhase(undefined, 'scheduled')).toBe('scheduled');
  });
});

describe('watch-rules: delay bands', () => {
  it('0 / 15 / 30 / 60, then each further hour', () => {
    expect([null, -5, 0, 14, 15, 29, 30, 59, 60, 119, 120, 179, 185].map(delayBucket)).toEqual([0, 0, 0, 0, 15, 15, 30, 30, 60, 60, 120, 120, 180]);
  });
  it('escalates only upward', () => {
    expect(delayEscalation(0, 16)).toBe(15);
    expect(delayEscalation(15, 29)).toBeNull();
    expect(delayEscalation(30, 25)).toBeNull();
    expect(delayEscalation(30, 61)).toBe(60);
    expect(delayEscalation(undefined, 40)).toBe(30);
  });
});

// ── watch-leg ──
const DEP = Date.parse('2026-10-03T18:00:00Z');
const ARR = Date.parse('2026-10-03T20:00:00Z'); // two-hour block
const leg = (extra = {}) => ({
  schedDepMs: DEP, estDepMs: NaN, gateDepMs: NaN, actualDepMs: NaN, schedArrMs: ARR, estArrMs: NaN, actualArrMs: NaN,
  origin: 'ORD', dest: 'MSN', ...extra,
});
const min = (n) => n * 60000;

describe('sightingLegEvidence', () => {
  const s = (extra) => ({ reg: 'N1', origin: 'ORD', dest: 'MSN', ...extra });
  it('airborne out of this origin inside the window', () => {
    expect(sightingLegEvidence(s({ airborneAtMs: DEP + min(20), seenAtMs: DEP + min(20) }), leg(), DEP + min(25))?.kind).toBe('airborne');
    expect(sightingLegEvidence(s({ airborneAtMs: DEP - min(14), seenAtMs: DEP - min(14) }), leg(), DEP)?.kind).toBe('airborne');
  });
  it('nothing for a ground-only record, another origin, a contradicting destination, or outside the window', () => {
    expect(sightingLegEvidence(s({ airborneAtMs: null, seenAtMs: DEP + min(20) }), leg(), DEP + min(25))).toBeNull();
    expect(sightingLegEvidence(s({ origin: 'DEN', airborneAtMs: DEP + min(20), seenAtMs: DEP + min(20) }), leg(), DEP + min(25))).toBeNull();
    expect(sightingLegEvidence(s({ origin: '', airborneAtMs: DEP + min(20), seenAtMs: DEP + min(20) }), leg(), DEP + min(25))).toBeNull();
    expect(sightingLegEvidence(s({ dest: 'DSM', airborneAtMs: DEP + min(20), seenAtMs: DEP + min(20) }), leg(), DEP + min(25))).toBeNull();
    expect(sightingLegEvidence(s({ airborneAtMs: DEP - min(16), seenAtMs: DEP - min(16) }), leg(), DEP)).toBeNull();
    expect(sightingLegEvidence(s({ airborneAtMs: DEP + 19 * 3600e3, seenAtMs: DEP + 19 * 3600e3 }), leg(), DEP + 20 * 3600e3)).toBeNull();
  });
  it('landed: ground after airborne, on this route, late in the block', () => {
    expect(sightingLegEvidence(s({ airborneAtMs: ARR - min(10), seenAtMs: ARR }), leg(), ARR + min(5))?.kind).toBe('landed');
  });
  it('landed for a flight four hours late — beyond the scheduled-arrival + 3 h sighting window', () => {
    const late = 4 * 3600e3;
    const ev = sightingLegEvidence(s({ airborneAtMs: ARR + late - min(8), seenAtMs: ARR + late + min(2) }), leg({ actualDepMs: DEP + late, gateDepMs: DEP + late }), ARR + late + min(5));
    expect(ev?.kind).toBe('landed');
  });
  it('not landed: back on the ground early in the block, or no destination on the ground record', () => {
    expect(sightingLegEvidence(s({ airborneAtMs: DEP + min(30), seenAtMs: DEP + min(45) }), leg({ actualDepMs: DEP }), DEP + min(50))?.kind).toBe('airborne');
    expect(sightingLegEvidence(s({ dest: '', airborneAtMs: ARR - min(10), seenAtMs: ARR }), leg(), ARR + min(5))?.kind).toBe('airborne');
  });
});

describe('applyLegEvidence / resolveLegState', () => {
  const payload = (extra = {}) => ({
    success: true, status: 'scheduled', cancelled: false, diverted: false,
    origin: { iata: 'ORD', gate: 'F1', tz: 'America/Chicago' }, destination: { iata: 'MSN', tz: 'America/Chicago' },
    departure: { gate: { scheduled: new Date(DEP).toISOString(), estimated: '', actual: '' }, takeoff: {} },
    arrival: { gate: { scheduled: new Date(ARR).toISOString(), estimated: '', actual: '' }, landing: {} },
    registration: 'N1', aircraft: 'E175', ...extra,
  });
  it('only ever upgrades', () => {
    const airborne = { reg: 'N1', origin: 'ORD', dest: 'MSN', airborneAtMs: DEP + min(20), seenAtMs: DEP + min(20) };
    expect(applyLegEvidence(payload(), airborne, DEP + min(25)).status).toBe('departed');
    const landed = payload({ status: 'landed' });
    expect(applyLegEvidence(landed, airborne, DEP + min(25))).toBe(landed);
    const cancelled = payload({ status: 'canceled', cancelled: true });
    expect(applyLegEvidence(cancelled, airborne, DEP + min(25))).toBe(cancelled);
  });
  it('resolves phase, reason, delay and the leg date', () => {
    const st = resolveLegState(payload({ departure: { gate: { scheduled: new Date(DEP).toISOString(), estimated: new Date(DEP + min(42)).toISOString(), actual: '' } } }), DEP - min(60));
    expect(st).toMatchObject({ phase: 'scheduled', delayMin: 42, legDate: '2026-10-03', origin: 'ORD', dest: 'MSN', gate: 'F1', reg: 'N1' });
    expect(resolveLegState(payload({ status: 'landed', evidence: { kind: 'ground-at-destination' } }), ARR)).toMatchObject({ phase: 'landed', reason: 'ground-at-destination' });
    expect(resolveLegState(payload({ arrival: { gate: { actual: new Date(ARR).toISOString() } } }), ARR + 1)).toMatchObject({ phase: 'landed', reason: 'actual-arrival' });
    expect(resolveLegState(payload({ status: 'landed', diverted: true }), ARR)).toMatchObject({ phase: 'diverted' });
    expect(resolveLegState(payload({ status: 'canceled_uncertain' }), DEP).phase).toBe('likely_canceled');
    // A leg we cannot date cannot be watched.
    expect(resolveLegState(payload({ departure: { gate: {} } }), DEP)).toBeNull();
    expect(resolveLegState({ success: false }, DEP)).toBeNull();
  });
  it('legFromPayload falls back to takeoff/landing times', () => {
    const l = legFromPayload({ departure: { gate: {}, takeoff: { scheduled: '2026-10-03T18:10:00Z', actual: '2026-10-03T18:20:00Z' } }, arrival: { landing: { actual: '2026-10-03T20:00:00Z' } } });
    expect(l.schedDepMs).toBe(Date.parse('2026-10-03T18:10:00Z'));
    expect(l.actualDepMs).toBe(Date.parse('2026-10-03T18:20:00Z'));
    expect(l.gateDepMs).toBeNaN();
    expect(l.actualArrMs).toBe(Date.parse('2026-10-03T20:00:00Z'));
  });
});

describe('mergeLegRows', () => {
  const base = (status, extra = {}) => ({
    status: { text: status, generic: { type: '', status: { text: status, diverted: false } } },
    time: { scheduled: { departure: 100, arrival: 200 }, estimated: { departure: 100, arrival: 200 }, real: { departure: null, arrival: null } },
    airport: { origin: { code: { iata: 'ORD' }, info: { gate: 'C1', terminal: '1' } }, destination: { code: { iata: 'SFO' }, info: { gate: '', terminal: '3' } } },
    aircraft: { registration: '' },
    ...extra,
  });
  it('takes the arrival side and the further-along status from the arrivals row; never mutates', () => {
    const dep = base('departed');
    dep.time.real.departure = 110;
    const arr = base('landed');
    arr.time.real = { departure: 110, arrival: 190 };
    arr.airport.destination.info = { gate: 'F7', terminal: '9' };
    arr.aircraft.registration = 'N2';
    const before = JSON.stringify(dep);
    const out = mergeLegRows(dep, arr);
    expect(JSON.stringify(dep)).toBe(before);
    expect(out.status.generic.status.text).toBe('landed');
    expect(out.time.real).toEqual({ departure: 110, arrival: 190 });
    expect(out.airport.origin.info.gate).toBe('C1');
    expect(out.airport.destination.info).toEqual({ gate: 'F7', terminal: '3' }); // departures row's non-empty values win
    expect(out.aircraft.registration).toBe('N2');
  });
  it('keeps the departures row\'s status when the arrivals row is behind it', () => {
    const dep = base('departed');
    dep.time.real.departure = 110;
    expect(mergeLegRows(dep, base('scheduled')).status.generic.status.text).toBe('departed');
  });
  it('a confirmed cancellation on the arrivals side wins only over a not-yet-departed row', () => {
    const cancelled = base('canceled', { status: { text: 'canceled', generic: { type: 'canceled', status: { text: 'canceled', diverted: false } } } });
    expect(mergeLegRows(base('scheduled'), cancelled).status.generic.status.text).toBe('canceled');
    const flown = base('departed');
    flown.time.real.departure = 110;
    expect(mergeLegRows(flown, cancelled).status.generic.status.text).toBe('departed');
  });
  it('either side missing → the other', () => {
    const r = base('scheduled');
    expect(mergeLegRows(r, null)).toBe(r);
    expect(mergeLegRows(null, r)).toBe(r);
  });
});
