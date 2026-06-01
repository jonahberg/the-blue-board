// ═══ STARLINK UTILITIES ═══
// Pure data functions for the STARLINK tab, extracted for testability (mirrors fleet-utils.js).

const MONTH_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Bucket Starlink aircraft into a continuous month-by-month installation series.
 *
 * @param {Array<{dateFound?: string, fleet?: string}>} aircraft - entries from /api/starlink-data
 * @param {Date} [nowDate] - "today"; the series always extends to this month
 * @returns {{ months: Array<{ym: string, label: string, express: number, mainline: number, total: number, cumulative: number}>, undated: number, total: number }}
 *
 * Rules:
 * - The series is continuous from the first install month to nowDate's month — months with zero
 *   installs are included so the time axis never lies.
 * - Aircraft whose dateFound is missing/unparseable are excluded from the bars and reported in
 *   `undated` (the chart footnote surfaces them).
 * - Labels are 'MMM' uppercase; the first month and every January carry a 2-digit year ('MAR 25').
 */
export function bucketInstallsByMonth(aircraft, nowDate = new Date()) {
  if (!Array.isArray(aircraft) || aircraft.length === 0) {
    return { months: [], undated: 0, total: 0 };
  }

  // Parse each aircraft's install month (UTC, from the YYYY-MM-DD prefix)
  const counts = new Map(); // ym -> {express, mainline}
  let undated = 0;
  let firstYm = null;

  for (const a of aircraft) {
    const raw = typeof a?.dateFound === 'string' ? a.dateFound.slice(0, 10) : '';
    const m = /^(\d{4})-(\d{2})/.exec(raw);
    if (!m || isNaN(Date.parse(raw))) { undated++; continue; }
    const ym = `${m[1]}-${m[2]}`;
    if (!counts.has(ym)) counts.set(ym, { express: 0, mainline: 0 });
    const bucket = counts.get(ym);
    if (String(a.fleet).toLowerCase() === 'mainline') bucket.mainline++;
    else bucket.express++;
    if (firstYm === null || ym < firstYm) firstYm = ym;
  }

  if (firstYm === null) {
    return { months: [], undated, total: aircraft.length };
  }

  // Walk a continuous range from firstYm to nowDate's month
  const endYear = nowDate.getUTCFullYear();
  const endMonth = nowDate.getUTCMonth(); // 0-based
  let [year, month] = firstYm.split('-').map(Number);
  month -= 1; // 0-based

  const months = [];
  let cumulative = 0;
  let isFirst = true;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    const ym = `${year}-${String(month + 1).padStart(2, '0')}`;
    const bucket = counts.get(ym) || { express: 0, mainline: 0 };
    const total = bucket.express + bucket.mainline;
    cumulative += total;

    const needsYear = isFirst || month === 0; // first month and every January
    const label = MONTH_LABELS[month] + (needsYear ? ' ' + String(year).slice(2) : '');

    months.push({ ym, label, express: bucket.express, mainline: bucket.mainline, total, cumulative });

    isFirst = false;
    month++;
    if (month > 11) { month = 0; year++; }
  }

  return { months, undated, total: aircraft.length };
}
