// ═══ MY FLIGHTS — CARD MODEL, DOM-FREE ═══
// Everything the My Flights card decides before it decides how to look: which status
// chip, what the countdown says on this tick, which route the card is about, what the
// gate cells read, and what a quick-add box should do with what was typed.
//
// Extracted from src/dashboard/main.js (:5560-5822 buildMyFlightCard, :5823-5856
// updateMyFlightsCountdowns, :5363 MY_FLIGHTS_FAIL_TERMINAL, :6706-6741 quick-add +
// placeholder rotator). The classification of the flight itself stays in
// ./flight-status-resolve.js; this module is what the card does with that answer.

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
  return {
    origin: td.origin?.gate ? `T${oTerm || '?'} Gate ${td.origin.gate}` : oTerm ? `T${oTerm}` : '—',
    destination: td.destination?.gate
      ? `T${dTerm || '?'} Gate ${td.destination.gate}`
      : dTerm
        ? `T${dTerm}`
        : '—',
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
