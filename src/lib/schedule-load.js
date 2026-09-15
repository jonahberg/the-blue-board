// ═══ SCHEDULE BOARD LOADING — PURE DECISIONS ═══
// Everything the Schedule tab's loader decides WITHOUT touching the network, the DOM or
// React: cache keys, the retry ladder, the server-clock offset, the board's "as of" stamp,
// and the staleness/degradation banner ladder (inventory §20).
//
// The loader in src/app/state/schedule.tsx owns the fetch, the AbortController and the
// state; this module owns every branch that has a right answer, so those branches are
// unit-tested instead of only being reachable through a live AeroDataBox board.
//
// The banner ladder in particular is not cosmetic. Each branch was added by an incident:
// PR #207 made aged-but-complete boards degraded=false, which silently dropped their
// warning; "paused" read as dishonest to the owner; teal on a six-hour-old board reads as
// "all good" when it is the frozen-board failure mode.

import { dataAgeSeverity, formatDataAge } from './data-age.js';

/** Retries per load (the first attempt plus two more). Legacy `MAX_RETRIES`. */
export const MAX_SCHEDULE_RETRIES = 3;

/** Abort a board fetch after this long. Legacy 60 000 ms. */
export const SCHEDULE_TIMEOUT_MS = 60000;

/** How long a preload sweep suppresses the next one (`bb_sched_preload_ts`). */
export const PRELOAD_TTL_MS = 10 * 60 * 1000;

/** Hubs the idle preload warms, in order. Sequential on purpose — see `preload()`. */
export const PRELOAD_HUBS = ['ORD', 'DEN', 'EWR'];

/** A clean board older than this gets the muted age chip rather than nothing. */
export const AGE_CHIP_THRESHOLD_SECONDS = 600;

/**
 * In-memory aggregation cache key. Byte-for-byte the shipped `agg-<hub>-<dir>-<ts>` so a
 * Refresh that deletes the key and a load that reads it can never disagree.
 *
 * @param {string} hub
 * @param {string} dir
 * @param {number} timestamp  start-of-hub-day, SECONDS.
 */
export function aggCacheKey(hub, dir, timestamp) {
  return `agg-${hub}-${dir}-${timestamp}`;
}

/**
 * localStorage key for the equipment-swap snapshot (storage contract, inventory §29).
 * `bb_sched_<hub>_<dir>_<day>` holding `{flightNumber: icaoAircraftCode}` — underscores,
 * not the hyphens of `boardKey()`, because that is what shipped and what returning
 * visitors already have on disk.
 */
export function swapStorageKey(hub, dir, day) {
  return `bb_sched_${hub}_${dir}_${day}`;
}

/**
 * Backoff before retry `attempt` (0-based; attempt 0 never waits).
 * 1 s, 2 s, then capped at 4 s — `min(1000 * 2^(attempt-1), 4000)`.
 */
export function retryDelayMs(attempt) {
  if (!Number.isFinite(attempt) || attempt <= 0) return 0;
  return Math.min(1000 * Math.pow(2, attempt - 1), 4000);
}

/**
 * The board's cache indicator — the shipped `main.js:4763` string, verbatim.
 *
 * It exists to explain an instant board: a load that never touched AeroDataBox lands with
 * no perceptible delay, and without this line the only available reading is "the refresh
 * did nothing". The count is the RAW flight total the cached response carried, before any
 * filter — the same `allUAFlights.length` the shipped line used, so a filtered view can
 * never make the cached board look smaller than it is.
 *
 * Empty string for a board that was really fetched, so the caller renders nothing at all
 * rather than an empty element.
 *
 * @param {{fromCache?: boolean, count?: number}} [board]
 * @returns {string}
 */
export function boardLoadMessage({ fromCache, count } = {}) {
  if (!fromCache) return '';
  return `⚡ Served from cache · ${Number(count) || 0} UA flights`;
}

/**
 * Should a PARTIAL board be thrown away and refetched?
 *
 * Yes for a board that lost some pages — another attempt usually completes it. No when the
 * first page itself failed and nothing came back: that is a known upstream outage, and
 * hammering it costs AeroDataBox units for a result we already know.
 *
 * @param {{partial?:boolean, total?:number, meta?:{partialReason?:string}}} result
 * @param {number} attempt  0-based attempt just completed.
 * @param {number} [maxRetries]
 */
export function shouldRetryPartial(result, attempt, maxRetries = MAX_SCHEDULE_RETRIES) {
  if (!result || !result.partial) return false;
  if (attempt >= maxRetries - 1) return false;
  const reason = result.meta?.partialReason || '';
  const failedBeforeAnyFlight = reason === 'first_page_failed' && Number(result.total || 0) === 0;
  return !failedBeforeAnyFlight;
}

/**
 * Client→server clock offset in SECONDS, learned from the schedule response's `Date` and
 * `Age` headers. `Date` is serve time and `Age` is how long the response sat in a CDN
 * cache, so the edge's "now" is `Date + Age`.
 *
 * Positive means the device clock runs AHEAD of the server. `classifySchedStatus()`
 * reclassifies long-past scheduled flights as departed, so a kiosk or EFB with bad NTP
 * would otherwise hide genuinely-upcoming flights or fabricate departures.
 *
 * @returns {number|null} null when the headers are unusable — the caller keeps its offset.
 */
export function serverClockOffsetSec(dateHeaderMs, ageSec, nowMs = Date.now()) {
  const serverMs = Number(dateHeaderMs);
  if (!Number.isFinite(serverMs) || serverMs <= 0) return null;
  const age = Number.isFinite(Number(ageSec)) ? Math.max(0, Math.floor(Number(ageSec))) : 0;
  return Math.floor(nowMs / 1000) - (Math.floor(serverMs / 1000) + age);
}

/**
 * The absolute instant (ms) a board's statuses are valid "as of".
 *
 * `meta.generatedAt` when the API stamped one, else fetch time minus `meta.dataAge`, else
 * the fetch time itself. Every field is defensive: a board restored from an older cache
 * shape may carry none of them.
 */
export function boardAsOfMs(meta, fetchedAtMs, nowMs = Date.now()) {
  if (meta && meta.generatedAt) {
    const parsed = Date.parse(meta.generatedAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const base = Number(fetchedAtMs) || nowMs;
  const age = Number(meta?.dataAge);
  if (meta && meta.dataAge != null && Number.isFinite(age)) return base - age * 1000;
  return base;
}

/**
 * "7:12 PM CDT" in the board's hub timezone — the absolute stamp the staleness banner and
 * the "Scheduled (as of …)" rows show. A relative age alone made viewers do clock maths.
 */
export function formatBoardAsOf(ms, timeZone) {
  const date = new Date(ms);
  try {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
      timeZoneName: 'short',
    });
  } catch {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
}

/**
 * Board time-zone abbreviation ("CDT") for the NOW divider and the footer.
 */
export function hubTzAbbrev(timeZone, now = new Date()) {
  try {
    return now.toLocaleTimeString('en-US', { timeZone, timeZoneName: 'short' }).split(' ').pop();
  } catch {
    return '';
  }
}

/**
 * The completeness suffix appended to a banner: " 87% loaded." / " 87% previously loaded."
 *
 * Suppressed entirely for `actual_only_official`, where the board is complete for what it
 * claims to be (same-day actuals) and a percentage would read as a failure.
 */
export function completenessSuffix({ partial, degraded, meta }) {
  const completeness = meta?.completeness;
  if (completeness == null) return '';
  if (meta?.partialReason === 'actual_only_official') return '';
  if (!partial && !degraded) return '';
  const pct = Math.round(Number(completeness) * 100);
  if (!Number.isFinite(pct)) return '';
  if (degraded && partial) return ` ${pct}% previously loaded.`;
  if (!degraded) return ` ${pct}% loaded.`;
  return '';
}

/**
 * The staleness / degradation ladder (inventory §20).
 *
 * @param {{partial?:boolean, degraded?:boolean, stale?:boolean, meta?:object}} result
 * @param {{asOf: string}} ctx  the hub-local "as of" stamp, already formatted.
 * @returns {{kind:'banner'|'age-chip'|'none', message:string, suffix:string,
 *            tone:'stale'|'aging'|'degraded'|'partial'|'muted', icon:string, asOf:string}}
 *   `tone` is a NAME, never a colour: the TSX maps it to token classes and always pairs it
 *   with `icon` + words, because status is never colour-alone (DESIGN.md).
 */
export function describeBoardCondition(result, { asOf } = {}) {
  const meta = result?.meta || {};
  const partial = Boolean(result?.partial);
  const degraded = Boolean(result?.degraded);
  const stale = Boolean(result?.stale);
  const dataAge = meta.dataAge;
  const hasAge = dataAge != null && Number.isFinite(Number(dataAge));

  if (!partial && !degraded && !stale) {
    // A clean board can still have been sitting on the CDN for a while (up to 6 h with no
    // staleness flag). A subtle chip keeps that honest without crying wolf.
    if (hasAge && Number(dataAge) > AGE_CHIP_THRESHOLD_SECONDS) {
      return {
        kind: 'age-chip',
        message: `data as of ${asOf}`,
        suffix: '',
        tone: 'muted',
        icon: '',
        asOf: asOf || '',
      };
    }
    return { kind: 'none', message: '', suffix: '', tone: 'muted', icon: '', asOf: asOf || '' };
  }

  const ageText = hasAge ? formatDataAge(dataAge) : '';
  let message;
  if (degraded && hasAge) {
    message = partial
      ? `Statuses as of ${asOf} (partial board, ${ageText} old) — showing the latest data we have.`
      : `Statuses as of ${asOf} (${ageText} old) — showing the latest data we have.`;
  } else if (stale && !partial && hasAge) {
    message = `Statuses as of ${asOf} (${ageText} old) — showing the latest data we have.`;
  } else if (meta.liveFeedFallbackAdded) {
    message = `Added ${meta.liveFeedFallbackAdded} live active flight(s) while the full schedule feed recovers.`;
  } else if (meta.partialReason === 'live_feed_fallback') {
    message = 'Showing live active flights while the full schedule feed recovers.';
  } else if (meta.partialReason === 'deadline_exceeded') {
    message = 'The request timed out before all pages were fetched.';
  } else if (meta.partialReason === 'first_page_failed') {
    message = 'The upstream data source is not responding.';
  } else if (meta.partialReason === 'actual_only_official') {
    message = 'Showing same-day actual flight times; scheduled times are unavailable.';
  } else if (meta.partialReason === 'page_fetch_failed') {
    message = `${meta.pagesFailed || 'Some'} page(s) failed to load.`;
  } else {
    message = 'Some flights may be missing.';
  }

  // Escalate with age: teal reads as "all good", a lie for a board that is hours old.
  const ageSeverity = (degraded || stale) && hasAge ? dataAgeSeverity(dataAge) : null;
  const tone =
    ageSeverity === 'stale' ? 'stale' : ageSeverity === 'aging' ? 'aging' : degraded ? 'degraded' : 'partial';
  const icon = tone === 'aging' || tone === 'degraded' ? '⏳' : '⚠️';

  return {
    kind: 'banner',
    message,
    suffix: completenessSuffix({ partial, degraded, meta }),
    tone,
    icon,
    asOf: asOf || '',
  };
}

/**
 * How many advanced filters are narrowing the board. Drives the drawer toggle's label, so
 * a viewer can never be filtered down to 12 rows with no visible reason.
 */
export function activeAdvFilterCount(filters) {
  if (!filters) return 0;
  const keys = ['status', 'aircraft', 'fleetFamily', 'routeType', 'starlink', 'timeRange', 'risk'];
  let count = 0;
  for (const key of keys) if (filters[key]) count += 1;
  if (String(filters.search || '').trim()) count += 1;
  return count;
}

/** The drawer toggle's label — accented once anything is active. */
export function advFilterLabel(count, open) {
  if (count > 0) return `Filters (${count} active) ${open ? '▴' : '▾'}`;
  return open ? 'Less Filters ▴' : 'Filter: Fleet, Aircraft, Starlink… ▾';
}

/**
 * The equipment-swap summary line: "⚠️ 3 equipment swaps detected · 1 downgrade · 2 upgrades".
 * A swap that is neither an upgrade nor a downgrade is still counted in the total.
 */
export function swapSummary(swaps, impactsFor) {
  const list = Array.isArray(swaps) ? swaps : [];
  if (!list.length) return null;
  let upgrades = 0;
  let downgrades = 0;
  for (const swap of list) {
    const impacts = impactsFor(swap) || [];
    if (impacts.some((i) => i.cls === 'downgrade')) downgrades += 1;
    else if (impacts.some((i) => i.cls === 'upgrade')) upgrades += 1;
  }
  return {
    total: list.length,
    upgrades,
    downgrades,
    text: `${list.length} equipment swap${list.length > 1 ? 's' : ''} detected`,
  };
}

/**
 * Should the board the viewer is LOOKING AT scroll itself to the NOW divider?
 *
 * The autoscroll signal is raised by whichever board load finished, and loads are not
 * cancelled when the viewer changes hub or direction mid-flight — a straggler for a board
 * they navigated away from still completes and still raises a signal. A signal that only
 * said "a today board landed" would therefore yank the board they ARE reading to its NOW
 * line, which reads as the page fighting them.
 *
 * So the signal carries the board key it was produced for, and only the board it names
 * responds, once.
 *
 * @param {{key: string, n: number}|null} signal  the latest autoscroll signal.
 * @param {string} currentKey  the board key on screen.
 * @param {number} lastHandledN  the `n` of the last signal this consumer acted on.
 * @returns {boolean}
 */
export function shouldAutoScroll(signal, currentKey, lastHandledN) {
  if (!signal || !signal.key) return false;
  if (!Number.isFinite(signal.n) || signal.n <= 0) return false;
  if (signal.n === lastHandledN) return false;
  return signal.key === currentKey;
}
