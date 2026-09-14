// ═══ SCHEDULE BOARD — ROW SHAPING ═══
// Everything the Schedule board decides about ONE row, given that row and the lookups it
// needs. No React, no DOM, no network — so every branch below is reachable from a test
// instead of only from a live AeroDataBox board on the right kind of day.
//
// Several of these branches exist because of a specific incident and must not be
// "simplified" back:
//
//   · DELAY / RISK is a PRECEDENCE, not a formatting choice. A row with a known
//     actual-or-estimated delta shows the real delay; only a future row without one shows a
//     prediction, worded "RISK: …". The shipped board once displayed "V.HIGH" next to a
//     flight already running 140 minutes late.
//   · A row whose scheduled time the board DERIVED from the actual has no delta to show —
//     comparing a number against itself would render "+0m" as if it were a measurement.
//   · The route cell promotes an airport NAME when the provider omitted the IATA code. Seven
//     of 644 rows on a real ORD board had a city and no code, and rendered as "ORD → ?" with
//     the city stranded in the subtitle.
//   · Terminal comes before gate. The column header says "Term / Gate", so a bare gate value
//     must never sit where a terminal is expected.

import { formatDelayMinutes } from './delay-format.js';
import { ICAO_TO_FLEET_TYPE } from './equipment-swaps.js';
import { normalizeWifi } from './fleet-utils.js';
import { getUnitedTerminal } from './hub-terminals.js';
import { displayScheduleStatus } from './status-display.js';

/** A delta smaller than this is noise, not a delay worth a second line in the time cell. */
export const ACTUAL_LINE_THRESHOLD_MINUTES = 5;

/**
 * Hub-local `HH:MM`, 24-hour — the board's one time format.
 *
 * @param {number|null|undefined} seconds  unix seconds.
 * @param {string} timeZone  IANA zone.
 * @returns {string} `HH:MM`, or an em dash when there is no time (or the zone is unusable).
 */
export function formatSchedTime(seconds, timeZone) {
  if (!seconds) return '—';
  try {
    return new Date(seconds * 1000).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    });
  } catch {
    return '—';
  }
}

/**
 * "Sep 11" for a row carried over from an earlier hub-local date, else null.
 *
 * A time-ascending board shows yesterday's stragglers at the top; without the chip "06:52"
 * reads as today's 06:52.
 *
 * @param {number|undefined} schedTimeSec
 * @param {number} dayStartSec  start of the board's hub-local day (unix seconds).
 * @param {string} timeZone
 * @returns {string|null}
 */
export function dateChipLabel(schedTimeSec, dayStartSec, timeZone) {
  if (!schedTimeSec || !dayStartSec || schedTimeSec >= dayStartSec) return null;
  try {
    return new Date(schedTimeSec * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone,
    });
  } catch {
    // The chip is decorative — never break a row over it.
    return null;
  }
}

/**
 * The "→ 22:29 (+54m)" second line under the scheduled time, or null.
 *
 * Suppressed when the scheduled time was DERIVED from the actual (there is no independent
 * baseline to compare against) and when the delta is within ±5 minutes.
 *
 * @param {{schedTimeSec?: number, actualTimeSec?: number, derivedActual?: boolean, timeZone: string}} input
 * @returns {{text: string, early: boolean, minutes: number}|null} `early` marks a departure
 *   ahead of schedule, which the board colours differently from a late one.
 */
export function actualDeltaLine({ schedTimeSec, actualTimeSec, derivedActual, timeZone }) {
  if (derivedActual) return null;
  if (!actualTimeSec || !schedTimeSec || actualTimeSec === schedTimeSec) return null;
  const minutes = Math.round((actualTimeSec - schedTimeSec) / 60);
  if (Math.abs(minutes) <= ACTUAL_LINE_THRESHOLD_MINUTES) return null;
  const stamp = formatSchedTime(actualTimeSec, timeZone);
  return minutes > 0
    ? { text: `→ ${stamp} (+${minutes}m)`, early: false, minutes }
    : { text: `→ ${stamp} (${minutes}m)`, early: true, minutes };
}

/**
 * "Chicago O'Hare International Airport" → "Chicago O'Hare", capped at 30 characters.
 *
 * @param {{name?: string}|null|undefined} airport
 * @returns {string} '' when there is no name.
 */
export function shortAirportName(airport) {
  if (!airport || !airport.name) return '';
  return airport.name.replace(/ Airport| International/g, '').substring(0, 30);
}

/**
 * The route cell: the hub on the board's side, the other end on the other.
 *
 * @param {object} flight
 * @param {string} hub
 * @param {('departures'|'arrivals')} dir
 * @returns {{routeLine: string, routeSub: string|null}} `routeSub` is the airport name, and
 *   only when it is NOT already the primary text — a row that shows the name because the
 *   code was missing must not repeat it underneath.
 */
export function routeCell(flight, hub, dir) {
  const isDep = dir !== 'arrivals';
  const endpoint = isDep ? flight?.airport?.destination : flight?.airport?.origin;
  const code = endpoint?.code?.iata;
  const name = shortAirportName(endpoint);
  const primary = code || name || '—';
  return {
    routeLine: isDep ? `${hub} → ${primary}` : `${primary} → ${hub}`,
    routeSub: code && name ? name : null,
  };
}

/**
 * The aircraft cell: the type code, the provider's full text, and a short label under it.
 *
 * @param {object} flight
 * @returns {{acCode: string, acText: string, acShort: string}}
 */
export function aircraftCell(flight) {
  const acCode = flight?.aircraft?.model?.code || '—';
  const acText = flight?.aircraft?.model?.text || '';
  const acShort = acText ? acText.replace(/Boeing |Airbus |Embraer /g, '').substring(0, 20) : '';
  return { acCode, acText, acShort };
}

/**
 * `T1 · C18` / `T1` / `Gate C18` / `—`.
 *
 * The provider's terminal wins; `getUnitedTerminal()` fills United's known hub terminals
 * when it is absent (and answers per-route, since an international departure can leave from
 * a different terminal than a domestic one).
 *
 * @param {object} flight
 * @param {('departures'|'arrivals')} dir
 * @returns {string}
 */
export function terminalGateCell(flight, dir) {
  const isDep = dir !== 'arrivals';
  const origin = flight?.airport?.origin;
  const destination = flight?.airport?.destination;
  const oIata = origin?.code?.iata || '';
  const dIata = destination?.code?.iata || '';
  const endpoint = isDep ? origin : destination;
  const terminal = endpoint?.info?.terminal || getUnitedTerminal(isDep ? oIata : dIata, oIata, dIata);
  const gate = endpoint?.info?.gate;
  if (terminal && gate) return `T${terminal} · ${gate}`;
  if (terminal) return `T${terminal}`;
  if (gate) return `Gate ${gate}`;
  return '—';
}

/**
 * A tail that came from live tracking rather than the schedule feed.
 *
 * A server-merged tail arrives IN `aircraft.registration` tagged `regSource:'live_feed'`; a
 * client-ledger fill leaves that field empty. Both earn the honesty tooltip, because neither
 * is what the schedule provider actually sent.
 *
 * @param {object} flight
 * @param {string} reg  the resolved registration (provider first, ledger second).
 * @returns {boolean}
 */
export function isRegFromLiveFeed(flight, reg) {
  if (!reg) return false;
  return !flight?.aircraft?.registration || flight?.aircraft?.regSource === 'live_feed';
}

/**
 * The Fleet cell plus the enrichment line under the registration.
 *
 * @param {string} reg
 * @param {Record<string, object>} fleetByReg
 * @param {Set<string>} starlinkTails
 * @returns {{badge: string, starlink: boolean, enrich: string}|null} null when the tail is
 *   unknown or absent — the board renders a dash rather than inventing a cabin.
 */
export function fleetCell(reg, fleetByReg, starlinkTails) {
  if (!reg) return null;
  const regClean = reg.replace('-', '');
  const match = (fleetByReg && (fleetByReg[regClean] || fleetByReg[reg])) || null;
  if (!match) return null;
  const starlink = Boolean(starlinkTails && (starlinkTails.has(regClean) || starlinkTails.has(reg)));
  const parts = [];
  if (match.seats && typeof match.seats === 'object') {
    parts.push(
      Object.entries(match.seats)
        .map(([cabin, count]) => `${count}${cabin}`)
        .join('/'),
    );
  }
  if (match.w) parts.push(normalizeWifi(match.w));
  if (starlink) parts.push('⚡ Starlink');
  if (match.i) parts.push(match.i);
  if (match.d) parts.push(`Del ${match.d}`);
  return { badge: String(match.c || match.t || ''), starlink, enrich: parts.join(' · ') };
}

/**
 * Which way an equipment swap went, from its impact list.
 *
 * A downgrade outranks an upgrade: a swap that adds Starlink but loses Polaris is a
 * downgrade to the passenger who booked the seat, and the badge has to say so.
 *
 * @param {Array<{cls: string}>} impacts
 * @returns {('downgrade'|'upgrade'|'lateral')}
 */
export function swapTone(impacts) {
  const list = Array.isArray(impacts) ? impacts : [];
  if (list.some((impact) => impact && impact.cls === 'downgrade')) return 'downgrade';
  if (list.some((impact) => impact && impact.cls === 'upgrade')) return 'upgrade';
  return 'lateral';
}

/**
 * The equipment-swap badge: readable fleet names, the new tail, and the impact chips.
 *
 * @param {{oldAc: string, newAc: string}} change
 * @param {string} reg
 * @param {Array<{text: string, cls: string}>} impacts
 * @returns {{oldType: string, newType: string, reg: string, impacts: Array, tone: string}|null}
 */
export function swapCell(change, reg, impacts) {
  if (!change) return null;
  return {
    oldType: ICAO_TO_FLEET_TYPE[change.oldAc] || change.oldAc,
    newType: ICAO_TO_FLEET_TYPE[change.newAc] || change.newAc,
    reg: reg || '',
    impacts: Array.isArray(impacts) ? impacts : [],
    tone: swapTone(impacts),
  };
}

/**
 * DELAY / RISK — facts beat predictions.
 *
 * The precedence, in order:
 *   1. A terminal row (canceled / likely canceled / diverted) shows nothing. There is no
 *      delay to report and a risk score for a flight that will not operate is noise.
 *   2. A known delta shows the REAL delay — when the row has operated for real (not by
 *      time inference), or when the delta is big enough to be a fact on its own.
 *   3. Otherwise a future row shows its predicted risk, worded so it cannot read as a fact.
 *   4. Otherwise nothing.
 *
 * @param {object} input
 * @param {string} input.statusKey
 * @param {boolean} input.presumed  the status was inferred from elapsed time, so there is no
 *   trustworthy actual time behind it.
 * @param {number|undefined} input.schedTimeSec
 * @param {number|undefined} input.actualTimeSec  real time, else estimated.
 * @param {boolean} input.hasRealTime  a provider-confirmed time exists (vs an estimate).
 * @param {('departures'|'arrivals')} input.dir
 * @param {object|null} input.risk  the delay-risk model, or null.
 * @returns {{kind:'none'}|{kind:'delta',minutes:number,text:string,title:string}|{kind:'risk',risk:object}}
 */
export function delayCell({ statusKey, presumed, schedTimeSec, actualTimeSec, hasRealTime, dir, risk }) {
  const isTerminal =
    statusKey === 'canceled' || statusKey === 'canceled_uncertain' || statusKey === 'diverted';
  if (isTerminal) return { kind: 'none' };

  const hasOperated = statusKey === 'departed' || statusKey === 'enroute' || statusKey === 'landed';
  const minutes =
    actualTimeSec && schedTimeSec ? Math.round((actualTimeSec - schedTimeSec) / 60) : null;

  if (minutes !== null && ((hasOperated && !presumed) || minutes > ACTUAL_LINE_THRESHOLD_MINUTES)) {
    return {
      kind: 'delta',
      minutes,
      text: formatDelayMinutes(minutes),
      title: `${hasRealTime ? 'Actual' : 'Estimated'} vs scheduled ${
        dir === 'arrivals' ? 'arrival' : 'departure'
      }`,
    };
  }
  if (risk) return { kind: 'risk', risk };
  return { kind: 'none' };
}

/**
 * The `data-*` payload the delay-explain dialog reads, assembled from board context.
 *
 * @returns {Record<string, unknown>}
 */
export function delayExplainContext({ ident, riskContext, statusText, risk, hubOtp, weatherOpsByHub, iropsHubRates }) {
  const { origCode, destCode, depHub, arrHub } = riskContext || {};
  return {
    flight: ident,
    route: `${origCode || ''}→${destCode || ''}`,
    status: statusText,
    riskLabel: risk?.label,
    riskScore: risk?.score,
    riskFactors: risk?.factors,
    hub: depHub,
    otp: hubOtp?.[depHub],
    weather: weatherOpsByHub?.[depHub],
    destWeather: weatherOpsByHub?.[arrHub],
    irops: iropsHubRates?.[depHub],
  };
}

/**
 * On-time percentage → severity name. `≥70` green, `≥50` amber, below that red; no reading
 * is its own state, not a zero.
 *
 * The NAME is returned, never a colour: the caller maps it to its own palette and always
 * pairs it with a word, because status is never colour-alone.
 *
 * @param {number|null|undefined} pct
 * @returns {('green'|'amber'|'red'|null)}
 */
export function otpSeverity(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(Number(pct))) return null;
  const value = Number(pct);
  if (value >= 70) return 'green';
  if (value >= 50) return 'amber';
  return 'red';
}

/** The plain-English word shown next to the on-time percentage, so colour is never alone. */
export const OTP_SEVERITY_LABEL = {
  green: 'smooth',
  amber: 'some delays',
  red: 'rough',
};

/**
 * One fully-shaped board row.
 *
 * Status, registration and the risk model arrive PRE-COMPUTED from the caller, which caches
 * them per row: the filter predicate asks for each of them several times per row and the
 * risk model is a few hundred lines of signal collection, so recomputing here would make a
 * 700-row board visibly laggy on every keystroke.
 *
 * @param {object} flight  a normalized schedule row.
 * @param {object} ctx
 * @returns {object} the row model the table paints.
 */
export function buildScheduleRow(flight, ctx) {
  const {
    hub,
    dir,
    dayStartSec,
    timeZone,
    index = 0,
    reg = '',
    status: rawStatus,
    risk = null,
    riskContext,
    swapChange = null,
    swapImpacts = [],
    fleetByReg = {},
    starlinkTails = new Set(),
    special = new Map(),
    faaContext = null,
    hubOtp = {},
    weatherOpsByHub = {},
    iropsHubRates = {},
    effectiveTime = 0,
  } = ctx;

  const isDep = dir !== 'arrivals';
  const ident = flight?.identification?.number?.default || '—';
  const time = flight?.time || {};
  const schedTimeSec = isDep ? time.scheduled?.departure : time.scheduled?.arrival;
  const actualTimeSec = isDep
    ? time.real?.departure || time.estimated?.departure
    : time.real?.arrival || time.estimated?.arrival;
  const hasRealTime = Boolean(time.real?.departure || time.real?.arrival);
  const derivedActual = Boolean(
    isDep
      ? flight?._source?.scheduleTimeDerivedFromActual?.departure
      : flight?._source?.scheduleTimeDerivedFromActual?.arrival,
  );

  const status = displayScheduleStatus(rawStatus);
  status.key = rawStatus?.key;

  const { routeLine, routeSub } = routeCell(flight, hub, dir);
  const { acCode, acText, acShort } = aircraftCell(flight);
  const specialEntry = reg ? special.get(reg.replace('-', '')) || special.get(reg) : undefined;
  const delay = delayCell({
    statusKey: status.key,
    presumed: status.presumed,
    schedTimeSec,
    actualTimeSec,
    hasRealTime,
    dir,
    risk,
  });

  return {
    ident,
    key: `${ident}-${schedTimeSec ?? index}`,
    raw: flight,
    timeText: formatSchedTime(schedTimeSec, timeZone),
    dateChip: dateChipLabel(schedTimeSec, dayStartSec, timeZone),
    actualLine: actualDeltaLine({ schedTimeSec, actualTimeSec, derivedActual, timeZone }),
    derivedActual,
    routeLine,
    routeSub,
    acCode,
    acText,
    acShort,
    reg,
    regFromLive: isRegFromLiveFeed(flight, reg),
    gate: terminalGateCell(flight, dir),
    status,
    fleet: fleetCell(reg, fleetByReg, starlinkTails),
    swap: swapCell(swapChange, reg, swapImpacts),
    special: specialEntry ? specialEntry.name : null,
    faaContext,
    delay:
      delay.kind === 'risk'
        ? {
            ...delay,
            context: delayExplainContext({
              ident,
              riskContext,
              statusText: status.text,
              risk,
              hubOtp,
              weatherOpsByHub,
              iropsHubRates,
            }),
          }
        : delay,
    watchRoute: `${riskContext?.origCode || ''}→${riskContext?.destCode || ''}`,
    effectiveTime,
  };
}
