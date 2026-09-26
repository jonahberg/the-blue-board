// Shared normalizer for the unitedstarlinktracker.com upstream payload.
//
// Both api/cron/sync-starlink.ts and api/starlink-data.ts used to carry their own copy of this
// transform, which let them drift. They now share this one function so "what good data looks like"
// is defined in exactly one place.
//
// Data-quality fixes encoded here (verified against the live upstream 2026-05-31):
//   1. totalCount: upstream.totalCount is the ENTIRE tracked fleet (1781), NOT the Starlink count
//      (371). We expose the real Starlink count instead.
//   2. operator: upstream ships both "Skywest dba UAX" and "SkyWest dba UAX" (and friends), which
//      split the operator filter into duplicate rows. normalizeOperator() canonicalises carrier
//      casing.
//   3. type: upstream mixes "Bombardier CRJ-550" with "CRJ-550" and United customer codes
//      (737-824, 737-924(ER), A321-271NX) with marketing names. normalizeType() collapses them to
//      one label per airframe, aligned with the mainline fleet vocabulary.
//   4. flight times: upstream departure_time/arrival_time are UNIX SECONDS (integers), not the
//      ISO strings the consumer expects. We emit ISO strings AND a numeric *_ts (seconds) so the
//      client can pick the next UPCOMING flight and format the time.
//   5. enrichment: we now carry DateFound (powers the "NEW" badge / weekly-adds) and WiFi.

import { applyVerifiedStarlinkOverrides } from '../src/lib/starlink-overrides.js';
export { applyVerifiedStarlinkOverrides } from '../src/lib/starlink-overrides.js';

export interface StarlinkAircraft {
  tail: string;
  fleet: string;        // "Mainline" | "Express"
  type: string;         // normalised airframe label
  operator: string;     // normalised carrier label
  dateFound: string;    // upstream DateFound (YYYY-MM-DD) or ''
  wifi: string;         // "Starlink" or ''
}

export interface StarlinkFlight {
  flight_number: string;
  origin: string;
  destination: string;
  departure_time: string; // ISO 8601 (derived from the upstream epoch) or ''
  departure_ts: number;   // UNIX seconds, for "next upcoming" selection + formatting (0 if unknown)
  arrival_time: string;   // ISO 8601 or ''
  airline: string;        // e.g. "UA" or ''
}

export interface StarlinkFleetStats {
  mainline: number;       // mainline aircraft with Starlink
  express: number;        // express aircraft with Starlink
  total: number;          // mainline + express (real Starlink count)
  mainlineTotal: number;  // total mainline aircraft tracked
  expressTotal: number;   // total express aircraft tracked
  fleetTotal: number;     // mainlineTotal + expressTotal (rollout denominator)
  mainlinePct: number;    // % of mainline fleet equipped (0-100)
  expressPct: number;     // % of express fleet equipped (0-100)
}

export interface StarlinkPayload {
  aircraft: StarlinkAircraft[];
  totalCount: number;     // == aircraft.length (the FIX — see note 1)
  fleetStats: StarlinkFleetStats | null;
  flightsByTail: Record<string, StarlinkFlight[]>;
  lastUpdated: string;
  syncedAt: string;
}

export function applyVerifiedStarlinkPayloadOverrides(payload: StarlinkPayload): StarlinkPayload {
  // Preserve an empty payload so validation and degraded-path selection still see the outage.
  if (payload.aircraft.length === 0) return payload;

  const aircraft = applyVerifiedStarlinkOverrides(payload.aircraft) as StarlinkAircraft[];
  const additions = aircraft.slice(payload.aircraft.length);
  if (additions.length === 0) return payload;

  const mainlineAdditions = additions.filter((a) => a.fleet === 'Mainline').length;
  const expressAdditions = additions.filter((a) => a.fleet === 'Express').length;
  const fleetStats = payload.fleetStats ? {
    ...payload.fleetStats,
    mainline: payload.fleetStats.mainline + mainlineAdditions,
    express: payload.fleetStats.express + expressAdditions,
    total: payload.fleetStats.total + additions.length,
    mainlinePct: pct(payload.fleetStats.mainline + mainlineAdditions, payload.fleetStats.mainlineTotal),
    expressPct: pct(payload.fleetStats.express + expressAdditions, payload.fleetStats.expressTotal),
  } : null;

  return { ...payload, aircraft, totalCount: aircraft.length, fleetStats };
}

// Canonical carrier spellings. Any case-insensitive occurrence of the token is rewritten so future
// upstream casing drift ("Gojet", "SKYWEST", …) still collapses to one operator-filter entry.
const CARRIER_CANON: Array<[RegExp, string]> = [
  [/\bskywest\b/gi, 'SkyWest'],
  [/\bgojet\b/gi, 'GoJet'],
  [/\brepublic\b/gi, 'Republic'],
  [/\bmesa\b/gi, 'Mesa'],
  [/\bcommutair\b/gi, 'CommutAir'],
  [/\bair wisconsin\b/gi, 'Air Wisconsin'],
  [/\bunited\b/gi, 'United'],
];

export function normalizeOperator(raw: unknown): string {
  let s = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!s) return 'United Airlines';
  for (const [re, canon] of CARRIER_CANON) s = s.replace(re, canon);
  return s;
}

// United customer codes / marketing-name variants → one label per airframe. Keys are lowercase and
// already manufacturer-prefix-stripped. Unmatched types fall through to the prefix-stripped value,
// so a new airframe still renders as a clean name rather than a duplicate.
const TYPE_CANON: Record<string, string> = {
  '737-724': '737-700', '737-700': '737-700',
  '737-824': '737-800', '737-800': '737-800',
  '737-924(er)': '737-900ER', '737-932(er)': '737-900ER', '737-900er': '737-900ER', '737-900': '737-900',
  '737-8 max': '737 MAX 8', '737 max 8': '737 MAX 8', '737-9 max': '737 MAX 9', '737 max 9': '737 MAX 9',
  'a319-131': 'A319', 'a320-232': 'A320', 'a321-211': 'A321', 'a321-271nx': 'A321neo', 'a321neo': 'A321neo',
  'crj-550': 'CRJ-550', 'crj-700': 'CRJ-700', 'crj-900': 'CRJ-900',
  'erj-175': 'ERJ-175', 'e175': 'ERJ-175', 'e175sc': 'E175SC',
};

export function normalizeType(raw: unknown): string {
  let s = String(raw ?? '').trim();
  if (!s) return 'Unknown';
  s = s.replace(/^(Boeing|Airbus|Bombardier|Embraer|McDonnell Douglas)\s+/i, '');
  const key = s.toLowerCase();
  return TYPE_CANON[key] ?? s;
}

function capitalizeFleet(raw: unknown): string {
  const s = String(raw ?? 'express').trim() || 'express';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function normalizeWifi(raw: unknown): string {
  return /star\s*l|strlnk|starlink/i.test(String(raw ?? '')) ? 'Starlink' : '';
}

// Accept either an upstream epoch (seconds, occasionally ms) or an ISO string, and return both an
// ISO string and the numeric seconds. Returns ''/0 for anything unparseable.
function toTime(value: unknown): { iso: string; sec: number } {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const sec = value > 1e12 ? Math.round(value / 1000) : Math.round(value);
    return { iso: new Date(sec * 1000).toISOString(), sec };
  }
  if (typeof value === 'string' && value.trim()) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return { iso: new Date(ms).toISOString(), sec: Math.round(ms / 1000) };
  }
  return { iso: '', sec: 0 };
}

function pct(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}

export function normalizeStarlinkPayload(upstream: any, syncedAt: string = new Date().toISOString()): StarlinkPayload {
  const planes: any[] = Array.isArray(upstream?.starlinkPlanes) ? upstream.starlinkPlanes : [];

  const upstreamAircraft: StarlinkAircraft[] = planes.map((p) => ({
    tail: String(p?.TailNumber ?? '').trim(),
    fleet: capitalizeFleet(p?.fleet),
    type: normalizeType(p?.Aircraft),
    operator: normalizeOperator(p?.OperatedBy),
    dateFound: String(p?.DateFound ?? '').trim(),
    wifi: normalizeWifi(p?.WiFi),
  }));
  const fs = upstream?.fleetStats;
  const mainline = Number(fs?.mainline?.starlink ?? 0) || 0;
  const express = Number(fs?.express?.starlink ?? 0) || 0;
  const mainlineTotal = Number(fs?.mainline?.total ?? 0) || 0;
  const expressTotal = Number(fs?.express?.total ?? 0) || 0;
  // total = real Starlink count. Prefer upstream.combined when present, else mainline+express, else
  // the array length. Never upstream.totalCount (that is the whole tracked fleet).
  const total = Number(fs?.combined?.starlink ?? (mainline + express || upstreamAircraft.length)) || upstreamAircraft.length;
  const fleetStats: StarlinkFleetStats | null = fs ? {
    mainline,
    express,
    total,
    mainlineTotal,
    expressTotal,
    fleetTotal: mainlineTotal + expressTotal,
    mainlinePct: pct(mainline, mainlineTotal),
    expressPct: pct(express, expressTotal),
  } : null;

  const flightsByTail: Record<string, StarlinkFlight[]> = {};
  const upstreamFlights = upstream?.flightsByTail && typeof upstream.flightsByTail === 'object'
    ? upstream.flightsByTail as Record<string, any[]>
    : {};
  for (const [tail, flights] of Object.entries(upstreamFlights)) {
    if (!Array.isArray(flights)) continue;
    const mapped = flights.map((f: any) => {
      const dep = toTime(f?.departure_time);
      const arr = toTime(f?.arrival_time);
      return {
        flight_number: String(f?.flight_number ?? ''),
        origin: String(f?.departure_airport ?? f?.origin ?? ''),
        destination: String(f?.arrival_airport ?? f?.destination ?? ''),
        departure_time: dep.iso,
        departure_ts: dep.sec,
        arrival_time: arr.iso,
        airline: String(f?.airline ?? ''),
      } as StarlinkFlight;
    });
    // Keep chronological order so the client's "next upcoming" scan is a simple forward find.
    mapped.sort((a, b) => a.departure_ts - b.departure_ts);
    flightsByTail[tail] = mapped;
  }

  const payload: StarlinkPayload = {
    aircraft: upstreamAircraft,
    totalCount: upstreamAircraft.length,
    fleetStats,
    flightsByTail,
    lastUpdated: typeof upstream?.lastUpdated === 'string' && upstream.lastUpdated ? upstream.lastUpdated : syncedAt,
    syncedAt,
  };
  // Do not turn an empty/malformed upstream response into a seemingly healthy payload. The
  // validator must still see zero records and reject it. A non-empty feed can be augmented.
  return applyVerifiedStarlinkPayloadOverrides(payload);
}

// §05 validators (research audit 2026-08-11): the length===0 guard the cron
// used accepts a structurally broken feed — e.g. a TailNumber field rename
// yields 513 records with empty tails, persists, and silently breaks all tail
// matching while every endpoint returns green 200s. These checks reject that
// class of payload before it can poison the durable snapshot.

export const STARLINK_MIN_AIRCRAFT = 400;            // absolute floor (live count 513 on 2026-08-11)
export const STARLINK_MIN_VALID_TAIL_RATIO = 0.98;   // catches field renames → empty tails
export const STARLINK_MIN_RELATIVE_RATIO = 0.9;      // catches partial feeds vs the last snapshot
export const STARLINK_STALE_MS = 6 * 60 * 60 * 1000; // upstream refreshes ~5-minutely

export interface StarlinkValidation {
  ok: boolean;
  failures: string[];  // reject the payload
  warnings: string[];  // log, but the payload is still the best data available
}

export function validateStarlinkPayload(payload: StarlinkPayload, previousTotal?: number): StarlinkValidation {
  const failures: string[] = [];
  const warnings: string[] = [];
  const n = payload.aircraft.length;

  if (n < STARLINK_MIN_AIRCRAFT) {
    failures.push(`aircraft count ${n} below absolute floor ${STARLINK_MIN_AIRCRAFT}`);
  }

  const validTails = payload.aircraft.filter((a) => /^N\d/.test(a.tail)).length;
  if (n > 0 && validTails / n < STARLINK_MIN_VALID_TAIL_RATIO) {
    failures.push(`only ${validTails}/${n} aircraft carry a valid N-number tail — upstream field rename?`);
  }

  if (typeof previousTotal === 'number' && previousTotal > 0 && n < STARLINK_MIN_RELATIVE_RATIO * previousTotal) {
    failures.push(`aircraft count ${n} under 90% of previous snapshot ${previousTotal} — partial feed?`);
  }

  const fs = payload.fleetStats;
  if (fs) {
    // Tolerance, not equality: upstream double-counts the MAX 9 (±1 today), and a
    // benign small drift must not freeze snapshot updates.
    const statsTotal = fs.mainline + fs.express;
    const tolerance = Math.max(5, Math.round(0.02 * n));
    if (Math.abs(statsTotal - n) > tolerance) {
      failures.push(`fleetStats total ${statsTotal} disagrees with aircraft count ${n} beyond ±${tolerance}`);
    }
  } else {
    warnings.push('fleetStats missing from upstream payload');
  }

  const updatedMs = Date.parse(payload.lastUpdated);
  if (Number.isFinite(updatedMs) && Date.now() - updatedMs > STARLINK_STALE_MS) {
    warnings.push(`upstream lastUpdated ${payload.lastUpdated} is over 6h old`);
  }

  return { ok: failures.length === 0, failures, warnings };
}
