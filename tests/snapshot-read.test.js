import { describe, it, expect } from 'vitest';

import {
  boardBatchFailureLine,
  boardListsFlightFilter,
  boardsFromRows,
  flightRowsOnBoard,
} from '../src/lib/snapshot-read.js';

const row = (num, origin = 'ORD') => ({ identification: { number: { default: num } }, airport: { origin: { code: { iata: origin } } } });

describe('boardListsFlightFilter', () => {
  it('is the jsonb containment value for one flight number, upper-cased like the stored rows', () => {
    expect(boardListsFlightFilter('ua123')).toEqual({ flights: [{ identification: { number: { default: 'UA123' } } }] });
  });
});

describe('flightRowsOnBoard', () => {
  it("keeps only the flight's own rows", () => {
    const payload = { flights: [row('UA1'), row('UA12'), row('UA1', 'SFO'), row('ua1')] };
    expect(flightRowsOnBoard(payload, 'UA1')).toHaveLength(3);
    expect(flightRowsOnBoard(payload, 'UA12')).toHaveLength(1);
  });

  it('copes with a payload that is not a board', () => {
    expect(flightRowsOnBoard(null, 'UA1')).toEqual([]);
    expect(flightRowsOnBoard({ flights: 'nope' }, 'UA1')).toEqual([]);
  });
});

describe('boardsFromRows', () => {
  it('maps cache_key to the flight rows and the refresh time, leaving out boards without the flight', () => {
    const boards = boardsFromRows([
      { cache_key: 'agg:ORD:departures:1', payload: { flights: [row('UA1'), row('UA2')] }, refreshed_at: '2026-11-18T12:00:00Z' },
      { cache_key: 'agg:SFO:arrivals:1', payload: { flights: [row('UA2')] }, refreshed_at: '2026-11-18T12:00:00Z' },
      { cache_key: 'agg:DEN:arrivals:1', payload: null },
    ], 'UA1');
    expect([...boards.keys()]).toEqual(['agg:ORD:departures:1']);
    expect(boards.get('agg:ORD:departures:1').data.flights).toHaveLength(1);
    expect(boards.get('agg:ORD:departures:1').refreshedAt).toBe(Date.parse('2026-11-18T12:00:00Z'));
  });

  it('falls back to now for a refreshed_at that does not parse', () => {
    const boards = boardsFromRows([{ cache_key: 'k', payload: { flights: [row('UA1')] }, refreshed_at: 'later' }], 'UA1', 42);
    expect(boards.get('k').refreshedAt).toBe(42);
  });

  it('treats a missing or odd result as no boards', () => {
    expect(boardsFromRows(null, 'UA1').size).toBe(0);
    expect(boardsFromRows([{ payload: { flights: [row('UA1')] } }], 'UA1').size).toBe(0);
  });
});

describe('boardBatchFailureLine', () => {
  it('is one line naming the flight, the batch size and the first board', () => {
    const line = boardBatchFailureLine(['agg:ORD:departures:1', 'agg:SFO:arrivals:1', 'agg:DEN:arrivals:1'], 'UA1', 'timed out after 3000ms');
    expect(line).toBe('Schedule snapshot read failed for UA1 across 3 board(s) (agg:ORD:departures:1 and 2 more): timed out after 3000ms');
  });

  it('reads sensibly for a single board', () => {
    expect(boardBatchFailureLine(['k'], 'UA1', 'boom')).toBe('Schedule snapshot read failed for UA1 across 1 board(s) (k): boom');
  });
});
