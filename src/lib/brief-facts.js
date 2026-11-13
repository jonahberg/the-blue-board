// ═══ OPS BRIEF: FACTS ═══
// Turns what the site already has (the /api/irops, /api/faa, /api/nas and /api/metar payloads, the
// live-feed airborne and Starlink counts, and the airborne_samples history) into the list of facts
// the brief is written from. Pure: payloads in, facts out. No fetches, no clock reads — `nowMs` is
// passed in, so a fixture rebuilds the same facts forever.
//
// Every fact:
//   { id, kind, hub?, statement, values, at, link, severity, toneFloor, material }
//   - id         stable and readable ("otp.LAX", "faa.active.EWR.gs", "air.starlink")
//   - statement  one plain sentence, written so a template brief can print it verbatim
//   - values     every surface form a sentence may use from this fact: numbers as printed ("85%"),
//                local clock times with a zone label ("9:00 PM ET"), airport codes and the names that
//                stand for them, cause words. The verifier (src/lib/brief-verify.js) allows a claim
//                only when it appears in the values of a fact the item cites.
//   - at         ISO time the underlying reading is from (a hub board can be two hours old)
//   - link       where a chip should take the reader: { tab, hub?, section? } (docs/specs/ops-brief.md
//                lists which of these resolve to a deep link today)
//   - severity   0–100, what a traveler should hear first (template ordering, fact ordering)
//   - toneFloor  the least alarming tone the brief may take while this fact holds
//   - material   the part of the fact that, when it changes, warrants a new brief: the story, not the
//                reading (bands, not counts). `null` means the fact is never part of the change key,
//                id included, so it appearing or disappearing is not a change either (materialKey).
//
// The numbers come from the site's own definitions, so a chip can never disagree with the hub strip:
// on-time is serverOtpFromMetrics() (src/lib/hub-health.js), network status is networkStatus()
// (src/lib/ops-health.js), weather impact is computeOpsImpact() (src/lib/metar-category.js).

import {
  BRIEF_HUBS, airportDisplayName, airportForms, isKnownAirportCode, numberWord, normalizeText,
} from './brief-claims.js';
import { boardCoverageGapSec, serverOtpFromMetrics, ON_TIME_GRACE_MIN } from './hub-health.js';
import { networkStatus, isWholeAirportClosure, withoutRoutineClosures } from './ops-health.js';
import { IROPS_MINOR_AT, IROPS_SIGNIFICANT_AT } from './irops-score.js';
import { buildFaaIndex } from './faa-context.js';
import { computeFlightCategory, computeOpsImpact, parseCeiling, parseVisibilitySM } from './metar-category.js';
import { airportTz } from './time-format.js';
import { defaultSchedDayOffset } from './hubTz.js';
import { isOnGround } from './flight-phase.js';
import { isExpressCallsign } from './airborne-count.js';
import { matchAircraft } from './fleet-match.js';

export { BRIEF_HUBS };
// The routine-closure screen is shared with the hub strip; it lives in ops-health.js.
export { isWholeAirportClosure };

/** A hub reading below this many operated departures is too thin to call an outlier or set the tone. */
export const BRIEF_MIN_OPERATED = 25;
/**
 * Fewer hub on-time readings than this and there is no brief to write: "running smoothly" needs
 * evidence. The cron publishes nothing (the last brief goes stale honestly) until enough boards read.
 */
export const BRIEF_MIN_HUB_READINGS = 3;
/**
 * A hub board whose day has gone unseen for longer than this is left out of the brief: its on-time
 * and per-hub cancellation facts (the live boards run 1–3 hours old). Measured as the board's
 * coverage gap (src/lib/hub-health.js boardCoverageGapSec) — its age for today's board, but 0 for a
 * yesterday board built after local midnight, which is final however old it is (Nov 2026; age alone
 * dropped every final yesterday board before 06:00 local). The same 3 h as HUB_BOARD_CURRENT_MAX_SEC.
 */
export const BRIEF_MAX_BOARD_AGE_MS = 3 * 60 * 60 * 1000;
/**
 * The disruption-index fact is left out when boards more than BRIEF_MAX_BOARD_AGE_MS behind hold
 * more than this share of the index's departures (Nov 2026). Flight-weighted, so a stale NRT or GUM
 * board (under 1% of the departures) never silences it, and a stale ORD (about a quarter) with any
 * other stale hub does. The tone rules are unchanged: net.status still reads the same index.
 */
export const BRIEF_INDEX_MAX_STALE_SHARE = 0.25;

/**
 * Why a hub board is too far behind for the brief, or null when it is current. Its coverage gap
 * (age for today's board; the unseen part of yesterday for yesterday's), from the payload's own
 * build time and day end at `nowMs`. A payload without `boardDayEndSec` is judged by age, as before.
 * @param {any} m  one /api/irops hubMetrics entry
 * @param {number} nowMs
 * @returns {string|null}
 */
function boardBehindReason(m, nowMs) {
  const gapSec = boardCoverageGapSec({ generatedAtSec: m?.generatedAt, dayEndSec: m?.boardDayEndSec ?? null, nowSec: nowMs / 1000 });
  if (gapSec === null || gapSec * 1000 <= BRIEF_MAX_BOARD_AGE_MS) return null;
  const min = Math.round(gapSec / 60);
  return Number(m?.boardDayOffset) === -1 ? `board missing the last ${min} min of yesterday` : `board ${min} min old`;
}
/** METAR observations older than this are not current weather. */
export const BRIEF_MAX_METAR_AGE_MS = 3 * 60 * 60 * 1000;
/** A soft hub: below this on-time percentage the tone is at least "watch". */
export const BRIEF_SOFT_HUB_OTP = 70;
/**
 * A healthy hub: at or above this on-time percentage its reading is not news. When every hub with a
 * reading is here, no "lowest hub" fact is built, and a reading moving, appearing or disappearing
 * does not count as a change (materialKey).
 */
export const BRIEF_HEALTHY_HUB_OTP = 80;
/**
 * On a day every hub is healthy, the lowest hub is still named when it is an outlier: at least this
 * many points below the next-lowest hub (Nov 12 2026: O'Hare at 80% beside 89% or better, the brief
 * the owner liked) ...
 */
export const BRIEF_OUTLIER_GAP_PTS = 8;
/** ... and below this on-time percentage (88% beside 90% is not a story). */
export const BRIEF_OUTLIER_UNDER_OTP = 85;

/**
 * The hub whose healthy on-time figure still trails the others enough to name, or null
 * (BRIEF_OUTLIER_GAP_PTS, BRIEF_OUTLIER_UNDER_OTP). Only for a day every hub is healthy.
 * @param {Record<string, {otp: number}>} readings
 * @returns {string|null}
 */
export function healthyOutlier(readings) {
  const hubs = Object.keys(readings || {});
  if (hubs.length < 2) return null;
  const sorted = [...hubs].sort((a, b) => readings[a].otp - readings[b].otp || a.localeCompare(b));
  const [low, next] = sorted;
  return readings[next].otp - readings[low].otp >= BRIEF_OUTLIER_GAP_PTS && readings[low].otp < BRIEF_OUTLIER_UNDER_OTP ? low : null;
}
/** "About the usual" band for the airborne comparison, in percent either side of the median. */
export const BRIEF_AIRBORNE_USUAL_BAND_PCT = 10;
/**
 * A shortfall of flights in the air against the usual for this time of day sets the tone: at this
 * many percent fewer the brief is at least "watch", ...
 *
 * Nov 13 2026: the FAA ordered a nationwide ground stop at about 12:54 PM PT. None of the FAA feeds
 * the brief reads carried it (they list programs by airport), so the brief stayed on a San Francisco
 * delay program at "watch" while this fact read 31% fewer at 1:10 PM, 47% at 1:30 PM and 72% at
 * 2:20 PM with a calm floor.
 *
 * Checked against every airborne_samples row before that afternoon (Oct 4 to Nov 13 2026, 10,651
 * five-minute samples with a 7-day median): the largest ordinary shortfall was 30% (Tue Oct 20,
 * 10:25 PM PT; Saturdays reach 22 to 25%), so the watch line sits at 35 and neither line was ever
 * crossed. Compared at the same UTC time instead, 63 samples read 30 to 42% fewer at 2 to 5 AM PT on
 * the four nights after the clocks changed on Nov 1, when "the same time yesterday" was an hour off
 * the schedule: sameClockDaysBefore removes those (that week's largest is then 22%). On the
 * afternoon of the stop the lines were crossed at 1:20 PM PT (43%) and 1:30 PM PT (48%).
 */
export const BRIEF_AIRBORNE_WATCH_PCT = 35;
/** ... and at this many percent fewer it is "disrupted" and leads the brief, above any one airport's program. */
export const BRIEF_AIRBORNE_DISRUPTED_PCT = 45;
/**
 * The shortfall sets no tone when the usual count is below this: overnight a few dozen flights
 * either way is a large percentage (the lowest hourly median stored is 152).
 */
export const BRIEF_AIRBORNE_MIN_USUAL = 100;

/**
 * The tone a count of flights in the air sets against the usual for this time of day. Only a
 * shortfall sets one: more flights than usual is never a problem in itself.
 * @param {number} airborne
 * @param {number} median  the usual at this clock time (airborneNormal)
 * @returns {'calm'|'watch'|'disrupted'}
 */
export function airborneShortfallTone(airborne, median) {
  if (!(Number.isFinite(airborne) && Number.isFinite(median)) || median < BRIEF_AIRBORNE_MIN_USUAL) return 'calm';
  const pct = Math.round(((airborne - median) / median) * 100);
  if (pct <= -BRIEF_AIRBORNE_DISRUPTED_PCT) return 'disrupted';
  if (pct <= -BRIEF_AIRBORNE_WATCH_PCT) return 'watch';
  return 'calm';
}
/** How far `tz`'s wall clock is ahead of UTC at `ms`, in milliseconds (negative in the Americas). */
function tzOffsetMs(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const part = (type) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')) - Math.floor(ms / 1000) * 1000;
}
/**
 * The instant `daysBack` days earlier that shows the same wall-clock time in the US: what "the usual
 * for this time of day" is compared with. Exactly 24 hours a day except across a clock change,
 * where the schedule moves an hour against UTC (the US zones change together, so one stands for all).
 * @param {number} nowMs
 * @param {number} daysBack
 * @param {string} [tz]
 * @returns {number}
 */
export function sameClockDaysBefore(nowMs, daysBack, tz = 'America/Chicago') {
  const naive = nowMs - daysBack * 86_400_000;
  return naive + tzOffsetMs(nowMs, tz) - tzOffsetMs(naive, tz);
}
/** A fact saying far fewer United flights are in the air than usual (air.normal above a calm floor). */
export function isAirborneShortfallFact(fact) {
  return fact?.id === 'air.normal' && (fact.toneFloor === 'watch' || fact.toneFloor === 'disrupted');
}
/**
 * Fewer confirmed cancellations than this across the hubs is not news (one among ~2,700
 * departures, Nov 11 2026): the `cxl.confirmed` fact is not built, and `collection.skipped` says so.
 */
export const BRIEF_MIN_CONFIRMED_CANCELLATIONS = 5;
/**
 * Confirmed cancellations below this are never part of the change key, sent or not. The send
 * threshold (5) sits inside this band, so the fact appearing or disappearing at 4↔5 cannot rewrite
 * the brief; the key moves only at 10 and then in countBucket's steps.
 */
const CONFIRMED_MATERIAL_FROM = 10;
/**
 * FAA programs in effect at airports that are not United hubs: at most this many are sent as their
 * own facts (the most severe: ground stops before delay programs, then the longest average delay);
 * the rest are folded into one `faa.active.other` fact (Nov 2026).
 */
export const BRIEF_MAX_NON_HUB_PROGRAMS = 3;

const HUB_ICAO = { KORD: 'ORD', KDEN: 'DEN', KIAH: 'IAH', KEWR: 'EWR', KSFO: 'SFO', KIAD: 'IAD', KLAX: 'LAX', RJAA: 'NRT', PGUM: 'GUM' };

const TONE_RANK = { calm: 0, watch: 1, disrupted: 2 };

/** The most alarming of the given tones. */
export function maxTone(...tones) {
  let best = 'calm';
  for (const t of tones) if (t && TONE_RANK[t] > TONE_RANK[best]) best = t;
  return best;
}

/**
 * The brief's tone, from the facts alone (prompt rule 6, made deterministic): the most alarming
 * `toneFloor` of any fact. The model proposes a tone; this decides it. For FAA programs it follows
 * the header's own levels (src/lib/ops-health.js networkStatus, which counts programs at United
 * hubs only): ground delay programs at any number of hubs are "watch" ("Some Delays"); a ground
 * stop or closure at a hub is "disrupted"; a program at an airport that is not a hub is "calm"
 * (Nov 2026: a Seattle delay program set a "Watch" brief beside a "Smooth Ops" header).
 * @param {Array<{toneFloor?: string}>} facts
 * @returns {'calm'|'watch'|'disrupted'}
 */
export function computeTone(facts) {
  return /** @type {'calm'|'watch'|'disrupted'} */ (maxTone(...(facts || []).map((f) => f.toneFloor)));
}

/** A ground stop or ground delay program in effect at a United hub (only hub facts carry `hub`). */
const STOP_OR_DELAY_PROGRAM_ID_RE = /^faa\.active\.[A-Z]{3}\.(gs|gdp)$/;
export function isHubProgramFact(fact) {
  return STOP_OR_DELAY_PROGRAM_ID_RE.test(String(fact?.id ?? '')) && typeof fact?.hub === 'string' && fact.hub !== '';
}
/** A ground stop or ground delay program in effect at any airport, hub or not. */
export function isStopOrDelayProgramFact(fact) {
  return STOP_OR_DELAY_PROGRAM_ID_RE.test(String(fact?.id ?? ''));
}
/** A ground stop or ground delay program in effect at an airport that is not a United hub. */
export function isNonHubProgramFact(fact) {
  return isStopOrDelayProgramFact(fact) && !isHubProgramFact(fact);
}
/** The airport an FAA program fact is about: its hub, else the code in its id. */
export function programAirport(fact) {
  return (typeof fact?.hub === 'string' && fact.hub) || String(fact?.id ?? '').split('.')[2] || '';
}

/**
 * Whether a brief may carry a traveler note: when an FAA ground stop or ground delay program is in
 * effect at any airport the facts name (travelers bound there are held; Nov 2026: airports that are
 * not hubs too, since United flies there), or the tone is "disrupted". The verifier, the template
 * and the dashboard (src/lib/brief-view.js mirrors it) apply the same rule.
 * @param {string} tone
 * @param {Array<{id: string, hub?: string}>} facts
 */
export function travelerNoteAllowed(tone, facts) {
  return tone === 'disrupted' || (facts || []).some(isStopOrDelayProgramFact);
}

/**
 * True when every hub with an on-time figure is at or above BRIEF_HEALTHY_HUB_OTP: the on-time
 * summary (`otp.floor`) is there and neither the lowest-hub fact nor the soft-hubs fact is. On such
 * a day per-hub on-time facts are sent only for hubs with an FAA program in effect, and the verifier
 * keeps a single hub's on-time percentage out of the brief (brief-verify.js).
 * @param {Array<{id: string}>} facts
 */
export function allHubsHealthy(facts) {
  const ids = new Set((facts || []).map((f) => f.id));
  return ids.has('otp.floor') && !ids.has('otp.min') && !ids.has('otp.soft');
}

// ── Clock formatting ──

const ZONE_LABELS = {
  'America/New_York': 'ET', 'America/Detroit': 'ET', 'America/Indiana/Indianapolis': 'ET',
  'America/Kentucky/Louisville': 'ET', 'America/Toronto': 'ET',
  'America/Chicago': 'CT', 'America/Winnipeg': 'CT',
  'America/Denver': 'MT', 'America/Boise': 'MT', 'America/Edmonton': 'MT', 'America/Phoenix': 'MST',
  'America/Los_Angeles': 'PT', 'America/Vancouver': 'PT',
  'America/Anchorage': 'AKT', 'Pacific/Honolulu': 'HT',
  'Pacific/Guam': 'ChST', 'Asia/Tokyo': 'JST',
};

/**
 * "9:00 PM ET" — an instant on an airport's own clock, with a zone label. Plain spaces only
 * (Intl puts U+202F before "PM"). Null when the instant or the zone is unknown.
 * @param {number} ms
 * @param {string} airport  IATA code
 * @returns {string|null}
 */
export function formatAirportClock(ms, airport) {
  if (!Number.isFinite(ms)) return null;
  const tz = airportTz(airport);
  if (!tz) return null;
  try {
    const clock = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true })
      .format(new Date(ms));
    const label = ZONE_LABELS[tz] || 'local time';
    return normalizeText(`${clock} ${label}`).replace(/\s+/g, ' ').trim();
  } catch {
    return null;
  }
}

/** Epoch ms of an ISO-ish timestamp, or null. A bare "2345" or "1/2" is not a timestamp. */
export function parseIsoMs(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  // Trim sub-millisecond fractions ("…07.792347607Z") that some parsers reject.
  const ms = Date.parse(value.replace(/(\.\d{3})\d+/, '$1'));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The instant a bare Zulu "HHMM" names: the occurrence nearest `nowMs` (so "UNTIL 0030" read at
 * 23:10Z is 00:30 tomorrow, and "AFTER 1800" read at 23:10Z is 18:00 today).
 * @param {string} hhmm
 * @param {number} nowMs
 * @returns {number|null}
 */
export function resolveZuluHhmm(hhmm, nowMs) {
  const m = String(hhmm || '').match(/^([01]\d|2[0-3])([0-5]\d)$/);
  if (!m || !Number.isFinite(nowMs)) return null;
  const day = new Date(nowMs);
  const base = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), Number(m[1]), Number(m[2]));
  let best = base;
  for (const candidate of [base - 86_400_000, base + 86_400_000]) {
    if (Math.abs(candidate - nowMs) < Math.abs(best - nowMs)) best = candidate;
  }
  return best;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * The UTC date an FAA operations plan is for, from its advisory link (`adv_date=MMDDYYYY`), as the
 * epoch ms of that date's midnight UTC. Null when the link has none, or names a date more than a
 * day from now (a fixture, a stale link): a wrong date must never move a window.
 * @param {unknown} advisoryUrl
 * @param {number} nowMs
 * @returns {number|null}
 */
export function planDateMs(advisoryUrl, nowMs) {
  const m = String(advisoryUrl || '').match(/[?&]adv_date=(\d{2})(\d{2})(\d{4})(?!\d)/);
  if (!m || !Number.isFinite(nowMs)) return null;
  const ms = Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  const now = new Date(nowMs);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Number.isFinite(ms) && Math.abs(ms - today) <= DAY_MS ? ms : null;
}

/**
 * The instant an operations-plan "HHMM" (Zulu) names. A plan looks forward from when it was
 * issued, so the nearest occurrence is wrong for the evening plan (Nov 12 2026: "AFTER 1500" read
 * at 01:20Z is 15:00Z that coming morning, 10 AM ET, not 15:00Z ten hours earlier). With the plan's
 * date: HHMM on that date, or the next day when that is more than 12 h past (the plan dated 11/10
 * and read at 23:10Z lists "UNTIL 0030" for 00:30Z on 11/11). Without it: the first occurrence no
 * more than 6 h ago.
 * @param {string} hhmm
 * @param {number} nowMs
 * @param {number|null} [planDate]  planDateMs()
 * @returns {number|null}
 */
export function resolvePlanHhmm(hhmm, nowMs, planDate = null) {
  const m = String(hhmm || '').match(/^([01]\d|2[0-3])([0-5]\d)$/);
  if (!m || !Number.isFinite(nowMs)) return null;
  const offset = Number(m[1]) * HOUR_MS + Number(m[2]) * 60_000;
  if (planDate !== null && Number.isFinite(planDate)) {
    const onDate = planDate + offset;
    return onDate < nowMs - 12 * HOUR_MS ? onDate + DAY_MS : onDate;
  }
  const now = new Date(nowMs);
  let t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offset - DAY_MS;
  while (t < nowMs - 6 * HOUR_MS) t += DAY_MS;
  return t;
}

/** "YYYY-MM-DD" and the hour of an instant on a zone's clock. */
function localParts(ms, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23', weekday: 'long',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), weekday: parts.weekday };
}

/**
 * The day an instant falls on, on the airport's own clock, as the words a sentence must carry with
 * its time (Nov 2026: "after 10:00 AM ET" said at 8:20 PM ET read as a time already past):
 *   ''          later today, or in the coming night ("until 12:30 AM ET" said at 9 PM)
 *   'tomorrow'  any other time tomorrow
 *   'on Friday' further out
 * Null when the airport has no clock or the instant is unknown. An instant already past gets ''.
 * @param {number} ms
 * @param {string} airport
 * @param {number} nowMs
 * @returns {string|null}
 */
export function airportDayWord(ms, airport, nowMs) {
  const tz = airportTz(airport);
  if (!tz || !Number.isFinite(ms) || !Number.isFinite(nowMs)) return null;
  try {
    const then = localParts(ms, tz);
    const now = localParts(nowMs, tz);
    const days = Math.round((Date.parse(`${then.date}T00:00:00Z`) - Date.parse(`${now.date}T00:00:00Z`)) / DAY_MS);
    if (days <= 0) return '';
    if (days === 1) return ms - nowMs <= 12 * HOUR_MS && then.hour < 6 ? '' : 'tomorrow';
    return `on ${then.weekday}`;
  } catch {
    return null;
  }
}

/** A clock time with the day it falls on, as one value: "tomorrow 10:00 AM ET" (or just the clock). */
function dayClock(day, clock) {
  return day ? `${day} ${clock}` : clock;
}

// ── Causes (FAA reasons and weather) ──

const FAA_CAUSES = [
  [/thunder|tstm|convect|storm/i, 'thunderstorms'],
  [/snow/i, 'snow'],
  [/ice|icing|freez/i, 'ice'],
  [/wind/i, 'wind'],
  [/ceiling|low cloud/i, 'low clouds'],
  [/visib|fog/i, 'low visibility'],
  [/rain/i, 'rain'],
  [/construct|runway work/i, 'runway construction'],
  [/volume|demand/i, 'heavy traffic'],
  [/staff/i, 'staffing'],
  [/equip|outage/i, 'an equipment outage'],
];

/**
 * The cause the FAA published, mapped through an allowlist to plain words ("WX:Low Ceilings" →
 * "low clouds"). Anything not on the list (NOTAM text, phone numbers) is dropped, never quoted.
 * @param {unknown} reason
 * @returns {string|null}
 */
export function faaCausePhrase(reason) {
  const text = String(reason || '');
  if (!text.trim()) return null;
  for (const [re, phrase] of FAA_CAUSES) if (re.test(text)) return phrase;
  return null;
}

function isWeatherReason(reason) {
  return /^\s*WX\b/i.test(String(reason || '')) || /weather/i.test(String(reason || ''));
}

// ── Small helpers ──

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const round = (n, step) => Math.round(n / step) * step;
/** Count bucket for the material key: exact under 10, then to the nearest 5, then 10. */
function countBucket(n) {
  if (!Number.isFinite(n)) return 'na';
  if (n < 10) return String(n);
  if (n < 50) return String(round(n, 5));
  return String(round(n, 10));
}
function joinNames(names) {
  if (names.length <= 1) return names.join('');
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
function plural(n, one, many) {
  return n === 1 ? one : many;
}
function uniq(list) {
  return [...new Set(list.filter((v) => v !== null && v !== undefined && v !== ''))].map(String);
}
function hubLabel(code) {
  return `${airportDisplayName(code)} (${code})`;
}
function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
/**
 * Which day a set of hub boards covers: 'today', 'yesterday' (before each hub's 6 AM rollover) or
 * 'mixed'. Statements say "today" or "yesterday" only when every board agrees.
 * @param {string[]} hubs
 * @param {number} nowMs
 */
function boardsDay(hubs, nowMs) {
  const yesterday = hubs.map((h) => defaultSchedDayOffset(h, new Date(nowMs)) !== 0);
  if (yesterday.length && yesterday.every(Boolean)) return 'yesterday';
  if (yesterday.some(Boolean)) return 'mixed';
  return 'today';
}
/**
 * "seven United hubs reporting so far today": the hubs with an on-time figure, in words a traveler
 * would use. "Reporting" stays true when Tokyo Narita and Guam have too few departures yet, or a
 * board is too far behind to count (Nov 2026: replaces "hubs with an on-time reading").
 */
function hubsReporting(n, day) {
  const when = day === 'today' ? ' so far today' : day === 'yesterday' ? ' yesterday' : '';
  return `${numberWord(n)} United ${plural(n, 'hub', 'hubs')} reporting${when}`;
}

/**
 * @typedef {Object} BriefFact
 * @property {string} id
 * @property {string} kind
 * @property {string} [hub]
 * @property {string} statement
 * @property {string[]} values
 * @property {string|null} at
 * @property {{tab: string, hub?: string, section?: string}} link
 * @property {number} severity
 * @property {'calm'|'watch'|'disrupted'} toneFloor
 * @property {string|null} material
 * @property {boolean} [later]  a possible program whose window opens on a later local day (plannedFact)
 * @property {boolean} [outlier]  a healthy hub's on-time fact sent because it trails the others
 */

/**
 * @typedef {Object} BriefSources
 * @property {any} [irops]    /api/irops body
 * @property {any} [faa]      /api/faa body (array)
 * @property {any} [nas]      /api/nas body
 * @property {any} [metar]    /api/metar body (array) for the nine hub stations
 * @property {{airborne: number, starlink?: number|null}|null} [air]  live-feed counts
 * @property {{median: number, days: number}|null} [airNormal]  airborne_samples comparison
 * @property {Array<BriefFact>|null} [extraFacts]  facts built elsewhere (radio), merged as-is
 * @property {Record<string, number|null>} [asOf]  epoch ms each source's reading is from
 */

/**
 * Build the brief's facts.
 * @param {BriefSources} sources
 * @param {{nowMs: number}} options
 * @returns {{facts: BriefFact[], collection: {sources: Record<string, string>, skipped: string[], hubReadings: number}}}
 */
export function buildBriefFacts(sources, { nowMs }) {
  /** @type {BriefFact[]} */
  const facts = [];
  const skipped = [];
  const asOf = sources?.asOf || {};
  const status = {
    irops: sources?.irops && typeof sources.irops === 'object' && sources.irops.hubMetrics ? 'ok' : 'missing',
    faa: Array.isArray(sources?.faa) ? 'ok' : 'missing',
    nas: sources?.nas && typeof sources.nas === 'object' ? 'ok' : 'missing',
    metar: Array.isArray(sources?.metar) && sources.metar.length > 0 ? 'ok' : 'missing',
    air: sources?.air && Number.isFinite(sources.air.airborne) ? 'ok' : 'missing',
    airNormal: sources?.airNormal && Number.isFinite(sources.airNormal.median) ? 'ok' : 'missing',
  };

  // The FAA index networkStatus() reads, minus routine closures (nightly curfews, PPR/GA and
  // runway-only NOTAMs) that would otherwise paint a working hub "Disrupted" (isWholeAirportClosure).
  const faaIndex = status.faa === 'ok' ? buildFaaIndex(sources.faa.map(withoutRoutineClosures)) : {};

  // ── FAA programs in effect (/api/faa) ── first, so the on-time facts know which hubs have one.
  /** @type {Set<string>} airports with an active ground stop / ground delay program / closure */
  const activeAt = new Set();
  /** @type {Set<string>} hubs with any FAA program in effect (stop, delay program, closure, delays) */
  const hubsWithProgram = new Set();
  if (status.faa === 'ok') {
    const hubPrograms = [];
    /** @type {Array<{code: string, type: string, avg: number, fact: BriefFact}>} */
    const otherPrograms = [];
    for (const airport of sources.faa) {
      const code = String(airport?.airportCode || '').toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) continue;
      const isHub = BRIEF_HUBS.includes(code);
      // Other airports only when we know them (a clock zone and a name): the FAA feed lists every
      // field in the country, and a ground stop at a general-aviation airport is not United news.
      if (!isHub && !isKnownAirportCode(code)) continue;
      const programs = Array.isArray(airport.programs) ? airport.programs : [];
      for (const p of programs) {
        const type = String(p?.type || '');
        const keep = type === 'ground_stop' || type === 'ground_delay' || (isHub && (type === 'closure' || type === 'departure_delay' || type === 'arrival_delay'));
        if (!keep) continue;
        if (type === 'closure' && !isWholeAirportClosure(p.reason)) {
          skipped.push(`faa.active.${code}.closure: a scheduled or partial closure, not an outage`);
          continue;
        }
        const endMs = parseIsoMs(p.endTime);
        if (!isHub && endMs !== null && endMs <= nowMs) {
          // Away from the hubs a program past its listed end is not news (the feed lags). At a hub
          // it stays, without the time, as long as the header still counts it.
          skipped.push(`faa.active.${code}.${type === 'ground_stop' ? 'gs' : 'gdp'}: its listed end, ${formatAirportClock(endMs, code)}, has passed`);
          continue;
        }
        const fact = faaActiveFact(code, p, { isHub, nowMs, asOfMs: asOf.faa ?? nowMs });
        if (isHub) {
          facts.push(fact);
          hubsWithProgram.add(code);
          if (type === 'ground_stop' || type === 'ground_delay' || type === 'closure') hubPrograms.push({ code, type });
        } else {
          otherPrograms.push({ code, type, avg: Number(p.avgDelay) > 0 ? Number(p.avgDelay) : 0, fact });
        }
        if (type === 'ground_stop' || type === 'ground_delay' || type === 'closure') activeAt.add(code);
      }
    }

    // Stops and delay programs hold flights INTO the airport (faaActiveFact); a closure is at it.
    const describe = (list) => joinNames(list.map(({ code, type }) =>
      `${type === 'ground_stop' ? 'a ground stop for flights into' : type === 'ground_delay' ? 'a ground delay program for flights into' : 'a closure at'} ${airportDisplayName(code)}`));
    const n = hubPrograms.length;
    // A ground stop or closure at a hub disrupts the network; delay programs, at however many hubs,
    // are a watch, as the header's network status treats them (computeTone).
    const countTone = n === 0 ? 'calm' : hubPrograms.some((p) => p.type !== 'ground_delay') ? 'disrupted' : 'watch';
    facts.push({
      id: 'faa.active.count',
      kind: 'faa',
      statement: n === 0
        ? 'No FAA ground stop or ground delay program is in effect at any United hub.'
        : `${n} FAA ${plural(n, 'program affects a United hub', 'programs affect United hubs')}: ${describe(hubPrograms)}.`,
      values: uniq([String(n), numberWord(n), ...hubPrograms.flatMap((p) => airportForms(p.code))]),
      at: iso(asOf.faa ?? nowMs),
      link: { tab: 'weather' },
      severity: n === 0 ? 1 : 70,
      toneFloor: countTone,
      material: `hubprog:${hubPrograms.map((p) => `${p.code}.${p.type}`).sort().join(',')}`,
    });

    // Programs away from the hubs: the most severe BRIEF_MAX_NON_HUB_PROGRAMS one by one (ground
    // stops first, then the longest average delay on the same 15-minute steps `material` uses, so a
    // few minutes of drift cannot swap which ones are sent), the rest in one count.
    const typeRank = (t) => (t === 'ground_stop' ? 0 : 1);
    otherPrograms.sort((a, b) => typeRank(a.type) - typeRank(b.type) || round(b.avg, 15) - round(a.avg, 15) || a.code.localeCompare(b.code));
    const sent = otherPrograms.slice(0, BRIEF_MAX_NON_HUB_PROGRAMS);
    const folded = otherPrograms.slice(BRIEF_MAX_NON_HUB_PROGRAMS);
    for (const o of sent) facts.push(o.fact);
    for (const o of folded) skipped.push(`${o.fact.id}: folded into faa.active.other (only the ${BRIEF_MAX_NON_HUB_PROGRAMS} most severe programs away from the hubs are sent one by one)`);
    if (folded.length > 0) {
      const m = folded.length;
      facts.push({
        id: 'faa.active.other',
        kind: 'faa',
        statement: `The FAA also has ${m} more ${plural(m, 'program', 'programs')} in effect at other airports: ${describe(folded)}.`,
        values: uniq([String(m), numberWord(m), ...folded.flatMap((p) => airportForms(p.code))]),
        at: iso(asOf.faa ?? nowMs),
        link: { tab: 'weather' },
        // Below the programs sent one by one, and calm: away from the hubs (computeTone).
        severity: 8.2,
        toneFloor: 'calm',
        material: `otherprog:${folded.map((p) => `${p.code}.${p.type}`).sort().join(',')}`,
      });
    }
  }

  // ── On-time per hub (src/lib/hub-health.js serverOtpFromMetrics, the hub strip's number) ──
  /** @type {Record<string, {otp: number, operated: number, at: number|null}>} */
  const readings = {};
  if (status.irops === 'ok') {
    const metrics = sources.irops.hubMetrics || {};
    for (const hub of BRIEF_HUBS) {
      const m = metrics[hub];
      if (!m) continue;
      const otp = serverOtpFromMetrics(m);
      const operated = Number(m.operated || 0);
      const atMs = Number.isFinite(Number(m.generatedAt)) && Number(m.generatedAt) > 0 ? Number(m.generatedAt) * 1000 : null;
      if (otp === null) { skipped.push(`otp.${hub}: no reading`); continue; }
      const behind = boardBehindReason(m, nowMs);
      if (behind) { skipped.push(`otp.${hub}: ${behind}`); continue; }
      if (operated < BRIEF_MIN_OPERATED) { skipped.push(`otp.${hub}: ${operated} operated (under ${BRIEF_MIN_OPERATED})`); continue; }
      readings[hub] = { otp, operated, at: atMs };
    }

    // When every hub with a figure is healthy, a hub's own figure is padding: only a hub with an FAA
    // program in effect keeps its on-time fact (the summary, otp.floor, covers the rest; Nov 2026).
    const readingHubs = Object.keys(readings);
    const everyHubHealthy = readingHubs.length >= 2 && readingHubs.every((h) => readings[h].otp >= BRIEF_HEALTHY_HUB_OTP);
    const outlier = everyHubHealthy ? healthyOutlier(readings) : null;
    const byOtp = [...readingHubs].sort((a, b) => readings[a].otp - readings[b].otp || a.localeCompare(b));
    const othersFloor = outlier ? readings[byOtp[1]].otp : null;
    const readingsDay = boardsDay(readingHubs, nowMs);
    for (const [hub, r] of Object.entries(readings)) {
      if (hub === outlier && othersFloor !== null) {
        // Healthy, but trailing the others (Nov 12 2026: O'Hare at 80% beside 89% or better).
        const past = readingsDay === 'yesterday';
        facts.push({
          id: `otp.${hub}`,
          kind: 'otp',
          hub,
          statement: `${hubLabel(hub)} ${past ? 'was' : 'is'} at ${r.otp}% on time ${past ? 'yesterday' : 'so far today'} (${r.operated} departed), behind the other hubs, which ${past ? 'were' : 'are'} at ${othersFloor}% or better.`,
          values: uniq([`${r.otp}%`, String(r.operated), `${othersFloor}%`, `${ON_TIME_GRACE_MIN} minutes`, ...airportForms(hub)]),
          at: iso(r.at),
          link: { tab: 'schedule', hub },
          // Above calm filler and programs away from the hubs, below a hub problem that sets a tone.
          severity: 15,
          toneFloor: 'calm',
          // Healthy: never the tone, and never a change on its own (it comes and goes with the gap).
          material: null,
          outlier: true,
        });
        continue;
      }
      if (everyHubHealthy && !hubsWithProgram.has(hub)) {
        skipped.push(`otp.${hub}: ${r.otp}% and every hub is healthy (the on-time summary covers it)`);
        continue;
      }
      const yesterday = defaultSchedDayOffset(hub, new Date(nowMs)) !== 0;
      const when = yesterday ? 'yesterday' : 'so far today';
      const tail = yesterday ? "; today's figures are not in yet" : '';
      const severity = r.otp < 50 ? 70 : r.otp < BRIEF_SOFT_HUB_OTP ? 45 : r.otp < BRIEF_HEALTHY_HUB_OTP ? 20 : 5;
      facts.push({
        id: `otp.${hub}`,
        kind: 'otp',
        hub,
        statement: `${hubLabel(hub)}: ${r.otp}% of departures ${when} left within ${ON_TIME_GRACE_MIN} minutes of schedule (${r.operated} departed)${tail}.`,
        values: uniq([`${r.otp}%`, String(r.operated), `${ON_TIME_GRACE_MIN} minutes`, ...airportForms(hub)]),
        at: iso(r.at),
        link: { tab: 'schedule', hub },
        severity,
        toneFloor: r.otp < 50 ? 'disrupted' : r.otp < BRIEF_SOFT_HUB_OTP ? 'watch' : 'calm',
        // A healthy hub is not news: its reading moving, appearing or aging out is not a change.
        material: r.otp >= BRIEF_HEALTHY_HUB_OTP ? null : `otp:${round(r.otp, 5)}`,
      });
    }

    const hubs = Object.keys(readings);
    if (hubs.length >= 2) {
      const sorted = [...hubs].sort((a, b) => readings[a].otp - readings[b].otp || a.localeCompare(b));
      const low = sorted[0];
      const n = hubs.length;
      // When every hub reads healthy, which one is lowest is not news: no "lowest" fact, and the
      // floor does not name it (so a sentence cannot either). The best hub is never news.
      const allHealthy = readings[low].otp >= BRIEF_HEALTHY_HUB_OTP;
      const day = boardsDay(hubs, nowMs);
      const reporting = hubsReporting(n, day);
      const are = day === 'yesterday' ? 'were' : 'are';
      if (!allHealthy) {
        facts.push({
          id: 'otp.min',
          kind: 'otp',
          hub: low,
          statement: `Of the ${reporting}, ${hubLabel(low)} ${day === 'yesterday' ? 'was' : 'is'} lowest at ${readings[low].otp}% on time.`,
          values: uniq([`${readings[low].otp}%`, String(n), numberWord(n), ...airportForms(low)]),
          at: iso(readings[low].at),
          link: { tab: 'schedule', hub: low },
          severity: readings[low].otp < BRIEF_SOFT_HUB_OTP ? 40 : 6,
          toneFloor: 'calm',
          material: `min:${low}:${round(readings[low].otp, 5)}`,
        });
      }

      const soft = sorted.filter((h) => readings[h].otp < BRIEF_SOFT_HUB_OTP);
      if (soft.length === 0 && outlier) {
        // The trailing hub has its own fact; the summary covers the others.
        const others = sorted.slice(1);
        const floorPct = readings[others[0]].otp;
        facts.push({
          id: 'otp.floor',
          kind: 'otp',
          statement: `The other ${hubsReporting(others.length, day)} ${are} at ${floorPct}% on time or better.`,
          values: uniq([String(others.length), numberWord(others.length), `${floorPct}%`]),
          at: iso(Math.min(...others.map((h) => readings[h].at ?? nowMs))),
          link: { tab: 'schedule', hub: others[0] },
          severity: 8,
          toneFloor: 'calm',
          material: null,
        });
      } else if (soft.length === 0) {
        const floorPct = readings[low].otp;
        facts.push({
          id: 'otp.floor',
          kind: 'otp',
          statement: allHealthy
            ? `All ${reporting} ${are} at ${floorPct}% on time or better.`
            : `All ${reporting} ${are} at ${floorPct}% on time or better; ${airportDisplayName(low)} ${day === 'yesterday' ? 'was' : 'is'} the lowest.`,
          values: uniq([String(n), numberWord(n), `${floorPct}%`, ...(allHealthy ? [] : airportForms(low))]),
          at: iso(Math.min(...hubs.map((h) => readings[h].at ?? nowMs))),
          // The chip proves the floor with the lowest hub's board (the IROPS bar shows no on-time).
          link: { tab: 'schedule', hub: low },
          severity: 8,
          toneFloor: 'calm',
          // How many hubs have a reading is not material; nor is the floor while every hub is healthy.
          material: allHealthy ? null : `floor:${round(floorPct, 5)}`,
        });
      } else {
        const names = soft.map((h) => `${airportDisplayName(h)} (${readings[h].otp}%)`);
        facts.push({
          id: 'otp.soft',
          kind: 'otp',
          statement: `${capitalize(numberWord(soft.length))} of the ${reporting} ${day === 'yesterday' ? plural(soft.length, 'was', 'were') : plural(soft.length, 'is', 'are')} under ${BRIEF_SOFT_HUB_OTP}% on time: ${joinNames(names)}.`,
          values: uniq([String(soft.length), numberWord(soft.length), String(n), numberWord(n), `${BRIEF_SOFT_HUB_OTP}%`,
            ...soft.map((h) => `${readings[h].otp}%`), ...soft.flatMap((h) => airportForms(h))]),
          at: iso(Math.min(...soft.map((h) => readings[h].at ?? nowMs))),
          link: { tab: 'weather', section: 'irops' },
          severity: 42,
          toneFloor: 'watch',
          material: `soft:${soft.join(',')}`,
        });
      }
    }

    // ── The disruption index and the network status (the strip's own chip) ──
    const score = Number(sources.irops.score);
    // The index counts every hub board; when the ones too far behind hold too many of its
    // departures, its own fact is left out (BRIEF_INDEX_MAX_STALE_SHARE).
    let indexFlights = 0;
    let behindFlights = 0;
    const behindHubs = [];
    for (const [hub, m] of Object.entries(sources.irops.hubMetrics || {})) {
      const total = Number(m?.total) > 0 ? Number(m.total) : 0;
      indexFlights += total;
      if (total > 0 && boardBehindReason(m, nowMs)) { behindFlights += total; behindHubs.push(hub); }
    }
    const indexStaleShare = indexFlights > 0 ? behindFlights / indexFlights : 0;
    if (Number.isFinite(score) && indexStaleShare > BRIEF_INDEX_MAX_STALE_SHARE) {
      skipped.push(`net.index: boards more than 3 h behind hold ${Math.round(indexStaleShare * 100)}% of its departures (${behindHubs.join(', ')})`);
    } else if (Number.isFinite(score)) {
      const band = score < IROPS_MINOR_AT ? 'normal' : score < IROPS_SIGNIFICANT_AT ? 'minor' : 'significant';
      const bandText = band === 'normal'
        ? `in the normal range (under ${IROPS_MINOR_AT})`
        : band === 'minor'
          ? `in the minor-disruption range (${IROPS_MINOR_AT} to ${IROPS_SIGNIFICANT_AT})`
          : `in the significant-disruption range (${IROPS_SIGNIFICANT_AT} or more)`;
      facts.push({
        id: 'net.index',
        kind: 'network',
        // "Network disruption index" is the measure's name on the page (the IROPS section).
        statement: `The network disruption index, which weighs cancellations, long delays and diversions across United's hub departures, is ${score}, ${bandText}.`,
        values: uniq([String(score), String(IROPS_MINOR_AT), String(IROPS_SIGNIFICANT_AT)]),
        at: iso(asOf.irops ?? nowMs),
        link: { tab: 'weather', section: 'irops' },
        severity: band === 'significant' ? 60 : band === 'minor' ? 30 : 4,
        toneFloor: band === 'significant' ? 'disrupted' : band === 'minor' ? 'watch' : 'calm',
        material: `index:${band}`,
      });
    }

    const hubOtps = Object.fromEntries(Object.entries(readings).map(([h, r]) => [h, r.otp]));
    const net = networkStatus({
      hubOtps,
      faaIndex: status.faa === 'ok' ? faaIndex : {},
      hubCodes: BRIEF_HUBS,
      iropsScore: Number.isFinite(score) ? score : null,
    });
    facts.push({
      id: 'net.status',
      kind: 'network',
      statement: `The network status, which combines on-time performance at United's hubs, FAA programs there and the network disruption index, is "${net.label}".`,
      values: [],
      at: iso(asOf.irops ?? nowMs),
      link: { tab: 'weather', section: 'irops' },
      severity: net.level === 'significant' ? 55 : net.level === 'minor' ? 25 : 2,
      toneFloor: net.level === 'significant' ? 'disrupted' : net.level === 'minor' ? 'watch' : 'calm',
      material: `status:${net.level}`,
    });

    // ── Cancellations: confirmed and unconfirmed are separate facts (docs/specs/irops-delay-measurement.md) ──
    const total = Number(sources.irops.cancellations || 0);
    const likely = Number(sources.irops.cancellationsLikely || 0);
    const seenFlying = Number(sources.irops.likelyCanceledSeenFlying || 0);
    const confirmed = Math.max(0, total - likely);
    // "today" or "yesterday" when the boards holding nearly all the departures agree: Tokyo Narita
    // and Guam (under 1%) sit on yesterday's board for six hours of the US day.
    const boardHubs = BRIEF_HUBS.filter((h) => Number(sources.irops.hubMetrics?.[h]?.total) > 0);
    const departures = (hs) => hs.reduce((s, h) => s + Number(sources.irops.hubMetrics[h].total), 0);
    const yesterdayHubs = boardHubs.filter((h) => defaultSchedDayOffset(h, new Date(nowMs)) !== 0);
    const yesterdayShare = boardHubs.length ? departures(yesterdayHubs) / departures(boardHubs) : 0;
    const cxlDay = yesterdayShare <= 0.05 ? 'today' : yesterdayShare >= 0.95 ? 'yesterday' : 'mixed';
    if (confirmed < BRIEF_MIN_CONFIRMED_CANCELLATIONS) {
      // One cancellation among ~2,700 departures is not news (Nov 11 2026); the report still shows it.
      skipped.push(`cxl.confirmed: ${confirmed} confirmed (under ${BRIEF_MIN_CONFIRMED_CANCELLATIONS}), not news`);
    } else {
      const are = cxlDay === 'yesterday' ? plural(confirmed, 'was', 'were') : plural(confirmed, 'is', 'are');
      const when = cxlDay === 'today' ? ' today' : cxlDay === 'yesterday' ? ' yesterday' : '';
      facts.push({
        id: 'cxl.confirmed',
        kind: 'cancellations',
        statement: `${confirmed} United ${plural(confirmed, 'departure', 'departures')} from its hubs ${are} confirmed canceled${when}.`,
        values: uniq([String(confirmed), numberWord(confirmed)]),
        at: iso(asOf.irops ?? nowMs),
        link: { tab: 'schedule' },
        severity: confirmed >= 50 ? 50 : confirmed >= 20 ? 30 : confirmed >= 5 ? 12 : 2,
        toneFloor: 'calm',
        // Never material under CONFIRMED_MATERIAL_FROM: the send threshold sits inside that band.
        material: confirmed < CONFIRMED_MATERIAL_FROM ? null : `cxl:${countBucket(confirmed)}`,
      });
    }
    if (likely > 0) {
      facts.push({
        id: 'cxl.unconfirmed',
        kind: 'cancellations',
        // Stands on its own: the confirmed count beside it is often not sent (under 5).
        statement:
          `${likely} ${plural(likely, 'departure', 'departures')} from United's hubs ${plural(likely, 'is', 'are')} marked "likely canceled" by a flight-data provider but not confirmed. ` +
          `That label is often wrong` + (seenFlying > 0 ? `: ${seenFlying} flights marked that way today were seen flying.` : '.'),
        values: uniq([String(likely), numberWord(likely), seenFlying > 0 ? String(seenFlying) : null]),
        at: iso(asOf.irops ?? nowMs),
        link: { tab: 'schedule' },
        // A caveat, not news (prompt rule 4): below every program, planned hub program and the
        // confirmed count, so neither the model's list nor the template leads with it.
        severity: 1,
        toneFloor: 'calm',
        material: `likely:${round(likely, 25)}`,
      });
    }
    for (const hub of BRIEF_HUBS) {
      const m = sources.irops.hubMetrics?.[hub];
      if (!m) continue;
      const hubConfirmed = Math.max(0, Number(m.cancellations || 0) - Number(m.cancellationsLikely || 0));
      const hubTotal = Number(m.total || 0);
      if (hubConfirmed < 3 || hubTotal <= 0) continue;
      const behind = boardBehindReason(m, nowMs);
      if (behind) { skipped.push(`cxl.${hub}: ${behind}`); continue; }
      const rate = hubConfirmed / hubTotal;
      const hubYesterday = defaultSchedDayOffset(hub, new Date(nowMs)) !== 0;
      facts.push({
        id: `cxl.${hub}`,
        kind: 'cancellations',
        hub,
        statement: hubYesterday
          ? `${hubLabel(hub)} had ${hubConfirmed} confirmed ${plural(hubConfirmed, 'cancellation', 'cancellations')} among its ${hubTotal} departures yesterday.`
          : `${hubLabel(hub)} has ${hubConfirmed} confirmed ${plural(hubConfirmed, 'cancellation', 'cancellations')} among its ${hubTotal} departures today.`,
        values: uniq([String(hubConfirmed), numberWord(hubConfirmed), String(hubTotal), ...airportForms(hub)]),
        at: iso(Number(m.generatedAt) > 0 ? Number(m.generatedAt) * 1000 : asOf.irops ?? nowMs),
        link: { tab: 'schedule', hub },
        severity: rate >= 0.1 ? 55 : rate >= 0.05 ? 30 : 10,
        toneFloor: rate >= 0.1 ? 'watch' : 'calm',
        material: `cxl:${countBucket(hubConfirmed)}`,
      });
    }
  }

  // ── FAA planned / possible programs (/api/nas operations plan) ──
  if (status.nas === 'ok') {
    const planned = Array.isArray(sources.nas.planned) ? sources.nas.planned : [];
    // The plan's own date anchors its Zulu times (resolvePlanHhmm).
    const planDate = planDateMs(sources.nas.advisoryUrl, nowMs);
    const usedIds = new Set();
    let plannedCount = 0;
    let plannedAtHub = 0;
    for (const tmi of planned) {
      const fact = plannedFact(tmi, { nowMs, activeAt, asOfMs: asOf.nas ?? nowMs, skipped, planDate });
      if (!fact) continue;
      let id = fact.id;
      for (let i = 2; usedIds.has(id); i++) id = `${fact.id}.${i}`;
      usedIds.add(id);
      facts.push({ ...fact, id });
      plannedCount++;
      if (fact.hub && !fact.later) plannedAtHub++;
    }
    if (plannedCount > 0) {
      facts.push({
        id: 'faa.planned.count',
        kind: 'faa_planned',
        statement: `The FAA's operations plan lists ${plannedCount} possible or planned ${plural(plannedCount, 'program', 'programs')} for later. None of them is in effect now.`,
        values: uniq([String(plannedCount), numberWord(plannedCount)]),
        at: iso(asOf.nas ?? nowMs),
        link: { tab: 'weather' },
        // Only possible programs away from the hubs or not before tomorrow: last, with them.
        severity: plannedAtHub ? 3 : 0,
        toneFloor: 'calm',
        // Only planned programs at hubs count as a change (plannedFact).
        material: plannedAtHub > 0 ? `planned:${plannedAtHub}` : null,
      });
    }
  }

  // ── Hub weather (/api/metar, src/lib/metar-category.js) ──
  if (status.metar === 'ok') {
    const affected = [];
    /** Hubs whose weather is at warning level or worse: the only ones the change key lists. */
    const significant = [];
    let reporting = 0;
    for (const rec of sources.metar) {
      const icao = String(rec?.icaoId || rec?.stationId || rec?.id || '').toUpperCase();
      const hub = HUB_ICAO[icao];
      if (!hub) continue;
      const raw = String(rec?.rawOb || '');
      if (!raw) continue;
      const obsMs = Number(rec?.obsTime) > 0 ? Number(rec.obsTime) * 1000 : null;
      if (obsMs !== null && nowMs - obsMs > BRIEF_MAX_METAR_AGE_MS) { skipped.push(`wx.${hub}: observation ${Math.round((nowMs - obsMs) / 60000)} min old`); continue; }
      reporting++;
      const fact = weatherFact(hub, raw, obsMs ?? nowMs, skipped);
      if (fact) {
        facts.push(fact);
        affected.push(hub);
        if (fact.toneFloor === 'watch') significant.push(hub); // warning or severe (weatherFact)
      }
    }
    if (reporting > 0) {
      const a = affected.length;
      facts.push({
        id: 'wx.summary',
        kind: 'weather',
        statement: a === 0
          ? `Weather is not affecting operations at any of the ${reporting} United hubs with a current report.`
          : `Weather is affecting operations at ${a} of the ${reporting} United hubs with a current report: ${joinNames(affected.map(airportDisplayName))}.`,
        values: uniq(['weather', String(reporting), numberWord(reporting), String(a), numberWord(a), ...affected.flatMap((h) => airportForms(h))]),
        at: iso(asOf.metar ?? nowMs),
        link: { tab: 'weather' },
        severity: a === 0 ? 1 : 8,
        toneFloor: 'calm',
        // Caution-level weather (light rain, mist) coming and going is not a change.
        material: `wx:${significant.join(',')}`,
      });
    }
  }

  // ── In the air (live feed) and the usual for this time of day (airborne_samples) ──
  if (status.air === 'ok') {
    const airborne = Math.round(sources.air.airborne);
    const atMs = asOf.air ?? nowMs;
    facts.push({
      id: 'air.total',
      kind: 'airborne',
      statement: `${airborne} United flights, including United Express, are in the air right now.`,
      values: [String(airborne)],
      at: iso(atMs),
      link: { tab: 'live' },
      severity: 4,
      toneFloor: 'calm',
      // The count moves all day; how it compares with the usual (air.normal) is what can be news.
      material: null,
    });
    const starlink = Number(sources.air.starlink);
    if (Number.isFinite(starlink) && starlink > 0) {
      facts.push({
        id: 'air.starlink',
        kind: 'airborne',
        statement: `${Math.round(starlink)} of the ${airborne} United flights in the air have Starlink Wi-Fi.`,
        values: [String(Math.round(starlink)), String(airborne)],
        at: iso(atMs),
        link: { tab: 'starlink' },
        severity: 3,
        toneFloor: 'calm',
        material: null,
      });
    }
    if (status.airNormal === 'ok' && sources.airNormal.median > 0) {
      const median = Math.round(sources.airNormal.median);
      const days = Number(sources.airNormal.days) || 0;
      const pct = Math.round(((airborne - median) / median) * 100);
      const usual = Math.abs(pct) <= BRIEF_AIRBORNE_USUAL_BAND_PCT;
      const comparison = usual ? 'about the usual number' : `${Math.abs(pct)}% ${pct < 0 ? 'fewer' : 'more'} than usual`;
      // A large shortfall is the one sign of a network-wide halt that needs no FAA feed to carry it
      // (BRIEF_AIRBORNE_WATCH_PCT). It says what is seen, never why: no fact here gives a cause.
      const shortfall = airborneShortfallTone(airborne, median);
      facts.push({
        id: 'air.normal',
        kind: 'airborne',
        statement: `The ${airborne} United flights in the air are ${comparison} for this time of day: over the past ${days} days, the median at this hour was ${median}.`,
        values: uniq([String(median), String(days), numberWord(days), usual ? null : `${Math.abs(pct)}%`, String(airborne)]),
        at: iso(atMs),
        link: { tab: 'live' },
        // Disrupted: above a hub ground stop (100), because it is the whole network. Watch: above
        // FAA departure delays (40) and the index (30), below a hub's stop or delay program.
        severity: shortfall === 'disrupted' ? 110 : shortfall === 'watch' ? 50 : !usual && Math.abs(pct) >= 25 ? 20 : 2,
        toneFloor: shortfall,
        // While the shortfall sets the tone the brief quotes its figure first, so the key moves every
        // ten points and a brief saying "73% fewer" is rewritten before the count is far from it.
        material: `airnorm:${usual ? 'usual' : pct < 0 ? 'below' : 'above'}${shortfall === 'calm' ? '' : `:${shortfall}:${Math.floor(Math.abs(pct) / 10) * 10}`}`,
      });
    }
  }

  for (const fact of sources?.extraFacts || []) facts.push(fact);

  return { facts: orderFacts(facts), collection: { sources: status, skipped, hubReadings: Object.keys(readings).length } };
}

/**
 * The order the model reads the facts in (and the template's own tie-breaks): most severe first,
 * which puts everything about United's hubs above a program at another airport (severity 8.2 to 9,
 * faaActiveFact) and that above calm filler. On a calm day the on-time summary leads: with nothing
 * wrong at the hubs, the brief opens by saying so (Nov 2026).
 * @param {BriefFact[]} facts
 * @returns {BriefFact[]}
 */
export function orderFacts(facts) {
  const sorted = [...(facts || [])].sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));
  const take = (pred) => { const i = sorted.findIndex(pred); return i >= 0 ? sorted.splice(i, 1)[0] : null; };
  const summary = take((f) => f.id === 'otp.floor');
  const outlier = take((f) => f.outlier === true);
  // The on-time story reads as one: the hub that trails, then "the other hubs".
  const story = [outlier, summary].filter(Boolean);
  if (computeTone(facts) === 'calm') return [...story, ...sorted];
  // Otherwise where the trailing hub (or, without one, the summary) ranks.
  const anchor = story[0];
  if (!anchor) return sorted;
  const at = sorted.findIndex((f) => f.severity < anchor.severity || (f.severity === anchor.severity && f.id.localeCompare(anchor.id) > 0));
  sorted.splice(at < 0 ? sorted.length : at, 0, ...story);
  return sorted;
}

/** One fact for one FAA program in effect. */
function faaActiveFact(code, p, { isHub, nowMs, asOfMs }) {
  const type = String(p.type);
  const name = hubLabel(code);
  const endMs = parseIsoMs(p.endTime);
  // A listed end time already past is never printed (the program is still listed, so at a hub it
  // stays, as the header still counts it; away from the hubs the caller drops it).
  const endClock = endMs !== null && endMs > nowMs ? formatAirportClock(endMs, code) : null;
  // The day, when the end is not later today or tonight ("until 2:00 PM ET tomorrow").
  const endDay = endClock ? airportDayWord(/** @type {number} */ (endMs), code, nowMs) ?? '' : '';
  const cause = faaCausePhrase(p.reason);
  const weather = isWeatherReason(p.reason);
  const avg = Number.isFinite(Number(p.avgDelay)) && Number(p.avgDelay) > 0 ? Math.round(Number(p.avgDelay)) : null;
  const max = Number.isFinite(Number(p.maxDelay)) && Number(p.maxDelay) > 0 ? Math.round(Number(p.maxDelay)) : null;
  const min = Number.isFinite(Number(p.minDelay)) && Number(p.minDelay) > 0 ? Math.round(Number(p.minDelay)) : null;
  const because = cause ? `, because of ${cause}` : '';
  const until = endClock ? ` until ${endClock}${endDay ? ` ${endDay}` : ''}` : '';
  const values = [...airportForms(code), endClock ? dayClock(endDay, endClock) : null, cause, weather ? 'weather' : null];
  let statement;
  let suffix;
  let severity;
  let toneFloor;

  // A ground stop or ground delay program holds flights BOUND FOR the named airport, at the airports
  // they depart from; that airport's own departures are not what it holds. The statements say so,
  // because "a ground delay program at San Francisco" reads as "San Francisco departures are held".
  const held = 'Those flights are held at their departure airport';
  if (type === 'ground_stop') {
    suffix = 'gs';
    statement = `The FAA has a ground stop in effect for flights heading to ${name}${until}${because}. ${held}`;
    if (avg) { statement += `; the FAA expects average delays of ${avg} minutes`; values.push(`${avg} minutes`); }
    statement += '.';
    const ext = String(p.probabilityOfExtension || '').trim().toLowerCase();
    if (/^(low|medium|high)$/.test(ext)) statement += ` It rates the chance of an extension as ${ext}.`;
    // Away from the hubs: below every fact about a hub that is worth a line (a hub's cancellations
    // are 10), above calm filler, and never the tone (the header counts hub programs only).
    severity = isHub ? 100 : 9;
    toneFloor = isHub ? 'disrupted' : 'calm';
  } else if (type === 'ground_delay') {
    suffix = 'gdp';
    statement = `The FAA has a ground delay program in effect for flights heading to ${name}${until}${because}. ${held}`;
    if (avg) { statement += `; delays average ${avg} minutes`; values.push(`${avg} minutes`); }
    if (avg && max) { statement += `, up to ${max} minutes.`; values.push(`${max} minutes`); }
    else if (avg) statement += '.';
    else if (max) { statement += `; delays run up to ${max} minutes.`; values.push(`${max} minutes`); }
    else statement += '.';
    severity = isHub ? 85 : 8.6;
    // At a hub a delay program is a watch (and so is the hub-programs count when it lists only
    // those); away from the hubs it never sets the tone, as in the header (computeTone).
    toneFloor = isHub ? 'watch' : 'calm';
  } else if (type === 'closure') {
    suffix = 'closure';
    statement = `The FAA lists ${name} as closed${until}.`;
    severity = 95;
    toneFloor = 'disrupted';
  } else {
    const dir = type === 'departure_delay' ? 'departure' : 'arrival';
    suffix = type === 'departure_delay' ? 'dep' : 'arr';
    const range = min && max ? ` of ${min} to ${max} minutes` : max ? ` of up to ${max} minutes` : avg ? ` averaging ${avg} minutes` : '';
    if (min) values.push(`${min} minutes`);
    if (max) values.push(`${max} minutes`);
    if (avg && !(min && max)) values.push(`${avg} minutes`);
    const trend = /increas/i.test(String(p.trend || '')) ? ' The FAA says they are increasing.' : /decreas/i.test(String(p.trend || '')) ? ' The FAA says they are easing.' : '';
    statement = `The FAA reports ${dir} delays${range} at ${name}${because}.${trend}`;
    severity = dir === 'departure' ? 40 : 35;
    toneFloor = 'watch';
  }

  return {
    id: `faa.active.${code}.${suffix}`,
    kind: 'faa',
    hub: isHub ? code : undefined,
    statement,
    values: uniq(values),
    at: iso(asOfMs),
    link: { tab: 'weather', hub: code },
    severity,
    toneFloor,
    material: `${suffix}:${endMs ? round(endMs / 60000, 15) : 'open'}:${cause || ''}:${avg ? round(avg, 15) : ''}${endDay ? `:${endDay}` : ''}`,
  };
}

/**
 * One fact for one entry of the FAA operations plan, or null when it is not about a ground stop,
 * ground delay program or airspace flow program at an airport we know, or when a program is already
 * in effect there (the active fact says it; a "possible" beside it would contradict it).
 */
function plannedFact(tmi, { nowMs, activeAt, asOfMs, skipped, planDate = null }) {
  const text = String(tmi?.decoded || tmi?.event || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  const gs = /GROUND STOP|\bGS\b/.test(upper);
  const gdp = /DELAY PROGRAM|GROUND DELAY|\bGDP\b/.test(upper);
  const afp = /AIRSPACE FLOW|\bAFP\b/.test(upper);
  if (!gs && !gdp && !afp) return null;
  const program = gs && gdp ? 'a ground stop or ground delay program' : gs ? 'a ground stop' : gdp ? 'a ground delay program' : 'an airspace flow program';

  const airports = uniq((Array.isArray(tmi.affectedAirports) ? tmi.affectedAirports : [])
    .map((c) => String(c).toUpperCase())
    .filter((c) => /^[A-Z]{3}$/.test(c) && isKnownAirportCode(c)));
  if (airports.length === 0) return null;
  const hubs = airports.filter((c) => BRIEF_HUBS.includes(c));
  const primary = hubs[0] || airports[0];
  if (airports.some((c) => activeAt.has(c))) {
    skipped.push(`faa.planned.${primary}: a program is already in effect there`);
    return null;
  }

  // The window is in the `time` field or leads the event text: "UNTIL 0030", "AFTER 1800",
  // "1800-2200", "BETWEEN 1800 AND 2200". Bare HHMM is Zulu.
  const windowText = `${String(tmi.time || '')} ${text}`.toUpperCase();
  let window = '';
  /** The window opens on a later local day than now ("tomorrow after 10:00 AM ET"). */
  let later = false;
  const values = airports.flatMap((c) => airportForms(c));
  // Each time on the airport's clock, with the day it falls on whenever that is not later today
  // ("tomorrow after 10:00 AM ET"). The day travels in the time's own value ("tomorrow 10:00 AM
  // ET"), and the verifier drops a sentence that uses the time without it (time_without_day).
  const at = (hhmm) => resolvePlanHhmm(hhmm, nowMs, planDate);
  const clock = (ms) => (ms === null ? null : formatAirportClock(ms, primary));
  const day = (ms) => airportDayWord(/** @type {number} */ (ms), primary, nowMs) ?? '';
  const ended = (ms) => {
    skipped.push(`faa.planned.${primary}: its window ended at ${clock(ms)}`);
    return null;
  };
  let m;
  if ((m = windowText.match(/\bBETWEEN\s+(\d{4})Z?\s+AND\s+(\d{4})Z?\b/)) || (m = windowText.match(/\b(\d{4})Z?\s*[-–]\s*(\d{4})Z?\b/))) {
    const aMs = at(m[1]);
    let bMs = at(m[2]);
    if (aMs !== null && bMs !== null && bMs <= aMs) bMs += DAY_MS;
    const a = clock(aMs);
    const b = clock(bMs);
    if (a && b && bMs !== null && bMs <= nowMs) return ended(bMs);
    if (a && b && aMs !== null && aMs <= nowMs) {
      // Already open: only its end is news.
      const d = day(bMs);
      window = ` until ${b}${d ? ` ${d}` : ''}`;
      values.push(dayClock(d, b));
    } else if (a && b) {
      const d = day(aMs);
      window = `${d ? ` ${d}` : ''} between ${a} and ${b}`;
      values.push(dayClock(d, a), b);
      later = d !== '';
    }
  } else if ((m = windowText.match(/\bUNTIL\s+(\d{4})Z?\b/))) {
    const aMs = at(m[1]);
    const a = clock(aMs);
    if (a && aMs !== null && aMs <= nowMs) return ended(aMs);
    if (a) {
      const d = day(aMs);
      window = ` until ${a}${d ? ` ${d}` : ''}`;
      values.push(dayClock(d, a));
    }
  } else if ((m = windowText.match(/\bAFTER\s+(\d{4})Z?\b/))) {
    const aMs = at(m[1]);
    const a = clock(aMs);
    if (a && aMs !== null && aMs <= nowMs) {
      // Its start has passed: possible now, for the rest of the plan.
      window = ` since ${a}`;
      values.push(a);
    } else if (a) {
      const d = day(aMs);
      window = `${d ? ` ${d}` : ''} after ${a}`;
      values.push(dayClock(d, a));
      later = d !== '';
    }
  }

  const tentative = /\b(POSSIBLE|PROBABLE|POSS|PROB)\b/.test(upper);
  const where = airports.length > 1
    ? `${hubLabel(primary)} (also ${joinNames(airports.filter((c) => c !== primary).map(airportDisplayName))})`
    : hubLabel(primary);
  // A stop or delay program would hold flights into the airport (faaActiveFact); an airspace flow
  // program meters an airspace, so it keeps "at".
  const target = afp && !gs && !gdp ? `at ${where}` : `for flights into ${where}`;
  const statement = tentative
    ? `The FAA's operations plan says ${program} is possible ${target}${window}. It is not in effect.`
    : `The FAA's operations plan expects ${program} ${target}${window}. It is not in effect yet.`;
  const isHub = hubs.length > 0;
  // At a hub, a possible program later today is a watch; one whose window opens on a later day is
  // not tonight's news (Nov 12 2026: the next day's plan, issued around 00Z, set the evening's brief
  // to Watch). It ranks below every fact about now, above possible programs away from the hubs.
  const watchNow = isHub && !later;
  return {
    id: `faa.planned.${primary}`,
    kind: 'faa_planned',
    hub: isHub ? primary : undefined,
    statement,
    values: uniq(values),
    at: iso(asOfMs),
    link: { tab: 'weather', hub: primary },
    // Something that may happen at an airport that is not a United hub ranks below every other
    // fact: it orders the model's list last, and the template never picks or leads with it.
    severity: watchNow ? (tentative ? 22 : 30) : isHub ? 0.5 : 0,
    toneFloor: watchNow ? 'watch' : 'calm',
    // Something possible at an airport that is not a hub, or not before tomorrow, coming, going or
    // moving its window is not worth a new brief; later today at a hub it is. At local midnight a
    // hub's "tomorrow" line becomes today's and joins the key.
    material: watchNow ? `planned:${program}:${window}` : null,
    ...(later ? { later: true } : {}),
  };
}

/**
 * What each impact level (computeOpsImpact) means for the operation, in words a brief can reuse
 * without naming the site's own rating. "caution" is marginal weather: it CAN cause delays.
 */
const WEATHER_EFFECT = {
  caution: 'which can cause minor delays',
  warning: 'enough to slow arrivals and departures',
  severe: 'enough to slow arrivals and departures significantly',
};

/**
 * One fact for a hub whose weather is affecting operations, or null when it is not, or when there
 * is no condition to name: a "caution" from low clouds over mist or haze alone has no plain name,
 * and "weather that can slow operations" said nothing. A warning or severe level always names one
 * (low clouds or visibility, thunderstorms, freezing rain, heavy rain or snow, strong wind).
 */
function weatherFact(hub, raw, atMs, skipped) {
  const cat = computeFlightCategory(raw);
  const impact = computeOpsImpact(raw, cat);
  if (impact.level === 'normal') return null;
  const conditions = [];
  const values = [...airportForms(hub), 'weather'];
  if (cat === 'LIFR' || cat === 'IFR') {
    const ceil = parseCeiling(raw);
    const vis = parseVisibilitySM(raw);
    const lowCeil = ceil && ceil.feet < (cat === 'LIFR' ? 500 : 1000);
    const lowVis = vis && vis.miles < (cat === 'LIFR' ? 1 : 3);
    const very = cat === 'LIFR' ? 'very ' : '';
    if (lowCeil) conditions.push(`${very}low clouds`);
    if (lowVis) conditions.push(`${very}low visibility`);
    if (!lowCeil && !lowVis) conditions.push(`${very}low clouds or low visibility`);
  } else if (cat === 'MVFR') {
    conditions.push('somewhat low clouds or visibility');
  }
  if (impact.hasThunderstorms) conditions.push('thunderstorms');
  if (impact.hasFreezingPrecip) conditions.push('freezing rain or drizzle');
  if (impact.hasSnow) conditions.push('snow');
  if (impact.reasons.includes('heavy precipitation')) conditions.push(impact.hasSnow ? 'heavy snow' : 'heavy rain');
  else if (impact.reasons.includes('precipitation') && !impact.hasSnow) conditions.push('rain');
  if (impact.hasFog) conditions.push('fog');
  // computeOpsImpact reports a steady wind of 30 knots or more without a gust group as "gusts Nkt".
  const steady = impact.gustKt >= 30 ? null : impact.reasons.map((r) => r.match(/^gusts (\d+)kt$/)).find(Boolean);
  const windKt = impact.gustKt >= 30 ? impact.gustKt : steady ? Number(steady[1]) : 0;
  if (impact.gustKt >= 30) { conditions.push(`wind gusting to ${impact.gustKt} knots`); values.push(`${impact.gustKt} knots`); }
  else if (steady) { conditions.push(`wind of ${steady[1]} knots`); values.push(`${steady[1]} knots`); }
  if (conditions.length === 0) {
    skipped.push(`wx.${hub}: ${impact.level} with no condition to name (${impact.reasons.join(', ') || 'none'})`);
    return null;
  }
  values.push(...conditions);
  return {
    id: `wx.${hub}`,
    kind: 'weather',
    hub,
    statement: `${hubLabel(hub)} weather: ${joinNames(uniq(conditions))}, ${WEATHER_EFFECT[impact.level]}.`,
    values: uniq(values),
    at: iso(atMs),
    link: { tab: 'weather', hub },
    severity: impact.level === 'caution' ? 12 : impact.level === 'warning' ? 35 : 50,
    toneFloor: impact.level === 'caution' ? 'calm' : 'watch',
    // The level plus the hazards that matter on their own. Which of low clouds, low visibility and
    // fog a METAR reports flickers from one observation to the next; the level already carries it.
    // Caution-level weather (light rain or snow, mist, 30-knot gusts) is never a change on its own.
    material: impact.level === 'caution' ? null : `wx:${impact.level}:${[
      impact.hasThunderstorms ? 'thunderstorms' : null,
      impact.hasSnow ? 'snow' : null,
      impact.hasFreezingPrecip ? 'freezing' : null,
      windKt >= 40 ? 'wind40' : windKt >= 30 ? 'wind30' : null,
    ].filter(Boolean).join(',')}`,
  };
}

/**
 * Airborne and Starlink-airborne counts over a parsed live feed (src/lib/feed-health.js
 * parseFr24Feed). "Airborne" is isOnGround()'s complement, as on the Live stat bar; "Starlink" is
 * src/app/views/live/starlink-match.ts makeIsStarlinkFlight's rule, restated here because that
 * module lives under src/app: the fleet match first, then the hyphen-free registration.
 *
 * @param {Array<any>} flights
 * @param {Set<string>} starlinkTails
 * @param {Record<string, any>} fleetByReg
 * @returns {{airborne: number, express: number, starlink: number}}
 */
export function countAirborneAndStarlink(flights, starlinkTails, fleetByReg = {}) {
  let airborne = 0;
  let express = 0;
  let starlink = 0;
  for (const f of flights || []) {
    if (isOnGround(f)) continue;
    airborne++;
    if (isExpressCallsign(f?.callsign)) express++;
    if (!starlinkTails || starlinkTails.size === 0) continue;
    const ac = matchAircraft(f, fleetByReg);
    if (ac && ac.r ? starlinkTails.has(ac.r) : Boolean(f.reg) && starlinkTails.has(String(f.reg).replace(/-/g, '').toUpperCase())) starlink++;
  }
  return { airborne, express, starlink };
}

/**
 * The airborne median at this time of day over earlier days, from per-day samples. Each entry is
 * one day's samples near the same clock time; the reading nearest the target is that day's value.
 * @param {Array<{targetMs: number, samples: Array<{t: string, airborne: number}>}>} days
 * @returns {{median: number, days: number}|null} null when fewer than 3 days have a sample.
 */
export function airborneNormal(days) {
  const perDay = [];
  for (const day of days || []) {
    let best = null;
    for (const s of day.samples || []) {
      const t = Date.parse(s.t);
      if (!Number.isFinite(t) || !Number.isFinite(s.airborne)) continue;
      if (!best || Math.abs(t - day.targetMs) < Math.abs(best.t - day.targetMs)) best = { t, airborne: s.airborne };
    }
    if (best) perDay.push(best.airborne);
  }
  if (perDay.length < 3) return null;
  perDay.sort((a, b) => a - b);
  const mid = Math.floor(perDay.length / 2);
  const median = perDay.length % 2 ? perDay[mid] : Math.round((perDay[mid - 1] + perDay[mid]) / 2);
  return { median, days: perDay.length };
}

/**
 * How many hubs have an on-time figure (the cron's evidence gate, BRIEF_MIN_HUB_READINGS). Read
 * from the collection, not from the facts: on a day when every hub is healthy most hubs' own
 * on-time facts are not sent, but their figures are still the evidence the summary rests on.
 * @param {{hubReadings?: number}} collection  buildBriefFacts' `collection`
 */
export function hubReadingCount(collection) {
  return Number(collection?.hubReadings) || 0;
}

/**
 * The string the facts hash is taken over: the id and `material` of every fact whose material is
 * not null, in id order. A fact with `material: null` is left out entirely, id included, so it
 * appearing or disappearing is not a change. Two runs whose facts differ only by readings (700 vs
 * 600 in the air, a healthy hub at 100% or 95% or aging out, the disruption index inside its band,
 * the low-cloud/fog wording of the same weather level) produce the same key; a new ground stop, a
 * hub dropping under 80%, a weather level or hazard change or a new radio observation does not.
 * @param {Array<{id: string, material?: string|null}>} facts
 * @returns {string}
 */
export function materialKey(facts) {
  return JSON.stringify([...(facts || [])]
    .filter((f) => f.material !== null)
    .map((f) => [f.id, f.material ?? ''])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)));
}

/**
 * A fact as the public endpoint and the model see it: no severity, tone floor or material.
 * @param {BriefFact} fact
 */
export function publicFact(fact) {
  const { id, kind, hub, statement, values, at, link, quote } = fact;
  // `quote` exists only on radio facts, already sanitized (src/lib/brief-radio.js sanitizeRadioTitle).
  return { id, kind, ...(hub ? { hub } : {}), statement, values, ...(typeof quote === 'string' ? { quote } : {}), at, link };
}
