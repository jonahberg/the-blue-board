import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  BASIS_RANK,
  FLIGHT_HISTORY_COLUMNS,
  OUTCOME_RANK,
  archiveRowsFromBoard,
  flightHistoryKey,
  isFinalRow,
  localDate,
  mergeFlightHistoryRow,
  observeFlight,
  sameFlightHistoryRow,
  statusRank,
} from '../src/lib/flight-history.js';
import { applySightingsToBoard } from '../src/lib/reg-overlay.js';
import { HUB_TZ, getStartOfHubDay } from '../src/lib/hubTz.js';

const H = 3600;
const NOW = new Date('2026-11-09T18:00:00Z');
const ORD_DAY = getStartOfHubDay('ORD', -1, NOW); // Sun Nov 8 2026, 00:00 CST
const EWR_DAY = getStartOfHubDay('EWR', -1, NOW);
const min = (sec) => Math.floor(sec / 60);

const DEPARTED = { generic: { status: { text: 'departed', diverted: false }, type: '' }, text: 'departed', icon: 'green', live: true };
const ARRIVED = { generic: { status: { text: 'landed', diverted: false }, type: '' }, text: 'arrived', icon: 'green', live: false };
const ENROUTE = { generic: { status: { text: 'en-route', diverted: false }, type: '' }, text: 'enroute', icon: 'green', live: true };
const EXPECTED = { generic: { status: { text: 'scheduled', diverted: false }, type: '' }, text: 'expected', icon: '', live: false };
const LIKELY = { generic: { status: { text: 'canceled_uncertain', diverted: false }, type: 'canceled_uncertain' }, text: 'canceleduncertain', icon: 'yellow', live: false };
const CANCELED = { generic: { status: { text: 'canceled', diverted: false }, type: 'canceled' }, text: 'canceled', icon: 'red', live: false };
const DIVERTED = { generic: { status: { text: 'landed', diverted: true }, type: '' }, text: 'diverted', icon: 'red', live: false };

/** A served board row, in the AeroDataBox normalizer's shape. */
function flight({ no = 'UA100', o = 'ORD', d = 'EWR', sd = null, sa = null, rd = null, ra = null, ed = null, ea = null, status = EXPECTED, reg = '', ac = '', cs, ts, source = {} } = {}) {
  return {
    identification: { number: { default: no }, callsign: cs ?? `UAL${no.slice(2)}` },
    status,
    time: { scheduled: { departure: sd, arrival: sa }, real: { departure: rd, arrival: ra }, estimated: { departure: ed, arrival: ea } },
    airport: { origin: { code: { iata: o } }, destination: { code: { iata: d } } },
    aircraft: { model: { code: ac, text: '' }, registration: reg },
    _source: {
      provider: 'aerodatabox',
      timeSource: ts ?? { hasGateDep: true, hasRunwayDep: true, hasGateArr: true, hasRunwayArr: true, gateDistinctDep: false, gateDistinctArr: false },
      ...source,
    },
  };
}

const depCtx = (observedAtSec = ORD_DAY + 20 * H) => ({ dir: 'departures', hub: 'ORD', observedAtSec });
const arrCtx = (hub = 'EWR', observedAtSec = EWR_DAY + 22 * H) => ({ dir: 'arrivals', hub, observedAtSec });
const observe = (f, ctx) => {
  const { row, reason } = observeFlight(f, ctx);
  if (!row) throw new Error(`no row: ${reason}`);
  return row;
};

describe('observeFlight — one board row, one candidate archive row', () => {
  it('keys a hub departure by the origin hub date, in epoch minutes, with the board-delay basis', () => {
    const row = observe(flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, rd: ORD_DAY + 8 * H + 900, ea: ORD_DAY + 10 * H + 600, status: DEPARTED, reg: 'N12345', ac: 'B39M', ts: { hasRunwayDep: true, gateDistinctDep: true } }), depCtx());
    expect(row).toMatchObject({
      flight_no: 'UA100', service_date: '2026-11-08', origin: 'ORD', dest: 'EWR',
      sched_dep: min(ORD_DAY + 8 * H), sched_arr: min(ORD_DAY + 10 * H),
      dep_at: min(ORD_DAY + 8 * H + 900), dep_basis: 'gate',
      arr_at: min(ORD_DAY + 10 * H + 600), arr_basis: 'estimate',
      status: 'departed', outcome: 'operated', final: false,
      registration: 'N12345', aircraft_code: 'B39M', operator: 'UAL',
      on_dep_board: true, on_arr_board: false, last_seen: min(ORD_DAY + 20 * H),
    });
    expect(Object.keys(row).sort()).toEqual([...FLIGHT_HISTORY_COLUMNS].sort());
  });

  it('labels a real time exactly as src/lib/board-delay.js does: runway when no distinct gate time, actual when no runway time', () => {
    const base = { sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, rd: ORD_DAY + 8 * H + 600, status: DEPARTED };
    expect(observe(flight({ ...base, ts: { hasRunwayDep: true, gateDistinctDep: false } }), depCtx()).dep_basis).toBe('runway');
    expect(observe(flight({ ...base, ts: { hasRunwayDep: false } }), depCtx()).dep_basis).toBe('actual');
    expect(observe(flight({ ...base, ts: { hasRunwayDep: true, gateDistinctDep: true } }), depCtx()).dep_basis).toBe('gate');
  });

  it('a late-evening departure keeps the service day of its schedule, not of its delayed actual', () => {
    const row = observe(flight({ sd: ORD_DAY + 23.5 * H, sa: ORD_DAY + 26 * H, rd: ORD_DAY + 24.5 * H, status: DEPARTED }), depCtx());
    expect(row.service_date).toBe('2026-11-08');
  });

  it('a leg from a non-hub airport is keyed by its destination hub board day (the arrival)', () => {
    // FSD→EWR: departs Nov 7 local, lands after midnight EWR → the Nov 8 arrivals board.
    const row = observe(flight({ no: 'UA4422', o: 'FSD', d: 'EWR', cs: 'GJS4422', sd: EWR_DAY - 2 * H, sa: EWR_DAY + 0.5 * H, rd: EWR_DAY - 2 * H + 300, ra: EWR_DAY + 0.4 * H, status: ARRIVED, ts: { hasRunwayArr: true, gateDistinctArr: true, hasRunwayDep: true, gateDistinctDep: true } }), arrCtx());
    expect(row.service_date).toBe('2026-11-08');
    expect(row).toMatchObject({ operator: 'GJS', dep_basis: 'gate', arr_basis: 'gate', outcome: 'operated', final: true });
  });

  it('keeps the provider schedule only when the provider sent it (a derived schedule is null)', () => {
    const row = observe(flight({ sd: ORD_DAY + 9 * H, sa: ORD_DAY + 11 * H, rd: ORD_DAY + 9 * H, status: DEPARTED, source: { scheduleTimeDerivedFromActual: { departure: true, arrival: false } } }), depCtx());
    expect(row.sched_dep).toBeNull();
    expect(row.sched_arr).toBe(min(ORD_DAY + 11 * H));
    expect(row.dep_at).toBe(min(ORD_DAY + 9 * H));
  });

  it('drops the side the board does not vouch for when the two sides are different instances', () => {
    // A 25-hour scheduled block on a departures board: the arrival belongs to another instance.
    const row = observe(flight({ sd: ORD_DAY + 11 * H, sa: ORD_DAY + 36 * H, ed: ORD_DAY + 11.2 * H, ea: ORD_DAY + 36 * H }), depCtx());
    expect(row.sched_arr).toBeNull();
    expect(row.arr_at).toBeNull();
    expect(row.dep_at).toBe(min(ORD_DAY + 11.2 * H));
  });

  it('drops a time implausibly far from its schedule (schedule-plausibility.js), never stores it', () => {
    const early = observe(flight({ sd: ORD_DAY + 15 * H, sa: ORD_DAY + 18 * H, rd: ORD_DAY + 10 * H, status: DEPARTED }), depCtx());
    expect(early.dep_at).toBeNull();
    const staleEstimate = observe(flight({ sd: ORD_DAY + 9 * H, sa: ORD_DAY + 12 * H, ed: ORD_DAY + 16 * H }), depCtx());
    expect(staleEstimate.dep_at).toBeNull();
  });

  it('refuses what cannot be a leg of this board', () => {
    expect(observeFlight(flight({ sd: ORD_DAY + 8 * H, source: { liveFeedFallback: true } }), depCtx()).reason).toBe('live_feed_row');
    expect(observeFlight(flight({ o: 'DEN', sd: ORD_DAY + 8 * H }), depCtx()).reason).toBe('off_board');
    expect(observeFlight(flight({ no: '', sd: ORD_DAY + 8 * H }), depCtx()).reason).toBe('no_ident');
    expect(observeFlight(flight({ o: 'ORD', d: '', sd: ORD_DAY + 8 * H }), depCtx()).reason).toBe('no_route');
    // A hub-to-hub leg on the arrivals board with no departure time at all cannot be keyed.
    expect(observeFlight(flight({ o: 'IAH', d: 'EWR', sa: EWR_DAY + 15 * H, ea: EWR_DAY + 15 * H }), arrCtx()).reason).toBe('no_key_time');
  });

  it('stores only provider-sent tails, never a live-feed backfill', () => {
    const f = flight({ sd: ORD_DAY + 8 * H, reg: 'N77777' });
    f.aircraft.regSource = 'live_feed';
    expect(observe(f, depCtx()).registration).toBeNull();
  });

  it('derives the outcome: confirmed vs unconfirmed cancellation, diverted, unknown', () => {
    expect(observe(flight({ sd: ORD_DAY + 8 * H, status: CANCELED }), depCtx())).toMatchObject({ outcome: 'canceled', final: true });
    expect(observe(flight({ sd: ORD_DAY + 8 * H, status: LIKELY }), depCtx())).toMatchObject({ outcome: 'canceled_unconfirmed', final: false, status: 'canceleduncertain' });
    expect(observe(flight({ sd: ORD_DAY + 8 * H, rd: ORD_DAY + 8 * H, status: DIVERTED }), depCtx())).toMatchObject({ outcome: 'diverted', final: true });
    expect(observe(flight({ sd: ORD_DAY + 8 * H }), depCtx())).toMatchObject({ outcome: 'unknown', final: false });
  });
});

describe('canceled_uncertain and the seen-airborne evidence (reg-overlay.js)', () => {
  const likely = () => flight({ no: 'UA5300', d: 'GRR', cs: 'SKW5300', sd: ORD_DAY + 14 * H, sa: ORD_DAY + 15 * H, status: LIKELY });
  const board = (f) => ({ dir: 'departures', hub: 'ORD', flights: [f] });
  const sighting = (airborneSec) => new Map([['UA5300', {
    reg: 'N101SY', origin: 'ORD', dest: 'GRR', seenAtMs: (ORD_DAY + 14.6 * H) * 1000, airborneAtMs: airborneSec ? airborneSec * 1000 : null,
  }]]);

  it('seen airborne on this leg → operated, the provider word kept, the fix stored', () => {
    const overlaid = applySightingsToBoard(board(likely()), sighting(ORD_DAY + 14.3 * H), NOW.getTime(), { dir: 'departures' });
    const [row] = archiveRowsFromBoard(overlaid, depCtx()).rows;
    expect(row).toMatchObject({ outcome: 'operated', status: 'canceleduncertain', airborne_at: min(ORD_DAY + 14.3 * H), final: false });
  });

  it('seen only on the ground → still canceled_unconfirmed', () => {
    const overlaid = applySightingsToBoard(board(likely()), sighting(null), NOW.getTime(), { dir: 'departures' });
    const [row] = archiveRowsFromBoard(overlaid, depCtx()).rows;
    expect(row).toMatchObject({ outcome: 'canceled_unconfirmed', airborne_at: null });
  });

  it('a later board that lost the evidence (cold overlay) cannot un-fly it', () => {
    const flown = archiveRowsFromBoard(applySightingsToBoard(board(likely()), sighting(ORD_DAY + 14.3 * H), NOW.getTime(), { dir: 'departures' }), depCtx()).rows[0];
    const later = observe(likely(), depCtx(ORD_DAY + 22 * H));
    const merged = mergeFlightHistoryRow(flown, later);
    expect(merged).toMatchObject({ outcome: 'operated', airborne_at: min(ORD_DAY + 14.3 * H), last_seen: min(ORD_DAY + 22 * H) });
  });
});

describe('mergeFlightHistoryRow — two boards, one leg, forward only', () => {
  const depBoardRow = () => observe(flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, rd: ORD_DAY + 8 * H + 900, ea: ORD_DAY + 10 * H + 600, status: DEPARTED, reg: 'N12345', ts: { hasRunwayDep: true, gateDistinctDep: true } }), depCtx(ORD_DAY + 9 * H));
  const arrBoardRow = () => observe(flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, rd: ORD_DAY + 8 * H + 960, ra: ORD_DAY + 10 * H + 1200, status: ARRIVED, reg: 'N12345', ts: { hasRunwayDep: true, gateDistinctDep: false, hasRunwayArr: true, gateDistinctArr: true } }), arrCtx('EWR', ORD_DAY + 11 * H));

  it('the departures board and the arrivals board make ONE row with both actuals', () => {
    const a = depBoardRow();
    const b = arrBoardRow();
    expect(flightHistoryKey(a)).toBe(flightHistoryKey(b));
    const merged = mergeFlightHistoryRow(mergeFlightHistoryRow(null, a), b);
    expect(merged).toMatchObject({
      dep_at: min(ORD_DAY + 8 * H + 900), dep_basis: 'gate', // the gate time beats the arrivals board's runway copy
      arr_at: min(ORD_DAY + 10 * H + 1200), arr_basis: 'gate',
      status: 'arrived', outcome: 'operated', final: true,
      on_dep_board: true, on_arr_board: true, last_seen: min(ORD_DAY + 11 * H),
    });
  });

  it('is order-independent: the same two observations in reverse give the same row', () => {
    const ab = mergeFlightHistoryRow(mergeFlightHistoryRow(null, depBoardRow()), arrBoardRow());
    const ba = mergeFlightHistoryRow(mergeFlightHistoryRow(null, arrBoardRow()), depBoardRow());
    expect(sameFlightHistoryRow(ab, ba)).toBe(true);
  });

  it('never regresses: a newer board with only an estimate, no tail and a tentative status changes nothing', () => {
    const settled = mergeFlightHistoryRow(mergeFlightHistoryRow(null, depBoardRow()), arrBoardRow());
    const stale = observe(flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, ed: ORD_DAY + 9 * H, ea: ORD_DAY + 11 * H, status: ENROUTE }), arrCtx('EWR', ORD_DAY + 12 * H));
    const merged = mergeFlightHistoryRow(settled, stale);
    expect(merged).toMatchObject({
      dep_at: settled.dep_at, dep_basis: 'gate', arr_at: settled.arr_at, arr_basis: 'gate',
      status: 'arrived', outcome: 'operated', final: true, registration: 'N12345',
    });
    expect(merged.last_seen).toBe(min(ORD_DAY + 12 * H));
  });

  it('a real time is never replaced by null or an estimate; an estimate gives way to a real time', () => {
    const est = observe(flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, ed: ORD_DAY + 8.5 * H }), depCtx(ORD_DAY + 6 * H));
    const real = observe(flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, rd: ORD_DAY + 8.6 * H, status: DEPARTED }), depCtx(ORD_DAY + 9 * H));
    const nothing = observe(flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H }), depCtx(ORD_DAY + 10 * H));
    const r1 = mergeFlightHistoryRow(est, real);
    expect(r1).toMatchObject({ dep_at: min(ORD_DAY + 8.6 * H), dep_basis: 'runway' });
    const r2 = mergeFlightHistoryRow(r1, nothing);
    expect(r2).toMatchObject({ dep_at: min(ORD_DAY + 8.6 * H), dep_basis: 'runway', status: 'departed' });
    const newerEstimate = observe(flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, ed: ORD_DAY + 9.5 * H }), depCtx(ORD_DAY + 11 * H));
    expect(mergeFlightHistoryRow(r2, newerEstimate).dep_at).toBe(min(ORD_DAY + 8.6 * H));
  });

  it('keeps the EARLIEST provider schedule (a re-timed copy would hide the delay)', () => {
    const original = observe(flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H }), depCtx(ORD_DAY + 1 * H));
    const retimed = observe(flight({ sd: ORD_DAY + 9 * H, sa: ORD_DAY + 11 * H, rd: ORD_DAY + 9 * H, status: DEPARTED }), depCtx(ORD_DAY + 10 * H));
    const merged = mergeFlightHistoryRow(original, retimed);
    expect(merged.sched_dep).toBe(min(ORD_DAY + 8 * H));
    expect(merged.dep_at - merged.sched_dep).toBe(60); // the hour the re-timing would have erased
  });

  it('an older observation (a degraded fallback board) cannot overwrite newer same-strength facts', () => {
    const newer = observe(flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, ed: ORD_DAY + 8.4 * H, reg: 'N11111' }), depCtx(ORD_DAY + 7 * H));
    const older = observe(flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, ed: ORD_DAY + 8.1 * H, reg: 'N22222' }), depCtx(ORD_DAY + 5 * H));
    const merged = mergeFlightHistoryRow(newer, older);
    expect(merged).toMatchObject({ dep_at: min(ORD_DAY + 8.4 * H), registration: 'N11111', last_seen: min(ORD_DAY + 7 * H) });
  });

  it('a confirmed cancellation the flight later shows it flew becomes operated (facts beat words)', () => {
    const cancel = observe(flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, status: CANCELED }), depCtx(ORD_DAY + 6 * H));
    const flew = observe(flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, rd: ORD_DAY + 9 * H, status: DEPARTED }), depCtx(ORD_DAY + 10 * H));
    const merged = mergeFlightHistoryRow(cancel, flew);
    expect(merged).toMatchObject({ outcome: 'operated', status: 'canceled', final: false });
    // …and the reverse order says the same.
    expect(mergeFlightHistoryRow(flew, cancel).outcome).toBe('operated');
  });

  it('does not mutate its inputs', () => {
    const a = depBoardRow();
    const b = arrBoardRow();
    const before = JSON.stringify([a, b]);
    mergeFlightHistoryRow(a, b);
    expect(JSON.stringify([a, b])).toBe(before);
  });
});

describe('archiveRowsFromBoard — duplicates on one board are one leg', () => {
  it('keeps the copy with the best evidence (board-dedupe.js order) and counts the rest', () => {
    const real = flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, rd: ORD_DAY + 12 * H, status: DEPARTED, reg: 'N47298', ts: { hasRunwayDep: true, gateDistinctDep: true } });
    const retimedCopy = flight({ sd: ORD_DAY + 12.5 * H, sa: ORD_DAY + 14.5 * H, rd: ORD_DAY + 12.5 * H, status: DEPARTED, reg: 'N47299' });
    const ghost = flight({ sd: ORD_DAY + 8 * H, sa: ORD_DAY + 10 * H, ed: ORD_DAY + 8 * H });
    const { rows, duplicates } = archiveRowsFromBoard({ flights: [ghost, retimedCopy, real] }, depCtx());
    expect(rows).toHaveLength(1);
    expect(duplicates).toBe(2);
    expect(rows[0]).toMatchObject({ dep_basis: 'gate', dep_at: min(ORD_DAY + 12 * H), sched_dep: min(ORD_DAY + 8 * H), registration: 'N47298' });
  });

  it('the same number on two routes, or on two days, is two legs', () => {
    const { rows } = archiveRowsFromBoard({ flights: [
      flight({ no: 'UA123', d: 'SFO', sd: ORD_DAY + 8 * H }),
      flight({ no: 'UA123', d: 'LAX', sd: ORD_DAY + 18 * H }),
    ] }, depCtx());
    expect(rows.map(flightHistoryKey).sort()).toEqual(['UA123|2026-11-08|ORD|LAX', 'UA123|2026-11-08|ORD|SFO']);
    const nextDay = observe(flight({ no: 'UA123', d: 'SFO', sd: ORD_DAY + 32 * H }), depCtx());
    expect(nextDay.service_date).toBe('2026-11-09');
  });

  it('counts skipped rows by reason', () => {
    const { rows, skipped } = archiveRowsFromBoard({ flights: [
      flight({ sd: ORD_DAY + 8 * H }),
      flight({ no: 'UA9', sd: ORD_DAY + 8 * H, source: { liveFeedFallback: true } }),
      flight({ no: 'UA10', o: 'DEN', sd: ORD_DAY + 8 * H }),
    ] }, depCtx());
    expect(rows).toHaveLength(1);
    expect(skipped).toEqual({ live_feed_row: 1, off_board: 1 });
  });
});

describe('finality and ranks', () => {
  it('final: settled outcomes, a real arrival, or a real departure to a non-hub', () => {
    expect(isFinalRow({ outcome: 'canceled', dest: 'EWR' })).toBe(true);
    expect(isFinalRow({ outcome: 'diverted', dest: 'EWR' })).toBe(true);
    expect(isFinalRow({ outcome: 'operated', dep_basis: 'gate', arr_basis: null, dest: 'EWR' })).toBe(false); // EWR's board may still report it
    expect(isFinalRow({ outcome: 'operated', dep_basis: 'gate', arr_basis: null, dest: 'MSP' })).toBe(true);
    expect(isFinalRow({ outcome: 'operated', dep_basis: 'estimate', arr_basis: 'runway', dest: 'EWR' })).toBe(true);
    expect(isFinalRow({ outcome: 'operated', dep_basis: 'estimate', arr_basis: 'estimate', dest: 'MSP' })).toBe(false);
    expect(isFinalRow({ outcome: 'canceled_unconfirmed', dest: 'MSP' })).toBe(false);
  });

  it('status words rank settled > moving > the rest, whatever their spelling', () => {
    expect(statusRank('arrived')).toBe(2);
    expect(statusRank('Canceled')).toBe(2);
    expect(statusRank('en route')).toBe(1);
    expect(statusRank('enroute')).toBe(1);
    expect(statusRank('canceleduncertain')).toBe(0);
    expect(statusRank('expected')).toBe(0);
  });

  it('localDate agrees with Postgres `(to_timestamp(s) at time zone tz)::date` at the day edges', () => {
    expect(localDate('America/Chicago', ORD_DAY)).toBe('2026-11-08');
    expect(localDate('America/Chicago', ORD_DAY - 1)).toBe('2026-11-07');
    expect(localDate('Asia/Tokyo', Date.parse('2026-11-08T14:59:59Z') / 1000)).toBe('2026-11-08');
    expect(localDate('Asia/Tokyo', Date.parse('2026-11-08T15:00:00Z') / 1000)).toBe('2026-11-09');
  });
});

describe('the SQL backfill repeats these rules (drift guard)', () => {
  const backfill = readFileSync(new URL('../sql/021_flight_history_backfill.sql', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../sql/021_flight_history.sql', import.meta.url), 'utf8');

  it('maps every hub to the same time zone', () => {
    for (const [hub, tz] of Object.entries(HUB_TZ)) expect(backfill).toContain(`when '${hub}' then '${tz}'`);
  });

  it('ranks bases and outcomes the same way', () => {
    for (const [basis, rank] of Object.entries(BASIS_RANK)) expect(backfill).toMatch(new RegExp(`when '${basis}' then ${rank}`));
    for (const [outcome, rank] of Object.entries(OUTCOME_RANK)) {
      if (rank > 0) expect(backfill).toMatch(new RegExp(`when '${outcome}' then ${rank}`));
    }
  });

  it('writes every column the writer writes, and the table has exactly those columns', () => {
    for (const col of FLIGHT_HISTORY_COLUMNS) {
      expect(backfill).toContain(col);
      expect(migration).toMatch(new RegExp(`^\\s+${col}\\s`, 'm'));
    }
  });
});
