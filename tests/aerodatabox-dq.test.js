// Data-quality release (Jul 3 2026 ORD GDP audit) — AeroDataBox board hygiene:
//   #4 dedupe (schedule revisions, operator-code clones, foreign rows) + meta.dedupe counters
//   #5 registration field validation (model strings like "B737M9" must not pass as tails)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  dedupeBoardFlights,
  validateRegistration,
  fetchViaAeroDataBox,
  modelTextToIcaoCode,
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

// ── Delay is measured at the GATE, not the runway ───────────────────────────────────────
// docs/specs/irops-delay-measurement.md. `scheduledTime` is a gate time; `runwayTime` is wheels-up
// (departure) or wheels-down (arrival). Comparing them mixed units, so every reported delay carried
// taxi-out and every arrival landed before reaching the gate. `revisedTime` is the gate time.
//
// Measured on 521 operated legs from live EWR + SFO boards before this change: revisedTime coverage
// is 100%; the gate time is NEVER after the runway time (0 of 255 departures), so preferring it can
// only shrink a reported delay, never grow one; where they differ (36% of departures) the median gap
// is 26 min. Departures at/before schedule went 2.4% -> 26.3%; delayed30 went 85 -> 53.
describe('gate-based delay measurement', () => {
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

  async function board(departure, arrival = {}, status = 'Departed') {
    const departures = [{
      number: 'UA 100', status, airline: { iata: 'UA', name: 'United Airlines' },
      departure: { scheduledTime: { utc: iso(0) }, airport: { iata: 'ORD' }, ...departure },
      arrival: { scheduledTime: { utc: iso(7200) }, airport: { iata: 'DEN', name: 'Denver' }, ...arrival },
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

  it('reports the GATE departure, not wheels-up', async () => {
    // Pushback +10 min (a real 10-minute delay); wheels-up +36 min (10 delay + 26 taxi).
    const f = await board({ revisedTime: { utc: iso(600) }, runwayTime: { utc: iso(2160) } });
    expect(f.time.real.departure).toBe(nowSec + 600);
    expect(f._source.timeSource.gateDistinctDep).toBe(true);
  });

  it('an on-time pushback is no longer reported as a 26-minute delay', async () => {
    // Departed exactly on schedule; 26 min taxi. Old code called this +26 min late.
    const f = await board({ revisedTime: { utc: iso(0) }, runwayTime: { utc: iso(1560) } });
    expect(f.time.real.departure - f.time.scheduled.departure).toBe(0);
  });

  it('falls back to the runway time when the provider omits the gate time', async () => {
    const f = await board({ runwayTime: { utc: iso(1500) } });
    expect(f.time.real.departure).toBe(nowSec + 1500);
    expect(f._source.timeSource.gateDistinctDep).toBe(false);
    expect(f._source.timeSource.hasGateDep).toBe(false);
  });

  it('marks the row as not-gate-distinct when the provider copies runwayTime into revisedTime', async () => {
    // 64% of real departures look like this. The delay stays taxi-inflated; say so honestly.
    const f = await board({ revisedTime: { utc: iso(1500) }, runwayTime: { utc: iso(1500) } });
    expect(f.time.real.departure).toBe(nowSec + 1500);
    expect(f._source.timeSource.gateDistinctDep).toBe(false);
    expect(f._source.timeSource.hasGateDep).toBe(true);
  });

  it('reports the GATE arrival, not wheels-down', async () => {
    // Touchdown at +7200; on-blocks 18 min later. Old code called this an 18-min-early arrival.
    const f = await board(
      { runwayTime: { utc: iso(1500) } },
      { runwayTime: { utc: iso(7200) }, revisedTime: { utc: iso(8280) } },
      'Arrived'
    );
    expect(f.time.real.arrival).toBe(nowSec + 8280);
    expect(f._source.timeSource.gateDistinctArr).toBe(true);
  });

  it('leaves a not-yet-operated leg alone', async () => {
    const f = await board({ revisedTime: { utc: iso(600) } }, {}, 'Scheduled');
    expect(f.time.real.departure).toBeNull();
    expect(f._source.timeSource.gateDistinctDep).toBe(false);
  });
});

// ── Aircraft model.code is derived from AeroDataBox's free-text model (#8) ────────────────────
// AeroDataBox ships only a human-readable model name and never a code (0 of 647 live rows had
// one). The dashboard keys three features off aircraft.model.code — the equipment-swap detector,
// the Aircraft column, and the type filter — so with the code hardcoded to '' all three were
// structurally dead. modelTextToIcaoCode() fills it, in the client's ICAO_TO_FLEET_TYPE
// vocabulary. Ambiguous/unknown text must return '' (never a guessed variant: a wrong code mints
// a FALSE swap alert, which is worse than the dead banner it revives).
describe('modelTextToIcaoCode — free-text model → ICAO code', () => {
  it('maps each live mainline/regional model to its client-vocabulary code', () => {
    const cases = [
      ['Airbus A319', 'A319'],
      ['Airbus A320', 'A320'],
      ['Airbus A321 NEO', 'A21N'],
      ['Boeing 737-700', 'B737'],
      ['Boeing 737-800', 'B738'],
      ['Boeing 737-900', 'B739'],
      ['Boeing 737 MAX 8', 'B38M'],
      ['Boeing 737 MAX 9', 'B39M'],
      ['Boeing 757-200', 'B752'],
      ['Boeing 757-300', 'B753'],
      ['Boeing 767-300', 'B763'],
      ['Boeing 767-400', 'B764'],
      ['Boeing 777-200', 'B772'],
      ['Boeing 777-200ER', 'B77E'],
      ['Boeing 777-300ER', 'B77W'],
      ['Boeing 787-8', 'B788'],
      ['Boeing 787-9', 'B789'],
      ['Boeing 787-10', 'B78X'],
      ['Embraer 175', 'E175'],
      ['Embraer 170', 'E170'],
      ['Bombardier CRJ 200', 'CRJ2'],
      ['Bombardier CRJ 700', 'CRJ7'],
      ['Bombardier CRJ 550', 'CRJ7'],
      ['Bombardier CRJ 900', 'CRJ9'],
    ];
    for (const [text, code] of cases) {
      expect(modelTextToIcaoCode(text)).toBe(code);
    }
  });

  it('every derived mainline code is a key the client ICAO_TO_FLEET_TYPE map understands', () => {
    // Guards the vocabulary contract: these are exactly the keys in src/dashboard/main.js.
    const CLIENT_MAINLINE_KEYS = new Set([
      'A319', 'A320', 'A21N',
      'B737', 'B738', 'B739', 'B39M', 'B38M',
      'B752', 'B753', 'B763', 'B764',
      'B772', 'B77E', 'B77W', 'B788', 'B789', 'B78X',
    ]);
    for (const text of ['Airbus A319', 'Airbus A321 NEO', 'Boeing 737 MAX 9', 'Boeing 777-200ER', 'Boeing 787-10']) {
      expect(CLIENT_MAINLINE_KEYS.has(modelTextToIcaoCode(text))).toBe(true);
    }
  });

  it("returns '' for a bare 'Boeing 737' — ambiguous across -700/-800/-900, never guess", () => {
    expect(modelTextToIcaoCode('Boeing 737')).toBe('');
  });

  it("returns '' for other ambiguous bare families (787, A321 ceo/neo, CRJ)", () => {
    expect(modelTextToIcaoCode('Boeing 787')).toBe('');
    expect(modelTextToIcaoCode('Airbus A321')).toBe('');
    expect(modelTextToIcaoCode('Bombardier CRJ')).toBe('');
    expect(modelTextToIcaoCode('Boeing 777')).toBe('');
  });

  it("returns '' for unknown / empty / nullish text", () => {
    expect(modelTextToIcaoCode('Cessna 172')).toBe('');
    expect(modelTextToIcaoCode('Saab 340')).toBe('');
    expect(modelTextToIcaoCode('')).toBe('');
    expect(modelTextToIcaoCode(undefined)).toBe('');
    expect(modelTextToIcaoCode(null)).toBe('');
  });

  it('tolerates casing and whitespace noise', () => {
    expect(modelTextToIcaoCode('  boeing   787-9  ')).toBe('B789');
    expect(modelTextToIcaoCode('AIRBUS A321NEO')).toBe('A21N');
  });
});

// ── End-to-end: the derived code rides the normalized board (swap-detector precondition) ──────
describe('fetchViaAeroDataBox — aircraft.model.code end-to-end', () => {
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

  async function boardWithModel(model) {
    const departures = [{
      number: 'UA 100', status: 'Scheduled', airline: { iata: 'UA', name: 'United Airlines' },
      departure: { scheduledTime: { utc: iso(3600) }, airport: { iata: 'ORD' } },
      arrival: { scheduledTime: { utc: iso(10800) }, airport: { iata: 'DEN' } },
      aircraft: { model, reg: 'N12345' },
    }];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).includes('aedbx/aerodatabox')
        ? { ok: true, status: 200, json: async () => ({ departures }) }
        : { ok: false, status: 403, text: async () => 'blocked', headers: { get: () => null } }
    );
    const result = await fetchViaAeroDataBox('ORD', 'departures', nowSec, 8000);
    return result.flights[0];
  }

  it('carries the derived code AND the raw text on the normalized row', async () => {
    const f = await boardWithModel('Embraer 175');
    expect(f.aircraft.model.code).toBe('E175');
    expect(f.aircraft.model.text).toBe('Embraer 175');
  });

  it('two boards with changed model text produce DIFFERING codes (the swap precondition)', async () => {
    const before = await boardWithModel('Boeing 787-9');
    const after = await boardWithModel('Boeing 777-300ER');
    expect(before.aircraft.model.code).toBe('B789');
    expect(after.aircraft.model.code).toBe('B77W');
    expect(before.aircraft.model.code).not.toBe(after.aircraft.model.code);
  });

  it("leaves the code empty for a bare 'Boeing 737' — no false swap, honest '—' in the column", async () => {
    const f = await boardWithModel('Boeing 737');
    expect(f.aircraft.model.code).toBe('');
    expect(f.aircraft.model.text).toBe('Boeing 737');
  });
});
