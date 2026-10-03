import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import handler, { __resetIropsForTests, computeMetrics, getStartOfDayForHub, HUB_TZ, overlayHubBoards } from '../api/irops.js';
import { __resetRateLimitersForTests } from '../api/_rate-limit.js';
import { IROPS_MINOR_AT, IROPS_SIGNIFICANT_AT } from '../src/lib/irops-score.js';

// Helper to build a flight object matching FR24's schedule structure
function makeFlight(hub, {
  status = 'landed',
  schedDep = 1700000000,
  schedArr = null,
  realDep = null,
  estDep = null,
  flightNum = 'UA100',
  origin = 'ORD',
  dest = 'LAX',
} = {}) {
  return {
    identification: { number: { default: flightNum } },
    airport: {
      origin: { code: { iata: origin } },
      destination: { code: { iata: dest } },
    },
    status: { generic: { status: { text: status } } },
    time: {
      scheduled: { departure: schedDep, arrival: schedArr },
      real: { departure: realDep },
      estimated: { departure: estDep },
    },
  };
}

describe('computeMetrics', () => {
  it('returns score 0 for empty input', () => {
    const result = computeMetrics({});
    expect(result.score).toBe(0);
    expect(result.totalFlights).toBe(0);
    expect(result.cancellations).toBe(0);
    expect(result.delayed30).toBe(0);
    expect(result.delayed60).toBe(0);
    expect(result.diversions).toBe(0);
    expect(result.worstDelays).toEqual([]);
    expect(result.hubMetrics).toEqual({});
  });

  it('returns score 0 for a hub with no flights', () => {
    const result = computeMetrics({ ORD: [] });
    expect(result.score).toBe(0);
    expect(result.hubMetrics.ORD.total).toBe(0);
  });

  it('returns low score for all on-time flights', () => {
    const t = 1700000000;
    const flights = [
      makeFlight('ORD', { schedDep: t, realDep: t, status: 'landed' }),
      makeFlight('ORD', { schedDep: t, realDep: t + 300, status: 'landed' }), // 5 min late — still on-time
      makeFlight('ORD', { schedDep: t, realDep: t + 600, status: 'departed' }), // 10 min late — still on-time
    ];
    const result = computeMetrics({ ORD: flights });
    expect(result.score).toBe(0);
    expect(result.hubMetrics.ORD.onTime).toBe(3);
    expect(result.hubMetrics.ORD.delayed30).toBe(0);
  });

  it('weights cancellations at 3x', () => {
    const t = 1700000000;
    const flights = [
      makeFlight('ORD', { schedDep: t, realDep: t, status: 'landed' }),
      makeFlight('ORD', { schedDep: t, status: 'canceled' }),
    ];
    const result = computeMetrics({ ORD: flights });
    // score = (1*3 / 2) * 100 = 150
    expect(result.score).toBe(150);
    expect(result.cancellations).toBe(1);
    expect(result.hubMetrics.ORD.cancellations).toBe(1);
  });

  it('also recognises "cancelled" spelling', () => {
    const t = 1700000000;
    const flights = [
      makeFlight('ORD', { schedDep: t, realDep: t, status: 'landed' }),
      makeFlight('ORD', { schedDep: t, status: 'cancelled' }),
    ];
    const result = computeMetrics({ ORD: flights });
    expect(result.cancellations).toBe(1);
  });

  it('counts canceled_uncertain (AeroDataBox soft-cancel) as a cancellation, globally and per hub', () => {
    // Likely-canceled rows group under Canceled everywhere else in the UI; the server metrics
    // must agree or they vanish from the IROPS index and Delays tab cancellation counts.
    const t = 1700000000;
    const flights = [
      makeFlight('ORD', { schedDep: t, realDep: t, status: 'landed' }),
      makeFlight('ORD', { schedDep: t, status: 'canceled' }),
      makeFlight('ORD', { schedDep: t, status: 'canceled_uncertain' }),
    ];
    const result = computeMetrics({ ORD: flights });
    expect(result.cancellations).toBe(2);
    expect(result.hubMetrics.ORD.cancellations).toBe(2);
    // score = (2 cancels * 3 / 3 flights) * 100 = 200 — soft cancels move the index too.
    expect(result.score).toBe(200);
    // v1.12.0: …and the unconfirmed one is reported on its own, so the Delays tab can say so.
    expect(result.cancellationsLikely).toBe(1);
    expect(result.hubMetrics.ORD.cancellationsLikely).toBe(1);
    expect(result.likelyCanceledSeenFlying).toBe(0);
  });

  it('v1.12.0: a Likely Canceled flight seen flying is not a cancellation (overlaid board)', () => {
    const t = 1700000000;
    const seenFlying = {
      ...makeFlight('ORD', { schedDep: t, schedArr: t + 3 * 3600, status: 'canceled_uncertain', flightNum: 'UA1094' }),
    };
    const unseen = makeFlight('ORD', { schedDep: t, schedArr: t + 3 * 3600, status: 'canceled_uncertain', flightNum: 'UA2000' });
    const flown = makeFlight('ORD', { schedDep: t, realDep: t, status: 'departed', flightNum: 'UA3000' });
    const sightings = new Map([['UA1094', { reg: 'N12345', origin: 'ORD', dest: 'LAX', seenAtMs: (t + 2 * 3600) * 1000 }]]);
    const boards = overlayHubBoards({ ORD: [seenFlying, unseen, flown] }, sightings, (t + 6 * 3600) * 1000);
    const nowSec = t + 6 * 3600;

    const before = computeMetrics({ ORD: [seenFlying, unseen, flown] }, nowSec);
    const after = computeMetrics(boards, nowSec);
    expect(before.cancellations).toBe(2);
    expect(before.score).toBe(200); // (2×3)/3
    expect(after.cancellations).toBe(1);
    expect(after.cancellationsLikely).toBe(1);
    expect(after.likelyCanceledSeenFlying).toBe(1);
    expect(after.hubMetrics.ORD).toMatchObject({ cancellations: 1, cancellationsLikely: 1, likelyCanceledSeenFlying: 1 });
    expect(after.score).toBe(100); // (1×3)/3 — the seen one stays in the denominator, scores nothing
    // It flew: no overdue "hold" either, even though it has no real departure time.
    expect(after.delayed30).toBe(0);
    expect(after.worstDelays).toEqual([]);
    // Not operated (no provider time), so it cannot move the on-time figure.
    expect(after.hubMetrics.ORD.operated).toBe(1);
    // The input boards are untouched (hubCache keeps what /api/schedule served).
    expect(seenFlying.status.generic.status.text).toBe('canceled_uncertain');
  });

  it('v1.12.0: overlayHubBoards is idempotent and needs a matching origin', () => {
    const t = 1700000000;
    const fl = makeFlight('DEN', { schedDep: t, schedArr: t + 3 * 3600, status: 'canceled_uncertain', flightNum: 'UA1094', origin: 'DEN' });
    const elsewhere = new Map([['UA1094', { reg: 'N1', origin: 'ORD', dest: 'LAX', seenAtMs: (t + 3600) * 1000 }]]);
    expect(computeMetrics(overlayHubBoards({ DEN: [fl] }, elsewhere, (t + 6 * 3600) * 1000)).cancellations).toBe(1);
    const here = new Map([['UA1094', { reg: 'N1', origin: 'DEN', dest: 'LAX', seenAtMs: (t + 3600) * 1000 }]]);
    const once = overlayHubBoards({ DEN: [fl] }, here, (t + 6 * 3600) * 1000);
    const twice = overlayHubBoards(once, here, (t + 6 * 3600) * 1000);
    expect(twice.DEN).toBe(once.DEN);
    expect(computeMetrics(twice).cancellations).toBe(0);
  });

  it('v1.12.0: a Likely Canceled row with a real departure operated — not a cancellation (matches the board)', () => {
    const t = 1700000000;
    const flights = [
      makeFlight('ORD', { schedDep: t, realDep: t + 600, status: 'canceled_uncertain' }),
      makeFlight('ORD', { schedDep: t, realDep: t, status: 'landed' }),
    ];
    const result = computeMetrics({ ORD: flights });
    expect(result.cancellations).toBe(0);
    expect(result.score).toBe(0);
  });

  it('weights 60-min delays at 2x (F017: no longer double-counted)', () => {
    const t = 1700000000;
    const flights = [
      makeFlight('ORD', { schedDep: t, realDep: t + 3700, status: 'landed' }), // 61 min late
    ];
    const result = computeMetrics({ ORD: flights });
    // Reported fields stay cumulative (delayed30 counts every delay >30m, incl. >60m)
    // so the UI's ">30m"/">60m" cards remain truthful.
    expect(result.delayed30).toBe(1);
    expect(result.delayed60).toBe(1);
    // F017: the score weights each flight once. A 61-min delay is a single 60m+ event
    // (×2), NOT 1 (>30) + 2 (>60) = 3. score = (delayed60*2 + (delayed30-delayed60)*1) / 1 * 100
    //       = (1*2 + 0*1) / 1 * 100 = 200 (previously an incorrect 300 — equal to a cancellation).
    expect(result.score).toBe(200);
  });

  it('F017: a 45-min delay contributes 1 point, a 61-min delay contributes 2', () => {
    const t = 1700000000;
    // Two flights: one 45m late (30–60 bucket), one 61m late (60+ bucket).
    const result = computeMetrics({
      ORD: [
        makeFlight('ORD', { schedDep: t, realDep: t + 2700, status: 'landed' }), // 45 min
        makeFlight('ORD', { schedDep: t, realDep: t + 3700, status: 'landed' }), // 61 min
      ],
    });
    expect(result.delayed30).toBe(2); // both are >30m (cumulative)
    expect(result.delayed60).toBe(1); // only one is >60m
    // score = (60m+ *2 + 30–60 *1) / 2 * 100 = (1*2 + 1*1) / 2 * 100 = 150
    expect(result.score).toBe(150);
  });

  it('F073: held flights during a ground stop push the score across SIGNIFICANT', () => {
    // Seeded-scenario shape: a hub under a ground stop with flights still on the ground,
    // scheduled hours ago, no real departure, status still "scheduled". The OLD code scored
    // 0 for these (they lacked a real departure timestamp) while inflating totalFlights —
    // undercounting the disruption exactly when it matters.
    const t = 1700000000;
    const now = t + 2 * 3600; // "now" is 2 hours past the scheduled departures
    const flights = [];
    // 10 held flights (scheduled 2h ago, never departed) + 20 uneventful on-time flights.
    for (let i = 0; i < 10; i++) {
      flights.push(makeFlight('EWR', { schedDep: t, realDep: null, status: 'scheduled', flightNum: `UA${200 + i}` }));
    }
    for (let i = 0; i < 20; i++) {
      flights.push(makeFlight('EWR', { schedDep: t, realDep: t, status: 'landed', flightNum: `UA${300 + i}` }));
    }
    const oldStyle = computeMetrics({ EWR: flights }, t); // "now" == schedule → nothing overdue yet
    expect(oldStyle.delayed60).toBe(0);
    expect(oldStyle.score).toBeLessThan(IROPS_MINOR_AT); // NORMAL — the bug's behaviour

    const result = computeMetrics({ EWR: flights }, now);
    // Each held flight is >60m overdue → counts in both cumulative buckets.
    expect(result.delayed30).toBe(10);
    expect(result.delayed60).toBe(10);
    // score = (delayed60*2 + (delayed30-delayed60)*1) / total * 100 = (10*2 + 0) / 30 * 100 ≈ 66.7
    expect(result.score).toBeGreaterThanOrEqual(IROPS_SIGNIFICANT_AT); // SIGNIFICANT (≥40 since v1.12.0)
    // Held flights also surface in worstDelays with their overdue magnitude.
    expect(result.worstDelays.length).toBeGreaterThan(0);
    expect(result.worstDelays[0].delay).toBeGreaterThanOrEqual(120);
  });

  // ── F073b: overdue scoring must not manufacture disruption out of stale rows ──
  // The board holds a full local day. A row whose status never advanced to a terminal
  // value looks identical to a held flight, and the original F073 rule charged it
  // (now - scheduledDeparture) minutes forever. Measured on production 2026-07-08:
  // 548 rows scored as "overdue >30m", 122 of them over 6 hours, worst 1028 minutes
  // (a 17.1-hour "hold" on a 90-minute regional hop), driving score 74.4 vs the
  // SIGNIFICANT threshold (then 15). A plane cannot still be at the gate after the clock
  // has passed the time it was scheduled to land.

  it('F073b: a row past its scheduled arrival is a stale row, not a held flight', () => {
    const t = 1700000000;
    const now = t + 15 * 3600; // 15h past scheduled departure
    const result = computeMetrics({
      ORD: [
        // Scheduled to land 13.5h ago. It flew; the board never got a terminal status.
        makeFlight('ORD', { schedDep: t, schedArr: t + 5400, realDep: null, status: 'scheduled' }),
      ],
    }, now);
    expect(result.delayed30).toBe(0);
    expect(result.delayed60).toBe(0);
    expect(result.worstDelays).toEqual([]);
  });

  it('F073b: still counts a genuine ground-stop hold short of its scheduled arrival', () => {
    const t = 1700000000;
    const now = t + 2 * 3600; // held 2h at the gate
    const result = computeMetrics({
      EWR: [
        // A 4-hour block: scheduled arrival is still 2h in the future, so it can
        // plausibly still be sitting at the gate. This is the F073 signal — keep it.
        makeFlight('EWR', { schedDep: t, schedArr: t + 4 * 3600, realDep: null, status: 'scheduled' }),
      ],
    }, now);
    expect(result.delayed30).toBe(1);
    expect(result.delayed60).toBe(1);
    expect(result.worstDelays[0].delay).toBe(120);
  });

  it('F073b: caps overdue when scheduled arrival is unknown', () => {
    const t = 1700000000;
    const result = computeMetrics({
      ORD: [
        // No arrival time to reason with (25 such rows in production). Beyond the cap we
        // cannot tell a held flight from a stale row, so we under-report rather than invent.
        makeFlight('ORD', { schedDep: t, schedArr: null, realDep: null, status: 'scheduled' }),
      ],
    }, t + 5 * 3600);
    expect(result.delayed30).toBe(0);
    expect(result.worstDelays).toEqual([]);
  });

  it('F073b: an unknown-arrival hold inside the cap still counts', () => {
    const t = 1700000000;
    const result = computeMetrics({
      ORD: [makeFlight('ORD', { schedDep: t, schedArr: null, realDep: null, status: 'scheduled' })],
    }, t + 2 * 3600);
    expect(result.delayed30).toBe(1);
    expect(result.delayed60).toBe(1);
  });

  it('F073b: worstDelays never reports an overdue hold beyond the cap', () => {
    const t = 1700000000;
    const now = t + 20 * 3600;
    const flights = [];
    for (let i = 0; i < 30; i++) {
      flights.push(makeFlight('ORD', { schedDep: t + i * 60, schedArr: null, realDep: null, status: 'scheduled', flightNum: `UA${i}` }));
    }
    const result = computeMetrics({ ORD: flights }, now);
    for (const w of result.worstDelays) expect(w.delay).toBeLessThanOrEqual(240);
    expect(result.score).toBe(0);
  });

  it('F073: does not treat departed/landed/canceled flights as overdue', () => {
    const t = 1700000000;
    const now = t + 3 * 3600;
    const result = computeMetrics({
      ORD: [
        makeFlight('ORD', { schedDep: t, realDep: null, status: 'departed', estDep: t }), // left, no timestamp
        makeFlight('ORD', { schedDep: t, realDep: null, status: 'en-route' }),            // airborne
        makeFlight('ORD', { schedDep: t, realDep: null, status: 'canceled' }),            // canceled
      ],
    }, now);
    // None of these are "held on the ground" — overdue scoring must skip them all.
    expect(result.delayed30).toBe(0);
    expect(result.delayed60).toBe(0);
    expect(result.cancellations).toBe(1);
  });

  it('counts diversions', () => {
    const t = 1700000000;
    const flights = [
      makeFlight('ORD', { schedDep: t, realDep: t, status: 'diverted' }),
    ];
    const result = computeMetrics({ ORD: flights });
    expect(result.diversions).toBe(1);
    expect(result.hubMetrics.ORD.diversions).toBe(1);
  });

  it('populates hubMetrics per hub', () => {
    const t = 1700000000;
    const result = computeMetrics({
      ORD: [
        makeFlight('ORD', { schedDep: t, realDep: t, status: 'landed' }),
        makeFlight('ORD', { schedDep: t, status: 'canceled' }),
      ],
      DEN: [
        makeFlight('DEN', { schedDep: t, realDep: t + 2500, status: 'landed' }), // 41 min late
      ],
    });
    expect(result.hubMetrics.ORD.total).toBe(2);
    expect(result.hubMetrics.ORD.cancellations).toBe(1);
    expect(result.hubMetrics.DEN.total).toBe(1);
    expect(result.hubMetrics.DEN.delayed30).toBe(1);
  });

  it('sorts worstDelays by delay descending and limits to 8', () => {
    const t = 1700000000;
    const flights = [];
    for (let i = 0; i < 12; i++) {
      // Delays of 20, 25, 30, ... 75 minutes (only > 15 qualify for worstDelays)
      const delayMin = 20 + i * 5;
      flights.push(makeFlight('ORD', {
        schedDep: t,
        realDep: t + delayMin * 60,
        status: 'landed',
        flightNum: `UA${100 + i}`,
      }));
    }
    const result = computeMetrics({ ORD: flights });
    expect(result.worstDelays.length).toBe(8);
    // First should have the largest delay
    expect(result.worstDelays[0].delay).toBe(75);
    // Last of the 8 should have the 8th largest
    expect(result.worstDelays[7].delay).toBe(40);
  });

  it('does not count flights with only estimated departure as on-time', () => {
    const t = 1700000000;
    const flights = [
      makeFlight('ORD', { schedDep: t, realDep: null, estDep: t, status: 'departed' }),
      makeFlight('ORD', { schedDep: t, realDep: null, estDep: t + 100, status: 'en-route' }),
    ];
    const result = computeMetrics({ ORD: flights });
    expect(result.hubMetrics.ORD.operated).toBe(0);
    expect(result.hubMetrics.ORD.onTime).toBe(0);
  });

  it('skips flights with missing scheduled departure', () => {
    const t = 1700000000;
    const flights = [
      makeFlight('ORD', { schedDep: null, realDep: t, status: 'landed' }),
    ];
    const result = computeMetrics({ ORD: flights });
    expect(result.hubMetrics.ORD.operated).toBe(0);
    expect(result.hubMetrics.ORD.onTime).toBe(0);
  });

  it('global metrics ignore flights with only estimated departure', () => {
    const t = 1700000000;
    const flights = [
      makeFlight('ORD', { schedDep: t, realDep: null, estDep: t + 7200, status: 'departed' }),
    ];
    const result = computeMetrics({ ORD: flights });
    expect(result.delayed30).toBe(0);
    expect(result.delayed60).toBe(0);
    expect(result.worstDelays).toEqual([]);
  });

  it('stamps each hub with its board age and reports the oldest', () => {
    const now = 1_790_000_000;
    const result = computeMetrics({ IAH: [], ORD: [], GUM: [] }, now, { IAH: now - 35_580, ORD: now - 120 });
    expect(result.hubMetrics.IAH).toMatchObject({ generatedAt: now - 35_580, dataAgeSec: 35_580 });
    expect(result.hubMetrics.ORD.dataAgeSec).toBe(120);
    expect(result.hubMetrics.GUM).toMatchObject({ generatedAt: null, dataAgeSec: null });
    expect(result.oldestHubAgeSec).toBe(35_580);
    expect(computeMetrics({ ORD: [] }).oldestHubAgeSec).toBeNull();
  });

  it('includes generatedAt ISO timestamp', () => {
    const result = computeMetrics({});
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('does not include hubFlights in response', () => {
    const t = 1700000000;
    const result = computeMetrics({
      ORD: [makeFlight('ORD', { schedDep: t, realDep: t, status: 'landed' })],
    });
    expect(result).not.toHaveProperty('hubFlights');
  });

  it('hubMetrics includes operated and onTime counts for hub health', () => {
    const t = 1700000000;
    const result = computeMetrics({
      ORD: [
        makeFlight('ORD', { schedDep: t, realDep: t, status: 'landed' }),
        makeFlight('ORD', { schedDep: t, realDep: t + 2000, status: 'landed' }), // 33min late
      ],
      DEN: [
        makeFlight('DEN', { schedDep: t, realDep: t + 300, status: 'departed' }),
      ],
    });
    expect(result.hubMetrics.ORD).toHaveProperty('operated', 2);
    expect(result.hubMetrics.ORD).toHaveProperty('onTime', 1);
    expect(result.hubMetrics.DEN).toHaveProperty('operated', 1);
    expect(result.hubMetrics.DEN).toHaveProperty('onTime', 1);
  });

  it('excludes degraded synthetic rows from hub OTP (P1: degraded-rows-inflate-hub-otp)', () => {
    // Live-feed rescue and schedule-derived-from-actual rows carry scheduled == actual, so they
    // always score on-time; counting them inflates hub OTP exactly when the FR24 feed is degraded.
    const t = 1700000000;
    const flights = [
      makeFlight('ORD', { schedDep: t, realDep: t + 600, status: 'landed' }), // genuine on-time — counts
      { ...makeFlight('ORD', { schedDep: t, realDep: t, status: 'landed' }), _source: { liveFeedFallback: true } },
      { ...makeFlight('ORD', { schedDep: t, realDep: t, status: 'landed' }), _source: { scheduleTimeDerivedFromActual: { departure: true } } },
      { ...makeFlight('ORD', { schedDep: t, realDep: t, status: 'landed' }), _source: { scheduleTimeDerivedFromActual: { arrival: true } } },
    ];
    const result = computeMetrics({ ORD: flights });
    // Only the genuine row is operated/on-time; the three degraded rows are excluded.
    expect(result.hubMetrics.ORD.operated).toBe(1);
    expect(result.hubMetrics.ORD.onTime).toBe(1);
  });

  it('drops a confirmed delay computed from a wrong-calendar-day real departure (DQ artifact)', () => {
    // A provider date-shift stamps real.departure a full day after scheduled, minting a phantom
    // ~24h "delay". It must not top the user-visible worstDelays list nor inflate the buckets.
    const t = 1700000000;
    const result = computeMetrics({
      ORD: [makeFlight('ORD', { schedDep: t, realDep: t + 86400, status: 'landed' })],
    });
    expect(result.worstDelays).toEqual([]);
    expect(result.delayed30).toBe(0);
    expect(result.delayed60).toBe(0);
    expect(result.hubMetrics.ORD.delayed30).toBe(0);
    expect(result.hubMetrics.ORD.delayed60).toBe(0);
  });

  it('still surfaces a genuine multi-hour confirmed delay (guard is not over-aggressive)', () => {
    // A real 5-hour weather hold is exactly the IROPS signal; the DQ cap must not clip it.
    const t = 1700000000;
    const result = computeMetrics({
      ORD: [makeFlight('ORD', { schedDep: t, realDep: t + 300 * 60, status: 'landed' })],
    });
    expect(result.delayed30).toBe(1);
    expect(result.delayed60).toBe(1);
    expect(result.worstDelays[0].delay).toBe(300);
    expect(result.hubMetrics.ORD.delayed60).toBe(1);
  });

  it('counts a diverted-and-late flight once (as a diversion), not twice in the score', () => {
    // F017 invariant: each flight must weight the score once. A diverted flight that also departed
    // late must NOT land in both the diversions bucket (x2) and the delayed60 bucket (x2) = 4 points,
    // which would exceed a cancellation (x3).
    const t = 1700000000;
    const result = computeMetrics({
      ORD: [makeFlight('ORD', { schedDep: t, realDep: t + 66 * 60, status: 'diverted' })], // 66 min late
    });
    expect(result.diversions).toBe(1);
    expect(result.delayed30).toBe(0);
    expect(result.delayed60).toBe(0);
    expect(result.worstDelays).toEqual([]);
    // score = diversions*2 / total * 100 = 2/1*100 = 200 (NOT 400).
    expect(result.score).toBe(200);
  });
});

// Delay-risk scenarios live in tests/delay-risk-scenarios.test.js, against the real engine.

describe('getStartOfDayForHub', () => {
  afterEach(() => { vi.useRealTimers(); });

  // Assert `tsSec` (Unix seconds) falls exactly at midnight in the given IANA tz.
  function assertHubMidnight(tsSec, tz) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(new Date(tsSec * 1000));
    const g = (t) => parts.find((p) => p.type === t)?.value;
    const hour = g('hour') === '24' ? '00' : g('hour'); // normalize the ICU midnight quirk
    expect(`${hour}:${g('minute')}:${g('second')}`).toBe('00:00:00');
  }
  // Hub-local calendar date (YYYY-MM-DD) of a timestamp.
  function hubLocalDate(tsSec, tz) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(tsSec * 1000));
    const g = (t) => parts.find((p) => p.type === t)?.value;
    return `${g('year')}-${g('month')}-${g('day')}`;
  }

  it('returns a Unix timestamp (seconds)', () => {
    const ts = getStartOfDayForHub('ORD');
    expect(typeof ts).toBe('number');
    expect(ts).toBeGreaterThan(1_000_000_000);
    expect(ts).toBeLessThan(3_000_000_000); // reasonable range
  });

  it('returns exact hub-local midnight for every hub on an ordinary afternoon', () => {
    // 15:00 UTC: every hub is well past its rollover hour and clear of its midnight boundary.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T15:00:00Z'));
    for (const hub of Object.keys(HUB_TZ)) {
      assertHubMidnight(getStartOfDayForHub(hub), HUB_TZ[hub]);
    }
  });

  it('falls back to America/New_York for unknown hubs (still hub-local midnight)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T15:00:00Z'));
    assertHubMidnight(getStartOfDayForHub('XYZ'), 'America/New_York');
  });

  it('rolls back to yesterday before the 6 AM hub-local rollover', () => {
    // 14:00 UTC = 09:00 CDT (after rollover -> today); 08:00 UTC = 03:00 CDT (before -> yesterday).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T14:00:00Z'));
    const today = getStartOfDayForHub('ORD');
    vi.setSystemTime(new Date('2026-04-24T08:00:00Z'));
    const beforeRollover = getStartOfDayForHub('ORD');
    assertHubMidnight(beforeRollover, HUB_TZ.ORD);
    expect(beforeRollover).toBe(today - 86400); // ordinary day: yesterday is exactly 24h back
  });

  it('DST fall-back: the morning after, before rollover, is hub-local midnight (not 01:00)', () => {
    // 2026-11-01 was a 25h day. At 2026-11-02 05:00 PST the naive `startOfToday - 86400`
    // lands at 01:00 the day before; the result must be exact 2026-11-01 hub-local midnight.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-02T13:00:00Z'));
    const ts = getStartOfDayForHub('SFO');
    assertHubMidnight(ts, HUB_TZ.SFO);
    expect(hubLocalDate(ts, HUB_TZ.SFO)).toBe('2026-11-01');
  });

  it('DST spring-forward: the morning after, before rollover, is hub-local midnight (not 23:00)', () => {
    // 2026-03-08 was a 23h day. At 2026-03-09 05:30 PDT the naive rollback lands at 23:00 two
    // days prior; the result must be exact 2026-03-08 hub-local midnight.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-09T12:30:00Z'));
    const ts = getStartOfDayForHub('SFO');
    assertHubMidnight(ts, HUB_TZ.SFO);
    expect(hubLocalDate(ts, HUB_TZ.SFO)).toBe('2026-03-08');
  });
});

describe('IROPS API handler', () => {
  function createRes() {
    return {
      statusCode: 200,
      headers: {},
      body: null,
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
  }
  function makeReq(overrides = {}) {
    return { method: 'GET', headers: {}, query: {}, ...overrides };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    __resetRateLimitersForTests();
    __resetIropsForTests();
  });
  afterEach(() => { vi.useRealTimers(); });

  it('carries each hub board\'s age into hubMetrics (F91)', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const flight = {
      status: { generic: { status: { text: 'departed' } } },
      time: { scheduled: { departure: nowSec - 7200 }, real: { departure: nowSec - 7000 } },
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const hub = new URL(String(url)).searchParams.get('hub');
      // IAH's board is ten hours old; every other hub's is two minutes old.
      const generatedAt = hub === 'IAH' ? nowSec - 10 * 3600 : nowSec - 120;
      return { ok: true, json: async () => ({ flights: [flight], meta: { generatedAt, dataAge: nowSec - generatedAt } }) };
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.hubMetrics.IAH.generatedAt).toBe(nowSec - 10 * 3600);
    expect(res.body.hubMetrics.IAH.dataAgeSec).toBeGreaterThanOrEqual(10 * 3600);
    expect(res.body.hubMetrics.ORD.dataAgeSec).toBeLessThan(600);
    expect(res.body.oldestHubAgeSec).toBe(res.body.hubMetrics.IAH.dataAgeSec);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('IAH board is 600m old'));
  });

  it('rejects non-GET requests with 405', async () => {
    const res = createRes();
    await handler(makeReq({ method: 'POST' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('rejects forbidden origins with 403', async () => {
    const res = createRes();
    await handler(makeReq({ headers: { origin: 'https://evil.com' } }), res);
    expect(res.statusCode).toBe(403);
  });

  it('allows theblueboard.co and sets the fresh Cache-Control', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ flights: [] }) });
    const res = createRes();
    await handler(makeReq({ headers: { origin: 'https://theblueboard.co' } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=900, stale-while-revalidate=300');
  });

  it('allows requests with no origin header', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ flights: [] }) });
    const res = createRes();
    await handler(makeReq({ headers: {} }), res);
    expect(res.statusCode).toBe(200);
  });

  it('rate-limits with 429 once the per-minute budget is exhausted', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ flights: [] }) });
    let last;
    for (let i = 0; i < 61; i++) { // limiter allows 60/min per IP
      last = createRes();
      await handler(makeReq(), last);
    }
    expect(last.statusCode).toBe(429);
  });

  it('serves stale cached data (200) when a rebuild fails, instead of 502', async () => {
    vi.useFakeTimers();
    // Far-future base so any cache primed by an earlier test at real time has expired.
    vi.setSystemTime(new Date('2027-06-01T12:00:00Z'));
    // 1) Prime the cache with a good build.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ flights: [] }) });
    const first = createRes();
    await handler(makeReq(), first);
    expect(first.statusCode).toBe(200);
    // 2) Expire the 15-min cache but stay inside the 1-hour stale grace window.
    vi.setSystemTime(new Date('2027-06-01T12:20:00Z'));
    // 3) The rebuild throws (malformed provider payload -> computeMetrics iterates a non-array).
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ flights: { length: 3 } }) });
    const res = createRes();
    await handler(makeReq(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.stale).toBe(true);
    expect(res.headers['Cache-Control']).toBe('s-maxage=60');
  });
});
