// ═══ HUB PAGE DEPARTURES BOARD — THE PAGE HALF ═══
// What each row of the hub pages' departures board says, from the lean rows /api/hub-board sends
// (src/lib/hub-board.js). Nothing here re-derives a status, a delay or a time: every row goes
// through the dashboard's own pipeline — `classifySchedStatus()` → `buildScheduleRow()` — and the
// phone board's wording helpers, so "Departed*", "Likely Canceled", "≥ +66m" and "→ 14:55" read the
// same on a hub page as on the Schedule tab. This module only picks the fields the widget paints
// and maps status classes onto the content-page tokens.
//
// No DOM, so it is tested directly (tests/hub-board-view.test.js); src/scripts/hub-board.ts fills a
// `<template>` with what it returns.

import { firstFutureIndex } from './board-now.js';
import { dataAgeSeverity, formatDataAge } from './data-age.js';
import { delayColorVar } from './delay-format.js';
import { departureEffectiveTime, HUB_BOARD_DIR, HUB_BOARD_VISIBLE_ROWS } from './hub-board.js';
import { phoneStatusLabel, phoneTimeChange } from './schedule-phone-row.js';
import { hubTzAbbrev } from './schedule-load.js';
import { delayFigure, runwayDelayMarker } from './schedule-row-display.js';
import { buildScheduleRow, formatSchedTime } from './schedule-row-model.js';
import { classifySchedStatus } from './schedule-status.js';

/**
 * `classifySchedStatus().cls` → the status pill's token classes. The same encoding as the
 * dashboard's phone board (`STATUS_PILL` in src/app/views/schedule/tone.ts, which a content page
 * cannot import: it pulls in React shell code). `tests/hub-board-view.test.js` fails if the two
 * drift. The word inside the pill is the signal; the colour never carries it alone.
 */
export const HUB_BOARD_STATUS_PILL = {
  scheduled: 'border-border text-muted-foreground',
  estimated: 'border-bb-info/40 bg-bb-info/10 text-bb-info',
  delayed: 'border-bb-warn/40 bg-bb-warn/15 text-bb-warn',
  departed: 'border-bb-ok/40 bg-bb-ok/10 text-bb-ok',
  enroute: 'border-bb-ok/40 bg-bb-ok/10 text-bb-ok',
  landed: 'border-bb-ok/40 bg-bb-ok/10 text-bb-ok',
  canceled: 'border-destructive/50 bg-destructive/15 text-destructive',
  warn: 'border-bb-warn/40 bg-bb-warn/15 text-bb-warn',
  diverted: 'border-bb-warn/40 bg-bb-warn/15 text-bb-warn',
  unknown: 'border-border text-muted-foreground',
};

/** `delayColorVar()` → text token: the dashboard's `delayToneClass()` (tone.ts), pinned by a test. */
export function delayToneClass(minutes) {
  const colorVar = String(delayColorVar(minutes));
  if (colorVar.includes('red')) return 'text-destructive';
  if (colorVar.includes('yellow')) return 'text-bb-warn';
  return 'text-bb-ok';
}

/** "Tue" for a row from tomorrow's board, in the hub's zone. */
function weekdayChip(seconds, timeZone) {
  try {
    return new Date(seconds * 1000).toLocaleDateString('en-US', { weekday: 'short', timeZone });
  } catch {
    return 'Next day';
  }
}

/**
 * The board's "data as of" line: when the snapshot was BUILT, in hub time with the zone
 * abbreviation, and how old that is. Snapshots are routinely 30 min – 3 h old (the warm cron
 * revisits each board on a ring), so the age is always printed, and `severity` follows the
 * dashboard's own ladder (data-age.js: recent < 1 h ≤ aging < 6 h ≤ stale).
 *
 * @param {{generatedAt?: number|null, timeZone: string}} payload
 * @param {number} nowSec
 * @returns {{time: string, zone: string, age: string, severity: 'recent'|'aging'|'stale'}|null}
 */
export function hubBoardStamp(payload, nowSec) {
  const at = Number(payload?.generatedAt);
  if (!Number.isFinite(at) || at <= 0) return null;
  const ageSec = Math.max(0, nowSec - at);
  return {
    time: formatSchedTime(at, payload.timeZone),
    zone: hubTzAbbrev(payload.timeZone, new Date(at * 1000)),
    age: formatDataAge(ageSec),
    severity: dataAgeSeverity(ageSec),
  };
}

/**
 * The day's board truth as display parts, or null when there is no board.
 *
 * Cancellations keep the provider's distinction: `canceled` is confirmed; `likelyCanceled` is the
 * soft CanceledUncertain state the live feed has not seen fly, labelled as unconfirmed. Before the
 * first departure there is no on-time share, and it is not printed as 0%.
 *
 * @param {{totals?: object|null, partial?: boolean, completeness?: number|null}} payload
 * @returns {{scheduled:number, departed:number, otp:number|null, canceled:number,
 *   likelyCanceled:number, partialPct:number|null}|null}
 */
export function hubBoardTruth(payload) {
  const t = payload?.totals;
  if (!t || !Number.isFinite(Number(t.scheduled)) || Number(t.scheduled) <= 0) return null;
  const departed = Number(t.departed) || 0;
  const otp = departed > 0 && Number.isFinite(Number(t.otp)) && t.otp !== null ? Number(t.otp) : null;
  const completeness = Number(payload?.completeness);
  const partialPct =
    payload?.partial && Number.isFinite(completeness) && completeness < 1 ? Math.round(completeness * 100) : null;
  return {
    scheduled: Number(t.scheduled),
    departed,
    otp,
    canceled: Number(t.canceled) || 0,
    likelyCanceled: Number(t.likelyCanceled) || 0,
    partialPct,
  };
}

/**
 * The rows the page paints, at most `limit`, starting where the dashboard's NOW divider would sit
 * by THIS clock (the CDN copy can be minutes old, so the server sends spares).
 *
 * @param {{hub: string, timeZone: string, dayStart?: number|null, flights?: Array<object>}} payload
 * @param {number} nowSec
 * @param {number} [limit]
 * @returns {Array<object>} view rows — see the return statement for the fields.
 */
export function hubBoardRows(payload, nowSec, limit = HUB_BOARD_VISIBLE_ROWS) {
  const flights = Array.isArray(payload?.flights) ? payload.flights : [];
  if (!flights.length) return [];
  const start = firstFutureIndex(flights.map(departureEffectiveTime), nowSec);
  if (start < 0) return [];
  const hub = String(payload.hub || '');
  const timeZone = payload.timeZone;

  return flights.slice(start, start + limit).map((flight, index) => {
    const status = classifySchedStatus(flight, HUB_BOARD_DIR, nowSec);
    const row = buildScheduleRow(flight, {
      hub,
      dir: HUB_BOARD_DIR,
      dayStartSec: Number(payload.dayStart) || 0,
      timeZone,
      index,
      reg: flight?.aircraft?.registration || '',
      status,
    });
    const label = phoneStatusLabel(row.status);
    const change = phoneTimeChange(row.actualLine);
    const sched = Number(flight?.time?.scheduled?.departure) || 0;
    // routeLine is "ORD → LGA"; the far end is a code, or the airport's name when the provider
    // sent no code (routeCell), in which case routeSub is empty rather than a repeat of the name.
    const dest = row.routeLine.split(' → ').pop() || '—';

    // The one line under the scheduled time: a row from tomorrow's board says which day first (its
    // "06:10" is not today's), else the changed time, else a carried-over date.
    let under = null;
    if (flight?.nextDay) under = { kind: 'day', text: weekdayChip(sched, timeZone), early: false };
    else if (change) under = { kind: 'change', text: `→${change.stamp}`, early: change.early };
    else if (row.dateChip) under = { kind: 'day', text: row.dateChip, early: false };

    let delay = null;
    if (row.delay.kind === 'delta') {
      const figure = delayFigure(row.delay);
      const marker = runwayDelayMarker(row.delay, HUB_BOARD_DIR, row.actualFromRunway);
      delay = {
        glyph: figure.glyph,
        sr: figure.sr,
        value: figure.value,
        title: row.delay.title,
        toneClass: delayToneClass(row.delay.minutes),
        runwayNote: marker ? marker.note : '',
      };
    }

    return {
      key: row.key,
      time: row.timeText,
      under,
      // The changed time is an estimate until the flight has gone (the phone board's sr wording).
      underSr: under?.kind === 'change' ? (row.status.key === 'scheduled' ? 'estimated ' : 'now ') : '',
      ident: row.identDisplay,
      dest,
      destName: row.routeSub || '',
      gate: row.gate === '—' ? '' : row.gate,
      status: {
        label: label.label,
        note: label.note,
        cls: row.status.cls,
        pillClass: HUB_BOARD_STATUS_PILL[row.status.cls] ?? HUB_BOARD_STATUS_PILL.unknown,
        live: row.status.live === true,
        asOf: row.status.asOf === true,
      },
      delay,
    };
  });
}
