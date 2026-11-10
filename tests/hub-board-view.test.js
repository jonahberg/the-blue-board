// The page half of the hub pages' departures board (src/lib/hub-board-view.js). Every word must
// be the dashboard's: the rows run through classifySchedStatus → buildScheduleRow and the phone
// board's helpers, and the colour map must stay the phone board's STATUS_PILL.
import { describe, expect, it } from 'vitest';

import { delayColorVar } from '../src/lib/delay-format.js';
import { buildHubBoardPayload } from '../src/lib/hub-board.js';
import {
  HUB_BOARD_STATUS_PILL,
  delayToneClass,
  hubBoardRows,
  hubBoardStamp,
  hubBoardTruth,
} from '../src/lib/hub-board-view.js';
import { STATUS_PILL, delayToneClass as dashboardDelayTone } from '../src/app/views/schedule/tone';
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

const payloadFor = (board, nowSec = NOW_SEC, extra = {}) =>
  buildHubBoardPayload({
    hub: 'ORD',
    timeZone: 'America/Chicago',
    nowSec,
    today: { data: board, refreshedAt: nowSec * 1000, dayStart: ORD_DAY_START, completeness: 1 },
    ...extra,
  });

describe('the colour encoding is the dashboard phone board’s', () => {
  it('HUB_BOARD_STATUS_PILL is STATUS_PILL from tone.ts, key for key', () => {
    expect(HUB_BOARD_STATUS_PILL).toEqual(STATUS_PILL);
  });

  it('delayToneClass agrees with the dashboard’s delayToneClass(delayColorVar())', () => {
    for (const m of [-12, 0, 5, 15, 16, 45, 60, 61, 208]) {
      expect(delayToneClass(m)).toBe(dashboardDelayTone(delayColorVar(m)));
    }
  });

  it('uses only declared tokens and nothing under the 11px content floor', () => {
    const classes = Object.values(HUB_BOARD_STATUS_PILL).join(' ');
    expect(classes).not.toMatch(/text-\[(8|9|10)px\]/);
    expect(classes).not.toMatch(/\b(amber|emerald|red|green|yellow|violet|sky|blue)-\d{2,3}\b/);
  });
});

describe('hubBoardRows', () => {
  it('words each row exactly as the Schedule board does', () => {
    const rows = hubBoardRows(payloadFor(ordBoard()), NOW_SEC);
    expect(rows).toHaveLength(8);
    const [first, second, third] = rows;

    // UA104 pushed back 17 minutes ago, 3 minutes late: a fact, in the dashboard's format.
    expect(first).toMatchObject({ time: '14:40', ident: 'UA104', dest: 'BOS', destName: 'Boston', gate: 'T1 · C18' });
    expect(first.status).toMatchObject({ label: 'Departed', cls: 'departed', live: false });
    expect(first.status.pillClass).toBe(STATUS_PILL.departed);
    expect(first.delay).toMatchObject({ value: '+3m', glyph: '', toneClass: 'text-bb-ok' });
    expect(first.under).toBeNull(); // a delta inside ±5 min gets no "→ HH:MM" line

    expect(second).toMatchObject({ ident: 'UA105', time: '15:10', delay: null });
    expect(second.status).toMatchObject({ label: 'Expected', cls: 'scheduled' });

    // UA106: estimated 45 min late — "Expected" in the delayed tone, the new time under the old.
    expect(third.status).toMatchObject({ label: 'Expected', cls: 'delayed' });
    expect(third.delay).toMatchObject({ value: '+45m', toneClass: 'text-bb-warn' });
    expect(third.under).toEqual({ kind: 'change', text: '→16:05', early: false });
    expect(third.underSr).toBe('now ');
  });

  it('drops rows the client clock has moved past (the CDN copy may be minutes old)', () => {
    const payload = payloadFor(ordBoard());
    const later = hubBoardRows(payload, NOW_SEC + 40 * 60);
    expect(later.map((r) => r.ident)).not.toContain('UA104');
    expect(later[0].ident).toBe('UA105');
    expect(hubBoardRows(payload, NOW_SEC + 24 * 3600)).toEqual([]);
  });

  it('labels Likely Canceled as the provider’s soft state, never as Canceled', () => {
    const board = ordBoard();
    board.flights.push(
      makeRow({ ident: 'UA5999', sched: cst('15:05'), text: 'canceleduncertain', generic: 'canceled_uncertain', dest: 'CMH' }),
      makeRow({ ident: 'UA777', sched: cst('15:06'), text: 'canceled', generic: 'canceled', dest: 'CLE' }),
    );
    const rows = hubBoardRows(payloadFor(board), NOW_SEC);
    const likely = rows.find((r) => r.ident === 'UA5999');
    const confirmed = rows.find((r) => r.ident === 'UA777');
    expect(likely.status).toMatchObject({ label: 'Likely Canceled', cls: 'warn' });
    expect(likely.delay).toBeNull();
    expect(confirmed.status).toMatchObject({ label: 'Canceled', cls: 'canceled' });
  });

  it('badges a departure the live feed confirmed as LIVE', () => {
    const row = makeRow({ ident: 'UA150', sched: cst('14:50'), dest: 'MSY', destName: 'New Orleans' });
    row.live = { seenAt: (NOW_SEC - 5 * 60) * 1000 }; // the sightings overlay's stamp (reg-overlay.js)
    const [view] = hubBoardRows(payloadFor({ flights: [row], total: 1, meta: {} }), NOW_SEC);
    expect(view.status).toMatchObject({ label: 'Departed', cls: 'departed', live: true });
  });

  it('strips a provider letter suffix and keeps the hub-local 24-hour time', () => {
    const board = { flights: [makeRow({ ident: 'UA526H', sched: cst('15:30'), dest: 'DSM' })], total: 1, meta: {} };
    const [row] = hubBoardRows(payloadFor(board), NOW_SEC);
    expect(row).toMatchObject({ ident: 'UA526', time: '15:30' });
  });

  it('says which day a row from tomorrow’s board is, instead of a bare early-morning time', () => {
    const now = cst('22:30');
    const payload = payloadFor(lateEveningBoard(), now, {
      tomorrow: { data: tomorrowBoard(), refreshedAt: now * 1000, dayStart: ORD_TOMORROW_START },
    });
    const rows = hubBoardRows(payload, now);
    expect(rows[0].under).toBeNull();
    expect(rows[2]).toMatchObject({ ident: 'UA300', time: '05:00', under: { kind: 'day', text: 'Wed', early: false } });
  });

  it('shows the airport name when no code is recoverable, without repeating it underneath', () => {
    const row = makeRow({ ident: 'UA9', sched: cst('15:30') });
    row.airport.destination = { code: { iata: '' }, name: 'Traverse City Cherry Capital Airport' };
    const [view] = hubBoardRows(payloadFor({ flights: [row], total: 1, meta: {} }), NOW_SEC);
    expect(view.dest).toBe('Traverse City Cherry Capital');
    expect(view.destName).toBe('');
  });
});

describe('hubBoardStamp', () => {
  it('stamps the board’s build time in hub time with the zone, and its age', () => {
    expect(hubBoardStamp(payloadFor(ordBoard()), NOW_SEC)).toEqual({
      time: '14:18',
      zone: 'CST',
      age: '42m',
      severity: 'recent',
    });
  });

  it('follows the dashboard’s age ladder and names the Pacific zones', () => {
    const old = { generatedAt: NOW_SEC - 3 * 3600, timeZone: 'Asia/Tokyo' };
    expect(hubBoardStamp(old, NOW_SEC)).toMatchObject({ zone: 'JST', age: '3h', severity: 'aging' });
    expect(hubBoardStamp({ generatedAt: NOW_SEC - 7 * 3600, timeZone: 'Pacific/Guam' }, NOW_SEC)).toMatchObject({
      zone: 'ChST',
      severity: 'stale',
    });
    expect(hubBoardStamp({ generatedAt: null, timeZone: 'America/Chicago' }, NOW_SEC)).toBeNull();
  });
});

describe('hubBoardTruth', () => {
  it('reports departures, on-time share and the two kinds of cancellation separately', () => {
    expect(hubBoardTruth(payloadFor(ordBoard()))).toEqual({
      scheduled: 16,
      departed: 3,
      otp: 67,
      canceled: 1,
      likelyCanceled: 1,
      partialPct: null,
    });
  });

  it('prints no on-time share before the first departure, and flags a partial board', () => {
    const early = { flights: [makeRow({ ident: 'UA1', sched: cst('16:00') })], total: 1, partial: true, meta: {} };
    const payload = buildHubBoardPayload({
      hub: 'ORD',
      timeZone: 'America/Chicago',
      nowSec: NOW_SEC,
      today: { data: early, refreshedAt: 0, dayStart: ORD_DAY_START, completeness: 0.62 },
    });
    expect(hubBoardTruth(payload)).toMatchObject({ departed: 0, otp: null, partialPct: 62 });
  });

  it('is null for the empty state', () => {
    expect(hubBoardTruth({ status: 'empty', totals: null })).toBeNull();
    expect(hubBoardRows({ status: 'empty', flights: [] }, NOW_SEC)).toEqual([]);
  });
});
