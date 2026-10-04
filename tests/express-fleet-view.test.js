// The Fleet tab's United Express sub-tab, the flight panel and the aircraft dialog: what they say
// about an Express tail, from buildExpressFleet() entries.
import { describe, expect, it } from 'vitest';

import {
  EXPRESS_FLEET_SIZE_ESTIMATE,
  expressCountRows,
  expressCoverageNote,
  expressDateLabel,
  expressLastSeenLabel,
  expressOperatorLine,
  expressWifiLabel,
  filterExpressFleet,
  sortExpressFleet,
} from '../src/lib/express-fleet-view.js';
import { buildExpressFleet, summarizeExpressFleet } from '../src/lib/express-fleet.js';

// /api/express-fleet rows from the Oct 4 2026 table, plus one roster-only Starlink tail.
const TAILS = [
  { r: 'N85377', op: 'SKW', ft: null, m: 'E175', lf: 'UA5928', fs: '2026-10-01T06:00:00Z', ls: '2026-10-04T18:00:24Z' },
  { r: 'N14148', op: 'UCA', ft: null, m: null, lf: 'UA4226', fs: '2026-10-01T05:00:00Z', ls: '2026-10-04T18:13:06Z' },
  { r: 'N504GJ', op: 'GJS', ft: null, m: null, lf: 'UA4437', fs: '2026-10-01T04:00:00Z', ls: '2026-10-04T18:13:07Z' },
  { r: 'N946SW', op: 'SKW', ft: null, m: 'CRJ2', lf: 'UA5102', fs: '2026-10-01T06:00:00Z', ls: '2026-10-04T18:13:07Z' },
  { r: 'N140SY', op: 'SKW', ft: null, m: 'E175', lf: 'UA6005', fs: '2026-10-01T05:00:00Z', ls: '2026-10-02T12:00:00Z' },
];
const ROSTER = [
  { tail: 'N140SY', fleet: 'Express', type: 'E175SC', operator: 'SkyWest dba UAX' },
  { tail: 'N642SY', fleet: 'Express', type: 'E175SC', operator: 'SkyWest dba UAX' },
  { tail: 'N37502', fleet: 'Mainline', type: '737 MAX 9' },
];
const FLEET = buildExpressFleet(TAILS, ROSTER);

describe('expressOperatorLine', () => {
  it('names the operator and the brand', () => {
    expect(expressOperatorLine({ o: 'SkyWest Airlines' })).toBe('SkyWest Airlines · United Express');
    expect(expressOperatorLine({ o: '' })).toBe('United Express');
    expect(expressOperatorLine(null)).toBe('United Express');
  });
});

describe('expressWifiLabel', () => {
  it('Starlink from the roster, "No Wi-Fi" only when verified, otherwise nothing', () => {
    expect(expressWifiLabel({ w: 'Starlink' })).toBe('Starlink');
    expect(expressWifiLabel({ w: 'None' })).toBe('No Wi-Fi');
    expect(expressWifiLabel({ w: '' })).toBe('');
    expect(expressWifiLabel(null)).toBe('');
    // The caller's roster test wins over a type-level "None".
    expect(expressWifiLabel({ w: 'None' }, true)).toBe('Starlink');
  });

  it('the CRJ200 in the fixture is verified Wi-Fi-free; the bare SkyWest E175 is unknown', () => {
    expect(expressWifiLabel(FLEET.find((e) => e.r === 'N946SW'))).toBe('No Wi-Fi');
    expect(expressWifiLabel(FLEET.find((e) => e.r === 'N85377'))).toBe('');
  });
});

describe('filterExpressFleet', () => {
  it('finds by registration, dash or case aside', () => {
    expect(filterExpressFleet(FLEET, 'n85-377').map((e) => e.r)).toEqual(['N85377']);
    expect(filterExpressFleet(FLEET, '504').map((e) => e.r)).toEqual(['N504GJ']);
  });

  it('finds by operator, type, Wi-Fi and last United flight', () => {
    expect(filterExpressFleet(FLEET, 'commutair').map((e) => e.r)).toEqual(['N14148']);
    expect(filterExpressFleet(FLEET, 'crj200').map((e) => e.r)).toEqual(['N946SW']);
    expect(filterExpressFleet(FLEET, 'starlink').map((e) => e.r).sort()).toEqual(['N140SY', 'N642SY']);
    expect(filterExpressFleet(FLEET, 'UA4226').map((e) => e.r)).toEqual(['N14148']);
    expect(filterExpressFleet(FLEET, 'gjs').map((e) => e.r)).toEqual(['N504GJ']);
  });

  it('an empty search is the whole list; nothing matching is empty', () => {
    expect(filterExpressFleet(FLEET, '  ')).toHaveLength(FLEET.length);
    expect(filterExpressFleet(FLEET, 'zzz')).toEqual([]);
    expect(filterExpressFleet(null, 'x')).toEqual([]);
  });
});

describe('sortExpressFleet', () => {
  it('sorts by registration either way', () => {
    const asc = sortExpressFleet(FLEET, 'r', true).map((e) => e.r);
    expect(asc).toEqual(['N140SY', 'N14148', 'N504GJ', 'N642SY', 'N85377', 'N946SW']);
    expect(sortExpressFleet(FLEET, 'r', false).map((e) => e.r)).toEqual([...asc].reverse());
  });

  it('keeps blanks last in BOTH directions', () => {
    // GoJet boards send no model code, so N504GJ's type is unknown. (CommutAir has none either, but
    // it flies only the ERJ145 for United, so its type follows from the operator.)
    const byTypeAsc = sortExpressFleet(FLEET, 't', true).map((e) => e.t);
    const byTypeDesc = sortExpressFleet(FLEET, 't', false).map((e) => e.t);
    expect(byTypeAsc.slice(-1)).toEqual(['']);
    expect(byTypeDesc.slice(-1)).toEqual(['']);
    expect(byTypeAsc).toContain('ERJ145');
    expect(byTypeAsc[0]).toBe('CRJ200');
    // Wi-Fi: the two Starlink tails lead whichever way it is flipped.
    expect(sortExpressFleet(FLEET, 'w', false).slice(0, 2).map((e) => e.w)).toEqual(['Starlink', 'Starlink']);
    // The roster-only tail has never been seen: last, both ways.
    expect(sortExpressFleet(FLEET, 'ls', true).at(-1).r).toBe('N642SY');
    expect(sortExpressFleet(FLEET, 'ls', false).at(-1).r).toBe('N642SY');
  });

  it('sorts last-seen as time, newest first when descending', () => {
    expect(sortExpressFleet(FLEET, 'ls', false)[0].r).toBe('N504GJ');
    expect(sortExpressFleet(FLEET, 'ls', true)[0].r).toBe('N140SY');
  });

  it('does not mutate its input and treats an unknown column as registration', () => {
    const before = FLEET.map((e) => e.r);
    sortExpressFleet(FLEET, 'ls', false);
    expect(FLEET.map((e) => e.r)).toEqual(before);
    expect(sortExpressFleet(FLEET, 'nope', true).map((e) => e.r)).toEqual(sortExpressFleet(FLEET, 'r', true).map((e) => e.r));
  });
});

describe('date labels', () => {
  const NOW = Date.parse('2026-10-04T18:30:00Z');

  it('first seen is a full short date, in UTC by default', () => {
    expect(expressDateLabel('2026-10-01T05:00:00Z', 'UTC')).toBe('Oct 1, 2026');
    // A backfilled hub-local midnight stays Oct 1 whatever the viewer's zone.
    expect(expressDateLabel('2026-10-01T07:00:00Z')).toBe('Oct 1, 2026');
    expect(expressDateLabel('2026-10-01T04:00:00Z', 'America/Los_Angeles')).toBe('Sep 30, 2026');
    expect(expressDateLabel('', 'UTC')).toBe('');
    expect(expressDateLabel('garbage', 'UTC')).toBe('');
  });

  it('last seen is relative inside a day, then a short date', () => {
    expect(expressLastSeenLabel('2026-10-04T18:13:07Z', NOW, 'UTC')).toBe('17m ago');
    expect(expressLastSeenLabel('2026-10-04T13:30:00Z', NOW, 'UTC')).toBe('5h ago');
    expect(expressLastSeenLabel('2026-10-02T12:00:00Z', NOW, 'UTC')).toBe('Oct 2');
    expect(expressLastSeenLabel('2026-10-04T18:31:00Z', NOW, 'UTC')).toBe('just now');
    expect(expressLastSeenLabel('', NOW, 'UTC')).toBe('');
  });
});

describe('summary rows and the coverage note', () => {
  it('orders operators and types by count, unknown last', () => {
    const summary = summarizeExpressFleet(FLEET);
    expect(summary.total).toBe(6);
    expect(summary.starlink).toBe(2);
    expect(expressCountRows(summary.byOperator)).toEqual([
      { label: 'SkyWest Airlines', count: 4 },
      { label: 'CommutAir', count: 1 },
      { label: 'GoJet Airlines', count: 1 },
    ]);
    expect(expressCountRows(summary.byType)).toEqual([
      { label: 'E175', count: 3 },
      { label: 'CRJ200', count: 1 },
      { label: 'ERJ145', count: 1 },
      { label: 'Unknown type', count: 1 },
    ]);
    expect(expressCountRows(null)).toEqual([]);
  });

  it('says how much of the Express fleet has been found, and how', () => {
    expect(expressCoverageNote(472, 45)).toBe(
      `Discovered from United Express flights seen in the last 45 days — about 472 of ~${EXPRESS_FLEET_SIZE_ESTIMATE} aircraft; it fills in as more fly.`,
    );
  });
});
