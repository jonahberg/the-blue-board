// ═══ BACKFILLED TAIL vs SCHEDULED TYPE ═══
// F15 (audit Sep 26 2026): SFO UA2278 (A321neo) showed tail N76265 — a 737-800 — with that
// jet's cabin and delivery year, and no swap flag. The tail came from live tracking, where the
// same flight number had just flown SAN→SFO on the 737; nothing checked that the tail could be
// the aircraft the schedule row names. A tail the schedule provider SENT is left alone (a real
// equipment swap is the swap detector's job); a tail the board BACKFILLED from live tracking
// (the browser ledger, or the server merge tagged regSource:'live_feed') is dropped when its
// fleet type is a different aircraft FAMILY from the row's model. Within a family (737-800 vs
// MAX 9, 777-200 vs -200ER) the tail stays: the free-text model cannot resolve variants reliably.

import { ICAO_TO_FLEET_TYPE } from './equipment-swaps.js';

/** '737 MAX 9' → '737', 'A321neo' → 'A32x', '777-200ER' → '777'; '' when unknown. */
export function fleetFamily(fleetType) {
  const t = String(fleetType || '').toUpperCase();
  if (/^A3(19|20|21)/.test(t)) return 'A32x';
  const m = /^(7[3-8]7)/.exec(t);
  return m ? m[1] : '';
}

/**
 * Can `reg` be the aircraft a row scheduled as `modelCode` is flying?
 * Unknown on either side (regional types, tails missing from the fleet DB) is not evidence.
 *
 * @param {string} reg
 * @param {string|undefined} modelCode  ICAO code from the schedule row (e.g. 'A21N').
 * @param {Record<string, {t?: string}>} fleetByReg
 * @returns {boolean}
 */
export function regMatchesModel(reg, modelCode, fleetByReg) {
  if (!reg || !modelCode || !fleetByReg) return true;
  const entry = fleetByReg[reg.replace('-', '')] || fleetByReg[reg];
  const tailFamily = fleetFamily(entry?.t);
  const rowFamily = fleetFamily(ICAO_TO_FLEET_TYPE[modelCode]);
  if (!tailFamily || !rowFamily) return true;
  return tailFamily === rowFamily;
}
