// ═══ THE FAA ANSWER THAT OUTLIVES ONE SERVER ═══
// When both FAA sources fail, /api/faa answers with the last good answer it has, flagged with its
// age (`X-BB-FAA-Stale`, seconds), for up to 30 minutes (Nov 10 2026). That answer lived only in
// the memory of the server that got it. /api/faa is cached at the edge for five minutes, so a
// server answers it rarely and is usually new: on Nov 14 2026, 19:00–19:22 UTC, FAA refused both
// sources (HTTP 403) and 25 requests from 18 visitors found nothing to fall back on. The answer is
// now also stored in the database, so any server can serve it with its true age.
//
// What may be stored: an answer FAA actually gave, parsed — including "no programs" ([]), which
// is a real answer. Never the empty or unreadable body that /api/faa treats as untrusted.

/** Past this age the honest answer is the error (FAA programs run for hours; 30 min covers a blip). */
export const FAA_LAST_GOOD_MAX_AGE_MS = 30 * 60 * 1000;

/** A server stores the answer at most this often; the edge cache already makes it rarer. */
export const FAA_LAST_GOOD_STORE_EVERY_MS = 60 * 1000;

/** The JSON stored for one answer: tagged, so a row that is not an FAA answer is never served. */
export function faaLastGoodPayload(airports) {
  return { source: 'faa', airports: Array.isArray(airports) ? airports : [] };
}

/**
 * A stored row → `{ airports, at }` (`at` = when FAA gave the answer, epoch ms), or null when the
 * row is missing or is not an FAA answer.
 * @param {{payload?: any, refreshed_at?: string}|null|undefined} row
 */
export function faaLastGoodFromRow(row) {
  const payload = row?.payload;
  if (!payload || payload.source !== 'faa' || !Array.isArray(payload.airports)) return null;
  const at = Date.parse(String(row?.refreshed_at || ''));
  if (!Number.isFinite(at)) return null;
  return { airports: payload.airports, at };
}

/**
 * The newest answer on hand that is within the age limit, with its age, or null. A time a little
 * in the future (another server's clock) counts as age 0.
 * @param {Array<{airports: any[], at: number}|null|undefined>} candidates
 * @param {number} nowMs
 * @param {number} [maxAgeMs]
 * @returns {{airports: any[], at: number, ageMs: number}|null}
 */
export function pickFaaLastGood(candidates, nowMs, maxAgeMs = FAA_LAST_GOOD_MAX_AGE_MS) {
  let best = null;
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!c || !Array.isArray(c.airports) || !Number.isFinite(c.at)) continue;
    if (Math.max(0, nowMs - c.at) > maxAgeMs) continue;
    if (!best || c.at > best.at) best = c;
  }
  return best ? { airports: best.airports, at: best.at, ageMs: Math.max(0, nowMs - best.at) } : null;
}

/** True when a server that last stored at `lastStoredAtMs` should store again at `nowMs`. */
export function shouldStoreFaaLastGood(lastStoredAtMs, nowMs, everyMs = FAA_LAST_GOOD_STORE_EVERY_MS) {
  return !Number.isFinite(lastStoredAtMs) || nowMs - lastStoredAtMs >= everyMs;
}
