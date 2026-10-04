// Live audit Oct 4 2026, findings 2 and 3: wrong delays on airborne flights, and departure delays
// measured to wheels-up. Every row below is the row the board served that night (00:46Z), times
// verbatim.
import { describe, it, expect } from 'vitest';
import { buildScheduleRow } from '../src/lib/schedule-row-model.js';
import { classifySchedStatus } from '../src/lib/schedule-status.js';

const AUDIT_SEC = 1791074760; // 00:46Z Oct 4 2026
const TS = { hasGateArr: true, hasGateDep: true, hasRunwayArr: true, hasRunwayDep: true, gateDistinctArr: false, gateDistinctDep: false };
const expected = () => ({ icon: '', live: false, text: 'expected', generic: { type: '', status: { text: 'scheduled', diverted: false } } });

function row(ident, origin, dest, time, extra = {}) {
  return {
    identification: { number: { default: ident } },
    status: expected(),
    time: { real: { departure: null, arrival: null }, estimated: { departure: null, arrival: null }, ...time },
    airport: { origin: { code: { iata: origin } }, destination: { code: { iata: dest } } },
    aircraft: { model: { code: 'B739' }, registration: 'N12345' },
    _source: { provider: 'aerodatabox', timeSource: TS },
    ...extra,
  };
}

function model(flight, dir, nowSec = AUDIT_SEC) {
  const status = classifySchedStatus(flight, dir, nowSec);
  return buildScheduleRow(flight, { hub: dir === 'arrivals' ? flight.airport.destination.code.iata : flight.airport.origin.code.iata, dir, timeZone: 'UTC', status, reg: 'N12345' });
}

// ORD arrivals UA2059 ROC→ORD: estimated off 23:22Z (+102), estimated in 03:16Z — a 3h54m block on a
// 2h08m schedule. It landed about +66m.
const ua2059 = (extra = {}) => row('UA2059', 'ROC', 'ORD', {
  scheduled: { departure: 1791063600, arrival: 1791071280 },
  estimated: { departure: 1791069720, arrival: 1791083760 },
}, extra);

describe('arrival delays follow the evidence, not a contradicted estimate (finding 2)', () => {
  it('UA2059 airborne: not "+3h28m" — the departure plus the scheduled block (+1h42m), labelled as derived', () => {
    const m = model(ua2059({ live: { seenAt: (AUDIT_SEC - 30) * 1000 } }), 'arrivals');
    expect(m.status).toMatchObject({ text: 'En Route', live: true });
    expect(m.delay).toMatchObject({ kind: 'delta', minutes: 102, text: '+1h42m', basis: 'derived' });
    expect(m.delay.title).toMatch(/scheduled block/);
  });

  it('UA2059 with a live position: the My Flights "ETA from live position" wins (≈ +69m)', () => {
    const eta = AUDIT_SEC + 11 * 60; // "11m to arrival"
    const m = model(ua2059({ live: { seenAt: (AUDIT_SEC - 30) * 1000, etaSec: eta } }), 'arrivals');
    expect(m.delay).toMatchObject({ kind: 'delta', minutes: Math.round((eta - 1791071280) / 60), basis: 'live' });
    expect(m.delay.title).toMatch(/live position/);
  });

  it('UA2059 landed (seen on the ground): at least +65m, from the last airborne fix — never the +3h28m estimate', () => {
    const at = 1791076720; // 01:18:40Z
    const landed = ua2059({ _source: { timeSource: TS, track: { airborneAt: 1791075206131, groundAt: 1791076718204, landed: true } } });
    const m = model(landed, 'arrivals', at);
    expect(m.status).toMatchObject({ text: 'Landed', presumed: true, seenLanded: true });
    expect(m.delay).toMatchObject({ kind: 'delta', minutes: 65, text: '≥+65m', basis: 'sighting', bound: 'lower' });
    expect(m.actualLine).toBeNull();
  });

  it('DEN UA407 EWR→DEN: never "−75m" after leaving the gate 38 min late — +38m', () => {
    const ua407 = row('UA407', 'EWR', 'DEN', {
      scheduled: { departure: 1791067440, arrival: 1791083160 },
      estimated: { departure: 1791069720, arrival: 1791078660 }, // a 2h29m block for 1,400 nm
    });
    const m = model(ua407, 'arrivals');
    expect(m.delay).toMatchObject({ kind: 'delta', minutes: 38, basis: 'derived' });
    expect(m.delay.minutes).toBeGreaterThan(0);
  });

  it('ORD UA1963 SLC→ORD: not "+0m" while cruising past its scheduled arrival — +79m', () => {
    const ua1963 = row('UA1963', 'SLC', 'ORD', {
      scheduled: { departure: 1791065400, arrival: 1791074280 },
      estimated: { departure: 1791070140, arrival: 1791074280 }, // arrival estimate = schedule, 69 min after departure
    });
    const m = model(ua1963, 'arrivals');
    expect(m.delay).toMatchObject({ kind: 'delta', minutes: 79, basis: 'derived' });
  });

  it('keeps the estimates that were right (EWR UA2629 +2h59m, IAH UA1838 +3h13m, EWR UA2252 +3h30m)', () => {
    const ua2629 = row('UA2629', 'MCO', 'EWR', { scheduled: { departure: 1791057900, arrival: 1791067560 }, estimated: { departure: 1791068820, arrival: 1791078300 } });
    const ua1838 = row('UA1838', 'MEX', 'IAH', { scheduled: { departure: 1791058500, arrival: 1791066960 }, estimated: { departure: null, arrival: 1791078540 } });
    const ua2252 = row('UA2252', 'MEX', 'EWR', { scheduled: { departure: 1791053400, arrival: 1791071280 }, estimated: { departure: null, arrival: 1791083880 } });
    expect(model(ua2629, 'arrivals').delay).toMatchObject({ text: '+2h59m', basis: 'estimate' });
    expect(model(ua1838, 'arrivals').delay).toMatchObject({ text: '+3h13m', basis: 'estimate' });
    expect(model(ua2252, 'arrivals').delay).toMatchObject({ text: '+3h30m', basis: 'estimate' });
  });

  it('a padded short hop that really arrives early is NOT "corrected" (UA303 MCI→ORD flew 64 min against 114)', () => {
    const ua303 = row('UA303', 'MCI', 'ORD', {
      scheduled: { departure: 1791070740, arrival: 1791077580 },
      real: { departure: 1791070620, arrival: null }, // off the gate 23:37Z
      estimated: { departure: null, arrival: 1791074460 }, // 00:41Z, the time it really reached the gate
    }, { status: { icon: 'green', live: true, text: 'en route', generic: { type: '', status: { text: 'en-route', diverted: false } } } });
    expect(model(ua303, 'arrivals', 1791073000).delay).toMatchObject({ kind: 'delta', minutes: -52, basis: 'estimate' });
  });

  it('DEN UA5063 DEN→LBF had no provider time and took off 2h16m late: at least +82m from the airborne fix', () => {
    const ua5063 = row('UA5063', 'DEN', 'LBF', {
      scheduled: { departure: 1791066360, arrival: 1791070680 },
    }, { _source: { timeSource: {}, track: { airborneAt: 1791076478020 } } });
    const m = model(ua5063, 'departures', 1791076500);
    expect(m.status).toMatchObject({ key: 'departed' });
    expect(m.delay).toMatchObject({ kind: 'delta', minutes: 82, text: '≥+82m', basis: 'sighting', bound: 'lower' });
  });
});

describe('departure delays say what they measured (finding 3)', () => {
  const dep = (timeSource, real = 1791063600) => row('UA884', 'IAD', 'FCO', {
    scheduled: { departure: 1791060000, arrival: 1791090000 },
    real: { departure: real, arrival: null },
  }, { status: { icon: 'green', live: true, text: 'departed', generic: { type: '', status: { text: 'departed', diverted: false } } }, _source: { timeSource } });

  it('a runway time (no distinct gate time) is labelled wheels-up and flagged, subtracting nothing', () => {
    const m = model(dep({ hasGateDep: true, hasRunwayDep: true, gateDistinctDep: false }), 'departures');
    expect(m.actualFromRunway).toBe(true);
    expect(m.delay).toMatchObject({ kind: 'delta', minutes: 60, text: '+60m', basis: 'runway' });
    expect(m.delay.title).toMatch(/Wheels-up/);
    expect(m.delay.title).toMatch(/taxi-out/);
  });

  it('a distinct gate time wins and is labelled as the gate', () => {
    const m = model(dep({ hasGateDep: true, hasRunwayDep: true, gateDistinctDep: true }), 'departures');
    expect(m.actualFromRunway).toBe(false);
    expect(m.delay).toMatchObject({ minutes: 60, basis: 'gate', title: 'Actual vs scheduled departure' });
  });

  it('an "actual" departure LATER than the live feed saw it airborne is flagged — UA884 shape (+71 vs airborne at +35)', () => {
    const ua884 = row('UA884', 'IAD', 'FCO', {
      scheduled: { departure: 1791063300, arrival: 1791094500 },
      real: { departure: 1791067560, arrival: null },
    }, {
      status: { icon: 'green', live: true, text: 'departed', generic: { type: '', status: { text: 'departed', diverted: false } } },
      _source: { timeSource: { ...TS, gateDistinctDep: true }, track: { airborneAt: 1791065400000 } }, // airborne 22:10Z
    });
    expect(model(ua884, 'departures').delay).toMatchObject({ text: '≤+35m', bound: 'upper', basis: 'sighting' });
  });
});
