import { describe, it, expect } from 'vitest';
import {
  collectTodayDepartureRows,
  countIropsFromRows,
  countIropsFromBoards,
} from '../src/lib/irops-client.js';

/** A board row with scheduled/real departure epochs in seconds. */
function row(scheduled, real) {
  return { time: { scheduled: { departure: scheduled }, real: { departure: real } } };
}

const NOON = 1_757_000_000;

describe('collectTodayDepartureRows (F002 — one board per hub, one direction, one day)', () => {
  const boards = {
    'ORD-departures-0': [row(NOON), row(NOON)],
    'DEN-departures-0': [row(NOON)],
    'ORD-arrivals-0': [row(NOON), row(NOON), row(NOON)],
    'ORD-departures-1': [row(NOON)],
    'ORD-departures--1': [row(NOON)],
  };

  it('keeps only today’s departures boards', () => {
    const rows = collectTodayDepartureRows(boards);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.key))).toEqual(
      new Set(['ORD-departures-0', 'DEN-departures-0']),
    );
  });

  it('tags every row with its board direction and key', () => {
    for (const entry of collectTodayDepartureRows(boards)) {
      expect(entry.dir).toBe('departures');
      expect(entry.key).toMatch(/-departures-0$/);
    }
  });

  it('survives missing, empty and non-array boards', () => {
    expect(collectTodayDepartureRows(null)).toEqual([]);
    expect(collectTodayDepartureRows({})).toEqual([]);
    expect(collectTodayDepartureRows({ 'ORD-departures-0': null })).toEqual([]);
  });
});

describe('countIropsFromRows', () => {
  const classifyAs = (key) => () => ({ key });

  it('counts a clean board as nothing but a denominator', () => {
    const rows = collectTodayDepartureRows({ 'ORD-departures-0': [row(NOON, NOON), row(NOON, NOON)] });
    expect(countIropsFromRows(rows, { classify: classifyAs('departed') })).toEqual({
      cancellations: 0, delayed30: 0, delayed60: 0, diversions: 0, total: 2,
    });
  });

  it('groups "likely canceled" with cancellations', () => {
    const rows = collectTodayDepartureRows({ 'ORD-departures-0': [row(NOON), row(NOON)] });
    const seq = ['canceled', 'canceled_uncertain'];
    let i = 0;
    const counts = countIropsFromRows(rows, { classify: () => ({ key: seq[i++] }) });
    expect(counts.cancellations).toBe(2);
  });

  it('counts diversions separately', () => {
    const rows = collectTodayDepartureRows({ 'ORD-departures-0': [row(NOON)] });
    expect(countIropsFromRows(rows, { classify: classifyAs('diverted') }).diversions).toBe(1);
  });

  it('keeps delayed30 cumulative — a 61-minute delay is in BOTH buckets', () => {
    const rows = collectTodayDepartureRows({
      'ORD-departures-0': [
        row(NOON, NOON + 20 * 60), // 20m — neither
        row(NOON, NOON + 45 * 60), // 45m — >30 only
        row(NOON, NOON + 61 * 60), // 61m — >30 and >60
      ],
    });
    const counts = countIropsFromRows(rows, { classify: classifyAs('departed') });
    expect(counts.delayed30).toBe(2);
    expect(counts.delayed60).toBe(1);
  });

  it('uses the estimated time when there is no real one, and ignores early departures', () => {
    const estimated = { time: { scheduled: { departure: NOON }, estimated: { departure: NOON + 40 * 60 } } };
    const early = row(NOON, NOON - 600);
    const counts = countIropsFromRows(
      [{ fl: estimated, dir: 'departures', key: 'ORD-departures-0' },
       { fl: early, dir: 'departures', key: 'ORD-departures-0' }],
      { classify: classifyAs('departed') },
    );
    expect(counts.delayed30).toBe(1);
    expect(counts.total).toBe(2);
  });

  it('passes the row, its direction and its key to classify', () => {
    const seen = [];
    countIropsFromRows([{ fl: row(NOON), dir: 'departures', key: 'DEN-departures-0' }], {
      classify: (fl, dir, key) => { seen.push([dir, key]); return { key: 'departed' }; },
    });
    expect(seen).toEqual([['departures', 'DEN-departures-0']]);
  });

  it('survives a classify that returns nothing, and rows without times', () => {
    const counts = countIropsFromRows(
      [{ fl: {}, dir: 'departures', key: 'ORD-departures-0' }],
      { classify: () => undefined },
    );
    expect(counts).toEqual({ cancellations: 0, delayed30: 0, delayed60: 0, diversions: 0, total: 1 });
    expect(countIropsFromRows(null, { classify: classifyAs('departed') }).total).toBe(0);
  });
});

describe('countIropsFromBoards', () => {
  it('is collect + count, and never sees an arrivals row', () => {
    const counts = countIropsFromBoards(
      {
        'ORD-departures-0': [row(NOON, NOON + 70 * 60)],
        'ORD-arrivals-0': [row(NOON, NOON + 70 * 60)],
      },
      { classify: () => ({ key: 'departed' }) },
    );
    expect(counts.total).toBe(1);
    expect(counts.delayed60).toBe(1);
  });
});
