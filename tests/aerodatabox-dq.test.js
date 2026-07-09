// Data-quality release (Jul 3 2026 ORD GDP audit) — AeroDataBox board hygiene:
//   #4 dedupe (schedule revisions, operator-code clones, foreign rows) + meta.dedupe counters
//   #5 registration field validation (model strings like "B737M9" must not pass as tails)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  dedupeBoardFlights,
  validateRegistration,
  fetchViaAeroDataBox,
} from '../api/_schedule-aerodatabox.js';
import { __resetAdbSpendForTests } from '../api/_cost-state.js';

function row({ ident, orig = 'ORD', dest = 'LHR', schedDep = null, realDep = null, estDep = null, schedArr = null, realArr = null }) {
  return {
    identification: { number: { default: ident } },
    time: {
      scheduled: { departure: schedDep, arrival: schedArr },
      real: { departure: realDep, arrival: realArr },
      estimated: { departure: estDep, arrival: null },
    },
    airport: {
      origin: { code: { iata: orig } },
      destination: { code: { iata: dest } },
    },
  };
}

const T = 1_780_000_000;

describe('dedupeBoardFlights — schedule-revision collapse (#4a)', () => {
  it('collapses two rows for one physical departure (same ident + same real dep), keeping the ORIGINAL schedule', () => {
    // The UA5982 case: counted BOTH "+2h48 Late" (original schedule) AND "On Time" (revised).
    // The EARLIEST scheduled time must win: the revised row's schedule ≈ the real time, so
    // keeping it rendered the +2h48m delay as On Time. Both rows share the real timestamp, so
    // keeping the original baseline preserves the true delay.
    const late = row({ ident: 'UA5982', dest: 'MSP', schedDep: T, realDep: T + 10080 });
    const revised = row({ ident: 'UA5982', dest: 'MSP', schedDep: T + 10080, realDep: T + 10080 });
    const { flights, dedupe } = dedupeBoardFlights([late, revised], 'departures');
    expect(flights).toHaveLength(1);
    expect(flights[0].time.scheduled.departure).toBe(T); // original baseline wins — delay stays visible
    expect(dedupe.revisions).toBe(1);
  });

  it('keeps the original baseline regardless of input order', () => {
    const revised = row({ ident: 'UA5982', dest: 'MSP', schedDep: T + 10080, realDep: T + 10080 });
    const late = row({ ident: 'UA5982', dest: 'MSP', schedDep: T, realDep: T + 10080 });
    const { flights } = dedupeBoardFlights([revised, late], 'departures');
    expect(flights).toHaveLength(1);
    expect(flights[0].time.scheduled.departure).toBe(T);
  });

  it('collapses on same real ARRIVAL for arrivals boards', () => {
    const a = row({ ident: 'UA100', orig: 'DEN', dest: 'ORD', schedArr: T, realArr: T + 3000 });
    const b = row({ ident: 'UA100', orig: 'DEN', dest: 'ORD', schedArr: T + 3000, realArr: T + 3000 });
    const { flights, dedupe } = dedupeBoardFlights([a, b], 'arrivals');
    expect(flights).toHaveLength(1);
    expect(dedupe.revisions).toBe(1);
  });

  it('does NOT collapse a legitimate same-number rotation (no real times, different schedules)', () => {
    const morning = row({ ident: 'UA200', dest: 'SFO', schedDep: T });
    const evening = row({ ident: 'UA200', dest: 'SFO', schedDep: T + 12 * 3600 });
    const { flights, dedupe } = dedupeBoardFlights([morning, evening], 'departures');
    expect(flights).toHaveLength(2);
    expect(dedupe.revisions).toBe(0);
  });

  it('does NOT collapse same-number rows with DIFFERENT real departures (two physical flights)', () => {
    const a = row({ ident: 'UA300', dest: 'EWR', schedDep: T, realDep: T + 600 });
    const b = row({ ident: 'UA300', dest: 'EWR', schedDep: T + 10 * 3600, realDep: T + 10 * 3600 + 300 });
    const { flights } = dedupeBoardFlights([a, b], 'departures');
    expect(flights).toHaveLength(2);
  });
});

describe('dedupeBoardFlights — operator-code clones (#4b)', () => {
  it('drops a United Express operator clone (G7) matching a UA row on route + real time, keeping UA', () => {
    // "G7929 to LHR" clone from tonight's ORD board.
    const ua = row({ ident: 'UA929', dest: 'LHR', schedDep: T, realDep: T + 900 });
    const clone = row({ ident: 'G7929', dest: 'LHR', schedDep: T + 60, realDep: T + 900 });
    const { flights, dedupe } = dedupeBoardFlights([ua, clone], 'departures');
    expect(flights.map((f) => f.identification.number.default)).toEqual(['UA929']);
    expect(dedupe.operatorClones).toBe(1);
  });

  it('matches clones on scheduled time within a few minutes when no real times exist', () => {
    const ua = row({ ident: 'UA5432', dest: 'CLE', schedDep: T });
    const clone = row({ ident: 'OO5432', dest: 'CLE', schedDep: T + 120 });
    const { flights, dedupe } = dedupeBoardFlights([ua, clone], 'departures');
    expect(flights.map((f) => f.identification.number.default)).toEqual(['UA5432']);
    expect(dedupe.operatorClones).toBe(1);
  });

  it('keeps a United Express row (OO/YV/G7...) with NO matching UA row — it is a real flight', () => {
    const solo = row({ ident: 'G7500', dest: 'GRB', schedDep: T });
    const { flights, dedupe } = dedupeBoardFlights([solo], 'departures');
    expect(flights).toHaveLength(1);
    expect(dedupe.operatorClones).toBe(0);
    expect(dedupe.foreign).toBe(0);
  });

  it('does NOT drop a UX row on the same route at a clearly different time', () => {
    const ua = row({ ident: 'UA700', dest: 'DSM', schedDep: T });
    const uax = row({ ident: 'YV700', dest: 'DSM', schedDep: T + 4 * 3600 });
    const { flights } = dedupeBoardFlights([ua, uax], 'departures');
    expect(flights).toHaveLength(2);
  });

  it('keeps BOTH rows when sched times are close but the real departures are distinct physical movements', () => {
    // OO row and UA row, same route, scheduled 3 min apart — but real departures 55 min apart
    // (17:10 vs 18:05): two aircraft. Route + schedule ±5 min alone used to delete the OO flight.
    const ua = row({ ident: 'UA800', dest: 'ATW', schedDep: T, realDep: T + 600 });        // dep 17:10
    const oo = row({ ident: 'OO800', dest: 'ATW', schedDep: T + 180, realDep: T + 3900 }); // dep 18:05
    const { flights, dedupe } = dedupeBoardFlights([ua, oo], 'departures');
    expect(flights.map((f) => f.identification.number.default).sort()).toEqual(['OO800', 'UA800']);
    expect(dedupe.operatorClones).toBe(0);
  });

  it('still collapses when both real times match within ±120s', () => {
    const ua = row({ ident: 'UA801', dest: 'MKE', schedDep: T, realDep: T + 600 });
    const oo = row({ ident: 'OO801', dest: 'MKE', schedDep: T + 180, realDep: T + 660 }); // 60s apart
    const { flights, dedupe } = dedupeBoardFlights([ua, oo], 'departures');
    expect(flights.map((f) => f.identification.number.default)).toEqual(['UA801']);
    expect(dedupe.operatorClones).toBe(1);
  });

  it('keeps a non-UA row that physically departed when the sched-matching UA row has no real time', () => {
    // The non-UA row moved at a time the UA row does not corroborate — cannot confirm the same
    // physical flight, so it survives.
    const ua = row({ ident: 'UA802', dest: 'FAR', schedDep: T });
    const oo = row({ ident: 'OO802', dest: 'FAR', schedDep: T + 120, realDep: T + 3600 });
    const { flights, dedupe } = dedupeBoardFlights([ua, oo], 'departures');
    expect(flights).toHaveLength(2);
    expect(dedupe.operatorClones).toBe(0);
  });
});

describe('dedupeBoardFlights — foreign rows (#4c)', () => {
  it('drops a clearly foreign row (Spirit NK3005 on the EWR board) with no matching UA row', () => {
    const ua = row({ ident: 'UA1000', orig: 'EWR', dest: 'MCO', schedDep: T });
    const nk = row({ ident: 'NK3005', orig: 'EWR', dest: 'MCO', schedDep: T + 7200 });
    const { flights, dedupe } = dedupeBoardFlights([ua, nk], 'departures');
    expect(flights.map((f) => f.identification.number.default)).toEqual(['UA1000']);
    expect(dedupe.foreign).toBe(1);
  });

  it('counts a foreign row that shadows a UA row as an operator clone, not foreign', () => {
    const ua = row({ ident: 'UA2000', orig: 'EWR', dest: 'LAX', schedDep: T, realDep: T + 300 });
    const dl = row({ ident: 'DL2000', orig: 'EWR', dest: 'LAX', schedDep: T, realDep: T + 300 });
    const { flights, dedupe } = dedupeBoardFlights([ua, dl], 'departures');
    expect(flights).toHaveLength(1);
    expect(dedupe.operatorClones).toBe(1);
    expect(dedupe.foreign).toBe(0);
  });

  it('never drops UA rows and reports zeroed counters on a clean board', () => {
    const a = row({ ident: 'UA1', dest: 'SFO', schedDep: T });
    const b = row({ ident: 'UA2', dest: 'LAX', schedDep: T + 100 });
    const { flights, dedupe } = dedupeBoardFlights([a, b], 'departures');
    expect(flights).toHaveLength(2);
    expect(dedupe).toEqual({ revisions: 0, operatorClones: 0, foreign: 0 });
  });
});

describe('validateRegistration (#5)', () => {
  it('rejects the observed model-string leak "B737M9"', () => {
    expect(validateRegistration('B737M9')).toBeNull();
  });

  it('keeps valid US N-numbers', () => {
    expect(validateRegistration('N37502')).toBe('N37502');
    expect(validateRegistration('N12345')).toBe('N12345');
    expect(validateRegistration('N1UA')).toBe('N1UA');
    expect(validateRegistration('n37502')).toBe('N37502'); // normalized to uppercase
  });

  it('keeps common hyphenated international registrations', () => {
    expect(validateRegistration('C-FABC')).toBe('C-FABC');
    expect(validateRegistration('D-ABCD')).toBe('D-ABCD');
    expect(validateRegistration('B-1234')).toBe('B-1234');
    expect(validateRegistration('PH-BHA')).toBe('PH-BHA');
  });

  it('keeps common hyphenless forms (JA/HL/B####) but rejects model-shaped strings', () => {
    expect(validateRegistration('JA801A')).toBe('JA801A');
    expect(validateRegistration('HL8001')).toBe('HL8001');
    expect(validateRegistration('B1234')).toBe('B1234');
    // Aircraft model codes that must NOT pass:
    expect(validateRegistration('B788')).toBeNull();
    expect(validateRegistration('B38M')).toBeNull();
    expect(validateRegistration('B77W')).toBeNull();
    expect(validateRegistration('A321NEO')).toBeNull();
  });

  it('rejects garbage, empties and leading-zero N-numbers', () => {
    expect(validateRegistration('')).toBeNull();
    expect(validateRegistration(null)).toBeNull();
    expect(validateRegistration(undefined)).toBeNull();
    expect(validateRegistration('N037502')).toBeNull();
    expect(validateRegistration('BOEING 737')).toBeNull();
    expect(validateRegistration('N123456789')).toBeNull();
  });
});

describe('fetchViaAeroDataBox end-to-end board hygiene', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetAdbSpendForTests();
    process.env.AERODATABOX_API_KEY = 'adb-test-key';
    process.env.AERODATABOX_INTER_WINDOW_DELAY_MS = '0';
  });

  afterEach(() => {
    delete process.env.AERODATABOX_API_KEY;
    delete process.env.AERODATABOX_INTER_WINDOW_DELAY_MS;
    __resetAdbSpendForTests();
  });

  it('applies dedupe + registration validation + status mapping to the normalized board', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const iso = (offsetS) => new Date((nowSec + offsetS) * 1000).toISOString();
    const departures = [
      { // revision dupe pair — same real departure, two schedule revisions
        number: 'UA 5982', status: 'Departed', airline: { iata: 'UA', name: 'United Airlines' },
        departure: { scheduledTime: { utc: iso(-10080) }, runwayTime: { utc: iso(0) }, airport: { iata: 'ORD' } },
        arrival: { scheduledTime: { utc: iso(7200) }, airport: { iata: 'MSP' } },
        aircraft: { model: 'Embraer 175', reg: 'N12345' },
      },
      {
        number: 'UA 5982', status: 'Departed', airline: { iata: 'UA', name: 'United Airlines' },
        departure: { scheduledTime: { utc: iso(0) }, runwayTime: { utc: iso(0) }, airport: { iata: 'ORD' } },
        arrival: { scheduledTime: { utc: iso(7200) }, airport: { iata: 'MSP' } },
        aircraft: { model: 'Embraer 175', reg: 'B737M9' }, // model string in the reg field
      },
      { // UA row + its G7 operator clone
        number: 'UA 929', status: 'Delayed', airline: { iata: 'UA', name: 'United Airlines' },
        departure: { scheduledTime: { utc: iso(3600) }, revisedTime: { utc: iso(9000) }, airport: { iata: 'ORD' } },
        arrival: { scheduledTime: { utc: iso(30000) }, airport: { iata: 'LHR' } },
        aircraft: { model: 'Boeing 787-9', reg: 'N37502' },
      },
      {
        number: 'G7 929', status: 'Delayed', airline: { iata: 'UA', name: 'United Airlines' },
        departure: { scheduledTime: { utc: iso(3660) }, airport: { iata: 'ORD' } },
        arrival: { scheduledTime: { utc: iso(30000) }, airport: { iata: 'LHR' } },
        aircraft: {},
      },
      { // clearly foreign leak with no UA match
        number: 'NK 3005', status: 'Expected', airline: { iata: 'UA' },
        departure: { scheduledTime: { utc: iso(5400) }, airport: { iata: 'ORD' } },
        arrival: { scheduledTime: { utc: iso(12000) }, airport: { iata: 'MCO' } },
        aircraft: {},
      },
      { // soft-cancel state
        number: 'UA 2610', status: 'CanceledUncertain', airline: { iata: 'UA' },
        departure: { scheduledTime: { utc: iso(1800) }, airport: { iata: 'ORD' } },
        arrival: { scheduledTime: { utc: iso(9000) }, airport: { iata: 'SFO' } },
        aircraft: {},
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('aedbx/aerodatabox')) {
        return { ok: true, status: 200, json: async () => ({ departures }) };
      }
      return { ok: false, status: 403, text: async () => 'blocked', headers: { get: () => null } };
    });

    const result = await fetchViaAeroDataBox('ORD', 'departures', nowSec, 8000);
    expect(result).toBeTruthy();

    const idents = result.flights.map((f) => f.identification.number.default).sort();
    expect(idents).toEqual(['UA2610', 'UA5982', 'UA929']);
    expect(result.meta.dedupe).toEqual({ revisions: 1, operatorClones: 1, foreign: 1 });

    const ua5982 = result.flights.find((f) => f.identification.number.default === 'UA5982');
    // ORIGINAL schedule kept (the true-delay row, sched 2h48m before the real departure) — the
    // revised on-time-looking row (whose bogus model-string reg would have been dropped) loses.
    expect(ua5982.time.scheduled.departure).toBe(nowSec - 10080);
    expect(ua5982.aircraft.registration).toBe('N12345');

    const ua929 = result.flights.find((f) => f.identification.number.default === 'UA929');
    expect(ua929.aircraft.registration).toBe('N37502');
    expect(ua929.status.generic.status.text).toBe('delayed'); // #6 Delayed mapping

    const ua2610 = result.flights.find((f) => f.identification.number.default === 'UA2610');
    expect(ua2610.status.generic.status.text).toBe('canceled_uncertain'); // #2 soft state
    expect(ua2610.status.icon).toBe('yellow');
  });
});

// ── Gate-vs-runway time instrumentation ────────────────────────────────────────────────
// See docs/specs/irops-delay-measurement.md. The board reports runwayTime (wheels-up) as the
// actual departure and compares it against scheduledTime (a GATE time), so every delay silently
// includes taxi-out: across 10,518 operated departures the median "delay" was +24 min with only
// 3.7% at/before schedule, while the same days' arrivals skewed -18 min with 73.9% at/before
// schedule. Preferring revisedTime is NOT a safe blind swap — the provider sends it only "if any",
// so on-time flights could stay taxi-inflated while delayed ones became gate-based. These fields
// record raw availability and the gate timestamp, changing nothing, so coverage can be measured.
describe('gate-vs-runway time instrumentation', () => {
  const nowSec = 1_700_000_000;
  const iso = (offsetS) => new Date((nowSec + offsetS) * 1000).toISOString();

  beforeEach(() => {
    vi.restoreAllMocks();
    __resetAdbSpendForTests();
    process.env.AERODATABOX_API_KEY = 'adb-test-key';
    process.env.AERODATABOX_INTER_WINDOW_DELAY_MS = '0';
  });
  afterEach(() => {
    delete process.env.AERODATABOX_API_KEY;
    delete process.env.AERODATABOX_INTER_WINDOW_DELAY_MS;
    __resetAdbSpendForTests();
  });

  async function board(departure, status = 'Departed') {
    const departures = [{
      number: 'UA 100', status, airline: { iata: 'UA', name: 'United Airlines' },
      departure: { scheduledTime: { utc: iso(0) }, airport: { iata: 'ORD' }, ...departure },
      arrival: { scheduledTime: { utc: iso(7200) }, airport: { iata: 'DEN', name: 'Denver' } },
      aircraft: { model: 'A320', reg: 'N12345' },
    }];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).includes('aedbx/aerodatabox')
        ? { ok: true, status: 200, json: async () => ({ departures }) }
        : { ok: false, status: 403, text: async () => 'blocked', headers: { get: () => null } }
    );
    const result = await fetchViaAeroDataBox('ORD', 'departures', nowSec, 8000);
    return result.flights[0];
  }

  it('records a runway time with no gate time', async () => {
    const f = await board({ runwayTime: { utc: iso(1500) } });
    expect(f._source.timeSource).toEqual({
      hasGateDep: false, hasRunwayDep: true, hasGateArr: false, hasRunwayArr: false,
    });
    expect(f._source.gate.departure).toBeNull();
  });

  it('records the gate timestamp when the provider sends revisedTime', async () => {
    // revisedTime = gate-out at +10 min; runwayTime = wheels-up at +30 min. The gap is taxi-out.
    const f = await board({ revisedTime: { utc: iso(600) }, runwayTime: { utc: iso(1800) } });
    expect(f._source.timeSource.hasGateDep).toBe(true);
    expect(f._source.timeSource.hasRunwayDep).toBe(true);
    expect(f._source.gate.departure).toBe(nowSec + 600);
  });

  it('does NOT change which timestamp becomes time.real.departure', async () => {
    // The point of this change: instrument, do not fix. runwayTime must still win.
    const f = await board({ revisedTime: { utc: iso(600) }, runwayTime: { utc: iso(1800) } });
    expect(f.time.real.departure).toBe(nowSec + 1800);

    const g = await board({ revisedTime: { utc: iso(600) } });
    expect(g.time.real.departure).toBe(nowSec + 600); // unchanged fallback
  });

  it('leaves gate.departure null for a leg that has not operated', async () => {
    const f = await board({ revisedTime: { utc: iso(600) } }, 'Scheduled');
    expect(f.time.real.departure).toBeNull();
    expect(f._source.gate.departure).toBeNull();
    expect(f._source.timeSource.hasGateDep).toBe(true); // provider sent it; the leg just hasn't gone
  });
});
