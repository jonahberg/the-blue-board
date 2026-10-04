// ═══ FLIGHT WATCH STORAGE AND POLLING CADENCE ═══
// The watch list's storage contract, the gate that decides whether a status change is
// worth a notification, and the per-flight cache TTL for /api/flight-times.
//
// Extracted verbatim from src/dashboard/main.js (:6154 MAX_WATCHED, :6240-6247
// read/write, :7191-7204 the change gate, :6373-6391 the TTL ladder). Storage and
// the clock are injected; the badge update and the notification itself stay in main.js.

import { resolveFlightStatus } from './flight-status-resolve.js';
import { isOnGround } from './flight-phase.js';
import { liveFlightMatchesLeg, onGroundAt } from './my-flights.js';
import { resolveLegState } from './watch-leg.js';
import {
  delayBucket,
  isForwardTransition,
  isTerminalPhase,
  laterPhase,
  phaseOfStatusKey,
  phaseOfStatusText,
} from './watch-rules.js';

const WATCHED_KEY = 'bb_watched_flights';

/** Hard cap on the watch list. */
export const MAX_WATCHED = 20;

/**
 * @param {{getItem: (k: string) => string|null}} storage
 * @returns {Array<{flight: string, route: string, status: string, ts: number}>}
 *   an empty list on corrupt JSON or unavailable storage — never throws.
 */
export function readWatched(storage) {
  try { return JSON.parse(storage.getItem(WATCHED_KEY) || '[]'); } catch (e) { return []; }
}

/**
 * Persist the watch list, truncated to MAX_WATCHED. Never throws.
 * @param {{setItem: (k: string, v: string) => void}} storage
 * @param {Array<Object>} list
 */
export function writeWatched(storage, list) {
  try { storage.setItem(WATCHED_KEY, JSON.stringify(list.slice(0, MAX_WATCHED))); } catch (e) { /* storage full or unavailable */ }
}

/**
 * Apply a whole board's worth of changes to the watch list in ONE pass.
 *
 * A landed schedule board can move several watched flights at once. main.js:7191-7204
 * accumulated those into one array and saved once; applying them one at a time against a
 * snapshot that only advances on render is how earlier transitions get dropped — and a
 * dropped transition is not just a lost save, it is an alert that fires again on the next
 * load because the stored baseline never moved.
 *
 * Per change: a non-empty `status` that differs restamps `ts` (it is a new sighting); a
 * non-empty `route` that differs is filled in WITHOUT a `ts` bump (learning the route is
 * not a status sighting); so are the watched leg's scheduled departure `dep` and the delay
 * band already announced, `delayBucket` (Oct 2026: optional fields, absent on older entries).
 * A flight that is not watched is ignored. Order is preserved.
 *
 * @param {Array<{flight: string, route: string, status: string, ts: number, dep?: number, delayBucket?: number}>} list
 * @param {Array<{flight: string, status?: string, route?: string, dep?: number, delayBucket?: number}>} changes
 * @param {number} [now]  epoch ms; injectable for tests.
 * @returns {Array<Object>} the SAME array reference when nothing moved — callers use that
 *   to skip the write and the re-render, so a board of unchanged rows costs nothing.
 */
export function applyWatchChanges(list, changes, now = Date.now()) {
  if (!Array.isArray(list) || !Array.isArray(changes) || changes.length === 0) return list;
  let next = null;
  for (const change of changes) {
    if (!change || !change.flight) continue;
    const source = next || list;
    const index = source.findIndex((entry) => entry && entry.flight === change.flight);
    if (index < 0) continue;
    const entry = source[index];
    const status = change.status && change.status !== entry.status ? change.status : null;
    const route = change.route && change.route !== entry.route ? change.route : null;
    const dep = Number(change.dep) > 0 && change.dep !== entry.dep ? change.dep : null;
    const bucket = Number.isFinite(change.delayBucket) && change.delayBucket !== entry.delayBucket ? change.delayBucket : null;
    if (!status && !route && dep == null && bucket == null) continue;
    const updated = { ...entry };
    if (status) { updated.status = status; updated.ts = now; }
    if (route) updated.route = route;
    if (dep != null) updated.dep = dep;
    if (bucket != null) updated.delayBucket = bucket;
    next = source.map((e, i) => (i === index ? updated : e));
  }
  return next || list;
}

// AeroDataBox's word for a landed flight is "Arrived" (classifySchedStatus shows the provider
// word), FR24's is "Landed". Both are the landed state (v1.11.3; api/_watch-diff.ts's
// statusPhase already treats them as one).
function isLandedText(lower) {
  return lower.includes('landed') || lower.includes('arrived');
}

/**
 * Is this status transition worth waking the passenger for?
 *
 * One rule with the push cron (src/lib/watch-rules.js, Oct 4 2026): only a FORWARD phase change —
 * departed, landed, a confirmed cancellation, a diversion. Both words are classified first, so a
 * re-statement in another vocabulary or case ("En route" after "En Route", "Arrived" after "Landed")
 * is never news; neither is a status moving backwards (the departures board, which never advances
 * to landed, loading after the arrivals board) or a "Delayed" word (delays alert on minutes:
 * `evaluateWatchObservation`).
 *
 * Moving INTO "Likely Canceled" is not news either (v1.12.0): the provider's unconfirmed
 * cancellation was wrong for 38 of 45 flights on Oct 3 2026 — they were seen flying. A later
 * Canceled or Departed alerts from it as usual.
 *
 * @param {string|null|undefined} oldStatus
 * @param {string|null|undefined} newStatus
 * @returns {boolean} false when either side is missing or nothing changed.
 */
export function isSignificantStatusChange(oldStatus, newStatus) {
  if (!oldStatus || !newStatus || oldStatus === newStatus) return false;
  return isForwardTransition(phaseOfStatusText(oldStatus), phaseOfStatusText(newStatus));
}

/** The word a watch shows for a phase when the provider's own word contradicts it. */
export const PHASE_LABEL = {
  scheduled: 'Scheduled',
  likely_canceled: 'Likely Canceled',
  departed: 'Departed',
  landed: 'Landed',
  cancelled: 'Canceled',
  diverted: 'Diverted',
};

/**
 * @typedef {Object} WatchObservation
 * @property {string} flight
 * @property {import('./watch-rules.js').WatchPhase} phase
 * @property {string} key     the board classifier key (or the phase, from /api/flight-times).
 * @property {string} text    the word to show — always one that means `phase`.
 * @property {number} dep     the leg's scheduled departure, epoch SECONDS (0 = unknown).
 * @property {number|null} delayMin  estimated (or actual) gate departure minus scheduled.
 * @property {string} route   'ORD→SFO', or ''.
 */

/**
 * One schedule-board row → an observation of the watched leg, or null when the row proves
 * nothing: a TIME-INFERRED status (the clock crossed the grace window) is not evidence, and an
 * unknown status is pipeline noise.
 *
 * The phase comes from the classifier KEY, never the provider's word: a row can carry key
 * 'landed' with the word "En route" (phone QA Oct 4 2026: "UA2059 ROC→ORD: En route (was: En
 * Route)" for a flight that had landed 16 minutes earlier).
 *
 * @param {Object} row  a board row.
 * @param {{key: string, text: string, inferred?: boolean}|null} status  classifySchedStatus(row).
 * @returns {WatchObservation|null}
 */
export function observationFromBoardRow(row, status) {
  const flight = row?.identification?.number?.default;
  if (!flight || !status || status.inferred) return null;
  const phase = phaseOfStatusKey(status.key);
  if (phase === 'unknown') return null;
  const text = status.text && phaseOfStatusText(status.text) === phase ? status.text : PHASE_LABEL[phase];
  const t = row.time || {};
  const sched = Number(t.scheduled?.departure) > 0 ? Number(t.scheduled.departure) : 0;
  const real = Number(t.real?.departure) > 0 ? Number(t.real.departure) : 0;
  const est = Number(t.estimated?.departure) > 0 ? Number(t.estimated.departure) : 0;
  const best = real || est;
  const orig = row.airport?.origin?.code?.iata || '';
  const dest = row.airport?.destination?.code?.iata || '';
  return {
    flight,
    phase,
    key: status.key,
    text,
    dep: sched,
    delayMin: sched && best ? Math.round((best - sched) / 60) : null,
    route: orig && dest ? `${orig}→${dest}` : '',
  };
}

/**
 * The My Flights polling path → an observation (coordinator, phone QA Oct 4 2026: the cards flipped
 * to "Landed" within a minute or two while no alert fired, because in-tab alerts only ran on
 * Schedule-board reloads). The /api/flight-times payload decides (src/lib/watch-leg.js), and the
 * live feed adds what only it knows — but only a live row on THIS leg's route: the aircraft
 * airborne after the scheduled departure −15 min is departed; on the ground at the destination it
 * has landed.
 *
 * @param {Object|null} td  the /api/flight-times payload.
 * @param {Object|null} liveFlight  findLiveFlight()'s row, which may be another leg of the number.
 * @param {number} [nowMs]
 * @returns {WatchObservation|null}
 */
export function observationFromFlightTimes(td, liveFlight, nowMs = Date.now()) {
  const state = resolveLegState(td, nowMs);
  if (!state || !td?.flight) return null;
  let phase = state.phase;
  let text = '';
  const live = liveFlightMatchesLeg(liveFlight, state.origin, state.dest) ? liveFlight : null;
  if (live) {
    const pre = phase === 'scheduled' || phase === 'likely_canceled';
    if ((pre || phase === 'departed') && onGroundAt(live, state.dest)) phase = 'landed';
    else if (pre && !isOnGround(live) && nowMs >= state.schedDepMs - 15 * 60000) {
      phase = 'departed';
      text = 'En Route';
    }
  }
  if (phase === 'unknown') return null;
  const flight = String(td.flight).replace(/^UAL/, 'UA');
  return {
    flight,
    phase,
    key: phase,
    text: text || PHASE_LABEL[phase] || '',
    dep: Math.floor(state.schedDepMs / 1000),
    delayMin: state.delayMin,
    route: state.origin && state.dest ? `${state.origin}→${state.dest}` : '',
  };
}

/** Two observations this close in scheduled departure are the same leg. */
const SAME_LEG_SEC = 2 * 3600;
/** A watched leg this far past its departure is over, whatever we last heard. */
const LEG_OVER_SEC = 30 * 3600;
/** A stored status older than this describes an earlier leg, not the one being observed. */
const STALE_STATUS_MS = 12 * 3600e3;

/**
 * What one observation does to one watched entry — the whole in-tab alert rule, shared by the
 * Schedule-board diff and the My Flights polling path so they cannot disagree or double-fire
 * (whichever sees a change first records it; the other then sees nothing new).
 *
 *  - The entry follows ONE leg (`dep`, its scheduled departure). An observation of an earlier leg
 *    is ignored; of a later one, ignored until the followed leg is over (landed / cancelled /
 *    diverted, or 30 h past departure) — then the entry moves to it SILENTLY. (The background
 *    push watch ends at that point instead; in-tab alerts only reach someone looking at the page.)
 *  - Status: forward phase changes only (watch-rules.js). A backwards or same-phase observation
 *    neither alerts nor overwrites the stored word, so "Landed" from My Flights is not undone by a
 *    stale board row still saying "En route".
 *  - Delay: the band (15 / 30 / 60 / each hour) going up, before departure. The first band seen
 *    is a baseline, not news.
 *
 * @param {{flight: string, status?: string, ts?: number, dep?: number, delayBucket?: number}} entry
 * @param {WatchObservation} obs
 * @param {number} [nowMs]
 * @returns {{notify: null|'status'|'delay', change: {flight: string, status?: string, dep?: number, delayBucket?: number}|null}}
 */
export function evaluateWatchObservation(entry, obs, nowMs = Date.now()) {
  const none = { notify: null, change: null };
  if (!entry || !obs || obs.phase === 'unknown' || !obs.phase) return none;
  const prevPhase = phaseOfStatusText(entry.status);
  const pinned = Number(entry.dep) > 0 ? Number(entry.dep) : 0;
  const obsDep = Number(obs.dep) > 0 ? Number(obs.dep) : 0;
  const bucket = delayBucket(obs.delayMin);
  const adopt = () => ({ notify: null, change: { flight: entry.flight, status: obs.text, ...(obsDep ? { dep: obsDep } : {}), delayBucket: bucket } });

  if (pinned && obsDep && Math.abs(obsDep - pinned) > SAME_LEG_SEC) {
    if (obsDep < pinned) return none;
    const over = isTerminalPhase(prevPhase) || nowMs / 1000 - pinned > LEG_OVER_SEC;
    return over ? adopt() : none;
  }
  // Not yet following a leg (an entry from before legs were tracked): a stored status further
  // along than this leg, stamped long ago, was about an earlier leg — start on this one quietly.
  if (!pinned && obsDep && isForwardTransition(obs.phase, prevPhase) && nowMs - Number(entry.ts || 0) > STALE_STATUS_MS) {
    return adopt();
  }

  const news = isForwardTransition(prevPhase, obs.phase);
  const kept = laterPhase(prevPhase === 'unknown' ? undefined : prevPhase, obs.phase);
  const status = news || prevPhase === 'unknown' || (kept === obs.phase && kept !== prevPhase) ? obs.text : entry.status;
  const stored = Number.isFinite(entry.delayBucket) ? entry.delayBucket : null;
  const preDeparture = kept === 'scheduled' || kept === 'likely_canceled';
  const delayNews = !news && preDeparture && stored != null && bucket > stored;
  return {
    notify: news ? 'status' : delayNews ? 'delay' : null,
    change: {
      flight: entry.flight,
      ...(status ? { status } : {}),
      ...(obsDep || pinned ? { dep: pinned || obsDep } : {}),
      delayBucket: stored == null ? bucket : Math.max(stored, bucket),
    },
  };
}

/**
 * Did this watched flight just land? The "glad you landed" toast asks this (inventory §12).
 *
 * `status` is the `classifySchedStatus()` result for the row, and its `key` decides — never the
 * display text, which is the provider's own word: AeroDataBox rows read "Arrived", so the
 * shipped `text.includes('landed')` check could not fire on a single board row (v1.11.3).
 * A presumed/inferred landing (the clock passed the grace window) is a guess, not an arrival,
 * and a flight already stored as landed has not just landed.
 *
 * @param {string|null|undefined} previousStatus  the stored status text.
 * @param {{key?: string, inferred?: boolean, presumed?: boolean}|null|undefined} status
 * @returns {boolean}
 */
export function watchedFlightLanded(previousStatus, status) {
  if (!status || status.key !== 'landed' || status.inferred || status.presumed) return false;
  return !isLandedText(String(previousStatus || '').toLowerCase());
}

/**
 * The one honest sentence about where a watch alert will actually reach the viewer.
 *
 * FOUR tiers, not three: "we have not asked the server yet" is a different claim from
 * "this deployment cannot do it", and on a cold panel the first is true for a few
 * hundred milliseconds. Every tier is a PROMISE — a panel that says "even when this tab
 * is closed" with no subscription behind it is the most misleading thing this feature
 * can say — so the top tier requires the whole chain: server keys, browser APIs, and
 * granted permission.
 *
 * Extracted from src/dashboard/main.js (:5328-5352 renderWatchAlertsFootnote).
 *
 * @param {{backgroundActive?: boolean, bootstrapped?: boolean, configured?: boolean}} push
 * @returns {string}
 */
export function watchAlertsFootnote(push) {
  const state = push || {};
  if (state.backgroundActive) {
    return 'Background alerts on — you’ll be notified even when this tab is closed.';
  }
  if (state.bootstrapped && state.configured) {
    return 'Alerts work while this tab is open. Enable notifications for background alerts.';
  }
  if (state.bootstrapped && !state.configured) {
    return 'Alerts work while this tab is open. Background alerts: not yet enabled on this deployment.';
  }
  return 'Alerts work while this tab is open.';
}

/**
 * Deterministic per-flight jitter (0–20 s) so watched flights do not all re-poll on
 * the same tick.
 * @param {string|null|undefined} flightNumber
 * @returns {number} milliseconds.
 */
function cacheJitter(flightNumber) {
  return (flightNumber || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 20000;
}

/**
 * How long to cache one flight's /api/flight-times response.
 *
 * Tightens as departure approaches and relaxes once the flight has resolved:
 * failure 30 s · cancelled/diverted/landed 300 s · departing within 90 min 45 s ·
 * within 6 h 60 s · otherwise 120 s — each plus the per-flight jitter.
 *
 * @param {Object|null} timeData  the /api/flight-times payload.
 * @param {string|null|undefined} flightNumber
 * @param {number} [now]  epoch ms; injectable for tests.
 * @returns {number} milliseconds.
 */
export function flightTimesCacheTtl(timeData, flightNumber, now = Date.now()) {
  const jitter = cacheJitter(flightNumber);
  if (!timeData || timeData.success === false) return 30000 + jitter;

  const status = resolveFlightStatus(timeData, null);
  if (status === 'cancelled' || status === 'diverted' || status === 'landed') {
    return 300000 + jitter;
  }

  const departureTime = timeData.departure?.gate?.estimated || timeData.departure?.gate?.scheduled;
  const departureMs = departureTime ? new Date(departureTime).getTime() : null;
  if (departureMs && departureMs - now < 90 * 60000) return 45000 + jitter;
  if (departureMs && departureMs - now < 6 * 60 * 60 * 1000) return 60000 + jitter;
  return 120000 + jitter;
}

/**
 * What the watch panel can honestly say — and offer — about notifications (phone QA Oct 4 2026:
 * the panel said "Enable notifications for background alerts" with no control anywhere near it).
 *
 *  - 'on'          background alerts will arrive with the tab closed.
 *  - 'tab-only'    permission granted, but this deployment has no push keys: notifications only
 *                  while the tab is open (the in-tab watch fires them when the tab is hidden).
 *  - 'available'   the browser can do it and has not been asked: show the button.
 *  - 'blocked'     the viewer (or the browser) said no; only the site settings can undo that.
 *  - 'ios-home-screen'  iPhone/iPad Safari: web notifications exist only for a site added to the
 *                  Home Screen and opened from there.
 *  - 'unsupported' no notification API at all.
 *  - 'checking'    the server has not answered yet.
 *
 * @param {{configured?: boolean, bootstrapped?: boolean, permission?: string}} push
 * @param {{hasNotification?: boolean, hasPush?: boolean, isIos?: boolean, isStandalone?: boolean}} env
 * @returns {{state: string, text: string, canEnable: boolean}}
 */
export function notificationControlState(push, env) {
  const p = push || {};
  const e = env || {};
  if (!e.hasNotification) {
    if (e.isIos && !e.isStandalone) {
      return {
        state: 'ios-home-screen',
        text: 'On iPhone and iPad, alerts need the site on your Home Screen: tap Share, then Add to Home Screen, and open The Blue Board from there.',
        canEnable: false,
      };
    }
    return { state: 'unsupported', text: 'This browser can’t show notifications. Alerts appear here while this tab is open.', canEnable: false };
  }
  if (p.permission === 'denied') {
    return {
      state: 'blocked',
      text: 'Notifications are blocked for this site. Allow them in your browser’s site settings (the icon left of the address), then reload.',
      canEnable: false,
    };
  }
  if (p.permission === 'granted') {
    if (p.configured && e.hasPush) return { state: 'on', text: 'Background alerts on — you’ll be notified even when this tab is closed.', canEnable: false };
    if (!p.bootstrapped) return { state: 'checking', text: 'Alerts work while this tab is open.', canEnable: false };
    return { state: 'tab-only', text: 'Notifications on while this tab is open. Background alerts aren’t available here.', canEnable: false };
  }
  return {
    state: 'available',
    text: p.configured && e.hasPush
      ? 'Get a notification when a watched flight departs, lands or is delayed — even with this tab closed.'
      : 'Get a notification when a watched flight departs, lands or is delayed while this tab is open.',
    canEnable: true,
  };
}
