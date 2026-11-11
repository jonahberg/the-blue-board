// ═══ FAA PROGRAMS: HOW OLD IS WHAT WE ARE SHOWING? ═══
// TODOS (Nov 2026): after a failed /api/faa refresh the dashboard kept the last programs and showed
// them as current, forever. Since Nov 2026 the endpoint also answers a double FAA failure with its
// last good answer (up to 30 min old) and an `X-BB-FAA-Stale: <age in seconds>` header. So every
// FAA answer now carries the moment it describes (`asOf`), and the clients decide from the clock:
//
//   - a program whose own end time fell after `asOf`, and more than FAA_PROGRAM_END_GRACE_MS ago,
//     has probably ended: it is cleared. (One that ended BEFORE `asOf` was still listed by the FAA
//     after its end time — not lifted yet, e.g. an extension pending — so it stays.) The grace is
//     how late news of an extension can reach the page: a ground stop extended a minute before its
//     end would otherwise vanish and come back, re-announced by the hub strip, once a fresh answer
//     got through the edge cache. Only an unambiguous ISO end time counts; the XML fallback's bare
//     "1500" says nothing about the day.
//   - past FAA_STALE_AFTER_MS the whole answer is stale: no program from it is shown as current,
//     and the panel says "FAA status as of HH:MMZ" instead.
//
// The same rules serve the dashboard (src/app/state/weather.tsx) and the /newark widget
// (src/scripts/newark-live.ts).

import { buildFaaIndex } from './faa-context.js';
import { parseStaleHeader } from './feed-health.js';

/**
 * Past this age an FAA answer is stale. A healthy answer can already be ~15 min old by the time it
 * reaches the page (the edge serves it for 300 s and revalidates in the background for 600 s
 * more), and the dashboard refreshes every 5 min, so anything under ~20 min is normal operation.
 */
export const FAA_STALE_AFTER_MS = 25 * 60 * 1000;

/**
 * How long past its end time a program is still given the benefit of the doubt. An extension can
 * take this long to reach the page: up to a 5-minute dashboard refresh, plus an edge copy served
 * up to 15 minutes old while it revalidates (s-maxage=300, stale-while-revalidate=600) — in
 * practice the next refresh after that brings it, so ~15 minutes covers it.
 */
export const FAA_PROGRAM_END_GRACE_MS = 15 * 60 * 1000;

/**
 * The moment an /api/faa answer describes: when it arrived, less the server's own staleness
 * (`X-BB-FAA-Stale`, seconds) and the edge cache's (`Age`, seconds).
 * @param {number} receivedAtMs
 * @param {string|null|undefined} staleHeader
 * @param {string|null|undefined} ageHeader
 */
export function faaAnswerAsOf(receivedAtMs, staleHeader, ageHeader) {
  return receivedAtMs - parseStaleHeader(staleHeader) - parseStaleHeader(ageHeader);
}

// A full date, a time and a zone: "2026-03-28T21:59:00Z", "…T21:59:00.000+00:00".
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * A program's end time in epoch ms, or null when it is not an absolute time (missing, or the XML
 * feed's "1500").
 * @param {unknown} endTime
 */
export function programEndMs(endTime) {
  const text = String(endTime ?? '').trim();
  if (!ISO_WITH_ZONE.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * True when the program's end time fell after the answer was taken, and more than the grace
 * (FAA_PROGRAM_END_GRACE_MS) before now.
 */
export function isProgramPastEnd(program, asOfMs, nowMs) {
  const end = programEndMs(program?.endTime);
  if (end === null) return false;
  return end >= asOfMs && end + FAA_PROGRAM_END_GRACE_MS < nowMs;
}

const TYPE_FLAGS = {
  ground_stop: 'groundStop',
  ground_delay: 'groundDelay',
  departure_delay: 'departureDelay',
  arrival_delay: 'arrivalDelay',
  closure: 'closure',
};

/**
 * The answer without the programs that are past their own end time (see isProgramPastEnd),
 * `programs` and the legacy `delays` together, with the airport's boolean flags recomputed from
 * what is left. Airports with nothing expired come back as the same objects.
 * @param {Array<object>} airports  the /api/faa body.
 * @param {number} asOfMs
 * @param {number} nowMs
 * @returns {{airports: Array<object>, expired: string[]}}  `expired`: "EWR:ground_stop" keys.
 */
export function withoutExpiredPrograms(airports, asOfMs, nowMs) {
  const expired = [];
  if (!Array.isArray(airports)) return { airports: [], expired };
  const out = airports.map((airport) => {
    if (!airport || typeof airport !== 'object') return airport;
    const programs = Array.isArray(airport.programs) ? airport.programs : [];
    const delays = Array.isArray(airport.delays) ? airport.delays : [];
    const gone = (p) => isProgramPastEnd(p, asOfMs, nowMs);
    if (!programs.some(gone) && !delays.some(gone)) return airport;
    for (const p of programs) if (gone(p)) expired.push(`${airport.airportCode}:${p?.type}`);
    const keptPrograms = programs.filter((p) => !gone(p));
    const keptDelays = delays.filter((d) => !gone(d));
    const next = { ...airport, programs: keptPrograms, delays: keptDelays };
    for (const [type, flag] of Object.entries(TYPE_FLAGS)) {
      if (flag in airport) next[flag] = keptPrograms.some((p) => p?.type === type) || keptDelays.some((d) => d?.type === type);
    }
    return next;
  });
  return { airports: out, expired };
}

/**
 * What the dashboard should treat as the CURRENT FAA picture at `nowMs`.
 * @param {Array<object>|null} airports  the last /api/faa body that was obtained.
 * @param {number|null} asOfMs  the moment it describes (faaAnswerAsOf).
 * @param {number} nowMs
 * @returns {{index: Record<string, object>, stale: boolean, key: string}}
 *   index  buildFaaIndex() of the programs still current — empty once the answer is stale, so no
 *          surface (hub strip, ticker, delay risk) presents an old program as a live one.
 *   stale  the answer is older than FAA_STALE_AFTER_MS.
 *   key    changes only when `stale` or the set of expired programs changes, so a clock tick can
 *          tell whether anything a reader would see is different.
 */
export function currentFaaPicture(airports, asOfMs, nowMs) {
  if (!Array.isArray(airports) || asOfMs === null || asOfMs === undefined || !Number.isFinite(asOfMs)) {
    return { index: {}, stale: false, key: 'none' };
  }
  const stale = nowMs - asOfMs > FAA_STALE_AFTER_MS;
  if (stale) return { index: {}, stale: true, key: `stale:${asOfMs}` };
  const { airports: current, expired } = withoutExpiredPrograms(airports, asOfMs, nowMs);
  return { index: buildFaaIndex(current), stale: false, key: `live:${asOfMs}:${expired.join(',')}` };
}

/** "14:05Z" — the clock the Weather tab already uses (radar title, hub reading ages). */
export function zuluClock(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}Z`;
}

/**
 * The NAS panel's line when what it can show is old. Null while both feeds are current (or were
 * never obtained — that is "unavailable", not "stale").
 * @param {{faaAsOf: number|null, faaStale: boolean, nasAsOf: number|null, nasStale: boolean}} s
 * @returns {string|null}
 */
export function faaStatusAsOfLine({ faaAsOf, faaStale, nasAsOf, nasStale }) {
  const faa = faaStale && Number.isFinite(faaAsOf);
  const nas = nasStale && Number.isFinite(nasAsOf);
  if (!faa && !nas) return null;
  const asOf = faa && nas ? Math.min(faaAsOf, nasAsOf) : faa ? faaAsOf : nasAsOf;
  const what = faa && nas
    ? 'the FAA has not answered since, so no program is shown as current.'
    : faa
      ? 'airport programs have not updated since and are not shown as current.'
      : 'system-wide programs have not updated since and are not shown as current.';
  return `FAA status as of ${zuluClock(asOf)}: ${what}`;
}

// ═══ "UNKNOWN" IS NOT "CALM" ═══
// A stale answer leaves `faaIndex` empty (currentFaaPicture), and an empty index is exactly what a
// quiet day looks like: the ticker fell back to "All systems normal" and the hub strip's network
// chip to "Smooth Ops" while the FAA had not answered for half an hour. When nothing else points at
// a disruption, those two places now say what is true: we do not know.

/**
 * Past this, a newer (still stale) answer moves the "since" time; closer than this it is the same
 * snapshot seen again (the server's last good answer re-served, its age rounded to whole seconds).
 */
export const FAA_UNKNOWN_SINCE_STEP_MS = 5 * 60 * 1000;

/**
 * The moment the FAA picture became unknown, held steady while it stays unknown. The hub strip is
 * a polite live region, so its words may change only when the state does, never on a poll that
 * brings the same old snapshot back with a slightly different computed age.
 *
 * @param {number|null} prevSince  what this returned last time.
 * @param {boolean} faaStale
 * @param {number|null} faaAsOf    the held answer's moment (faaAnswerAsOf).
 * @returns {number|null}  null whenever the answer is not stale.
 */
export function faaUnknownSince(prevSince, faaStale, faaAsOf) {
  if (!faaStale || !Number.isFinite(faaAsOf)) return null;
  if (Number.isFinite(prevSince) && faaAsOf - prevSince < FAA_UNKNOWN_SINCE_STEP_MS) return prevSince;
  return faaAsOf;
}

/**
 * "FAA status unknown since 14:05", on the viewer's own clock (24-hour, like the "Z" clock the
 * Weather tab prints, but local). `timeZone` is for tests.
 * @param {number} sinceMs
 * @param {string} [timeZone]
 */
export function faaUnknownLine(sinceMs, timeZone) {
  if (!Number.isFinite(sinceMs)) return 'FAA status unknown';
  const clock = new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(timeZone ? { timeZone } : {}),
  }).format(new Date(sinceMs));
  return `FAA status unknown since ${clock}`;
}

/**
 * The network chip's words when the FAA picture is unknown, or null when the chip should read as
 * usual: the FAA answer is current, or something else (on-time, IROPS) already says the network is
 * not normal. Unknown never reads green.
 * @param {{level?: string}|null} network  networkLabel() / networkStatus().
 * @param {number|null} unknownSince       faaUnknownSince().
 * @param {string} [timeZone]
 * @returns {string|null}
 */
export function networkUnknownText(network, unknownSince, timeZone) {
  if (!network || network.level !== 'normal' || !Number.isFinite(unknownSince)) return null;
  return faaUnknownLine(unknownSince, timeZone);
}
