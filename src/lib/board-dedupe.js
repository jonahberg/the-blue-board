// ═══ ONE PHYSICAL FLIGHT, ONE ROW ═══
// The live audit of Oct 4 2026 found 27 groups on the 18 boards (5,228 rows) where the same flight
// number, route AND tail appeared more than once:
//   - EWR UA1462 EWR→MBJ on N47298 was both "Departed +4h13m" (scheduled 12:43Z, off the gate 16:56Z,
//     a distinct gate time) and "Departed +0m" (a re-timed copy whose "scheduled" 17:25Z equals its
//     own runway time);
//   - IAH UA235 IAH→DCA appeared three times, twice on N898UA;
//   - LAX UA38 HND→LAX was "Approaching" 371 min after the same tail's row said "Arrived", and ORD
//     UA2472 RSW→ORD the same.
// The fetch-time dedupe (api/_schedule-aerodatabox.ts dedupeBoardFlights) only collapses rows that
// share a REAL timestamp, so a re-timed copy (different scheduled AND real time) or a ghost with no
// real time survived it. An aircraft does not fly the same flight number on the same route twice in
// one hub day, so rows sharing ident + route + tail are one flight: keep the one with the best
// evidence. Rows with a different tail, or no tail, are never collapsed (IAH UA235 on N27267 stays —
// that may be a swap or a second instance, and nothing here can tell).
//
// Applied at fetch time (new snapshots) and at serve time (api/schedule.ts — snapshots and CDN copies
// written before this existed). Pure; never mutates its input.

import { isPlausibleDelta } from './schedule-plausibility.js';

function side(dir) {
  return dir === 'arrivals' ? 'arrival' : 'departure';
}

function tailOf(flight) {
  return String(flight?.aircraft?.registration || '').toUpperCase().replace(/-/g, '');
}

/** The grouping key, or null when the row cannot be grouped (no ident, route or tail). */
function groupKey(flight) {
  const ident = String(flight?.identification?.number?.default || '').toUpperCase();
  const o = String(flight?.airport?.origin?.code?.iata || '').toUpperCase();
  const d = String(flight?.airport?.destination?.code?.iata || '').toUpperCase();
  const tail = tailOf(flight);
  if (!ident || !o || !d || !tail) return null;
  return `${ident}|${o}|${d}|${tail}`;
}

const t = (v) => (Number(v) > 0 ? Number(v) : 0);

/**
 * How much a row knows, as a comparable tuple (higher wins, compared in order):
 *  1. a real time on the board's side (it happened, the provider says when);
 *  2. a real time anywhere (it moved);
 *  3. that real time is a distinct GATE time, not a copied runway time;
 *  4. the real time differs from the scheduled one — inside a duplicate group an exact match is the
 *     re-timed copy (UA1462's "+0m" row), not an on-time flight;
 *  5. a scheduled time the provider sent, not one derived from the actual;
 *  6. how many of the six times it carries;
 *  7. the EARLIER scheduled time — the original baseline, so the true delay survives.
 */
function evidenceScore(flight, dir) {
  const s = side(dir);
  const time = flight?.time || {};
  const ts = flight?._source?.timeSource || {};
  const real = t(time.real?.[s]);
  const sched = t(time.scheduled?.[s]);
  const derived = !!flight?._source?.scheduleTimeDerivedFromActual?.[s];
  const anyReal = t(time.real?.departure) || t(time.real?.arrival);
  const gateDistinct = s === 'departure' ? ts.gateDistinctDep === true : ts.gateDistinctArr === true;
  let filled = 0;
  for (const kind of ['scheduled', 'real', 'estimated']) {
    for (const leg of ['departure', 'arrival']) if (t(time[kind]?.[leg])) filled++;
  }
  return [
    real ? 1 : 0,
    anyReal ? 1 : 0,
    real && gateDistinct ? 1 : 0,
    real && sched && real !== sched ? 1 : 0,
    sched && !derived ? 1 : 0,
    filled,
    sched ? -sched : -Infinity,
  ];
}

function better(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/**
 * The winner keeps its own times — except a board-side scheduled time it only DERIVED from its
 * actual (no baseline, so no delay to show): a loser's provider-sent scheduled time that is a
 * plausible baseline for the winner's real time is adopted (ORD UA2472: "Landed" with no delta →
 * "Landed −17m").
 */
function adoptBaseline(winner, losers, dir) {
  const s = side(dir);
  if (!winner?._source?.scheduleTimeDerivedFromActual?.[s]) return winner;
  const real = t(winner.time?.real?.[s]);
  if (!real) return winner;
  const donor = losers.find((l) => {
    const sched = t(l?.time?.scheduled?.[s]);
    return sched && !l?._source?.scheduleTimeDerivedFromActual?.[s] && isPlausibleDelta(real, sched);
  });
  if (!donor) return winner;
  const derived = { ...winner._source.scheduleTimeDerivedFromActual, [s]: false };
  return {
    ...winner,
    time: { ...winner.time, scheduled: { ...winner.time.scheduled, [s]: donor.time.scheduled[s] } },
    _source: { ...winner._source, scheduleTimeDerivedFromActual: derived, baselineFromDuplicate: true },
  };
}

/**
 * Collapse rows that are one physical flight (same ident, route and tail) to the row with the best
 * evidence. Order is kept: the winner stays where it was, the others are dropped.
 *
 * @param {any[]|undefined} flights  normalized board rows.
 * @param {'departures'|'arrivals'} dir
 * @returns {{flights: any[]|undefined, collapsed: number}} `flights` is the input array itself when
 *   nothing collapsed.
 */
export function collapseSameTailDuplicates(flights, dir) {
  if (!Array.isArray(flights)) return { flights, collapsed: 0 };
  const groups = new Map();
  flights.forEach((f, i) => {
    const key = groupKey(f);
    if (!key) return;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  });
  const drop = new Set();
  const replace = new Map();
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    let best = indexes[0];
    let bestScore = evidenceScore(flights[best], dir);
    for (const i of indexes.slice(1)) {
      const score = evidenceScore(flights[i], dir);
      if (better(score, bestScore)) {
        best = i;
        bestScore = score;
      }
    }
    const losers = indexes.filter((i) => i !== best);
    losers.forEach((i) => drop.add(i));
    const merged = adoptBaseline(flights[best], losers.map((i) => flights[i]), dir);
    if (merged !== flights[best]) replace.set(best, merged);
  }
  if (drop.size === 0 && replace.size === 0) return { flights, collapsed: 0 };
  const out = [];
  flights.forEach((f, i) => {
    if (drop.has(i)) return;
    out.push(replace.get(i) || f);
  });
  return { flights: out, collapsed: drop.size };
}

/**
 * `collapseSameTailDuplicates` for a served `/api/schedule` payload: `total` drops by the rows
 * removed and `meta.servedDeduped` counts them. Never mutates the payload.
 *
 * @param {any} payload
 * @param {'departures'|'arrivals'} dir
 * @returns {any} the same payload when nothing changed.
 */
export function dedupeServedBoard(payload, dir) {
  if (!payload || !Array.isArray(payload.flights)) return payload;
  const { flights, collapsed } = collapseSameTailDuplicates(payload.flights, dir);
  if (flights === payload.flights) return payload;
  const total = Number(payload.total);
  return {
    ...payload,
    flights,
    ...(Number.isFinite(total) ? { total: Math.max(0, total - collapsed) } : {}),
    meta: { ...(payload.meta || {}), servedDeduped: collapsed },
  };
}
