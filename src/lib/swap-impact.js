// Equipment-swap classifier: given the old/new aircraft type codes (and the new
// tail when known), return the upgrade/downgrade/lateral impacts that drive the
// swap banner's up/down counts. Deterministic given the fleet lookups, which are
// injected via deps so this stays pure and importable.
import { normalizeWifi } from './fleet-utils.js';

export const CABIN_RANK = { 'J': 4, 'F': 3, 'PP': 2, 'PE': 2, 'E+': 1, 'Y': 0 };
export const WIFI_RANK = { 'Starlink': 3, 'ViaSat Ka': 2, 'Satellite Ka': 1, 'Satellite Ka (US)': 1, 'Satellite Ku': 1, 'NO': 0 };
export const IFE_RANK = { 'AVOD': 3, 'AVOD+PDE': 3, 'AVOD/PDE': 3, 'Seatback': 2, 'DTV/PDE': 1, 'PDE': 0 };

export function analyzeSwapImpact(oldAcCode, newAcCode, newReg, deps) {
  const { getTypicalFleetStats, fleetByReg, starlinkTails } = deps;
  const impacts = [];
  const oldStats = getTypicalFleetStats(oldAcCode);
  const newStats = getTypicalFleetStats(newAcCode);

  // If we have the actual new aircraft registration, use it for precise data
  let newActual = null;
  if (newReg && newReg !== '—') {
    const regClean = newReg.replace(/-/g, '');
    newActual = fleetByReg[regClean] || fleetByReg[newReg];
  }

  if (!oldStats && !newStats) return impacts;

  // Cabin class comparison
  if (oldStats && (newActual || newStats)) {
    const oldTop = oldStats.topCabin;
    const newSeats = newActual?.seats || newStats?.seats || {};
    const newTop = Object.keys(newSeats).reduce((best, cls) =>
      (CABIN_RANK[cls] || 0) > (CABIN_RANK[best] || 0) ? cls : best, 'Y');
    const oldRank = CABIN_RANK[oldTop] || 0;
    const newRank = CABIN_RANK[newTop] || 0;
    const cabinLabels = { 'J': 'Polaris', 'F': 'First', 'PP': 'Premium Plus', 'PE': 'Premium Plus', 'E+': 'Economy Plus', 'Y': 'Economy' };
    if (oldRank > newRank) {
      impacts.push({ text: 'Lost ' + (cabinLabels[oldTop] || oldTop), cls: 'downgrade' });
    } else if (newRank > oldRank) {
      impacts.push({ text: '+ ' + (cabinLabels[newTop] || newTop), cls: 'upgrade' });
    }
  }

  // Seat count comparison
  const oldTot = oldStats?.tot || 0;
  const newTot = newActual?.tot || newStats?.tot || 0;
  if (oldTot && newTot && oldTot !== newTot) {
    const delta = newTot - oldTot;
    impacts.push({
      text: (delta > 0 ? '+' : '') + delta + ' seats',
      cls: delta > 0 ? 'lateral' : 'downgrade'
    });
  }

  // WiFi comparison
  const oldWifi = normalizeWifi(oldStats?.wifi || '');
  const newWifi = normalizeWifi(newActual?.w || newStats?.wifi || '');
  if (oldWifi && newWifi && oldWifi !== newWifi) {
    const oldWR = WIFI_RANK[oldWifi] ?? 1;
    const newWR = WIFI_RANK[newWifi] ?? 1;
    if (oldWR !== newWR) {
      const shortWifi = (newActual && starlinkTails.has(newActual.r)) ? 'Starlink' : newWifi;
      impacts.push({
        text: shortWifi + ' WiFi',
        cls: newWR > oldWR ? 'upgrade' : 'downgrade'
      });
    }
  }

  // Starlink specifically (even if WiFi field doesn't change, Starlink is special)
  if (newActual && starlinkTails.has(newActual.r) && oldStats && !oldStats.hasStarlink) {
    if (!impacts.some(i => i.text.includes('Starlink'))) {
      impacts.push({ text: '⚡ Starlink', cls: 'upgrade' });
    }
  } else if (newActual && !starlinkTails.has(newActual.r) && oldStats?.hasStarlink) {
    if (!impacts.some(i => i.text.includes('Starlink'))) {
      impacts.push({ text: 'Lost Starlink', cls: 'downgrade' });
    }
  }

  // IFE comparison
  const oldIfe = oldStats?.ife || '';
  const newIfe = newActual?.i || newStats?.ife || '';
  if (oldIfe && newIfe && oldIfe !== newIfe) {
    const oldIR = IFE_RANK[oldIfe] ?? 1;
    const newIR = IFE_RANK[newIfe] ?? 1;
    if (oldIR !== newIR) {
      impacts.push({
        text: newIfe.replace('AVOD/PDE', 'AVOD').replace('AVOD+PDE', 'AVOD').replace('DTV/PDE', 'DTV'),
        cls: newIR > oldIR ? 'upgrade' : 'downgrade'
      });
    }
  }

  return impacts;
}
