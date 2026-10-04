// ═══ THE UNITED EXPRESS FLEET ═══
// United Express aircraft, discovered from United's own flying (sql/018_express_tails.sql), plus
// the Starlink roster's curated Express entries. Mainline stays in /data/fleet.json and
// `matchAircraft` (fleet-match.js) stays mainline-only, so the fleet stats ("1,139 mainline",
// utilization, the Starlink counts) never move.
//
// Why discovered: SkyWest and Republic also fly for American and Delta, so no registry or operator
// list says which tails fly for United. A tail qualifies only when the live feed shows it flying a
// United-numbered flight (UA…, or G7… for GoJet) under a United Express operator's callsign on a
// regional type (`expressTailFromFlight`). Oct 4 2026 backfill from four days of hub boards: 454
// tails, none of them mainline; with the Starlink roster, 472 of the ~513 United Express aircraft.
//
// Pure: no network, no data imports — the cron writer, the API reader and the dashboard share it.

import { UNITED_OPERATORS, operatorFromCallsign } from './express-operators.js';
import { REGIONAL_TYPE } from './fleet-match.js';

/** A tail drops out of the fleet once it has not flown United for this long. */
export const EXPRESS_STALE_DAYS = 45;

/** US registration, dash-stripped and upper-cased, or '' when it is not one. */
export function normalizeReg(reg) {
  const r = String(reg ?? '').trim().toUpperCase().replace(/-/g, '');
  return /^N[0-9A-Z]{1,5}$/.test(r) ? r : '';
}

/**
 * The express_tails row a live-feed flight becomes, or null when it does not qualify: an Express
 * operator's callsign, a United flight number, a US registration and a regional type, all four.
 *
 * @param {{reg?: string, callsign?: string, flightIATA?: string, acType?: string}} f  a parsed
 *   feed row (feed-health.js parseFr24Feed).
 */
export function expressTailFromFlight(f) {
  if (!f) return null;
  const op = operatorFromCallsign(f.callsign);
  if (!op?.express) return null;
  const flight = String(f.flightIATA ?? '').trim().toUpperCase();
  if (!/^(UA|G7)\d/.test(flight)) return null;
  const reg = normalizeReg(f.reg);
  if (!reg) return null;
  const acType = String(f.acType ?? '').trim().toUpperCase();
  if (!acType || !REGIONAL_TYPE.test(acType)) return null;
  return { reg, operator: op.code, fr24_type: acType, last_flight: flight };
}

/** Every qualifying flight in a feed read, one row per tail (the last one seen wins). */
export function expressTailRows(flights) {
  const byReg = new Map();
  for (const f of Array.isArray(flights) ? flights : []) {
    const row = expressTailFromFlight(f);
    if (row) byReg.set(row.reg, row);
  }
  return [...byReg.values()];
}

/**
 * The watch-alerts cron runs every 5 minutes; the fleet only needs refreshing twice an hour. A
 * wall-clock slot, not a per-instance throttle — a cold start would reset a throttle.
 */
export function isExpressWriteSlot(atMs) {
  const minute = new Date(atMs).getUTCMinutes();
  return minute < 5 || (minute >= 30 && minute < 35);
}

/** The Starlink roster's operator label ("SkyWest dba UAX", "SkyWest floater") → ICAO code. */
export function operatorCodeFromRoster(label) {
  const first = String(label ?? '').trim().split(/\s+/)[0].toLowerCase();
  const byName = { skywest: 'SKW', republic: 'RPA', gojet: 'GJS', commutair: 'UCA', commuteair: 'UCA', mesa: 'ASH', air: 'AWI' };
  return byName[first] || '';
}

// Type normalisation. `key` decides the cabin lookup; `label` is what the dashboard prints.
// The E175 comes in two United layouts: the 76-seat standard and the 70-seat "SC" (Embraer's
// Special Configuration, built for pilot scope limits). Only the Starlink roster tells them
// apart per tail ("ERJ-175" vs "E175SC"), so a roster-labelled E175 gets a variant key and an
// E175 known only from the feed or a board stays the bare 'E175' key, which has no cabin for an
// operator flying both layouts (SkyWest, Mesa).
const ROSTER_TYPES = {
  'ERJ-175': { key: 'E175-76', label: 'E175' },
  E175: { key: 'E175', label: 'E175' },
  E175SC: { key: 'E175-70', label: 'E175' },
  'CRJ-550': { key: 'CRJ550', label: 'CRJ550' },
  CRJ550: { key: 'CRJ550', label: 'CRJ550' },
};
const CODE_TYPES = {
  E75L: { key: 'E175', label: 'E175' },
  E75S: { key: 'E175', label: 'E175' },
  E175: { key: 'E175', label: 'E175' },
  E170: { key: 'E170', label: 'E170' },
  CRJ2: { key: 'CRJ200', label: 'CRJ200' },
  E145: { key: 'ERJ145', label: 'ERJ145' },
  E45X: { key: 'ERJ145', label: 'ERJ145' },
  // CRJ7 is a CRJ550 or a CRJ700 — the same airframe. Without the roster saying CRJ-550 it is
  // labelled only as the family, with no cabin.
  CRJ7: { key: 'CRJ7', label: 'CRJ700/550' },
};

/**
 * @param {{rosterType?: string, model?: string, fr24Type?: string}} sources  the Starlink roster's
 *   curated type first, then the schedule board's model code, then the live feed's designator.
 * @returns {{key: string, label: string}}  key '' when nothing is known.
 */
export function normalizeExpressType({ rosterType, model, fr24Type, operator } = {}) {
  const roster = ROSTER_TYPES[String(rosterType ?? '').trim().toUpperCase()];
  if (roster) return roster;
  for (const code of [model, fr24Type]) {
    const hit = CODE_TYPES[String(code ?? '').trim().toUpperCase()];
    if (hit) return hit;
  }
  // An operator that flies ONE type for United needs no designator: CommutAir's United fleet is
  // all ERJ145XR (UAL FY2025 10-K; united.com). The board backfill carried no model for its 44 tails.
  const single = SINGLE_TYPE_OPERATORS[String(operator ?? '').trim().toUpperCase()];
  return single || { key: '', label: '' };
}

const SINGLE_TYPE_OPERATORS = { UCA: { key: 'ERJ145', label: 'ERJ145' } };

/**
 * Cabin layouts by type key and operator code (`*` = every operator): only layouts that are
 * verified with high confidence AND the single layout that key can mean. Anything else gets no
 * cabin — a wrong seat count on a flight panel is worse than none.
 *
 * Research pass, Oct 4 2026 (united.com aircraft pages via the Wayback Machine, aeroLOPA, UAL FY2025
 * 10-K, SkyWest Q2 2026 10-Q, Wikipedia "United Express", unitedstarlinktracker.com):
 *  - E175 standard 76 = 12F/16E+/48Y; E175 SC 70 = 12F/32E+/26Y (united.com "Version 2"/"Version 1").
 *    SkyWest flies both, so only a roster-labelled tail gets a cabin. Republic flies only the 76.
 *    Mesa is left out: Wikipedia and the tracker disagree on which Mesa tails are the 70-seaters.
 *  - CRJ550 50 = 10F/20E+/20Y (GoJet and SkyWest, one layout).
 *  - CRJ200 50 = 50Y (SkyWest); ERJ145 50 = 6E+/44Y, no First (CommutAir). Neither has Wi-Fi.
 *  - Not filled (medium/low confidence): CRJ700, E170, CRJ450 (not in scheduled service yet).
 * @type {Readonly<Record<string, {config: string, seats: Record<string, number>, tot: number}>>}
 */
const E175_76 = Object.freeze({ config: '12F/16E+/48Y', seats: Object.freeze({ F: 12, 'E+': 16, Y: 48 }), tot: 76 });
const E175_70 = Object.freeze({ config: '12F/32E+/26Y', seats: Object.freeze({ F: 12, 'E+': 32, Y: 26 }), tot: 70 });
export const EXPRESS_CABINS = Object.freeze({
  'E175-76|SKW': E175_76,
  'E175-70|SKW': E175_70,
  'E175-76|RPA': E175_76,
  'E175|RPA': E175_76, // Republic's United E175s are all 76-seaters, so the bare key is safe
  'CRJ550|*': Object.freeze({ config: '10F/20E+/20Y', seats: Object.freeze({ F: 10, 'E+': 20, Y: 20 }), tot: 50 }),
  'CRJ200|SKW': Object.freeze({ config: '50Y', seats: Object.freeze({ Y: 50 }), tot: 50 }),
  'ERJ145|UCA': Object.freeze({ config: '6E+/44Y', seats: Object.freeze({ 'E+': 6, Y: 44 }), tot: 50 }),
});

/** Types verified to have no Wi-Fi at all (united.com, aeroLOPA). A Starlink roster entry overrides. */
export const EXPRESS_NO_WIFI_TYPES = Object.freeze(new Set(['CRJ200', 'ERJ145']));

/** The cabin for a type key + operator code, or null. */
export function expressCabinFor(typeKey, operatorCode) {
  return EXPRESS_CABINS[`${typeKey}|${operatorCode}`] || EXPRESS_CABINS[`${typeKey}|*`] || null;
}

/**
 * One fleet entry per United Express tail: the discovered tails, plus any Express tail the
 * Starlink roster lists that has not been seen yet. Shaped like a /data/fleet.json row where the
 * fields overlap (r, t, w, c, seats, tot) so the board cell can treat both alike, with `x: true`
 * and the operator added.
 *
 * @param {Array<{r: string, op: string, ft?: string|null, m?: string|null, lf?: string|null,
 *   fs?: string, ls?: string}>} tails  /api/express-fleet rows.
 * @param {Array<{tail: string, fleet?: string, type?: string, operator?: string}>} roster  the
 *   Starlink roster (useFleet().starlink.aircraft).
 */
export function buildExpressFleet(tails, roster) {
  const rosterByReg = new Map();
  for (const a of Array.isArray(roster) ? roster : []) {
    if (a?.fleet !== 'Express') continue;
    const reg = normalizeReg(a.tail);
    if (reg) rosterByReg.set(reg, a);
  }
  const out = new Map();
  const add = (reg, opCode, sources, seen) => {
    const rosterEntry = rosterByReg.get(reg);
    const operatorCode = opCode || operatorCodeFromRoster(rosterEntry?.operator);
    const type = normalizeExpressType({ rosterType: rosterEntry?.type, model: sources.m, fr24Type: sources.ft, operator: operatorCode });
    const operator = UNITED_OPERATORS[operatorCode]?.name || '';
    const cabin = type.key ? expressCabinFor(type.key, operatorCode) : null;
    out.set(reg, {
      r: reg,
      t: type.label,
      tk: type.key,
      o: operator,
      oc: operatorCode,
      // Starlink from the roster; 'None' only for types verified to have no Wi-Fi; '' = unknown.
      w: rosterEntry ? 'Starlink' : EXPRESS_NO_WIFI_TYPES.has(type.key) ? 'None' : '',
      c: cabin?.config || '',
      ...(cabin ? { seats: cabin.seats, tot: cabin.tot } : {}),
      fs: seen?.fs || '',
      ls: seen?.ls || '',
      lf: seen?.lf || '',
      x: true,
    });
  };
  for (const t of Array.isArray(tails) ? tails : []) {
    const reg = normalizeReg(t?.r);
    if (!reg) continue;
    add(reg, t.op, { m: t.m, ft: t.ft }, { fs: t.fs, ls: t.ls, lf: t.lf });
  }
  for (const [reg, a] of rosterByReg) {
    if (!out.has(reg)) add(reg, operatorCodeFromRoster(a.operator), {}, null);
  }
  return [...out.values()].sort((a, b) => a.r.localeCompare(b.r));
}

/** Registration → Express entry. */
export function indexExpressFleet(list) {
  const index = {};
  for (const entry of Array.isArray(list) ? list : []) index[entry.r] = entry;
  return index;
}

/** The Express entry for a live-feed flight or a bare registration, or null. */
export function matchExpress(flightOrReg, expressByReg) {
  if (!expressByReg) return null;
  const reg = normalizeReg(typeof flightOrReg === 'string' ? flightOrReg : flightOrReg?.reg);
  return (reg && expressByReg[reg]) || null;
}

/** Counts for the Fleet tab's Express section: by operator and by type, plus Starlink. */
export function summarizeExpressFleet(list) {
  const byOperator = {};
  const byType = {};
  let starlink = 0;
  for (const e of Array.isArray(list) ? list : []) {
    const op = e.o || 'Unknown operator';
    const type = e.t || 'Unknown type';
    byOperator[op] = (byOperator[op] || 0) + 1;
    byType[type] = (byType[type] || 0) + 1;
    if (e.w === 'Starlink') starlink++;
  }
  return { total: Array.isArray(list) ? list.length : 0, starlink, byOperator, byType };
}
