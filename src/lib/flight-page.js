// ═══ FLIGHT PAGE — IDENTS, LEGS AND THE 30-DAY RECORD ═══
// The pure half of /flight/:ident that both the server (api/flight.ts, api/flight-page.ts,
// api/flight-card.ts) and the page script need: what a flight number is, which leg of it "now"
// means, and what the archive (`flight_history`, docs/specs/flight-history.md) says about the last
// 30 days of it.
//
// No DOM, no I/O, no clock (every function that needs "now" takes it).

import { ON_TIME_GRACE_MIN } from './hub-health.js';

/** The archive's first service day (flight_history collection started Nov 6, 2026). */
export const FLIGHT_HISTORY_START = '2026-11-06';

/** The record covers this many service days before today. */
export const HISTORY_WINDOW_DAYS = 30;

/** "When it runs late, it is usually about N minutes" needs at least this many late days. */
export const TYPICAL_LATE_MIN_DAYS = 3;

/** A canonical flight-page ident: UA + 1–4 digits, no leading zero, no provider letter suffix. */
export const FLIGHT_IDENT_RE = /^UA[1-9]\d{0,3}$/;

/**
 * Read a flight number the way people type it: `ua929`, `UA 929`, `UAL929`, `UA-929`, `929`,
 * `UA0929` all mean UA929. Anything else — another airline, five digits, a letter suffix
 * (AeroDataBox's `UA526H`, which no passenger knows the flight by), junk — is not a flight page.
 *
 * @param {unknown} raw  a path segment or query value (an array takes its first entry).
 * @returns {{ident: string, canonical: boolean} | null}  `canonical` is false when the input was
 *   spelled differently from the ident (the page redirects to the canonical address).
 */
export function parseFlightIdent(raw) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 16) return null;
  const m = /^(?:(?:UAL|UA)[\s-]*)?0*(\d{1,4})$/i.exec(text);
  if (!m || Number(m[1]) === 0) return null;
  const ident = `UA${Number(m[1])}`;
  return { ident, canonical: value === ident };
}

/** `/flight/UA929` */
export function flightPagePath(ident) {
  return `/flight/${ident}`;
}

/** `/flight/UA929/card.png` — the share card. Not under /api/: robots.txt disallows /api/. */
export function flightCardPath(ident) {
  return `/flight/${ident}/card.png`;
}

// ── Which leg "now" means (copied from api/flight-times.ts, which this page must not import:
//    that module reaches the paid FR24 official API) ──

/**
 * Where a board row's leg is at `nowSec`. Boards can be an hour stale, so a leg whose times say it
 * should be flying counts as active even before a real departure lands in the snapshot.
 *
 * @param {any} row
 * @param {number} nowSec
 * @returns {{phase: 'active'|'recent'|'upcoming'|'landed', depSec: number, arrSec: number}}
 */
export function scheduleLegPhase(row, nowSec) {
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

/**
 * The leg a flight number means right now: in the air > just landed > the next departure > an
 * older landed leg (api/flight-times.ts `pickScheduleLeg`, verbatim in behaviour). Between two
 * legs "active" by the clock alone, the one with a real departure, or departing where the live feed
 * last saw this number take off, wins; else the EARLIER one is in the air.
 *
 * @template {{row: any, schedDep: number}} L
 * @param {L[]} legs
 * @param {number} nowSec
 * @param {{airborneAtMs?: number|null, origin?: string}|null} [sighting]
 * @returns {L|null}
 */
export function pickScheduleLeg(legs, nowSec, sighting) {
  const rank = { active: 4, recent: 3, upcoming: 2, landed: 1 };
  const airborneAt = Number(sighting?.airborneAtMs);
  const airborneOrigin = Number.isFinite(airborneAt) && airborneAt > 0 && nowSec * 1000 - airborneAt <= AIRBORNE_LEG_HINT_MS
    ? String(sighting?.origin || '').toUpperCase()
    : '';
  let best = null;
  let bestRank = -1;
  let bestDep = 0;
  for (const leg of legs || []) {
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

// ── Dates ──

/** 'YYYY-MM-DD' + n days. */
export function addDays(dateStr, n) {
  const t = Date.parse(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(t)) return '';
  return new Date(t + n * 86400e3).toISOString().slice(0, 10);
}

/** "Nov 6" for 'YYYY-MM-DD'. */
export function shortDate(dateStr) {
  const t = Date.parse(`${dateStr}T12:00:00Z`);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ── The 30-day record ──

const REAL_BASIS = new Set(['gate', 'actual', 'runway']);

/**
 * The kinds of day on the strip. `glyph` is the text mark inside each square (DESIGN.md: status
 * colour always rides with a glyph or words); `tone` is a content-page token name, mapped to a
 * class by the page.
 */
export const HISTORY_DAY_KINDS = Object.freeze({
  'on-time': { label: 'on time', glyph: '✓', tone: 'ok' },
  late: { label: 'late', glyph: '!', tone: 'warn' },
  canceled: { label: 'canceled', glyph: '✕', tone: 'bad' },
  unconfirmed: { label: 'likely canceled, unconfirmed', glyph: '?', tone: 'warn-soft' },
  diverted: { label: 'diverted', glyph: '↪', tone: 'warn' },
  'no-data': { label: 'no data', glyph: '', tone: null },
});

/**
 * One archived leg → its square. "On time" is the site's rule, the one every on-time figure on the
 * board uses (hub-health.js `operatedOutcome`): a REAL departure time (gate, actual or runway basis)
 * within ON_TIME_GRACE_MIN (30) minutes of a provider schedule. An estimate is never a result, and
 * a leg never seen finishing is "no data", never on time.
 *
 * @param {any} row  a flight_history row.
 * @returns {{kind: keyof typeof HISTORY_DAY_KINDS, delayMin: number|null, basis: string|null}}
 */
export function historyDayKind(row) {
  if (!row) return { kind: 'no-data', delayMin: null, basis: null };
  if (row.outcome === 'canceled') return { kind: 'canceled', delayMin: null, basis: null };
  if (row.outcome === 'canceled_unconfirmed') return { kind: 'unconfirmed', delayMin: null, basis: null };
  const real = REAL_BASIS.has(row.dep_basis) && Number(row.sched_dep) > 0 && Number(row.dep_at) > 0;
  const delayMin = real ? Number(row.dep_at) - Number(row.sched_dep) : null;
  if (row.outcome === 'diverted') return { kind: 'diverted', delayMin, basis: real ? row.dep_basis : null };
  if (!real) return { kind: 'no-data', delayMin: null, basis: null };
  return { kind: delayMin <= ON_TIME_GRACE_MIN ? 'on-time' : 'late', delayMin, basis: row.dep_basis };
}

/** Median of a non-empty list. */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The record for one route of one flight number: a square per service day from
 * max(FLIGHT_HISTORY_START, today − 30) through yesterday — never padded to 30, never including
 * today (today is the leg at the top of the page).
 *
 * @param {any[]} rows  flight_history rows for the flight number (any route, any order).
 * @param {{origin: string, dest: string, today: string}} ctx  the route to show and today's service
 *   date ('YYYY-MM-DD', the current leg's board day).
 */
export function summarizeHistory(rows, { origin, dest, today }) {
  const start = [FLIGHT_HISTORY_START, addDays(today, -HISTORY_WINDOW_DAYS)].sort().pop();
  const end = addDays(today, -1);
  const byDate = new Map();
  for (const row of rows || []) {
    if (row?.origin !== origin || row?.dest !== dest) continue;
    if (row.service_date < start || row.service_date > end) continue;
    byDate.set(row.service_date, row);
  }
  const days = [];
  for (let d = start; d && d <= end; d = addDays(d, 1)) {
    const row = byDate.get(d) || null;
    const { kind, delayMin, basis } = historyDayKind(row);
    days.push({ date: d, kind, delayMin, basis, recorded: !!row });
    if (days.length > HISTORY_WINDOW_DAYS + 1) break;
  }
  const counts = { 'on-time': 0, late: 0, canceled: 0, unconfirmed: 0, diverted: 0, 'no-data': 0 };
  for (const day of days) counts[day.kind] += 1;
  const lates = days.filter((d) => d.kind === 'late').map((d) => d.delayMin);
  const typicalLateMin = lates.length >= TYPICAL_LATE_MIN_DAYS ? Math.max(5, Math.round(median(lates) / 5) * 5) : null;
  const withTime = days.filter((d) => d.kind === 'on-time' || d.kind === 'late').length;
  const runwayDays = days.filter((d) => (d.kind === 'on-time' || d.kind === 'late') && d.basis === 'runway').length;
  return {
    start,
    end,
    sinceCollectionStart: start === FLIGHT_HISTORY_START,
    days,
    counts,
    withTime,
    runwayDays,
    typicalLateMin,
  };
}

/**
 * The record in words.
 *
 * @param {ReturnType<typeof summarizeHistory>} summary
 * @returns {{count: string, typical: string, note: string, empty: boolean}}
 */
export function historyWords(summary) {
  const { days, counts, withTime, runwayDays, typicalLateMin, start, sinceCollectionStart } = summary;
  const since = sinceCollectionStart ? `since ${shortDate(start)}, when our record starts` : 'in the last 30 days';
  if (!days.length) {
    return {
      count: `Our record of this flight starts ${shortDate(FLIGHT_HISTORY_START)}; the first full day shows here tomorrow.`,
      typical: '',
      note: '',
      empty: true,
    };
  }
  const extras = [];
  if (counts.canceled) extras.push(`${counts.canceled} canceled`);
  if (counts.unconfirmed) extras.push(`${counts.unconfirmed} listed as likely canceled (unconfirmed)`);
  if (counts.diverted) extras.push(`${counts.diverted} diverted`);
  const dayWord = (n) => `${n} day${n === 1 ? '' : 's'}`;
  let count;
  if (withTime > 0) {
    count = `On time ${counts['on-time']} of ${dayWord(withTime)} with a recorded departure, ${since}.`;
  } else {
    count = `No recorded departure times ${since}.`;
  }
  if (extras.length) count += ` ${extras.join(', ').replace(/^./, (c) => c.toUpperCase())}.`;
  const typical = typicalLateMin ? `When it runs late, it is usually about ${typicalLateMin} minutes.` : '';
  const notes = [`On time means it left within ${ON_TIME_GRACE_MIN} minutes of schedule, the rule the board's on-time figures use.`];
  if (runwayDays > 0) {
    if (withTime === 1) notes.push('That departure time is a takeoff time, which includes taxiing.');
    else if (runwayDays === withTime) notes.push('These departure times are takeoff times, which include taxiing.');
    else if (runwayDays === 1) notes.push(`1 of these ${withTime} departure times is a takeoff time, which includes taxiing.`);
    else notes.push(`${runwayDays} of these ${withTime} departure times are takeoff times, which include taxiing.`);
  }
  if (counts['no-data']) notes.push(`${dayWord(counts['no-data'])} with no departure time on record.`);
  return { count, typical, note: notes.join(' '), empty: false };
}

// ── The tail's recent legs ──

/**
 * A tail's archived legs, newest first by the best departure time we have (PostgREST cannot order by
 * `coalesce(dep_at, sched_dep)`, so the API sorts here).
 *
 * @param {any[]} rows  flight_history rows for one registration.
 * @returns {any[]}
 */
export function sortTailLegs(rows) {
  const at = (r) => Number(r?.dep_at) || Number(r?.sched_dep) || 0;
  return [...(rows || [])].sort((a, b) => at(b) - at(a));
}

/** "UA526H" → "UA526" (schedule-row-model.js displayFlightIdent). */
function displayIdent(ident) {
  const m = /^([A-Z]{2}\d{1,4})[A-Z]$/.exec(String(ident || ''));
  return m ? m[1] : String(ident || '');
}

/**
 * The tail's legs before this one, for the aircraft card: newest first, at most `limit`, each with
 * a result in words. Only results the archive can stand behind: a departure delay from a REAL time,
 * a confirmed cancellation, "in the air" for a leg that left and has no arrival yet.
 *
 * @param {any[]} rows  flight_history rows for the tail (sortTailLegs order or any).
 * @param {{ident: string, schedDepMin: number, origin?: string, dest?: string}} current  the page's leg.
 * @param {number} [limit]
 */
export function tailLegsView(rows, current, limit = 4) {
  const out = [];
  for (const r of sortTailLegs(rows)) {
    const dep = Number(r.dep_at) || Number(r.sched_dep) || 0;
    // Strictly before this leg: the page's own leg and anything later are not "recent flights".
    if (!dep || dep >= (current.schedDepMin || Infinity)) continue;
    const { kind, delayMin } = historyDayKind(r);
    let result;
    let tone = null;
    if (kind === 'canceled') { result = 'canceled'; tone = 'bad'; }
    else if (kind === 'unconfirmed') { result = 'likely canceled'; tone = 'warn'; }
    else if (kind === 'diverted') { result = 'diverted'; tone = 'warn'; }
    else if (delayMin !== null) {
      result = delayMin <= 5 ? 'on time' : `+${delayMin} min`;
      tone = delayMin <= ON_TIME_GRACE_MIN ? 'ok' : 'warn';
    } else result = 'no time';
    out.push({ flight: displayIdent(r.flight_no), origin: r.origin, dest: r.dest, date: r.service_date, result, tone, depMin: dep });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * The aircraft's leg INTO this flight's origin, if the archive has it: the zero-cost "where's my
 * plane" (the live-feed version needs the feed, see the page script).
 *
 * @param {any[]} rows  the tail's flight_history rows.
 * @param {{origin: string, schedDepMin: number}} current
 * @returns {{flight: string, from: string, arrMin: number|null, arrBasis: string|null, depMin: number|null, depBasis: string|null, outcome: string}|null}
 */
export function inboundLeg(rows, current) {
  if (!current?.origin || !(current.schedDepMin > 0)) return null;
  for (const r of sortTailLegs(rows)) {
    if (r.dest !== current.origin) continue;
    const arr = Number(r.arr_at) || Number(r.sched_arr) || 0;
    const dep = Number(r.dep_at) || Number(r.sched_dep) || 0;
    // The leg that brings the aircraft in: arrives before we leave, within the same rotation.
    if (!dep || dep >= current.schedDepMin) continue;
    if (arr && (arr > current.schedDepMin + 60 || current.schedDepMin - arr > 18 * 60)) continue;
    if (r.outcome === 'canceled' || r.outcome === 'canceled_unconfirmed') return null;
    return {
      flight: displayIdent(r.flight_no),
      from: r.origin,
      arrMin: Number(r.arr_at) || null,
      arrBasis: r.arr_basis || null,
      depMin: Number(r.dep_at) || null,
      depBasis: r.dep_basis || null,
      outcome: r.outcome,
    };
  }
  return null;
}

// ── Cabins ──

/** Cabin names (the same words src/lib/swap-impact.js uses). */
export const CABIN_LABELS = Object.freeze({ J: 'Polaris', F: 'First', PP: 'Premium Plus', PE: 'Premium Plus', 'E+': 'Economy Plus', Y: 'Economy' });
