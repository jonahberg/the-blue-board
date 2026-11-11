// Flight-page fixtures. The base row is REAL: UA929 ORD→LHR as the public ORD departures board
// served it at 06:32Z on Nov 11 2026 (theblueboard.co/api/schedule?hub=ORD&dir=departures, the
// dashboard's own CDN object). Each state below changes only the fields that state is about, the
// way the provider and the sightings overlay change them, so every case runs through the board's
// real classifier and delay logic.

/** Nov 11 2026 00:00 CST — the ORD board day. */
export const ORD_DAY_START = 1794376800;
/** UA929's scheduled departure (15:45 CST) and arrival (05:55 GMT Nov 12). */
export const D = 1794433500;
export const A = 1794462900;
const MIN = 60;

export function ua929Row() {
  return {
    time: {
      real: { arrival: null, departure: null },
      estimated: { arrival: 1794462900, departure: null },
      scheduled: { arrival: 1794462900, departure: 1794433500 },
    },
    status: { icon: '', live: false, text: 'expected', generic: { type: '', status: { text: 'scheduled', diverted: false } } },
    _source: {
      quality: ['Basic', 'Basic', 'Live'],
      provider: 'aerodatabox',
      timeSource: { hasGateArr: true, hasGateDep: false, hasRunwayArr: false, hasRunwayDep: false, gateDistinctArr: false, gateDistinctDep: false },
    },
    airline: { code: { iata: 'UA' }, name: 'United' },
    airport: {
      origin: { code: { iata: 'ORD' }, info: { gate: '', terminal: '1' }, name: 'ORD' },
      destination: { code: { iata: 'LHR' }, info: { gate: '', terminal: '2' }, name: 'London' },
    },
    aircraft: { model: { code: 'B763', text: 'Boeing 767-300' }, registration: '' },
    identification: { number: { default: 'UA929' }, callsign: '' },
  };
}

const clone = (v) => structuredClone(v);

/** Scheduled, no estimate that differs; 5 h out. */
export function scheduledCase() {
  const row = ua929Row();
  row.time.estimated = { arrival: null, departure: null };
  return { row, nowSec: D - 5 * 3600 };
}

/** Delayed before departure: estimated 47 min late, arrival estimate 40 min late. */
export function delayedCase() {
  const row = ua929Row();
  row.time.estimated = { departure: D + 47 * MIN, arrival: A + 40 * MIN };
  row.status = { icon: '', live: false, text: 'delayed', generic: { type: '', status: { text: 'delayed', diverted: false } } };
  row.airport.origin.info.gate = 'C18';
  return { row, nowSec: D - 60 * MIN };
}

/** In the air: left the gate 3 min late (a gate time distinct from the runway), due 13 min early. */
export function inAirCase() {
  const row = ua929Row();
  row.time.real.departure = D + 3 * MIN;
  row.time.estimated = { departure: null, arrival: A - 13 * MIN };
  row.status = { icon: 'green', live: true, text: 'departed', generic: { type: '', status: { text: 'departed', diverted: false } } };
  row._source.timeSource = { ...row._source.timeSource, hasGateDep: true, hasRunwayDep: true, gateDistinctDep: true };
  row._source.track = { airborneAt: (D + 28 * MIN) * 1000 };
  row.airport.origin.info.gate = 'C18';
  row.aircraft.registration = 'N686UA';
  return { row, nowSec: D + 2 * 3600 };
}

/** Landed at the gate 13 min early. */
export function landedCase() {
  const { row } = inAirCase();
  row.time.real.arrival = A - 13 * MIN;
  row.time.estimated = { departure: null, arrival: null };
  row.status = { icon: 'green', live: false, text: 'arrived', generic: { type: '', status: { text: 'landed', diverted: false } } };
  row._source.timeSource = { ...row._source.timeSource, gateDistinctArr: true };
  return { row, nowSec: A + 50 * MIN };
}

/** Canceled (confirmed by the provider). */
export function canceledCase() {
  const row = ua929Row();
  row.time.estimated = { arrival: null, departure: null };
  row.status = { icon: 'red', live: false, text: 'canceled', generic: { type: 'canceled', status: { text: 'canceled', diverted: false } } };
  return { row, nowSec: D - 3 * 3600 };
}

/** Unconfirmed "Likely Canceled", not seen flying. */
export function likelyCanceledCase() {
  const row = ua929Row();
  row.time.estimated = { arrival: null, departure: null };
  row.status = { icon: '', live: false, text: 'CanceledUncertain', generic: { type: 'canceled_uncertain', status: { text: 'canceled_uncertain', diverted: false } } };
  return { row, nowSec: D - 2 * 3600 };
}

/** Diverted. */
export function divertedCase() {
  const { row } = inAirCase();
  row.status = { icon: '', live: false, text: 'diverted', generic: { type: '', status: { text: 'landed', diverted: true } } };
  return { row, nowSec: D + 6 * 3600 };
}

/** flight_history rows for UA929 ORD→LHR (the archive's shape: int4 minutes since the epoch). */
export function historyRows(dates, kindFor = () => 'on-time') {
  return dates.map((date, i) => {
    const day = Date.parse(`${date}T21:45:00Z`) / 60000; // 15:45 CST
    const kind = kindFor(date, i);
    const base = {
      flight_no: 'UA929', service_date: date, origin: 'ORD', dest: 'LHR',
      sched_dep: day, sched_arr: day + 490, dep_at: null, dep_basis: null, arr_at: null, arr_basis: null,
      airborne_at: null, status: 'departed', outcome: 'operated', final: true,
      registration: 'N686UA', aircraft_code: 'B763', operator: 'UAL', last_seen: day + 30,
    };
    if (kind === 'on-time') return { ...base, dep_at: day + 4, dep_basis: 'gate' };
    if (kind === 'late') return { ...base, dep_at: day + 40 + i, dep_basis: 'runway' };
    if (kind === 'canceled') return { ...base, status: 'canceled', outcome: 'canceled' };
    if (kind === 'unconfirmed') return { ...base, status: 'canceleduncertain', outcome: 'canceled_unconfirmed' };
    if (kind === 'unknown') return { ...base, status: 'expected', outcome: 'unknown', final: false };
    return base;
  });
}

/** An /api/flight payload around a row (what the endpoint returns). */
export function payloadFor(row, { history = null, tail = null, aircraft = null, boardAt = D - 3600 } = {}) {
  return {
    v: 1,
    ident: 'UA929',
    status: 'ok',
    servedAt: 0,
    leg: { row: clone(row), source: 'board', dir: 'departures', hub: 'ORD', serviceDate: '2026-11-11', boardAt },
    aircraft,
    history,
    tail,
    lastSeen: null,
  };
}

export const ua929Aircraft = {
  reg: 'N686UA', type: '767-300ER', config: '46J/22PP/43E+/56Y', seats: { J: 46, PP: 22, 'E+': 43, Y: 56 }, total: 167,
  wifi: 'Satellite Ku', starlink: false, ife: 'AVOD', delivered: '1999', operator: 'United Airlines', express: false, source: 'fleet',
};
