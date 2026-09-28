// ═══ TIP STRIP ═══
// The rotating one-liner in the dashboard's engagement slot. Copy is per-tab; anything the
// map doesn't cover falls back to the Live pool. The strip's DOM, dismissal storage and
// timers live in src/app/features/TipStrip.tsx — only the copy, the pick rule and the two
// timing constants live here.
//
// The copy describes the v1.8 UI: the flight panel replaced map popups, the Live sidebar is
// the Filters sheet on phones, and IROPS comes from the server rather than from boards the
// visitor loaded. Tips are written with "Click"; `tipForPointer` turns that into "Tap" on a
// touch screen.

/** @type {Record<string, string[]>} */
export const TIPS = {
  'tab-live': [
    'Click any plane for its flight details, then its registration (N-number) for seat config & Starlink status',
    'Click a hub under "Hub traffic" (in Filters on a phone) to show only that hub\'s flights',
    'Turn on the 🌧 Radar layer above the map for the NEXRAD weather overlay'
  ],
  'tab-schedule': [
    'Open the board\'s filters to narrow by fleet, aircraft type or Starlink WiFi',
    'Click any registration in the schedule table to see full aircraft details'
  ],
  'tab-myflight': [
    'Watch 2+ connecting flights and we\'ll automatically check your connection risk',
    'The "Where\'s My Plane?" section shows the inbound aircraft for your watched flight'
  ],
  'tab-weather': [
    'The IROPS bar sums up how disrupted United\'s network is right now: cancellations, diversions and long delays'
  ],
  'tab-fleet': [
    'Click any fleet type chip to filter the aircraft database instantly'
  ]
};

/**
 * Word the tip for the visitor's pointer: "Click" on a mouse, "Tap" on a touch screen.
 *
 * @param {string} tip
 * @param {boolean} coarse  true when the primary pointer is a finger (`(pointer: coarse)`).
 * @returns {string}
 */
export function tipForPointer(tip, coarse) {
  if (!coarse) return tip;
  return tip.replace(/\bClick\b/g, 'Tap').replace(/\bclick\b/g, 'tap');
}

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
