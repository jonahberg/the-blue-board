// ═══ IROPS CLIENT FALLBACK ═══
// The counts behind the IROPS bar when /api/irops never answered: cancellations,
// >30m / >60m delays, diversions and the denominator, recomputed from the schedule
// boards this session happens to have loaded.
//
// Extracted verbatim from src/dashboard/main.js (:4956-5000 updateIrops's gather +
// count loops). The weighting and the labels stay in ./irops-score.js — this module
// only produces the counts those functions take.
//
// F002: the fallback restricts itself to TODAY'S DEPARTURES boards. Mixing directions
// double-counts one physical flight from an arrivals board, and mixing days folds
// tomorrow's schedule into a "today" index — either makes the denominator a lie.
// `classify` is injected the same way ./hub-health.js injects it, so the counting is
// testable without the schedule-status machinery.

/**
 * The board keys the fallback is allowed to read: `<hub>-departures-0` only.
 *
 * @param {Record<string, Array<Object>>} boardsByKey  keyed `<hub>-<dir>-<day>`.
 * @returns {Array<{fl: Object, dir: 'departures', key: string}>}
 */
export function collectTodayDepartureRows(boardsByKey) {
  const rows = [];
  for (const [key, flights] of Object.entries(boardsByKey || {})) {
    if (!Array.isArray(flights)) continue;
    const parts = key.split('-');
    const dir = parts[1] === 'arrivals' ? 'arrivals' : 'departures';
    const day = parts[2];
    if (dir !== 'departures' || day !== '0') continue;
    for (const fl of flights) rows.push({ fl, dir, key });
  }
  return rows;
}

/**
 * Count the IROPS inputs across the collected rows.
 *
 * "Likely Canceled" (`canceled_uncertain`) groups with cancellations — a flight the
 * provider suspects is cancelled is a disruption whether or not it is later confirmed.
 * `delayed30` stays CUMULATIVE (it includes the >60m rows) so the bar's ">30m" figure
 * remains truthful; `iropsScore()` derives the exclusive 30–60 bucket itself.
 *
 * @param {Array<{fl: Object, dir: string, key: string}>} rows
 * @param {{classify: (fl: Object, dir: string, key: string) => {key: string}}} deps
 * @returns {{cancellations: number, delayed30: number, delayed60: number, diversions: number, total: number}}
 */
export function countIropsFromRows(rows, { classify }) {
  let cancellations = 0;
  let delayed30 = 0;
  let delayed60 = 0;
  let diversions = 0;
  const list = Array.isArray(rows) ? rows : [];

  for (const { fl, dir, key } of list) {
    // Direction matters: canceled_uncertain resolves via the direction-appropriate real
    // timestamp, so a hardcoded 'departures' would miscount an arrivals board's rows.
    const status = classify(fl, dir, key) || {};
    if (status.key === 'canceled' || status.key === 'canceled_uncertain') cancellations += 1;
    if (status.key === 'diverted') diversions += 1;

    const schedT = fl?.time?.scheduled?.departure || fl?.time?.scheduled?.arrival || 0;
    const actT =
      fl?.time?.real?.departure
      || fl?.time?.real?.arrival
      || fl?.time?.estimated?.departure
      || fl?.time?.estimated?.arrival
      || 0;
    if (schedT && actT && actT > schedT) {
      const delayMin = Math.round((actT - schedT) / 60);
      if (delayMin > 30) delayed30 += 1;
      if (delayMin > 60) delayed60 += 1;
    }
  }

  return { cancellations, delayed30, delayed60, diversions, total: list.length };
}

/**
 * Both steps at once — what the Weather tab's IROPS section calls.
 *
 * @param {Record<string, Array<Object>>} boardsByKey
 * @param {{classify: (fl: Object, dir: string, key: string) => {key: string}}} deps
 */
export function countIropsFromBoards(boardsByKey, { classify }) {
  return countIropsFromRows(collectTodayDepartureRows(boardsByKey), { classify });
}
