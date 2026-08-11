// Pure helpers for the deploy-time Starlink figure refresh
// (scripts/refresh-starlink-facts.mjs). Kept dependency-free so both the build
// script (node) and vitest can import them.

/** Floor to the nearest 25 for a "500+"-style prose label that can only be stale conservatively. */
export function starlinkLabel(count) {
  return `${Math.floor(count / 25) * 25}+`;
}

/** "August 2026" — UTC so the label doesn't depend on the build machine's timezone. */
export function starlinkAsOf(date = new Date()) {
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Guard for the fetched count: integer, never below the committed last-good
 * value (installs are monotonic — a lower number means a partial feed), never
 * above the entire tracked fleet (~1,815 as of Aug 2026; 2500 leaves headroom).
 */
export function isPlausibleStarlinkCount(count, committedCount) {
  return Number.isInteger(count) && count >= committedCount && count <= 2500;
}
