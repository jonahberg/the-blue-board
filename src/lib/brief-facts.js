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
/** "About the usual" band for the airborne comparison, in percent either side of the median. */
export const BRIEF_AIRBORNE_USUAL_BAND_PCT = 10;

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
 * `toneFloor` of any fact. The model proposes a tone; this decides it. For FAA programs at United
 * hubs it follows the header's own levels (src/lib/ops-health.js): ground delay programs at any
 * number of hubs are "watch" ("Some Delays"); a ground stop or closure at a hub is "disrupted".
 * @param {Array<{toneFloor?: string}>} facts
 * @returns {'calm'|'watch'|'disrupted'}
 */
export function computeTone(facts) {
  return /** @type {'calm'|'watch'|'disrupted'} */ (maxTone(...(facts || []).map((f) => f.toneFloor)));
}

/** A ground stop or ground delay program in effect at a United hub (only hub facts carry `hub`). */
const HUB_PROGRAM_ID_RE = /^faa\.active\.[A-Z]{3}\.(gs|gdp)$/;
export function isHubProgramFact(fact) {
  return HUB_PROGRAM_ID_RE.test(String(fact?.id ?? '')) && typeof fact?.hub === 'string' && fact.hub !== '';
}

/**
 * Whether a brief may carry a traveler note: when an FAA ground stop or ground delay program is in
 * effect at a United hub (travelers bound there are held), or the tone is "disrupted". The
 * verifier, the template and the dashboard (src/lib/brief-view.js mirrors it) apply the same rule.
 * @param {string} tone
 * @param {Array<{id: string, hub?: string}>} facts
 */
export function travelerNoteAllowed(tone, facts) {
  return tone === 'disrupted' || (facts || []).some(isHubProgramFact);
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
 * @returns {{facts: BriefFact[], collection: {sources: Record<string, string>, skipped: string[]}}}
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

    for (const [hub, r] of Object.entries(readings)) {
      const yesterday = defaultSchedDayOffset(hub, new Date(nowMs)) !== 0;
      const when = yesterday ? 'yesterday (its board has not rolled over to today yet)' : 'so far today';
      const severity = r.otp < 50 ? 70 : r.otp < BRIEF_SOFT_HUB_OTP ? 45 : r.otp < BRIEF_HEALTHY_HUB_OTP ? 20 : 5;
      facts.push({
        id: `otp.${hub}`,
        kind: 'otp',
        hub,
        statement: `${hubLabel(hub)}: ${r.otp}% of departures ${when} left within ${ON_TIME_GRACE_MIN} minutes of schedule (${r.operated} departed).`,
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
      if (!allHealthy) {
        facts.push({
          id: 'otp.min',
          kind: 'otp',
          hub: low,
          statement: `Of the ${n} hubs with an on-time reading, ${hubLabel(low)} is lowest at ${readings[low].otp}%.`,
          values: uniq([`${readings[low].otp}%`, String(n), numberWord(n), ...airportForms(low)]),
          at: iso(readings[low].at),
          link: { tab: 'schedule', hub: low },
          severity: readings[low].otp < BRIEF_SOFT_HUB_OTP ? 40 : 6,
          toneFloor: 'calm',
          material: `min:${low}:${round(readings[low].otp, 5)}`,
        });
      }

      const soft = sorted.filter((h) => readings[h].otp < BRIEF_SOFT_HUB_OTP);
      if (soft.length === 0) {
        const floorPct = readings[low].otp;
        facts.push({
          id: 'otp.floor',
          kind: 'otp',
          statement: allHealthy
            ? `All ${n} hubs with an on-time reading are at ${floorPct}% or better.`
            : `All ${n} hubs with an on-time reading are at ${floorPct}% or better; ${airportDisplayName(low)} is the lowest.`,
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
          statement: `${soft.length} of the ${n} hubs with an on-time reading ${plural(soft.length, 'is', 'are')} under ${BRIEF_SOFT_HUB_OTP}%: ${joinNames(names)}.`,
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
        statement: `The Blue Board's disruption index, which weighs cancellations, long delays and diversions across hub departures, is ${score}, ${bandText}.`,
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
      statement: `The Blue Board's network status, which combines hub on-time, FAA programs at hubs and the disruption index, reads "${net.label}".`,
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
    facts.push({
      id: 'cxl.confirmed',
      kind: 'cancellations',
      statement: `${confirmed} ${plural(confirmed, 'departure', 'departures')} on United's current hub boards ${plural(confirmed, 'is', 'are')} confirmed canceled.`,
      values: uniq([String(confirmed), numberWord(confirmed)]),
      at: iso(asOf.irops ?? nowMs),
      link: { tab: 'schedule' },
      severity: confirmed >= 50 ? 50 : confirmed >= 20 ? 30 : confirmed >= 5 ? 12 : 2,
      toneFloor: 'calm',
      material: `cxl:${countBucket(confirmed)}`,
    });
    if (likely > 0) {
      facts.push({
        id: 'cxl.unconfirmed',
        kind: 'cancellations',
        statement:
          `The schedule provider marks ${likely} more hub ${plural(likely, 'departure', 'departures')} as "likely canceled" without confirming ${plural(likely, 'it', 'them')}. ` +
          `That label is often wrong` + (seenFlying > 0 ? `: ${seenFlying} flights it marked that way today were seen flying.` : '.'),
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
      facts.push({
        id: `cxl.${hub}`,
        kind: 'cancellations',
        hub,
        statement: `${hubLabel(hub)} has ${hubConfirmed} confirmed ${plural(hubConfirmed, 'cancellation', 'cancellations')} among ${hubTotal} departures on its current board.`,
        values: uniq([String(hubConfirmed), numberWord(hubConfirmed), String(hubTotal), ...airportForms(hub)]),
        at: iso(Number(m.generatedAt) > 0 ? Number(m.generatedAt) * 1000 : asOf.irops ?? nowMs),
        link: { tab: 'schedule', hub },
        severity: rate >= 0.1 ? 55 : rate >= 0.05 ? 30 : 10,
        toneFloor: rate >= 0.1 ? 'watch' : 'calm',
        material: `cxl:${countBucket(hubConfirmed)}`,
      });
    }
  }

  // ── FAA programs in effect (/api/faa) ──
  /** @type {Set<string>} airports with an active ground stop / ground delay program / closure */
  const activeAt = new Set();
  if (status.faa === 'ok') {
    const hubPrograms = [];
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
        const fact = faaActiveFact(code, p, { isHub, nowMs, asOfMs: asOf.faa ?? nowMs });
        facts.push(fact);
        if (type === 'ground_stop' || type === 'ground_delay' || type === 'closure') {
          activeAt.add(code);
          (isHub ? hubPrograms : otherPrograms).push({ code, type });
        }
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
    if (otherPrograms.length > 0) {
      const m = otherPrograms.length;
      facts.push({
        id: 'faa.active.other',
        kind: 'faa',
        statement: `The FAA also has ${m} ${plural(m, 'program', 'programs')} in effect at other airports: ${describe(otherPrograms)}.`,
        values: uniq([String(m), numberWord(m), ...otherPrograms.flatMap((p) => airportForms(p.code))]),
        at: iso(asOf.faa ?? nowMs),
        link: { tab: 'weather' },
        severity: 10,
        toneFloor: 'calm',
        material: `otherprog:${otherPrograms.map((p) => `${p.code}.${p.type}`).sort().join(',')}`,
      });
    }
  }

  // ── FAA planned / possible programs (/api/nas operations plan) ──
  if (status.nas === 'ok') {
    const planned = Array.isArray(sources.nas.planned) ? sources.nas.planned : [];
    const usedIds = new Set();
    let plannedCount = 0;
    let plannedAtHub = 0;
    for (const tmi of planned) {
      const fact = plannedFact(tmi, { nowMs, activeAt, asOfMs: asOf.nas ?? nowMs, skipped });
      if (!fact) continue;
      let id = fact.id;
      for (let i = 2; usedIds.has(id); i++) id = `${fact.id}.${i}`;
      usedIds.add(id);
      facts.push({ ...fact, id });
      plannedCount++;
      if (fact.hub) plannedAtHub++;
    }
    if (plannedCount > 0) {
      facts.push({
        id: 'faa.planned.count',
        kind: 'faa_planned',
        statement: `The FAA's operations plan lists ${plannedCount} possible or planned ${plural(plannedCount, 'program', 'programs')} for later. None of them is in effect now.`,
        values: uniq([String(plannedCount), numberWord(plannedCount)]),
        at: iso(asOf.nas ?? nowMs),
        link: { tab: 'weather' },
        // Only possible programs away from the hubs: last, with them (plannedFact).
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
      facts.push({
        id: 'air.normal',
        kind: 'airborne',
        statement: `The ${airborne} United flights in the air are ${comparison} for this time of day: over the past ${days} days, the median at this hour was ${median}.`,
        values: uniq([String(median), String(days), numberWord(days), usual ? null : `${Math.abs(pct)}%`, String(airborne)]),
        at: iso(atMs),
        link: { tab: 'live' },
        severity: !usual && Math.abs(pct) >= 25 ? 20 : 2,
        toneFloor: 'calm',
        material: `airnorm:${usual ? 'usual' : pct < 0 ? 'below' : 'above'}`,
      });
    }
  }

  for (const fact of sources?.extraFacts || []) facts.push(fact);

  facts.sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));
  return { facts, collection: { sources: status, skipped } };
}

/** One fact for one FAA program in effect. */
function faaActiveFact(code, p, { isHub, nowMs, asOfMs }) {
  const type = String(p.type);
  const name = hubLabel(code);
  const endMs = parseIsoMs(p.endTime);
  const endClock = endMs !== null && endMs > nowMs ? formatAirportClock(endMs, code) : null;
  const cause = faaCausePhrase(p.reason);
  const weather = isWeatherReason(p.reason);
  const avg = Number.isFinite(Number(p.avgDelay)) && Number(p.avgDelay) > 0 ? Math.round(Number(p.avgDelay)) : null;
  const max = Number.isFinite(Number(p.maxDelay)) && Number(p.maxDelay) > 0 ? Math.round(Number(p.maxDelay)) : null;
  const min = Number.isFinite(Number(p.minDelay)) && Number(p.minDelay) > 0 ? Math.round(Number(p.minDelay)) : null;
  const because = cause ? `, because of ${cause}` : '';
  const until = endClock ? ` until ${endClock}` : '';
  const values = [...airportForms(code), endClock, cause, weather ? 'weather' : null];
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
    severity = isHub ? 100 : 45;
    toneFloor = isHub ? 'disrupted' : 'watch';
  } else if (type === 'ground_delay') {
    suffix = 'gdp';
    statement = `The FAA has a ground delay program in effect for flights heading to ${name}${until}${because}. ${held}`;
    if (avg) { statement += `; delays average ${avg} minutes`; values.push(`${avg} minutes`); }
    if (avg && max) { statement += `, up to ${max} minutes.`; values.push(`${max} minutes`); }
    else if (avg) statement += '.';
    else if (max) { statement += `; delays run up to ${max} minutes.`; values.push(`${max} minutes`); }
    else statement += '.';
    severity = isHub ? 85 : 35;
    // A delay program is a watch (and so is the hub-programs count when it lists only those).
    toneFloor = 'watch';
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
    material: `${suffix}:${endMs ? round(endMs / 60000, 15) : 'open'}:${cause || ''}:${avg ? round(avg, 15) : ''}`,
  };
}

/**
 * One fact for one entry of the FAA operations plan, or null when it is not about a ground stop,
 * ground delay program or airspace flow program at an airport we know, or when a program is already
 * in effect there (the active fact says it; a "possible" beside it would contradict it).
 */
function plannedFact(tmi, { nowMs, activeAt, asOfMs, skipped }) {
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
  const values = airports.flatMap((c) => airportForms(c));
  const clock = (hhmm) => formatAirportClock(resolveZuluHhmm(hhmm, nowMs) ?? NaN, primary);
  let m;
  if ((m = windowText.match(/\bBETWEEN\s+(\d{4})Z?\s+AND\s+(\d{4})Z?\b/)) || (m = windowText.match(/\b(\d{4})Z?\s*[-–]\s*(\d{4})Z?\b/))) {
    const a = clock(m[1]);
    const b = clock(m[2]);
    if (a && b) { window = ` between ${a} and ${b}`; values.push(a, b); }
  } else if ((m = windowText.match(/\bUNTIL\s+(\d{4})Z?\b/))) {
    const a = clock(m[1]);
    if (a) { window = ` until ${a}`; values.push(a); }
  } else if ((m = windowText.match(/\bAFTER\s+(\d{4})Z?\b/))) {
    const a = clock(m[1]);
    if (a) { window = ` after ${a}`; values.push(a); }
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
    severity: isHub ? (tentative ? 22 : 30) : 0,
    toneFloor: isHub ? 'watch' : 'calm',
    // Something possible at an airport that is not a hub coming, going or moving its window is
    // not worth a new brief; at a hub it is.
    material: isHub ? `planned:${program}:${window}` : null,
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

/** How many hubs carry an on-time fact (the cron's evidence gate, BRIEF_MIN_HUB_READINGS). */
export function hubReadingCount(facts) {
  return (facts || []).filter((f) => /^otp\.[A-Z]{3}$/.test(f.id)).length;
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
