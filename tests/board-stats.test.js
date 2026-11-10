import { describe, it, expect } from 'vitest';
import { computeScheduleStatCounts } from '../src/lib/board-stats.js';
import { classifySchedStatus } from '../src/lib/schedule-status.js';

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
  /** Every bucket, summed: the strip must reconcile with Total. */
  const sumOf = (c) => c.onTime + c.late + c.untimed + c.inAir + c.upcoming + c.canceled + c.presumed + c.uncategorized;

  it('reconciles: total = onTime + late + untimed + inAir + upcoming + canceled + presumed + uncategorized', () => {
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
      // Departed with no timestamps: was "uncategorized" until Nov 2026. The board prints it as
      // Departed, so the strip calls it Departed · not timed — still never scored.
      flight('departed', {}),
    ];
    const c = computeScheduleStatCounts(flights, { dir: 'departures', nowSec: NOW, classify });
    expect(c.total).toBe(11);
    expect(c.onTime).toBe(1);
    expect(c.late).toBe(1);
    expect(c.upcoming).toBe(4);
    expect(c.canceled).toBe(2);
    expect(c.canceledUncertain).toBe(1);
    expect(c.canceledConfirmed).toBe(1);
    expect(c.presumed).toBe(1);
    expect(c.untimed).toBe(1);
    expect(c.inAir).toBe(0);
    expect(c.uncategorized).toBe(1);
    expect(c.operated).toBe(2);
    expect(sumOf(c)).toBe(c.total);
  });

  it('groups canceled_uncertain under canceled and still reports it separately', () => {
    const c = computeScheduleStatCounts([flight('canceled_uncertain')], { nowSec: NOW, classify });
    expect(c.canceled).toBe(1);
    expect(c.canceledUncertain).toBe(1);
    // A headline labelled "canceled" shows the confirmed part (Nov 2026): none here.
    expect(c.canceledConfirmed).toBe(0);
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

  it('does not score an operated row that has only an estimated time (D9: one operated definition)', () => {
    // Live audit Sep 28 2026: this estimate fallback made the ORD header read "170 operated"
    // beside /api/irops' 146. An estimate is a forecast, not evidence the flight operated on
    // time or late — the row is never scored, as /api/irops leaves it out. Until Nov 2026 it
    // was reconciled as "uncategorized"; it is a row the board prints as Departed / Landed
    // with no actual time, so it now reconciles as `untimed`. The D9 property is unchanged.
    const c = computeScheduleStatCounts(
      [flight('departed', { sched: NOW - 7200, est: NOW - 7200 + 3600 })],
      { dir: 'departures', nowSec: NOW, classify }
    );
    expect(c.operated).toBe(0);
    expect(c.late).toBe(0);
    expect(c.otp).toBeNull();
    expect(c.untimed).toBe(1);
    expect(c.uncategorized).toBe(0);

    const arr = computeScheduleStatCounts(
      [arrFlight('landed', { sched: NOW - 3600, est: NOW - 3600 + 5400, realDep: NOW - 9000 })],
      { dir: 'arrivals', nowSec: NOW, classify }
    );
    expect(arr.operated).toBe(0);
    expect(arr.late).toBe(0);
    expect(arr.untimed).toBe(1);
    expect(arr.uncategorized).toBe(0);
  });

  it('scores a diverted row with a real out-time, as /api/irops does (D9)', () => {
    const c = computeScheduleStatCounts(
      [flight('diverted', { sched: NOW - 7200, real: NOW - 7100 })],
      { dir: 'departures', nowSec: NOW, classify }
    );
    expect(c.operated).toBe(1);
    expect(c.onTime).toBe(1);
  });

  it('keeps implausible deltas out of Late and reconciles them as uncategorized (F4)', () => {
    // UA2113 "Arrived +54h20m" and UA1946 "+41h17m" were counted Late on the Sep 26 ORD board;
    // a stale 10h estimate on a landed row is no better.
    const flights = [
      arrFlight('landed', { sched: NOW - 2 * 86400, real: NOW }),       // +48h real
      arrFlight('landed', { sched: NOW - 10 * 3600, est: NOW + 60 }),  // stale estimate
      arrFlight('landed', { sched: NOW - 5 * 3600, real: NOW }),        // genuine +5h
      arrFlight('landed', { sched: NOW - 3600, real: NOW - 3500 }),     // on time
    ];
    const c = computeScheduleStatCounts(flights, { dir: 'arrivals', nowSec: NOW, classify });
    expect(c.late).toBe(1);
    expect(c.onTime).toBe(1);
    // The +48h real time is refused by the shared definition: uncategorized. The stale-estimate
    // row has no real arrival at all, so since Nov 2026 it reads Landed · not timed (`untimed`)
    // rather than uncategorized — neither is ever Late.
    expect(c.uncategorized).toBe(1);
    expect(c.untimed).toBe(1);
    expect(c.total).toBe(sumOf(c));
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
      // …and it is in the air, not "uncategorized" (Nov 2026).
      expect(c.inAir).toBe(1);
      expect(c.uncategorized).toBe(0);
    });
  });
});

// The stub-classifier tests above are why the gap below was never caught: they hand the counter
// a status object, and no stub ever looked like what the live-feed overlay produces. These run
// realistic rows through the REAL classifier (schedule-status.js), shaped after the ORD boards of
// Nov 10 2026 at 16:54 CST, when the strip read 14 Canceled (all Likely Canceled) and 88
// Uncategorized — every one of the 88 a row the board printed as "Departed".
describe('computeScheduleStatCounts through the real classifier (ORD, Nov 10 2026)', () => {
  const T = 1_794_354_880; // 16:54:40 CST

  const base = (over = {}) => ({
    identification: { number: { default: 'UA1' } },
    airport: { origin: { code: { iata: 'ORD' } }, destination: { code: { iata: 'EWR' } } },
    aircraft: { model: { code: 'B739' } },
    _source: { provider: 'aerodatabox' },
    ...over,
  });
  const scheduled = { icon: '', live: false, text: 'expected', generic: { type: '', status: { text: 'scheduled', diverted: false } } };
  const departed = { icon: 'green', live: true, text: 'departed', generic: { type: '', status: { text: 'departed', diverted: false } } };
  const enRoute = { icon: 'green', live: true, text: 'en route', generic: { type: '', status: { text: 'en-route', diverted: false } } };
  const likely = { icon: 'yellow', live: false, text: 'canceleduncertain', generic: { type: 'canceled_uncertain', status: { text: 'canceled_uncertain', diverted: false } } };

  const ROWS = {
    // UA3566-shaped: provider still says "Expected", no times, but the feed tracked it airborne.
    tracked: base({
      status: scheduled,
      time: { real: { departure: null, arrival: null }, estimated: { departure: T - 5800, arrival: T - 600 }, scheduled: { departure: T - 5800, arrival: T - 100 } },
      _source: { provider: 'aerodatabox', track: { airborneAt: (T - 2400) * 1000 } },
    }),
    // Airborne right now in this browser's feed (a fresh LIVE stamp), provider still "Expected".
    liveNow: base({
      status: scheduled,
      time: { real: { departure: null, arrival: null }, estimated: { departure: T - 900, arrival: T + 4000 }, scheduled: { departure: T - 900, arrival: T + 4000 } },
      live: { seenAt: (T - 60) * 1000 },
    }),
    // UA606-shaped: the provider itself says departed, with no departure time.
    providerDeparted: base({
      status: departed,
      time: { real: { departure: null, arrival: null }, estimated: { departure: null, arrival: T + 1200 }, scheduled: { departure: T - 2000, arrival: T + 1500 } },
    }),
    onTime: base({
      status: departed,
      time: { real: { departure: T - 7000, arrival: null }, estimated: {}, scheduled: { departure: T - 7200, arrival: T - 100 } },
    }),
    likelyCanceled: base({
      status: likely,
      time: { real: { departure: null, arrival: null }, estimated: { departure: null, arrival: null }, scheduled: { departure: T - 3000, arrival: T + 3000 } },
    }),
  };

  it('counts tracked, live-now and provider-departed rows without a time as untimed, never uncategorized', () => {
    const rows = [ROWS.tracked, ROWS.liveNow, ROWS.providerDeparted, ROWS.onTime, ROWS.likelyCanceled];
    for (const row of [ROWS.tracked, ROWS.liveNow, ROWS.providerDeparted]) {
      // What the board prints for the row — the card must agree with it.
      expect(classifySchedStatus(row, 'departures', T).text).toBe('Departed');
    }
    const c = computeScheduleStatCounts(rows, { dir: 'departures', nowSec: T });
    expect(c.untimed).toBe(3);
    expect(c.uncategorized).toBe(0);
    expect(c.onTime).toBe(1);
    expect(c.operated).toBe(1);
    expect(c.otp).toBe(100);
    expect(c.canceled).toBe(1);
    expect(c.canceledUncertain).toBe(1);
    expect(c.canceledConfirmed).toBe(0);
    expect(c.onTime + c.late + c.untimed + c.inAir + c.upcoming + c.canceled + c.presumed + c.uncategorized).toBe(c.total);
  });

  it('counts an arrival in the air (provider en route, or the feed has it airborne) as inAir', () => {
    // UA2827-shaped (SFO→ORD): en route with a real departure and no arrival yet.
    const providerEnRoute = base({
      airport: { origin: { code: { iata: 'SFO' } }, destination: { code: { iata: 'ORD' } } },
      status: enRoute,
      time: { real: { departure: T - 21000, arrival: null }, estimated: { arrival: T - 600 }, scheduled: { departure: T - 21000, arrival: T + 600 } },
    });
    const feedAirborne = base({
      airport: { origin: { code: { iata: 'DEN' } }, destination: { code: { iata: 'ORD' } } },
      status: scheduled,
      time: { real: { departure: null, arrival: null }, estimated: { arrival: T + 1800 }, scheduled: { departure: T - 5400, arrival: T + 1800 } },
      live: { seenAt: (T - 30) * 1000 },
    });
    const c = computeScheduleStatCounts([providerEnRoute, feedAirborne], { dir: 'arrivals', nowSec: T });
    expect(classifySchedStatus(providerEnRoute, 'arrivals', T).text).toBe('En Route');
    expect(classifySchedStatus(feedAirborne, 'arrivals', T).text).toBe('En Route');
    expect(c.inAir).toBe(2);
    expect(c.uncategorized).toBe(0);
    expect(c.upcoming).toBe(0);
    expect(c.operated).toBe(0);
  });
});
