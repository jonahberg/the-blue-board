// ═══ TIP STRIP ═══
// The rotating one-liner capsule under the header. Copy is per-tab; anything the
// map doesn't cover falls back to the Live pool.
//
// Extracted verbatim from src/dashboard/main.js (:7729-7791). The strip's DOM
// wiring, dismissal storage and timers stay in main.js — only the copy, the pick
// rule and the two timing constants live here.

/** @type {Record<string, string[]>} */
export const TIPS = {
  'tab-live': [
    'Click any aircraft registration (N-number) in a popup to see full details, seat config & Starlink status',
    'Click a hub name in the sidebar to filter the map to just that hub\'s flights',
    'Toggle the weather radar overlay with the rain cloud button on the map'
  ],
  'tab-schedule': [
    'Use "Filter: Fleet, Aircraft, Starlink…" to narrow by family, equipment, or WiFi',
    'Click any registration in the schedule table to see full aircraft details'
  ],
  'tab-myflight': [
    'Watch 2+ connecting flights and we\'ll automatically check your connection risk',
    'The "Where\'s My Plane?" section shows the inbound aircraft for your watched flight'
  ],
  'tab-weather': [
    'Load schedule data in the Schedule tab to unlock the IROPS disruption monitor'
  ],
  'tab-fleet': [
    'Click any fleet type chip to filter the aircraft database instantly'
  ]
};

/** How often the strip swaps tip. */
export const TIP_ROTATE_MS = 45000;

/** How long a dismissal suppresses the strip, in days. */
export const TIP_DISMISS_DAYS = 7;

/**
 * Pick a random tip for a tab, falling back to the Live pool for tabs with no tips.
 *
 * @param {string|undefined} tabId  e.g. 'tab-schedule'.
 * @param {() => number} [rng]  injectable [0,1) source; defaults to Math.random.
 * @returns {string}
 */
export function pickTip(tabId, rng = Math.random) {
  const pool = TIPS[tabId] || TIPS['tab-live'];
  return pool[Math.floor(rng() * pool.length)];
}
