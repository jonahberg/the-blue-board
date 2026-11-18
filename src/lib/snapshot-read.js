// ═══ READING ONE FLIGHT OUT OF THE STORED HUB BOARDS ═══
// /api/flight-times answers "where is UA123?" from the hub boards in schedule_snapshots. Until
// Nov 2026 it read every board it might need — 18 for today, 18 more for yesterday, 18 for
// tomorrow — one request each, whole (~300 KB of JSON apiece, ~5 MB for today alone), to find the one
// or two boards that list the flight. A My Flights page with a dozen watched flights sends a dozen
// lookups at once, each on its own fresh server, so on Nov 16 2026 (23:20:40Z) Supabase received
// 489 board reads in about seven seconds; its median answer time went from 0.24 s to 2.2 s and
// every read in the burst ran out of its 3-second limit together.
//
// The read now asks once per batch of boards, and asks the database to send back only the boards
// that list the flight (`payload @> {flights:[{identification:{number:{default}}}]}`, the jsonb
// containment PostgREST exposes as `cs`). Of those boards it keeps only the flight's own rows.
// Every row the boards store carries `identification.number.default` as an upper-case "UA<digits>"
// (23,514 of 23,514 rows checked Nov 18 2026), which is exactly what containment compares.

/**
 * The jsonb containment value that matches a board listing `flightNumber`.
 * @param {string} flightNumber  "UA123"
 */
export function boardListsFlightFilter(flightNumber) {
  return { flights: [{ identification: { number: { default: String(flightNumber || '').toUpperCase() } } }] };
}

/**
 * The rows of one stored board that are `flightNumber`, compared the way the boards are read
 * everywhere else (upper-cased `identification.number.default`).
 * @param {any} payload  a schedule_snapshots `payload` (the board as /api/schedule served it)
 * @param {string} flightNumber
 * @returns {any[]}
 */
export function flightRowsOnBoard(payload, flightNumber) {
  const wanted = String(flightNumber || '').toUpperCase();
  const flights = Array.isArray(payload?.flights) ? payload.flights : [];
  return flights.filter((f) => String(f?.identification?.number?.default || '').toUpperCase() === wanted);
}

/**
 * Stored rows → `cache_key` → `{ data: { flights }, refreshedAt }`, carrying only the flight's rows.
 * A row with no payload, or no row for the flight, is left out: absent means "not on that board".
 * @param {Array<{cache_key?: string, payload?: any, refreshed_at?: string}>|null|undefined} rows
 * @param {string} flightNumber
 * @param {number} [nowMs]  used when a row's refreshed_at does not parse
 * @returns {Map<string, {data: {flights: any[]}, refreshedAt: number}>}
 */
export function boardsFromRows(rows, flightNumber, nowMs = Date.now()) {
  const boards = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = typeof row?.cache_key === 'string' ? row.cache_key : '';
    if (!key || !row?.payload) continue;
    const flights = flightRowsOnBoard(row.payload, flightNumber);
    if (!flights.length) continue;
    const refreshedAt = Date.parse(String(row.refreshed_at || ''));
    boards.set(key, { data: { flights }, refreshedAt: Number.isFinite(refreshedAt) ? refreshedAt : nowMs });
  }
  return boards;
}

/**
 * The one log line for a batch read that failed, instead of one line per board. Names the flight,
 * how many boards were asked for, and the first key so the day can be read off it.
 * @param {string[]} cacheKeys
 * @param {string} flightNumber
 * @param {string} message
 */
export function boardBatchFailureLine(cacheKeys, flightNumber, message) {
  const keys = Array.isArray(cacheKeys) ? cacheKeys : [];
  const first = keys[0] || 'no keys';
  const more = keys.length > 1 ? ` and ${keys.length - 1} more` : '';
  return `Schedule snapshot read failed for ${String(flightNumber || '?')} across ${keys.length} board(s) (${first}${more}): ${message}`;
}
