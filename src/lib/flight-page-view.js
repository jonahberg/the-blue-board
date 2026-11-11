// ═══ FLIGHT PAGE — WHAT THE PAGE PAINTS ═══
// /api/flight's payload → everything src/scripts/flight-page.ts writes into the shell: the header
// lines, the verdict, the trip block (airports, progress, timeline), the 30-day record, the
// aircraft card and whether the AI read is offered. Every status, delay and time phrase comes from
// the board's own logic through flight-verdict.js; this module only arranges it.
//
// Two rules hold everywhere here:
//   - a step, a time or a number is shown only when the data has it (no invented timeline);
//   - an estimate is labelled as one, and a position from the clock says it is from the clock.
//
// No DOM, no clock (nowSec is a parameter), so the page and the tests see the same thing.

import { AIRPORT_COORDS, cityFor } from './airports.js';
import { CABIN_LABELS, HISTORY_DAY_KINDS, historyWords, inboundLeg, shortDate, summarizeHistory, tailLegsView } from './flight-page.js';
import { dayPhrase, flightLegState, flightVerdict, formatLocalTime, minutesPhrase, placeName } from './flight-verdict.js';
import { haversineNm } from './geo.js';
import { liveArrivalEstimate } from './my-flights.js';
import { ACTUAL_LINE_THRESHOLD_MINUTES } from './schedule-row-model.js';
import { SEAT_BAR_COLORS } from './special-aircraft.js';
import { airportTz } from './time-format.js';
import { formatDataAge, dataAgeSeverity } from './data-age.js';

/** Tone name → text class (DESIGN.md content tokens; colour always beside words). */
export const TONE_TEXT = Object.freeze({
  ok: 'text-bb-ok',
  warn: 'text-bb-warn',
  bad: 'text-destructive',
  info: 'text-bb-info',
});

/** A day square's classes by tone. The glyph inside and the screen-reader line carry the meaning. */
export const DAY_CLASSES = Object.freeze({
  ok: 'border-bb-ok/40 bg-bb-ok/20 text-bb-ok',
  warn: 'border-bb-warn/50 bg-bb-warn/20 text-bb-warn',
  'warn-soft': 'border-dashed border-bb-warn/60 text-bb-warn',
  bad: 'border-destructive/50 bg-destructive/20 text-destructive',
  none: 'border-border text-muted-foreground',
});

/** Timeline step state → the top border of the step. */
export const STEP_CLASSES = Object.freeze({
  done: 'border-primary',
  now: 'border-bb-ok',
  next: 'border-border',
});

/** States in which the board would still show a delay PREDICTION (useBoardModel computeRisk). */
const PREDICTABLE_STATES = new Set(['scheduled', 'delayed', 'boarding']);

const REAL = new Set(['gate', 'actual', 'runway']);

/** "Boeing 767-300ER" / "Airbus A321neo" / the type as given. */
export function aircraftTypeName(type) {
  const t = String(type || '').trim();
  if (!t) return '';
  if (/^7[0-9]7/.test(t)) return `Boeing ${t}`;
  if (/^A3\d\d/.test(t)) return `Airbus ${t}`;
  return t;
}

/** "Chicago O'Hare to London Heathrow · Tue, Nov 10" */
function routeLine(row) {
  const o = row.airport?.origin;
  const d = row.airport?.destination;
  const sched = Number(row.time?.scheduled?.departure) || Number(row.time?.real?.departure) || 0;
  const tz = airportTz(o?.code?.iata) || 'UTC';
  const date = sched
    ? new Date(sched * 1000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz })
    : '';
  return [`${placeName(o)} to ${placeName(d)}`, date].filter(Boolean).join(' · ');
}

/** The departure side's best time, in words: "Left 4:05 PM CST" / "Expected 4:45 PM CST" / "Scheduled 4:00 PM CST". */
function sideTime(ev, schedSec, tz, dep) {
  if (ev?.actualTimeSec > 0) {
    if (ev.hasRealTime && ev.basis === 'sighting') {
      return ev.bound === 'upper' && dep ? `Left by ${formatLocalTime(ev.actualTimeSec, tz)}` : schedSec ? `Scheduled ${formatLocalTime(schedSec, tz)}` : '';
    }
    if (ev.hasRealTime) {
      const word = dep
        ? { gate: 'Left', runway: 'Took off', actual: 'Left' }[ev.basis] || 'Left'
        : { gate: 'At gate', runway: 'Touched down', actual: 'Landed' }[ev.basis] || 'Landed';
      return `${word} ${formatLocalTime(ev.actualTimeSec, tz)}`;
    }
    return `Expected ${formatLocalTime(ev.actualTimeSec, tz)}`;
  }
  return schedSec ? `Scheduled ${formatLocalTime(schedSec, tz)}` : '';
}

/**
 * The progress track, only while the flight is in the air: by the live position when the page
 * has one for this leg (distance flown over the whole route), else by the clock (time elapsed over
 * the expected block) — and the note says which.
 *
 * @param {any} leg  flightLegState() result.
 * @param {any} row
 * @param {number} nowSec
 * @param {any} [live]  a live-feed row for this leg (src/lib/feed-health.js shape: alt m, spd m/s).
 */
export function progressView(leg, row, nowSec, live = null) {
  if (leg.state !== 'in-air') return null;
  const oCode = String(row.airport?.origin?.code?.iata || '').toUpperCase();
  const dCode = String(row.airport?.destination?.code?.iata || '').toUpperCase();
  const o = AIRPORT_COORDS[oCode];
  const d = AIRPORT_COORDS[dCode];
  if (live && o && d && Number.isFinite(live.lat) && Number.isFinite(live.lon) && !live.onGround) {
    const flown = haversineNm(o.lat, o.lon, live.lat, live.lon);
    const togo = haversineNm(live.lat, live.lon, d.lat, d.lon);
    const fraction = flown + togo > 0 ? Math.min(0.99, Math.max(0.01, flown / (flown + togo))) : 0.5;
    const parts = [];
    const altFt = Math.round((Number(live.alt) || 0) * 3.28084 / 100) * 100;
    if (altFt > 0) parts.push(`${altFt.toLocaleString('en-US')} ft`);
    const kt = Math.round((Number(live.spd) || 0) * 1.944);
    if (kt > 0) parts.push(`${kt} kts`);
    parts.push(`${Math.round(togo * 1.15078).toLocaleString('en-US')} mi to go`);
    const eta = liveArrivalEstimate(live, dCode, nowSec * 1000);
    if (eta) {
      const mins = Math.max(0, Math.round((Date.parse(eta.etaISO) / 1000 - nowSec) / 60));
      parts.push(`about ${mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`} left`);
    }
    const note = `${parts.join(' · ')}${live.positionEstimated ? ' · position projected by Flightradar24 (out of receiver range)' : ' · live position'}`;
    return { fraction, source: 'live', note };
  }
  const depSec = leg.depEv.hasRealTime && leg.depEv.basis !== 'sighting' ? leg.depEv.actualTimeSec : 0;
  const arrSec = leg.arrEv.actualTimeSec > 0 && !leg.arrEv.hasRealTime ? leg.arrEv.actualTimeSec : Number(row.time?.scheduled?.arrival) || 0;
  if (!(depSec > 0) || !(arrSec > depSec)) return null;
  const fraction = Math.min(0.97, Math.max(0.03, (nowSec - depSec) / (arrSec - depSec)));
  return { fraction, source: 'clock', note: 'Position estimated from the clock, not a live fix' };
}

/** @typedef {{at: number, time: string, label: string, state: 'done'|'now'|'next'}} Step */

/**
 * The timeline: only the steps the data supports, in time order.
 *
 * @param {any} leg  flightLegState().
 * @param {any} row
 * @param {number} nowSec
 * @param {{inbound?: ReturnType<typeof inboundLeg>, live?: any}} [extra]
 * @returns {Step[]}
 */
export function timelineSteps(leg, row, nowSec, { inbound = null, live = null } = {}) {
  const steps = [];
  const oCode = row.airport?.origin?.code?.iata;
  const dCode = row.airport?.destination?.code?.iata;
  const oTz = airportTz(oCode);
  const dTz = airportTz(dCode);
  const sched = row.time?.scheduled || {};
  const schedDep = Number(sched.departure) || 0;
  const schedArr = Number(sched.arrival) || 0;
  const { depEv, arrEv, state } = leg;
  const push = (at, tz, label, kind) => {
    if (!(at > 0)) return;
    const time = formatLocalTime(at, tz);
    const day = dayPhrase(at, tz, nowSec);
    steps.push({ at, time, day, label, kind });
  };

  if (inbound) {
    const city = cityFor(inbound.from) || inbound.from;
    const tz = airportTz(oCode);
    if (inbound.arrMin && REAL.has(inbound.arrBasis)) push(inbound.arrMin * 60, tz, `Aircraft arrived from ${city} (${inbound.flight})`, 'event');
    else if (inbound.arrMin && inbound.arrBasis === 'estimate') push(inbound.arrMin * 60, tz, `Aircraft due in from ${city} (${inbound.flight}), estimated`, 'plan');
    else if (inbound.depMin && REAL.has(inbound.depBasis)) push(inbound.depMin * 60, airportTz(inbound.from), `Aircraft left ${city} (${inbound.flight})`, 'event');
  }

  const gate = row.airport?.origin?.info?.gate;
  const terminal = row.airport?.origin?.info?.terminal;
  const where = [terminal ? `Terminal ${terminal}` : '', gate ? `gate ${gate}` : ''].filter(Boolean).join(', ');
  if (state === 'canceled' || state === 'likely-canceled') {
    push(schedDep, oTz, state === 'canceled' ? 'Scheduled departure, canceled' : 'Scheduled departure, likely canceled (unconfirmed)', 'plan');
    return finishSteps(steps);
  }
  push(schedDep, oTz, `Scheduled departure${where ? `, ${where}` : ''}`, 'plan');

  if (depEv.hasRealTime && depEv.actualTimeSec > 0 && depEv.basis !== 'sighting') {
    const delta = schedDep ? Math.round((depEv.actualTimeSec - schedDep) / 60) : null;
    const how = delta === null || Math.abs(delta) <= ACTUAL_LINE_THRESHOLD_MINUTES ? 'on time' : delta > 0 ? `${minutesPhrase(delta)} late` : `${minutesPhrase(delta)} early`;
    const word = { gate: 'Left the gate', runway: 'Took off', actual: 'Departed' }[depEv.basis] || 'Departed';
    push(depEv.actualTimeSec, oTz, `${word}, ${how}`, 'event');
  } else if (depEv.basis === 'sighting' && depEv.bound === 'upper') {
    push(depEv.actualTimeSec, oTz, 'In the air by this time (live feed)', 'event');
  } else if (depEv.basis === 'estimate' && depEv.actualTimeSec > 0 && Math.abs(depEv.actualTimeSec - schedDep) > ACTUAL_LINE_THRESHOLD_MINUTES * 60) {
    push(depEv.actualTimeSec, oTz, 'Expected departure', 'plan');
  }

  if (state === 'in-air') {
    const alt = live && !live.onGround ? Math.round((Number(live.alt) || 0) * 3.28084 / 100) * 100 : 0;
    steps.push({ at: nowSec, time: 'Now', day: '', label: alt > 0 ? `In the air at ${alt.toLocaleString('en-US')} ft` : 'In the air', kind: 'now' });
  }

  const dGate = row.airport?.destination?.info?.gate;
  const dTerminal = row.airport?.destination?.info?.terminal;
  const dWhere = [dTerminal ? `Terminal ${dTerminal}` : '', dGate ? `gate ${dGate}` : ''].filter(Boolean).join(', ');
  if (arrEv.hasRealTime && arrEv.actualTimeSec > 0 && arrEv.basis !== 'sighting') {
    const word = { gate: 'Arrived at the gate', runway: 'Touched down', actual: 'Landed' }[arrEv.basis] || 'Landed';
    push(arrEv.actualTimeSec, dTz, `${word}${dWhere ? `, ${dWhere}` : ''}`, 'event');
  } else if (state === 'landed') {
    if (leg.arr.seenLanded) steps.push({ at: nowSec - 1, time: 'Landed', day: '', label: 'Seen on the ground by the live feed', kind: 'event' });
    else push(schedArr, dTz, 'Scheduled arrival; probably landed, no update since', 'plan');
  } else if (state === 'diverted') {
    push(schedArr, dTz, 'Scheduled arrival (diverted elsewhere)', 'plan');
  } else if (arrEv.actualTimeSec > 0 && ['estimate', 'derived', 'live'].includes(arrEv.basis)) {
    push(arrEv.actualTimeSec, dTz, `Expected arrival${dWhere ? `, ${dWhere}` : ''}`, 'plan');
  } else if (schedArr) {
    push(schedArr, dTz, `Scheduled arrival${dWhere ? `, ${dWhere}` : ''}`, 'plan');
  }
  return finishSteps(steps);
}

/** Time order; an event that happened is `done`, the present moment is `now`, a plan is `next`. */
function finishSteps(steps) {
  steps.sort((a, b) => a.at - b.at);
  // A planned step that an event has already passed (the scheduled departure, once it has left)
  // is history too.
  const lastEventAt = Math.max(0, ...steps.filter((s) => s.kind === 'event' || s.kind === 'now').map((s) => s.at));
  return steps.map((s) => ({
    time: s.day ? `${s.time} ${s.day}` : s.time,
    label: s.label,
    state: s.kind === 'now' ? 'now' : s.kind === 'event' || s.at < lastEventAt ? 'done' : 'next',
  }));
}

/**
 * The 30-day record's view.
 *
 * @param {{origin: string, dest: string, today: string, rows: any[]}|null} history
 */
export function flightHistoryView(history) {
  if (!history?.origin || !history?.dest || !history?.today) return null;
  const summary = summarizeHistory(history.rows || [], history);
  const words = historyWords(summary);
  const days = summary.days.map((d) => {
    const kind = HISTORY_DAY_KINDS[d.kind];
    const detail = d.delayMin !== null && (d.kind === 'on-time' || d.kind === 'late' || d.kind === 'diverted')
      ? d.delayMin > 0 ? `, left ${d.delayMin} min late` : d.delayMin < 0 ? `, left ${-d.delayMin} min early` : ', left on schedule'
      : '';
    const noRecord = d.kind === 'no-data' && !d.recorded ? 'no record' : kind.label;
    return {
      date: d.date,
      kind: d.kind,
      glyph: kind.glyph,
      cls: DAY_CLASSES[kind.tone || 'none'],
      sr: `${shortDate(d.date)}: ${noRecord}${detail}`,
    };
  });
  const key = Object.entries(summary.counts)
    .filter(([, n]) => n > 0)
    .map(([kind, n]) => ({ kind, count: n, label: HISTORY_DAY_KINDS[kind].label, glyph: HISTORY_DAY_KINDS[kind].glyph, cls: DAY_CLASSES[HISTORY_DAY_KINDS[kind].tone || 'none'] }));
  const span = summary.days.length;
  return {
    title: span >= 30 ? 'This flight, last 30 days' : span > 0 ? `This flight, last ${span} day${span === 1 ? '' : 's'}` : 'This flight, last 30 days',
    routeLabel: `${history.origin} → ${history.dest}`,
    stripLabel: span ? `${shortDate(summary.start)} to ${shortDate(summary.end)}, one square per day, oldest first` : '',
    days,
    key,
    ...words,
  };
}

/**
 * The aircraft card's view.
 *
 * @param {any} aircraft  the payload's `aircraft`.
 * @param {{reg: string, rows: any[]}|null} tail
 * @param {{ident: string, schedDepMin: number, origin: string, dest: string}} current
 */
export function aircraftView(aircraft, tail, current) {
  if (!aircraft) {
    return { reg: '', summary: 'Our schedule source has not named the aircraft for this flight yet.', wifi: null, cabins: [], cabinLine: '', legs: [], note: 'Tails are usually assigned a day or two out; the live feed adds one once the aircraft is seen.' };
  }
  const type = aircraftTypeName(aircraft.type);
  const summary = [type, aircraft.total ? `${aircraft.total} seats` : '', aircraft.express && aircraft.operator ? `United Express, flown by ${aircraft.operator}` : '']
    .filter(Boolean)
    .join(' · ') || 'Type not known';
  let wifi = null;
  if (aircraft.starlink) wifi = { text: 'Starlink Wi-Fi', starlink: true };
  else if (aircraft.wifi === 'NO' || aircraft.wifi === 'No') wifi = { text: 'No Wi-Fi', starlink: false };
  else if (aircraft.wifi) wifi = { text: `${aircraft.wifi} Wi-Fi, not Starlink`, starlink: false };
  const seats = aircraft.seats && typeof aircraft.seats === 'object' ? aircraft.seats : {};
  const cabins = Object.entries(seats)
    .filter(([, n]) => Number(n) > 0)
    .map(([code, n]) => ({ code, count: Number(n), label: CABIN_LABELS[code] || code, color: SEAT_BAR_COLORS[code] || 'rgba(100,116,139,.5)' }));
  const legs = tail?.rows?.length ? tailLegsView(tail.rows, current) : [];
  const notes = [];
  if (aircraft.delivered) notes.push(`Delivered ${aircraft.delivered}`);
  if (aircraft.ife) notes.push(`seatback: ${aircraft.ife}`);
  return {
    reg: aircraft.reg || '',
    summary,
    wifi,
    cabins,
    cabinLine: cabins.map((c) => `${c.count} ${c.label}`).join(' · '),
    legs,
    note: notes.length ? `${notes.join(' · ')}. Fleet data as the dashboard shows it.` : 'Fleet data as the dashboard shows it.',
  };
}

/**
 * Everything the page paints.
 *
 * @param {any} payload  /api/flight.
 * @param {number} nowSec
 * @param {{live?: any}} [opts]  a live-feed row for this leg, when the page fetched one.
 */
export function flightPageView(payload, nowSec, { live = null, stableDays = false } = {}) {
  const ident = String(payload?.ident || '');
  const status = payload?.status || 'unavailable';
  const row = status === 'ok' ? payload?.leg?.row || null : null;
  const historyView = flightHistoryView(payload?.history || null);

  if (!row) {
    const verdict = flightVerdict(null, nowSec, { ident });
    let text = verdict.text;
    if (status === 'unavailable') text = `We can't reach our flight data right now. Try again in a minute.`;
    else if (payload?.lastSeen) {
      text = `${text} It last flew ${cityFor(payload.lastSeen.origin) || payload.lastSeen.origin} to ${cityFor(payload.lastSeen.dest) || payload.lastSeen.dest} on ${shortDate(payload.lastSeen.date)}.`;
    }
    return {
      status: status === 'unavailable' ? 'unavailable' : 'not-found',
      ident,
      routeLine: payload?.lastSeen ? `${payload.lastSeen.origin} → ${payload.lastSeen.dest}` : '',
      verdict: { ...verdict, parts: [{ text, tone: null }], text },
      stamp: '',
      note: status === 'unavailable'
        ? ''
        : "We see flights that touch one of United's nine hubs, from yesterday through tomorrow. A number that is not flying then, or flies between two other airports, will not show here.",
      trip: null,
      history: historyView,
      aircraft: null,
      read: null,
      watch: null,
    };
  }

  const leg = flightLegState(row, nowSec);
  const verdict = flightVerdict(row, nowSec, { ident, stableDays });
  const oCode = String(row.airport?.origin?.code?.iata || '');
  const dCode = String(row.airport?.destination?.code?.iata || '');
  const oTz = airportTz(oCode);
  const dTz = airportTz(dCode);
  const sched = row.time?.scheduled || {};
  const schedDepMin = Math.floor((Number(sched.departure) || Number(row.time?.real?.departure) || 0) / 60);
  const inbound = PREDICTABLE_STATES.has(leg.state) || leg.state === 'in-air' || leg.state === 'landed'
    ? inboundLeg(payload?.tail?.rows || [], { origin: oCode, schedDepMin })
    : null;

  const boardAt = Number(payload?.leg?.boardAt) || 0;
  let stamp = '';
  if (boardAt > 0) {
    const age = Math.max(0, nowSec - boardAt);
    const zone = oTz || dTz;
    stamp = `Schedule data as of ${formatLocalTime(boardAt, zone)} · ${formatDataAge(age) === 'just now' ? 'just now' : `${formatDataAge(age)} ago`}`;
    if (dataAgeSeverity(age) !== 'recent') stamp += ' · times may have moved since';
  }

  return {
    status: 'ok',
    ident,
    routeLine: routeLine(row),
    verdict,
    state: leg.state,
    stamp,
    note: '',
    trip: {
      origin: { code: oCode, city: placeName(row.airport?.origin), time: sideTime(leg.depEv, Number(sched.departure) || 0, oTz, true) },
      dest: { code: dCode, city: placeName(row.airport?.destination), time: sideTime(leg.arrEv, Number(sched.arrival) || 0, dTz, false) },
      progress: progressView(leg, row, nowSec, live),
      steps: timelineSteps(leg, row, nowSec, { inbound, live }),
    },
    history: historyView,
    aircraft: aircraftView(payload?.aircraft || null, payload?.tail || null, { ident, schedDepMin, origin: oCode, dest: dCode }),
    // The read explains a delay risk, and the board predicts only a flight that has not left. Once
    // it has, there is nothing to ask for, so the card is not shown at all (an empty box saying
    // "has left" told the reader nothing the verdict had not).
    read: PREDICTABLE_STATES.has(leg.state)
      ? { eligible: true, intro: `Ask for a short explanation of ${ident}'s delay risk, scored the way the board scores it: FAA programs, weather at both ends and how the hub is running right now.` }
      : null,
    // `dep` pins the dashboard's watch to THIS leg (src/lib/watch-link.js), but only before it
    // leaves: a leg already flying or flown is left for the dashboard's own first answer to pin.
    watch: {
      flight: ident,
      route: oCode && dCode ? `${oCode}→${dCode}` : '',
      dep: PREDICTABLE_STATES.has(leg.state) ? Math.floor(Number(sched.departure) || 0) : 0,
    },
    hubForRead: payload?.leg?.hub || null,
    dirForRead: payload?.leg?.dir || 'departures',
  };
}
