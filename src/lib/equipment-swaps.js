// ═══ EQUIPMENT SWAP DETECTION ═══
// Each schedule-board load snapshots "flight number → ICAO aircraft code" into
// localStorage. The next load diffs against that snapshot, so a 787 downgraded to a
// 737 overnight shows up as a swap badge on the row.
//
// Extracted verbatim from src/dashboard/main.js (:5541-5624). Storage and the fleet
// database are injected so the module stays DOM- and global-free; main.js still owns
// the badge rendering and the `equipmentChanges` module global.

import { categorizeFleetStatus, normalizeWifi } from './fleet-utils.js';
import { CABIN_RANK } from './swap-impact.js';

/** ICAO type code (as the schedule feed reports it) → fleet-database type name. */
/** @type {Record<string, string>} */
export const ICAO_TO_FLEET_TYPE = {
  'A319':'A319','A320':'A320','A21N':'A321neo',
  'B737':'737-700','B738':'737-800','B739':'737-900',
  'B39M':'737 MAX 9','B38M':'737 MAX 8',
  'B752':'757-200','B753':'757-300',
  'B763':'767-300ER','B764':'767-400ER',
  'B772':'777-200','B77E':'777-200ER','B77W':'777-300ER',
  'B788':'787-8','B789':'787-9','B78X':'787-10'
};

/**
 * What a passenger typically gets on this aircraft type, derived from the ACTIVE
 * aircraft of that type in the fleet database: modal cabin config, modal WiFi, the
 * most premium cabin present, and whether any tail of the type has Starlink.
 *
 * Feeds analyzeSwapImpact() so a swap can be called an upgrade or a downgrade.
 *
 * @param {string} icaoCode  ICAO type code from the schedule feed, e.g. 'B77W'.
 * @param {Array<Object>} fleetDb  rows from /data/fleet.json.
 * @param {{has: (reg: string) => boolean}} starlinkTails  set of Starlink registrations.
 * @returns {{type: string, seats: Object, tot: number, wifi: string, ife: string, topCabin: string, hasStarlink: boolean}|null}
 *   null when the code is unknown or no active aircraft of the type exist.
 */
export function getTypicalFleetStats(icaoCode, fleetDb, starlinkTails) {
  const fleetType = ICAO_TO_FLEET_TYPE[icaoCode];
  if (!fleetType || !fleetDb.length) return null;
  // Find all aircraft of this type to get typical stats
  const ofType = fleetDb.filter(a => a.t === fleetType && categorizeFleetStatus(a.s) === 'active');
  if (!ofType.length) return null;
  // Use the most common config (mode)
  const configCounts = {};
  ofType.forEach(a => { const k = a.c || ''; configCounts[k] = (configCounts[k] || 0) + 1; });
  const topConfig = Object.entries(configCounts).sort((a, b) => b[1] - a[1])[0][0];
  const representative = ofType.find(a => (a.c || '') === topConfig) || ofType[0];
  // Collect WiFi types used by this fleet type
  const wifiCounts = {};
  ofType.forEach(a => { if (a.w) { const nw = normalizeWifi(a.w); wifiCounts[nw] = (wifiCounts[nw] || 0) + 1; } });
  const topWifi = Object.entries(wifiCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  // Check if any have Starlink
  const hasStarlink = ofType.some(a => starlinkTails.has(a.r));
  // Premium cabin: highest cabin class available
  const topCabin = representative.seats ? Object.keys(representative.seats).reduce((best, cls) =>
    (CABIN_RANK[cls] || 0) > (CABIN_RANK[best] || 0) ? cls : best, 'Y') : 'Y';
  return {
    type: fleetType,
    seats: representative.seats || {},
    tot: representative.tot || 0,
    wifi: topWifi,
    ife: representative.i || '',
    topCabin,
    hasStarlink
  };
}

/**
 * Diff this board against the stored snapshot, then overwrite the snapshot.
 *
 * A flight that is new since the snapshot is NOT a swap — only a flight whose
 * aircraft code changed counts. The whole read/diff/write runs inside one try/catch:
 * if storage is corrupt or unavailable the caller gets no swaps and the snapshot is
 * not written, exactly as before.
 *
 * @param {Array<Object>} flights  schedule rows.
 * @param {string} key  storage key, `bb_sched_<hub>_<dir>_<day>`.
 * @param {{getItem: Function, setItem: Function}} storage
 * @returns {{swaps: Array<{flight: string, oldAc: string, newAc: string, reg: string}>, snapshot: Record<string, string>}}
 */
export function detectEquipmentSwaps(flights, key, storage) {
  const newMap = {};
  const regMap = {};
  flights.forEach(fl => {
    const fnum = fl.identification?.number?.default;
    const acCode = fl.aircraft?.model?.code;
    if (fnum && acCode) {
      newMap[fnum] = acCode;
      regMap[fnum] = fl.aircraft?.registration || '';
    }
  });
  const swaps = [];
  try {
    const oldData = storage.getItem(key);
    if (oldData) {
      const oldMap = JSON.parse(oldData);
      for (const [fnum, newAc] of Object.entries(newMap)) {
        if (oldMap[fnum] && oldMap[fnum] !== newAc) {
          swaps.push({ flight: fnum, oldAc: oldMap[fnum], newAc, reg: regMap[fnum] || '' });
        }
      }
    }
    storage.setItem(key, JSON.stringify(newMap));
  } catch (e) { /* localStorage full or unavailable */ }
  return { swaps, snapshot: newMap };
}
