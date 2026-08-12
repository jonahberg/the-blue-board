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

/** @param {string} filename */
export function csvHeaders(filename) {
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
  };
}

/** @param {string} filename */
export function jsonHeaders(filename) {
  return {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
  };
}
