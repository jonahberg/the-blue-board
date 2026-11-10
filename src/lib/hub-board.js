// ═══ HUB PAGE DEPARTURES BOARD — THE SERVER HALF ═══
// The prerendered hub pages (/hubs/ord …) show a slice of the dashboard's Schedule board: the next
// departures from now plus one line of board truth for the day. /api/hub-board builds that slice
// from the schedule snapshot the warm cron already wrote (api/_schedule-snapshots.ts) and never
// from a provider — this module is the pure part of it: which rows, which totals, which fields.
//
// It runs in a Vercel function, so everything it imports must be reachable from api/ under native
// Node ESM: no bare JSON, no src/data/facts.js (tests/api-esm-json-imports.test.js walks the graph).
// That is why the row WORDING (status text, delay figure, time format) is not done here: it lives in
// schedule-row-model.js, which reaches facts.js through fleet-utils.js. The page script does the
// wording with the same functions the dashboard's board uses (src/lib/hub-board-view.js).
//
// The board's rows are chosen exactly the way the dashboard places its "── NOW ──" divider
// (board-now.js): sorted by scheduled departure, anchored on each row's effective time, with the
// same 30-minute grace, so a flight that pushed back ten minutes ago is still on the list.

import { computeScheduleStatCounts } from './board-stats.js';
import { effectiveRowTime, firstFutureIndex } from './board-now.js';

/** Rows the endpoint sends. The page shows HUB_BOARD_VISIBLE_ROWS; the spare rows let it drop ones
 *  its own clock has moved past while the CDN copy ages (s-maxage + stale-while-revalidate). */
export const HUB_BOARD_ROWS = 12;

/** Rows the page renders. */
export const HUB_BOARD_VISIBLE_ROWS = 8;

/** The one direction this widget shows. */
export const HUB_BOARD_DIR = 'departures';

/**
 * The snapshot cache key `/api/schedule` reads and the warm cron writes for one hub-day board.
 * The format is a string literal inside `api/schedule.ts` (`agg:${hub}:${dir}:${ts}`), with `ts` the
 * hub-local midnight from `getStartOfHubDay`. There is no exported builder there to reuse, so
 * `tests/hub-board.test.js` pins this against that file's source.
 *
 * @param {string} hub  upper-case IATA.
 * @param {number} dayStartSec  hub-local midnight (unix seconds).
 * @param {'departures'|'arrivals'} [dir]
 * @returns {string}
 */
export function scheduleSnapshotKey(hub, dayStartSec, dir = HUB_BOARD_DIR) {
  return `agg:${hub}:${dir}:${dayStartSec}`;
}

/**
 * A board row with only the fields the page's row model reads: `classifySchedStatus`,
 * `boardTimeEvidence` and `buildScheduleRow`. A snapshot row also carries provider debris (the raw
 * `_source` audit trail, codeshares, the arrival side's info); none of it reaches the page.
 *
 * @param {any} flight  a normalized `/api/schedule` row.
 * @returns {object}
 */
export function trimBoardRow(flight) {
  const f = flight || {};
  const time = f.time || {};
  const leg = (part) => ({
    departure: part?.departure ?? null,
    arrival: part?.arrival ?? null,
  });
  const status = f.status || {};
  const generic = status.generic || {};
  const endpoint = (a, withInfo) => {
    if (!a) return undefined;
    const out = { code: { iata: a.code?.iata || '' } };
    if (a.name) out.name = a.name;
    if (withInfo && a.info) out.info = { gate: a.info.gate ?? null, terminal: a.info.terminal ?? null };
    return out;
  };
  const source = f._source || {};
  const trimmedSource = {};
  for (const key of ['timeSource', 'scheduleTimeDerivedFromActual', 'track', 'seenAirborne', 'liveFeedFallback']) {
    if (source[key] !== undefined) trimmedSource[key] = source[key];
  }
  const out = {
    identification: {
      number: { default: f.identification?.number?.default || '' },
      ...(f.identification?.callsign ? { callsign: f.identification.callsign } : {}),
    },
    time: { scheduled: leg(time.scheduled), estimated: leg(time.estimated), real: leg(time.real) },
    status: {
      text: status.text ?? '',
      live: status.live === true,
      ...(status.icon ? { icon: status.icon } : {}),
      generic: {
        ...(generic.type ? { type: generic.type } : {}),
        status: {
          text: generic.status?.text ?? '',
          ...(generic.status?.diverted ? { diverted: generic.status.diverted } : {}),
        },
      },
    },
    airport: {
      origin: endpoint(f.airport?.origin, true),
      destination: endpoint(f.airport?.destination, false),
    },
    aircraft: {
      model: { code: f.aircraft?.model?.code || '', text: f.aircraft?.model?.text || '' },
      registration: f.aircraft?.registration || '',
      ...(f.aircraft?.regSource ? { regSource: f.aircraft.regSource } : {}),
    },
  };
  if (f.live && typeof f.live === 'object') out.live = { ...f.live };
  if (Object.keys(trimmedSource).length) out._source = trimmedSource;
  return out;
}

/** Scheduled departure, 0 when unknown. */
const schedDep = (fl) => Number(fl?.time?.scheduled?.departure) || 0;

/** The departure board's effective time for one row — the dashboard's NOW anchor (board-now.js). */
export function departureEffectiveTime(fl) {
  return effectiveRowTime({
    scheduled: fl?.time?.scheduled?.departure,
    real: fl?.time?.real?.departure,
    estimated: fl?.time?.estimated?.departure,
  });
}

/**
 * The board's rows in the dashboard's default order (scheduled time ascending), unknown times last.
 *
 * @param {Array<object>} flights
 * @returns {Array<object>} a new array.
 */
export function sortBySchedDeparture(flights) {
  return [...(Array.isArray(flights) ? flights : [])].sort((a, b) => {
    const ta = schedDep(a);
    const tb = schedDep(b);
    if (!ta && !tb) return 0;
    if (!ta) return 1;
    if (!tb) return -1;
    return ta - tb;
  });
}

/**
 * The next departures from `nowSec`: the rows from the dashboard's first-future index on.
 *
 * @param {Array<object>} flights  one board's rows (any order).
 * @param {number} nowSec
 * @param {number} [limit]
 * @returns {Array<object>} at most `limit` rows, in board order; [] when the day is over.
 */
export function selectUpcomingDepartures(flights, nowSec, limit = HUB_BOARD_ROWS) {
  const sorted = sortBySchedDeparture(flights);
  const times = sorted.map(departureEffectiveTime);
  const start = firstFutureIndex(times, nowSec);
  if (start < 0) return [];
  return sorted.slice(start, start + limit);
}

/**
 * One line of board truth for the day, from the dashboard's own stat buckets (board-stats.js).
 * Cancellations are split: `canceled` is provider-confirmed; `likelyCanceled` is AeroDataBox's
 * CanceledUncertain the live feed has not seen fly — mostly wrong, so never presented as confirmed.
 *
 * @param {Array<object>} flights  the day's departures, after the serve-time pipeline.
 * @param {number} nowSec
 * @returns {{scheduled:number, departed:number, onTime:number, late:number, otp:number|null,
 *   canceled:number, likelyCanceled:number, upcoming:number, presumed:number}}
 */
export function hubBoardTotals(flights, nowSec) {
  const counts = computeScheduleStatCounts(flights, { dir: HUB_BOARD_DIR, nowSec });
  return {
    scheduled: counts.total,
    // "Operated" on the dashboard: a recorded departure time, never an estimate (hub-health.js).
    departed: counts.operated,
    onTime: counts.onTime,
    late: counts.late,
    otp: counts.otp,
    canceled: Math.max(0, counts.canceled - counts.canceledUncertain),
    likelyCanceled: counts.canceledUncertain,
    upcoming: counts.upcoming,
    presumed: counts.presumed,
  };
}

/** When the board was built (unix seconds): the payload's own stamp, else when it was stored. */
export function boardGeneratedAtSec(data, refreshedAtMs) {
  const generated = Number(data?.meta?.generatedAt);
  if (Number.isFinite(generated) && generated > 0) return Math.floor(generated);
  const refreshed = Number(refreshedAtMs);
  return Number.isFinite(refreshed) && refreshed > 0 ? Math.floor(refreshed / 1000) : null;
}

/**
 * The endpoint's body when there is nothing to show: no snapshot, or one with no rows. The page
 * keeps its static line; nothing here pretends to be a board.
 *
 * @param {string} hub
 * @param {string} timeZone
 * @param {number} nowSec
 * @param {string} [reason]
 */
export function emptyHubBoard(hub, timeZone, nowSec, reason = 'no-snapshot') {
  return {
    v: 1,
    hub,
    dir: HUB_BOARD_DIR,
    timeZone,
    status: 'empty',
    reason,
    servedAt: nowSec,
    generatedAt: null,
    dayStart: null,
    partial: false,
    completeness: null,
    totals: null,
    flights: [],
    nextDay: null,
  };
}

/**
 * Build the endpoint's body from today's board (and tomorrow's, when today has run out).
 *
 * Both boards arrive already through the serve-time pipeline (sanitize → dedupe → sightings
 * overlay) so a row here reads exactly as it would on `/api/schedule`.
 *
 * @param {object} input
 * @param {string} input.hub
 * @param {string} input.timeZone
 * @param {number} input.nowSec
 * @param {{data:any, refreshedAt:number, dayStart:number, completeness?:number}|null} input.today
 *   `completeness` is `getSnapshotCompleteness()` from api/_schedule-snapshots.ts (0–1).
 * @param {{data:any, refreshedAt:number, dayStart:number}|null} [input.tomorrow]
 * @returns {object}
 */
export function buildHubBoardPayload({ hub, timeZone, nowSec, today, tomorrow = null }) {
  const todayFlights = Array.isArray(today?.data?.flights) ? today.data.flights : [];
  if (!today || todayFlights.length === 0) {
    return emptyHubBoard(hub, timeZone, nowSec, today ? 'empty-board' : 'no-snapshot');
  }

  const upcoming = selectUpcomingDepartures(todayFlights, nowSec, HUB_BOARD_ROWS).map((fl) => trimBoardRow(fl));
  let nextDay = null;
  const tomorrowFlights = Array.isArray(tomorrow?.data?.flights) ? tomorrow.data.flights : [];
  if (upcoming.length < HUB_BOARD_ROWS && tomorrowFlights.length) {
    const need = HUB_BOARD_ROWS - upcoming.length;
    const early = sortBySchedDeparture(tomorrowFlights)
      .filter((fl) => schedDep(fl) > 0)
      .slice(0, need)
      .map((fl) => ({ ...trimBoardRow(fl), nextDay: true }));
    if (early.length) {
      upcoming.push(...early);
      nextDay = {
        dayStart: tomorrow.dayStart,
        generatedAt: boardGeneratedAtSec(tomorrow.data, tomorrow.refreshedAt),
      };
    }
  }

  const completeness =
    typeof today.completeness === 'number' && Number.isFinite(today.completeness) ? today.completeness : null;
  return {
    v: 1,
    hub,
    dir: HUB_BOARD_DIR,
    timeZone,
    status: 'ok',
    servedAt: nowSec,
    generatedAt: boardGeneratedAtSec(today.data, today.refreshedAt),
    dayStart: today.dayStart,
    partial: today.data?.partial === true,
    completeness,
    totals: hubBoardTotals(todayFlights, nowSec),
    flights: upcoming,
    nextDay,
  };
}
