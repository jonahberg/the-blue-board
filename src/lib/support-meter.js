// ═══ SUPPORT METER ═══
// "What it costs to keep this free" — the two-bar cost-transparency widget inside the
// About/Donate popover (inventory §13).
//
// Extracted verbatim from public/js/support-meter.js. The rule that matters is the
// failure rule: this widget may only ever ADD to the popover. A missing field, an
// unconfigured live feed, a malformed payload or a failed fetch all resolve to `null`,
// and the caller renders nothing at all rather than an empty frame or a zeroed bar.

/** At or above this share of the budget the bar turns amber — a heads-up, not an error. */
export const SUPPORT_WARN_PCT = 85;

function clampPct(value) {
  return Math.max(0, Math.min(100, value));
}

/**
 * @typedef {Object} SupportMeterRow
 * @property {string} key
 * @property {string} label
 * @property {string} valueLabel  the figure shown at the end of the row.
 * @property {number} pct  clamped to [0, 100] — the bar's width.
 * @property {boolean} warn  true at or above SUPPORT_WARN_PCT.
 */

/**
 * Shape `/api/support-stats` into bars.
 *
 * @param {{boards?: {used: number, budget: number},
 *   liveFeed?: {configured: boolean, usedPct?: number},
 *   monthlyCostNote?: string}|null|undefined} data
 * @returns {{rows: SupportMeterRow[], note: string}|null} null when there is nothing
 *   truthful to show.
 */
export function supportMeterModel(data) {
  if (!data || typeof data !== 'object') return null;

  const rows = [];

  const boards = data.boards;
  if (
    boards &&
    Number.isFinite(boards.used) &&
    Number.isFinite(boards.budget) &&
    boards.budget > 0
  ) {
    const pct = clampPct((boards.used / boards.budget) * 100);
    rows.push({
      key: 'boards',
      label: "Today's board refreshes",
      valueLabel: `${boards.used}/${boards.budget}`,
      pct,
      warn: pct >= SUPPORT_WARN_PCT,
    });
  }

  // `configured: false` is the live feed saying "no budget is being tracked" — a bar drawn
  // from it would be a number we do not have.
  const liveFeed = data.liveFeed;
  if (liveFeed && liveFeed.configured && Number.isFinite(liveFeed.usedPct)) {
    const pct = clampPct(liveFeed.usedPct);
    rows.push({
      key: 'liveFeed',
      label: 'Live-feed budget this month',
      valueLabel: `~${liveFeed.usedPct}% used`,
      pct,
      warn: pct >= SUPPORT_WARN_PCT,
    });
  }

  if (!rows.length) return null;

  return {
    rows,
    note: typeof data.monthlyCostNote === 'string' ? data.monthlyCostNote : '',
  };
}
