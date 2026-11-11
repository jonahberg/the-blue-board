// The flight page's data — one United flight number, from stored data only.
// GET /api/flight?ident=UA929   (ua929, UA 929, UAL929 and 929 are accepted; anything else → 400)
//
// → 200 { v, ident, status: 'ok' | 'not-found' | 'unavailable', servedAt,
//         leg: { row, source: 'board'|'history', dir, hub, serviceDate, boardAt } | null,
//         aircraft: {...} | null,
//         history: { origin, dest, today, rows: [...] } | null,
//         tail: { reg, rows: [...] } | null,
//         lastSeen: { date, origin, dest } | null }
//   `leg.row` is the board's own row for the leg "now" (merged across its departures and arrivals
//   boards, sightings overlay applied), trimmed; the page words it with src/lib/flight-verdict.js.
//   A well-formed number we do not have is `status: 'not-found'` (200, briefly cached) — never a
//   404 page and never an invented flight. A database failure is `status: 'unavailable'`.
//
// ZERO PER-REQUEST COST, BY CONSTRUCTION. Crawlers load flight pages and the schedule provider is
// metered, so this function only READS what the site already stores:
//   1. flight_history (the archive, sql/021) for the number — one primary-key range read; for the
//      tail's recent legs — one read narrowed by date; a number with no archive rows answers
//      not-found without reading anything else;
//   2. at most two schedule snapshot rows (the leg's departures and arrivals boards), through the
//      same loadScheduleSnapshot() /api/hub-board uses, memoized per board for 5 minutes;
//   3. the reg_sightings cache (awaitRegSightings, the read-only overlay /api/irops uses);
//   4. the Starlink roster from the stored tracker snapshot (starlink_snapshot, one JSON path), or
//      the committed public/data/starlink.json; and public/data/fleet.json from the bundle.
// It never imports api/schedule.ts, _schedule-aerodatabox.ts, _cost-state.ts, flight-times.ts,
// _official-fr24.ts or the live-feed modules, never calls fetch, never writes. The tests in
// tests/flight-api.test.js pin all of that (fetch stubbed and asserted unused, the mocked client
// records every method and allows only reads, and the import graph cannot reach a provider).
//
// Public, unauthenticated, identical for every visitor → CDN-cached 60 s + SWR. The payload memo
// below bounds Supabase reads when a caller busts the CDN with junk query strings.

import { createRequire } from 'node:module';
import type { VercelRequest, VercelResponse } from './_types.js';
import { getQuery } from './_query.js';
import { createRateLimiter } from './_rate-limit.js';
import { getSupabaseAdmin, loadScheduleSnapshot, type PersistedScheduleSnapshot } from './_schedule-snapshots.js';
import { awaitRegSightings, type SightingRecord } from './_reg-sightings.js';
import { normalizeFlightNum } from '../src/lib/reg-ledger.js';
import { HUB_TZ } from '../src/lib/hubTz.js';
import { localDate } from '../src/lib/flight-history.js';
import { applyVerifiedStarlinkOverrides } from '../src/lib/starlink-overrides.js';
import { addDays, HISTORY_WINDOW_DAYS, parseFlightIdent, pickScheduleLeg, sortTailLegs } from '../src/lib/flight-page.js';
import {
  HISTORY_COLUMNS,
  TAIL_COLUMNS,
  aircraftFacts,
  boardHubFor,
  boardKeysForLeg,
  boardRowForLeg,
  historyLegs,
  indexStarlinkRoster,
  legRegistration,
  pickCurrentLeg,
  trimBoardRow,
} from '../src/lib/flight-page-data.js';

const isRateLimited = createRateLimiter('flight', 30);

export const OK_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=300';
export const NOT_FOUND_CACHE_CONTROL = 'public, s-maxage=120, stale-while-revalidate=300';
export const UNAVAILABLE_CACHE_CONTROL = 'public, s-maxage=30';

export const PAYLOAD_MEMO_MS = 60_000;
export const SNAPSHOT_MEMO_MS = 5 * 60_000;
export const ROSTER_MEMO_MS = 60 * 60_000;
/** How long a cold instance waits for the sightings cache before answering without it. */
export const SIGHTINGS_WAIT_MS = 1500;
/** At most this many distinct flights' payloads are memoized per instance. */
const PAYLOAD_MEMO_MAX = 300;

const payloadMemo = new Map<string, { at: number; body: any }>();
const snapshotMemo = new Map<string, { at: number; value: PersistedScheduleSnapshot | null }>();
const snapshotInFlight = new Map<string, Promise<PersistedScheduleSnapshot | null>>();
let rosterMemo: { at: number; map: Map<string, any> } | null = null;
let fleetCache: any[] | null = null;
let staticRosterCache: any[] | null = null;

/** Test seam: the module-level memos would otherwise leak across cases. */
export function __resetFlightForTests(): void {
  payloadMemo.clear();
  snapshotMemo.clear();
  snapshotInFlight.clear();
  rosterMemo = null;
}

// Loaded lazily via createRequire, never a bare JSON import (api/starlink-data.ts explains why), in
// the exact shape that file uses (a const-bound require, a literal path) so @vercel/nft traces it;
// vercel.json `includeFiles` names both files as well, so a missed trace cannot drop them.
function loadFleet(): any[] {
  if (fleetCache) return fleetCache;
  try {
    const requireJson = createRequire(import.meta.url);
    const data = requireJson('../public/data/fleet.json');
    fleetCache = Array.isArray(data) ? data : [];
  } catch (err: any) {
    console.error('flight: fleet data unavailable:', err?.message || err);
    fleetCache = [];
  }
  return fleetCache;
}

function loadStaticRoster(): any[] {
  if (staticRosterCache) return staticRosterCache;
  try {
    const requireJson = createRequire(import.meta.url);
    const data = requireJson('../public/data/starlink.json');
    staticRosterCache = Array.isArray(data) ? data : [];
  } catch {
    staticRosterCache = [];
  }
  return staticRosterCache;
}

/** The Starlink roster the dashboard uses: the stored tracker snapshot's aircraft, else the committed list. */
async function loadRoster(supabase: any, nowMs: number): Promise<Map<string, any>> {
  if (rosterMemo && nowMs - rosterMemo.at < ROSTER_MEMO_MS) return rosterMemo.map;
  let list: any[] | null = null;
  try {
    const { data, error } = await supabase
      .from('starlink_snapshot')
      .select('aircraft:payload->aircraft')
      .eq('key', 'current')
      .limit(1);
    const aircraft = !error && Array.isArray(data) ? data[0]?.aircraft : null;
    if (Array.isArray(aircraft) && aircraft.length) list = aircraft;
  } catch {
    /* fall back to the committed roster */
  }
  const map = indexStarlinkRoster(applyVerifiedStarlinkOverrides(list || loadStaticRoster()));
  rosterMemo = { at: nowMs, map };
  return map;
}

async function readSnapshot(key: string, nowMs: number): Promise<PersistedScheduleSnapshot | null> {
  const hit = snapshotMemo.get(key);
  if (hit && nowMs - hit.at < SNAPSHOT_MEMO_MS) return hit.value;
  const pending = snapshotInFlight.get(key);
  if (pending) return pending;
  const read = loadScheduleSnapshot(key)
    .then((value) => {
      if (snapshotMemo.size > 60) snapshotMemo.delete(snapshotMemo.keys().next().value as string);
      snapshotMemo.set(key, { at: Date.now(), value });
      return value;
    })
    .finally(() => snapshotInFlight.delete(key));
  snapshotInFlight.set(key, read);
  return read;
}

async function readBoards(keys: { key: string; hub: string; dir: 'departures' | 'arrivals' }[], nowMs: number) {
  const boards = await Promise.all(
    keys.map(async (k) => {
      const snap = await readSnapshot(k.key, nowMs);
      return snap ? { dir: k.dir, hub: k.hub, data: snap.data, refreshedAt: snap.refreshedAt } : null;
    }),
  );
  return boards.filter((b): b is NonNullable<typeof b> => b !== null);
}

type Body = Record<string, any>;

function base(ident: string, nowSec: number, status: string): Body {
  return { v: 1, ident, status, servedAt: nowSec, leg: null, aircraft: null, history: null, tail: null, lastSeen: null };
}

const historyRowsForRoute = (rows: any[], origin: string, dest: string, since: string) =>
  rows
    .filter((r) => r.origin === origin && r.dest === dest && r.service_date >= since)
    .map((r) => ({
      service_date: r.service_date,
      origin: r.origin,
      dest: r.dest,
      outcome: r.outcome,
      final: r.final,
      sched_dep: r.sched_dep,
      dep_at: r.dep_at,
      dep_basis: r.dep_basis,
    }));

async function buildBody(ident: string, nowMs: number): Promise<Body> {
  const nowSec = Math.floor(nowMs / 1000);
  const supabase = await getSupabaseAdmin();
  if (!supabase) return base(ident, nowSec, 'unavailable');

  const utcToday = new Date(nowMs).toISOString().slice(0, 10);
  const { data: histData, error: histError } = await supabase
    .from('flight_history')
    .select(HISTORY_COLUMNS.join(','))
    .eq('flight_no', ident)
    .gte('service_date', addDays(utcToday, -(HISTORY_WINDOW_DAYS + 2)))
    .order('service_date', { ascending: false })
    .limit(240);
  if (histError) {
    console.error(`flight: history read failed for ${ident}:`, histError.message);
    return base(ident, nowSec, 'unavailable');
  }
  // Newest first (the query orders so; sorted again so nothing below depends on it).
  const hist: any[] = (Array.isArray(histData) ? [...histData] : []).sort(
    (a, b) => String(b.service_date).localeCompare(String(a.service_date)) || (Number(b.sched_dep) || 0) - (Number(a.sched_dep) || 0),
  );
  // Never flown in the archive's window: nothing to read, nothing to invent.
  if (!hist.length) return base(ident, nowSec, 'not-found');

  const sightings: Map<string, SightingRecord> = await awaitRegSightings(SIGHTINGS_WAIT_MS);
  const sighting = sightings.get(normalizeFlightNum(ident) || ident) || null;

  // 1. The leg "now", from the archive.
  const current = pickCurrentLeg(historyLegs(hist, nowSec, sightings), nowSec, sighting);

  // 2. Its board row: only that leg's boards are read. Without an archive leg near today, today's
  //    boards for the number's most recent route are read once, in case the archive lags the board.
  const route = current ? { origin: current.history.origin, dest: current.history.dest } : { origin: hist[0].origin, dest: hist[0].dest };
  let boardLeg: ReturnType<typeof boardRowForLeg> = null;
  if (current) {
    const h = current.history;
    const keys = boardKeysForLeg({
      origin: h.origin,
      dest: h.dest,
      schedDepSec: (Number(h.sched_dep) || Number(h.dep_at) || 0) * 60,
      schedArrSec: (Number(h.sched_arr) || Number(h.arr_at) || 0) * 60,
    });
    const boards = await readBoards(keys, nowMs);
    boardLeg = boardRowForLeg(boards, { ident, origin: h.origin, dest: h.dest, schedDepSec: (Number(h.sched_dep) || Number(h.dep_at) || 0) * 60 }, nowSec, sightings);
  } else {
    const keys = boardKeysForLeg({ origin: route.origin, dest: route.dest, schedDepSec: nowSec, schedArrSec: nowSec });
    const boards = await readBoards(keys, nowMs);
    const candidates = boards.flatMap((b) =>
      (Array.isArray(b.data?.flights) ? b.data.flights : [])
        .filter((f: any) => String(f?.identification?.number?.default || '').toUpperCase() === ident
          && String(f?.airport?.origin?.code?.iata || '').toUpperCase() === route.origin)
        .map((row: any) => ({ row, schedDep: Number(row?.time?.scheduled?.departure) || 0 })),
    );
    const picked = pickScheduleLeg(candidates, nowSec, sighting);
    if (picked) {
      boardLeg = boardRowForLeg(boards, { ident, origin: route.origin, dest: route.dest, schedDepSec: picked.schedDep }, nowSec, sightings);
    }
  }

  const row = boardLeg?.row || current?.row || null;
  const boardHub = boardHubFor(route);
  const hubToday = boardHub ? localDate((HUB_TZ as Record<string, string>)[boardHub.hub], nowSec) : utcToday;
  const serviceDate = current?.history?.service_date
    || (row && boardHub ? localDate((HUB_TZ as Record<string, string>)[boardHub.hub], Number(row?.time?.scheduled?.departure) || nowSec) : hubToday);
  // The record ends the day before the leg at the top of the page (a red-eye still flying from
  // yesterday is the page's subject, not a square).
  const recordToday = serviceDate && serviceDate < hubToday ? serviceDate : hubToday;
  const history = {
    origin: route.origin,
    dest: route.dest,
    today: recordToday,
    rows: historyRowsForRoute(hist, route.origin, route.dest, addDays(recordToday, -HISTORY_WINDOW_DAYS)),
  };

  if (!row) {
    return {
      ...base(ident, nowSec, 'not-found'),
      history,
      lastSeen: { date: hist[0].service_date, origin: hist[0].origin, dest: hist[0].dest },
    };
  }

  // 3. The aircraft and its recent legs.
  const reg = legRegistration(row, current?.history, sighting);
  const roster = await loadRoster(supabase, nowMs);
  const aircraft = aircraftFacts(reg, {
    fleet: loadFleet(),
    starlink: roster,
    modelCode: row?.aircraft?.model?.code || current?.history?.aircraft_code || '',
    modelText: row?.aircraft?.model?.text || '',
    operator: current?.history?.operator || '',
  });

  let tail = null;
  if (reg) {
    const { data: tailData, error: tailError } = await supabase
      .from('flight_history')
      .select(TAIL_COLUMNS.join(','))
      .eq('registration', reg)
      .gte('service_date', addDays(utcToday, -3))
      .limit(60);
    if (tailError) console.error(`flight: tail read failed for ${reg}:`, tailError.message);
    else tail = { reg, rows: sortTailLegs(Array.isArray(tailData) ? tailData : []).slice(0, 30) };
  }

  const source = boardLeg ? 'board' : 'history';
  return {
    ...base(ident, nowSec, 'ok'),
    leg: {
      row: trimBoardRow(row),
      source,
      dir: boardLeg?.dir || boardHub?.dir || 'departures',
      hub: boardLeg?.hub || boardHub?.hub || null,
      serviceDate,
      boardAt: boardLeg?.boardAtSec || (Number(current?.history?.last_seen) || 0) * 60 || null,
    },
    aircraft,
    history,
    tail,
  };
}

function cacheControlFor(body: Body): string {
  if (body?.status === 'ok') return OK_CACHE_CONTROL;
  if (body?.status === 'not-found') return NOT_FOUND_CACHE_CONTROL;
  return UNAVAILABLE_CACHE_CONTROL;
}

/**
 * The payload for one canonical ident, memoized per instance — shared by the share-card function
 * (api/flight-card.ts) so the card and the page say the same thing.
 */
export async function loadFlightPayload(ident: string, nowMs = Date.now()): Promise<Body> {
  const memo = payloadMemo.get(ident);
  if (memo && nowMs - memo.at < PAYLOAD_MEMO_MS) return memo.body;
  let body: Body;
  try {
    body = await buildBody(ident, nowMs);
  } catch (e: any) {
    console.error(`flight: build failed for ${ident}:`, e?.message || e);
    body = base(ident, Math.floor(nowMs / 1000), 'unavailable');
  }
  if (payloadMemo.size >= PAYLOAD_MEMO_MAX) payloadMemo.delete(payloadMemo.keys().next().value as string);
  payloadMemo.set(ident, { at: nowMs, body });
  return body;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Same origin rule as /api/hub-board: the site (and local dev) only.
  const origin = req.headers?.origin || '';
  if (origin && origin !== 'https://theblueboard.co' && !/^http:\/\/localhost(:\d+)?$/.test(String(origin))) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (isRateLimited(req)) {
    // Never let a 429 into the shared CDN cache.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).json({ error: 'Rate limited — try again shortly' });
  }

  const parsed = parseFlightIdent(getQuery(req).ident as unknown);
  if (!parsed) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'ident must be a United flight number, like UA929' });
  }

  const body = await loadFlightPayload(parsed.ident);
  res.setHeader('Cache-Control', cacheControlFor(body));
  return res.status(200).json(body);
}
