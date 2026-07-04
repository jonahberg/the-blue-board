// ═══ DELAY DELTA FORMATTING ═══
// Formats a known departure/arrival delay (minutes vs schedule) for the schedule
// board's DELAY / RISK column. Audit Jul 3 2026: the column was blank on departed
// rows while the real delta hid as tiny sub-text in the TIME cell — a flight with a
// known +140m delay displayed an AI prediction instead of the fact.
//
// Convention: "+Nm" under 90 minutes, "+XhYYm" at 90 minutes and above (a wall of
// minutes like "+140m" is harder to read than "+2h20m"). Early departures render
// with a proper minus sign ("−12m").

/**
 * @param {number} minutes  signed delay in minutes (positive = late).
 * @returns {string} formatted delta, or '' when the input is not a finite number.
 */
export function formatDelayMinutes(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return '';
  const rounded = Math.round(Number(minutes));
  const sign = rounded < 0 ? '−' : '+';
  const abs = Math.abs(rounded);
  if (abs < 90) return `${sign}${abs}m`;
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h${String(m).padStart(2, '0')}m`;
}

/**
 * Severity color token for a delay delta. Mirrors DESIGN.md status colors:
 * green = on-time/early, yellow = moderate delay, red = severe delay.
 */
export function delayColorVar(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 15) return 'var(--ua-green)';
  if (n <= 60) return 'var(--ua-yellow)';
  return 'var(--ua-red)';
}
