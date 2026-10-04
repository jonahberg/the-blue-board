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
// The roster's "E175SC" stays its own key until its cabin is known to match a standard E175.
const ROSTER_TYPES = {
  'ERJ-175': { key: 'E175', label: 'E175' },
  E175: { key: 'E175', label: 'E175' },
  E175SC: { key: 'E175SC', label: 'E175' },
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
export function normalizeExpressType({ rosterType, model, fr24Type } = {}) {
  const roster = ROSTER_TYPES[String(rosterType ?? '').trim().toUpperCase()];
  if (roster) return roster;
  for (const code of [model, fr24Type]) {
    const hit = CODE_TYPES[String(code ?? '').trim().toUpperCase()];
    if (hit) return hit;
  }
  return { key: '', label: '' };
}

/**
 * Cabin layouts by type key and operator code: only layouts that are verified AND the single
 * layout in service for that pair. Anything else gets no cabin — a wrong seat count on a flight
 * panel is worse than none.
 * Filled from the Oct 2026 research pass (see the CHANGELOG entry for sources).
 * @type {Readonly<Record<string, {config: string, seats: Record<string, number>, tot: number}>>}
 */
export const EXPRESS_CABINS = Object.freeze({});

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
    const type = normalizeExpressType({ rosterType: rosterEntry?.type, model: sources.m, fr24Type: sources.ft });
    const operatorCode = opCode || operatorCodeFromRoster(rosterEntry?.operator);
    const operator = UNITED_OPERATORS[operatorCode]?.name || '';
    const cabin = type.key ? expressCabinFor(type.key, operatorCode) : null;
    out.set(reg, {
      r: reg,
      t: type.label,
      tk: type.key,
      o: operator,
      oc: operatorCode,
      w: rosterEntry ? 'Starlink' : '',
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
