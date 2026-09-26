// ═══ GLOBAL SEARCH MATCHING ═══
// The header search box. One normalisation feeds three matchers, so "UA 373",
// "UA373", "ua373" and "ORD to DEN" all behave the same (F042).
//
// Extracted verbatim from src/dashboard/main.js (:5410-5493). The debounce, the
// schedule preload retry (F043), result markup and the keyboard bridge stay there.

/** A query that looks like a United flight number, so an FR24 lookup is offered. */
export const FR24_LOOKUP_RE = /^(UA[L]?\s*\d{1,4}|\d{1,4})$/i;

/** A query that looks like a US registration. */
const TAIL_RE = /^N\d{3,5}[A-Z]{0,2}$/i;

/**
 * Normalise a raw query.
 *
 * @param {string} raw
 * @returns {{q: string, qNorm: string}} `q` keeps word spacing (with " TO " collapsed
 *   to a space) for display; `qNorm` strips all separators for matching.
 */
export function normalizeQuery(raw) {
  const qRaw = (raw || '').trim().toUpperCase();
  const q = qRaw.replace(/\s+TO\s+/g, ' ');
  return { q, qNorm: q.replace(/[\s\-→>]+/g, '') };
}

/**
 * Live-feed matches on callsign, IATA number, registration, or route in either
 * direction.
 *
 * @param {Array<Object>} flights
 * @param {string} qNorm  from normalizeQuery().
 * @returns {Array<{type: 'live', label: string, icao24: string}>}
 */
export function matchLiveFlights(flights, qNorm) {
  const matches = [];
  (flights || []).forEach(f => {
    const cs = (f.callsign || '').toUpperCase().replace(/[\s\-]+/g, '');
    const flt = (f.flightIATA || '').toUpperCase().replace(/[\s\-]+/g, '');
    const reg = (f.reg || '').toUpperCase().replace(/[\s\-]+/g, '');
    const routeStr = ((f.origin || '') + (f.dest || '')).toUpperCase();
    const routeRev = ((f.dest || '') + (f.origin || '')).toUpperCase();
    if (cs.includes(qNorm) || flt.includes(qNorm) || reg.includes(qNorm) || routeStr.includes(qNorm) || routeRev.includes(qNorm)) {
      matches.push({ type: 'live', label: `${f.flightIATA || f.callsign} ${f.origin||'?'}→${f.dest||'?'} ${f.reg||''}`, icao24: f.icao24 });
    }
  });
  return matches;
}

/**
 * Schedule-board matches on ident, registration, origin or destination.
 *
 * Note the asymmetry with the live matcher: a schedule row is NOT matched on a
 * concatenated route, so "ORDDEN" finds live flights but not schedule rows.
 * Preserved from main.js.
 *
 * @param {Array<Object>} rows  raw schedule rows.
 * @param {string} qNorm
 * @returns {Array<{type: 'sched', label: string, flight: Object}>}
 */
export function matchScheduleFlights(rows, qNorm) {
  const matches = [];
  (rows || []).forEach(fl => {
    const ident = (fl.identification?.number?.default || '').toUpperCase().replace(/[\s\-]+/g, '');
    const reg = (fl.aircraft?.registration || '').toUpperCase().replace(/[\s\-]+/g, '');
    const dest = (fl.airport?.destination?.code?.iata || '').toUpperCase();
    const orig = (fl.airport?.origin?.code?.iata || '').toUpperCase();
    if (ident.includes(qNorm) || reg.includes(qNorm) || dest.includes(qNorm) || orig.includes(qNorm)) {
      matches.push({ type: 'sched', label: `📅 ${fl.identification?.number?.default||'?'} ${(fl.airport?.origin?.code?.iata||'?')}→${(fl.airport?.destination?.code?.iata||'?')} ${fl.aircraft?.registration||''}`, flight: fl });
    }
  });
  return matches;
}

/**
 * Which "no results" message a failed query deserves.
 *
 * @param {string} normalizedQ  the query with whitespace removed.
 * @returns {{kind: 'flight'|'tail'|'generic', display: string}} `display` is the
 *   UA-prefixed flight number for a bare number, else the query as given.
 */
export function classifyEmptyState(normalizedQ) {
  const q = normalizedQ || '';
  if (FR24_LOOKUP_RE.test(q)) {
    return { kind: 'flight', display: q.startsWith('UA') || q.startsWith('UAL') ? q : 'UA' + q };
  }
  if (TAIL_RE.test(q)) return { kind: 'tail', display: q };
  return { kind: 'generic', display: q };
}
