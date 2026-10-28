// ═══ AIRCRAFT TYPE FROM OUR OWN FLEET DATABASE ═══
// AeroDataBox leaves `aircraft.model.code` empty on a large share of rows — 1,354 of 4,411
// departures on Oct 28 2026, 188 of them WITH a registration — and the board printed "—" in
// the Aircraft column. Oct 7 2026, a reader: UA146 EWR→LHR read "—" beside N653UA, a tail
// the aircraft card itself calls a 767-300ER. When the provider sends no code and the tail is
// in the mainline or United Express database, the type comes from there.
//
// It fills the provider's blank; it never overrides a code the provider did send. The
// provider's free text goes with it when the code was blank: that text is how N15712, a
// 737-700, reached the board as "Boeing 707-300".
//
// One place, every reader: the Aircraft cell, the Aircraft filter and the Aircraft sort all
// read `aircraft.model.code`, so useBoardModel fills the row once and they all agree.

import { ICAO_TO_FLEET_TYPE } from './equipment-swaps.js';

/**
 * Fleet-database type name → the ICAO code the schedule feed uses ('767-300ER' → 'B763').
 * ICAO_TO_FLEET_TYPE is keyed the other way and has no entry for the 136 737-900ERs (ICAO
 * B739, shared with the 737-900), and its 777-200ER key 'B77E' is not a code the feed sends
 * (it reports the -200ER as B772) — both corrected here so a filled row filters and sorts with
 * the rows the provider coded.
 */
const FLEET_TYPE_TO_ICAO = Object.freeze({
  ...Object.fromEntries(Object.entries(ICAO_TO_FLEET_TYPE).map(([icao, type]) => [type, icao])),
  '737-900ER': 'B739',
  '777-200ER': 'B772',
});

/** United Express display types (express-fleet.js) → the code the feed uses, and its text. */
const EXPRESS_TYPES = [
  [/^E175/, 'E175', 'Embraer 175'],
  [/^E170/, 'E170', 'Embraer 170'],
  [/^CRJ200/, 'CRJ2', 'Bombardier CRJ200'],
  [/^CRJ(700|550)/, 'CRJ7', 'Bombardier CRJ700'],
  [/^ERJ145/, 'E145', 'Embraer RJ145'],
];

function maker(type) {
  return /^A3/.test(type) ? 'Airbus' : 'Boeing';
}

/**
 * The type our own databases record for a registration.
 *
 * @param {string} reg
 * @param {Record<string, {t?: string}>|null|undefined} fleetByReg  mainline, /data/fleet.json.
 * @param {Record<string, {t?: string}>|null|undefined} [expressByReg]  United Express.
 * @returns {{code: string, text: string, source: 'fleet-db'|'express-db'}|null}
 */
export function fleetTypeForReg(reg, fleetByReg, expressByReg) {
  if (!reg) return null;
  const clean = String(reg).replace('-', '');
  const mainline = fleetByReg?.[clean] || fleetByReg?.[reg];
  const code = mainline?.t ? FLEET_TYPE_TO_ICAO[mainline.t] : '';
  if (code) return { code, text: `${maker(mainline.t)} ${mainline.t}`, source: 'fleet-db' };
  const express = expressByReg?.[clean] || expressByReg?.[reg];
  if (express?.t) {
    const hit = EXPRESS_TYPES.find(([pattern]) => pattern.test(express.t));
    if (hit) return { code: hit[1], text: hit[2], source: 'express-db' };
  }
  return null;
}

/**
 * The row with its blank type code filled from the fleet databases, or the SAME row when the
 * provider sent a code or the tail is unknown (rows are shared cache objects: never mutated).
 *
 * @param {object} flight  a provider schedule row.
 * @param {string} reg  the row's resolved registration (provider first, live-feed ledger second).
 * @param {Record<string, {t?: string}>|null|undefined} fleetByReg
 * @param {Record<string, {t?: string}>|null|undefined} [expressByReg]
 * @returns {object}
 */
export function withFleetType(flight, reg, fleetByReg, expressByReg) {
  if (!flight || flight.aircraft?.model?.code) return flight;
  const known = fleetTypeForReg(reg, fleetByReg, expressByReg);
  if (!known) return flight;
  return {
    ...flight,
    aircraft: {
      ...(flight.aircraft || {}),
      model: { code: known.code, text: known.text, source: known.source },
    },
  };
}
