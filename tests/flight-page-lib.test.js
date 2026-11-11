// The flight page's pure rules: what a flight number is, which leg "now" means, the 30-day record,
// the tail's legs, the server's leg assembly and the page's view (src/lib/flight-page*.js).
import { describe, expect, it } from 'vitest';

import {
  A,
  D,
  canceledCase,
  delayedCase,
  divertedCase,
  historyRows,
  inAirCase,
  landedCase,
  payloadFor,
  scheduledCase,
  ua929Aircraft,
  ua929Row,
} from './fixtures/flight-page-fixtures.js';
import {
  FLIGHT_HISTORY_START,
  historyDayKind,
  historyWords,
  inboundLeg,
  parseFlightIdent,
  pickScheduleLeg,
  summarizeHistory,
  tailLegsView,
} from '../src/lib/flight-page.js';
import {
  aircraftFacts,
  boardKeysForLeg,
  boardRowForLeg,
  historyLegs,
  indexStarlinkRoster,
  pickCurrentLeg,
  trimBoardRow,
} from '../src/lib/flight-page-data.js';
import { aircraftView, flightHistoryView, flightPageView, progressView, timelineSteps } from '../src/lib/flight-page-view.js';
import { flightLegState } from '../src/lib/flight-verdict.js';
import { ON_TIME_GRACE_MIN } from '../src/lib/hub-health.js';

const MIN = 60;

describe('parseFlightIdent — strict, and forgiving of how people type', () => {
  it.each([
    ['UA929', 'UA929', true],
    ['ua929', 'UA929', false],
    ['UA 929', 'UA929', false],
    ['UAL929', 'UA929', false],
    ['ual 929', 'UA929', false],
    ['UA-929', 'UA929', false],
    ['929', 'UA929', false],
    ['UA0929', 'UA929', false],
    ['  UA1  ', 'UA1', false],
    ['UA5103', 'UA5103', true],
  ])('%s → %s', (raw, ident, canonical) => {
    expect(parseFlightIdent(raw)).toEqual({ ident, canonical });
  });

  it.each(['', 'UA', 'UA0', 'UA12345', 'AA929', 'DL1', 'UA526H', 'N686UA', '../UA929', 'UA929;drop', 'x'.repeat(40), null, 7])(
    'rejects %s',
    (raw) => {
      expect(parseFlightIdent(raw)).toBeNull();
    },
  );

  it('takes the first value of a repeated query parameter', () => {
    expect(parseFlightIdent(['ua929', 'UA1'])).toEqual({ ident: 'UA929', canonical: false });
  });
});

describe('pickScheduleLeg — the same precedence as /api/flight-times', () => {
  const leg = (dep, extra = {}) => {
    const row = ua929Row();
    row.time.scheduled.departure = dep;
    row.time.scheduled.arrival = dep + 8 * 3600;
    row.time.estimated = { departure: null, arrival: null };
    Object.assign(row.time.real, extra);
    return { row, schedDep: dep };
  };

  it('prefers the leg in the air over the next departure', () => {
    const flying = leg(D - 3600, { departure: D - 3500 });
    const next = leg(D + 86400);
    expect(pickScheduleLeg([next, flying], D)).toBe(flying);
  });

  it('prefers the next departure over a leg that landed long ago', () => {
    const old = leg(D - 30 * 3600, { departure: D - 30 * 3600, arrival: D - 22 * 3600 });
    const next = leg(D + 3600);
    expect(pickScheduleLeg([old, next], D)).toBe(next);
  });
});

describe('the 30-day record (flight_history → squares)', () => {
  it('uses the board on-time rule: a REAL departure within 30 minutes', () => {
    expect(ON_TIME_GRACE_MIN).toBe(30);
    const [row] = historyRows(['2026-11-08']);
    expect(historyDayKind({ ...row, dep_at: row.sched_dep + 30, dep_basis: 'gate' }).kind).toBe('on-time');
    expect(historyDayKind({ ...row, dep_at: row.sched_dep + 31, dep_basis: 'runway' }).kind).toBe('late');
    // An estimate is never a result, and a leg never seen finishing is no data, not on time.
    expect(historyDayKind({ ...row, dep_at: row.sched_dep, dep_basis: 'estimate' }).kind).toBe('no-data');
    expect(historyDayKind({ ...row, dep_at: null, dep_basis: null, outcome: 'unknown', final: false }).kind).toBe('no-data');
    expect(historyDayKind({ ...row, outcome: 'canceled' }).kind).toBe('canceled');
    expect(historyDayKind({ ...row, outcome: 'canceled_unconfirmed' }).kind).toBe('unconfirmed');
  });

  it('never pads: with collection from Nov 6, Nov 11 shows Nov 6–10 only', () => {
    const rows = historyRows(['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11']);
    const s = summarizeHistory(rows, { origin: 'ORD', dest: 'LHR', today: '2026-11-11' });
    expect(s.start).toBe(FLIGHT_HISTORY_START);
    expect(s.days.map((d) => d.date)).toEqual(['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
    expect(historyWords(s).count).toBe('On time 5 of 5 days with a recorded departure, since Nov 6, when our record starts.');
  });

  it('caps the window at 30 days once there is enough history', () => {
    const s = summarizeHistory([], { origin: 'ORD', dest: 'LHR', today: '2026-12-31' });
    expect(s.days).toHaveLength(30);
    expect(s.days[0].date).toBe('2026-12-01');
    expect(s.sinceCollectionStart).toBe(false);
  });

  it('shows only this route: one number flies several legs', () => {
    const rows = historyRows(['2026-11-08']).concat([{ ...historyRows(['2026-11-09'])[0], origin: 'LHR', dest: 'ORD' }]);
    const s = summarizeHistory(rows, { origin: 'ORD', dest: 'LHR', today: '2026-11-10' });
    expect(s.days.map((d) => [d.date, d.kind])).toEqual([
      ['2026-11-06', 'no-data'], ['2026-11-07', 'no-data'], ['2026-11-08', 'on-time'], ['2026-11-09', 'no-data'],
    ]);
  });

  it('says the typical late only with at least three late days, and discloses takeoff-time days', () => {
    const kinds = ['late', 'late', 'on-time', 'late', 'canceled', 'unconfirmed'];
    const dates = ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'];
    const s = summarizeHistory(historyRows(dates, (_, i) => kinds[i]), { origin: 'ORD', dest: 'LHR', today: '2026-11-12' });
    expect(s.counts).toMatchObject({ 'on-time': 1, late: 3, canceled: 1, unconfirmed: 1 });
    const words = historyWords(s);
    expect(words.typical).toBe('When it runs late, it is usually about 40 minutes.');
    expect(words.count).toBe('On time 1 of 4 days with a recorded departure, since Nov 6, when our record starts. 1 canceled, 1 listed as likely canceled (unconfirmed).');
    expect(words.note).toContain('3 of these 4 departure times are takeoff times, which include taxiing.');

    const two = summarizeHistory(historyRows(dates.slice(0, 2), () => 'late'), { origin: 'ORD', dest: 'LHR', today: '2026-11-08' });
    expect(historyWords(two).typical).toBe('');
  });

  it('on the first day of collection there is nothing to show, and it says so', () => {
    const s = summarizeHistory([], { origin: 'ORD', dest: 'LHR', today: FLIGHT_HISTORY_START });
    expect(s.days).toEqual([]);
    expect(historyWords(s)).toMatchObject({ empty: true });
  });

  it('every square carries a glyph or words, not colour alone', () => {
    const view = flightHistoryView({ origin: 'ORD', dest: 'LHR', today: '2026-11-11', rows: historyRows(['2026-11-07', '2026-11-08'], (_, i) => (i ? 'late' : 'canceled')) });
    for (const day of view.days) expect(day.sr).toMatch(/^Nov \d+: /);
    expect(view.days.map((d) => d.glyph)).toEqual(['', '✕', '!', '', '']);
    expect(view.title).toBe('This flight, last 5 days');
  });
});

describe("the tail's legs", () => {
  const tail = [
    { flight_no: 'UA930', service_date: '2026-11-11', origin: 'LHR', dest: 'ORD', sched_dep: (D - 20 * 3600) / 60, sched_arr: (D - 11 * 3600) / 60, dep_at: (D - 20 * 3600) / 60 + 12, dep_basis: 'runway', arr_at: (D - 11 * 3600) / 60 - 5, arr_basis: 'gate', outcome: 'operated', final: true },
    { flight_no: 'UA929', service_date: '2026-11-11', origin: 'ORD', dest: 'LHR', sched_dep: D / 60, sched_arr: A / 60, dep_at: null, dep_basis: null, arr_at: null, arr_basis: null, outcome: 'unknown', final: false },
    { flight_no: 'UA929', service_date: '2026-11-09', origin: 'ORD', dest: 'LHR', sched_dep: (D - 48 * 3600) / 60, sched_arr: (A - 48 * 3600) / 60, dep_at: (D - 48 * 3600) / 60 + 45, dep_basis: 'gate', arr_at: null, arr_basis: null, outcome: 'operated', final: true },
  ];

  it('lists the legs before this one, newest first, with results the archive stands behind', () => {
    const legs = tailLegsView(tail, { ident: 'UA929', schedDepMin: D / 60, origin: 'ORD', dest: 'LHR' });
    expect(legs.map((l) => [l.flight, `${l.origin}-${l.dest}`, l.result, l.tone])).toEqual([
      ['UA930', 'LHR-ORD', '+12 min', 'ok'],
      ['UA929', 'ORD-LHR', '+45 min', 'warn'],
    ]);
  });

  it('finds the inbound leg into our origin (the zero-cost "where is my plane")', () => {
    expect(inboundLeg(tail, { origin: 'ORD', schedDepMin: D / 60 })).toMatchObject({ flight: 'UA930', from: 'LHR', arrBasis: 'gate' });
    expect(inboundLeg(tail, { origin: 'SFO', schedDepMin: D / 60 })).toBeNull();
  });
});

describe('server assembly (flight-page-data.js)', () => {
  const sightings = new Map();

  it('picks the leg now from the archive: today first, tomorrow only when today has nothing', () => {
    const nowSec = D - 3600; // Nov 11, 2:45 PM CST
    const rows = historyRows(['2026-11-10', '2026-11-11', '2026-11-12']);
    rows[0].dep_at = rows[0].sched_dep + 3; rows[0].dep_basis = 'gate'; rows[0].arr_at = rows[0].sched_arr; rows[0].arr_basis = 'gate';
    rows[1].dep_at = null; rows[1].dep_basis = null; rows[1].outcome = 'unknown'; rows[1].final = false;
    rows[2].dep_at = null; rows[2].dep_basis = null; rows[2].outcome = 'unknown'; rows[2].final = false;
    const picked = pickCurrentLeg(historyLegs(rows, nowSec, sightings), nowSec);
    expect(picked.history.service_date).toBe('2026-11-11');
  });

  it('reads only the leg\'s own boards: origin departures for its day, destination arrivals for its arrival day', () => {
    expect(boardKeysForLeg({ origin: 'ORD', dest: 'LHR', schedDepSec: D, schedArrSec: A })).toEqual([
      { key: 'agg:ORD:departures:1794376800', hub: 'ORD', dir: 'departures' },
    ]);
    const keys = boardKeysForLeg({ origin: 'FRA', dest: 'ORD', schedDepSec: D - 9 * 3600, schedArrSec: D - 3600 });
    expect(keys).toEqual([{ key: 'agg:ORD:arrivals:1794376800', hub: 'ORD', dir: 'arrivals' }]);
    expect(boardKeysForLeg({ origin: 'ORD', dest: 'SFO', schedDepSec: D, schedArrSec: D + 4.5 * 3600 }).map((k) => k.key)).toEqual([
      'agg:ORD:departures:1794376800',
      'agg:SFO:arrivals:1794384000',
    ]);
  });

  it('merges the departures and arrivals rows of the same instance, and ignores other days', () => {
    const dep = ua929Row();
    dep.airport.origin.info.gate = 'C18';
    const arr = landedCase().row;
    arr.airport.origin.info.gate = '';
    const other = ua929Row();
    other.time.scheduled.departure = D + 86400;
    const found = boardRowForLeg(
      [
        { dir: 'departures', hub: 'ORD', data: { flights: [other, dep], meta: { generatedAt: D - 600 } } },
        { dir: 'arrivals', hub: 'LHR', data: { flights: [arr] } },
      ],
      { ident: 'UA929', origin: 'ORD', dest: 'LHR', schedDepSec: D },
      A + 3600,
    );
    expect(found.dir).toBe('departures');
    expect(found.boardAtSec).toBe(D - 600);
    expect(found.row.airport.origin.info.gate).toBe('C18');
    expect(found.row.time.real.arrival).toBe(A - 13 * MIN);
  });

  it('trims a board row to what the page reads, and the trimmed row words the same', () => {
    const { row, nowSec } = inAirCase();
    row.extraProviderDebris = { a: 1 };
    const trimmed = trimBoardRow(row);
    expect(trimmed.extraProviderDebris).toBeUndefined();
    expect(flightLegState(trimmed, nowSec).state).toBe(flightLegState(row, nowSec).state);
    expect(JSON.stringify(trimmed).length).toBeLessThan(1200);
  });

  it('aircraft facts: mainline from the fleet file, Wi-Fi relabelled Starlink by the roster; Express cabins only when verified', () => {
    const fleet = [{ r: 'N686UA', t: '767-300ER', w: 'Satl Ku', c: '46J/22PP/43E+/56Y', seats: { J: 46, PP: 22, 'E+': 43, Y: 56 }, tot: 167, d: '1999', i: 'AVOD' }];
    expect(aircraftFacts('N686UA', { fleet })).toMatchObject({ type: '767-300ER', total: 167, wifi: 'Satellite Ku', starlink: false });
    const roster = indexStarlinkRoster([{ tail: 'N686UA', fleet: 'Mainline', type: '767-300ER' }, { tail: 'N515GJ', fleet: 'Express', type: 'CRJ-550', operator: 'GoJet dba UAX' }]);
    expect(aircraftFacts('N686UA', { fleet, starlink: roster })).toMatchObject({ wifi: 'Starlink', starlink: true });
    expect(aircraftFacts('N515GJ', { fleet, starlink: roster, operator: 'GJS' })).toMatchObject({ express: true, starlink: true, total: 50, operator: 'GoJet Airlines' });
    expect(aircraftFacts('N999ZZ', { fleet, modelCode: 'E75L', operator: 'SKW' })).toMatchObject({ seats: null, total: null, wifi: null });
    expect(aircraftFacts('', { fleet })).toBeNull();
  });
});

describe('the page view (flight-page-view.js)', () => {
  it('a timeline holds only steps the data supports, in time order', () => {
    const { row, nowSec } = inAirCase();
    const steps = timelineSteps(flightLegState(row, nowSec), row, nowSec);
    expect(steps.map((s) => [s.time, s.label, s.state])).toEqual([
      ['3:45 PM CST', 'Scheduled departure, Terminal 1, gate C18', 'done'],
      ['3:48 PM CST', 'Left the gate, on time', 'done'],
      ['Now', 'In the air', 'now'],
      ['5:42 AM GMT tomorrow', 'Expected arrival, Terminal 2', 'next'],
    ]);
    const sched = scheduledCase();
    expect(timelineSteps(flightLegState(sched.row, sched.nowSec), sched.row, sched.nowSec).map((s) => s.label)).toEqual([
      'Scheduled departure, Terminal 1',
      'Scheduled arrival, Terminal 2',
    ]);
  });

  it('progress: by the live position when there is one, else by the clock, and says which', () => {
    const { row, nowSec } = inAirCase();
    const leg = flightLegState(row, nowSec);
    const clock = progressView(leg, row, nowSec);
    expect(clock.source).toBe('clock');
    expect(clock.note).toBe('Position estimated from the clock, not a live fix');
    expect(clock.fraction).toBeCloseTo((nowSec - (D + 3 * MIN)) / (A - 13 * MIN - (D + 3 * MIN)), 5);
    const live = progressView(leg, row, nowSec, { lat: 51.0, lon: -60.0, alt: 10058, spd: 286.5, vr: 0, onGround: false });
    expect(live.source).toBe('live');
    expect(live.note).toMatch(/^33,000 ft · 557 kts · [\d,]+ mi to go · about \dh \d+m left · live position$/);
    expect(progressView(flightLegState(scheduledCase().row, scheduledCase().nowSec), scheduledCase().row, scheduledCase().nowSec)).toBeNull();
  });

  it('the aircraft card names cabins, Wi-Fi in words, and says when the tail is not known yet', () => {
    const view = aircraftView(ua929Aircraft, null, { ident: 'UA929', schedDepMin: D / 60, origin: 'ORD', dest: 'LHR' });
    expect(view.summary).toBe('Boeing 767-300ER · 167 seats');
    expect(view.wifi).toEqual({ text: 'Satellite Ku Wi-Fi, not Starlink', starlink: false });
    expect(view.cabinLine).toBe('46 Polaris · 22 Premium Plus · 43 Economy Plus · 56 Economy');
    expect(aircraftView(null, null, {}).summary).toMatch(/not named the aircraft/);
  });

  it('offers the AI read only for a flight that has not left (the board predicts only those), and no card at all after', () => {
    for (const { row, nowSec } of [scheduledCase(), delayedCase()]) {
      expect(flightPageView(payloadFor(row), nowSec).read?.eligible).toBe(true);
    }
    for (const { row, nowSec } of [inAirCase(), landedCase(), canceledCase(), divertedCase()]) {
      expect(flightPageView(payloadFor(row), nowSec).read).toBeNull();
    }
  });

  it('not found and unavailable are said plainly, with the last flight when the archive has one', () => {
    const nf = flightPageView({ ident: 'UA929', status: 'not-found', lastSeen: { date: '2026-11-08', origin: 'ORD', dest: 'LHR' } }, D);
    expect(nf.verdict.text).toBe("We don't have UA929 on any United hub board right now. It last flew Chicago O'Hare to London Heathrow on Nov 8.");
    expect(flightPageView({ ident: 'UA929', status: 'unavailable' }, D).verdict.text).toBe("We can't reach our flight data right now. Try again in a minute.");
  });
});
