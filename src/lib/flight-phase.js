// ═══ FLIGHT PHASE + SQUAWK DECODING ═══
// Turns the live feed's raw telemetry into the phase label the map markers, phase
// filter, sidebar counters and popup chip all key off, and decodes the handful of
// transponder codes worth surfacing.
//
// Extracted verbatim from src/dashboard/main.js (:982-1006).
//
// The feed reports SI units — metres, m/s — so every threshold below is expressed
// in aviation units after conversion (ft = m × 3.28084, fpm = m/s × 196.85,
// kt = m/s × 1.944). Order matters: the low-altitude Takeoff/Approach tests run
// before the generic Climb/Descent ones, so an aircraft 3000 ft over the fence
// reads "Takeoff" rather than "Climb".

/**
 * One glyph per phase getPhase can return. Cruise and En Route deliberately share
 * a glyph — the distinction is altitude-only and not worth two icons on the map.
 * @type {Record<string, string>}
 */
export const PHASE_ICONS = {
  Ground: '🅿️',
  Takeoff: '🛫',
  Approach: '🛬',
  Climb: '↗️',
  Descent: '↘️',
  Cruise: '✈️',
  'En Route': '✈️',
};

/**
 * Classify a flight's phase from live telemetry.
 *
 * @param {number|null|undefined} alt  altitude in metres.
 * @param {number|null|undefined} vr  vertical rate in m/s.
 * @param {number|null|undefined} spd  ground speed in m/s.
 * @returns {{phase: string, icon: string, cls: string}} phase label, glyph and CSS class.
 */
export function getPhase(alt, vr, spd) {
  const altFt = alt != null ? alt * 3.28084 : null;
  const vrFpm = vr != null ? vr * 196.85 : null; // m/s to fpm
  const spdKts = spd != null ? spd * 1.944 : null;

  if (altFt !== null && altFt < 100 && spdKts !== null && spdKts < 50) return { phase: 'Ground', icon: PHASE_ICONS.Ground, cls: 'phase-ground' };
  if (altFt !== null && altFt < 5000 && vrFpm !== null && vrFpm > 500) return { phase: 'Takeoff', icon: PHASE_ICONS.Takeoff, cls: 'phase-climb' };
  if (altFt !== null && altFt < 5000 && vrFpm !== null && vrFpm < -300) return { phase: 'Approach', icon: PHASE_ICONS.Approach, cls: 'phase-approach' };
  if (vrFpm !== null && vrFpm > 300) return { phase: 'Climb', icon: PHASE_ICONS.Climb, cls: 'phase-climb' };
  if (vrFpm !== null && vrFpm < -300) return { phase: 'Descent', icon: PHASE_ICONS.Descent, cls: 'phase-descent' };
  if (altFt !== null && altFt > 25000) return { phase: 'Cruise', icon: PHASE_ICONS.Cruise, cls: 'phase-cruise' };
  return { phase: 'En Route', icon: PHASE_ICONS['En Route'], cls: 'phase-cruise' };
}

/**
 * Collapse the seven phases into the five buckets the sidebar filter offers.
 * Anything unrecognised falls into Cruise, matching the En Route default above.
 *
 * @param {string|undefined} phase  a phase label from getPhase().
 * @returns {'Ground'|'Climb'|'Cruise'|'Descent'|'Approach'}
 */
export function getPhaseGroup(phase) {
  if (phase === 'Ground') return 'Ground';
  if (phase === 'Takeoff' || phase === 'Climb') return 'Climb';
  if (phase === 'Cruise' || phase === 'En Route') return 'Cruise';
  if (phase === 'Descent') return 'Descent';
  if (phase === 'Approach') return 'Approach';
  return 'Cruise';
}

/**
 * Decode the transponder codes worth showing: the three emergency squawks and VFR.
 * Everything else (including a discrete ATC assignment) returns null so the popup
 * and ticker stay quiet.
 *
 * @param {string|number|null|undefined} sq
 * @returns {{text: string, cls: string}|null}
 */
export function decodeSquawk(sq) {
  if (!sq) return null;
  const s = String(sq);
  if (s === '7500') return { text: '⚠️ HIJACK', cls: 'squawk-alert' };
  if (s === '7600') return { text: '⚠️ RADIO FAILURE', cls: 'squawk-alert' };
  if (s === '7700') return { text: '⚠️ EMERGENCY', cls: 'squawk-alert' };
  if (s === '1200') return { text: 'VFR', cls: '' };
  return null;
}
