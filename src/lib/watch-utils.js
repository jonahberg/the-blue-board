// ═══ FLIGHT WATCH STORAGE AND POLLING CADENCE ═══
// The watch list's storage contract, the gate that decides whether a status change is
// worth a notification, and the per-flight cache TTL for /api/flight-times.
//
// Extracted verbatim from src/dashboard/main.js (:6154 MAX_WATCHED, :6240-6247
// read/write, :7191-7204 the change gate, :6373-6391 the TTL ladder). Storage and
// the clock are injected; the badge update and the notification itself stay in main.js.

import { resolveFlightStatus } from './flight-status-resolve.js';

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
 * Is this status transition worth waking the passenger for?
 *
 * @param {string|null|undefined} oldStatus
 * @param {string|null|undefined} newStatus
 * @returns {boolean} false when either side is missing or nothing changed.
 */
export function isSignificantStatusChange(oldStatus, newStatus) {
  if (!oldStatus || !newStatus || oldStatus === newStatus) return false;
  const nl = newStatus.toLowerCase();
  // Always notify: cancelled, diverted, landed, departed
  if (nl.includes('cancel') || nl.includes('divert') || nl.includes('landed') || nl.includes('departed')) return true;
  // Notify if delay appeared or gate changed
  if (nl.includes('delay')) return true;
  if (nl.includes('gate') && nl !== oldStatus.toLowerCase()) return true;
  // Generic status text changed (e.g. scheduled → en route)
  const ol = oldStatus.toLowerCase();
  const significantKeys = ['cancel', 'divert', 'landed', 'departed', 'en route', 'delay', 'gate'];
  if (significantKeys.some(k => nl.includes(k) || ol.includes(k))) return true;
  return false;
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
