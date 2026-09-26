// ═══ SPECIAL AIRCRAFT, ENGINES AND CABIN PALETTES ═══
// The fleet site publishes a free-text "special" column; this turns it into the ⭐
// index the fleet table, schedule board, popup and aircraft modal all read. Also
// holds the two cabin colour maps and the engine lookup those panels render with.
//
// Extracted verbatim from src/dashboard/main.js (:185-215 SPECIAL_AIRCRAFT rules +
// ENGINE_BY_TYPE, :2598-2638 config-gallery colours, :8256-8260 seat-bar colours).

/** @typedef {{name: string, type: 'named'|'livery'}} SpecialAircraft */

/**
 * Index the fleet database's special column by registration.
 *
 * Three rules, in order — the named rule wins when both could match:
 *  - `*Name*` → a named aircraft, asterisks stripped and trimmed.
 *  - anything containing "100 Year Sticker" → that livery.
 *  - anything containing "Eco Demonstrator" → "Eco Demonstrator Explorer".
 *
 * @param {Array<{r: string, s?: string}>|null|undefined} fleetDb  rows from /data/fleet.json.
 * @returns {Map<string, SpecialAircraft>} registration → entry (empty when there is no fleet).
 */
export function indexSpecialAircraft(fleetDb) {
  /** @type {Map<string, SpecialAircraft>} */
  const index = new Map();
  if (!fleetDb) return index;
  fleetDb.forEach(a => {
    if (!a.s) return;
    if (a.s.startsWith('*')) {
      index.set(a.r, { name: a.s.replace(/^\*+|\*+$/g, '').trim(), type: 'named' });
    } else if (/100 Year Sticker/i.test(a.s)) {
      index.set(a.r, { name: '100 Year Sticker', type: 'livery' });
    } else if (/Eco Demonstrator/i.test(a.s)) {
      index.set(a.r, { name: 'Eco Demonstrator Explorer', type: 'livery' });
    }
  });
  return index;
}

// ═══ ENGINE TYPE LOOKUP ═══
/** @type {Record<string, string>} */
export const ENGINE_BY_TYPE = {
  'A319':'IAE V2524-A5','A320':'IAE V2527-A5','A321neo':'CFM LEAP-1A',
  '737-700':'CFM56-7B22','737-800':'CFM56-7B26','737-900':'CFM56-7B26',
  '737-900ER':'CFM56-7B27','737 MAX 8':'CFM LEAP-1B28','737 MAX 9':'CFM LEAP-1B28',
  '757-200':'RB211-535E4B','757-300':'RB211-535E4B',
  '767-300ER':'CF6-80C2B7F','767-400ER':'CF6-80C2B8F',
  '777-200':'PW4077','777-200ER':'PW4090','777-300ER':'GE90-115B',
  '787-8':'GEnx-1B64','787-9':'GEnx-1B74','787-10':'GEnx-1B76'
};

/**
 * Translucent cabin colours for the aircraft modal's proportional seat bar.
 * Unknown cabins fall back to `rgba(100,116,139,.5)` at the call site.
 * @type {Record<string, string>}
 */
export const SEAT_BAR_COLORS = {
  'J':'rgba(0,93,170,.5)','F':'rgba(139,92,246,.5)',
  'PP':'rgba(20,184,166,.5)','PE':'rgba(20,184,166,.5)',
  'E+':'rgba(34,197,94,.5)','Y':'rgba(100,116,139,.5)'
};

/**
 * Solid cabin colours for the Fleet tab's seat-configuration gallery. A different
 * palette from SEAT_BAR_COLORS — do not conflate them. Unknown cabins fall back to
 * '#475569' at the call site.
 * @type {Record<string, string>}
 */
export const CABIN_COLORS = { J: '#2563eb', PP: '#0d9488', PE: '#0d9488', F: '#7c3aed', 'E+': '#16a34a', Y: '#475569', Domestic: '#6366f1' };
