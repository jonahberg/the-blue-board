// ═══ AIRCRAFT JOURNEY CHAIN ═══
// "Where has this tail been today?" — the prior legs that feed the My Flights journey
// timeline and the AI delay-explanation context.
//
// Extracted verbatim from src/dashboard/main.js (:6480-6548). The timeline markup
// stays in buildJourneyChainHtml(); this is the shaping and the prose.

/** @typedef {{flightNumber: string, origin: string, destination: string, delayMin: number|null, status: string}} Segment */

/**
 * Shape an aircraft-history response for display.
 *
 * Drops our own flight, keeps at most the three most recent prior segments, and
 * reverses them into chronological order (oldest first) so the timeline reads
 * top-to-bottom.
 *
 * @param {Segment[]|null|undefined} segments  newest-first, as /api/aircraft-history returns them.
 * @param {string} myFlight  the flight the card is about.
 * @param {string} orig  our origin IATA.
 * @param {string} dest  our destination IATA.
 * @returns {{prior: Segment[], current: {flightNumber: string, origin: string, destination: string}}}
 */
export function shapeJourney(segments, myFlight, orig, dest) {
  const prior = (segments || [])
    .filter(s => s.flightNumber !== myFlight)
    .slice(0, 3)
    .reverse(); // chronological order (oldest first)
  return { prior, current: { flightNumber: myFlight, origin: orig, destination: dest } };
}

/**
 * Delay severity class for one segment.
 *
 * Strict `=== null` on purpose: main.js is `delay === null ? '' : delay <= 5 ? ...`,
 * so an `undefined` delayMin fails both `<=` comparisons and lands on 'major'. Quirk
 * preserved rather than fixed — a missing field currently renders as a major delay.
 *
 * @param {number|null|undefined} delayMin
 * @returns {''|'on-time'|'minor'|'major'} '' only when delayMin is exactly null.
 */
export function journeyDelayClass(delayMin) {
  if (delayMin === null) return '';
  return delayMin <= 5 ? 'on-time' : delayMin <= 45 ? 'minor' : 'major';
}

/** Is this segment's status one of the airborne spellings? */
const isAirborne = (status) => {
  const s = (status || '').toLowerCase();
  return s === 'en-route' || s === 'airborne' || s === 'en route';
};

/** Is this segment's status one of the landed spellings? */
const isLanded = (status) => {
  const s = (status || '').toLowerCase();
  return s === 'landed' || s === 'arrived';
};

/**
 * Plain-text journey summary for the AI delay-explanation context (`data-inbound`).
 *
 * Ends with an averaging line only when at least one prior segment actually ran late.
 *
 * @param {string} reg  the aircraft registration.
 * @param {{prior: Segment[], current: {flightNumber: string, origin: string, destination: string}}} shaped
 *   from shapeJourney().
 * @returns {string} newline-separated, '' when there are no prior segments.
 */
export function buildJourneyContextStr(reg, shaped) {
  const priorSegs = shaped.prior;
  if (!priorSegs.length) return '';

  var lines = ['Aircraft ' + reg + ' journey today:'];
  priorSegs.forEach(function(seg, i) {
    var delay = seg.delayMin;
    var delayStr = delay === null ? 'unknown delay' : delay <= 0 ? 'on time' : 'departed ' + delay + 'min late';
    var statusStr = isAirborne(seg.status) ? ', currently airborne' : isLanded(seg.status) ? ', landed' : '';
    lines.push('Seg ' + (i + 1) + ': ' + seg.flightNumber + ' ' + seg.origin + '→' + seg.destination + ', ' + delayStr + statusStr);
  });

  // Summary
  var delays = priorSegs.map(function(s) { return s.delayMin; }).filter(function(d) { return d !== null && d > 0; });
  if (delays.length > 0) {
    var avg = Math.round(delays.reduce(function(a, b) { return a + b; }, 0) / delays.length);
    var c = shaped.current;
    lines.push('Your flight ' + c.flightNumber + ' ' + c.origin + '→' + c.destination + ' — aircraft averaging +' + avg + 'min delays across ' + delays.length + ' prior segment' + (delays.length > 1 ? 's' : ''));
  }

  return lines.join('\n');
}

/** A leg whose scheduled arrival is this far past counts as "well past" (D8). */
const WELL_PAST_MS = 30 * 60000;

const UNKNOWN_STATUS = new Set(['', 'unknown', 'scheduled', 'expected', 'estimated']);

/**
 * Fill in the status of journey legs the history endpoint could not name (live audit Sep 28
 * 2026, D8: earlier legs today read "unknown").
 *
 * Per leg with no real status, in order:
 *  1. an actual arrival → landed;
 *  2. the hub board row for that leg (same flight number, origin and destination) says
 *     landed/arrived → landed, departed/en-route → en-route;
 *  3. the SAME tail has departed on a later leg, and this leg's scheduled arrival (from the
 *     board, when known) is well past → landed. An airframe cannot start its next leg before
 *     finishing this one.
 * Otherwise the leg is left as it was — "unknown" is more honest than a guess.
 *
 * @param {Array<Object>|null|undefined} segments  newest-first, as /api/aircraft-history returns.
 * @param {Array<Object>} boardRows  rows from every loaded hub board.
 * @param {number} [nowMs]
 * @returns {Array<Object>|null|undefined} new segment objects (the input is the shared cache).
 */
export function resolveJourneyStatuses(segments, boardRows, nowMs = Date.now()) {
  if (!Array.isArray(segments)) return segments;
  const rows = Array.isArray(boardRows) ? boardRows : [];
  const rowFor = (seg) => rows.find((r) =>
    String(r?.identification?.number?.default || '').toUpperCase() === String(seg.flightNumber || '').toUpperCase()
    && (!seg.origin || r?.airport?.origin?.code?.iata === seg.origin)
    && (!seg.destination || r?.airport?.destination?.code?.iata === seg.destination));
  const departed = (seg) => Boolean(seg?.departure?.actual) || isAirborne(seg?.status) || isLanded(seg?.status);

  return segments.map((seg, i) => {
    const status = String(seg?.status || '').toLowerCase();
    if (!UNKNOWN_STATUS.has(status)) return seg;
    if (seg?.arrival?.actual) return { ...seg, status: 'landed' };
    const row = rowFor(seg);
    const boardText = String(row?.status?.generic?.status?.text || row?.status?.text || '').toLowerCase();
    if (isLanded(boardText)) return { ...seg, status: 'landed' };
    if (boardText === 'departed' || isAirborne(boardText)) return { ...seg, status: 'en-route' };
    // Newest-first: every index before `i` is a LATER leg of this tail.
    const laterDeparted = segments.slice(0, i).some(departed);
    const schedArrMs = row?.time?.scheduled?.arrival
      ? row.time.scheduled.arrival * 1000
      : Date.parse(seg?.arrival?.scheduled || '');
    const wellPast = !Number.isFinite(schedArrMs) || nowMs - schedArrMs > WELL_PAST_MS;
    if (laterDeparted && wellPast) return { ...seg, status: 'landed' };
    return seg;
  });
}
