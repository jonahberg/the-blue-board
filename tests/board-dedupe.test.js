// Live audit Oct 4 2026, finding 4: one physical flight shown as two or three rows, and arrivals
// stuck "Approaching" / "En route" hours after they landed. Rows verbatim from the boards served at
// 00:46Z (EWR/IAH departures, LAX/ORD arrivals).
import { describe, it, expect } from 'vitest';
import { dedupeBoardFlights } from '../api/_schedule-aerodatabox.js';
import { buildScheduleRow } from '../src/lib/schedule-row-model.js';
import { classifySchedStatus } from '../src/lib/schedule-status.js';

const departed = () => ({ generic: { status: { text: 'departed', diverted: false }, type: '' }, text: 'departed', icon: 'green', live: true });
const approaching = () => ({ generic: { status: { text: 'en-route', diverted: false }, type: '' }, text: 'approaching', icon: 'green', live: true });
const arrived = () => ({ generic: { status: { text: 'landed', diverted: false }, type: '' }, text: 'arrived', icon: 'green', live: false });

function row(ident, origin, dest, reg, status, time, source = {}) {
  return {
    identification: { number: { default: ident } },
    status,
    time: {
      scheduled: { departure: null, arrival: null, ...time.scheduled },
      real: { departure: null, arrival: null, ...time.real },
      estimated: { departure: null, arrival: null, ...time.estimated },
    },
    airport: { origin: { code: { iata: origin } }, destination: { code: { iata: dest } } },
    aircraft: { model: { code: 'B39M' }, registration: reg },
    _source: { provider: 'aerodatabox', ...source },
  };
}

// EWR UA1462 EWR→MBJ on N47298: "Departed +4h13m" (gate 16:56Z, distinct) and "Departed +0m" (a
// re-timed copy whose scheduled time IS its runway time).
const ua1462Late = () => row('UA1462', 'EWR', 'MBJ', 'N47298', departed(), {
  scheduled: { departure: 1791031380 }, real: { departure: 1791046560 },
}, { timeSource: { gateDistinctDep: true, hasGateDep: true, hasRunwayDep: true } });
const ua1462Copy = () => row('UA1462', 'EWR', 'MBJ', 'N47298', departed(), {
  scheduled: { departure: 1791048300 }, real: { departure: 1791048300 }, estimated: { arrival: 1791062160 },
}, { timeSource: { gateDistinctDep: false, hasGateDep: true, hasRunwayDep: true } });

// IAH UA235 IAH→DCA ×3: twice on N898UA, once on N27267.
const ua235a = () => row('UA235', 'IAH', 'DCA', 'N898UA', departed(), { scheduled: { departure: 1791057780 }, real: { departure: 1791057780 } });
const ua235b = () => row('UA235', 'IAH', 'DCA', 'N898UA', departed(), {
  scheduled: { departure: 1791063600, arrival: 1791075000 }, real: { departure: 1791064860 }, estimated: { arrival: 1791073560 },
});
const ua235c = () => row('UA235', 'IAH', 'DCA', 'N27267', departed(), { scheduled: { departure: 1791064860 }, real: { departure: 1791068940 } });

// LAX UA38 HND→LAX on N14019: "Approaching" 371 min after the same tail's row said "Arrived".
const ua38Ghost = () => row('UA38', 'HND', 'LAX', 'N14019', approaching(), { scheduled: { arrival: 1791052560 }, estimated: { arrival: 1791052560 } });
const ua38Arrived = () => row('UA38', 'HND', 'LAX', 'N14019', arrived(), {
  scheduled: { departure: 1791018600, arrival: 1791055500 }, real: { departure: 1791018000, arrival: 1791053580 },
}, { timeSource: { gateDistinctArr: true, hasGateArr: true, hasRunwayArr: true } });

// ORD UA2472 RSW→ORD on N68453: an "Approaching" ghost with the real schedule, and an "Arrived" row whose
// scheduled time was derived from its actual.
const ua2472Ghost = () => row('UA2472', 'RSW', 'ORD', 'N68453', approaching(), {
  scheduled: { departure: 1791051240, arrival: 1791062640 }, real: { departure: 1791052020 }, estimated: { arrival: 1791061020 },
});
const ua2472Arrived = () => row('UA2472', 'RSW', 'ORD', 'N68453', arrived(), {
  scheduled: { arrival: 1791061620 }, real: { arrival: 1791061620 },
}, { timeSource: { gateDistinctArr: true, hasGateArr: true, hasRunwayArr: true }, scheduleTimeDerivedFromActual: { arrival: true, departure: false } });

const idents = (flights) => flights.map((f) => `${f.identification.number.default}/${f.aircraft.registration}/${f.time.scheduled.departure ?? f.time.scheduled.arrival}`);

describe('one physical flight is one row (finding 4)', () => {
  it('EWR UA1462: keeps the "+4h13m" row with the distinct gate time, drops the re-timed "+0m" copy', () => {
    const { flights, dedupe } = dedupeBoardFlights([ua1462Copy(), ua1462Late()], 'departures');
    expect(flights).toHaveLength(1);
    expect(flights[0].time.real.departure).toBe(1791046560);
    expect(dedupe.sameTail).toBe(1);
    expect(dedupe.revisions).toBe(1); // credited to the snapshot ranking
  });

  it('IAH UA235: the two N898UA rows become one; the N27267 row (a different tail) stays', () => {
    const { flights } = dedupeBoardFlights([ua235a(), ua235b(), ua235c()], 'departures');
    expect(idents(flights)).toEqual(['UA235/N898UA/1791063600', 'UA235/N27267/1791064860']);
  });

  it('LAX UA38: the "Approaching" ghost goes, the "Arrived" row stays', () => {
    const { flights } = dedupeBoardFlights([ua38Ghost(), ua38Arrived()], 'arrivals');
    expect(flights).toHaveLength(1);
    expect(flights[0].status.text).toBe('arrived');
  });

  it("ORD UA2472: the arrived row keeps its landing and adopts the ghost's real schedule → Landed −17m", () => {
    const { flights } = dedupeBoardFlights([ua2472Ghost(), ua2472Arrived()], 'arrivals');
    expect(flights).toHaveLength(1);
    const kept = flights[0];
    expect(kept.time.real.arrival).toBe(1791061620);
    expect(kept.time.scheduled.arrival).toBe(1791062640);
    expect(kept._source.scheduleTimeDerivedFromActual.arrival).toBe(false);
    const status = classifySchedStatus(kept, 'arrivals', 1791074760);
    const model = buildScheduleRow(kept, { hub: 'ORD', dir: 'arrivals', timeZone: 'UTC', status, reg: 'N68453' });
    expect(model.delay).toMatchObject({ kind: 'delta', minutes: -17 });
  });

  it('never collapses rows without a tail, or with different routes', () => {
    const a = { ...ua1462Late(), aircraft: { registration: '' } };
    const b = { ...ua1462Copy(), aircraft: { registration: '' } };
    expect(dedupeBoardFlights([a, b], 'departures').flights).toHaveLength(2);
    const other = { ...ua1462Copy(), airport: { origin: { code: { iata: 'EWR' } }, destination: { code: { iata: 'SJU' } } } };
    expect(dedupeBoardFlights([ua1462Late(), other], 'departures').flights).toHaveLength(2);
  });

});

describe('stale en-route / approaching arrivals age into Landed* (finding 4)', () => {
  it('LAX UA38 alone, "Approaching" 371 min past its arrival, reads Landed* (presumed)', () => {
    const now = 1791052560 + 371 * 60;
    expect(classifySchedStatus(ua38Ghost(), 'arrivals', now)).toMatchObject({ key: 'landed', text: 'Landed', presumed: true });
  });

  it('but not while it is still within 90 min of its arrival time, nor while a fresh airborne fix says it is flying', () => {
    expect(classifySchedStatus(ua38Ghost(), 'arrivals', 1791052560 + 60 * 60)).toMatchObject({ key: 'enroute', text: 'Approaching' });
    const now = 1791052560 + 3 * 3600;
    const flying = { ...ua38Ghost(), time: { ...ua38Ghost().time, scheduled: { departure: now - 10 * 3600, arrival: 1791052560 } }, live: { seenAt: (now - 60) * 1000 } };
    expect(classifySchedStatus(flying, 'arrivals', now).key).toBe('enroute');
  });

  it('departures boards keep Departed (a departure does not "land" on its own board)', () => {
    const now = 1791057780 + 12 * 3600;
    expect(classifySchedStatus(ua235a(), 'departures', now).key).toBe('departed');
  });
});
