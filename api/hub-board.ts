// Hub page departures board — the live slice of the Schedule board on /hubs/{iata}.
// GET /api/hub-board?hub=ORD   (one of the nine hubs in api/_hubs.ts; anything else → 400)
//
// → 200 { v, hub, dir:'departures', timeZone, status:'ok'|'empty', servedAt, generatedAt, dayStart,
//         partial, completeness, totals, flights:[…up to 12 trimmed rows], nextDay }
//   `flights` are the next departures from now, chosen the way the dashboard places its NOW divider
//   (src/lib/hub-board.js), topped up from tomorrow's board late in the hub's evening. `totals` is
//   the day's board truth: departed (a recorded departure time), on-time share, provider-confirmed
//   cancellations, and "likely canceled" (AeroDataBox's CanceledUncertain the live feed has not seen
//   fly) as its own number. The page words the rows itself (src/lib/hub-board-view.js).
//   With no snapshot for today (or a read failure) the body is `status:'empty'` with `flights: []`
//   and `totals: null`, cached for 60 s — never a 5xx, never an invented board.
//
// ZERO PROVIDER SPEND, BY CONSTRUCTION. Crawlers hit the hub pages, and AeroDataBox is metered, so
// this function only READS what is already stored:
//   1. the schedule snapshot row the warm cron (and /api/schedule's own refreshes) wrote to
//      Supabase — `loadScheduleSnapshot()`, a SELECT on schedule_snapshots; and
//   2. the reg_sightings cache — `awaitRegSightings()`, the same read-only overlay /api/irops uses
//      so a Likely Canceled flight the live feed saw fly is not counted as a cancellation.
// It never imports api/schedule.ts, _schedule-aerodatabox.ts, _cost-state.ts, irops.ts or faa.ts,
// never calls fetch, never writes, and never triggers a refresh. `tests/hub-board-api.test.js`
// pins all of that (fetch stubbed and asserted unused, the mocked client sees only select, and the
// import graph cannot reach a provider module). It is deliberately NOT /api/schedule with flags:
// a first load of an uncached board there may spend units.
//
// Public, unauthenticated, identical for every visitor → CDN-cached (s-maxage=120 + SWR). The
// memos below bound Supabase reads when a caller busts the CDN cache with junk query strings: one
// snapshot read per board per 5 minutes per instance (a board's payload is ~1 MB of JSONB; boards
// are rewritten every 30 min – 3 h, so a 5-minute memo costs nothing in freshness).

import type { VercelRequest, VercelResponse } from './_types.js';
import { createRateLimiter } from './_rate-limit.js';
import { UNITED_HUB_SET } from './_hubs.js';
import { getSnapshotCompleteness, loadScheduleSnapshot, type PersistedScheduleSnapshot } from './_schedule-snapshots.js';
import { awaitRegSightings, type SightingRecord } from './_reg-sightings.js';
import { getStartOfHubDay, HUB_TZ } from '../src/lib/hubTz.js';
import { sanitizeServedBoard } from '../src/lib/schedule-actuals.js';
import { dedupeServedBoard } from '../src/lib/board-dedupe.js';
import { applySightingsToBoard } from '../src/lib/reg-overlay.js';
import {
  HUB_BOARD_DIR,
  HUB_BOARD_ROWS,
  buildHubBoardPayload,
  emptyHubBoard,
  scheduleSnapshotKey,
  selectUpcomingDepartures,
} from '../src/lib/hub-board.js';

// Per instance, and only partial cover on serverless — the memos are what bound Supabase reads.
const isRateLimited = createRateLimiter('hub-board', 30);

export const SNAPSHOT_MEMO_MS = 5 * 60_000;
/** A board that is not there yet is re-asked sooner: the cron may write it any minute. */
export const MISSING_SNAPSHOT_MEMO_MS = 60_000;
export const PAYLOAD_MEMO_MS = 60_000;
export const EMPTY_PAYLOAD_MEMO_MS = 30_000;
/** How long a cold instance waits for the sightings cache before serving without it. */
export const SIGHTINGS_WAIT_MS = 1500;

export const OK_CACHE_CONTROL = 'public, s-maxage=120, stale-while-revalidate=300';
export const EMPTY_CACHE_CONTROL = 'public, s-maxage=60';

const snapshotMemo = new Map<string, { at: number; value: PersistedScheduleSnapshot | null }>();
const snapshotInFlight = new Map<string, Promise<PersistedScheduleSnapshot | null>>();
const payloadMemo = new Map<string, { at: number; body: any }>();

/** Test seam: the module-level memos would otherwise leak across cases. */
export function __resetHubBoardForTests(): void {
  snapshotMemo.clear();
  snapshotInFlight.clear();
  payloadMemo.clear();
}

async function readSnapshot(cacheKey: string, nowMs: number): Promise<PersistedScheduleSnapshot | null> {
  const hit = snapshotMemo.get(cacheKey);
  if (hit && nowMs - hit.at < (hit.value ? SNAPSHOT_MEMO_MS : MISSING_SNAPSHOT_MEMO_MS)) return hit.value;
  const pending = snapshotInFlight.get(cacheKey);
  if (pending) return pending;
  const read = loadScheduleSnapshot(cacheKey)
    .then((value) => {
      snapshotMemo.set(cacheKey, { at: Date.now(), value });
      return value;
    })
    .finally(() => snapshotInFlight.delete(cacheKey));
  snapshotInFlight.set(cacheKey, read);
  return read;
}

/** /api/schedule's serve-time pipeline (withDisruption, minus the FAA peek this board never shows). */
function serveBoard(snapshot: PersistedScheduleSnapshot, sightings: Map<string, SightingRecord>, nowMs: number): any {
  const board = dedupeServedBoard(sanitizeServedBoard(snapshot.data, Math.floor(nowMs / 1000)), HUB_BOARD_DIR);
  return applySightingsToBoard(board, sightings, nowMs, { dir: HUB_BOARD_DIR });
}

function send(res: VercelResponse, body: any) {
  res.setHeader('Cache-Control', body?.status === 'ok' ? OK_CACHE_CONTROL : EMPTY_CACHE_CONTROL);
  return res.status(200).json(body);
}

async function buildBody(hub: string, timeZone: string, nowMs: number): Promise<any> {
  const nowSec = Math.floor(nowMs / 1000);
  const dayStart = getStartOfHubDay(hub, 0, new Date(nowMs));
  const today = await readSnapshot(scheduleSnapshotKey(hub, dayStart), nowMs);
  if (!today) return emptyHubBoard(hub, timeZone, nowSec, 'no-snapshot');

  const sightings = await awaitRegSightings(SIGHTINGS_WAIT_MS);
  const todayBoard = serveBoard(today, sightings, nowMs);

  // Late in the hub's evening today's board runs out; the first rows of tomorrow's board (also
  // cron-warmed, also only read) keep the list full instead of shrinking to two red-eyes.
  let tomorrow = null;
  if (selectUpcomingDepartures(todayBoard?.flights, nowSec, HUB_BOARD_ROWS).length < HUB_BOARD_ROWS) {
    const tomorrowStart = getStartOfHubDay(hub, 1, new Date(nowMs));
    const snap = await readSnapshot(scheduleSnapshotKey(hub, tomorrowStart), nowMs);
    if (snap) {
      tomorrow = { data: serveBoard(snap, sightings, nowMs), refreshedAt: snap.refreshedAt, dayStart: tomorrowStart };
    }
  }

  return buildHubBoardPayload({
    hub,
    timeZone,
    nowSec,
    today: {
      data: todayBoard,
      refreshedAt: today.refreshedAt,
      dayStart,
      completeness: getSnapshotCompleteness(today.data),
    },
    tomorrow,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Same origin rule as /api/airborne-history: the site (and local dev) only.
  const origin = req.headers?.origin || '';
  if (origin && origin !== 'https://theblueboard.co' && !/^http:\/\/localhost(:\d+)?$/.test(String(origin))) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (isRateLimited(req)) {
    // Never let a 429 into the shared CDN cache — it would be served to innocent visitors.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).json({ error: 'Rate limited — try again shortly' });
  }

  const raw = req.query?.hub as unknown;
  const hubParam = Array.isArray(raw) ? raw[0] : raw;
  const hub = typeof hubParam === 'string' ? hubParam.trim().toUpperCase() : '';
  if (!UNITED_HUB_SET.has(hub)) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'hub must be one of the United hubs' });
  }
  const timeZone = (HUB_TZ as Record<string, string>)[hub] || 'America/Chicago';

  const nowMs = Date.now();
  const memo = payloadMemo.get(hub);
  if (memo && nowMs - memo.at < (memo.body?.status === 'ok' ? PAYLOAD_MEMO_MS : EMPTY_PAYLOAD_MEMO_MS)) {
    return send(res, memo.body);
  }

  let body: any;
  try {
    body = await buildBody(hub, timeZone, nowMs);
  } catch (e: any) {
    console.error(`hub-board build failed for ${hub}:`, e?.message || e);
    body = emptyHubBoard(hub, timeZone, Math.floor(nowMs / 1000), 'error');
  }
  payloadMemo.set(hub, { at: nowMs, body });
  return send(res, body);
}
