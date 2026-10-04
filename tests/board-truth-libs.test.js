// Unit tests for the pure helpers behind the Oct 4 2026 board-truth fixes (v1.12.1).
import { describe, it, expect } from 'vitest';
import { blockVerdict, boardTimeEvidence, minFeasibleBlockSeconds, scheduledBlockSeconds } from '../src/lib/board-delay.js';
import { collapseSameTailDuplicates, dedupeServedBoard } from '../src/lib/board-dedupe.js';
import { iataForAirportName, isPlaceholderAirportName } from '../src/lib/airport-codes.js';
import { displayFlightIdent } from '../src/lib/schedule-row-model.js';

describe('board-delay.js', () => {
  it('judges "too short" by physics, not by the padded schedule', () => {
    expect(minFeasibleBlockSeconds('MCI', 'ORD')).toBeLessThan(64 * 60); // UA303 really flew 64 min
    expect(minFeasibleBlockSeconds('EWR', 'DEN')).toBeGreaterThan(149 * 60); // UA407's 2h29m estimate
    expect(minFeasibleBlockSeconds('SLC', 'ORD')).toBeGreaterThan(69 * 60); // UA1963's 69 min estimate
    expect(minFeasibleBlockSeconds('XXX', 'ORD')).toBe(0); // unknown airport: never "too short"
    expect(blockVerdict(64 * 60, 114 * 60, minFeasibleBlockSeconds('MCI', 'ORD'))).toBe('ok');
    expect(blockVerdict(234 * 60, 128 * 60, 0)).toBe('long'); // UA2059
    expect(blockVerdict(180 * 60, 128 * 60, 0)).toBe('ok');
  });

  it('has no scheduled block when a side is missing or derived from an actual', () => {
    expect(scheduledBlockSeconds({ time: { scheduled: { departure: 1000, arrival: 8200 } } })).toBe(7200);
    expect(scheduledBlockSeconds({ time: { scheduled: { departure: 1000, arrival: null } } })).toBe(0);
    expect(scheduledBlockSeconds({ time: { scheduled: { departure: 1000, arrival: 8200 } }, _source: { scheduleTimeDerivedFromActual: { arrival: true } } })).toBe(0);
  });

  it('a long estimate after a CONFIRMED gate departure stands (a ground hold is possible) unless the aircraft is airborne now', () => {
    const fl = {
      time: { scheduled: { departure: 0 + 1e9, arrival: 1e9 + 7200 }, real: { departure: 1e9 + 600 }, estimated: { arrival: 1e9 + 600 + 5 * 3600 } },
      airport: { origin: { code: { iata: 'EWR' } }, destination: { code: { iata: 'ORD' } } },
    };
    expect(boardTimeEvidence(fl, 'arrivals', { key: 'departed' })).toMatchObject({ basis: 'estimate' });
    const live = { ...fl, live: { seenAt: (1e9 + 3600) * 1000 } };
    expect(boardTimeEvidence(live, 'arrivals', { key: 'enroute', live: true })).toMatchObject({ basis: 'derived', actualTimeSec: 1e9 + 600 + 7200 });
  });

  it('flags an actual departure later than an airborne fix as contradicted', () => {
    const fl = {
      time: { scheduled: { departure: 1791063300 }, real: { departure: 1791067560 } },
      _source: { timeSource: { gateDistinctDep: true }, track: { airborneAt: 1791065400000 } },
    };
    expect(boardTimeEvidence(fl, 'departures', { key: 'departed' })).toMatchObject({
      contradicted: true, bound: 'upper', basis: 'sighting', actualTimeSec: 1791065400, providerTimeSec: 1791067560,
    });
  });
});

describe('board-dedupe.js', () => {
  const r = (reg, sched, real, extra = {}) => ({
    identification: { number: { default: 'UA1462' } },
    time: { scheduled: { departure: sched }, real: { departure: real }, estimated: {} },
    airport: { origin: { code: { iata: 'EWR' } }, destination: { code: { iata: 'MBJ' } } },
    aircraft: { registration: reg },
    ...extra,
  });

  it('serve time: snapshots written before the fix are deduped too, and the total drops', () => {
    const late = r('N47298', 1791031380, 1791046560, { _source: { timeSource: { gateDistinctDep: true } } });
    const copy = r('N47298', 1791048300, 1791048300);
    const other = r('N1', 1791063600, 1791064860);
    const payload = { total: 3, flights: [late, copy, other], meta: { source: 'aerodatabox' } };
    const out = dedupeServedBoard(payload, 'departures');
    expect(out.flights).toEqual([late, other]);
    expect(out.total).toBe(2);
    expect(out.meta).toMatchObject({ source: 'aerodatabox', servedDeduped: 1 });
    expect(payload.flights).toHaveLength(3); // never mutated
    const clean = { total: 1, flights: [other] };
    expect(dedupeServedBoard(clean, 'departures')).toBe(clean);
  });

  it('returns the input array when nothing collapses', () => {
    const flights = [r('N1', 1, 2), r('N2', 3, 4)];
    expect(collapseSameTailDuplicates(flights, 'departures')).toEqual({ flights, collapsed: 0 });
    expect(collapseSameTailDuplicates(undefined, 'departures')).toEqual({ flights: undefined, collapsed: 0 });
  });
});

describe('airport-codes.js', () => {
  it('maps an unambiguous airport name to its code', () => {
    expect(iataForAirportName('San Francisco')).toBe('SFO');
    expect(iataForAirportName('San Francisco International Airport')).toBe('SFO');
    expect(iataForAirportName('Denver')).toBe('DEN');
  });

  it('leaves ambiguous and unknown names alone', () => {
    for (const name of ['Washington', 'Portland', 'Panama City', 'Santiago', 'Rochester', 'Columbus', 'Peterson-Fild', '', null]) {
      expect(iataForAirportName(name)).toBe('');
    }
    expect(isPlaceholderAirportName('Unknown')).toBe(true);
    expect(isPlaceholderAirportName('Fargo')).toBe(false);
  });
});

describe('displayFlightIdent', () => {
  it('strips one provider letter suffix and nothing else', () => {
    expect(displayFlightIdent('UA526H')).toBe('UA526');
    expect(displayFlightIdent('UA409E')).toBe('UA409');
    expect(displayFlightIdent('UA1234')).toBe('UA1234');
    expect(displayFlightIdent('—')).toBe('—');
    expect(displayFlightIdent('')).toBe('');
  });
});
