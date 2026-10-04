// Flight Times API — departure/arrival times for one United flight number
// Usage: /api/flight-times?flight=UA2221[&date=YYYY-MM-DD][&from=ORD][&dep=<epoch s>][&officialFallback=0]
// `from` pins the leg DEPARTING that airport — a multi-leg flight number (UA786 ICT→ORD→LGA)
// otherwise resolves to whichever leg is in the air, which is not the one a connecting
// passenger boards (live audit Sep 28 2026, D2).
// `dep` pins the leg by its SCHEDULED departure (epoch seconds or ISO): the answer is that leg or a
// 404, never another day's. The watch cron asks this way once a watch is tied to one dated leg, so a
// hub-day rollover can never swap the leg under it (Oct 4 2026 audit, finding 2).
//
// Status is built from the best evidence for the leg (Oct 4 2026 audit, finding 1): the SAME leg's
// arrivals-board row (destination hub) lends its arrival times and further-along status to the
// departures row, and the reg_sightings ledger upgrades a leg the live feed saw airborne to departed
// and one it then saw on the ground at the destination to landed (src/lib/watch-leg.js).
// Returns scheduled, estimated, and actual gate/takeoff/landing times
//
// Source chain (Jul 3 2026 audit: FlightAware's bot-wall serves a parseable trackpollBootstrap
// with ZERO flights, which the old code treated as authoritative "No active flight found" —
// killing the endpoint for every flight):
//   1. FlightAware scrape (source: 'flightaware'). From Vercel's egress it is bot-walled or
//      answers HTTP 402/403 (Sep 2026 audit F135), so it gets a short 3s budget before the chain
//      moves on rather than holding every lookup for 10s.
//   2. Schedule snapshot layer (source: 'schedule-cache') — the hub boards already hold
//      sched/est/real times and gates server-side; free, and the only tier that knows a leg
//      before it departs.
//   3. FR24 Official API flight-summary — ON by default, turned off by
//      SCHEDULE_OFFICIAL_FALLBACK_ENABLED=false and skipped for officialFallback=0 callers. Used
//      as an OVERLAY on the board's leg (source: 'schedule-cache+fr24': takeoff/landing actuals,
//      tail, airborne/landed), or alone (source: 'fr24', timesUnavailable) when no board lists
//      the flight — and then only for a leg that is live or just ended (Sep 2026 audit F0/F1).
// Only when ALL tiers fail does the endpoint return success:false with a reason.

import type { VercelRequest, VercelResponse } from './_types.js';
import { icaoToIata } from '../src/lib/airport-metadata.js';
import { isOfficialFr24Enabled, isOfficialApiQuotaBlocked, recordOfficialApi402, fr24Datetime, pickFr24SummaryLeg, FR24_LEG_EARLY_MS } from './_official-fr24.js';
import { airportTz } from '../src/lib/time-format.js';
import { loadScheduleSnapshot } from './_schedule-snapshots.js';
import { UNITED_HUBS } from './_hubs.js';
import { getStartOfHubDay, getHubLocalDate } from '../src/lib/hubTz.js';
import { sanitizeBoardFlights } from '../src/lib/schedule-actuals.js';
import { applySightingsToBoard } from '../src/lib/reg-overlay.js';
import { awaitRegSightings, type SightingRecord } from './_reg-sightings.js';
import { applyLegEvidence, mergeLegRows } from '../src/lib/watch-leg.js';
import { normalizeFlightNum } from '../src/lib/reg-ledger.js';

// ═══ Registration + date-aware candidate ranking (F001, F005/F013) ═══

// FlightAware's trackpollBootstrap carries the tail number, but the exact field
// name has drifted across page versions. Try the plausible shapes in priority
// order and validate against a registration-ish token; return '' when none is
// present (the client degrades to "tail not yet assigned" rather than a fake
// lookup). The type string stays in the separate `aircraft` field.
export function extractFaRegistration(f: any): string {
  const raw =
    (typeof f?.aircraft === 'string' ? f.aircraft : '') ||
    f?.aircraft?.registration || f?.aircraft?.tail ||
    f?.registration || f?.tailNumber || f?.aircraftTailNumber ||
    f?.flightPlan?.tailNumber || '';
  const reg = String(raw || '').replace(/-/g, '').toUpperCase().trim();
  return /^[A-Z0-9]{2,8}$/.test(reg) ? reg : '';
}

export type FaPhase = 'inair' | 'landed' | 'scheduled';
export interface FaCandidate { flight: any; key: string; phase: FaPhase; depSec: number; localDate: string; }

// Local calendar date (YYYY-MM-DD) of a departure epoch, in the origin timezone
// the FlightAware payload reports. Falls back to UTC when the tz is absent.
export function faLocalDate(depSec: number, tz: string): string {
  if (!depSec) return '';
  const zone = (tz || '').replace(/^:/, '') || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(depSec * 1000));
  } catch {
    return new Date(depSec * 1000).toISOString().slice(0, 10);
  }
}

// Pick the most relevant FlightAware candidate. When a target date is supplied
// (F013), candidates whose local departure date matches win outright. Within a
// tier, the phase preference is in-air > current/future scheduled > landed >
// stale (past-scheduled, never departed) — REVERSING the old "any past LANDED
// leg beats today's scheduled leg" bug (F005). Scheduled ties pick the SOONEST
// upcoming leg, not the furthest-future one.
export function pickBestFaCandidate(
  candidates: FaCandidate[], targetDate: string, nowSec: number
): FaCandidate | null {
  if (!candidates.length) return null;
  const rank = (c: FaCandidate): number => {
    if (c.phase === 'inair') return 3;
    if (c.phase === 'scheduled' && c.depSec >= nowSec - 1800) return 2;
    if (c.phase === 'landed') return 1;
    return 0; // stale: scheduled but the departure time is well in the past
  };
  const sorted = candidates.slice().sort((a, b) => {
    if (targetDate) {
      const ad = a.localDate === targetDate ? 1 : 0;
      const bd = b.localDate === targetDate ? 1 : 0;
      if (ad !== bd) return bd - ad;
    }
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return rb - ra;
    // Same phase: soonest upcoming for scheduled, most-recent for everything else.
    if (ra === 2) return a.depSec - b.depSec;
    return b.depSec - a.depSec;
  });
  return sorted[0];
}

const CACHE_TTL_MS = 60_000; // 1 minute
// FlightAware is bot-walled from Vercel (F135): don't let a dead tier add 10s to every lookup.
const FLIGHTAWARE_TIMEOUT_MS = 3_000;
const cache = new Map<string, { data: any; ts: number }>();

function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.data;
}
function setCache(key: string, data: any): void {
  if (cache.size > 200) { const oldest = cache.keys().next().value; if (oldest !== undefined) cache.delete(oldest); }
  cache.set(key, { data, ts: Date.now() });
}

// Rate limiting: 30 req/min per IP
const rateLimitByIp = new Map<string, number[]>();

/** Test seam: module state (response cache, snapshot memo, rate-limit log) otherwise leaks
 *  between tests and makes them order-dependent (F138). */
export function __resetFlightTimesCache(): void {
  cache.clear();
  rateLimitByIp.clear();
  snapshotMemo.clear();
}
export function getClientIp(req: VercelRequest): string {
  const realIp = req.headers?.['x-real-ip'];
  if (realIp) return Array.isArray(realIp) ? realIp[0] : realIp;
  const xff = req.headers?.['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : (typeof xff === 'string' ? xff : '');
  return raw.split(',')[0]?.trim() || 'unknown';
}
let lastRateLimitCleanup = Date.now();
function isRateLimited(req: VercelRequest): boolean {
  const now = Date.now();
  const ip = getClientIp(req);
  if (!rateLimitByIp.has(ip)) rateLimitByIp.set(ip, []);
  const ipLog = rateLimitByIp.get(ip)!;
  while (ipLog.length && ipLog[0] < now - 60_000) ipLog.shift();
  if (ipLog.length >= 30) return true;
  ipLog.push(now);
  // Evict stale IPs every 5 minutes
  if (now - lastRateLimitCleanup > 300_000) {
    lastRateLimitCleanup = now;
    for (const [k, v] of rateLimitByIp) {
      while (v.length && v[0] < now - 60_000) v.shift();
      if (!v.length) rateLimitByIp.delete(k);
    }
  }
  return false;
}

function corsHeaders(req: VercelRequest): Record<string, string> {
  const origin = req.headers?.origin || '';
  const allowed = origin === 'https://theblueboard.co' || /^http:\/\/localhost(:\d+)?$/.test(origin as string);
  return {
    'Access-Control-Allow-Origin': allowed ? (origin as string) : 'https://theblueboard.co',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export function normalizeFlightNumber(raw: string | string[]): string {
  const str = Array.isArray(raw) ? raw[0] : (raw || '');
  let q = String(str).trim().toUpperCase().replace(/\s+/g, '');
  if (q.startsWith('UA') && !q.startsWith('UAL')) q = 'UAL' + q.slice(2);
  if (/^\d{1,4}$/.test(q)) q = 'UAL' + q;
  return q;
}

export function epochToISO(epoch: number | undefined | null): string {
  if (!epoch) return '';
  return new Date(epoch * 1000).toISOString();
}

// FR24 Official API flight-summary tier. Returns a result payload or null — never writes the
// response itself, so the caller can continue down the fallback chain. `schedDepMs` is the
// scheduled departure of the leg the hub boards resolved, when there is one: FR24 legs that
// started well before it are an earlier day's flight and are rejected (F0).
async function fetchFr24Summary(flight: string, schedDepMs: number | null = null): Promise<any | null> {
  if (!process.env.FR24_API_TOKEN) return null;
  // Paid official API: honour the operator kill switch (SCHEDULE_OFFICIAL_FALLBACK_ENABLED=false).
  if (!isOfficialFr24Enabled()) return null;
  // F038: honour the shared cross-instance 402 quota block before spending a call — this tier used
  // to gate solely on the kill switch and ignore a credit-exhaustion block recorded by any other
  // official-API caller (schedule.ts, fr24-flight, aircraft-history). Skips straight to the next
  // fallback tier (schedule-cache) via the null return, same as any other tier failure.
  if (await isOfficialApiQuotaBlocked()) return null;
  try {
    // Convert UAL2221 -> UA2221 for FR24
    const fr24Flight = flight.replace('UAL', 'UA');
    const now = new Date();
    const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const to = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(
      `https://fr24api.flightradar24.com/api/flight-summary/light?flights=${encodeURIComponent(fr24Flight)}&flight_datetime_from=${fr24Datetime(from)}&flight_datetime_to=${fr24Datetime(to)}`,
      {
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${process.env.FR24_API_TOKEN}`,
          'Accept': 'application/json',
          'Accept-Version': 'v1',
        },
      }
    );
    clearTimeout(timeout);
    if (!resp.ok) {
      if (resp.status === 402) {
        const body = await resp.text().catch(() => '');
        recordOfficialApi402(body || 'flight-times 402');
      }
      return null;
    }
    const data = await resp.json();
    // F0: never `flights[0]` — that is whichever leg last OPERATED, usually yesterday's.
    const picked = pickFr24SummaryLeg((data as any)?.data || [], { nowMs: now.getTime(), schedDepMs });
    if (!picked) return null;
    const f = picked.leg;
    const originIata = f.orig_icao ? icaoToIata(f.orig_icao) : '';
    const destIata = (f.dest_icao_actual || f.dest_icao) ? icaoToIata(f.dest_icao_actual || f.dest_icao) : '';
    const landed = !!(f.datetime_landed || f.flight_ended);
    return {
      success: true,
      flight: fr24Flight,
      origin: { iata: originIata, name: '', terminal: '', gate: '', tz: airportTz(originIata) },
      destination: { iata: destIata, name: '', terminal: '', gate: '', tz: airportTz(destIata) },
      departure: {
        gate: { scheduled: '', estimated: '', actual: '' },
        takeoff: {
          scheduled: '',
          estimated: '',
          actual: f.datetime_takeoff || '',
        },
      },
      arrival: {
        landing: {
          scheduled: '',
          estimated: '',
          actual: f.datetime_landed || '',
        },
        gate: { scheduled: '', estimated: '', actual: '' },
      },
      aircraft: f.type || '',
      registration: f.reg || f.registration || '',
      status: landed ? 'landed' : 'en-route',
      cancelled: false,
      diverted: !!(f.dest_icao_actual && f.dest_icao && f.dest_icao !== f.dest_icao_actual),
      // flight-summary/light carries no scheduled or estimated times at all: say so, rather
      // than let a client read the empty gate fields as "no schedule exists" (F1).
      timesUnavailable: true,
      source: 'fr24',
      cached: false,
    };
  } catch (e) {
    return null;
  }
}

// Schedule snapshot tier: the hub boards already carry scheduled/estimated/real times server-side
// (api/schedule.ts caches + api/_schedule-snapshots.ts persistence). Reads only the durable
// snapshot layer (shared across lambdas); no upstream calls.
// A board row is ~1KB but a board is ~260KB, and a My Flights poll asks for several flights
// back to back. Memoise snapshot reads per instance for a minute so a poll of N flights reads
// each board once, not N times.
const SNAPSHOT_MEMO_TTL_MS = 60_000;
const snapshotMemo = new Map<string, { p: Promise<any>; ts: number }>();
function loadSnapshotMemo(key: string): Promise<any> {
  const hit = snapshotMemo.get(key);
  if (hit && Date.now() - hit.ts <= SNAPSHOT_MEMO_TTL_MS) return hit.p;
  if (snapshotMemo.size > 60) {
    const oldest = snapshotMemo.keys().next().value;
    if (oldest !== undefined) snapshotMemo.delete(oldest);
  }
  const p = loadScheduleSnapshot(key).catch(() => null);
  snapshotMemo.set(key, { p, ts: Date.now() });
  return p;
}

export type ScheduleLegPhase = 'active' | 'recent' | 'upcoming' | 'landed';
export interface ScheduleLeg { row: any; dir: 'departures' | 'arrivals'; schedDep: number; off: number; }

/** Where a board row's leg is at `nowSec`. Boards can be an hour stale, so a leg whose times say
 *  it should be flying counts as active even before a real departure lands in the snapshot. */
export function scheduleLegPhase(row: any, nowSec: number): { phase: ScheduleLegPhase; depSec: number; arrSec: number } {
  const t = row?.time || {};
  const depSec = t.real?.departure || t.estimated?.departure || t.scheduled?.departure || 0;
  const arrSec = t.real?.arrival || t.estimated?.arrival || t.scheduled?.arrival || 0;
  const cancelled = row?.status?.generic?.type === 'canceled' || row?.status?.generic?.status?.text === 'canceled';
  if (t.real?.arrival || (arrSec && arrSec <= nowSec)) {
    return { phase: arrSec >= nowSec - 2 * 3600 ? 'recent' : 'landed', depSec, arrSec };
  }
  if (!cancelled && (t.real?.departure || (depSec && depSec <= nowSec))) return { phase: 'active', depSec, arrSec };
  return { phase: 'upcoming', depSec, arrSec };
}

/** A sighting airborne this recently says which leg of a multi-leg flight number is in the air. */
const AIRBORNE_LEG_HINT_MS = 30 * 60e3;

/** The leg a flight number means right now: in the air > just landed > the next departure >
 *  an older landed leg. Replaces "first board row that matches", which served tomorrow night's
 *  departure while tonight's red-eye was still airborne.
 *
 *  Two legs can both look "active" on a through flight (UA1872 MCO→IAH→MSP, phone QA Oct 4 2026):
 *  the first is in the air, the second is only overdue because its aircraft has not arrived. A leg
 *  with a real departure, or departing the airport the live feed last saw this flight number leave
 *  (`sighting`), outranks one that is "active" by the clock alone; between two clock-only active
 *  legs the EARLIER one is in the air — the later one cannot leave before it lands. */
export function pickScheduleLeg(legs: ScheduleLeg[], nowSec: number, sighting?: SightingRecord | null): ScheduleLeg | null {
  const rank: Record<ScheduleLegPhase, number> = { active: 4, recent: 3, upcoming: 2, landed: 1 };
  const airborneAt = Number(sighting?.airborneAtMs);
  const airborneOrigin = Number.isFinite(airborneAt) && airborneAt > 0 && nowSec * 1000 - airborneAt <= AIRBORNE_LEG_HINT_MS
    ? String(sighting?.origin || '').toUpperCase()
    : '';
  let best: ScheduleLeg | null = null;
  let bestRank = -1;
  let bestDep = 0;
  for (const leg of legs) {
    const { phase, depSec } = scheduleLegPhase(leg.row, nowSec);
    let r = rank[phase];
    if (phase === 'active') {
      const origin = String(leg.row?.airport?.origin?.code?.iata || '').toUpperCase();
      if (leg.row?.time?.real?.departure || (airborneOrigin && origin === airborneOrigin)) r = 5;
    }
    const better = r > bestRank
      || (r === bestRank && (phase === 'upcoming' || r === 4 ? depSec < bestDep : depSec > bestDep));
    if (better) { best = leg; bestRank = r; bestDep = depSec; }
  }
  return best;
}

type BoardRead = { hub: string; dir: 'departures' | 'arrivals'; off: number };

/** Board reads for today-relative day offsets, optionally only the hub days that ARE `dateParam`. */
function offsetReads(offsets: number[], dateParam = ''): BoardRead[] {
  const reads: BoardRead[] = [];
  for (const off of offsets) {
    for (const dir of ['departures', 'arrivals'] as const) {
      for (const hub of UNITED_HUBS) {
        if (dateParam) {
          const d = getHubLocalDate(hub, getStartOfHubDay(hub, off) * 1000);
          if (`${d.year}-${d.month}-${d.day}` !== dateParam) continue;
        }
        reads.push({ hub, dir, off });
      }
    }
  }
  return reads;
}

/** The boards that can hold the leg scheduled to depart at `depSec`: each hub's departures board
 *  for the hub day containing it, and its arrivals boards for that day and the next (a red-eye lands
 *  on the destination's next day). */
export function pinnedLegReads(depSec: number): BoardRead[] {
  const reads: BoardRead[] = [];
  for (const hub of UNITED_HUBS) {
    for (let off = -2; off <= 2; off++) {
      if (depSec >= getStartOfHubDay(hub, off) && depSec < getStartOfHubDay(hub, off + 1)) {
        reads.push({ hub, dir: 'departures', off }, { hub, dir: 'arrivals', off }, { hub, dir: 'arrivals', off: off + 1 });
        break;
      }
    }
  }
  return reads;
}

/** A `dep` query value (epoch seconds or ISO) → epoch seconds within four days of now, else 0. */
export function parseDepParam(raw: unknown, nowSec: number): number {
  if (typeof raw !== 'string' || !raw.trim()) return 0;
  const v = raw.trim();
  const sec = /^\d{9,11}$/.test(v) ? Number(v) : Math.floor(Date.parse(v) / 1000);
  if (!Number.isFinite(sec) || Math.abs(sec - nowSec) > 4 * 86400) return 0;
  return sec;
}

/** Between legs this far apart, a pinned `dep` names the nearer one; further, neither. */
const PINNED_LEG_TOLERANCE_SEC = 2 * 3600;

async function collectScheduleLegs(
  flightNum: string,
  plan: BoardRead[],
  origin = '',
  nowSec = Math.floor(Date.now() / 1000),
  sightings: Map<string, SightingRecord> = new Map(),
): Promise<ScheduleLeg[]> {
  const reads: Promise<{ rows: any[]; dir: 'departures' | 'arrivals'; off: number }>[] = [];
  for (const { hub, dir, off } of plan) {
    reads.push(loadSnapshotMemo(`agg:${hub}:${dir}:${getStartOfHubDay(hub, off)}`).then((snapshot) => ({
      dir,
      off,
      // v1.11.3: these rows come straight from the persisted snapshot — /api/schedule's serve
      // pass never sees them, and the watch-alerts cron reads them through here. A real time
      // still in the future is not an arrival, and a date-shifted earlier leg is not this
      // flight: either one would push a false "Landed".
      //
      // v1.12.0: the same seen-airborne override /api/schedule serves with. A "Likely Canceled"
      // row the live feed saw fly reads departed here too — the watch cron resolves flights
      // through this tier, and an unconfirmed cancellation must never become a push.
      rows: applySightingsToBoard(
        {
          dir,
          flights: sanitizeBoardFlights(
            (Array.isArray(snapshot?.data?.flights) ? snapshot.data.flights : []).filter(
              (f: any) => String(f?.identification?.number?.default || '').toUpperCase() === flightNum
                && (!origin || String(f?.airport?.origin?.code?.iata || '').toUpperCase() === origin)
            ),
            nowSec,
          ).flights as any[],
        },
        sightings,
        nowSec * 1000,
        { dir },
      ).flights as any[],
    })));
  }
  // One leg per scheduled departure. The origin hub's departures row is the base (it has the
  // departure gate); the same leg's arrivals row — the only one that ever advances to landed —
  // lends its arrival times, its further-along status and its destination gate (mergeLegRows).
  // Before Oct 4 2026 it lent only the gate, so a hub-to-hub watch never saw "landed".
  const byDep = new Map<number, ScheduleLeg>();
  for (const { rows, dir, off } of (await Promise.all(reads)).sort((a, b) => (a.dir === b.dir ? 0 : a.dir === 'departures' ? -1 : 1))) {
    for (const row of rows) {
      const schedDep = row?.time?.scheduled?.departure || 0;
      const existing = byDep.get(schedDep);
      if (!existing) { byDep.set(schedDep, { row, dir, schedDep, off }); continue; }
      if (dir === 'arrivals' && existing.dir === 'departures') existing.row = mergeLegRows(existing.row, row);
    }
  }
  return [...byDep.values()];
}

function scheduleLegPayload(flightNum: string, match: any) {
  const time = match.time || {};
  const generic = match.status?.generic?.status || {};
  const originIata = match.airport?.origin?.code?.iata || '';
  const destIata = match.airport?.destination?.code?.iata || '';
  return {
    success: true,
    flight: flightNum,
    origin: {
      iata: originIata,
      name: match.airport?.origin?.name || '',
      terminal: match.airport?.origin?.info?.terminal || '',
      gate: match.airport?.origin?.info?.gate || '',
      tz: airportTz(originIata),
    },
    destination: {
      iata: destIata,
      name: match.airport?.destination?.name || '',
      terminal: match.airport?.destination?.info?.terminal || '',
      gate: match.airport?.destination?.info?.gate || '',
      tz: airportTz(destIata),
    },
    departure: {
      gate: {
        scheduled: epochToISO(time.scheduled?.departure),
        estimated: epochToISO(time.estimated?.departure),
        actual: epochToISO(time.real?.departure),
      },
      takeoff: { scheduled: '', estimated: '', actual: '' },
    },
    arrival: {
      landing: { scheduled: '', estimated: '', actual: '' },
      gate: {
        scheduled: epochToISO(time.scheduled?.arrival),
        estimated: epochToISO(time.estimated?.arrival),
        actual: epochToISO(time.real?.arrival),
      },
    },
    aircraft: match.aircraft?.model?.text || match.aircraft?.model?.code || '',
    registration: match.aircraft?.registration || '',
    status: generic.text || '',
    cancelled: match.status?.generic?.type === 'canceled' || generic.text === 'canceled',
    diverted: !!generic.diverted,
    source: 'schedule-cache',
    cached: false,
  };
}

async function fetchScheduleCacheTimes(
  flight: string,
  dateParam = '',
  origin = '',
  depSec = 0,
  sightings: Map<string, SightingRecord> = new Map(),
): Promise<any | null> {
  const flightNum = flight.replace('UAL', 'UA');
  const nowSec = Math.floor(Date.now() / 1000);
  const sighting = sightings.get(normalizeFlightNum(flightNum) || flightNum) || null;
  try {
    let legs: ScheduleLeg[];
    if (depSec) {
      // A pinned leg: that scheduled departure (the nearest within two hours) or nothing.
      legs = (await collectScheduleLegs(flightNum, pinnedLegReads(depSec), origin, nowSec, sightings))
        .filter((leg) => Math.abs(leg.schedDep - depSec) <= PINNED_LEG_TOLERANCE_SEC)
        .sort((a, b) => Math.abs(a.schedDep - depSec) - Math.abs(b.schedDep - depSec));
      return legs.length ? scheduleLegPayload(flightNum, legs[0].row) : null;
    }
    if (dateParam) {
      // F005/F013: each hub reads only the offset whose hub-local date is the one asked for.
      legs = await collectScheduleLegs(flightNum, offsetReads([0, 1, -1], dateParam), origin, nowSec, sightings);
    } else {
      // Today's boards, both directions: the destination hub's arrivals board carries a leg that
      // left the origin hub "yesterday" (a red-eye past midnight).
      legs = await collectScheduleLegs(flightNum, offsetReads([0]), origin, nowSec, sightings);
      let best = pickScheduleLeg(legs, nowSec, sighting);
      let phase = best ? scheduleLegPhase(best.row, nowSec).phase : null;
      // Only an upcoming leg (or nothing) is left today: yesterday's board may still hold the one
      // in the air — a red-eye out of a hub to a non-hub never appears on today's boards.
      if (!best || phase === 'upcoming' || phase === 'landed') {
        legs = legs.concat(await collectScheduleLegs(flightNum, offsetReads([-1]), origin, nowSec, sightings));
        best = pickScheduleLeg(legs, nowSec, sighting);
        phase = best ? scheduleLegPhase(best.row, nowSec).phase : null;
      }
      // No leg on today's boards at all: the next occurrence is tomorrow's. Today's LANDED leg
      // keeps answering until the hub day rolls over, as it always has. (The watch cron no longer
      // depends on this: a watch is pinned to one leg and asks for it by `dep`.)
      if (!legs.some((leg) => leg.off === 0) && (!best || phase === 'landed')) {
        legs = legs.concat(await collectScheduleLegs(flightNum, offsetReads([1]), origin, nowSec, sightings));
      }
    }
    const best = pickScheduleLeg(legs, nowSec, sighting);
    return best ? scheduleLegPayload(flightNum, best.row) : null;
  } catch (e: any) {
    console.warn('flight-times schedule-cache lookup failed:', e?.message || e);
  }
  return null;
}

const PRE_DEPARTURE_STATUS = /^(|expected|scheduled|estimated|unknown|on ?time|delayed)$/i;

/** A recorded takeoff (or pushback) outranks a status word that has not caught up (live audit
 *  Sep 28 2026, D1): AeroDataBox held UA1215 at 'expected' — real.departure null — for a leg that
 *  had been airborne for two hours. Only pre-departure words are rewritten; a cancelled leg, a
 *  leg with an arrival actual, and any other status text pass through untouched. */
export function normalizeLegStatus(payload: any): any {
  if (!payload || payload.cancelled) return payload;
  const takeoff = payload.departure?.takeoff?.actual;
  const out = payload.departure?.gate?.actual;
  if (!takeoff && !out) return payload;
  if (payload.arrival?.landing?.actual || payload.arrival?.gate?.actual) return payload;
  if (!PRE_DEPARTURE_STATUS.test(String(payload.status || '').trim())) return payload;
  return { ...payload, status: takeoff ? 'en-route' : 'departed' };
}

/** Overlay FR24's live facts for the SAME leg onto the board's schedule. The board keeps every
 *  gate time (what My Flights, the connection checker and the risk model read); FR24 adds what
 *  only a tracker knows — takeoff/landing actuals, the tail once assigned, airborne/landed. */
export function mergeFr24IntoSchedule(sched: any, fr24: any): any {
  if (!fr24) return sched;
  const sameRoute = (!sched.origin.iata || !fr24.origin.iata || sched.origin.iata === fr24.origin.iata);
  if (!sameRoute) return sched;
  return {
    ...sched,
    departure: { ...sched.departure, takeoff: { ...sched.departure.takeoff, actual: fr24.departure.takeoff.actual || sched.departure.takeoff.actual } },
    arrival: { ...sched.arrival, landing: { ...sched.arrival.landing, actual: fr24.arrival.landing.actual || sched.arrival.landing.actual } },
    destination: fr24.diverted && fr24.destination.iata
      ? { ...sched.destination, iata: fr24.destination.iata, gate: '', terminal: '', tz: fr24.destination.tz }
      : sched.destination,
    aircraft: sched.aircraft || fr24.aircraft,
    registration: fr24.registration || sched.registration,
    status: sched.cancelled ? sched.status : fr24.status,
    diverted: sched.diverted || fr24.diverted,
    source: 'schedule-cache+fr24',
  };
}

// Resolve a flight through the schedule boards and FR24, and write the response. `reason`
// records WHY the primary (FlightAware) tier failed, and is only surfaced when every tier fails.
//
// Boards first (F0/F1): they are free, they know TONIGHT's leg before it departs, and they carry
// the gate times every consumer needs. FR24 is then asked only about that leg, and only once it
// could have started — an hour before its departure — so a not-yet-departed flight never pays for
// (or is answered with) the previous day's leg.
async function respondViaFallbacks(res: VercelResponse, flight: string, cacheKey: string, reason: string, dateParam = '', allowOfficial = true, origin = '', depSec = 0) {
  // allowOfficial=false lets a caller (e.g. api/cron/watch-alerts.ts) skip the paid FR24 official
  // API tier entirely and resolve only from the free FlightAware scrape + schedule-snapshot cache.
  //
  // Waited for (bounded): a cold lambda must not resolve a seen-flying flight as Likely Canceled,
  // nor miss the airborne / on-the-ground evidence a watch alert is built from.
  const sightings = await awaitRegSightings(2000);
  const sched = await fetchScheduleCacheTimes(flight, dateParam, origin, depSec, sightings);
  let result: any = sched;
  if (allowOfficial) {
    const schedDepMs = sched ? Date.parse(sched.departure.gate.scheduled) : NaN;
    const legStarted = !sched
      || !Number.isFinite(schedDepMs)
      || !!sched.departure.gate.actual
      || Date.parse(sched.departure.gate.estimated || sched.departure.gate.scheduled) - Date.now() <= FR24_LEG_EARLY_MS;
    // A pinned leg the boards do not hold is not answered from FR24's guess at "the" leg.
    if (legStarted && !sched?.cancelled && !(depSec && !sched)) {
      const fr24 = await fetchFr24Summary(flight, Number.isFinite(schedDepMs) ? schedDepMs : null);
      result = sched ? mergeFr24IntoSchedule(sched, fr24) : fr24;
    }
  }
  // An origin-pinned lookup answers about THAT leg or not at all (D2).
  if (result && origin && result.origin?.iata && result.origin.iata !== origin) result = null;
  result = normalizeLegStatus(result);
  // The live feed's word on THIS leg: airborne → departed, then on the ground at the destination →
  // landed. Only ever an upgrade (src/lib/watch-leg.js applyLegEvidence).
  const flightKey = normalizeFlightNum(flight) || flight.replace('UAL', 'UA');
  result = applyLegEvidence(result, sightings.get(flightKey), Date.now());
  if (result) {
    setCache(cacheKey, result);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(result);
  }
  return res.status(404).json({
    success: false,
    error: 'No flight data available',
    reason: `${reason}; fr24 and schedule-cache fallbacks unavailable`,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cors = corsHeaders(req);
  for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const rawFlight = req.query.flight as string;
  if (!rawFlight) return res.status(400).json({ success: false, error: 'Missing flight parameter' });

  const flight = normalizeFlightNumber(rawFlight);
  if (!/^UAL\d{1,5}[A-Z]?$/i.test(flight)) {
    return res.status(400).json({ success: false, error: 'Invalid flight number' });
  }

  // Optional date dimension (F005/F013): YYYY-MM-DD (flight's local date). Lets a
  // caller resolve tomorrow's scheduled leg instead of today's completed one.
  // Anything malformed is ignored (treated as "today or next occurrence").
  const rawDate = req.query.date;
  const dateParam = (typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) ? rawDate : '';

  // officialFallback=0 skips the paid FR24 official-API tier (used by the watch-alerts cron so a
  // background diff never burns FR24 credits). Default on for interactive callers.
  const allowOfficial = String(req.query.officialFallback ?? '1').toLowerCase() !== '0';

  // Optional origin hint (D2): the leg departing this airport. Validated like the flight number
  // — it is part of the cache key.
  const rawFrom = req.query.from;
  const origin = typeof rawFrom === 'string' ? rawFrom.trim().toUpperCase() : '';
  if (origin && !/^[A-Z]{3}$/.test(origin)) {
    return res.status(400).json({ success: false, error: 'Invalid from parameter' });
  }

  // Optional scheduled-departure pin: that leg or a 404. Anything malformed or more than four days
  // from now is ignored, like `date`.
  const pinnedDep = parseDepParam(req.query.dep, Math.floor(Date.now() / 1000));

  // The official-tier flag is part of the key (F138): an officialFallback=0 caller (the watch cron)
  // must never be handed an answer the paid tier produced for somebody else.
  const cacheKey = `fa:${flight}:${dateParam}:${origin}:${pinnedDep || ''}:${allowOfficial ? 1 : 0}`;
  const cached = getCached(cacheKey);
  if (cached) {
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ ...cached, cached: true });
  }

  if (isRateLimited(req)) {
    return res.status(429).json({ success: false, error: 'Rate limited' });
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FLIGHTAWARE_TIMEOUT_MS);

    const faFlight = flight.replace('UAL', 'UA');
    const resp = await fetch(`https://www.flightaware.com/live/flight/${encodeURIComponent(faFlight)}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return await respondViaFallbacks(res, flight, cacheKey, `flightaware HTTP ${resp.status}`, dateParam, allowOfficial, origin, pinnedDep);
    }

    // Cap response body size to prevent a misbehaving or malicious FlightAware
    // response from burning memory/time. The bootstrap blob is typically
    // <80KB; 500KB is generous without letting a runaway page loop consume
    // the Lambda.
    const rawHtml = await resp.text();
    const html = rawHtml.length > 500_000 ? rawHtml.slice(0, 500_000) : rawHtml;

    // Extract trackpollBootstrap JSON. Bound the {...} capture to avoid
    // catastrophic regex backtracking on unexpected input shapes.
    const match = html.match(/trackpollBootstrap\s*=\s*(\{[\s\S]{1,200000}?\});\s*(?:var|<\/script)/);
    if (!match) {
      // FlightAware blocked — fall down the chain
      return await respondViaFallbacks(res, flight, cacheKey, 'flightaware blocked (no bootstrap)', dateParam, allowOfficial, origin, pinnedDep);
    }

    let bootstrap: any;
    try {
      bootstrap = JSON.parse(match[1]);
    } catch (e) {
      return await respondViaFallbacks(res, flight, cacheKey, 'flightaware bootstrap unparseable', dateParam, allowOfficial, origin, pinnedDep);
    }

    // Find the most relevant flight — scan ALL activity log entries, then rank
    // with date + phase awareness (F005/F013): a requested date wins, then
    // in-air > current/future scheduled > landed > stale, with scheduled ties
    // picking the SOONEST upcoming leg (not the furthest-future one).
    const flights = bootstrap?.flights || {};
    const candidates: FaCandidate[] = [];

    for (const [key, val] of Object.entries(flights) as [string, any][]) {
      const actLog = val?.activityLog?.flights || [];
      for (const f of actLog) {
        if (origin && String(f.origin?.iata || '').toUpperCase() !== origin) continue;
        const pinnedSched = f.gateDepartureTimes?.scheduled || f.takeoffTimes?.scheduled || 0;
        if (pinnedDep && Math.abs(pinnedSched - pinnedDep) > PINNED_LEG_TOLERANCE_SEC) continue;
        const hasActualDep = !!(f.takeoffTimes?.actual || f.gateDepartureTimes?.actual);
        const hasLanded = !!f.landingTimes?.actual;
        const depSec = f.gateDepartureTimes?.scheduled || f.gateDepartureTimes?.estimated || f.gateDepartureTimes?.actual || f.takeoffTimes?.scheduled || 0;
        const phase: FaPhase = (hasActualDep && !hasLanded) ? 'inair' : hasLanded ? 'landed' : 'scheduled';
        candidates.push({ flight: f, key, phase, depSec, localDate: faLocalDate(depSec, f.origin?.TZ || '') });
      }
    }
    const bestFlight = pickBestFaCandidate(candidates, dateParam, Math.floor(Date.now() / 1000))?.flight || null;

    if (!bestFlight) {
      // A bootstrap that parses but contains ZERO flights is FlightAware's bot-wall, not a
      // definitive "this flight does not exist" — treat it as a source failure and fall through
      // to FR24 / the schedule snapshot layer instead of 404ing every flight. (Jul 3 2026 audit.)
      return await respondViaFallbacks(res, flight, cacheKey, 'flightaware bootstrap empty (bot-wall)', dateParam, allowOfficial, origin, pinnedDep);
    }

    const f = bestFlight;
    const result = normalizeLegStatus({
      success: true,
      flight: flight.replace('UAL', 'UA'),
      origin: {
        iata: f.origin?.iata || '',
        name: f.origin?.friendlyName || '',
        terminal: f.origin?.terminal || '',
        gate: f.origin?.gate || '',
        tz: (f.origin?.TZ || '').replace(/^:/, '') || airportTz(f.origin?.iata),
      },
      destination: {
        iata: f.destination?.iata || '',
        name: f.destination?.friendlyName || '',
        terminal: f.destination?.terminal || '',
        gate: f.destination?.gate || '',
        tz: (f.destination?.TZ || '').replace(/^:/, '') || airportTz(f.destination?.iata),
      },
      departure: {
        gate: {
          scheduled: epochToISO(f.gateDepartureTimes?.scheduled),
          estimated: epochToISO(f.gateDepartureTimes?.estimated),
          actual: epochToISO(f.gateDepartureTimes?.actual),
        },
        takeoff: {
          scheduled: epochToISO(f.takeoffTimes?.scheduled),
          estimated: epochToISO(f.takeoffTimes?.estimated),
          actual: epochToISO(f.takeoffTimes?.actual),
        },
      },
      arrival: {
        landing: {
          scheduled: epochToISO(f.landingTimes?.scheduled),
          estimated: epochToISO(f.landingTimes?.estimated),
          actual: epochToISO(f.landingTimes?.actual),
        },
        gate: {
          scheduled: epochToISO(f.gateArrivalTimes?.scheduled),
          estimated: epochToISO(f.gateArrivalTimes?.estimated),
          actual: epochToISO(f.gateArrivalTimes?.actual),
        },
      },
      aircraft: f.aircraftTypeFriendly || '',
      registration: extractFaRegistration(f),
      status: f.flightStatus || '',
      cancelled: !!f.cancelled,
      diverted: !!f.diverted,
      source: 'flightaware',
      cached: false,
    });

    setCache(cacheKey, result);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(result);
  } catch (e) {
    console.error('FlightAware scrape error:', e);
    return await respondViaFallbacks(res, flight, cacheKey, 'flightaware fetch error', dateParam, allowOfficial, origin, pinnedDep);
  }
}
