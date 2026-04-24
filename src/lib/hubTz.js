// ═══ HUB TIMEZONE MATH ═══
// Shared across client (src/dashboard/main.js) and server (api/irops.ts).
// Why: client and server previously had divergent calendar logic. Client used
// `new Date(y, m-1, d+offset)` in browser-local time, which lied for NRT/GUM
// viewers from the Americas. Adding `86400 * dayOffset` lost or gained an hour
// across DST transitions (23/25-hour days). This module is the single source of
// truth for hub-local start-of-day timestamps.

export const HUB_TZ = {
  ORD: 'America/Chicago',
  DEN: 'America/Denver',
  IAH: 'America/Chicago',
  EWR: 'America/New_York',
  SFO: 'America/Los_Angeles',
  IAD: 'America/New_York',
  LAX: 'America/Los_Angeles',
  NRT: 'Asia/Tokyo',
  GUM: 'Pacific/Guam',
};

function partsToObj(parts) {
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  return o;
}

function getFmt(tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

// Given a candidate "start-of-day" timestamp and a hub TZ formatter, return
// the drift (in seconds from midnight) when that timestamp is formatted in the
// hub TZ. Drift = 0 means we landed on exact hub-local midnight.
function driftFromMidnight(tsSec, fmt) {
  const p = partsToObj(fmt.formatToParts(new Date(tsSec * 1000)));
  return (+p.hour) * 3600 + (+p.minute) * 60 + (+p.second);
}

// Snap a candidate timestamp to the nearest hub-local midnight, correcting for
// DST transitions. Works on both normal (drift near 0) and DST-shifted days
// (drift ~3600s from spring-forward or fall-back).
function snapToMidnight(tsSec, fmt) {
  const drift = driftFromMidnight(tsSec, fmt);
  if (drift === 0) return tsSec;
  return drift > 43200 ? tsSec + (86400 - drift) : tsSec - drift;
}

/**
 * Unix timestamp (seconds) for the start of the given hub-local day.
 * DST-safe: handles spring-forward (23h day) and fall-back (25h day).
 *
 *   dayOffset = -1  → yesterday (hub-local)
 *   dayOffset =  0  → today     (hub-local)
 *   dayOffset = +1  → tomorrow  (hub-local)
 *
 * `now` is primarily for testing. Callers should let it default to the current
 * time so the function follows real-world clock drift.
 */
export function getStartOfHubDay(hub, dayOffset = 0, now = new Date()) {
  const tz = HUB_TZ[hub] || 'America/New_York';
  const fmt = getFmt(tz);

  // Step 1: compute start-of-today in hub TZ (DST-safe).
  const p = partsToObj(fmt.formatToParts(now));
  const hour = +p.hour;
  const minute = +p.minute;
  const second = +p.second;
  const localSecsSinceMidnight = hour * 3600 + minute * 60 + second;
  const approxMidnight = Math.floor(now.getTime() / 1000) - localSecsSinceMidnight;
  const startOfToday = snapToMidnight(approxMidnight, fmt);

  if (dayOffset === 0) return startOfToday;

  // Step 2: for non-zero offsets, add 86400*offset then snap again. On DST
  // transition days this corrects for the lost/gained hour.
  return snapToMidnight(startOfToday + dayOffset * 86400, fmt);
}

/**
 * Human-readable day label for a hub-local date, e.g. "Wed, Apr 24".
 * Uses the noon-of-that-day timestamp internally to avoid any midnight-boundary
 * rounding surprises when the formatter picks a weekday.
 */
export function getHubDayLabel(hub, dayOffset = 0, now = new Date()) {
  const tz = HUB_TZ[hub] || 'America/New_York';
  const startSec = getStartOfHubDay(hub, dayOffset, now);
  const noonMs = (startSec + 12 * 3600) * 1000;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(noonMs));
}

/**
 * Hub-local calendar date parts (year/month/day) as zero-padded strings.
 * Useful when constructing API queries keyed on hub-local date.
 */
export function getHubLocalDate(hub, timestampMs = Date.now()) {
  const tz = HUB_TZ[hub] || 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestampMs));
  const p = partsToObj(parts);
  return { year: p.year, month: p.month, day: p.day };
}
