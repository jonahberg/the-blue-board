// ═══ THE UNITED EXPRESS FLEET — WHAT THE DASHBOARD SAYS ABOUT IT ═══
// Search, sort, labels and the summary for the Fleet tab's "United Express" sub-tab, the flight
// panel and the aircraft dialog. The entries are `buildExpressFleet()` output (express-fleet.js);
// nothing here fetches or joins.
//
// Honesty rules, shared by every surface:
//  - An unknown type, cabin or operator is unknown — a dash, never a guess.
//  - Wi-Fi is "Starlink" when the Starlink roster lists the tail, "No Wi-Fi" only for a type
//    verified to have none (`w: 'None'` — CRJ200, ERJ145; EXPRESS_NO_WIFI_TYPES), and otherwise
//    not stated: an Express jet off the roster may have another system or none, so a blank must
//    never read as "no Wi-Fi".
//  - "First seen" is when the Blue Board first saw the tail flying United (the table began on
//    Oct 1 2026), not a delivery date.

/** About how many aircraft fly as United Express (the denominator the coverage note quotes). */
export const EXPRESS_FLEET_SIZE_ESTIMATE = 513;

/** The Fleet tab's Express table columns. */
export const EXPRESS_SORT_COLUMNS = Object.freeze(['r', 't', 'o', 'w', 'c', 'lf', 'ls']);

/**
 * The operator line: "SkyWest Airlines · United Express", or "United Express" when the operator
 * is not known.
 * @param {{o?: string}|null|undefined} entry
 */
export function expressOperatorLine(entry) {
  const operator = String(entry?.o || '').trim();
  return operator ? `${operator} · United Express` : 'United Express';
}

/**
 * The Wi-Fi words for an Express entry: 'Starlink', 'No Wi-Fi' (verified for the type), or ''
 * when it is not known. Starlink wins — the roster is the stronger signal.
 * @param {{w?: string}|null|undefined} entry
 * @param {boolean} [starlink]  the caller's own Starlink test (the roster Set), OR'd in.
 * @returns {'Starlink'|'No Wi-Fi'|''}
 */
export function expressWifiLabel(entry, starlink = false) {
  if (starlink || entry?.w === 'Starlink') return 'Starlink';
  if (entry?.w === 'None') return 'No Wi-Fi';
  return '';
}

/**
 * Every Express entry whose registration, type, operator, cabin, Wi-Fi or last United flight
 * contains the search text (case-insensitive). An empty search returns the list unchanged.
 * @template {{r: string, t?: string, o?: string, oc?: string, c?: string, w?: string, lf?: string}} T
 * @param {T[]} list
 * @param {string} search
 * @returns {T[]}
 */
export function filterExpressFleet(list, search) {
  const rows = Array.isArray(list) ? list : [];
  const q = String(search ?? '').trim().toLowerCase();
  if (!q) return rows;
  // "N85-377" and "n85377" both find N85377.
  const qReg = q.replace(/-/g, '');
  return rows.filter((e) => {
    if (String(e?.r || '').toLowerCase().includes(qReg)) return true;
    return [e?.t, e?.o, e?.oc, e?.c, e?.w, e?.lf].some((v) => String(v || '').toLowerCase().includes(q));
  });
}

function sortValue(entry, col) {
  if (col === 'ls') {
    const ms = Date.parse(entry?.ls || '');
    return Number.isFinite(ms) ? ms : null;
  }
  const v = String(entry?.[col] ?? '').trim();
  return v || null;
}

/**
 * Sorted copy. Blank values (an unknown type, no Starlink, never seen) sort LAST in both
 * directions, so flipping a column never fills the top of the table with dashes. Text compares as
 * plain strings, like the mainline table (`sortFleetData`); ties break on the registration.
 * @template {{r: string}} T
 * @param {T[]} list
 * @param {string} col  one of EXPRESS_SORT_COLUMNS; anything else sorts by registration.
 * @param {boolean} asc
 * @returns {T[]}
 */
export function sortExpressFleet(list, col, asc) {
  const key = EXPRESS_SORT_COLUMNS.includes(col) ? col : 'r';
  const dir = asc ? 1 : -1;
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    if (va === null && vb !== null) return 1;
    if (vb === null && va !== null) return -1;
    if (va !== null && vb !== null && va !== vb) {
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : va < vb ? -1 : 1;
      if (cmp !== 0) return cmp * dir;
    }
    const ra = String(a?.r || '');
    const rb = String(b?.r || '');
    return ra < rb ? -1 : ra > rb ? 1 : 0;
  });
}

/**
 * Dates are Zulu, like the dashboard's own clock. The table's backfilled first-seen values are
 * hub-local midnights on Oct 1 2026 (04:00–07:00Z); in a Pacific viewer's zone every one of them
 * would read "Sep 30", a day before the table began.
 */
const DATE_ZONE = 'UTC';

/**
 * 'Oct 1, 2026' — the "Seen flying United since …" date (UTC); '' when unparseable.
 * @param {string|null|undefined} iso
 * @param {string} [timeZone]  defaults to UTC.
 */
export function expressDateLabel(iso, timeZone = DATE_ZONE) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  try {
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone });
  } catch {
    return '';
  }
}

/**
 * When a tail was last seen flying United: '12m ago' / '5h ago' inside a day, then the short
 * date ('Oct 2'). '' when unparseable. A timestamp a little in the future (clock skew) reads
 * 'just now' rather than a negative age.
 * @param {string|null|undefined} iso
 * @param {number} [now]
 * @param {string} [timeZone]  for the short date; defaults to UTC.
 */
export function expressLastSeenLabel(iso, now = Date.now(), timeZone = DATE_ZONE) {
  const ms = Date.parse(iso || '');
  if (!Number.isFinite(ms)) return '';
  const mins = Math.round((now - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  try {
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });
  } catch {
    return '';
  }
}

/**
 * `summarizeExpressFleet()`'s counts as ordered rows: most aircraft first, then by name, with
 * the "Unknown …" bucket always last.
 * @param {Record<string, number>|null|undefined} counts
 * @returns {{label: string, count: number}[]}
 */
export function expressCountRows(counts) {
  const unknown = (label) => /^Unknown /.test(label);
  return Object.entries(counts || {})
    .map(([label, count]) => ({ label, count: Number(count) || 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => {
      if (unknown(a.label) !== unknown(b.label)) return unknown(a.label) ? 1 : -1;
      return b.count - a.count || a.label.localeCompare(b.label);
    });
}

/**
 * The one-line honesty note under the summary.
 * @param {number} total  entries in the Express fleet.
 * @param {number} staleDays  EXPRESS_STALE_DAYS.
 */
export function expressCoverageNote(total, staleDays) {
  const n = Number(total) || 0;
  return `Discovered from United Express flights seen in the last ${staleDays} days — about ${n} of ~${EXPRESS_FLEET_SIZE_ESTIMATE} aircraft; it fills in as more fly.`;
}
