// ═══ MY FLIGHTS — CARD MODEL, DOM-FREE ═══
// Everything the My Flights card decides before it decides how to look: which status
// chip, what the countdown says on this tick, which route the card is about, what the
// gate cells read, and what a quick-add box should do with what was typed.
//
// Extracted from src/dashboard/main.js (:5560-5822 buildMyFlightCard, :5823-5856
// updateMyFlightsCountdowns, :5363 MY_FLIGHTS_FAIL_TERMINAL, :6706-6741 quick-add +
// placeholder rotator). The classification of the flight itself stays in
// ./flight-status-resolve.js; this module is what the card does with that answer.

import { AIRPORT_COORDS } from './airports.js';
import { haversineNm } from './geo.js';
import { isOnGround } from './flight-phase.js';
import { getUnitedTerminal } from './hub-terminals.js';

/**
 * Consecutive /api/flight-times misses after which a card stops saying "LOADING…"
 * and admits it cannot get the status (F008). The poll keeps retrying underneath,
 * so a recovered feed clears the state on its own.
 */
export const MY_FLIGHTS_FAIL_TERMINAL = 2;

/** The quick-add box's rotating hints — 4 s apart, paused while it has focus. */
export const MY_FLIGHTS_PLACEHOLDERS = [
  'Add a flight (e.g. UA 1234)',
  'Try a tail number (N37502)',
];

/** Boarding opens 30 minutes before the gate-departure time the card counts down to. */
export const BOARDING_LEAD_MS = 30 * 60000;

/**
 * "2h 14m" / "37m" / "0m" — the coarse countdown the card shows.
 * @param {number} ms
 * @returns {string}
 */
export function formatCountdown(ms) {
  if (ms <= 0) return '0m';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * The status chip for a resolved flight state.
 *
 * `tone` is a NAME, never a colour: the rendering layer owns the palette, and every
 * tone here is paired with the word beside it so the state never rides on colour alone.
 *
 * @param {string} status  as `resolveFlightStatus()` returns it.
 * @returns {{text: string, tone: string}}
 */
export function myFlightStatusChip(status) {
  switch (status) {
    case 'cancelled': return { text: 'CANCELLED', tone: 'cancelled' };
    case 'diverted': return { text: 'DIVERTED', tone: 'diverted' };
    case 'landed': return { text: 'LANDED', tone: 'landed' };
    case 'en-route': return { text: 'EN ROUTE', tone: 'enroute' };
    case 'departed': return { text: 'DEPARTED', tone: 'departed' };
    case 'delayed': return { text: 'DELAYED', tone: 'delayed' };
    default: return { text: 'SCHEDULED', tone: 'scheduled' };
  }
}

/**
 * The chip shown while there is no usable flight-times payload.
 *
 * @param {number} failures  consecutive misses for this flight.
 * @returns {{text: string, tone: string, terminal: boolean}}
 */
export function myFlightPendingChip(failures) {
  const terminal = (failures || 0) >= MY_FLIGHTS_FAIL_TERMINAL;
  return terminal
    ? { text: 'STATUS UNAVAILABLE', tone: 'unavailable', terminal: true }
    : { text: 'LOADING...', tone: 'unavailable', terminal: false };
}

/**
 * What the countdown line reads at `now`.
 *
 * Scheduled/delayed flights count to BOARDING first and then to departure; airborne
 * ones count to arrival. Cancelled and diverted flights get no clock at all — a
 * countdown to a departure that will not happen is worse than silence.
 *
 * @param {{status?: string, depISO?: string, arrISO?: string, now?: number}} input
 * @returns {{text: string, tone: string}} `tone` is '' | 'departed' | 'landed'.
 */
export function myFlightCountdown(input) {
  const { status = '', depISO = '', arrISO = '', now = Date.now() } = input || {};

  if (status === 'cancelled' || status === 'diverted') return { text: '', tone: 'landed' };
  if (status === 'landed') return { text: 'Landed', tone: 'landed' };

  if (status === 'en-route' || status === 'departed') {
    if (!arrISO) return { text: '', tone: 'departed' };
    const diff = new Date(arrISO).getTime() - now;
    if (!Number.isFinite(diff)) return { text: '', tone: 'departed' };
    return { text: diff > 0 ? `${formatCountdown(diff)} to arrival` : 'Arriving', tone: 'departed' };
  }

  if (!depISO) return { text: '', tone: '' };
  const diff = new Date(depISO).getTime() - now;
  if (!Number.isFinite(diff)) return { text: '', tone: '' };

  if (status === 'delayed') {
    return { text: diff > 0 ? `${formatCountdown(diff)} to departure` : 'Expected to depart', tone: '' };
  }
  if (diff <= 0) return { text: 'Expected to depart', tone: '' };
  const boarding = diff - BOARDING_LEAD_MS;
  return {
    text: boarding > 0 ? `${formatCountdown(boarding)} to boarding` : `${formatCountdown(diff)} to departure`,
    tone: '',
  };
}

/**
 * The two gate-time strings the countdown ticks against.
 *
 * Gate times, never runway times: the delay-at-runway incident (v1.7.7) came from
 * measuring the wrong pair. Arrival falls back to the landing triple only because an
 * arrival gate time is frequently absent while the landing estimate is not.
 *
 * @param {Object|null|undefined} td  an /api/flight-times payload.
 * @returns {{depISO: string, arrISO: string}}
 */
export function myFlightTimes(td) {
  return {
    depISO: td?.departure?.gate?.estimated || td?.departure?.gate?.scheduled || '',
    arrISO:
      td?.arrival?.gate?.estimated ||
      td?.arrival?.gate?.scheduled ||
      td?.arrival?.landing?.estimated ||
      td?.arrival?.landing?.scheduled ||
      '',
  };
}

/**
 * Minutes added to the in-air time for the approach, landing roll and taxi to the gate.
 * Straight-line distance ÷ current groundspeed is the airborne part only; the gate time
 * the card counts to is later than that. (delay-risk.js's inbound model uses +15 for a
 * turnaround estimate; a passenger countdown wants the tighter figure.)
 */
export const LIVE_ETA_ALLOWANCE_MIN = 10;

/** An ADB/provider arrival estimate further than this from the live ETA is ignored. */
export const LIVE_ETA_CONTRADICTION_MIN = 30;

/** Below this groundspeed a "live" position is a taxi or a stale fix, not a flight. */
const LIVE_ETA_MIN_KT = 80;

/**
 * The gate-arrival time the live feed implies: remaining great-circle distance to the
 * destination ÷ current groundspeed, plus `LIVE_ETA_ALLOWANCE_MIN`.
 *
 * `Flight.spd` is metres/second (src/lib/feed-health.js converts FR24's knots on parse).
 * Returns null whenever the answer would be a guess: on the ground, at taxi speed, or
 * with no coordinates for the destination.
 *
 * @param {Object|null|undefined} liveFlight  a live-feed row.
 * @param {string} destIata
 * @param {number} [nowMs]
 * @returns {{etaISO: string, remainingNm: number, groundspeedKt: number}|null}
 */
export function liveArrivalEstimate(liveFlight, destIata, nowMs = Date.now()) {
  if (!liveFlight || liveFlight.onGround) return null;
  const dest = AIRPORT_COORDS[String(destIata || '').toUpperCase()];
  if (!dest) return null;
  const groundspeedKt = (Number(liveFlight.spd) || 0) * 1.944;
  if (!(groundspeedKt >= LIVE_ETA_MIN_KT)) return null;
  const { lat, lon } = liveFlight;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const remainingNm = haversineNm(lat, lon, dest.lat, dest.lon);
  const minutes = (remainingNm / groundspeedKt) * 60 + LIVE_ETA_ALLOWANCE_MIN;
  return { etaISO: new Date(nowMs + minutes * 60000).toISOString(), remainingNm, groundspeedKt };
}

/**
 * While the flight is airborne, live data wins (owner decision, live audit Sep 28 2026 D1).
 *
 * Returns a NEW payload whose `arrival.gate.estimated` is the live ETA — labelled
 * `arrival.etaSource = 'live'` — when the provider's estimate (or, lacking one, the
 * schedule) is more than `LIVE_ETA_CONTRADICTION_MIN` away from it. Within that margin the
 * provider's gate estimate stands: it knows the gate, we only know the sky. The input is
 * never mutated (it is the flight-times cache entry), and anything that is not an
 * airborne, un-landed leg comes back as the same object.
 *
 * Both the countdown (`myFlightTimes`) and the connection checker
 * (`computeConnectionRisk`) read `arrival.gate.estimated`, so reconciling here fixes both.
 *
 * @template T
 * @param {T} td  an /api/flight-times payload (or null).
 * @param {Object|null|undefined} liveFlight  the feed row `findLiveFlight()` returned.
 * @param {number} [nowMs]
 * @returns {T}
 */
export function reconcileLiveArrival(td, liveFlight, nowMs = Date.now()) {
  /** @type {any} */
  const t = td;
  if (!t || t.success === false || t.cancelled) return td;
  return /** @type {T} */ (reconcileImpl(t, liveFlight, nowMs));
}

/**
 * Is this live-feed row the leg the payload describes? A through flight number flies two legs
 * (UA1872 MCO→IAH→MSP); the feed row for the first must never drive the second's card (phone QA
 * Oct 4 2026: "IAH→MSP, 2h 9m, ETA from live position" while the aircraft cruised MCO→IAH). Codes
 * missing on either side never veto.
 *
 * @param {Object|null|undefined} liveFlight
 * @param {string} origin
 * @param {string} dest
 * @returns {boolean}
 */
export function liveFlightMatchesLeg(liveFlight, origin, dest) {
  if (!liveFlight) return false;
  const lo = String(liveFlight.origin || '').toUpperCase();
  const ld = String(liveFlight.dest || '').toUpperCase();
  if (lo && origin && lo !== String(origin).toUpperCase()) return false;
  if (ld && dest && ld !== String(dest).toUpperCase()) return false;
  return true;
}

/** On the ground within this distance of an airport = at that airport. */
const AT_AIRPORT_NM = 5;

/**
 * Is a live-feed aircraft on the ground at this airport? (The feed's ground flag or the
 * telemetry's, within 5 nm of the field.)
 *
 * @param {Object|null|undefined} liveFlight
 * @param {string} iata
 * @returns {boolean}
 */
export function onGroundAt(liveFlight, iata) {
  if (!liveFlight || !isOnGround(liveFlight)) return false;
  const apt = AIRPORT_COORDS[String(iata || '').toUpperCase()];
  if (!apt || !Number.isFinite(liveFlight.lat) || !Number.isFinite(liveFlight.lon)) return false;
  return haversineNm(liveFlight.lat, liveFlight.lon, apt.lat, apt.lon) <= AT_AIRPORT_NM;
}

/**
 * The live-feed row for this card's leg, or null — `findLiveFlight()` plus the route check.
 *
 * @param {Array<Object>} flights
 * @param {string} flightNumber
 * @param {Object|null|undefined} td
 * @returns {Object|null}
 */
export function liveFlightForLeg(flights, flightNumber, td) {
  const live = findLiveFlight(flights, flightNumber);
  if (!live || !td || td.success === false) return live;
  return liveFlightMatchesLeg(live, td.origin?.iata, td.destination?.iata) ? live : null;
}

/**
 * The origin to ask /api/flight-times for when the live aircraft is flying a DIFFERENT leg of this
 * flight number than the payload describes — its own origin — else ''. Only an airborne aircraft
 * counts: one on the ground could be anywhere in its day.
 *
 * @param {Object|null|undefined} td
 * @param {Object|null|undefined} liveFlight  findLiveFlight()'s row (not route-checked).
 * @returns {string}
 */
export function liveLegOrigin(td, liveFlight) {
  if (!td || td.success === false || !liveFlight || isOnGround(liveFlight)) return '';
  const lo = String(liveFlight.origin || '').toUpperCase();
  if (!lo) return '';
  return liveFlightMatchesLeg(liveFlight, td.origin?.iata, td.destination?.iata) ? '' : lo;
}

/** @param {any} td @param {any} liveFlight @param {number} nowMs */
function reconcileImpl(td, liveFlight, nowMs) {
  if (!td || td.success === false || td.cancelled) return td;
  if (td.arrival?.gate?.actual || td.arrival?.landing?.actual) return td;
  // Another leg of the same flight number says nothing about this one.
  if (liveFlight && !liveFlightMatchesLeg(liveFlight, td.origin?.iata, td.destination?.iata)) return td;
  const dest = td.destination?.iata || liveFlight?.dest || '';
  // On the ground at the destination: it has landed, whatever a stale provider estimate says
  // (phone QA Oct 4 2026: "2h 21m to arrival" on UA2059 as it touched down at ORD).
  if (liveFlight && onGroundAt(liveFlight, dest) && (td.departure?.gate?.actual || td.departure?.takeoff?.actual || /depart|route|air/i.test(String(td.status || '')))) {
    const nowISO = new Date(nowMs).toISOString();
    return {
      ...td,
      status: 'landed',
      arrival: {
        ...td.arrival,
        gate: { scheduled: '', actual: '', ...(td.arrival?.gate || {}), estimated: nowISO },
        etaSource: 'live-ground',
        providerEstimate: td.arrival?.gate?.estimated || '',
      },
    };
  }
  const live = liveArrivalEstimate(liveFlight, dest, nowMs);
  if (!live) return td;
  const current = td.arrival?.gate?.estimated || td.arrival?.gate?.scheduled || '';
  const currentMs = Date.parse(current);
  if (Number.isFinite(currentMs) && Math.abs(currentMs - Date.parse(live.etaISO)) <= LIVE_ETA_CONTRADICTION_MIN * 60000) {
    return td;
  }
  return {
    ...td,
    arrival: {
      ...td.arrival,
      gate: { scheduled: '', actual: '', ...(td.arrival?.gate || {}), estimated: live.etaISO },
      etaSource: 'live',
      providerEstimate: td.arrival?.gate?.estimated || '',
    },
  };
}

/**
 * Which city pair this card is about.
 *
 * The stored watch entry wins (it is what the visitor watched), and the flight-times
 * payload fills the gaps left by a manual add or a deep link. `needsBackfill` says the
 * stored route should be rewritten now that both ends are known — the caller persists
 * it, because writing storage during a render is how you get an infinite loop.
 *
 * @param {string|null|undefined} watchedRoute  e.g. 'ORD→DEN'.
 * @param {Object|null|undefined} td
 * @returns {{origCode: string, destCode: string, route: string, needsBackfill: boolean}}
 */
export function resolveMyFlightRoute(watchedRoute, td) {
  const parts = String(watchedRoute || '').split(/[→\-]/);
  const origCode = (parts[0] || '').trim() || td?.origin?.iata || '';
  const destCode = (parts[1] || '').trim() || td?.destination?.iata || '';
  const route = origCode && destCode ? `${origCode}→${destCode}` : String(watchedRoute || '');
  const needsBackfill = Boolean(
    origCode && destCode && (!watchedRoute || String(watchedRoute).includes('?')),
  );
  return { origCode, destCode, route, needsBackfill };
}

/**
 * The Origin/Dest gate cells.
 *
 * `getUnitedTerminal()` fills a terminal the provider did not publish, which is most
 * of the time; an em dash is the honest answer when we have neither.
 *
 * @param {Object|null|undefined} td
 * @returns {{origin: string, destination: string}}
 */
export function myFlightGateLabels(td) {
  if (!td || td.success === false) return { origin: '—', destination: '—' };
  const oIata = td.origin?.iata || '';
  const dIata = td.destination?.iata || '';
  const oTerm = td.origin?.terminal || getUnitedTerminal(oIata, oIata, dIata);
  const dTerm = td.destination?.terminal || getUnitedTerminal(dIata, oIata, dIata);
  // 'T2' for a numbered terminal; a lettered one is spelled out — 'TG' read as a typo (F18).
  const term = (t) => (/^\d+$/.test(String(t)) ? `T${t}` : `Terminal ${t}`);
  const label = (t, gate) => {
    if (gate) return t ? `${term(t)} Gate ${gate}` : `Gate ${gate}`;
    return t ? term(t) : '—';
  };
  return {
    origin: label(oTerm, td.origin?.gate),
    destination: label(dTerm, td.destination?.gate),
  };
}

/** '3F/20J/48W/183Y' from the fleet row's seat map, or its config string. */
export function seatConfigString(aircraft) {
  if (!aircraft) return '';
  if (aircraft.seats) {
    return Object.entries(aircraft.seats)
      .map(([cls, count]) => `${count}${cls}`)
      .join('/');
  }
  return aircraft.c || '';
}

const TAIL_RE = /^N\d{1,5}[A-Z]{0,2}$/;

/**
 * What the quick-add box should do with what was typed.
 *
 * Two things the shipped box got wrong, both caught by its own placeholder:
 *  - it normalised everything to `UA<n>`, turning the tail number the rotating hint
 *    advertises ("Try a tail number (N37502)") into the nonsense flight `UAN37502`.
 *    A tail is routed to the aircraft dialog instead, so the hint tells the truth.
 *  - `UAL1234` passed its `startsWith('UA')` guard untouched and went to
 *    /api/flight-times as an ICAO callsign it cannot resolve. The ICAO spelling is
 *    folded to IATA here, the same way `?flight=` and the FR24 lookup already did.
 *
 * @param {string} raw
 * @returns {{kind: 'flight', flight: string}|{kind: 'tail', reg: string}|null}
 */
export function parseQuickAdd(raw) {
  const value = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!value) return null;
  if (TAIL_RE.test(value)) return { kind: 'tail', reg: value };
  if (/^UAL\d/.test(value)) return { kind: 'flight', flight: `UA${value.slice(3)}` };
  const flight = value.startsWith('UA') ? value : `UA${value}`;
  return { kind: 'flight', flight };
}

/**
 * The live-feed row for a watched flight number, if it is airborne right now.
 *
 * Matches `flightIATA` first and the ICAO callsign second — the feed publishes one or
 * the other depending on the aircraft, and a watch entry only ever holds the IATA form.
 *
 * @param {Array<Object>} flights
 * @param {string} flightNumber
 * @returns {Object|null}
 */
export function findLiveFlight(flights, flightNumber) {
  if (!flightNumber) return null;
  const digits = flightNumber.replace(/\D/g, '');
  const callsign = `UAL${digits}`;
  return (
    (flights || []).find((f) => f.flightIATA === flightNumber || f.callsign === callsign) || null
  );
}

/**
 * "Where's My Plane?" — the same airframe, inbound to where we are leaving from.
 *
 * Only meaningful while OUR flight is still on the ground: once we are airborne the
 * question has answered itself, and the tail cannot be two places at once.
 *
 * @param {Array<Object>} flights  the live feed.
 * @param {string} reg  our registration, dashes already stripped.
 * @param {string} flightNumber  our flight, so the search never returns us.
 * @param {string} origCode  our departure airport.
 * @param {boolean} ownFlightAirborne
 * @returns {Object|null}
 */
export function findInboundAircraft(flights, reg, flightNumber, origCode, ownFlightAirborne) {
  if (!reg || ownFlightAirborne) return null;
  return (
    (flights || []).find(
      (f) =>
        f.reg &&
        f.reg.replace('-', '') === reg &&
        f.flightIATA !== flightNumber &&
        f.dest === origCode &&
        !f.onGround,
    ) || null
  );
}

/**
 * The delay-risk model's `inboundFlight` input: the aircraft this flight is waiting for,
 * with where it is and the conditions where it came from (audit F134 — the React port
 * stopped passing it, so the "inbound turnaround" signal never scored).
 *
 * Only while there is a schedule to measure the turn against and our own flight is not
 * already airborne — once it is, the "inbound" in the feed is a later leg.
 *
 * @param {{flights?: Array<Object>, reg?: string, flightNumber: string, origCode: string,
 *   ownFlightAirborne?: boolean, hasTimes?: boolean,
 *   weatherOpsByHub?: Record<string, {level?: unknown}>,
 *   faaIndex?: Record<string, {groundStop?: unknown, groundDelay?: unknown}>}} input
 * @returns {Object|null}
 */
export function buildInboundRiskContext(input) {
  const { flights, reg, flightNumber, origCode, ownFlightAirborne, hasTimes, weatherOpsByHub, faaIndex } =
    input || {};
  if (!hasTimes) return null;
  const inbound = findInboundAircraft(flights, reg, flightNumber, origCode, Boolean(ownFlightAirborne));
  if (!inbound) return null;
  const weather = weatherOpsByHub?.[inbound.origin];
  const faa = faaIndex?.[inbound.origin];
  return {
    origin: inbound.origin,
    lat: inbound.lat,
    lon: inbound.lon,
    spd: inbound.spd,
    alt: inbound.alt,
    vr: inbound.vr,
    acType: inbound.acType,
    originWeatherLevel: weather?.level || '',
    originFaaGroundStop: Boolean(faa?.groundStop),
    originFaaGroundDelay: Boolean(faa?.groundDelay),
  };
}
