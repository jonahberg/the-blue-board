// ═══ FAA STATUS: INDEX, PROSE AND ROUTE CONTEXT ═══
// Three views of the /api/faa payload:
//  - buildFaaIndex     the by-airport lookup every weather/schedule panel reads
//  - explainFAAStatus  the plain-English paragraph behind a hub card's "▾ Details"
//  - getFAADelayContext the one-line route summary appended to delayed board rows
//
// Extracted verbatim from src/dashboard/main.js (:5810-5821 buildFaaIndex,
// :4446-4481 explainFAAStatus, :6133-6151 getFAADelayContext). The index is injected
// rather than read from a module global so this stays pure.
//
// describeFaaProgram is NOT here: it already lives in ./delay-explain-context.js and
// main.js imports it from there. Re-implementing it would fork one rule into two.

/** @typedef {{airportCode?: string, delays?: Array<Object>}} FaaAirport */

/**
 * Build the FAA delay index from the /api/faa response (per-airport shape with programs[]).
 *
 * @param {FaaAirport[]|unknown} faaResponse
 * @returns {Record<string, FaaAirport>} empty when the payload is not an array (API outage).
 */
export function buildFaaIndex(faaResponse) {
  const index = {};
  if (!Array.isArray(faaResponse)) return index;
  for (const airport of faaResponse) {
    const code = airport.airportCode;
    if (!code) continue;
    // The new API returns per-airport objects directly — store them as-is
    // with backward-compat fields already populated by the server
    index[code] = airport;
  }
  return index;
}

/**
 * Plain-English description of an airport's FAA delay programs.
 *
 * A closure short-circuits to its own NOTAM sentence; everything else is narrated as
 * "<code> is currently experiencing <kind> [of <range>] due to <reason>." with an
 * optional trend clause. Multiple delays are joined into one paragraph.
 *
 * @param {string} airportCode
 * @param {Array<Object>|null|undefined} delays  the airport's `delays[]`.
 * @param {Object} rawData  the full airport entry (unused today; kept for callers).
 * @returns {string}
 */
export function explainFAAStatus(airportCode, delays, rawData) {
  if (!delays || delays.length === 0) {
    return `${airportCode} is operating normally — no reported delays or restrictions.`;
  }

  const explanations = delays.map(d => {
    let text = `${airportCode} is currently experiencing `;
    const dtype = (d.type || '').toLowerCase();
    const reason = d.reason || 'unknown causes';

    if (dtype.includes('departure')) text += `departure delays`;
    else if (dtype.includes('arrival')) text += `arrival delays`;
    else if (dtype.includes('ground stop') || dtype.includes('groundstop')) text += `a ground stop`;
    else if (dtype.includes('ground delay') || dtype.includes('gdp')) text += `a ground delay program`;
    else if (dtype.includes('closure') || dtype.includes('closed')) {
      return `${airportCode} is closed${d.startTime ? ' from ' + d.startTime : ''}${d.endTime ? ' to ' + d.endTime : ''}${reason !== 'unknown causes' ? ' due to ' + reason : ''} per NOTAM. This is a recurring restriction.`;
    }
    else text += `delays`;

    if (d.avgDelay || d.minDelay || d.maxDelay) {
      const range = d.minDelay && d.maxDelay ? `${d.minDelay}-${d.maxDelay} minutes` : d.avgDelay ? `approximately ${d.avgDelay} minutes` : '';
      if (range) text += ` of ${range}`;
    }

    text += ` due to ${reason}.`;

    if (d.trend) {
      if (d.trend.toLowerCase().includes('increas')) text += ` This is an increasing trend — delays may get worse.`;
      else if (d.trend.toLowerCase().includes('decreas')) text += ` Delays are decreasing — conditions improving.`;
    }

    return text;
  });

  return explanations.join(' ');
}

/**
 * One-line FAA context for a route, e.g.
 * "Ground Stop at EWR, avg 45 min · GDP at ORD".
 *
 * @param {Record<string, FaaAirport>} faaIndex  from buildFaaIndex().
 * @param {string|null|undefined} originIata
 * @param {string|null|undefined} destIata
 * @returns {string} '' when neither end has a delay.
 */
export function getFAADelayContext(faaIndex, originIata, destIata) {
  const contexts = [];
  [originIata, destIata].forEach(apt => {
    if (!apt) return;
    const faa = faaIndex[apt];
    if (!faa || !faa.delays || !faa.delays.length) return;
    faa.delays.forEach(d => {
      const dtype = (d.type || '').toLowerCase();
      let label = 'Delay';
      if (dtype.includes('ground stop')) label = 'Ground Stop';
      else if (dtype.includes('ground delay') || dtype.includes('gdp')) label = 'GDP';
      else if (dtype.includes('departure')) label = 'Dep Delay';
      else if (dtype.includes('arrival')) label = 'Arr Delay';
      const avg = d.avgDelay ? `, avg ${d.avgDelay} min` : '';
      contexts.push(`${label} at ${apt}${avg}`);
    });
  });
  return contexts.join(' · ');
}
