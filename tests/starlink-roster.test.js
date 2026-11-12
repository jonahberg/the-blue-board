import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  buildIndustryRows,
  daysSinceFound,
  EXPRESS_FAMILIES_LEFT_OUT,
  expressStarlinkScope,
  rolloutBarFigure,
  filterRoster,
  formatVerifyDate,
  freshnessAgo,
  latestScheduledDepartureTs,
  starlinkBoardEmptyText,
  starlinkBoardFooter,
  starlinkScheduleAge,
  starlinkScheduleFreshness,
  starlinkSourceFreshness,
  integrityAlertText,
  ledgerHasData,
  nextFlight,
  operatorLabel,
  relativeDeparture,
  rolloutBars,
  rolloutBarsNote,
  rosterOptions,
  sortRoster,
  starlinkSinceLabel,
  upcomingFlights,
} from '../src/lib/starlink-roster.js';

const NOW = Date.parse('2026-03-10T12:00:00Z');
const NOW_SEC = NOW / 1000;

const ROSTER = [
  { tail: 'N12345', fleet: 'Mainline', type: '737-900', operator: 'United Airlines', dateFound: '2026-03-08' },
  { tail: 'N801SK', fleet: 'Express', type: 'CRJ-550', operator: 'SkyWest dba United Express', dateFound: '2025-10-01' },
  { tail: 'N404RP', fleet: 'Express', type: 'E175', operator: 'Republic Airways', dateFound: '2026-03-09' },
];

describe('filterRoster', () => {
  it('returns everything when no filter is set', () => {
    expect(filterRoster(ROSTER, {}, NOW)).toHaveLength(3);
  });

  it('matches the search against the tail, case-insensitively', () => {
    expect(filterRoster(ROSTER, { search: 'n80' }, NOW).map((r) => r.tail)).toEqual(['N801SK']);
  });

  it('does not match the search against the operator or the type', () => {
    expect(filterRoster(ROSTER, { search: 'SKYWEST' }, NOW)).toHaveLength(0);
    expect(filterRoster(ROSTER, { search: 'E175' }, NOW)).toHaveLength(0);
  });

  it('filters by fleet, type and operator exactly', () => {
    expect(filterRoster(ROSTER, { fleet: 'Express' }, NOW)).toHaveLength(2);
    expect(filterRoster(ROSTER, { type: 'E175' }, NOW).map((r) => r.tail)).toEqual(['N404RP']);
    expect(filterRoster(ROSTER, { operator: 'Republic Airways' }, NOW)).toHaveLength(1);
  });

  it('combines filters with AND', () => {
    expect(filterRoster(ROSTER, { fleet: 'Express', type: 'CRJ-550' }, NOW)).toHaveLength(1);
    expect(filterRoster(ROSTER, { fleet: 'Mainline', type: 'E175' }, NOW)).toHaveLength(0);
  });

  it('keeps only tails found in the last seven days when newOnly is on', () => {
    const tails = filterRoster(ROSTER, { newOnly: true }, NOW).map((r) => r.tail);
    expect(tails).toEqual(['N12345', 'N404RP']);
  });

  it('survives a null roster and null rows', () => {
    expect(filterRoster(null, { search: 'N' }, NOW)).toEqual([]);
    expect(filterRoster([null, ROSTER[0]], {}, NOW)).toHaveLength(1);
  });
});

describe('sortRoster', () => {
  it('sorts ascending and descending by a string column', () => {
    expect(sortRoster(ROSTER, 'tail', true).map((r) => r.tail)).toEqual(['N12345', 'N404RP', 'N801SK']);
    expect(sortRoster(ROSTER, 'tail', false).map((r) => r.tail)).toEqual(['N801SK', 'N404RP', 'N12345']);
  });

  it('does not mutate the input array', () => {
    const input = ROSTER.slice();
    sortRoster(input, 'operator', false);
    expect(input.map((r) => r.tail)).toEqual(['N12345', 'N801SK', 'N404RP']);
  });

  it('treats a missing value as an empty string rather than throwing', () => {
    const rows = [{ tail: 'B' }, { tail: 'A', type: 'E175' }];
    expect(sortRoster(rows, 'type', true).map((r) => r.tail)).toEqual(['B', 'A']);
  });
});

describe('rosterOptions', () => {
  it('lists sorted, de-duplicated types and operators from the data', () => {
    const { types, operators } = rosterOptions([...ROSTER, { tail: 'N9', type: 'E175', operator: 'Republic Airways' }]);
    expect(types).toEqual(['737-900', 'CRJ-550', 'E175']);
    expect(operators).toEqual(['Republic Airways', 'SkyWest dba United Express', 'United Airlines']);
  });

  it('drops blanks and tolerates a null roster', () => {
    expect(rosterOptions([{ tail: 'N1' }, null])).toEqual({ types: [], operators: [] });
    expect(rosterOptions(null)).toEqual({ types: [], operators: [] });
  });
});

describe('nextFlight / upcomingFlights', () => {
  const flights = [
    { flight_number: 'UA1', departure_ts: NOW_SEC - 7200 },
    { flight_number: 'UA2', departure_ts: NOW_SEC - 600 },
    { flight_number: 'UA3', departure_ts: NOW_SEC + 3600 },
    { flight_number: 'UA4', departure_ts: NOW_SEC + 7200 },
    { flight_number: 'UA5', departure_ts: NOW_SEC + 10800 },
    { flight_number: 'UA6', departure_ts: NOW_SEC + 14400 },
    { flight_number: 'UA7', departure_ts: NOW_SEC + 18000 },
  ];

  it('picks a departure inside the 30-minute grace window over the next future one', () => {
    expect(nextFlight(flights, NOW_SEC).flight_number).toBe('UA2');
  });

  it('falls back to the last known flight when everything is in the past', () => {
    const past = flights.slice(0, 1);
    expect(nextFlight(past, NOW_SEC).flight_number).toBe('UA1');
  });

  it('returns null for an empty or missing list', () => {
    expect(nextFlight([], NOW_SEC)).toBeNull();
    expect(nextFlight(undefined, NOW_SEC)).toBeNull();
  });

  it('caps the expansion timeline at five upcoming departures', () => {
    const upcoming = upcomingFlights(flights, NOW_SEC);
    expect(upcoming.map((f) => f.flight_number)).toEqual(['UA2', 'UA3', 'UA4', 'UA5', 'UA6']);
  });

  it('returns an empty timeline rather than past flights', () => {
    expect(upcomingFlights([{ departure_ts: NOW_SEC - 7200 }], NOW_SEC)).toEqual([]);
    expect(upcomingFlights(null, NOW_SEC)).toEqual([]);
  });
});

describe('operatorLabel', () => {
  it('strips the dba certificate tail', () => {
    expect(operatorLabel('SkyWest Airlines dba United Express')).toBe('SkyWest Airlines');
    expect(operatorLabel('Mesa Airlines DBA UAX')).toBe('Mesa Airlines');
  });

  it('leaves a clean operator alone and defaults an empty one to United', () => {
    expect(operatorLabel('Republic Airways')).toBe('Republic Airways');
    expect(operatorLabel('')).toBe('United');
    expect(operatorLabel(undefined)).toBe('United');
  });
});

describe('relativeDeparture', () => {
  it('reports a departure inside the grace window as elapsed', () => {
    expect(relativeDeparture(-600)).toBe('10m ago');
  });

  it('reports sub-hour and multi-hour leads', () => {
    expect(relativeDeparture(45 * 60)).toBe('+45m');
    expect(relativeDeparture(3 * 3600)).toBe('+3h');
    expect(relativeDeparture(3 * 3600 + 20 * 60)).toBe('+3h 20m');
  });
});

describe('freshnessAgo', () => {
  it('scales minutes to hours to days', () => {
    expect(freshnessAgo('2026-03-10T11:48:00Z', NOW)).toBe('12m ago');
    expect(freshnessAgo('2026-03-10T08:00:00Z', NOW)).toBe('4h ago');
    expect(freshnessAgo('2026-03-07T12:00:00Z', NOW)).toBe('3d ago');
  });

  it('returns null when there is no usable timestamp', () => {
    expect(freshnessAgo(null, NOW)).toBeNull();
    expect(freshnessAgo('not a date', NOW)).toBeNull();
  });
});

describe('daysSinceFound / starlinkSinceLabel', () => {
  // `dateFound` is a bare date, so it parses to UTC midnight; the shipped dashboard rounds
  // the elapsed days, which is why a midday NOW reads one day further on than the calendar.
  it('counts whole days and never goes negative', () => {
    expect(daysSinceFound('2026-03-08', NOW)).toBe(3);
    expect(daysSinceFound('2026-03-08', Date.parse('2026-03-10T00:00:00Z'))).toBe(2);
    expect(daysSinceFound('2026-03-20', NOW)).toBe(0);
  });

  it('labels today as today and everything else in days', () => {
    expect(starlinkSinceLabel('2026-03-10', Date.parse('2026-03-10T06:00:00Z'))).toBe('2026-03-10 · today');
    expect(starlinkSinceLabel('2026-03-08', Date.parse('2026-03-10T00:00:00Z'))).toBe('2026-03-08 · 2d ago');
  });

  it('says Unknown rather than inventing a date', () => {
    expect(starlinkSinceLabel(undefined, NOW)).toBe('Unknown');
    expect(daysSinceFound('', NOW)).toBeNull();
  });
});

describe('formatVerifyDate', () => {
  it('formats an ISO timestamp and drops an unparseable one', () => {
    expect(formatVerifyDate('2026-03-04T18:17:00Z')).toMatch(/Mar\s+\d+,\s+2026/);
    expect(formatVerifyDate('nope')).toBe('');
  });
});

describe('buildIndustryRows', () => {
  const airlines = [
    { code: 'ua', name: 'United', installed: 400, total: 1000, percentage: 40 },
    { code: 'AA', name: 'American', installed: 10, total: 900, percentage: '1.1' },
  ];

  it('sorts descending by coverage and flags United', () => {
    const rows = buildIndustryRows(airlines);
    expect(rows.map((r) => r.code)).toEqual(['UA', 'AA']);
    expect(rows[0].isUA).toBe(true);
    expect(rows[1].isUA).toBe(false);
  });

  it('rounds the printed percentage and clamps the bar width', () => {
    const rows = buildIndustryRows([{ code: 'XX', installed: 1, total: 1, percentage: 140 }]);
    expect(rows[0].pct).toBe(140);
    expect(rows[0].width).toBe(100);
  });

  it('renders nothing unless every row has a finite percentage', () => {
    expect(buildIndustryRows([...airlines, { code: 'DL', percentage: null }])).toBeNull();
    expect(buildIndustryRows([...airlines, { code: 'DL', percentage: '' }])).toBeNull();
    expect(buildIndustryRows([...airlines, { code: 'DL', percentage: 'n/a' }])).toBeNull();
    expect(buildIndustryRows([])).toBeNull();
    expect(buildIndustryRows(null)).toBeNull();
  });

  it('keeps installed/total as null rather than guessing when absent', () => {
    const rows = buildIndustryRows([{ code: 'XX', percentage: 5 }]);
    expect(rows[0].installed).toBeNull();
    expect(rows[0].total).toBeNull();
  });
});

// The tracker's /api/fleet-summary as it answered on 2026-11-12 (UA regional families: E175 252/252,
// CRJ-550 102/104, CRJ-200 0/90, ERJ-145 0/55, E170 0/8, CRJ-700 0/4).
const FLEET_SUMMARY_NOV12 = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/fleet-summary-2026-11-12.json'), 'utf8'),
);

/** A fleet-summary with one UA row holding these families (regional unless `body` says otherwise). */
const summaryWith = (families) => [
  {
    code: 'UA',
    name: 'United Airlines',
    installed: 0,
    total: 0,
    percentage: 0,
    families: families.map(([family, installed, total, body = 'regional']) => ({
      family, body, installed, total, percentage: 0,
    })),
  },
];

describe('EXPRESS_FAMILIES_LEFT_OUT', () => {
  it('names exactly the two single-cabin 50-seaters', () => {
    expect([...EXPRESS_FAMILIES_LEFT_OUT]).toEqual(['CRJ-200', 'ERJ-145']);
    expect(Object.isFrozen(EXPRESS_FAMILIES_LEFT_OUT)).toBe(true);
  });
});

describe('expressStarlinkScope (Nov 12 2026: Express counts two-cabin regional jets)', () => {
  it("reads the live Nov 12 payload as 354 / 368 · 96%, with 145 single-cabin jets left out", () => {
    expect(expressStarlinkScope(FLEET_SUMMARY_NOV12.airlines)).toEqual({
      installed: 354, total: 368, pct: 96, leftOut: 145, leftOutFamilies: ['CRJ-200', 'ERJ-145'],
    });
  });

  it('excludes by NAMED family, not by "no installs yet": E170 and CRJ-700 stay in', () => {
    const scope = expressStarlinkScope(summaryWith([
      ['E175', 10, 10], ['CRJ-200', 0, 90], ['ERJ-145', 0, 55], ['E170', 0, 8], ['CRJ-700', 0, 4],
    ]));
    expect(scope).toEqual({
      installed: 10, total: 22, pct: 45, leftOut: 145, leftOutFamilies: ['CRJ-200', 'ERJ-145'],
    });
  });

  it('counts a converted CRJ-450 if the tracker ever lists it', () => {
    const scope = expressStarlinkScope(summaryWith([['E175', 10, 10], ['CRJ-450', 0, 10], ['CRJ-200', 0, 80]]));
    expect(scope.total).toBe(20);
    expect(scope.leftOut).toBe(80);
  });

  it('matches the named families whatever their spelling of case, spaces and hyphens', () => {
    const scope = expressStarlinkScope(summaryWith([['E175', 5, 5], ['crj200', 0, 7], ['ERJ 145', 0, 3]]));
    expect(scope).toEqual({
      installed: 5, total: 5, pct: 100, leftOut: 10, leftOutFamilies: ['CRJ-200', 'ERJ-145'],
    });
  });

  it('only reads the UA row\'s regional families', () => {
    const airlines = [
      { code: 'AS', families: [{ family: 'E175', body: 'regional', installed: 93, total: 93 }] },
      ...summaryWith([['E175', 1, 4], ['B737-800', 100, 141, 'narrowbody']]),
    ];
    expect(expressStarlinkScope(airlines)).toEqual({
      installed: 1, total: 4, pct: 25, leftOut: 0, leftOutFamilies: [],
    });
  });

  it("computes the share from the summed counts, never from the families' own percentages", () => {
    const airlines = summaryWith([['E175', 1, 4], ['CRJ-550', 1, 4]]);
    airlines[0].families.forEach((f) => { f.percentage = 99; });
    expect(expressStarlinkScope(airlines).pct).toBe(25);
  });

  it('is null when there is nothing usable to divide, so the bar is never a guess', () => {
    expect(expressStarlinkScope(null)).toBeNull();
    expect(expressStarlinkScope([])).toBeNull();
    // No UA row, no families, no regional family.
    expect(expressStarlinkScope([{ code: 'AS', families: [] }])).toBeNull();
    expect(expressStarlinkScope([{ code: 'UA', installed: 684, total: 1681, percentage: 40.7 }])).toBeNull();
    expect(expressStarlinkScope(summaryWith([['B787', 2, 97, 'widebody']]))).toBeNull();
    // Only the single-cabin families: no two-cabin denominator.
    expect(expressStarlinkScope(summaryWith([['CRJ-200', 0, 90], ['ERJ-145', 0, 55]]))).toBeNull();
    // One unusable count poisons the sum rather than shrinking it.
    expect(expressStarlinkScope(summaryWith([['E175', 252, 252], ['CRJ-550', null, 104]]))).toBeNull();
    expect(expressStarlinkScope(summaryWith([['E175', 252, 252], ['CRJ-550', 102, '']]))).toBeNull();
    expect(expressStarlinkScope(summaryWith([['E175', 253, 252]]))).toBeNull();
    expect(expressStarlinkScope(summaryWith([['E175', 2.5, 252]]))).toBeNull();
  });
});

describe('rolloutBars', () => {
  const SHARE = { count: 100, total: 1000, pct: 10, source: 'fleet-db' };
  const SCOPE = { installed: 300, total: 400, pct: 75, leftOut: 145 };
  const line = (b) => `${b.label} ${b.installed}/${b.total} ${b.pct}%`;

  it('takes BOTH Express numbers from the fleet-summary scope, never the stats count over its total', () => {
    const bars = rolloutBars({ express: 355, expressTotal: 513, expressPct: 69 }, SHARE, SCOPE);
    expect(bars.map(line)).toEqual(['Express 300/400 75%', 'Mainline 100/1000 10%']);
  });

  it('reads the live Nov 12 payload as Express 354 / 368 · 96%', () => {
    const scope = expressStarlinkScope(FLEET_SUMMARY_NOV12.airlines);
    const express = rolloutBars({ express: 355, expressTotal: 513, expressPct: 69 }, SHARE, scope)[0];
    expect(rolloutBarFigure(express)).toBe('354 / 368 · 96%');
  });

  it("never reads the tracker's expressTotal or expressPct, with or without a scope", () => {
    for (const scope of [SCOPE, null]) {
      const base = rolloutBars({ express: 355 }, SHARE, scope);
      expect(rolloutBars({ express: 355, expressTotal: 513, expressPct: 69 }, SHARE, scope)).toEqual(base);
      expect(rolloutBars({ express: 355, expressTotal: 0, expressPct: null }, SHARE, scope)).toEqual(base);
    }
  });

  it('without a fleet-summary, the Express row is the equipped count with no total and no percentage', () => {
    const bars = rolloutBars({ express: 355, expressTotal: 513, expressPct: 69 }, SHARE, null);
    expect(bars[0]).toEqual({ label: 'Express', installed: 355, total: null, pct: null });
    expect(rolloutBarFigure(bars[0])).toBe('355 equipped');
    expect(bars[1]).toEqual({ label: 'Mainline', installed: 100, total: 1000, pct: 10 });
  });

  it("never prints the tracker's mainline census when the share has a different one", () => {
    const mainline = rolloutBars({ express: 1, mainline: 263, mainlineTotal: 1161 }, {
      count: 263, total: 1139, pct: 23, source: 'fleet-db',
    }, SCOPE).find((b) => b.label === 'Mainline');
    expect(mainline).toEqual({ label: 'Mainline', installed: 263, total: 1139, pct: 23 });
  });

  it('returns null in the degraded tier (no stats) and without a mainline denominator', () => {
    expect(rolloutBars(null, SHARE, SCOPE)).toBeNull();
    expect(rolloutBars({ express: 10 }, null, SCOPE)).toBeNull();
    expect(rolloutBars({ express: 10 }, { count: 0, total: 0, pct: 0 }, SCOPE)).toBeNull();
    // No scope and no equipped count: there is no Express row to print.
    expect(rolloutBars({ mainline: 5 }, SHARE, null)).toBeNull();
  });
});

describe('rolloutBarFigure', () => {
  it('prints a share only when the row has a denominator', () => {
    expect(rolloutBarFigure({ installed: 354, total: 368, pct: 96 })).toBe('354 / 368 · 96%');
    expect(rolloutBarFigure({ installed: 355, total: null, pct: null })).toBe('355 equipped');
  });
});

describe('rolloutBarsNote', () => {
  const DB = { count: 263, total: 1139, pct: 23, source: 'fleet-db' };
  const TRACKER = { count: 263, total: 1161, pct: 23, source: 'tracker' };

  it('says what Express counts and how many single-cabin jets it leaves out, from the data', () => {
    expect(rolloutBarsNote(DB, expressStarlinkScope(FLEET_SUMMARY_NOV12.airlines))).toBe(
      'Mainline: 263 of 1,139 aircraft in our fleet database · Express: per the Starlink tracker. ' +
        'Express counts two-cabin regional jets, the planes United has said will get Starlink. ' +
        'The 145 single-cabin CRJ-200s and ERJ-145s are left out.',
    );
    // The number is the payload's, not a typed 145.
    const other = expressStarlinkScope(summaryWith([['E175', 1, 1], ['CRJ-200', 0, 1000], ['ERJ-145', 0, 234]]));
    expect(rolloutBarsNote(DB, other)).toContain('The 1,234 single-cabin CRJ-200s and ERJ-145s are left out.');
    expect(rolloutBarsNote(TRACKER, other)).toBe(
      'Mainline and Express: per the Starlink tracker. ' +
        'Express counts two-cabin regional jets, the planes United has said will get Starlink. ' +
        'The 1,234 single-cabin CRJ-200s and ERJ-145s are left out.',
    );
  });

  it('never says United excluded the single-cabin jets', () => {
    const note = rolloutBarsNote(DB, expressStarlinkScope(FLEET_SUMMARY_NOV12.airlines));
    expect(note).not.toMatch(/not getting|will not|won't|never get/i);
  });

  it('names only the left-out families the payload lists', () => {
    const crjOnly = expressStarlinkScope(summaryWith([['E175', 3, 4], ['CRJ-200', 0, 9], ['ERJ-145', 0, 0]]));
    expect(crjOnly.leftOutFamilies).toEqual(['CRJ-200']);
    expect(rolloutBarsNote(DB, crjOnly)).toContain('The 9 single-cabin CRJ-200s are left out.');
  });

  it('drops the left-out sentence when the payload lists none of those families', () => {
    expect(rolloutBarsNote(DB, { installed: 1, total: 2, pct: 50, leftOut: 0 })).toBe(
      'Mainline: 263 of 1,139 aircraft in our fleet database · Express: per the Starlink tracker. ' +
        'Express counts two-cabin regional jets, the planes United has said will get Starlink.',
    );
  });

  it('without a fleet-summary, names the Express figure as a count and says nothing about a share', () => {
    expect(rolloutBarsNote(DB, null)).toBe(
      'Mainline: 263 of 1,139 aircraft in our fleet database · Express: equipped count per the Starlink tracker',
    );
    expect(rolloutBarsNote(TRACKER, null)).toBe('Mainline and Express: per the Starlink tracker');
    expect(rolloutBarsNote(null, null)).toBe('');
  });
});

describe('ledgerHasData', () => {
  it('is true when there are disputed rows', () => {
    expect(ledgerHasData([{ tail: 'N1' }], null)).toBe(true);
  });

  it('is true when any summary counter is non-zero', () => {
    expect(ledgerHasData([], { verifiedStarlink: 397 })).toBe(true);
    expect(ledgerHasData([], { unverified: 2 })).toBe(true);
    expect(ledgerHasData([], { totalPlanes: 1815 })).toBe(true);
  });

  it('is false for the zero-filled summary the adapter returns on shape drift', () => {
    expect(ledgerHasData([], { verifiedStarlink: 0, disputed: 0, unverified: 0, totalPlanes: 0 })).toBe(false);
    expect(ledgerHasData([], null)).toBe(false);
    expect(ledgerHasData(undefined, undefined)).toBe(false);
  });
});

describe('integrityAlertText', () => {
  it('agrees the verb with one tail and with several', () => {
    expect(integrityAlertText(new Set(['N34131']))).toContain('1 disputed tail is still present');
    expect(integrityAlertText(new Set(['N1', 'N2']))).toContain('2 disputed tails are still present');
  });

  it('names the tails and tells the reader what to do', () => {
    const text = integrityAlertText(new Set(['N1', 'N2']));
    expect(text).toContain('N1, N2');
    expect(text).toContain('check the data pipeline');
  });
});

// Nov 2026: the board said "updated 16d ago" (the tracker's frozen lastUpdated) above rows whose
// times count down live. These read OUR sync time and where the payload was served from.
describe('Starlink schedule freshness', () => {
  const NOW_MS = Date.parse('2026-11-11T21:48:00Z');
  const synced22h = '2026-11-11T00:00:19.635Z';
  const synced2h = '2026-11-11T19:48:00Z';

  it('a fresh sync: "schedule synced 2h ago · airborne live"', () => {
    expect(starlinkScheduleFreshness({ syncedAt: synced2h, servedFrom: 'supabase', nowMs: NOW_MS })).toBe('schedule synced 2h ago · airborne live');
    expect(starlinkScheduleAge({ syncedAt: synced2h, servedFrom: 'memory', nowMs: NOW_MS })).toEqual({ ago: '2h ago', stale: false });
  });

  it('the tracker offline: "tracker offline, schedule from 22h ago" (stale source or older than 6 h)', () => {
    expect(starlinkScheduleFreshness({ syncedAt: synced22h, servedFrom: 'supabase-stale', nowMs: NOW_MS })).toBe('tracker offline, schedule from 22h ago');
    // Older than 6 h is stale whatever the source says.
    expect(starlinkScheduleFreshness({ syncedAt: synced22h, servedFrom: 'supabase', nowMs: NOW_MS })).toBe('tracker offline, schedule from 22h ago');
    // A stale source is stale even when the copy is young.
    expect(starlinkScheduleFreshness({ syncedAt: synced2h, servedFrom: 'memory-stale', nowMs: NOW_MS })).toBe('tracker offline, schedule from 2h ago');
  });

  it('no sync time (the static roster, or an old payload) says only "scheduled times"', () => {
    expect(starlinkScheduleFreshness({ syncedAt: '', servedFrom: 'static', nowMs: NOW_MS })).toBe('scheduled times');
    expect(starlinkScheduleFreshness({ syncedAt: null, nowMs: NOW_MS })).toBe('scheduled times');
    expect(starlinkScheduleAge({ syncedAt: '', servedFrom: 'static', nowMs: NOW_MS })).toEqual({ ago: null, stale: true });
  });

  it('latestScheduledDepartureTs finds the end of the stored schedule', () => {
    expect(latestScheduledDepartureTs({ A: [{ departure_ts: 10 }, { departure_ts: 30 }], B: [{ departure_ts: 20 }], C: 'x' })).toBe(30);
    expect(latestScheduledDepartureTs({})).toBeNull();
    expect(latestScheduledDepartureTs(null)).toBeNull();
  });

  it('an empty window when the stored schedule has run out says the feed is offline, not "no departures"', () => {
    const nowSec = NOW_MS / 1000;
    const base = { hub: 'SFO', windowH: 12, nowSec, syncedAt: '2026-11-11T00:00:19Z', servedFrom: 'supabase-stale' };
    expect(starlinkBoardEmptyText({ ...base, latestDepartureTs: nowSec - 60 }))
      .toBe('The Starlink schedule feed is offline and the last schedule we have (synced 22h ago) has run out, so this board cannot show departures.');
    expect(starlinkBoardEmptyText({ ...base, latestDepartureTs: null, syncedAt: '' }))
      .toBe('The Starlink schedule feed is offline, so this board cannot show departures.');
    expect(starlinkBoardEmptyText({ ...base, latestDepartureTs: nowSec + 86400 }))
      .toBe('No United Starlink departures from SFO in the next 12h on the schedule synced 22h ago (the tracker is offline).');
    expect(starlinkBoardEmptyText({ ...base, hub: null, servedFrom: 'supabase', syncedAt: '2026-11-11T20:00:00Z', latestDepartureTs: nowSec + 86400 }))
      .toBe('No United Starlink departures from the hubs in the next 12h.');
  });

  it('the footer states the schedule age instead of "cache (up to 6h)"', () => {
    const fresh = starlinkBoardFooter({ syncedAt: synced2h, servedFrom: 'supabase', nowMs: NOW_MS });
    expect(fresh).toContain("from the tracker's schedule synced 2h ago");
    expect(fresh).not.toMatch(/up to 6h/);
    expect(starlinkBoardFooter({ syncedAt: synced22h, servedFrom: 'supabase-stale', nowMs: NOW_MS }))
      .toContain('from the last schedule we have (synced 22h ago; the tracker is offline)');
    expect(starlinkBoardFooter({ syncedAt: '', nowMs: NOW_MS })).toContain('Times are scheduled. Airborne marks come from the live flight feed — not live ATC.');
  });
});

// v1.28.0: the tab's source line ("Starlink data via … · <freshness> · 681 aircraft") used to say
// "Updated 16d ago" from the tracker's frozen field, and "live" when the field was missing.
describe('starlinkSourceFreshness', () => {
  const NOW = Date.UTC(2026, 10, 11, 22, 0, 0);
  const ago = (h) => new Date(NOW - h * 3600_000).toISOString();

  it('is the schedule freshness when there is a sync time', () => {
    expect(starlinkSourceFreshness({ syncedAt: ago(2), servedFrom: 'supabase', nowMs: NOW })).toBe('schedule synced 2h ago · airborne live');
    expect(starlinkSourceFreshness({ syncedAt: ago(22), servedFrom: 'supabase-stale', nowMs: NOW })).toBe('tracker offline, schedule from 22h ago');
    // No servedFrom (production before v1.28.0): the age alone decides.
    expect(starlinkSourceFreshness({ syncedAt: ago(22), nowMs: NOW })).toBe('tracker offline, schedule from 22h ago');
  });

  it('is null — the line says nothing about freshness — without one', () => {
    expect(starlinkSourceFreshness({ syncedAt: null, servedFrom: 'static', nowMs: NOW })).toBeNull();
    expect(starlinkSourceFreshness({ syncedAt: '', nowMs: NOW })).toBeNull();
    expect(starlinkSourceFreshness({ nowMs: NOW })).toBeNull();
  });
});

