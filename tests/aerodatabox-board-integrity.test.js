// Board integrity at the AeroDataBox source (audit Sep 26 2026, v1.8.3):
//   F4   earlier-day rows with +10h..+54h "delays" on today's boards, counted as Late
//   F103 a Saturday board carrying Friday 23:59 departures
//   F90  partner-operated codeshares (ANA/Air Canada/Lufthansa/Copa metal) counted as United
//   F100 an upstream row coded "G7 60" whose callsign says it is UAL60
//   F79  429 retries that fire in lockstep across instances and give up after 3 attempts
//
// Every fixture below is a row shape observed on the live board (theblueboard.co/api/schedule,
// Sep 26 2026) translated back into the raw FIDS item AeroDataBox returns.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { fetchViaAeroDataBox, adbRetryDelayMs, __resetScheduleWarnsForTests } from '../api/_schedule-aerodatabox.js';
import { __resetAdbSpendForTests } from '../api/_cost-state.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';

const H = 3600;
// Sat Sep 26 2026, 00:00 CDT — the ORD board the audit screenshotted (timestamp=1790398800).
const ORD_DAY = getStartOfHubDay('ORD', 0, new Date('2026-09-26T12:00:00Z'));
const SFO_DAY = getStartOfHubDay('SFO', 0, new Date('2026-09-26T12:00:00Z'));
const NRT_DAY = getStartOfHubDay('NRT', 0, new Date('2026-09-26T12:00:00Z'));
const iso = (sec) => new Date(sec * 1000).toISOString();
const t = (sec) => (sec == null ? undefined : { utc: iso(sec) });

function leg(airport, { sched, revised, runway } = {}) {
  const out = { airport: { iata: airport } };
  if (sched != null) out.scheduledTime = t(sched);
  if (revised != null) out.revisedTime = t(revised);
  if (runway != null) out.runwayTime = t(runway);
  return out;
}

function raw({ number, callSign = '', status = 'Expected', codeshareStatus = 'IsOperator', airline = { iata: 'UA', icao: 'UAL', name: 'United' }, dep, arr, model = 'Boeing 737-800', reg = '' }) {
  return { number, callSign, status, codeshareStatus, isCargo: false, airline, departure: dep, arrival: arr, aircraft: { model, reg } };
}

function mockBoard(dir, items) {
  const key = dir === 'departures' ? 'departures' : 'arrivals';
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (!String(url).includes('aedbx/aerodatabox')) {
      return { ok: false, status: 403, text: async () => 'blocked', headers: { get: () => null } };
    }
    // Both FIDS windows answer with the same items: the adapter's exact-key dedupe collapses the
    // repeat, exactly as it does for the rows AeroDataBox returns in both halves of the day.
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ [key]: items }) };
  });
}

const idents = (board) => board.flights.map((f) => f.identification.number.default).sort();

beforeEach(() => {
  vi.restoreAllMocks();
  __resetAdbSpendForTests();
  __resetScheduleWarnsForTests();
  process.env.AERODATABOX_API_KEY = 'adb-test-key';
  process.env.AERODATABOX_INTER_WINDOW_DELAY_MS = '0';
  process.env.AERODATABOX_RETRY_BASE_MS = '0';
  process.env.AERODATABOX_DAILY_UNIT_BUDGET = '100000';
});

afterEach(() => {
  delete process.env.AERODATABOX_API_KEY;
  delete process.env.AERODATABOX_INTER_WINDOW_DELAY_MS;
  delete process.env.AERODATABOX_RETRY_BASE_MS;
  delete process.env.AERODATABOX_DAILY_UNIT_BUDGET;
  __resetAdbSpendForTests();
  vi.restoreAllMocks();
});

describe('F4/F103: only the hub day, with instance-consistent times', () => {
  // UA1677 MSY→ORD: scheduled Sep 25 13:15 CDT, never updated, estimate parked at 00:02 —
  // rendered as "+10h47m Landed* presumed" at the top of Saturday's board.
  const ghost = raw({
    number: 'UA 1677', callSign: 'UAL1677',
    dep: leg('MSY', { sched: ORD_DAY - 13.5 * H, revised: ORD_DAY - 13.4 * H }),
    arr: leg('ORD', { sched: ORD_DAY - 10.8 * H, revised: ORD_DAY + 120 }),
  });
  // UA5375 MSY→ORD: scheduled arrival (yesterday 20:30) EARLIER than its scheduled departure
  // (today 17:36) — two instances in one row. The real legs are today's and consistent.
  const crossInstance = raw({
    number: 'UA 5375', callSign: 'UAL5375', status: 'Arrived',
    dep: leg('MSY', { sched: ORD_DAY + 17.6 * H, revised: ORD_DAY + 17.6 * H }),
    arr: leg('ORD', { sched: ORD_DAY - 3.5 * H, revised: ORD_DAY + 19.9 * H }),
  });
  // UA2113 LAX→ORD: departed on time two days ago, "arrived" today → "Arrived +54h20m".
  // v1.8.3 read this as a real arrival and kept it with a derived schedule. It is not: no LAX→ORD
  // leg blocks for 58 hours. It is an old leg whose ARRIVAL AeroDataBox shifted onto today, the
  // same shape that put a "29h" UA2113 on the Oct 3 board (v1.11.3), so it is now dropped.
  const twoDaysLate = raw({
    number: 'UA 2113', callSign: 'UAL2113', status: 'Arrived',
    dep: leg('LAX', { sched: ORD_DAY - 35.3 * H, revised: ORD_DAY - 35.2 * H }),
    arr: leg('ORD', { sched: ORD_DAY - 31.8 * H, revised: ORD_DAY + 22.6 * H }),
  });
  // A genuinely 2h-late arrival inside the day must keep its baseline and its delay.
  const realLate = raw({
    number: 'UA 500', callSign: 'UAL500', status: 'Arrived',
    dep: leg('DEN', { sched: ORD_DAY + 8 * H, revised: ORD_DAY + 10 * H }),
    arr: leg('ORD', { sched: ORD_DAY + 10.5 * H, revised: ORD_DAY + 12.5 * H }),
  });
  // Tomorrow's first arrival leaks into the second window — not this board's day either.
  const tomorrow = raw({
    number: 'UA 1', callSign: 'UAL1',
    dep: leg('SFO', { sched: ORD_DAY + 21 * H }),
    arr: leg('ORD', { sched: ORD_DAY + 25 * H }),
  });

  it('drops a stale-estimate ghost from the previous day', async () => {
    mockBoard('arrivals', [ghost, realLate]);
    const board = await fetchViaAeroDataBox('ORD', 'arrivals', ORD_DAY, 8000);
    expect(idents(board)).toEqual(['UA500']);
    expect(board.meta.filtered.offDay).toBe(1);
  });

  it('keeps a real in-day late arrival with its original baseline', async () => {
    mockBoard('arrivals', [realLate]);
    const board = await fetchViaAeroDataBox('ORD', 'arrivals', ORD_DAY, 8000);
    const f = board.flights[0];
    expect(f.time.scheduled.arrival).toBe(ORD_DAY + 10.5 * H);
    expect(f.time.real.arrival).toBe(ORD_DAY + 12.5 * H);
    expect(f._source.scheduleTimeDerivedFromActual).toBeUndefined();
  });

  it('repairs a row whose scheduled arrival belongs to another instance instead of reporting a delay', async () => {
    mockBoard('arrivals', [crossInstance]);
    const board = await fetchViaAeroDataBox('ORD', 'arrivals', ORD_DAY, 8000);
    expect(idents(board)).toEqual(['UA5375']);
    const f = board.flights[0];
    // The board-side scheduled time now comes from today's real arrival and says so, so the
    // row renders "Arrived hh:mm (actual)" with no delta and stays out of on-time/late.
    expect(f.time.scheduled.arrival).toBe(f.time.real.arrival);
    expect(f._source.scheduleTimeDerivedFromActual.arrival).toBe(true);
    expect(f.time.scheduled.arrival - f.time.scheduled.departure).toBeGreaterThan(0);
    // The departure side was consistent (real ≈ scheduled) and is kept.
    expect(f.time.scheduled.departure).toBe(ORD_DAY + 17.6 * H);
    expect(board.meta.filtered.repaired).toBe(1);
  });

  it('drops a leg whose real departure and arrival are further apart than any flight (v1.11.3)', async () => {
    mockBoard('arrivals', [crossInstance, twoDaysLate]);
    const board = await fetchViaAeroDataBox('ORD', 'arrivals', ORD_DAY, 8000);
    // The repair would have pulled it into today; the block-time check is what stops it.
    expect(idents(board)).toEqual(['UA5375']);
    expect(board.meta.filtered.staleLegs).toBe(1);
    expect(board.meta.filtered.offDay).toBe(0);
  });

  it('clips rows scheduled on the next hub day', async () => {
    mockBoard('arrivals', [tomorrow, realLate]);
    const board = await fetchViaAeroDataBox('ORD', 'arrivals', ORD_DAY, 8000);
    expect(idents(board)).toEqual(['UA500']);
  });

  it("drops the previous day's 23:59 departure that pushed back after midnight (F103)", async () => {
    // UA2080 SFO→RDU: scheduled 23:59 Sep 25, departed 00:01 Sep 26 — counted in Saturday's 291.
    const lateNight = raw({
      number: 'UA 2080', callSign: 'UAL2080', status: 'Departed',
      dep: leg('SFO', { sched: SFO_DAY - 60, revised: SFO_DAY + 120 }),
      arr: leg('RDU', { sched: SFO_DAY + 5.3 * H }),
    });
    const inDay = raw({
      number: 'UA 2081', callSign: 'UAL2081',
      dep: leg('SFO', { sched: SFO_DAY + 60 }),
      arr: leg('RDU', { sched: SFO_DAY + 5.4 * H }),
    });
    mockBoard('departures', [lateNight, inDay]);
    const board = await fetchViaAeroDataBox('SFO', 'departures', SFO_DAY, 8000);
    expect(idents(board)).toEqual(['UA2081']);
  });

  it('snaps an intra-day timestamp to the hub day before clipping', async () => {
    mockBoard('arrivals', [realLate, ghost]);
    const board = await fetchViaAeroDataBox('ORD', 'arrivals', ORD_DAY + 15 * H, 8000);
    expect(idents(board)).toEqual(['UA500']);
  });
});

describe('v1.11.3: an actual time cannot be in the future (ORD, Oct 3 2026)', () => {
  // The prod boards read at 17:55Z carried 13 rows with time.real.* later than the clock. These
  // are those rows translated back into raw FIDS items. Only Date is faked: fetchWindow's abort
  // timer has to stay real.
  const DAY = getStartOfHubDay('ORD', 0, new Date('2026-10-03T12:00:00Z'));
  const at = (isoUtc) => Date.parse(isoUtc) / 1000;
  const setNow = (isoUtc) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(isoUtc));
  };
  afterEach(() => vi.useRealTimers());

  // Yesterday's UA2113 LAX→ORD (off 17:58Z Oct 2) with its arrival shifted onto Oct 3 22:55Z.
  const shiftedUa2113 = raw({
    number: 'UA 2113', callSign: 'UAL1941', status: 'Arrived', model: 'Boeing 757-300', reg: 'N57862',
    dep: leg('LAX', { sched: at('2026-10-02T17:44:00Z'), revised: at('2026-10-02T17:58:00Z'), runway: at('2026-10-02T18:10:00Z') }),
    arr: leg('ORD', { sched: at('2026-10-02T22:03:00Z'), revised: at('2026-10-03T22:55:00Z'), runway: at('2026-10-03T22:45:00Z') }),
  });
  // Today's UA2113, not yet departed — the row that must survive.
  const todayUa2113 = raw({
    number: 'UA 2113', callSign: 'UAL2113', status: 'Expected', reg: 'N37506',
    dep: leg('LAX', { sched: at('2026-10-03T17:44:00Z'), revised: at('2026-10-03T17:44:00Z') }),
    arr: leg('ORD', { sched: at('2026-10-03T22:03:00Z') }),
  });
  // UA845 ORD→GRU flagged Departed at its 9:30 PM CDT departure, 9.5 hours early.
  const ua845 = raw({
    number: 'UA 845', callSign: 'UAL845', status: 'Departed', model: 'Boeing 787-10', reg: 'N14001',
    dep: leg('ORD', { sched: at('2026-10-04T02:30:00Z'), revised: at('2026-10-04T02:30:00Z') }),
    arr: leg('GRU', { sched: at('2026-10-04T12:35:00Z') }),
  });
  // UA4422 FSD→ORD flagged Arrived with a gate time 8 minutes ahead of the clock.
  const ua4422 = raw({
    number: 'UA 4422', callSign: 'GJS4422', status: 'Arrived', model: 'Canadair CRJ', reg: 'N569GJ',
    dep: leg('FSD', { sched: at('2026-10-03T16:15:00Z'), revised: at('2026-10-03T16:08:00Z'), runway: at('2026-10-03T16:20:00Z') }),
    arr: leg('ORD', { sched: at('2026-10-03T18:12:00Z'), revised: at('2026-10-03T18:03:00Z'), runway: at('2026-10-03T17:56:00Z') }),
  });
  const noFutureActual = (board, nowSec) =>
    board.flights.every((f) => !Object.values(f.time.real).some((t) => t && t > nowSec + 300));
  const rowsOf = (board, id) => board.flights.filter((f) => f.identification.number.default === id);

  it("keeps yesterday's date-shifted UA2113 off today's arrivals at 17:55Z, and today's UA2113 on", async () => {
    setNow('2026-10-03T17:55:14Z');
    mockBoard('arrivals', [shiftedUa2113, todayUa2113]);
    const board = await fetchViaAeroDataBox('ORD', 'arrivals', DAY, 8000);
    const ua2113 = rowsOf(board, 'UA2113');
    expect(ua2113).toHaveLength(1);
    expect(ua2113[0].status.text).toBe('expected');
    expect(ua2113[0].time.scheduled.departure).toBe(at('2026-10-03T17:44:00Z'));
    expect(noFutureActual(board, at('2026-10-03T17:55:14Z'))).toBe(true);
    // Its own scheduled arrival (Oct 2) is what puts it off-day once the bogus actual is gone.
    expect(board.meta.filtered.offDay).toBe(1);
    expect(board.meta.filtered.repaired).toBe(0);
  });

  it('drops the same shifted leg after 22:55Z, when its "arrival" is no longer in the future', async () => {
    setNow('2026-10-03T23:30:00Z');
    mockBoard('arrivals', [shiftedUa2113, todayUa2113]);
    const board = await fetchViaAeroDataBox('ORD', 'arrivals', DAY, 8000);
    expect(rowsOf(board, 'UA2113')).toHaveLength(1);
    expect(rowsOf(board, 'UA2113')[0].identification.callsign).toBe('UAL2113');
    expect(board.meta.filtered.staleLegs).toBe(1);
  });

  it('UA845 is Expected tonight, not Departed', async () => {
    setNow('2026-10-03T17:55:14Z');
    mockBoard('departures', [ua845]);
    const board = await fetchViaAeroDataBox('ORD', 'departures', DAY, 8000);
    const [f] = rowsOf(board, 'UA845');
    expect(f.time.real.departure).toBeNull();
    expect(f.time.estimated.departure).toBe(at('2026-10-04T02:30:00Z'));
    expect(f.status.generic.status.text).toBe('scheduled');
    expect(f.status.live).toBe(false);
    expect(f._source.futureActualCleared).toEqual({ departure: true, arrival: false });
  });

  it('UA4422 is en route until its arrival time has actually passed', async () => {
    setNow('2026-10-03T17:55:14Z');
    mockBoard('arrivals', [ua4422]);
    const early = await fetchViaAeroDataBox('ORD', 'arrivals', DAY, 8000);
    const [f] = rowsOf(early, 'UA4422');
    expect(f.time.real.arrival).toBeNull();
    expect(f.time.real.departure).toBe(at('2026-10-03T16:08:00Z'));
    expect(f.time.estimated.arrival).toBe(at('2026-10-03T18:03:00Z'));
    expect(f.status.generic.status.text).toBe('en-route');

    vi.restoreAllMocks();
    vi.setSystemTime(new Date('2026-10-03T18:10:00Z'));
    mockBoard('arrivals', [ua4422]);
    const later = await fetchViaAeroDataBox('ORD', 'arrivals', DAY, 8000);
    expect(rowsOf(later, 'UA4422')[0].time.real.arrival).toBe(at('2026-10-03T18:03:00Z'));
    expect(rowsOf(later, 'UA4422')[0].status.generic.status.text).toBe('landed');
  });
});

describe('F90: partner-operated codeshares are not United flights', () => {
  const nrtDep = (number, dest, schedOffsetH, extra = {}) =>
    raw({
      number,
      codeshareStatus: 'IsCodeshared',
      dep: leg('NRT', { sched: NRT_DAY + schedOffsetH * H }),
      arr: leg(dest, { sched: NRT_DAY + (schedOffsetH + 7) * H }),
      model: 'Boeing 787-9',
      ...extra,
    });

  it('drops a codeshare whose operator twin is a partner carrier (UA8010 on the ANA A380)', async () => {
    const ua8010 = nrtDep('UA 8010', 'HNL', 20, { model: 'Airbus A380-800' });
    const anaTwin = raw({
      number: 'NH 184', callSign: 'ANA184', codeshareStatus: 'IsOperator',
      airline: { iata: 'NH', icao: 'ANA', name: 'ANA' },
      dep: leg('NRT', { sched: NRT_DAY + 20 * H }), arr: leg('HNL', { sched: NRT_DAY + 27 * H }),
      model: 'Airbus A380-800', reg: 'JA381A',
    });
    const ua837 = raw({
      number: 'UA 837', callSign: 'UAL837', codeshareStatus: 'IsOperator',
      dep: leg('NRT', { sched: NRT_DAY + 17 * H }), arr: leg('SFO', { sched: NRT_DAY + 26 * H }),
      model: 'Boeing 777-300ER',
    });
    mockBoard('departures', [ua8010, anaTwin, ua837]);
    const board = await fetchViaAeroDataBox('NRT', 'departures', NRT_DAY, 8000);
    expect(idents(board)).toEqual(['UA837']);
    expect(board.total).toBe(1);
    expect(board.meta.filtered.partnerCodeshares).toBe(1);
  });

  it('drops a codeshare flown under a partner callsign even with no twin in the window', async () => {
    // UA7914 SFO→HND callsign ANA107; UA7132 SFO→PTY callsign CMP383 (Copa HP-9929).
    const ua7914 = raw({
      number: 'UA 7914', callSign: 'ANA107', codeshareStatus: 'IsCodeshared',
      dep: leg('SFO', { sched: SFO_DAY + 11 * H }), arr: leg('HND', { sched: SFO_DAY + 22 * H }),
    });
    const ua7132 = raw({
      number: 'UA 7132', callSign: 'CMP383', codeshareStatus: 'IsCodeshared', reg: 'HP-9929',
      dep: leg('SFO', { sched: SFO_DAY + 9 * H }), arr: leg('PTY', { sched: SFO_DAY + 17 * H }),
    });
    mockBoard('departures', [ua7914, ua7132]);
    const board = await fetchViaAeroDataBox('SFO', 'departures', SFO_DAY, 8000);
    expect(board.flights).toEqual([]);
    expect(board.meta.filtered.partnerCodeshares).toBe(2);
  });

  it('keeps United Express codeshare rows — by callsign, by operator twin, or when nothing says otherwise', async () => {
    const skw = raw({
      number: 'UA 5601', callSign: 'SKW5601', codeshareStatus: 'IsCodeshared',
      dep: leg('SFO', { sched: SFO_DAY + 8 * H }), arr: leg('ACV', { sched: SFO_DAY + 9 * H }), model: 'Embraer 175',
    });
    const zwTwinned = raw({
      number: 'UA 5043', codeshareStatus: 'IsCodeshared',
      dep: leg('SFO', { sched: SFO_DAY + 10 * H }), arr: leg('EUG', { sched: SFO_DAY + 11.5 * H }), model: 'Bombardier CRJ',
    });
    const zwOperator = raw({
      number: 'ZW 5043', callSign: 'AWI5043', codeshareStatus: 'IsOperator',
      airline: { iata: 'ZW', icao: 'AWI', name: 'Air Wisconsin' },
      dep: leg('SFO', { sched: SFO_DAY + 10 * H }), arr: leg('EUG', { sched: SFO_DAY + 11.5 * H }),
    });
    // No callsign and no operator twin (the empty-callsign UA4xxx/5xxx Express rows on the ORD
    // board): there is no evidence it is a partner, so it stays.
    const unknown = raw({
      number: 'UA 4646', codeshareStatus: 'IsCodeshared',
      dep: leg('SFO', { sched: SFO_DAY + 12 * H }), arr: leg('CAK', { sched: SFO_DAY + 16 * H }),
    });
    mockBoard('departures', [skw, zwTwinned, zwOperator, unknown]);
    const board = await fetchViaAeroDataBox('SFO', 'departures', SFO_DAY, 8000);
    expect(idents(board)).toEqual(['UA4646', 'UA5043', 'UA5601']);
    expect(board.meta.filtered.partnerCodeshares).toBe(0);
  });

  it('trusts a partner callsign even when the row is not flagged IsCodeshared', async () => {
    const unflagged = raw({
      number: 'UA 8828', callSign: 'DLH455', codeshareStatus: 'Unknown', reg: 'D-ABYS',
      dep: leg('SFO', { sched: SFO_DAY + 15 * H }), arr: leg('FRA', { sched: SFO_DAY + 26 * H }),
      model: 'Boeing 747-8',
    });
    const ual = raw({
      number: 'UA 1', callSign: 'UAL1', codeshareStatus: 'Unknown',
      dep: leg('SFO', { sched: SFO_DAY + 8 * H }), arr: leg('SIN', { sched: SFO_DAY + 25 * H }),
    });
    mockBoard('departures', [unflagged, ual]);
    const board = await fetchViaAeroDataBox('SFO', 'departures', SFO_DAY, 8000);
    expect(idents(board)).toEqual(['UA1']);
    expect(board.meta.filtered.partnerCodeshares).toBe(1);
  });

  it('does not filter on the UA7xxx/8xxx number range', async () => {
    const operatedHigh = raw({
      number: 'UA 6613', callSign: 'UAL6613', codeshareStatus: 'IsOperator',
      dep: leg('SFO', { sched: SFO_DAY + 9 * H }), arr: leg('YYZ', { sched: SFO_DAY + 14 * H }),
    });
    mockBoard('departures', [operatedHigh]);
    const board = await fetchViaAeroDataBox('SFO', 'departures', SFO_DAY, 8000);
    expect(idents(board)).toEqual(['UA6613']);
  });
});

describe('F100: a UAL callsign outranks an Express-coded flight number', () => {
  it("rewrites 'G7 60' flown as UAL60 to UA60 and names the airline United", async () => {
    const g760 = raw({
      number: 'G7 60', callSign: 'UAL60', airline: { iata: 'G7', icao: 'GJS', name: 'GoJet' },
      dep: leg('SFO', { sched: SFO_DAY + 22.5 * H }), arr: leg('MEL', { sched: SFO_DAY + 38 * H }),
      model: 'Boeing 787-9', reg: 'N38950',
    });
    mockBoard('departures', [g760]);
    const board = await fetchViaAeroDataBox('SFO', 'departures', SFO_DAY, 8000);
    expect(idents(board)).toEqual(['UA60']);
    expect(board.flights[0].airline.name).toBe('United Airlines');
  });

  it('leaves a real GoJet-flown Express row on its own ident', async () => {
    const gjs = raw({
      number: 'G7 4321', callSign: 'GJS4321',
      dep: leg('SFO', { sched: SFO_DAY + 9 * H }), arr: leg('BOI', { sched: SFO_DAY + 11 * H }),
    });
    mockBoard('departures', [gjs]);
    const board = await fetchViaAeroDataBox('SFO', 'departures', SFO_DAY, 8000);
    expect(idents(board)).toEqual(['G74321']);
  });

  it('still collapses a rewritten operator clone into its UA twin instead of doubling it', async () => {
    const ua929 = raw({
      number: 'UA 929', callSign: 'UAL929',
      dep: leg('SFO', { sched: SFO_DAY + 16 * H }), arr: leg('LHR', { sched: SFO_DAY + 26 * H }),
    });
    const g7929 = raw({
      number: 'G7 929', callSign: 'UAL929',
      dep: leg('SFO', { sched: SFO_DAY + 16 * H + 60 }), arr: leg('LHR', { sched: SFO_DAY + 26 * H }),
    });
    mockBoard('departures', [ua929, g7929]);
    const board = await fetchViaAeroDataBox('SFO', 'departures', SFO_DAY, 8000);
    expect(idents(board)).toEqual(['UA929']);
    expect(board.meta.dedupe.operatorClones).toBe(1);
  });
});

describe('F79: 429 retries are jittered and get a fourth attempt', () => {
  it('spreads the backoff with jitter so instances that collided do not retry together', () => {
    process.env.AERODATABOX_RETRY_BASE_MS = '1500';
    expect(adbRetryDelayMs(1, null, () => 0)).toBe(750);
    expect(adbRetryDelayMs(1, null, () => 0.999)).toBe(2249);
    expect(adbRetryDelayMs(2, null, () => 0.5)).toBe(3000);
    // Two instances that 429'd in the same second draw different delays.
    expect(adbRetryDelayMs(1, null, () => 0.1)).not.toBe(adbRetryDelayMs(1, null, () => 0.7));
  });

  it("honours Retry-After as a floor, capped so one header can't stall a board", () => {
    process.env.AERODATABOX_RETRY_BASE_MS = '1500';
    expect(adbRetryDelayMs(1, '2', () => 0)).toBe(2000);
    expect(adbRetryDelayMs(1, '2', () => 1)).toBe(3500);
    expect(adbRetryDelayMs(1, '600', () => 0)).toBe(5000);
    expect(adbRetryDelayMs(1, 'garbage', () => 0)).toBe(750);
  });

  it('recovers a window that was throttled three times in a row (v1.8.3 gave up after 3)', async () => {
    let throttled = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const s = String(url);
      if (!s.includes('aedbx/aerodatabox')) return { ok: false, status: 403, text: async () => '', headers: { get: () => null } };
      if (s.includes('T00') && throttled < 3) {
        throttled++;
        return { ok: false, status: 429, text: async () => 'rate limit per second', headers: { get: () => null } };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ arrivals: [] }) };
    });
    const board = await fetchViaAeroDataBox('ORD', 'arrivals', ORD_DAY, 8000);
    expect(throttled).toBe(3);
    expect(board.partial).toBe(false);
  });
});
