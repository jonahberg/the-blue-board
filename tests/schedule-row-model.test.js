import { describe, it, expect } from 'vitest';

import {
  ACTUAL_LINE_THRESHOLD_MINUTES,
  OTP_SEVERITY_LABEL,
  actualDeltaLine,
  aircraftCell,
  buildScheduleRow,
  dateChipLabel,
  delayCell,
  delayExplainContext,
  fleetCell,
  formatSchedTime,
  isRegFromLiveFeed,
  otpSeverity,
  routeCell,
  shortAirportName,
  swapCell,
  swapTone,
  terminalGateCell,
} from '../src/lib/schedule-row-model.js';

const CHI = 'America/Chicago';
/** 2026-09-13 12:00:00Z — 07:00 in Chicago. */
const NOON_UTC = Math.floor(Date.parse('2026-09-13T12:00:00Z') / 1000);

describe('formatSchedTime', () => {
  it('is hub-local 24-hour HH:MM', () => {
    expect(formatSchedTime(NOON_UTC, CHI)).toBe('07:00');
    expect(formatSchedTime(NOON_UTC, 'America/Denver')).toBe('06:00');
  });

  it('is an em dash with no time', () => {
    expect(formatSchedTime(0, CHI)).toBe('—');
    expect(formatSchedTime(null, CHI)).toBe('—');
    expect(formatSchedTime(undefined, CHI)).toBe('—');
  });

  it('degrades rather than throwing on an unusable zone', () => {
    expect(formatSchedTime(NOON_UTC, 'Not/AZone')).toBe('—');
  });
});

describe('dateChipLabel', () => {
  it('marks a row from an earlier hub-local date', () => {
    expect(dateChipLabel(NOON_UTC - 86400, NOON_UTC, CHI)).toBe('Sep 12');
  });

  it('is null for a row inside the board day', () => {
    expect(dateChipLabel(NOON_UTC + 3600, NOON_UTC, CHI)).toBeNull();
    expect(dateChipLabel(NOON_UTC, NOON_UTC, CHI)).toBeNull();
  });

  it('is null when there is no time or no board day', () => {
    expect(dateChipLabel(undefined, NOON_UTC, CHI)).toBeNull();
    expect(dateChipLabel(NOON_UTC - 86400, 0, CHI)).toBeNull();
  });

  it('never breaks a row over a bad zone', () => {
    expect(dateChipLabel(NOON_UTC - 86400, NOON_UTC, 'Not/AZone')).toBeNull();
  });
});

describe('actualDeltaLine', () => {
  const base = { schedTimeSec: NOON_UTC, timeZone: CHI };

  it('reports a late departure', () => {
    const line = actualDeltaLine({ ...base, actualTimeSec: NOON_UTC + 54 * 60 });
    expect(line).toMatchObject({ early: false, minutes: 54 });
    expect(line.text).toBe('→ 07:54 (+54m)');
  });

  it('reports an early departure as early', () => {
    const line = actualDeltaLine({ ...base, actualTimeSec: NOON_UTC - 15 * 60 });
    expect(line).toMatchObject({ early: true, minutes: -15 });
    expect(line.text).toBe('→ 06:45 (-15m)');
  });

  it('stays silent inside the ±5 minute noise band', () => {
    for (const delta of [0, 1, -1, 5, -5]) {
      expect(actualDeltaLine({ ...base, actualTimeSec: NOON_UTC + delta * 60 })).toBeNull();
    }
    expect(ACTUAL_LINE_THRESHOLD_MINUTES).toBe(5);
  });

  it('is suppressed when the schedule was derived from the actual', () => {
    // Comparing a number against itself would render "+0m" as if it were a measurement.
    expect(
      actualDeltaLine({ ...base, actualTimeSec: NOON_UTC + 54 * 60, derivedActual: true }),
    ).toBeNull();
  });

  it('is null with a missing time on either side', () => {
    expect(actualDeltaLine({ ...base, actualTimeSec: undefined })).toBeNull();
    expect(actualDeltaLine({ schedTimeSec: undefined, actualTimeSec: NOON_UTC, timeZone: CHI })).toBeNull();
  });
});

describe('shortAirportName', () => {
  it('drops the boilerplate words and caps the length', () => {
    expect(shortAirportName({ name: "Chicago O'Hare International Airport" })).toBe("Chicago O'Hare");
    expect(shortAirportName({ name: 'A'.repeat(50) })).toHaveLength(30);
  });

  it('is empty for a missing name', () => {
    expect(shortAirportName(undefined)).toBe('');
    expect(shortAirportName({})).toBe('');
  });
});

describe('routeCell', () => {
  const withCode = {
    airport: {
      origin: { code: { iata: 'ORD' }, name: "Chicago O'Hare International Airport" },
      destination: { code: { iata: 'DEN' }, name: 'Denver International Airport' },
    },
  };

  it('puts the hub on the board side', () => {
    expect(routeCell(withCode, 'ORD', 'departures')).toEqual({
      routeLine: 'ORD → DEN',
      routeSub: 'Denver',
    });
    expect(routeCell(withCode, 'DEN', 'arrivals')).toEqual({
      routeLine: 'ORD → DEN',
      routeSub: "Chicago O'Hare",
    });
  });

  it('promotes the airport NAME when the provider omitted the IATA code', () => {
    // Seven of 644 rows on a real ORD board rendered as "ORD → ?" before this.
    const noCode = { airport: { destination: { name: 'Seattle Tacoma International Airport' } } };
    expect(routeCell(noCode, 'ORD', 'departures')).toEqual({
      routeLine: 'ORD → Seattle Tacoma',
      routeSub: null,
    });
  });

  it('never renders a bare question mark', () => {
    expect(routeCell({}, 'ORD', 'departures').routeLine).toBe('ORD → —');
  });
});

describe('aircraftCell', () => {
  it('shortens the manufacturer prefix', () => {
    expect(aircraftCell({ aircraft: { model: { code: 'B739', text: 'Boeing 737-900' } } })).toEqual({
      acCode: 'B739',
      acText: 'Boeing 737-900',
      acShort: '737-900',
    });
  });

  it('degrades to a dash with no model', () => {
    expect(aircraftCell({})).toEqual({ acCode: '—', acText: '', acShort: '' });
  });
});

describe('terminalGateCell', () => {
  const at = (info, dir = 'departures') => ({
    airport: {
      origin: { code: { iata: 'ORD' }, info: dir === 'departures' ? info : undefined },
      destination: { code: { iata: 'DEN' }, info: dir === 'arrivals' ? info : undefined },
    },
  });

  it('puts the terminal first, then the gate', () => {
    expect(terminalGateCell(at({ terminal: '1', gate: 'C18' }), 'departures')).toBe('T1 · C18');
  });

  it('renders a terminal alone', () => {
    expect(terminalGateCell(at({ terminal: '2' }), 'departures')).toBe('T2');
  });

  it('labels a bare gate so it never sits where a terminal is expected', () => {
    // ORD has a United hub terminal, so use an airport that does not to isolate the branch.
    const noHub = { airport: { origin: { code: { iata: 'BOS' }, info: { gate: 'B12' } }, destination: { code: { iata: 'LGA' } } } };
    expect(terminalGateCell(noHub, 'departures')).toBe('Gate B12');
  });

  it('falls back to the United hub terminal when the provider sent none', () => {
    const bare = { airport: { origin: { code: { iata: 'ORD' } }, destination: { code: { iata: 'DEN' } } } };
    expect(terminalGateCell(bare, 'departures')).toBe('T1');
    // Arrivals read the DESTINATION end.
    expect(terminalGateCell(bare, 'arrivals')).toBe('TB');
  });

  it('is an em dash when nothing is known', () => {
    expect(terminalGateCell({}, 'departures')).toBe('—');
  });
});

describe('isRegFromLiveFeed', () => {
  it('is true for a client-ledger fill (provider field empty)', () => {
    expect(isRegFromLiveFeed({ aircraft: {} }, 'N12345')).toBe(true);
  });

  it('is true for a server merge tagged live_feed', () => {
    expect(
      isRegFromLiveFeed({ aircraft: { registration: 'N12345', regSource: 'live_feed' } }, 'N12345'),
    ).toBe(true);
  });

  it('is false for a provider-supplied tail', () => {
    expect(isRegFromLiveFeed({ aircraft: { registration: 'N12345' } }, 'N12345')).toBe(false);
  });

  it('is false with no tail at all', () => {
    expect(isRegFromLiveFeed({ aircraft: {} }, '')).toBe(false);
  });
});

describe('fleetCell', () => {
  const fleetByReg = {
    N12345: { c: '20F/45E+/114Y', t: '737-900', w: 'ViaSat Ka', i: 'PDE', d: '2021', seats: { F: 20, 'E+': 45, Y: 114 } },
    N99999: { t: 'CRJ-200' },
  };
  const starlink = new Set(['N12345']);

  it('builds the badge and the enrichment line', () => {
    const cell = fleetCell('N12345', fleetByReg, starlink);
    expect(cell.badge).toBe('20F/45E+/114Y');
    expect(cell.starlink).toBe(true);
    expect(cell.enrich).toBe('20F/45E+/114Y · ViaSat Ka · ⚡ Starlink · PDE · Del 2021');
  });

  it('falls back to the type when there is no cabin config', () => {
    const cell = fleetCell('N99999', fleetByReg, starlink);
    expect(cell).toMatchObject({ badge: 'CRJ-200', starlink: false, enrich: '' });
  });

  it('matches a hyphenated tail against the unhyphenated roster', () => {
    expect(fleetCell('N1-2345', fleetByReg, starlink)?.badge).toBe('20F/45E+/114Y');
  });

  it('is null for an unknown or absent tail — never an invented cabin', () => {
    expect(fleetCell('N00000', fleetByReg, starlink)).toBeNull();
    expect(fleetCell('', fleetByReg, starlink)).toBeNull();
  });
});

describe('swapTone / swapCell', () => {
  it('lets a downgrade outrank an upgrade', () => {
    // A swap that adds Starlink but loses Polaris is a downgrade to the booked passenger.
    expect(swapTone([{ cls: 'upgrade' }, { cls: 'downgrade' }])).toBe('downgrade');
  });

  it('reports an upgrade', () => {
    expect(swapTone([{ cls: 'upgrade' }, { cls: 'lateral' }])).toBe('upgrade');
  });

  it('reports lateral for anything else, including nothing', () => {
    expect(swapTone([{ cls: 'lateral' }])).toBe('lateral');
    expect(swapTone([])).toBe('lateral');
    expect(swapTone(null)).toBe('lateral');
  });

  it('maps ICAO codes to readable fleet names', () => {
    const cell = swapCell({ oldAc: 'B763', newAc: 'B38M' }, 'N12345', [{ cls: 'downgrade', text: 'Lost Polaris' }]);
    expect(cell).toMatchObject({
      oldType: '767-300ER',
      newType: '737 MAX 8',
      reg: 'N12345',
      tone: 'downgrade',
    });
  });

  it('passes an unmapped code through rather than blanking the badge', () => {
    expect(swapCell({ oldAc: 'ZZZZ', newAc: 'B738' }, '', []).oldType).toBe('ZZZZ');
  });

  it('is null with no change', () => {
    expect(swapCell(null, 'N12345', [])).toBeNull();
  });
});

describe('delayCell — facts beat predictions', () => {
  const risk = { label: 'V.HIGH', score: 80 };
  const base = {
    schedTimeSec: NOON_UTC,
    actualTimeSec: NOON_UTC + 140 * 60,
    hasRealTime: true,
    dir: 'departures',
    presumed: false,
    risk,
  };

  it('shows the REAL delay on an operated row, never the prediction', () => {
    // Regression: a flight already 140 minutes late once displayed "V.HIGH".
    const cell = delayCell({ ...base, statusKey: 'departed' });
    expect(cell).toMatchObject({ kind: 'delta', minutes: 140, text: '+2h20m' });
    expect(cell.title).toBe('Actual vs scheduled departure');
  });

  it('titles an estimate as an estimate', () => {
    const cell = delayCell({ ...base, statusKey: 'departed', hasRealTime: false });
    expect(cell.title).toBe('Estimated vs scheduled departure');
  });

  it('says "arrival" on an arrivals board', () => {
    const cell = delayCell({ ...base, statusKey: 'landed', dir: 'arrivals' });
    expect(cell.title).toBe('Actual vs scheduled arrival');
  });

  it('shows nothing at all for a terminal row', () => {
    for (const statusKey of ['canceled', 'canceled_uncertain', 'diverted']) {
      expect(delayCell({ ...base, statusKey })).toEqual({ kind: 'none' });
    }
  });

  it('does not trust a presumed row s delta unless it is large', () => {
    // A time-inferred "Departed" has no trustworthy actual time behind it.
    const small = delayCell({
      ...base,
      statusKey: 'departed',
      presumed: true,
      actualTimeSec: NOON_UTC + 3 * 60,
    });
    expect(small).toMatchObject({ kind: 'risk' });

    const large = delayCell({ ...base, statusKey: 'departed', presumed: true });
    expect(large).toMatchObject({ kind: 'delta', minutes: 140 });
  });

  it('shows a big delta on a not-yet-operated row', () => {
    const cell = delayCell({
      ...base,
      statusKey: 'delayed',
      hasRealTime: false,
      actualTimeSec: NOON_UTC + 40 * 60,
    });
    expect(cell).toMatchObject({ kind: 'delta', minutes: 40, text: '+40m' });
  });

  it('falls through to the prediction for a future row with no meaningful delta', () => {
    const cell = delayCell({ ...base, statusKey: 'scheduled', actualTimeSec: undefined });
    expect(cell).toEqual({ kind: 'risk', risk });
  });

  it('shows nothing when there is neither a delta nor a risk', () => {
    expect(
      delayCell({ ...base, statusKey: 'scheduled', actualTimeSec: undefined, risk: null }),
    ).toEqual({ kind: 'none' });
  });
});

describe('delayExplainContext', () => {
  it('assembles the payload the dialog reads', () => {
    const context = delayExplainContext({
      ident: 'UA123',
      riskContext: { origCode: 'ORD', destCode: 'DEN', depHub: 'ORD', arrHub: 'DEN' },
      statusText: 'Scheduled',
      risk: { label: 'HIGH', score: 60, factors: ['Ground stop at ORD'] },
      hubOtp: { ORD: 57 },
      weatherOpsByHub: { ORD: { level: 'caution' }, DEN: { level: 'normal' } },
      iropsHubRates: { ORD: { cancellationRate: 3 } },
    });
    expect(context).toMatchObject({
      flight: 'UA123',
      route: 'ORD→DEN',
      status: 'Scheduled',
      riskLabel: 'HIGH',
      riskScore: 60,
      hub: 'ORD',
      otp: 57,
    });
    expect(context.riskFactors).toEqual(['Ground stop at ORD']);
    expect(context.destWeather).toEqual({ level: 'normal' });
  });
});

describe('otpSeverity', () => {
  it('maps the shipped thresholds', () => {
    expect(otpSeverity(100)).toBe('green');
    expect(otpSeverity(70)).toBe('green');
    expect(otpSeverity(69.9)).toBe('amber');
    expect(otpSeverity(50)).toBe('amber');
    expect(otpSeverity(49.9)).toBe('red');
    expect(otpSeverity(0)).toBe('red');
  });

  it('treats "no reading" as its own state, never as zero', () => {
    expect(otpSeverity(null)).toBeNull();
    expect(otpSeverity(undefined)).toBeNull();
    expect(otpSeverity(Number.NaN)).toBeNull();
  });

  it('has a word for every severity, so colour is never alone', () => {
    for (const severity of ['green', 'amber', 'red']) {
      expect(OTP_SEVERITY_LABEL[severity]).toBeTruthy();
    }
  });
});

describe('buildScheduleRow', () => {
  const flight = {
    identification: { number: { default: 'UA912' } },
    aircraft: { model: { code: 'B752', text: 'Boeing 757-200' }, registration: 'N17105' },
    airport: {
      origin: { code: { iata: 'ORD' }, name: "Chicago O'Hare International Airport", info: { terminal: '1', gate: 'C18' } },
      destination: { code: { iata: 'KEF' }, name: 'Keflavik International Airport' },
    },
    time: { scheduled: { departure: NOON_UTC }, real: { departure: NOON_UTC + 54 * 60 } },
  };
  const ctx = {
    hub: 'ORD',
    dir: 'departures',
    dayStartSec: NOON_UTC - 7 * 3600,
    timeZone: CHI,
    reg: 'N17105',
    status: { key: 'departed', text: 'Departed', cls: 'departed' },
    risk: null,
    riskContext: { origCode: 'ORD', destCode: 'KEF', depHub: 'ORD', arrHub: 'KEF' },
    fleetByReg: { N17105: { c: '16J/42E+/118Y', t: '757-200' } },
    starlinkTails: new Set(),
    special: new Map(),
    effectiveTime: NOON_UTC,
  };

  it('shapes a complete row', () => {
    const row = buildScheduleRow(flight, ctx);
    expect(row).toMatchObject({
      ident: 'UA912',
      timeText: '07:00',
      dateChip: null,
      routeLine: 'ORD → KEF',
      routeSub: 'Keflavik',
      acCode: 'B752',
      acShort: '757-200',
      reg: 'N17105',
      regFromLive: false,
      gate: 'T1 · C18',
      special: null,
      swap: null,
      watchRoute: 'ORD→KEF',
    });
    expect(row.actualLine).toMatchObject({ minutes: 54, early: false });
    expect(row.delay).toMatchObject({ kind: 'delta', minutes: 54 });
    expect(row.status).toMatchObject({ key: 'departed', text: 'Departed' });
    expect(row.fleet).toMatchObject({ badge: '16J/42E+/118Y' });
  });

  it('attaches the explain payload only to a risk cell', () => {
    const risk = { label: 'HIGH', score: 60, factors: [] };
    const upcoming = buildScheduleRow(
      { ...flight, time: { scheduled: { departure: NOON_UTC } } },
      { ...ctx, status: { key: 'scheduled', text: 'Scheduled', cls: 'scheduled' }, risk },
    );
    expect(upcoming.delay.kind).toBe('risk');
    expect(upcoming.delay.context).toMatchObject({ flight: 'UA912', route: 'ORD→KEF', riskLabel: 'HIGH' });

    const operated = buildScheduleRow(flight, { ...ctx, risk });
    expect(operated.delay.kind).toBe('delta');
    expect(operated.delay.context).toBeUndefined();
  });

  it('names a special-livery tail', () => {
    const row = buildScheduleRow(flight, {
      ...ctx,
      special: new Map([['N17105', { name: 'Her Art Here — California' }]]),
    });
    expect(row.special).toBe('Her Art Here — California');
  });

  it('survives a row with almost nothing on it', () => {
    const row = buildScheduleRow({}, { ...ctx, reg: '', status: { key: 'unknown' }, fleetByReg: {} });
    expect(row).toMatchObject({
      ident: '—',
      timeText: '—',
      gate: '—',
      reg: '',
      fleet: null,
      delay: { kind: 'none' },
    });
    expect(row.status.text).toBe('Scheduled');
    expect(row.status.asOf).toBe(true);
  });

  it('keys each row distinctly even when two flights share a number', () => {
    const a = buildScheduleRow(flight, ctx);
    const b = buildScheduleRow(
      { ...flight, time: { scheduled: { departure: NOON_UTC + 3600 } } },
      ctx,
    );
    expect(a.key).not.toBe(b.key);
  });
});
