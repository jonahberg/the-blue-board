import { describe, it, expect } from 'vitest';

import {
  buildIndustryRows,
  daysSinceFound,
  filterRoster,
  formatVerifyDate,
  freshnessAgo,
  integrityAlertText,
  ledgerHasData,
  nextFlight,
  operatorLabel,
  relativeDeparture,
  rolloutBars,
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

describe('rolloutBars', () => {
  it('uses the given percentages when upstream supplies them', () => {
    const bars = rolloutBars({
      express: 300, expressTotal: 500, expressPct: 60,
      mainline: 100, mainlineTotal: 1000, mainlinePct: 10,
    });
    expect(bars.map((b) => `${b.label} ${b.installed}/${b.total} ${b.pct}%`)).toEqual([
      'Express 300/500 60%',
      'Mainline 100/1000 10%',
    ]);
  });

  it('derives a missing percentage from the counts', () => {
    const bars = rolloutBars({ express: 250, expressTotal: 500, mainline: 1, mainlineTotal: 4 });
    expect(bars[0].pct).toBe(50);
    expect(bars[1].pct).toBe(25);
  });

  it('returns null without fleet denominators, so the degraded tier shows no bars', () => {
    expect(rolloutBars(null)).toBeNull();
    expect(rolloutBars({ express: 10, mainline: 5 })).toBeNull();
    expect(rolloutBars({ express: 10, expressTotal: 0, mainline: 5, mainlineTotal: 9 })).toBeNull();
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
