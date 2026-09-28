// @ts-check

/**
 * Serialize tracker records without introducing a CSV dependency. Values are always quoted so
 * commas, quotes, newlines, and source lists round-trip cleanly in spreadsheets and data tools.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {string[]} columns
 */
export function toCsv(rows, columns) {
  /** @param {unknown} value */
  const quote = (value) => {
    const normalized = Array.isArray(value) ? value.join(' | ') : value ?? '';
    return `"${String(normalized).replaceAll('"', '""')}"`;
  };

  return `${columns.map(quote).join(',')}\n${rows
    .map((row) => columns.map((column) => quote(row[column])).join(','))
    .join('\n')}\n`;
}

/**
 * The tracker exports are prerendered (`output: 'static'`), so an endpoint's own
 * Cache-Control and Content-Disposition never reach a visitor — production headers come from
 * vercel.json's `/trackers/(.*)` rule (F109). Only the Content-Type is kept: the build uses it.
 */
export const CSV_HEADERS = { 'Content-Type': 'text/csv; charset=utf-8' };
export const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

/**
 * The descriptive download name per tracker, applied by the link's `download` attribute
 * (same-origin, so it overrides the URL's `atc.csv`) — the one place it can take effect.
 * @type {Record<'atc' | 'united-hubs', string>}
 */
export const TRACKER_DOWNLOAD_NAMES = {
  atc: 'blue-board-faa-tfdm-airports',
  'united-hubs': 'blue-board-united-hub-projects',
};
