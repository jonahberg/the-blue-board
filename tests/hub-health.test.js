import { describe, it, expect } from 'vitest';
import {
  HUB_ORDER,
  computeBoardOtp,
  mergeHubHealth,
  serverOtpFromMetrics,
  hubHealthSeverity,
  networkLabel,
} from '../src/lib/hub-health.js';

const SCHED = 1_800_000_000;

/** Every row counts as operated; `_status` lets a fixture opt out. */
const classify = (fl) => fl._status || { key: 'departed', inferred: false };

/** n rows, the first `late` of which push 45 minutes past schedule. */
function board(n, late = 0, over = {}) {
  return Array.from({ length: n }, (_, i) => ({
    time: {
      scheduled: { departure: SCHED, arrival: SCHED + 7200 },
      real: { departure: SCHED + (i < late ? 2700 : 600), arrival: SCHED + 7200 + (i < late ? 2700 : 600) },
    },
    ...over,
  }));
}

describe('HUB_ORDER', () => {
  it('is the fixed left-to-right order of the hub-health bar', () => {
    expect(HUB_ORDER).toEqual(['ORD', 'DEN', 'IAH', 'EWR', 'SFO', 'IAD', 'LAX', 'NRT', 'GUM']);
  });

  it('has no "no preference" slot, unlike the home-hub cycle (edge case)', () => {
    expect(HUB_ORDER).not.toContain('');
    expect(HUB_ORDER).toHaveLength(9);
  });
});

describe('computeBoardOtp', () => {
  it('scores a hub once it has at least 25 operated flights', () => {
    expect(computeBoardOtp({ 'ORD-departures-0': board(30, 6) }, { classify })).toEqual({ ORD: 80 });
  });

  it('writes nothing for a thin sample below 25 operated flights', () => {
    expect(computeBoardOtp({ 'DEN-departures-0': board(24) }, { classify })).toEqual({});
  });

  it('aggregates every loaded board for a hub instead of letting the last key win', () => {
    // 20 perfect departures + 20 half-late arrivals = 40 operated, 30 on time.
    const out = computeBoardOtp({
      'IAH-departures-0': board(20, 0),
      'IAH-arrivals-0': board(20, 10),
    }, { classify });
    expect(out).toEqual({ IAH: 75 });
  });

  it('scores an arrivals board on arrival times, not departure times', () => {
    const rows = board(30, 30);
    // Late on departure but on time on arrival (made the time up en route).
    rows.forEach((r) => { r.time.real.arrival = r.time.scheduled.arrival + 300; });
    expect(computeBoardOtp({ 'EWR-arrivals-0': rows }, { classify })).toEqual({ EWR: 100 });
    expect(computeBoardOtp({ 'EWR-departures-0': rows }, { classify })).toEqual({ EWR: 0 });
  });

  it('counts a departure on time up to 30 minutes past schedule', () => {
    const rows = board(30);
    rows.forEach((r, i) => { r.time.real.departure = r.time.scheduled.departure + (i < 15 ? 1800 : 1801); });
    expect(computeBoardOtp({ 'SFO-departures-0': rows }, { classify })).toEqual({ SFO: 50 });
  });

  it('excludes rows the classifier only inferred as operated', () => {
    const rows = board(30);
    rows.forEach((r, i) => { if (i < 10) r._status = { key: 'departed', inferred: true }; });
    // 20 operated → below the 25 floor → no reading at all.
    expect(computeBoardOtp({ 'LAX-departures-0': rows }, { classify })).toEqual({});
  });

  it('excludes live-feed rescue rows and schedule times derived from the actual time', () => {
    expect(computeBoardOtp({
      'ORD-departures-0': board(30, 0, { _source: { liveFeedFallback: true } }),
    }, { classify })).toEqual({});

    expect(computeBoardOtp({
      'ORD-departures-0': board(30, 0, { _source: { scheduleTimeDerivedFromActual: { departure: true } } }),
    }, { classify })).toEqual({});

    expect(computeBoardOtp({
      'ORD-arrivals-0': board(30, 0, { _source: { scheduleTimeDerivedFromActual: { arrival: true } } }),
    }, { classify })).toEqual({});
  });

  it('skips rows that never operated and rows missing either timestamp', () => {
    const rows = board(36);
    rows.forEach((r, i) => {
      if (i < 3) r._status = { key: 'scheduled', inferred: false };
      if (i >= 3 && i < 6) r.time.real.departure = null;
    });
    // 36 rows − 3 never-departed − 3 with no out-time = 30 operated, all on time.
    expect(computeBoardOtp({ 'IAD-departures-0': rows }, { classify })).toEqual({ IAD: 100 });
  });

  it('ignores keys for airports that are not United hubs (edge case)', () => {
    expect(computeBoardOtp({ 'ATL-departures-0': board(40) }, { classify })).toEqual({});
  });

  it('returns an empty map for empty or missing boards (edge case)', () => {
    expect(computeBoardOtp({}, { classify })).toEqual({});
    expect(computeBoardOtp({ 'ORD-departures-0': [] }, { classify })).toEqual({});
    expect(computeBoardOtp({ 'ORD-departures-0': null }, { classify })).toEqual({});
  });
});

describe('mergeHubHealth', () => {
  it('passes client readings through for hubs the server has not spoken for', () => {
    expect(mergeHubHealth({ ORD: 82, DEN: 64 }, new Set())).toEqual({ ORD: 82, DEN: 64 });
  });

  it('drops client readings for hubs the server already owns', () => {
    expect(mergeHubHealth({ ORD: 82, DEN: 64 }, new Set(['DEN']))).toEqual({ ORD: 82 });
  });

  it('yields nothing when the server owns every hub', () => {
    expect(mergeHubHealth({ ORD: 82, DEN: 64 }, new Set(['ORD', 'DEN']))).toEqual({});
  });

  it('handles empty input and a missing server set (edge case)', () => {
    expect(mergeHubHealth({}, new Set(['ORD']))).toEqual({});
    expect(mergeHubHealth({ ORD: 82 }, undefined)).toEqual({ ORD: 82 });
  });
});

describe('serverOtpFromMetrics', () => {
  it('reports on-time percentage once at least 5 flights operated', () => {
    expect(serverOtpFromMetrics({ total: 100, operated: 80, onTime: 60 })).toBe(75);
    expect(serverOtpFromMetrics({ total: 10, operated: 5, onTime: 5 })).toBe(100);
  });

  it('reports 0 for a hub that is mostly cancelled', () => {
    expect(serverOtpFromMetrics({ total: 20, operated: 2, onTime: 2, cancellations: 15 })).toBe(0);
  });

  it('only applies the cancellation floor above a 10-flight sample (edge case)', () => {
    // total is not > 10, so cancelRate stays 0 and the hub is left alone.
    expect(serverOtpFromMetrics({ total: 10, operated: 2, onTime: 2, cancellations: 9 })).toBeNull();
  });

  it('leaves a hub alone when too few flights operated and few were cancelled', () => {
    expect(serverOtpFromMetrics({ total: 40, operated: 4, onTime: 4, cancellations: 1 })).toBeNull();
  });

  it('returns null for missing or zero-total metrics (edge case)', () => {
    expect(serverOtpFromMetrics(null)).toBeNull();
    expect(serverOtpFromMetrics({})).toBeNull();
    expect(serverOtpFromMetrics({ total: 0, operated: 10, onTime: 10 })).toBeNull();
  });
});

describe('hubHealthSeverity', () => {
  it('is green above 70, amber from 50 to 70, red below 50', () => {
    expect(hubHealthSeverity(85)).toBe('green');
    expect(hubHealthSeverity(60)).toBe('amber');
    expect(hubHealthSeverity(30)).toBe('red');
  });

  it('puts the boundaries at >70 and >=50 (edge case)', () => {
    expect(hubHealthSeverity(71)).toBe('green');
    expect(hubHealthSeverity(70)).toBe('amber');
    expect(hubHealthSeverity(50)).toBe('amber');
    expect(hubHealthSeverity(49)).toBe('red');
  });

  it('returns null when there is no reading yet (edge case)', () => {
    expect(hubHealthSeverity(undefined)).toBeNull();
  });

  it('treats a mostly-cancelled 0 as red, not as "no reading"', () => {
    expect(hubHealthSeverity(0)).toBe('red');
  });
});

describe('networkLabel', () => {
  it('averages the readings and names the day', () => {
    expect(networkLabel([90, 80, 85])).toEqual({ avg: 85, label: 'Smooth Ops', color: '#22c55e' });
    expect(networkLabel([60, 55, 65])).toEqual({ avg: 60, label: 'Some Delays', color: '#f59e0b' });
    expect(networkLabel([30, 40, 20])).toEqual({ avg: 30, label: 'Rough Day', color: '#ef4444' });
  });

  it('rounds the average before banding it', () => {
    expect(networkLabel([71, 70]).avg).toBe(71); // 70.5 → 71
    expect(networkLabel([71, 70]).label).toBe('Smooth Ops');
  });

  it('uses the same >70 / >=50 boundaries as the per-hub chip (edge case)', () => {
    expect(networkLabel([70]).label).toBe('Some Delays');
    expect(networkLabel([50]).label).toBe('Some Delays');
    expect(networkLabel([49]).label).toBe('Rough Day');
  });

  it('returns null when no hub has a reading (edge case)', () => {
    expect(networkLabel([])).toBeNull();
    expect(networkLabel(null)).toBeNull();
  });
});
