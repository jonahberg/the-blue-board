// Flight Times API — departure/arrival times for one United flight number
// Usage: /api/flight-times?flight=UA2221[&date=YYYY-MM-DD][&officialFallback=0]
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

/** The leg a flight number means right now: in the air > just landed > the next departure >
 *  an older landed leg. Replaces "first board row that matches", which served tomorrow night's
 *  departure while tonight's red-eye was still airborne. */
export function pickScheduleLeg(legs: ScheduleLeg[], nowSec: number): ScheduleLeg | null {
  const rank: Record<ScheduleLegPhase, number> = { active: 4, recent: 3, upcoming: 2, landed: 1 };
  let best: ScheduleLeg | null = null;
  let bestRank = -1;
  let bestDep = 0;
  for (const leg of legs) {
    const { phase, depSec } = scheduleLegPhase(leg.row, nowSec);
    const r = rank[phase];
    const better = r > bestRank
      || (r === bestRank && (phase === 'upcoming' ? depSec < bestDep : depSec > bestDep));
    if (better) { best = leg; bestRank = r; bestDep = depSec; }
  }
  return best;
}

async function collectScheduleLegs(flightNum: string, offsets: number[], dateParam: string): Promise<ScheduleLeg[]> {
  const reads: Promise<{ rows: any[]; dir: 'departures' | 'arrivals'; off: number }>[] = [];
  for (const off of offsets) {
    for (const dir of ['departures', 'arrivals'] as const) {
      for (const hub of UNITED_HUBS) {
        if (dateParam) {
          const d = getHubLocalDate(hub, getStartOfHubDay(hub, off) * 1000);
          if (`${d.year}-${d.month}-${d.day}` !== dateParam) continue;
        }
        reads.push(loadSnapshotMemo(`agg:${hub}:${dir}:${getStartOfHubDay(hub, off)}`).then((snapshot) => ({
          dir,
          off,
          rows: (Array.isArray(snapshot?.data?.flights) ? snapshot.data.flights : []).filter(
            (f: any) => String(f?.identification?.number?.default || '').toUpperCase() === flightNum
          ),
        })));
      }
    }
  }
  // One leg per scheduled departure. The origin hub's departures row wins (it has the departure
  // gate); an arrivals row for the same leg only lends its destination gate/terminal.
  const byDep = new Map<number, ScheduleLeg>();
  for (const { rows, dir, off } of (await Promise.all(reads)).sort((a, b) => (a.dir === b.dir ? 0 : a.dir === 'departures' ? -1 : 1))) {
    for (const row of rows) {
      const schedDep = row?.time?.scheduled?.departure || 0;
      const existing = byDep.get(schedDep);
      if (!existing) { byDep.set(schedDep, { row, dir, schedDep, off }); continue; }
      const destInfo = existing.row?.airport?.destination?.info || {};
      const arrInfo = row?.airport?.destination?.info || {};
      if (dir === 'arrivals' && (!destInfo.gate || !destInfo.terminal)) {
        existing.row = structuredClone(existing.row);
        existing.row.airport.destination.info = { ...arrInfo, ...Object.fromEntries(Object.entries(destInfo).filter(([, v]) => v)) };
      }
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

async function fetchScheduleCacheTimes(flight: string, dateParam = ''): Promise<any | null> {
  const flightNum = flight.replace('UAL', 'UA');
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    let legs: ScheduleLeg[];
    if (dateParam) {
      // F005/F013: each hub reads only the offset whose hub-local date is the one asked for.
      legs = await collectScheduleLegs(flightNum, [0, 1, -1], dateParam);
    } else {
      // Today's boards, both directions: the destination hub's arrivals board carries a leg that
      // left the origin hub "yesterday" (a red-eye past midnight).
      legs = await collectScheduleLegs(flightNum, [0], '');
      let best = pickScheduleLeg(legs, nowSec);
      let phase = best ? scheduleLegPhase(best.row, nowSec).phase : null;
      // Only an upcoming leg (or nothing) is left today: yesterday's board may still hold the one
      // in the air — a red-eye out of a hub to a non-hub never appears on today's boards.
      if (!best || phase === 'upcoming' || phase === 'landed') {
        legs = legs.concat(await collectScheduleLegs(flightNum, [-1], ''));
        best = pickScheduleLeg(legs, nowSec);
        phase = best ? scheduleLegPhase(best.row, nowSec).phase : null;
      }
      // No leg on today's boards at all: the next occurrence is tomorrow's. Today's LANDED leg
      // keeps answering until the hub day rolls over, as it always has — flipping it to tomorrow's
      // "scheduled" a couple of hours after landing would make the watch cron push a spurious
      // landed→scheduled alert (api/_watch-diff.ts treats any phase change as significant).
      if (!legs.some((leg) => leg.off === 0) && (!best || phase === 'landed')) {
        legs = legs.concat(await collectScheduleLegs(flightNum, [1], ''));
      }
    }
    const best = pickScheduleLeg(legs, nowSec);
    return best ? scheduleLegPayload(flightNum, best.row) : null;
  } catch (e: any) {
    console.warn('flight-times schedule-cache lookup failed:', e?.message || e);
  }
  return null;
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
async function respondViaFallbacks(res: VercelResponse, flight: string, cacheKey: string, reason: string, dateParam = '', allowOfficial = true) {
  // allowOfficial=false lets a caller (e.g. api/cron/watch-alerts.ts) skip the paid FR24 official
  // API tier entirely and resolve only from the free FlightAware scrape + schedule-snapshot cache.
  const sched = await fetchScheduleCacheTimes(flight, dateParam);
  let result: any = sched;
  if (allowOfficial) {
    const schedDepMs = sched ? Date.parse(sched.departure.gate.scheduled) : NaN;
    const legStarted = !sched
      || !Number.isFinite(schedDepMs)
      || !!sched.departure.gate.actual
      || Date.parse(sched.departure.gate.estimated || sched.departure.gate.scheduled) - Date.now() <= FR24_LEG_EARLY_MS;
    if (legStarted && !sched?.cancelled) {
      const fr24 = await fetchFr24Summary(flight, Number.isFinite(schedDepMs) ? schedDepMs : null);
      result = sched ? mergeFr24IntoSchedule(sched, fr24) : fr24;
    }
  }
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

  // The official-tier flag is part of the key (F138): an officialFallback=0 caller (the watch cron)
  // must never be handed an answer the paid tier produced for somebody else.
  const cacheKey = `fa:${flight}:${dateParam}:${allowOfficial ? 1 : 0}`;
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
      return await respondViaFallbacks(res, flight, cacheKey, `flightaware HTTP ${resp.status}`, dateParam, allowOfficial);
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
      return await respondViaFallbacks(res, flight, cacheKey, 'flightaware blocked (no bootstrap)', dateParam, allowOfficial);
    }

    let bootstrap: any;
    try {
      bootstrap = JSON.parse(match[1]);
    } catch (e) {
      return await respondViaFallbacks(res, flight, cacheKey, 'flightaware bootstrap unparseable', dateParam, allowOfficial);
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
      return await respondViaFallbacks(res, flight, cacheKey, 'flightaware bootstrap empty (bot-wall)', dateParam, allowOfficial);
    }

    const f = bestFlight;
    const result = {
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
    };

    setCache(cacheKey, result);
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(result);
  } catch (e) {
    console.error('FlightAware scrape error:', e);
    return await respondViaFallbacks(res, flight, cacheKey, 'flightaware fetch error', dateParam, allowOfficial);
  }
}
