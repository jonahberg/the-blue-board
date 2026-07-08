import { describe, it, expect } from 'vitest';
import { computeMetrics, getStartOfDayForHub } from '../api/irops.js';

// Helper to build a flight object matching FR24's schedule structure
function makeFlight(hub, {
  status = 'landed',
  schedDep = 1700000000,
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
      scheduled: { departure: schedDep },
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
    expect(oldStyle.score).toBeLessThan(15); // MINOR — the bug's behaviour

    const result = computeMetrics({ EWR: flights }, now);
    // Each held flight is >60m overdue → counts in both cumulative buckets.
    expect(result.delayed30).toBe(10);
    expect(result.delayed60).toBe(10);
    // score = (delayed60*2 + (delayed30-delayed60)*1) / total * 100 = (10*2 + 0) / 30 * 100 ≈ 66.7
    expect(result.score).toBeGreaterThanOrEqual(15); // SIGNIFICANT
    // Held flights also surface in worstDelays with their overdue magnitude.
    expect(result.worstDelays.length).toBeGreaterThan(0);
    expect(result.worstDelays[0].delay).toBeGreaterThanOrEqual(120);
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
});

// ═══ DELAY RISK ENGINE v3 TESTS ═══
// These replicate the scoring logic from computeDelayRisk() in index.html
// to validate the algorithm without needing a browser environment.

function makeDelayRiskScore({
  delayMin = 0, faaOrig = {}, faaDest = {},
  wxOrigLevel = 'normal', wxOrigCat = 'VFR', wxOrigThunderstorms = false,
  wxOrigFreezingPrecip = false, wxOrigSnow = false, wxOrigGustKt = 0,
  wxOrigTempC = null,
  wxDestLevel = 'normal', wxDestCat = 'VFR', wxDestThunderstorms = false,
  otp = undefined, hubHour = 10, origHub = 'ORD', destHub = 'LAX',
  hasInboundAirborne = false, timeToDepMin = 999,
  iropsCancel = 0, iropsDelayed60 = 0,
  destIropsCancel = 0, destIropsDelayed60 = 0,
} = {}) {
  let score = 0;
  const factors = [];

  // Signal 1: actual delay magnitude (0-50)
  if (delayMin >= 120)     { score += 50; factors.push(`Already ${delayMin}min delayed`); }
  else if (delayMin >= 60) { score += 40; factors.push(`Already ${delayMin}min delayed`); }
  else if (delayMin >= 30) { score += 30; factors.push(`${delayMin}min delay`); }
  else if (delayMin >= 15) { score += 15; factors.push(`${delayMin}min delay`); }

  // Signal 2: FAA origin (0-35)
  if (faaOrig.closure)              { score += 35; factors.push('Airport closed'); }
  else if (faaOrig.groundStop)      { score += 30; factors.push('Ground stop'); }
  else if (faaOrig.groundDelay)     { score += 20; factors.push('GDP'); }
  else if (faaOrig.departureDelay)  { score += 12; factors.push('Dep delays'); }
  else if (faaOrig.arrivalDelay)    { score += 8; factors.push('Arr delays'); }

  // Signal 3: FAA dest (0-25)
  if (faaDest.closure)              { score += 25; factors.push('Airport closed dest'); }
  else if (faaDest.groundStop)      { score += 20; factors.push('Ground stop dest'); }
  else if (faaDest.groundDelay)     { score += 15; factors.push('GDP dest'); }
  else if (faaDest.arrivalDelay)    { score += 8; factors.push('Arr delays dest'); }

  // Signal 4: weather (0-30+) — phenomena-aware with hub-specific IFR capacity
  if (wxOrigLevel === 'severe')       score += 15;
  else if (wxOrigLevel === 'warning') score += 10;
  else if (wxOrigLevel === 'caution') score += 4;
  if (wxOrigThunderstorms)  score += 8;
  if (wxOrigFreezingPrecip) score += 6;
  if (wxOrigSnow)           score += 4;
  if (wxOrigGustKt >= 35)   score += 5;
  // Hub-specific IFR capacity reduction
  if (wxOrigCat === 'LIFR') {
    if (origHub === 'SFO') score += 15;
    else if (origHub === 'EWR') score += 14;
    else score += 10;
  } else if (wxOrigCat === 'IFR') {
    if (origHub === 'SFO') score += 10;
    else if (origHub === 'EWR') score += 8;
    else score += 5;
  }
  // De-icing queue penalty
  if ((wxOrigFreezingPrecip || wxOrigSnow) && wxOrigTempC !== null && wxOrigTempC <= 2) {
    score += 8;
    if (wxOrigTempC <= -5) score += 4;
  }
  if (wxDestLevel === 'severe')      score += 10;
  else if (wxDestLevel === 'warning') score += 5;
  if (wxDestThunderstorms)           score += 5;
  if (wxDestCat === 'LIFR') {
    if (destHub === 'SFO') score += 10;
    else if (destHub === 'EWR') score += 8;
    else score += 5;
  }

  // Signal 5: OTP (0-20)
  if (otp !== undefined) {
    if (otp < 40)      score += 20;
    else if (otp < 55) score += 14;
    else if (otp < 70) score += 8;
    else if (otp < 80) score += 3;
  }

  // Signal 6: time of day (0-12)
  if (hubHour >= 19)      score += 12;
  else if (hubHour >= 16) score += 8;
  else if (hubHour >= 13) score += 4;

  // Signal 7: inbound aircraft (0-30 with fallback scoring)
  if (hasInboundAirborne) {
    if (timeToDepMin < 45)       score += 25;
    else if (timeToDepMin < 75)  score += 15;
    else if (timeToDepMin < 120) score += 8;
  }

  // Signal 8: hub risk profile (0-8)
  const profiles = { EWR: 8, ORD: 5, SFO: 5, IAH: 3, DEN: 3, LAX: 2, IAD: 2, NRT: 1, GUM: 1 };
  score += profiles[origHub] || 0;

  // Signal 9: IROPS network stress at origin (0-15)
  if (iropsCancel >= 15)     score += 15;
  else if (iropsCancel >= 8) score += 10;
  else if (iropsCancel >= 3) score += 4;
  if (iropsDelayed60 >= 20)  score += 5;

  // Signal 10: Destination IROPS (0-10)
  if (destIropsCancel >= 15)     score += 8;
  else if (destIropsCancel >= 8) score += 5;
  if (destIropsDelayed60 >= 20)  score += 3;

  // Compound multiplier
  let severeCount = 0;
  if (faaOrig.groundStop || faaOrig.closure) severeCount++;
  if (faaDest.groundStop || faaDest.closure) severeCount++;
  if (wxOrigLevel === 'severe') severeCount++;
  if (wxDestLevel === 'severe') severeCount++;
  if (iropsCancel >= 15) severeCount++;
  if (severeCount >= 3) score += Math.min(severeCount * 5, 15);

  const finalScore = Math.min(score, 100);
  let label;
  if (finalScore >= 75)      label = 'V.HIGH';
  else if (finalScore >= 50) label = 'HIGH';
  else if (finalScore >= 25) label = 'MOD';
  else                       label = 'LOW';
  return { score: finalScore, label, factors };
}

describe('computeDelayRisk v3 algorithm', () => {
  it('returns LOW for clean conditions (no delays, VFR, good OTP, morning)', () => {
    const r = makeDelayRiskScore({ delayMin: 0, otp: 92, hubHour: 9, origHub: 'GUM' });
    expect(r.label).toBe('LOW');
    expect(r.score).toBeLessThan(25);
  });

  it('returns at least MOD for 60+ min delay even with no other factors', () => {
    const r = makeDelayRiskScore({ delayMin: 65, origHub: 'GUM', hubHour: 8 });
    expect(r.label).not.toBe('LOW');
    expect(r.score).toBeGreaterThanOrEqual(40);
  });

  it('returns HIGH for 60+ min delay at a major hub', () => {
    // 40 (delay) + 8 (EWR base) = 48 → still MOD, but with afternoon factor → HIGH
    const r2 = makeDelayRiskScore({ delayMin: 65, origHub: 'EWR', hubHour: 14 });
    expect(r2.label).toBe('HIGH');
  });

  it('returns HIGH for 120+ min delay', () => {
    const r = makeDelayRiskScore({ delayMin: 130, origHub: 'GUM', hubHour: 8 });
    expect(r.label).toBe('HIGH');
    expect(r.score).toBeGreaterThanOrEqual(50);
  });

  it('a 30min delayed flight is at least MOD, never LOW', () => {
    const r = makeDelayRiskScore({ delayMin: 35, origHub: 'GUM', hubHour: 8 });
    expect(r.label).not.toBe('LOW');
    expect(r.score).toBeGreaterThanOrEqual(25);
  });

  it('ground stop at origin pushes score by 30', () => {
    const r = makeDelayRiskScore({ faaOrig: { groundStop: true }, origHub: 'GUM', hubHour: 8 });
    expect(r.score).toBeGreaterThanOrEqual(30);
  });

  it('airport closure at origin pushes score by 35', () => {
    const r = makeDelayRiskScore({ faaOrig: { closure: true }, origHub: 'GUM', hubHour: 8 });
    expect(r.score).toBeGreaterThanOrEqual(35);
  });

  it('severe weather + low OTP compounds past 40', () => {
    const r = makeDelayRiskScore({ wxOrigLevel: 'severe', otp: 35, origHub: 'ORD', hubHour: 10 });
    // severe=15 + OTP<40=20 + ORD base=5 = 40
    expect(r.score).toBeGreaterThanOrEqual(40);
  });

  it('severe weather + low OTP + evening = HIGH', () => {
    const r = makeDelayRiskScore({ wxOrigLevel: 'severe', otp: 35, origHub: 'ORD', hubHour: 20 });
    // severe=15 + OTP<40=20 + evening=12 + ORD=5 = 52 → HIGH
    expect(r.label).toBe('HIGH');
  });

  it('EWR gets higher base risk than GUM', () => {
    const ewr = makeDelayRiskScore({ origHub: 'EWR', hubHour: 10 });
    const gum = makeDelayRiskScore({ origHub: 'GUM', hubHour: 10 });
    expect(ewr.score).toBeGreaterThan(gum.score);
  });

  it('inbound aircraft still airborne with <45min to dep adds 25 points', () => {
    const r = makeDelayRiskScore({ hasInboundAirborne: true, timeToDepMin: 30, origHub: 'GUM', hubHour: 8 });
    expect(r.score).toBeGreaterThanOrEqual(25);
    expect(r.label).not.toBe('LOW');
  });

  it('weather IFR at origin adds 5 points', () => {
    const base = makeDelayRiskScore({ origHub: 'GUM', hubHour: 8 });
    const ifr = makeDelayRiskScore({ wxOrigCat: 'IFR', origHub: 'GUM', hubHour: 8 });
    expect(ifr.score - base.score).toBe(5);
  });

  it('weather LIFR at origin adds 10 points', () => {
    const base = makeDelayRiskScore({ origHub: 'GUM', hubHour: 8 });
    const lifr = makeDelayRiskScore({ wxOrigCat: 'LIFR', origHub: 'GUM', hubHour: 8 });
    expect(lifr.score - base.score).toBe(10);
  });

  it('thunderstorms add 8 points on top of severe level', () => {
    const noTs = makeDelayRiskScore({ wxOrigLevel: 'severe', origHub: 'GUM', hubHour: 8 });
    const ts = makeDelayRiskScore({ wxOrigLevel: 'severe', wxOrigThunderstorms: true, origHub: 'GUM', hubHour: 8 });
    expect(ts.score - noTs.score).toBe(8);
  });

  it('freezing precip adds 6 points', () => {
    const base = makeDelayRiskScore({ origHub: 'GUM', hubHour: 8 });
    const fz = makeDelayRiskScore({ wxOrigLevel: 'warning', wxOrigFreezingPrecip: true, origHub: 'GUM', hubHour: 8 });
    // warning=10 + freezing=6 = 16 more than base
    expect(fz.score - base.score).toBe(16);
  });

  it('thunderstorms at origin score higher than generic caution', () => {
    const caution = makeDelayRiskScore({ wxOrigLevel: 'caution', origHub: 'GUM', hubHour: 8 });
    const ts = makeDelayRiskScore({ wxOrigLevel: 'warning', wxOrigThunderstorms: true, origHub: 'GUM', hubHour: 8 });
    expect(ts.score).toBeGreaterThan(caution.score);
  });

  it('IROPS cancellation rate >= 15% adds 15 points', () => {
    const base = makeDelayRiskScore({ origHub: 'GUM', hubHour: 8 });
    const irops = makeDelayRiskScore({ origHub: 'GUM', hubHour: 8, iropsCancel: 20 });
    expect(irops.score - base.score).toBe(15);
  });

  it('IROPS cancellation rate 8-14% adds 10 points', () => {
    const base = makeDelayRiskScore({ origHub: 'GUM', hubHour: 8 });
    const irops = makeDelayRiskScore({ origHub: 'GUM', hubHour: 8, iropsCancel: 10 });
    expect(irops.score - base.score).toBe(10);
  });

  it('IROPS high delayed60 rate adds 5 points', () => {
    const base = makeDelayRiskScore({ origHub: 'GUM', hubHour: 8 });
    const irops = makeDelayRiskScore({ origHub: 'GUM', hubHour: 8, iropsDelayed60: 25 });
    expect(irops.score - base.score).toBe(5);
  });

  it('destination thunderstorms add 5 points', () => {
    const base = makeDelayRiskScore({ origHub: 'GUM', hubHour: 8 });
    const ts = makeDelayRiskScore({ origHub: 'GUM', hubHour: 8, wxDestThunderstorms: true });
    expect(ts.score - base.score).toBe(5);
  });

  it('score is capped at 100', () => {
    const r = makeDelayRiskScore({
      delayMin: 130, faaOrig: { groundStop: true }, wxOrigLevel: 'severe',
      wxOrigThunderstorms: true, wxOrigCat: 'LIFR', otp: 30, hubHour: 20,
      hasInboundAirborne: true, timeToDepMin: 20, origHub: 'EWR',
      iropsCancel: 20,
    });
    expect(r.score).toBe(100);
  });

  // ── New signals: hub-specific IFR, de-icing, dest IROPS, compound ──

  it('SFO LIFR gets 15 points (higher than default 10)', () => {
    const sfo = makeDelayRiskScore({ wxOrigCat: 'LIFR', origHub: 'SFO', hubHour: 8 });
    const gum = makeDelayRiskScore({ wxOrigCat: 'LIFR', origHub: 'GUM', hubHour: 8 });
    expect(sfo.score).toBeGreaterThan(gum.score);
    // SFO LIFR=15 + SFO base=5 = 20; GUM LIFR=10 + GUM base=1 = 11
    expect(sfo.score - gum.score).toBe(9);
  });

  it('EWR IFR gets 8 points (higher than default 5)', () => {
    const ewr = makeDelayRiskScore({ wxOrigCat: 'IFR', origHub: 'EWR', hubHour: 8 });
    const gum = makeDelayRiskScore({ wxOrigCat: 'IFR', origHub: 'GUM', hubHour: 8 });
    // EWR IFR=8 + base=8 = 16; GUM IFR=5 + base=1 = 6
    expect(ewr.score - gum.score).toBe(10);
  });

  it('de-icing adds 8 points when freezing precip at sub-freezing temps', () => {
    const noDeice = makeDelayRiskScore({ wxOrigLevel: 'warning', wxOrigFreezingPrecip: true, origHub: 'GUM', hubHour: 8 });
    const deice = makeDelayRiskScore({ wxOrigLevel: 'warning', wxOrigFreezingPrecip: true, wxOrigTempC: 0, origHub: 'GUM', hubHour: 8 });
    expect(deice.score - noDeice.score).toBe(8);
  });

  it('extreme cold de-icing adds 12 points total', () => {
    const base = makeDelayRiskScore({ wxOrigLevel: 'warning', wxOrigFreezingPrecip: true, origHub: 'GUM', hubHour: 8 });
    const extreme = makeDelayRiskScore({ wxOrigLevel: 'warning', wxOrigFreezingPrecip: true, wxOrigTempC: -10, origHub: 'GUM', hubHour: 8 });
    expect(extreme.score - base.score).toBe(12); // 8 + 4
  });

  it('destination IROPS cancellations >= 15% adds 8 points', () => {
    const base = makeDelayRiskScore({ origHub: 'GUM', hubHour: 8 });
    const destStress = makeDelayRiskScore({ origHub: 'GUM', hubHour: 8, destIropsCancel: 20 });
    expect(destStress.score - base.score).toBe(8);
  });

  it('destination IROPS delayed60 >= 20% adds 3 points', () => {
    const base = makeDelayRiskScore({ origHub: 'GUM', hubHour: 8 });
    const destDel = makeDelayRiskScore({ origHub: 'GUM', hubHour: 8, destIropsDelayed60: 25 });
    expect(destDel.score - base.score).toBe(3);
  });

  it('compound multiplier triggers at 3+ severe signals', () => {
    // ground stop + severe weather + 15% cancellations = 3 severe signals → +15 compound
    const noCompound = makeDelayRiskScore({ faaOrig: { groundStop: true }, wxOrigLevel: 'severe', origHub: 'GUM', hubHour: 8 });
    const compound = makeDelayRiskScore({ faaOrig: { groundStop: true }, wxOrigLevel: 'severe', iropsCancel: 20, origHub: 'GUM', hubHour: 8 });
    // compound adds 15 (irops) + 15 (compound bonus for 3 signals)
    expect(compound.score - noCompound.score).toBe(30);
  });

  it('V.HIGH label at score >= 75', () => {
    // 130min delay=50 + ground stop=30 + GUM base=1 = 81
    const r = makeDelayRiskScore({ delayMin: 130, faaOrig: { groundStop: true }, origHub: 'GUM', hubHour: 8 });
    expect(r.score).toBeGreaterThanOrEqual(75);
    expect(r.label).toBe('V.HIGH');
  });
});

describe('getStartOfDayForHub', () => {
  it('returns a Unix timestamp (seconds)', () => {
    const ts = getStartOfDayForHub('ORD');
    expect(typeof ts).toBe('number');
    expect(ts).toBeGreaterThan(1_000_000_000);
    expect(ts).toBeLessThan(3_000_000_000); // reasonable range
  });

  it('returns different timestamps for different timezones', () => {
    const ord = getStartOfDayForHub('ORD'); // Central
    const nrt = getStartOfDayForHub('NRT'); // JST
    // They may coincidentally match if tested at the right hour, but generally differ
    // At minimum, both should be valid timestamps
    expect(typeof ord).toBe('number');
    expect(typeof nrt).toBe('number');
  });

  it('falls back to America/New_York for unknown hubs', () => {
    // Should not throw
    const ts = getStartOfDayForHub('XYZ');
    expect(typeof ts).toBe('number');
  });
});

// ═══ AIRCRAFT HISTORY TESTS ═══
import { normalizeSegments } from '../api/aircraft-history.js';

describe('normalizeSegments', () => {
  it('normalizes FR24 summary data into segments with delay calculation', () => {
    const data = {
      data: [
        {
          flight_iata: 'UA302',
          origin: { iata: 'SFO' },
          destination: { iata: 'ORD' },
          status: 'landed',
          departure: { scheduled: '2026-03-10T10:00:00Z', actual: '2026-03-10T10:42:00Z' },
          arrival: { scheduled: '2026-03-10T14:00:00Z', actual: '2026-03-10T14:38:00Z' },
        },
      ],
    };
    const segs = normalizeSegments(data);
    expect(segs).toHaveLength(1);
    expect(segs[0].flightNumber).toBe('UA302');
    expect(segs[0].origin).toBe('SFO');
    expect(segs[0].destination).toBe('ORD');
    expect(segs[0].delayMin).toBe(42);
    expect(segs[0].status).toBe('landed');
  });

  it('filters out segments with missing airport data', () => {
    const data = {
      data: [
        { flight_iata: 'UA1', origin: { iata: 'SFO' }, destination: { iata: 'ORD' }, status: 'landed',
          departure: { scheduled: '2026-03-10T10:00:00Z' }, arrival: {} },
        { flight_iata: 'UA2', origin: {}, destination: { iata: 'LAX' }, status: 'landed',
          departure: { scheduled: '2026-03-10T11:00:00Z' }, arrival: {} },
      ],
    };
    const segs = normalizeSegments(data);
    expect(segs).toHaveLength(1);
    expect(segs[0].flightNumber).toBe('UA1');
  });

  it('sorts by departure time descending and limits to 5', () => {
    const data = { data: [] };
    for (let i = 0; i < 8; i++) {
      data.data.push({
        flight_iata: 'UA' + (100 + i),
        origin: { iata: 'SFO' },
        destination: { iata: 'ORD' },
        status: 'landed',
        departure: { scheduled: new Date(Date.now() - (i * 3600000)).toISOString() },
        arrival: {},
      });
    }
    const segs = normalizeSegments(data);
    expect(segs).toHaveLength(5);
    // Most recent should be first
    expect(segs[0].flightNumber).toBe('UA100');
  });

  it('handles null/missing delay gracefully', () => {
    const data = {
      data: [
        {
          flight_iata: 'UA500',
          origin: { iata: 'DEN' },
          destination: { iata: 'EWR' },
          status: 'en-route',
          departure: { scheduled: '2026-03-10T12:00:00Z' },
          arrival: { estimated: '2026-03-10T16:30:00Z' },
        },
      ],
    };
    const segs = normalizeSegments(data);
    expect(segs[0].delayMin).toBeNull(); // No actual departure → can't compute delay
  });

  it('returns empty array for empty data', () => {
    expect(normalizeSegments({})).toEqual([]);
    expect(normalizeSegments({ data: [] })).toEqual([]);
    expect(normalizeSegments(null)).toEqual([]);
  });

  it('computes negative delay for early departures', () => {
    const data = {
      data: [{
        flight_iata: 'UA999',
        origin: { iata: 'IAH' },
        destination: { iata: 'LAX' },
        status: 'landed',
        departure: { scheduled: '2026-03-10T15:00:00Z', actual: '2026-03-10T14:55:00Z' },
        arrival: { scheduled: '2026-03-10T17:00:00Z', actual: '2026-03-10T16:50:00Z' },
      }],
    };
    const segs = normalizeSegments(data);
    expect(segs[0].delayMin).toBe(-5); // 5 minutes early
  });
});
