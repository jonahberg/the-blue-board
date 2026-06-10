// ═══ DATA AGE FORMATTING ═══
// Humanizes the schedule API's meta.dataAge (seconds) for degraded-board banners.
// A frozen board once showed "cached data from 1775m ago" — a wall of minutes that
// reads as a glitch instead of the warning it is. Hours/days keep the age legible.

/**
 * Human-readable age: "just now", "42m", "5h", "3d".
 */
export function formatDataAge(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 172800) return `${Math.round(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/**
 * Severity bucket for styling: 'recent' (<1h), 'aging' (1-6h), 'stale' (6h+).
 * 6h matches the server's clean-board TTL — anything older than one full cache
 * lifetime is no longer "a slightly old board", it is the frozen-board failure mode.
 */
export function dataAgeSeverity(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  if (s < 3600) return 'recent';
  if (s < 21600) return 'aging';
  return 'stale';
}
