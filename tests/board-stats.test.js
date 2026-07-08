import { describe, it, expect } from 'vitest';
import { computeScheduleStatCounts } from '../src/lib/board-stats.js';

const NOW = 1_800_000_000;

// Build a flight whose stubbed classification is carried on __status.
function flight(statusKey, { sched, real, est, source, presumed, inferred } = {}) {
  return {
    __status: { key: statusKey, presumed, inferred },
    time: {
      scheduled: { departure: sched ?? null },
      real: { departure: real ?? null },
      estimated: { departure: est ?? null },
    },
    _source: source || undefined,
  };
}

// Arrivals-board variant: mirrors flight() but populates the arrival leg of each
// timestamp instead of departure (F021 regression coverage — arrivals OTP must be
// scored against real/estimated ARRIVAL, not real departure).
function arrFlight(statusKey, { sched, real, est, realDep, source, presumed, inferred } = {}) {
  return {
    __status: { key: statusKey, presumed, inferred },
    time: {
      scheduled: { arrival: sched ?? null },
      real: { arrival: real ?? null, departure: realDep ?? null },
      estimated: { arrival: est ?? null },
    },
    _source: source || undefined,
  };
}

const classify = (fl) => fl.__status;

describe('computeScheduleStatCounts', () => {
  it('reconciles: total = onTime + late + upcoming + canceled + presumed + uncategorized', () => {
    const flights = [
      flight('departed', { sched: NOW - 7200, real: NOW - 7100 }),                    // on time
      flight('departed', { sched: NOW - 7200, real: NOW - 3600 }),                    // late (+60m)
      flight('scheduled'),                                                            // upcoming
      flight('estimated'),                                                            // upcoming
      flight('delayed'),                                                              // upcoming (hidden third fix)
      flight('unknown'),                                                              // upcoming (renders as Scheduled)
      flight('canceled'),                                                             // canceled
      flight('canceled_uncertain'),                                                   // canceled (Likely Canceled)
      flight('departed', { sched: NOW - 7200, presumed: true }),                      // presumed
      flight('diverted'),                                                             // uncategorized
      flight('departed', {}),                                                         // operated, no timestamps → uncategorized
    ];
    const c = computeScheduleStatCounts(flights, { dir: 'departures', nowSec: NOW, classify });
    expect(c.total).toBe(11);
    expect(c.onTime).toBe(1);
    expect(c.late).toBe(1);
    expect(c.upcoming).toBe(4);
    expect(c.canceled).toBe(2);
    expect(c.canceledUncertain).toBe(1);
    expect(c.presumed).toBe(1);
    expect(c.uncategorized).toBe(2);
    expect(c.onTime + c.late + c.upcoming + c.canceled + c.presumed + c.uncategorized).toBe(c.total);
  });

  it('groups canceled_uncertain under canceled and still reports it separately', () => {
    const c = computeScheduleStatCounts([flight('canceled_uncertain')], { nowSec: NOW, classify });
    expect(c.canceled).toBe(1);
    expect(c.canceledUncertain).toBe(1);
  });

  it('counts legacy inferred rows as presumed (old cached payloads without presumed:true)', () => {
    const c = computeScheduleStatCounts([flight('departed', { sched: NOW - 9000, inferred: true })], { nowSec: NOW, classify });
    expect(c.presumed).toBe(1);
    expect(c.operated).toBe(0); // never scored into OTP
  });

  it('applies the 30-minute OTP rule and excludes synthetic baselines', () => {
    const flights = [
      flight('departed', { sched: NOW - 7200, real: NOW - 7200 + 1800 }),            // exactly +30m → on time
      flight('departed', { sched: NOW - 7200, real: NOW - 7200 + 1801 }),            // +30m1s → late
      flight('departed', { sched: NOW - 7200, real: NOW - 7100, source: { liveFeedFallback: true } }),
      flight('departed', { sched: NOW - 7200, real: NOW - 7100, source: { scheduleTimeDerivedFromActual: { departure: true } } }),
    ];
    const c = computeScheduleStatCounts(flights, { dir: 'departures', nowSec: NOW, classify });
    expect(c.onTime).toBe(1);
    expect(c.late).toBe(1);
    expect(c.operated).toBe(2);
    expect(c.otp).toBe(50);
    expect(c.uncategorized).toBe(2); // the two excluded synthetic rows are not hidden
  });

  it('returns otp null (not 0 or 100) when nothing has operated', () => {
    const c = computeScheduleStatCounts([flight('scheduled')], { nowSec: NOW, classify });
    expect(c.otp).toBeNull();
  });

  it('handles empty/garbage input', () => {
    const c = computeScheduleStatCounts(null, { nowSec: NOW, classify });
    expect(c.total).toBe(0);
    expect(c.uncategorized).toBe(0);
  });

  // F021 — arrivals-board OTP must compare scheduled ARRIVAL against real/estimated
  // ARRIVAL, not real departure. Before the fix, a 90-min-late arrival with a real
  // departure timestamp scored as on-time (or even inflated otp to 100).
  describe('arrivals direction (F021)', () => {
    it('scores a late arrival as late even though its real departure was on time', () => {
      const arrClassify = (fl) => fl.__status;
      const flights = [
        arrFlight('landed', { sched: NOW - 3600, real: NOW - 3600 + 5400, realDep: NOW - 9000 }), // +90m late arrival
      ];
      const c = computeScheduleStatCounts(flights, { dir: 'arrivals', nowSec: NOW, classify: arrClassify });
      expect(c.late).toBe(1);
      expect(c.onTime).toBe(0);
      expect(c.otp).toBe(0);
    });

    it('scores an on-time arrival as on time', () => {
      const arrClassify = (fl) => fl.__status;
      const flights = [
        arrFlight('landed', { sched: NOW - 3600, real: NOW - 3500, realDep: NOW - 9000 }), // +100s → on time
      ];
      const c = computeScheduleStatCounts(flights, { dir: 'arrivals', nowSec: NOW, classify: arrClassify });
      expect(c.onTime).toBe(1);
      expect(c.late).toBe(0);
      expect(c.otp).toBe(100);
    });

    it('does not count an en-route flight (real departure, no real/estimated arrival) as operated', () => {
      const arrClassify = (fl) => fl.__status;
      const flights = [
        arrFlight('enroute', { sched: NOW - 3600, realDep: NOW - 5400 }), // departed, still airborne
      ];
      const c = computeScheduleStatCounts(flights, { dir: 'arrivals', nowSec: NOW, classify: arrClassify });
      expect(c.operated).toBe(0);
      expect(c.onTime).toBe(0);
      expect(c.late).toBe(0);
      expect(c.otp).toBeNull();
    });
  });
});
