import { describe, it, expect } from 'vitest';
import {
  HUB_ORDER,
  computeBoardOtp,
  mergeHubHealth,
  serverOtpFromMetrics,
  hubHealthSeverity,
  networkLabel,
  arbitrateHubHealth,
  boardAsOfMs,
  hubOtpDescription,
  hubReadingAge,
  ON_TIME_GRACE_MIN,
  HUB_BOARD_CURRENT_MAX_SEC,
  boardCoverageGapSec,
  hubBoardCoverage,
  iropsCoverageNote,
} from '../src/lib/hub-health.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';

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
    expect(networkLabel([90, 80, 85])).toMatchObject({ avg: 85, label: 'Smooth Ops', color: '#22c55e', severity: 'green', level: 'normal' });
    expect(networkLabel([60, 55, 65])).toMatchObject({ avg: 60, label: 'Some Delays', color: '#f59e0b', severity: 'amber', level: 'minor' });
    expect(networkLabel([30, 40, 20])).toMatchObject({ avg: 30, label: 'Disrupted', color: '#ef4444', severity: 'red', level: 'significant' });
  });

  it('rounds the average before banding it', () => {
    expect(networkLabel([71, 70]).avg).toBe(71); // 70.5 → 71
    expect(networkLabel([71, 70]).label).toBe('Smooth Ops');
  });

  it('uses the same >70 / >=50 boundaries as the per-hub chip (edge case)', () => {
    expect(networkLabel([70]).label).toBe('Some Delays');
    expect(networkLabel([50]).label).toBe('Some Delays');
    expect(networkLabel([49]).label).toBe('Disrupted');
  });

  it('is never Smooth Ops while the IROPS index says disruption (audit Sep 26: 85% vs IROPS 35.3)', () => {
    // v1.12.0 bands (<20 / <40): the audit's 35.3 is now MINOR, so the chip reads Some Delays —
    // still never Smooth Ops beside a disruption badge.
    const readings = [94, 85, 74, 83, 90, 76, 91];
    expect(networkLabel(readings, { iropsScore: 45 })).toMatchObject({ avg: 85, label: 'Disrupted', severity: 'red' });
    expect(networkLabel(readings, { iropsScore: 35.3 })).toMatchObject({ label: 'Some Delays', severity: 'amber' });
    expect(networkLabel(readings, { iropsScore: 18 })).toMatchObject({ label: 'Smooth Ops', severity: 'green' });
  });

  it('is never Smooth Ops while a hub has an FAA program', () => {
    const readings = [90, 88, 92];
    const hubCodes = ['ORD', 'EWR', 'SFO'];
    expect(networkLabel(readings, { faaIndex: { EWR: { groundStop: true } }, hubCodes }).label).toBe('Disrupted');
    expect(networkLabel(readings, { faaIndex: { SFO: { delays: [{ type: 'ground_delay' }] } }, hubCodes }).label).toBe('Some Delays');
  });

  it('can only get worse from the extra signals, never better', () => {
    expect(networkLabel([30, 40], { iropsScore: 0 }).label).toBe('Disrupted');
  });

  it('returns null when no hub has a reading (edge case)', () => {
    expect(networkLabel([])).toBeNull();
    expect(networkLabel(null)).toBeNull();
  });
});

describe('hubOtpDescription', () => {
  it('states the 30-minute on-time rule the number is scored on', () => {
    expect(ON_TIME_GRACE_MIN).toBe(30);
    expect(hubOtpDescription(85)).toBe('85% of operated departures within 30 min of schedule');
    expect(hubOtpDescription(null)).toBe('No on-time reading yet');
  });
});

describe('boardAsOfMs', () => {
  it('reads /api/schedule Unix seconds, epoch ms and ISO strings', () => {
    expect(boardAsOfMs(1_790_000_000)).toBe(1_790_000_000_000);
    expect(boardAsOfMs(1_790_000_000_000)).toBe(1_790_000_000_000);
    expect(boardAsOfMs('1790000000')).toBe(1_790_000_000_000);
    expect(boardAsOfMs('2026-09-26T18:00:56Z')).toBe(Date.parse('2026-09-26T18:00:56Z'));
  });

  it('is null for anything unusable (edge case)', () => {
    expect(boardAsOfMs(null)).toBeNull();
    expect(boardAsOfMs(undefined)).toBeNull();
    expect(boardAsOfMs('')).toBeNull();
    expect(boardAsOfMs('garbage')).toBeNull();
    expect(boardAsOfMs(0)).toBeNull();
  });
});

describe('hubReadingAge', () => {
  const now = Date.parse('2026-09-27T03:57:00Z');

  it('labels the reading in UTC and flags it stale past 60 minutes (F91: IAH board 593 min old)', () => {
    expect(hubReadingAge(Date.parse('2026-09-26T18:00:56Z') / 1000, now)).toEqual({
      label: 'as of 18:00Z', stale: true, ageMin: 596,
    });
    expect(hubReadingAge('2026-09-27T03:30:00Z', now)).toEqual({ label: 'as of 03:30Z', stale: false, ageMin: 27 });
  });

  it('is null when the age is unknown', () => {
    expect(hubReadingAge(null, now)).toBeNull();
  });
});

describe('arbitrateHubHealth', () => {
  const HOURS = 3600;
  const t0 = 1_790_000_000; // Unix seconds

  it('prefers a client board built hours after the server copy (F91: IAH 93% stale vs 90% live)', () => {
    const out = arbitrateHubHealth({
      serverOtp: { IAH: 93 },
      clientOtp: { IAH: 90 },
      serverAsOf: { IAH: t0 },
      clientAsOf: { IAH: t0 + 9 * HOURS },
    });
    expect(out.IAH).toEqual({ otp: 90, source: 'client', asOfMs: (t0 + 9 * HOURS) * 1000 });
  });

  it('keeps the server reading when the client board is not meaningfully newer', () => {
    const out = arbitrateHubHealth({
      serverOtp: { DEN: 68 },
      clientOtp: { DEN: 100 },
      serverAsOf: { DEN: t0 },
      clientAsOf: { DEN: t0 + 10 * 60 },
    });
    expect(out.DEN.source).toBe('server');
    expect(out.DEN.otp).toBe(68);
  });

  it('keeps the server reading when either age is unknown (old cached payloads)', () => {
    expect(arbitrateHubHealth({ serverOtp: { ORD: 80 }, clientOtp: { ORD: 70 }, clientAsOf: { ORD: t0 } }).ORD.source).toBe('server');
    expect(arbitrateHubHealth({ serverOtp: { ORD: 80 }, clientOtp: { ORD: 70 }, serverAsOf: { ORD: t0 } }).ORD.source).toBe('server');
  });

  it('fills hubs only one side has', () => {
    const out = arbitrateHubHealth({ serverOtp: { ORD: 80 }, clientOtp: { GUM: 75 } });
    expect(out.ORD.source).toBe('server');
    expect(out.GUM).toEqual({ otp: 75, source: 'client', asOfMs: null });
  });
});

// ── Board coverage (Nov 11 2026) ──
describe('boardCoverageGapSec', () => {
  const now = 1_794_430_800; // 2026-11-11 21:00Z

  it("is a today board's age", () => {
    expect(boardCoverageGapSec({ generatedAtSec: now - 3 * 3600, dayEndSec: now + 6 * 3600, nowSec: now })).toBe(3 * 3600);
    expect(boardCoverageGapSec({ generatedAtSec: now - 600, nowSec: now })).toBe(600); // no day end: the age
  });

  it('is 0 for a yesterday board built after local midnight, however old it is (final)', () => {
    const midnight = now - 5 * 3600;
    expect(boardCoverageGapSec({ generatedAtSec: midnight + 1800, dayEndSec: midnight, nowSec: now })).toBe(0);
  });

  it("is the unseen tail of yesterday for a yesterday board built before midnight (IAH, 21:00 CST)", () => {
    // IAH's Nov 10 board was built 2026-11-11 03:00Z (21:00 CST); Central midnight is 06:00Z.
    const built = Date.UTC(2026, 10, 11, 3, 0) / 1000;
    const midnight = getStartOfHubDay('IAH', 0, new Date(Date.UTC(2026, 10, 11, 10, 0)));
    expect(midnight).toBe(Date.UTC(2026, 10, 11, 6, 0) / 1000);
    const at1045Z = Date.UTC(2026, 10, 11, 10, 45) / 1000;
    expect(boardCoverageGapSec({ generatedAtSec: built, dayEndSec: midnight, nowSec: at1045Z })).toBe(3 * 3600);
  });

  it('accepts epoch ms and ISO build times, and is null when the build time is unknown', () => {
    expect(boardCoverageGapSec({ generatedAtSec: (now - 60) * 1000, nowSec: now })).toBe(60);
    expect(boardCoverageGapSec({ generatedAtSec: new Date((now - 60) * 1000).toISOString(), nowSec: now })).toBe(60);
    expect(boardCoverageGapSec({ generatedAtSec: null, nowSec: now })).toBeNull();
    expect(boardCoverageGapSec({ generatedAtSec: undefined, nowSec: now })).toBeNull();
  });

  it('never goes negative for a board stamped a moment in the future', () => {
    expect(boardCoverageGapSec({ generatedAtSec: now + 5, nowSec: now })).toBe(0);
  });
});

describe('hubBoardCoverage / iropsCoverageNote', () => {
  const now = 1_794_430_800;
  const today = (ageSec, extra = {}) => ({ total: 100, generatedAt: now - ageSec, coverageGapSec: ageSec, boardDayOffset: 0, boardDayEndSec: now + 3 * 3600, ...extra });

  it('says nothing when every board is current (3 h is current, the brief rule)', () => {
    expect(HUB_BOARD_CURRENT_MAX_SEC).toBe(3 * 3600);
    const metrics = { ORD: today(600), LAX: today(3 * 3600) };
    expect(hubBoardCoverage(metrics, now).current).toEqual(['ORD', 'LAX']);
    expect(iropsCoverageNote(metrics, now)).toBeNull();
    expect(iropsCoverageNote({}, now)).toBeNull();
  });

  it('names the stale board: "8 of 9 hub boards current · LAX board 3 h old"', () => {
    const metrics = {
      ORD: today(1700), DEN: today(1700), IAH: today(1700), EWR: today(1700), SFO: today(950),
      IAD: today(950), NRT: today(950), GUM: today(9955), LAX: today(3 * 3600 + 600),
    };
    expect(iropsCoverageNote(metrics, now)).toBe('8 of 9 hub boards current · LAX board 3 h old');
  });

  it('worst first, two named, then "and N more"; a missing board leads', () => {
    const metrics = {
      ORD: today(600), NRT: today(8 * 3600), LAX: today(4 * 3600), IAD: today(5 * 3600), GUM: { total: 0, generatedAt: null },
    };
    expect(iropsCoverageNote(metrics, now)).toBe('1 of 5 hub boards current · GUM board missing, NRT board 8 h old and 2 more');
  });

  it("words a yesterday board by the part of yesterday it missed, and counts a final one as current", () => {
    const midnight = now - 4 * 3600;
    const metrics = {
      IAH: { total: 448, generatedAt: midnight - 3 * 3600 - 1200, boardDayOffset: -1, boardDayEndSec: midnight },
      DEN: { total: 485, generatedAt: midnight + 600, boardDayOffset: -1, boardDayEndSec: midnight },
    };
    expect(hubBoardCoverage(metrics, now).current).toEqual(['DEN']);
    expect(iropsCoverageNote(metrics, now)).toBe('1 of 2 hub boards current · IAH board missing the last 3 h of yesterday');
  });

  it('recomputes at render time, and falls back to the payload figures without a clock', () => {
    const metrics = { LAX: today(2 * 3600) };
    expect(iropsCoverageNote(metrics)).toBeNull(); // payload says 2 h
    expect(iropsCoverageNote(metrics, now + 2 * 3600)).toBe('0 of 1 hub boards current · LAX board 4 h old');
    // A payload from before the disclosure fields: dataAgeSec is the gap.
    expect(iropsCoverageNote({ LAX: { total: 10, dataAgeSec: 5 * 3600 } })).toBe('0 of 1 hub boards current · LAX board 5 h old');
    expect(iropsCoverageNote({ LAX: { total: 10 } })).toBe('0 of 1 hub boards current · LAX board age unknown');
  });

  it('rounds to whole hours', () => {
    expect(iropsCoverageNote({ LAX: { total: 10, coverageGapSec: 3 * 3600 + 1 } })).toBe('0 of 1 hub boards current · LAX board 3 h old');
    expect(iropsCoverageNote({ LAX: { total: 10, coverageGapSec: 3.6 * 3600 } })).toBe('0 of 1 hub boards current · LAX board 4 h old');
  });
});
