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
//   · The delay is measured to the best EVIDENCE, not blindly to the provider's estimate
//     (board-delay.js, live audit Oct 4 2026): UA2059 read "+3h28m" and landed +66m, UA407 read
//     "−75m" after leaving the gate 38 min late. Each delta now says what it measured (`basis`) and
//     whether it is only a floor or a ceiling (`bound`, rendered "≥" / "≤").

import { iataForAirportName, isPlaceholderAirportName } from './airport-codes.js';
import { boardTimeEvidence } from './board-delay.js';
import { formatDelayMinutes } from './delay-format.js';
import { ICAO_TO_FLEET_TYPE } from './equipment-swaps.js';
import { normalizeWifi } from './fleet-utils.js';
import { getUnitedTerminal } from './hub-terminals.js';
import { isPlausibleDelta } from './schedule-plausibility.js';
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
 * baseline to compare against), when the delta is within ±5 minutes, and when the delta is not
 * one a real flight could have (schedule-plausibility.js — a cross-instance pair or a stale
 * estimate, never a delay).
 *
 * @param {{schedTimeSec?: number, actualTimeSec?: number, derivedActual?: boolean, estimate?: boolean, timeZone: string}} input
 *   `estimate` marks an actual that is only an estimate (no real time on the board side).
 * @returns {{text: string, early: boolean, minutes: number}|null} `early` marks a departure
 *   ahead of schedule, which the board colours differently from a late one.
 */
export function actualDeltaLine({ schedTimeSec, actualTimeSec, derivedActual, estimate = false, timeZone }) {
  if (derivedActual) return null;
  if (!actualTimeSec || !schedTimeSec || actualTimeSec === schedTimeSec) return null;
  if (!isPlausibleDelta(actualTimeSec, schedTimeSec, { estimate })) return null;
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
 * The flight number as the board PRINTS it: a provider letter suffix stripped ("UA526H" → "UA526",
 * "UA409E" → "UA409"). AeroDataBox appends one to some United Express rows (live audit Oct 4 2026);
 * no passenger knows the flight by it. Display only: `ident` keeps the raw value for the row key,
 * the watch list and deep links — the stripped number can be a DIFFERENT real flight.
 *
 * @param {string|null|undefined} ident
 * @returns {string}
 */
export function displayFlightIdent(ident) {
  const raw = String(ident || '');
  const m = /^([A-Z]{2}\d{1,4})[A-Z]$/.exec(raw);
  return m ? m[1] : raw;
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
  // Codes, not cities (live audit Oct 4 2026: "San Francisco → DEN" beside "SFO → DEN"): a missing
  // code is recovered from an unambiguous airport name, and a placeholder name ("Unknown") is no name.
  const name = isPlaceholderAirportName(endpoint?.name) ? '' : shortAirportName(endpoint);
  const code = endpoint?.code?.iata || iataForAirportName(endpoint?.name);
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
 * The fleet database is mainline-only, so United Express rows — about 40% of a board — matched
 * nothing and showed "—" even on the 321 Express aircraft the Starlink tab lists as equipped
 * (N140SY: "—" here, "Starlink" there, "Starlink likely" in My Flights; live audit Oct 4 2026).
 * A tail the fleet database does not know but the Starlink roster does now reads Starlink, so the
 * three surfaces agree. Nothing else is invented: no cabin, no type.
 *
 * Since the United Express fleet (src/lib/express-fleet.js), a tail the mainline database misses
 * but the Express fleet knows reads its cabin when one is verified, else its type, else
 * "United Express" (about a third of the discovered tails have no type yet — CommutAir and GoJet
 * boards send no model code); the line under the tail is type · operator · ⚡ Starlink. The
 * roster-only answer stays for a Starlink tail the Express index has not caught up with.
 *
 * @param {string} reg
 * @param {Record<string, object>} fleetByReg
 * @param {Set<string>} starlinkTails  the Starlink roster (mainline AND Express tails).
 * @param {Record<string, {t?: string, o?: string, w?: string, c?: string}>} [expressByReg]  the
 *   United Express fleet by registration (`indexExpressFleet`). Optional: absent, the cell is what
 *   it was before the Express fleet existed.
 * @returns {{badge: string, starlink: boolean, enrich: string,
 *   source: 'fleet'|'express'|'starlink-roster'}|null}
 *   null when the tail is unknown or absent — the board renders a dash rather than inventing a
 *   cabin. `source` says which list answered.
 */
export function fleetCell(reg, fleetByReg, starlinkTails, expressByReg) {
  if (!reg) return null;
  const regClean = reg.replace('-', '');
  const match = (fleetByReg && (fleetByReg[regClean] || fleetByReg[reg])) || null;
  const starlink = Boolean(starlinkTails && (starlinkTails.has(regClean) || starlinkTails.has(reg)));
  if (!match) {
    const express = (expressByReg && (expressByReg[regClean] || expressByReg[reg])) || null;
    if (express) {
      const expressStarlink = starlink || express.w === 'Starlink';
      return {
        badge: String(express.c || express.t || 'United Express'),
        starlink: expressStarlink,
        enrich: [express.t, express.o, expressStarlink ? '⚡ Starlink' : ''].filter(Boolean).join(' · '),
        source: 'express',
      };
    }
    return starlink ? { badge: 'Starlink', starlink: true, enrich: '⚡ Starlink', source: 'starlink-roster' } : null;
  }
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
  return { badge: String(match.c || match.t || ''), starlink, enrich: parts.join(' · '), source: 'fleet' };
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

/** What each kind of measured time is called in the delay cell's tooltip. */
function delayTitle({ basis, bound, hasRealTime, dir }) {
  const side = dir === 'arrivals' ? 'arrival' : 'departure';
  switch (basis) {
    case 'runway':
      return dir === 'arrivals'
        ? 'Touchdown vs scheduled arrival — before taxi-in (the provider sent no separate gate time)'
        : 'Wheels-up vs scheduled departure — includes taxi-out (the provider sent no separate gate time)';
    case 'derived':
      return `Estimated ${side}: departure plus the scheduled block time (the provider's estimate contradicted it)`;
    case 'live':
      return 'ETA from live position vs scheduled arrival';
    case 'sighting':
      if (bound === 'lower') {
        return dir === 'arrivals'
          ? 'Landed — at least this late: measured to the last airborne position in the live feed'
          : 'At least this late — from when the live feed last saw it airborne and the scheduled block time';
      }
      return `At most this late — the live feed saw it airborne before the provider's ${side} time`;
    default:
      return `${hasRealTime ? 'Actual' : 'Estimated'} vs scheduled ${side}`;
  }
}

/**
 * DELAY / RISK — facts beat predictions.
 *
 * The precedence, in order:
 *   1. A terminal row (canceled / likely canceled / diverted) shows nothing. There is no
 *      delay to report and a risk score for a flight that will not operate is noise.
 *   2. A known delta shows the REAL delay — when the row has operated for real (not by
 *      time inference), or when the delta is big enough to be a fact on its own. A delta that
 *      no real flight could have (schedule-plausibility.js: a two-day cross-instance "+54h", a
 *      stale 10h estimate) is not a fact, and neither is a scheduled time the board derived
 *      from the actual. A bound ("≥" / "≤", board-delay.js) is shown only when it says something.
 *   3. Otherwise a FUTURE row shows its predicted risk, worded so it cannot read as a fact. A row
 *      whose best time is already behind the clock (`pastDue`) is not a future row: ORD UA303 read
 *      "Expected · RISK: LOW" 36 minutes after it landed (live audit Oct 4 2026).
 *   4. Otherwise nothing.
 *
 * @param {object} input
 * @param {string} input.statusKey
 * @param {boolean} input.presumed  the status was inferred from elapsed time, so there is no
 *   trustworthy actual time behind it.
 * @param {number|undefined} input.schedTimeSec
 * @param {number|undefined} input.actualTimeSec  the measured time (board-delay.js evidence).
 * @param {boolean} input.hasRealTime  a provider-confirmed or observed time ON THE BOARD'S SIDE
 *   (real departure on departures, real arrival on arrivals) — vs an estimate.
 * @param {boolean} [input.derivedActual]  the scheduled time was derived from the actual.
 * @param {('departures'|'arrivals')} input.dir
 * @param {object|null} input.risk  the delay-risk model, or null.
 * @param {('gate'|'runway'|'actual'|'estimate'|'derived'|'live'|'sighting'|null)} [input.basis]
 *   what kind of time `actualTimeSec` is (board-delay.js).
 * @param {('lower'|'upper'|null)} [input.bound]  the true delay is at least / at most this.
 * @param {boolean} [input.pastDue]  a not-yet-operated row whose best time has passed.
 * @returns {{kind:'none'}|{kind:'delta',minutes:number,text:string,title:string,basis?:string,bound?:string}|{kind:'risk',risk:object}}
 */
export function delayCell({ statusKey, presumed, schedTimeSec, actualTimeSec, hasRealTime, derivedActual = false, dir, risk, basis = null, bound = null, pastDue = false }) {
  const isTerminal =
    statusKey === 'canceled' || statusKey === 'canceled_uncertain' || statusKey === 'diverted';
  if (isTerminal) return { kind: 'none' };

  const hasOperated = statusKey === 'departed' || statusKey === 'enroute' || statusKey === 'landed';
  const measurable =
    Boolean(actualTimeSec && schedTimeSec) &&
    !derivedActual &&
    isPlausibleDelta(actualTimeSec, schedTimeSec, { estimate: !hasRealTime });
  const minutes = measurable ? Math.round((actualTimeSec - schedTimeSec) / 60) : null;

  // A floor below the noise line, or a ceiling on a row that has not operated, says nothing.
  const boundSays =
    bound === 'lower' ? minutes !== null && minutes > ACTUAL_LINE_THRESHOLD_MINUTES
      : bound === 'upper' ? minutes !== null && hasOperated
        : true;
  const isFact = minutes !== null && ((hasOperated && !presumed) || minutes > ACTUAL_LINE_THRESHOLD_MINUTES);
  if (isFact && boundSays) {
    const prefix = bound === 'lower' ? '≥' : bound === 'upper' ? '≤' : '';
    return {
      kind: 'delta',
      minutes,
      text: `${prefix}${formatDelayMinutes(minutes)}`,
      title: delayTitle({ basis, bound, hasRealTime, dir }),
      ...(basis ? { basis } : {}),
      ...(bound ? { bound } : {}),
    };
  }
  if (risk && !pastDue) return { kind: 'risk', risk };
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
 * A row's React key: ident + scheduled time + route + tail.
 *
 * `${ident}-${scheduledTime}` alone was not unique: the EWR departures board listed UA3772 twice
 * at 09:21 (one to BNA on N68891, one with no destination on N225UA), the two rows shared a key,
 * and a stale row survived a hub switch (v1.11.3). The board index is NOT part of it — that
 * would remount every row on every re-sort; `uniqueRowKeys()` adds a suffix only to a row that
 * still collides.
 */
function scheduleRowKey(flight, ident, schedTimeSec, reg, index) {
  const orig = flight?.airport?.origin?.code?.iata || '';
  const dest = flight?.airport?.destination?.code?.iata || '';
  return `${ident}-${schedTimeSec ?? `i${index}`}-${orig}-${dest}-${reg || ''}`;
}

/**
 * Make every row key on a board unique: the first row with a key keeps it, a later identical
 * one (a true duplicate the provider sent twice) gets `~2`, `~3`, …
 *
 * @param {Array<{key: string}>} models  in board order.
 * @returns {Array<{key: string}>} the same array when nothing collided.
 */
export function uniqueRowKeys(models) {
  if (!Array.isArray(models)) return models;
  const seen = new Map();
  let out = null;
  models.forEach((model, i) => {
    const count = (seen.get(model.key) || 0) + 1;
    seen.set(model.key, count);
    if (count === 1) {
      if (out) out.push(model);
      return;
    }
    if (!out) out = models.slice(0, i);
    let key = `${model.key}~${count}`;
    while (seen.has(key)) key = `${key}~`;
    seen.set(key, 1);
    out.push({ ...model, key });
  });
  return out || models;
}

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
    expressByReg = {},
    special = new Map(),
    faaContext = null,
    hubOtp = {},
    weatherOpsByHub = {},
    iropsHubRates = {},
    effectiveTime = 0,
  } = ctx;

  const ident = flight?.identification?.number?.default || '—';
  // Which time the delay is measured to, and what kind of time it is (board-delay.js). Direction-
  // aware: on an arrivals board a real DEPARTURE says nothing about the arrival time being
  // compared, so an estimated arrival is still titled (and bounded) as an estimate.
  const evidence = boardTimeEvidence(flight, dir, rawStatus);
  const { schedTimeSec, actualTimeSec, hasRealTime, derivedActual } = evidence;

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
    derivedActual,
    dir,
    risk,
    basis: evidence.basis,
    bound: evidence.bound,
    // Not a future flight: its best time has passed, or the live feed has it airborne or landed.
    pastDue: rawStatus?.pastDue === true || rawStatus?.seenLanded === true || rawStatus?.live === true,
  });

  return {
    ident,
    // v1.12.1: what the Flight column should PRINT — the provider's letter suffix stripped
    // ("UA526H" → "UA526"). `ident` stays raw: it is the row key, the watch target, the deep link.
    identDisplay: displayFlightIdent(ident),
    key: scheduleRowKey(flight, ident, schedTimeSec, reg, index),
    raw: flight,
    timeText: formatSchedTime(schedTimeSec, timeZone),
    dateChip: dateChipLabel(schedTimeSec, dayStartSec, timeZone),
    // A bound is not a time the flight did anything at; the "→ HH:MM" line would claim one.
    actualLine: evidence.bound
      ? null
      : actualDeltaLine({ schedTimeSec, actualTimeSec, derivedActual, estimate: !hasRealTime, timeZone }),
    derivedActual,
    // v1.12.1: the provider's actual on the board's side is a RUNWAY time (wheels-up on departures,
    // touchdown on arrivals) — it sent no distinct gate time, so the delay includes taxi-out (or
    // stops before taxi-in). The delay cell's title says so; the UI may mark it.
    actualFromRunway: evidence.actualFromRunway,
    routeLine,
    routeSub,
    acCode,
    acText,
    acShort,
    reg,
    regFromLive: isRegFromLiveFeed(flight, reg),
    gate: terminalGateCell(flight, dir),
    status,
    fleet: fleetCell(reg, fleetByReg, starlinkTails, expressByReg),
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
