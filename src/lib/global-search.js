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
 * How well one live flight answers a query (F2). Lower is better; -1 is no match.
 *
 *   0  exact flight number, callsign or registration ("UA2" = "UAL2" = bare "2")
 *   1  one of those STARTS with the query
 *   2  the route, either direction
 *   3  any other substring hit
 *
 * The palette used to slice unranked feed order to 20 rows, so "UA2" listed UA28, UA285 and
 * UA2222 and dropped UA2 itself when it sat 21st in the feed.
 *
 * @param {Object} f  a live flight.
 * @param {string} qNorm  from normalizeQuery().
 * @returns {number}
 */
export function rankLiveFlight(f, qNorm) {
  if (!qNorm) return -1;
  const clean = (v) => (v || '').toUpperCase().replace(/[\s\-]+/g, '');
  const cs = clean(f.callsign);
  const flt = clean(f.flightIATA);
  const reg = clean(f.reg);
  // Every spelling of the query that names the same flight: UA2, UAL2 and a bare 2.
  const num = /^\d+$/.test(qNorm) ? qNorm : (qNorm.match(/^UAL?(\d+)$/) || [])[1];
  const variants = num ? [qNorm, `UA${num}`, `UAL${num}`] : [qNorm];
  const idents = [flt, cs, reg].filter(Boolean);
  if (idents.some((v) => variants.includes(v))) return 0;
  if (idents.some((v) => variants.some((q) => v.startsWith(q)))) return 1;
  const routeStr = ((f.origin || '') + (f.dest || '')).toUpperCase();
  const routeRev = ((f.dest || '') + (f.origin || '')).toUpperCase();
  if (routeStr === qNorm || routeRev === qNorm) return 2;
  if (idents.some((v) => v.includes(qNorm)) || routeStr.includes(qNorm) || routeRev.includes(qNorm)) return 3;
  return -1;
}

/**
 * The live flights matching a query, best first — the order the palette slices from.
 * Ties break on the shorter flight number, then alphabetically, so UA587 precedes UA5877.
 * Returns the feed's own objects (not labels): the palette selects what it renders.
 *
 * @param {Array<Object>} flights
 * @param {string} qNorm
 * @returns {Array<Object>}
 */
export function rankLiveFlights(flights, qNorm) {
  const ident = (f) => f.flightIATA || f.callsign || '';
  return (flights || [])
    .map((f) => ({ f, rank: rankLiveFlight(f, qNorm) }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) =>
      a.rank - b.rank ||
      ident(a.f).length - ident(b.f).length ||
      ident(a.f).localeCompare(ident(b.f)))
    .map((x) => x.f);
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
