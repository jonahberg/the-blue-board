// ═══ FLIGHT PAGE — THE VERDICT SENTENCE ═══
// The one or two plain sentences at the top of /flight/:ident — what a person meeting the flight
// needs — written by code from the board's own status and delay logic, never by a model:
//
//   classifySchedStatus()  (schedule-status.js)  what state each side of the leg is in, by the
//                          provider's word, the live feed's sightings and the clock — run for the
//                          departure AND the arrival, and the state is read off the pair;
//   boardTimeEvidence()    (board-delay.js)      which time each side is measured to and what KIND
//                          of time it is (`basis`) and whether it is only a bound;
//   isPlausibleDelta()     (schedule-plausibility.js)  the board's filter on impossible deltas.
//
// Every time phrase is keyed off that basis, so an estimate can never read as an actual:
//   gate     → "left the gate at" / "arrived at the gate at"
//   runway   → "took off at" / "touched down at"            (the provider sent no gate time)
//   actual   → "left at" / "landed at"                       (a real time of unknown kind)
//   estimate, derived, live → "about"                         (a forecast)
//   sighting → "by" (an upper bound: the feed saw it airborne first), or no time at all for a
//              lower bound, which is a floor and not a moment anything happened
//   presumed → no time at all ("probably", with the scheduled time as the scheduled time)
// A side with no time says nothing about that side.
//
// Thresholds are the board's: a delta of 5 minutes or less is "on time" (the board's noise line,
// ACTUAL_LINE_THRESHOLD_MINUTES), a departure estimate more than 15 minutes late is "Delayed" (the
// classifier's own line for the delayed pill), and the colour of a delay follows the board's delay
// tone (≤ 15 min ok, ≤ 60 warn, above red; delay-format.js). Colour is only ever on the status
// words, and the words carry the meaning alone.
//
// Pure: the clock is a parameter (`nowSec`) so the page, the card image and the tests agree.

import { cityFor } from './airports.js';
import { boardTimeEvidence } from './board-delay.js';
import { delayColorVar } from './delay-format.js';
import { isPlausibleDelta } from './schedule-plausibility.js';
import { ACTUAL_LINE_THRESHOLD_MINUTES, shortAirportName } from './schedule-row-model.js';
import { classifySchedStatus } from './schedule-status.js';
import { airportTz, getTzAbbrev, getTzOffsetLabel } from './time-format.js';

/** A pre-departure estimate this many minutes late is "Delayed" (schedule-status.js ESTIMATED_DELAY_SECONDS). */
export const DELAYED_MIN = 15;

/** @typedef {'ok'|'warn'|'bad'|'info'|null} Tone */
/** @typedef {{text: string, tone?: Tone}} Part */

/** The board's delay tone (delay-format.js delayColorVar), as a tone name. */
export function delayTone(minutes) {
  const colorVar = String(delayColorVar(minutes));
  if (colorVar.includes('red')) return 'bad';
  if (colorVar.includes('yellow')) return 'warn';
  return 'ok';
}

/**
 * "4:15 PM CST" — the airport's own clock, always labelled. An airport whose zone we do not know
 * is printed in UTC and says so, never in the reader's zone as if it were local.
 *
 * @param {number} sec  unix seconds.
 * @param {string} [tz]  IANA zone.
 */
export function formatLocalTime(sec, tz) {
  if (!(Number(sec) > 0)) return '';
  const date = new Date(sec * 1000);
  const zone = tz || 'UTC';
  try {
    const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: zone });
    if (!tz) return `${time} UTC`;
    // London in winter reads "GMT", not the runtime's "GMT+0".
    const label = getTzAbbrev(date, zone) || getTzOffsetLabel(date, zone).replace(/^GMT\+0$/, 'GMT');
    return label ? `${time} ${label}` : `${time} local`;
  } catch {
    return '';
  }
}

const dayKey = (sec, tz) => new Date(sec * 1000).toLocaleDateString('en-CA', { timeZone: tz || 'UTC' });

/**
 * '' for today at that airport, else "tomorrow" / "yesterday" / "on Thu, Nov 12".
 * @param {number} sec @param {string} tz @param {number} nowSec
 */
export function dayPhrase(sec, tz, nowSec) {
  if (!(sec > 0)) return '';
  try {
    const days = Math.round((Date.parse(dayKey(sec, tz)) - Date.parse(dayKey(nowSec, tz))) / 86400e3);
    if (days === 0) return '';
    if (days === 1) return 'tomorrow';
    if (days === -1) return 'yesterday';
    const label = new Date(sec * 1000).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz || 'UTC' });
    return `on ${label}`;
  } catch {
    return '';
  }
}

/** "4:15 PM CST" plus " tomorrow" when the day differs from today at that airport. */
function when(sec, tz, nowSec) {
  const time = formatLocalTime(sec, tz);
  if (!time) return '';
  const day = dayPhrase(sec, tz, nowSec);
  return day ? `${time} ${day}` : time;
}

/** "Chicago O'Hare" / the provider's airport name / the code. */
export function placeName(airport) {
  const iata = String(airport?.code?.iata || '').toUpperCase();
  return cityFor(iata) || shortAirportName(airport) || iata || 'its destination';
}

/** "13 minutes", "1 minute", "1 hour 5 minutes". */
export function minutesPhrase(minutes) {
  const m = Math.abs(Math.round(minutes));
  if (m < 90) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `${h} hour${h === 1 ? '' : 's'}${rest ? ` ${rest} minute${rest === 1 ? '' : 's'}` : ''}`;
}

/** Signed minutes between a measured time and the schedule, or null when the board would not show one. */
function deltaMinutes(ev) {
  if (!ev || ev.derivedActual || !(ev.actualTimeSec > 0) || !(ev.schedTimeSec > 0)) return null;
  if (!isPlausibleDelta(ev.actualTimeSec, ev.schedTimeSec, { estimate: !ev.hasRealTime })) return null;
  return Math.round((ev.actualTimeSec - ev.schedTimeSec) / 60);
}

/** "13 minutes early" / "on time" / "25 minutes late". */
function punctuality(minutes) {
  if (minutes === null) return null;
  if (Math.abs(minutes) <= ACTUAL_LINE_THRESHOLD_MINUTES) return { text: 'on time', tone: 'ok', late: false };
  if (minutes < 0) return { text: `${minutesPhrase(minutes)} early`, tone: 'ok', late: false };
  return { text: `${minutesPhrase(minutes)} late`, tone: delayTone(minutes), late: true };
}

/**
 * The state of one leg, from both sides of the board's classifier.
 *
 * @param {object} row  a board row for the leg (departures and arrivals rows merged, sightings
 *   overlay applied) — the `leg.row` of an /api/flight payload.
 * @param {number} nowSec
 */
export function flightLegState(row, nowSec) {
  const dep = classifySchedStatus(row, 'departures', nowSec);
  const arr = classifySchedStatus(row, 'arrivals', nowSec);
  const depEv = boardTimeEvidence(row, 'departures', dep);
  const arrEv = boardTimeEvidence(row, 'arrivals', arr);
  const keys = [dep.key, arr.key];
  let state;
  if (keys.includes('canceled')) state = 'canceled';
  else if (keys.includes('diverted')) state = 'diverted';
  else if (arr.key === 'landed') state = 'landed';
  else if (arr.key === 'enroute' || dep.key === 'departed' || dep.key === 'enroute') state = 'in-air';
  else if (keys.includes('canceled_uncertain')) state = 'likely-canceled';
  else if (/board/i.test(String(row?.status?.text || '')) || /gate ?closed/i.test(String(row?.status?.text || ''))) state = 'boarding';
  else {
    const minutes = deltaMinutes(depEv);
    if (minutes !== null && minutes > DELAYED_MIN) state = 'delayed';
    else if (dep.pastDue) state = 'overdue';
    else state = 'scheduled';
  }
  return { state, dep, arr, depEv, arrEv };
}

/**
 * How the leg left: `{text, timed}`. `timed` is false when the only evidence is the live feed, and
 * then the sentence names the feed instead of a departure time.
 */
function departurePhrase(leg, origin, tz, nowSec) {
  const { dep, depEv } = leg;
  const t = (sec) => when(sec, tz, nowSec);
  // The seen-airborne override (a Likely Canceled the feed saw fly) has no departure time of its
  // own: its only evidence is the sighting, said in words.
  if (dep.seen && !(depEv.basis === 'sighting' && depEv.bound === 'upper')) {
    return { text: `The schedule listed it as likely canceled, but the live feed saw it leave ${origin}`, timed: false };
  }
  if (depEv.hasRealTime && depEv.actualTimeSec > 0) {
    switch (depEv.basis) {
      case 'gate': return { text: `Left the gate at ${origin} at ${t(depEv.actualTimeSec)}`, timed: true };
      case 'runway': return { text: `Took off from ${origin} at ${t(depEv.actualTimeSec)}`, timed: true };
      case 'actual': return { text: `Left ${origin} at ${t(depEv.actualTimeSec)}`, timed: true };
      case 'sighting':
        if (depEv.bound === 'upper') return { text: `Left ${origin} by ${t(depEv.actualTimeSec)}`, timed: true };
        break;
      default: break;
    }
  }
  return { text: `The live feed has it in the air out of ${origin}, with no departure time from the schedule yet`, timed: false };
}

/** Where and when it lands, for a leg in the air. */
function arrivalPhrase(leg, dest, tz, nowSec, schedArr) {
  const { arrEv } = leg;
  const est = arrEv.actualTimeSec > 0 && !arrEv.hasRealTime && ['estimate', 'derived', 'live'].includes(arrEv.basis);
  if (est) return `lands at ${dest} about ${when(arrEv.actualTimeSec, tz, nowSec)}`;
  if (schedArr > 0) return `is due at ${dest} at ${when(schedArr, tz, nowSec)} (scheduled)`;
  return `is headed for ${dest}`;
}

const sentence = (s) => (s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}${/[.!?]$/.test(s) ? '' : '.'}` : '');

/**
 * The verdict for one leg.
 *
 * @param {object|null} row  the leg's board row, or null when we do not have the flight.
 * @param {number} nowSec
 * @param {{ident?: string, stableDays?: boolean}} [opts]
 * @returns {{state: string, parts: Part[], text: string, status: Part[], line: string}}
 *   `parts` is the sentence with the status words toned; `status` + `line` are the share card's
 *   two short lines.
 */
export function flightVerdict(row, nowSec, { ident = 'This flight', stableDays = false } = {}) {
  if (!row) {
    const parts = [{ text: `We don't have ${ident} on any United hub board right now.`, tone: null }];
    return finish('not-found', parts, [{ text: 'Not on the boards right now', tone: null }], '');
  }
  const leg = flightLegState(row, nowSec);
  const o = row.airport?.origin || {};
  const d = row.airport?.destination || {};
  const origin = placeName(o);
  const dest = placeName(d);
  const oTz = airportTz(o.code?.iata);
  const dTz = airportTz(d.code?.iata);
  const sched = row.time?.scheduled || {};
  const schedDep = Number(sched.departure) || 0;
  const schedArr = Number(sched.arrival) || 0;
  // `stableDays` (the share card, which a message thread keeps for days): no "today"/"tomorrow",
  // which go stale; the card prints the departure date, and an arrival on a later local date says
  // "next day" against it.
  const depDay = schedDep ? dayKey(schedDep, oTz) : '';
  const depAt = (sec) => (stableDays ? formatLocalTime(sec, oTz) : when(sec, oTz, nowSec));
  const arrAt = (sec) => {
    if (!stableDays) return when(sec, dTz, nowSec);
    const time = formatLocalTime(sec, dTz);
    return depDay && time && dayKey(sec, dTz) > depDay ? `${time} next day` : time;
  };
  const { depEv, arrEv } = leg;

  switch (leg.state) {
    case 'canceled': {
      const what = schedDep ? `the ${depAt(schedDep)} departure from ${origin} to ${dest}` : `this flight from ${origin} to ${dest}`;
      return finish('canceled', [
        { text: 'Canceled.', tone: 'bad' },
        { text: ` The schedule lists ${what} as canceled.` },
      ], [{ text: 'Canceled', tone: 'bad' }], schedDep ? `Was due to leave ${origin} at ${depAt(schedDep)}` : '');
    }
    case 'likely-canceled':
      return finish('likely-canceled', [
        { text: 'Possibly canceled, not confirmed.', tone: 'warn' },
        { text: ` The schedule lists ${schedDep ? `the ${depAt(schedDep)} departure from ${origin}` : 'it'} as likely canceled and the live feed has not seen it fly; most flights listed this way still operate, so check with United.` },
      ], [{ text: 'Possibly canceled', tone: 'warn' }, { text: ' · not confirmed' }], schedDep ? `Scheduled ${depAt(schedDep)} from ${origin}` : '');
    case 'diverted':
      return finish('diverted', [
        { text: 'Diverted.', tone: 'warn' },
        { text: ` It left ${origin} for ${dest} but is going to another airport; United will say where.` },
      ], [{ text: 'Diverted', tone: 'warn' }], `Was headed for ${dest}`);
    case 'landed': {
      const minutes = deltaMinutes(arrEv);
      const p = punctuality(minutes);
      const presumed = leg.arr.presumed && !leg.arr.seenLanded && !(arrEv.hasRealTime && arrEv.basis !== 'sighting');
      if (presumed) {
        return finish('landed-presumed', [
          { text: 'Probably landed.', tone: null },
          { text: ` It was due at ${dest} at ${arrAt(schedArr)} and there has been no live update since.` },
        ], [{ text: 'Probably landed' }], schedArr ? `Was due ${arrAt(schedArr)} at ${dest}` : '');
      }
      let detail;
      if (arrEv.hasRealTime && arrEv.basis === 'gate') detail = `Arrived at the gate at ${dest} at ${arrAt(arrEv.actualTimeSec)}`;
      else if (arrEv.hasRealTime && arrEv.basis === 'runway') detail = `Touched down at ${dest} at ${arrAt(arrEv.actualTimeSec)}, before taxiing to the gate`;
      else if (arrEv.hasRealTime && arrEv.basis === 'actual') detail = `Landed at ${dest} at ${arrAt(arrEv.actualTimeSec)}`;
      else if (arrEv.basis === 'estimate' && arrEv.actualTimeSec > 0) detail = `The live feed saw it on the ground at ${dest}; the schedule expects it at the gate about ${arrAt(arrEv.actualTimeSec)}`;
      else detail = `The live feed saw it on the ground at ${dest}, with no arrival time from the schedule yet`;
      const lead = [{ text: 'Landed' }];
      // A floor ("at least") is only worth saying when it says the flight was late.
      if (arrEv.bound === 'lower') {
        if (p?.late) lead.push({ text: ', ' }, { text: `at least ${p.text}`, tone: p.tone });
      } else if (p) {
        lead.push({ text: p.late ? ', ' : ' ' }, { text: p.text, tone: p.tone });
      }
      lead.push({ text: `. ${sentence(detail)}` });
      const status = [{ text: 'Landed' }];
      if (p && arrEv.bound !== 'lower') status.push({ text: ' · ' }, { text: p.text, tone: p.tone });
      const line = arrEv.hasRealTime && arrEv.actualTimeSec > 0 && arrEv.basis !== 'sighting'
        ? `At ${dest}, ${arrAt(arrEv.actualTimeSec)}`
        : `At ${dest}`;
      return finish('landed', lead, status, line);
    }
    case 'in-air': {
      if (leg.dep.presumed && !leg.dep.live && !leg.arr.live && !depEv.hasRealTime) {
        return finish('departed-presumed', [
          { text: 'Probably departed.', tone: null },
          { text: ` It was due to leave ${origin} at ${depAt(schedDep)} and there has been no live update since${schedArr ? `; it is scheduled to reach ${dest} at ${arrAt(schedArr)}` : ''}.` },
        ], [{ text: 'Probably departed' }], schedArr ? `Due ${arrAt(schedArr)} at ${dest}` : '');
      }
      const arrEstimate = arrEv.actualTimeSec > 0 && !arrEv.hasRealTime && ['estimate', 'derived', 'live'].includes(arrEv.basis);
      // Punctuality is the arrival's when there is an arrival forecast (it is what the person
      // meeting the flight needs), else the departure's.
      const minutes = arrEstimate ? deltaMinutes(arrEv) : depEv.bound ? null : deltaMinutes(depEv);
      const p = punctuality(minutes);
      // Colour goes on the punctuality words only; "In the air" is a fact, not a verdict.
      const lead = [{ text: 'In the air' }];
      if (p) lead.push(p.late ? { text: ', running about ' } : { text: ' and ' }, { text: p.late ? p.text : 'on time', tone: p.tone });
      const early = p && !p.late && minutes !== null && minutes < -ACTUAL_LINE_THRESHOLD_MINUTES && arrEstimate;
      const left = departurePhrase(leg, origin, oTz, nowSec);
      const lands = `${arrivalPhrase(leg, dest, dTz, nowSec, schedArr)}${early ? `, ${p.text}` : ''}`;
      const second = left.timed ? `${sentence(`${left.text} and ${lands}`)}` : `${sentence(left.text)} ${sentence(`it ${lands}`)}`;
      lead.push({ text: `. ${second}` });
      const status = [{ text: 'In the air' }];
      if (p) status.push({ text: ' · ' }, { text: p.late ? p.text : 'on time', tone: p.tone });
      const line = arrEstimate ? `Lands about ${arrAt(arrEv.actualTimeSec)} at ${dest}` : schedArr ? `Due ${arrAt(schedArr)} at ${dest} (scheduled)` : `Headed for ${dest}`;
      return finish('in-air', lead, status, line);
    }
    case 'delayed': {
      const minutes = deltaMinutes(depEv);
      const arrBit = arrEv.actualTimeSec > 0 && !arrEv.hasRealTime && ['estimate', 'derived'].includes(arrEv.basis)
        ? `, reaching ${dest} about ${arrAt(arrEv.actualTimeSec)}`
        : '';
      return finish('delayed', [
        { text: `Delayed about ${minutesPhrase(minutes)}.`, tone: delayTone(minutes) },
        { text: ` Now expected to leave ${origin} about ${depAt(depEv.actualTimeSec)} instead of ${formatLocalTime(schedDep, oTz)}${arrBit}.` },
      ], [{ text: `Delayed about ${minutesPhrase(minutes)}`, tone: delayTone(minutes) }], `Leaves ${origin} about ${depAt(depEv.actualTimeSec)}`);
    }
    case 'overdue':
      return finish('overdue', [
        { text: 'Past its departure time, no update yet.', tone: 'warn' },
        { text: ` It was due to leave ${origin} at ${depAt(schedDep)}; the schedule has not said whether it left.` },
      ], [{ text: 'No update yet', tone: 'warn' }], `Was due to leave ${origin} at ${depAt(schedDep)}`);
    case 'boarding': {
      const gate = row.airport?.origin?.info?.gate;
      return finish('boarding', [
        { text: 'Boarding.', tone: 'info' },
        { text: ` ${gate ? `Gate ${gate} at ${origin}` : `At ${origin}`}; scheduled to leave at ${depAt(schedDep)} and reach ${dest} at ${arrAt(schedArr)}.` },
      ], [{ text: 'Boarding', tone: 'info' }], `Leaves ${origin} ${depAt(schedDep)}`);
    }
    default: {
      // Scheduled. An estimate within the noise line is "on time"; a small one either way is
      // said in minutes; no estimate at all is "no delay reported" — the absence of news, not a
      // promise.
      const minutes = depEv.basis === 'estimate' ? deltaMinutes(depEv) : null;
      const p = punctuality(minutes);
      const arrEst = arrEv.actualTimeSec > 0 && !arrEv.hasRealTime && ['estimate', 'derived'].includes(arrEv.basis);
      const arrBit = arrEst ? `arrive at ${dest} about ${arrAt(arrEv.actualTimeSec)}` : schedArr ? `arrive at ${dest} at ${arrAt(schedArr)}` : `fly to ${dest}`;
      if (p && p.late) {
        return finish('scheduled', [
          { text: 'Scheduled,', tone: null },
          { text: ` expected to leave ${origin} about ${depAt(depEv.actualTimeSec)}, ` },
          { text: p.text, tone: p.tone },
          { text: `, and ${arrBit}.` },
        ], [{ text: 'Scheduled' }, { text: ' · ' }, { text: p.text, tone: p.tone }], `Leaves ${origin} about ${depAt(depEv.actualTimeSec)}`);
      }
      if (p) {
        const leave = minutes < -ACTUAL_LINE_THRESHOLD_MINUTES ? `about ${depAt(depEv.actualTimeSec)}, ${p.text}` : `about ${depAt(depEv.actualTimeSec)}`;
        return finish('scheduled', [
          { text: 'On time.', tone: 'ok' },
          { text: ` Expected to leave ${origin} ${leave}, and ${arrBit}.` },
        ], [{ text: 'Scheduled' }, { text: ' · ' }, { text: 'on time', tone: 'ok' }], `Leaves ${origin} ${depAt(schedDep)}`);
      }
      return finish('scheduled', [
        { text: 'Scheduled, no delay reported.', tone: null },
        { text: ` Leaves ${origin} at ${depAt(schedDep)} and is due to ${arrBit}.` },
      ], [{ text: 'Scheduled' }], schedDep ? `Leaves ${origin} ${depAt(schedDep)}` : '');
    }
  }
}

function finish(state, parts, status, line) {
  const clean = parts.filter((p) => p.text);
  return {
    state,
    parts: clean,
    text: clean.map((p) => p.text).join('').replace(/\s+/g, ' ').trim(),
    status,
    line,
  };
}
