// ═══ FR24 FLIGHT LOOKUP — QUERY + PRESENTATION MODEL ═══
// What a typed flight number becomes, what colour and word a returned status gets, and
// whether the answer needs the leg-date disclaimer.
//
// Extracted from src/dashboard/main.js (:7418-7426 lookupFR24Flight normalisation,
// :7463-7465 status colours, :7492-7504 the F048 leg disclaimer, :7540-7543 fmtTime).

/**
 * Status → colour. DATA, not theme: these are the shipped palette values, and the
 * rendering layer always prints the status WORD beside the swatch, so the colour is
 * never the only carrier of the state.
 */
export const FR24_STATUS_COLORS = {
  'en-route': '#22c55e',
  'on-ground': '#f59e0b',
  landed: '#3b82f6',
  scheduled: '#6b7280',
  unknown: '#6b7280',
};

/** @param {string|null|undefined} status */
export function fr24StatusColor(status) {
  return FR24_STATUS_COLORS[status] || FR24_STATUS_COLORS.unknown;
}

/** 'en-route' → 'EN ROUTE'. */
export function fr24StatusLabel(status) {
  return String(status || 'unknown').replace(/-/g, ' ').toUpperCase();
}

/**
 * What the visitor typed → what the endpoint is asked for.
 *
 * Bare digits are United by assumption (this is a United dashboard), and `UAL123` is
 * the ICAO spelling of the same flight the IATA-keyed endpoint calls `UA123`.
 *
 * @param {string} query
 * @returns {string}
 */
export function normalizeFr24Query(query) {
  let q = String(query || '').trim().toUpperCase().replace(/\s+/g, '');
  if (/^\d{1,4}$/.test(q)) q = `UA${q}`;
  if (q.startsWith('UAL') && /\d/.test(q[3])) q = `UA${q.slice(3)}`;
  return q;
}

/**
 * F048 — whether this answer is about a leg the visitor may not have meant.
 *
 * A flight number flies several legs a day and the live/summary tier returns whichever
 * is active or most recent. Without this label the modal is silently authoritative
 * about somebody else's departure.
 *
 * @param {string|null|undefined} source
 * @param {{liveLeg?: boolean, legDate?: string}|null|undefined} meta
 * @param {(date: Date) => string} [formatDate]  injectable for tests.
 * @returns {{show: boolean, legDateLabel: string, text: string}}
 */
export function fr24LegDisclaimer(source, meta, formatDate) {
  const show = Boolean(meta?.liveLeg) || String(source || '').indexOf('live') !== -1;
  let legDateLabel = '';
  if (show && meta?.legDate) {
    try {
      const date = new Date(meta.legDate);
      if (!Number.isNaN(date.getTime())) {
        legDateLabel = formatDate
          ? formatDate(date)
          : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      }
    } catch {
      legDateLabel = '';
    }
  }
  return {
    show,
    legDateLabel,
    text: 'Flight numbers fly multiple legs daily — this is the leg currently active or most recent, not necessarily your date or route.',
  };
}

/**
 * A departure/arrival time as the modal prints it.
 *
 * Seconds-since-epoch and ISO strings both arrive here depending on the upstream tier;
 * anything unparseable is shown verbatim rather than replaced with a dash, because the
 * raw value is more use to someone debugging than "—".
 *
 * @param {string|number|null|undefined} value
 * @returns {string}
 */
export function formatFr24Time(value) {
  if (!value) return '—';
  try {
    const date = new Date(typeof value === 'number' ? value * 1000 : value);
    return Number.isNaN(date.getTime())
      ? String(value)
      : date.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short',
        });
  } catch {
    return String(value);
  }
}

/**
 * The footer attribution, including the cache marker.
 * @param {boolean|undefined} cached
 */
export function fr24Attribution(cached) {
  return `Powered by Flightradar24 Official API${cached ? ' • cached' : ''}`;
}

/**
 * The inline (non-blocking) message when a lookup cannot answer.
 *
 * A failed lookup is not worth a modal (audit Jul 3 2026) — it is a dead end for what
 * was meant to be a quick search. The sentence names the query so repeated failures
 * read as separate events rather than one stuck banner.
 *
 * @param {string} query  already normalised.
 * @param {string|null|undefined} error  the server's own message, when it sent one.
 * @returns {string}
 */
export function fr24FailureMessage(query, error) {
  return `${error || `No data found for ${query}`} — the flight may not be active right now. Check the Schedule tab for gate status.`;
}
