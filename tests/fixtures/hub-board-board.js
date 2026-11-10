// Synthetic ORD departures board in the normalized /api/schedule row shape, for the hub-page board
// tests (tests/hub-board*.test.js). The row shape is copied from the real probe rows in
// schedule-board-rows.json (UA2278): epoch-second times, a lowercase provider word in
// `status.text` and the normalized one in `status.generic.status.text`, an `_source` audit trail.
//
// The clock: NOW is 15:00 CST on Tue Nov 10 2026 (21:00Z); ORD's hub-local midnight is 06:00Z.

export const NOW_SEC = Date.parse('2026-11-10T21:00:00Z') / 1000;
export const ORD_DAY_START = Date.parse('2026-11-10T06:00:00Z') / 1000;
export const ORD_TOMORROW_START = Date.parse('2026-11-11T06:00:00Z') / 1000;

/** ORD-local "HH:MM" on Nov 10 (CST, UTC-6) → epoch seconds. */
export function cst(hhmm, dayStart = ORD_DAY_START) {
  const [h, m] = hhmm.split(':').map(Number);
  return dayStart + h * 3600 + m * 60;
}

/**
 * @param {object} o
 * @param {string} o.ident
 * @param {number} o.sched  scheduled departure, epoch seconds.
 * @param {number} [o.est]
 * @param {number} [o.real]
 * @param {string} [o.text]     provider word ('expected', 'departed', 'canceleduncertain', …)
 * @param {string} [o.generic]  normalized word ('scheduled', 'departed', 'canceled_uncertain', …)
 * @param {string} [o.dest]
 * @param {string} [o.destName]
 */
export function makeRow({
  ident,
  sched,
  est = null,
  real = null,
  text = 'expected',
  generic = 'scheduled',
  dest = 'LGA',
  destName = 'New York',
  gate = 'C18',
  terminal = '1',
  reg = '',
  model = { code: 'B39M', text: 'Boeing 737 MAX 9' },
}) {
  return {
    time: {
      real: { departure: real, arrival: null },
      estimated: { departure: est, arrival: null },
      scheduled: { departure: sched, arrival: sched + 2 * 3600 },
    },
    status: {
      icon: '',
      live: false,
      text,
      generic: { type: '', status: { text: generic, diverted: false } },
    },
    _source: {
      quality: ['Basic', 'Live'],
      provider: 'aerodatabox',
      timeSource: { hasGateDep: true, hasRunwayDep: true, gateDistinctDep: true },
      rawProviderBlob: { huge: 'x'.repeat(200) },
    },
    airline: { code: { iata: 'UA' }, name: 'United' },
    codeshares: ['LH9000', 'AC8000'],
    airport: {
      origin: { code: { iata: 'ORD' }, info: { gate, terminal }, name: 'Chicago' },
      destination: { code: { iata: dest }, info: { gate: '', terminal: 'B' }, name: destName },
    },
    aircraft: { model, registration: reg },
    identification: { number: { default: ident }, callsign: ident.replace(/^UA/, 'UAL') },
  };
}

/** A small but complete day: departed, late, confirmed and likely cancellations, upcoming rows. */
export function ordBoard() {
  const flights = [
    makeRow({ ident: 'UA100', sched: cst('09:00'), real: cst('09:04'), text: 'departed', generic: 'departed', dest: 'SFO', destName: 'San Francisco' }),
    makeRow({ ident: 'UA101', sched: cst('10:10'), real: cst('10:55'), text: 'departed', generic: 'departed', dest: 'DEN', destName: 'Denver' }),
    makeRow({ ident: 'UA102', sched: cst('11:20'), text: 'canceled', generic: 'canceled', dest: 'MSP', destName: 'Minneapolis' }),
    makeRow({ ident: 'UA5103', sched: cst('12:00'), text: 'canceleduncertain', generic: 'canceled_uncertain', dest: 'GRR', destName: 'Grand Rapids', model: { code: 'E75L', text: 'Embraer 175' } }),
    // 20 minutes ago and gone: inside the dashboard's 30-minute NOW grace, so still "next".
    makeRow({ ident: 'UA104', sched: cst('14:40'), real: cst('14:43'), text: 'departed', generic: 'departed', dest: 'BOS', destName: 'Boston' }),
    makeRow({ ident: 'UA105', sched: cst('15:10'), dest: 'LAX', destName: 'Los Angeles', reg: 'N37502' }),
    makeRow({ ident: 'UA106', sched: cst('15:20'), est: cst('16:05'), text: 'expected', generic: 'estimated', dest: 'EWR', destName: 'Newark' }),
    makeRow({ ident: 'UA107', sched: cst('15:30'), dest: 'IAH', destName: 'Houston' }),
    makeRow({ ident: 'UA108', sched: cst('15:45'), dest: 'DCA', destName: 'Washington' }),
    makeRow({ ident: 'UA109', sched: cst('16:00'), dest: 'LHR', destName: 'London Heathrow', model: { code: 'B789', text: 'Boeing 787-9' } }),
    makeRow({ ident: 'UA110', sched: cst('16:15'), dest: 'MCO', destName: 'Orlando' }),
    makeRow({ ident: 'UA111', sched: cst('16:30'), dest: 'PHX', destName: 'Phoenix' }),
    makeRow({ ident: 'UA112', sched: cst('16:45'), dest: 'SEA', destName: 'Seattle' }),
    makeRow({ ident: 'UA113', sched: cst('17:00'), dest: 'ATL', destName: 'Atlanta' }),
    makeRow({ ident: 'UA114', sched: cst('17:15'), dest: 'AUS', destName: 'Austin' }),
    makeRow({ ident: 'UA115', sched: cst('17:30'), dest: 'SAN', destName: 'San Diego' }),
  ];
  return {
    flights: [...flights].reverse(), // snapshots are not stored in board order
    total: flights.length,
    partial: false,
    meta: { generatedAt: NOW_SEC - 42 * 60, source: 'aerodatabox', completeness: 1 },
  };
}

/** Tonight's last two departures only — the late-evening case that needs tomorrow's board. */
export function lateEveningBoard() {
  return {
    flights: [
      makeRow({ ident: 'UA900', sched: cst('21:00'), real: cst('21:02'), text: 'departed', generic: 'departed', dest: 'SFO' }),
      makeRow({ ident: 'UA901', sched: cst('23:05'), dest: 'HNL', destName: 'Honolulu' }),
      makeRow({ ident: 'UA902', sched: cst('23:40'), dest: 'ANC', destName: 'Anchorage' }),
    ],
    total: 3,
    partial: false,
    meta: { generatedAt: cst('22:15') },
  };
}

export function tomorrowBoard() {
  const flights = [];
  for (let i = 0; i < 15; i++) {
    const h = String(5 + Math.floor(i / 4)).padStart(2, '0');
    const m = String((i % 4) * 15).padStart(2, '0');
    flights.push(makeRow({ ident: `UA${300 + i}`, sched: cst(`${h}:${m}`, ORD_TOMORROW_START), dest: 'DEN' }));
  }
  return { flights, total: flights.length, partial: false, meta: { generatedAt: cst('20:00') } };
}
