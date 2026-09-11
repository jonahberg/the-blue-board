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
 * @param {number|null|undefined} delayMin
 * @returns {''|'on-time'|'minor'|'major'} '' when the delay is unknown.
 */
export function journeyDelayClass(delayMin) {
  if (delayMin === null || delayMin === undefined) return '';
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
