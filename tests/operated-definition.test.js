// D9 (live audit Sep 28 2026, v1.9.1): the ORD schedule header read "92% on-time (170 operated)"
// while the hub strip / /api/irops said 134 of 146 for the same board. Two definitions of
// "operated": the stat strip accepted an ESTIMATED out-time on a departed row and dropped
// diversions, /api/irops required a REAL out-time and kept them. There is now one predicate,
// `operatedOutcome()` in src/lib/hub-health.js, and both count with it.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import { computeScheduleStatCounts } from '../src/lib/board-stats.js';
import { operatedOutcome } from '../src/lib/hub-health.js';
import { computeMetrics } from '../api/irops.js';

const ROWS = JSON.parse(readFileSync(new URL('./fixtures/schedule-board-rows.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-09-28T20:00:00Z') / 1000;
const T = (hhmm) => Date.parse(`2026-09-28T${hhmm}:00Z`) / 1000;

function row(n, { text, sched, real = null, est = null, extra = {} }) {
  const r = structuredClone(ROWS.UA2106_ORD_departures);
  r.identification = { number: { default: `UA${n}` }, callsign: `UAL${n}` };
  r.time = {
    scheduled: { departure: T(sched), arrival: T(sched) + 3 * 3600 },
    real: { departure: real ? T(real) : null, arrival: null },
    estimated: { departure: est ? T(est) : null, arrival: null },
  };
  r.status = { icon: '', live: false, text, generic: { type: '', status: { text, diverted: text === 'diverted' } } };
  return Object.assign(r, extra);
}

// An ORD departures board: every row shape that separated 170 from 146.
const BOARD = [
  row(1, { text: 'departed', sched: '14:00', real: '14:05' }), // operated, on time
  row(2, { text: 'departed', sched: '14:10', real: '15:05' }), // operated, late
  row(3, { text: 'landed', sched: '12:00', real: '12:02' }), // operated, on time
  row(4, { text: 'departed', sched: '15:00', est: '15:10' }), // estimate only — NOT operated
  row(5, { text: 'en-route', sched: '15:30', est: '15:40' }), // estimate only — NOT operated
  row(6, { text: 'diverted', sched: '13:00', real: '13:10' }), // diverted after a real out — operated
  row(7, { text: 'departed', sched: '13:30', real: '13:35', extra: { _source: { liveFeedFallback: true } } }), // synthetic
  row(8, { text: 'scheduled', sched: '22:00' }), // upcoming
  row(9, { text: 'canceled', sched: '16:00' }), // canceled
];

describe('one "operated" definition (D9)', () => {
  it('the schedule stat strip and /api/irops count the same operated flights', () => {
    const strip = computeScheduleStatCounts(BOARD, { dir: 'departures', nowSec: NOW });
    const irops = computeMetrics({ ORD: BOARD }, NOW).hubMetrics.ORD;
    expect(strip.operated).toBe(irops.operated);
    expect(strip.onTime).toBe(irops.onTime);
    expect(strip.operated).toBe(4);
  });

  it('operatedOutcome: a real out-time is required; an estimate is not evidence', () => {
    expect(operatedOutcome(BOARD[0], 'departures')).toBe('onTime');
    expect(operatedOutcome(BOARD[1], 'departures')).toBe('late');
    expect(operatedOutcome(BOARD[3], 'departures')).toBeNull();
    expect(operatedOutcome(BOARD[5], 'departures')).toBe('onTime');
    expect(operatedOutcome(BOARD[6], 'departures')).toBeNull();
    expect(operatedOutcome(BOARD[7], 'departures')).toBeNull();
  });

  it('the strip still reconciles: every row lands in exactly one bucket', () => {
    const s = computeScheduleStatCounts(BOARD, { dir: 'departures', nowSec: NOW });
    expect(s.onTime + s.late + s.upcoming + s.canceled + s.presumed + s.uncategorized).toBe(s.total);
  });
});
