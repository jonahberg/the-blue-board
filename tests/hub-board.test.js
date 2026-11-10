// The server half of the hub pages' departures board (src/lib/hub-board.js): which rows, which
// totals, which fields leave the function. The rows must be the ones the dashboard's NOW divider
// would show; the totals must keep confirmed and likely cancellations apart.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  HUB_BOARD_ROWS,
  buildHubBoardPayload,
  emptyHubBoard,
  hubBoardTotals,
  scheduleSnapshotKey,
  selectUpcomingDepartures,
  sortBySchedDeparture,
  trimBoardRow,
} from '../src/lib/hub-board.js';
import { getStartOfHubDay } from '../src/lib/hubTz.js';
import {
  NOW_SEC,
  ORD_DAY_START,
  ORD_TOMORROW_START,
  cst,
  lateEveningBoard,
  makeRow,
  ordBoard,
  tomorrowBoard,
} from './fixtures/hub-board-board.js';

const idents = (rows) => rows.map((r) => r.identification.number.default);

describe('scheduleSnapshotKey', () => {
  it('builds the agg:HUB:dir:dayStart key api/schedule.ts reads and the warm cron writes', () => {
    expect(scheduleSnapshotKey('ORD', 1794290400)).toBe('agg:ORD:departures:1794290400');
    expect(scheduleSnapshotKey('NRT', 1, 'arrivals')).toBe('agg:NRT:arrivals:1');
  });

  it('matches the literal in api/schedule.ts (there is no exported builder to import)', () => {
    const src = readFileSync(resolve(__dirname, '..', 'api', 'schedule.ts'), 'utf8');
    // The key is built from the hub-local midnight getStartOfHubDay returns…
    expect(src).toContain('const ts = getStartOfHubDay(hub, 0, new Date(tsParam * 1000));');
    // …in exactly this format. If either line changes, this widget reads the wrong row.
    expect(src).toContain('const currentAggKey = `agg:${hub}:${dir}:${ts}`;');
  });

  it('uses the same hub-local midnight as /api/schedule for the fixture clock', () => {
    expect(getStartOfHubDay('ORD', 0, new Date(NOW_SEC * 1000))).toBe(ORD_DAY_START);
    expect(getStartOfHubDay('ORD', 1, new Date(NOW_SEC * 1000))).toBe(ORD_TOMORROW_START);
  });
});

describe('selectUpcomingDepartures', () => {
  it('starts where the dashboard NOW divider sits: after the last row more than 30 min past', () => {
    const rows = selectUpcomingDepartures(ordBoard().flights, NOW_SEC);
    // UA104 left 17 minutes ago — inside the grace, so it leads; everything earlier is gone.
    expect(idents(rows).slice(0, 3)).toEqual(['UA104', 'UA105', 'UA106']);
    expect(idents(rows)).not.toContain('UA101');
    expect(rows).toHaveLength(HUB_BOARD_ROWS);
  });

  it('sorts by scheduled departure whatever order the snapshot stored', () => {
    const sorted = sortBySchedDeparture(ordBoard().flights);
    const times = sorted.map((r) => r.time.scheduled.departure);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('keeps a held flight (estimate in the future) only where the dashboard would', () => {
    const board = [
      makeRow({ ident: 'UA1', sched: cst('13:00'), real: cst('13:01'), text: 'departed', generic: 'departed' }),
      makeRow({ ident: 'UA2', sched: cst('13:30'), est: cst('16:30'), generic: 'estimated' }),
      makeRow({ ident: 'UA3', sched: cst('14:00'), real: cst('14:02'), text: 'departed', generic: 'departed' }),
      makeRow({ ident: 'UA4', sched: cst('15:30') }),
    ];
    // firstFutureIndex anchors after the last resolved-past row, so the held UA2 (sorted among
    // departed rows) stays above the divider — exactly as on the Schedule tab (F96).
    expect(idents(selectUpcomingDepartures(board, NOW_SEC))).toEqual(['UA4']);
  });

  it('returns [] when the day is over, and skips rows with no time', () => {
    const board = [
      makeRow({ ident: 'UA1', sched: cst('09:00'), real: cst('09:01'), text: 'departed', generic: 'departed' }),
      { ...makeRow({ ident: 'UA2', sched: 0 }) },
    ];
    expect(selectUpcomingDepartures(board, NOW_SEC)).toEqual([]);
    expect(selectUpcomingDepartures(undefined, NOW_SEC)).toEqual([]);
  });
});

describe('trimBoardRow', () => {
  it('keeps what the row model reads and drops provider debris', () => {
    const row = makeRow({ ident: 'UA105', sched: cst('15:10'), reg: 'N37502' });
    row.live = { seenAt: 1, etaSec: 2 };
    row._source.track = { airborneAt: 5 };
    const trimmed = trimBoardRow(row);
    expect(trimmed.identification.number.default).toBe('UA105');
    expect(trimmed.time.scheduled.departure).toBe(cst('15:10'));
    expect(trimmed.status.generic.status.text).toBe('scheduled');
    expect(trimmed.airport.origin.info).toEqual({ gate: 'C18', terminal: '1' });
    expect(trimmed.airport.destination).toEqual({ code: { iata: 'LGA' }, name: 'New York' });
    expect(trimmed.aircraft.registration).toBe('N37502');
    expect(trimmed.live).toEqual({ seenAt: 1, etaSec: 2 });
    expect(trimmed._source.track).toEqual({ airborneAt: 5 });
    expect(trimmed._source.timeSource).toBeTruthy();
    expect(trimmed._source.rawProviderBlob).toBeUndefined();
    expect(trimmed.codeshares).toBeUndefined();
    expect(trimmed.airline).toBeUndefined();
    expect(JSON.stringify(trimmed).length).toBeLessThan(JSON.stringify(row).length);
  });

  it('does not throw on a sparse row', () => {
    expect(() => trimBoardRow({})).not.toThrow();
    expect(trimBoardRow(null).identification.number.default).toBe('');
  });
});

describe('hubBoardTotals', () => {
  it('splits confirmed cancellations from likely ones and counts only recorded departures', () => {
    const totals = hubBoardTotals(ordBoard().flights, NOW_SEC);
    expect(totals.scheduled).toBe(16);
    expect(totals.canceled).toBe(1); // UA102, provider-confirmed
    expect(totals.likelyCanceled).toBe(1); // UA5103, CanceledUncertain — never shown as confirmed
    expect(totals.departed).toBe(3); // UA100, UA101, UA104 have real departure times
    expect(totals.onTime).toBe(2);
    expect(totals.late).toBe(1); // UA101 left 45 min late
    expect(totals.otp).toBe(67);
  });

  it('has no on-time share before the first departure', () => {
    const board = [makeRow({ ident: 'UA1', sched: cst('16:00') })];
    expect(hubBoardTotals(board, NOW_SEC)).toMatchObject({ departed: 0, otp: null, scheduled: 1 });
  });

  it('a Likely Canceled row that has a real departure time is a departure, not a cancellation', () => {
    const board = [
      makeRow({ ident: 'UA5', sched: cst('12:00'), real: cst('12:10'), text: 'canceleduncertain', generic: 'canceled_uncertain' }),
    ];
    expect(hubBoardTotals(board, NOW_SEC)).toMatchObject({ likelyCanceled: 0, canceled: 0, departed: 1 });
  });
});

describe('buildHubBoardPayload', () => {
  const base = { hub: 'ORD', timeZone: 'America/Chicago', nowSec: NOW_SEC };

  it('returns the lean board with totals, stamps and trimmed rows', () => {
    const board = ordBoard();
    const body = buildHubBoardPayload({
      ...base,
      today: { data: board, refreshedAt: (NOW_SEC - 30 * 60) * 1000, dayStart: ORD_DAY_START, completeness: 1 },
    });
    expect(body).toMatchObject({
      v: 1,
      hub: 'ORD',
      dir: 'departures',
      status: 'ok',
      servedAt: NOW_SEC,
      generatedAt: NOW_SEC - 42 * 60, // meta.generatedAt wins over refreshed_at
      dayStart: ORD_DAY_START,
      partial: false,
      completeness: 1,
      nextDay: null,
    });
    expect(body.flights).toHaveLength(HUB_BOARD_ROWS);
    expect(body.flights[0]._source.rawProviderBlob).toBeUndefined();
    expect(body.totals.likelyCanceled).toBe(1);
  });

  it('falls back to refreshed_at when the board carries no generatedAt', () => {
    const board = { ...ordBoard(), meta: {} };
    const body = buildHubBoardPayload({
      ...base,
      today: { data: board, refreshedAt: 1_794_000_000_500, dayStart: ORD_DAY_START },
    });
    expect(body.generatedAt).toBe(1_794_000_000);
    expect(body.completeness).toBeNull();
  });

  it('tops a late-evening board up from tomorrow and marks those rows', () => {
    const now = cst('22:30');
    const body = buildHubBoardPayload({
      ...base,
      nowSec: now,
      today: { data: lateEveningBoard(), refreshedAt: now * 1000, dayStart: ORD_DAY_START },
      tomorrow: { data: tomorrowBoard(), refreshedAt: now * 1000, dayStart: ORD_TOMORROW_START },
    });
    expect(idents(body.flights).slice(0, 3)).toEqual(['UA901', 'UA902', 'UA300']);
    expect(body.flights).toHaveLength(HUB_BOARD_ROWS);
    expect(body.flights[0].nextDay).toBeUndefined();
    expect(body.flights[2].nextDay).toBe(true);
    expect(body.nextDay).toEqual({ dayStart: ORD_TOMORROW_START, generatedAt: cst('20:00') });
    // The day's truth is still today's board alone.
    expect(body.totals.scheduled).toBe(3);
  });

  it('is an honest empty state with no snapshot, or a snapshot with no rows', () => {
    expect(buildHubBoardPayload({ ...base, today: null })).toEqual(emptyHubBoard('ORD', 'America/Chicago', NOW_SEC));
    const empty = buildHubBoardPayload({
      ...base,
      today: { data: { flights: [], total: 0 }, refreshedAt: 0, dayStart: ORD_DAY_START },
    });
    expect(empty).toMatchObject({ status: 'empty', reason: 'empty-board', flights: [], totals: null });
  });

  it('carries a partial board honestly', () => {
    const board = { ...ordBoard(), partial: true };
    const body = buildHubBoardPayload({
      ...base,
      today: { data: board, refreshedAt: 0, dayStart: ORD_DAY_START, completeness: 0.6 },
    });
    expect(body.partial).toBe(true);
    expect(body.completeness).toBe(0.6);
  });
});
