// ═══ THE FLEET TAB'S SLICE OF A DASHBOARD ADDRESS ═══
// `?type=` / `?filter=` (a status shortcut or an aircraft type, resolved by the Fleet view against
// its own controls) and `?view=airborne|special|express` (a Fleet sub-view) name rows inside the
// Fleet tab. `?view=starlink` is tab routing and is not read here.
//
// One reading for every way in: a cold load (the UI store holds the address the page opened on,
// `coldFleetLink` in src/app/state/ui.tsx) and a link followed in place (`resolveDeepLink`,
// src/app/state/deep-links.ts). It lives here, with no imports, so the UI store can read it at
// startup without importing the deep-link module (which reaches the dialogs, and through them the
// UI store itself).
//
// DOM-free; tested in tests/fleet-address.test.js.

const FLEET_VIEWS = Object.freeze(['airborne', 'special', 'express']);

/**
 * The Fleet tab's slice of a query string.
 *
 * @param {URLSearchParams} params
 * @returns {{filter: string | null, view: 'airborne' | 'special' | 'express' | null}}
 */
export function fleetDeepLinksFrom(params) {
  const view = params.get('view')?.toLowerCase() ?? '';
  return {
    filter: params.get('type') ?? params.get('filter'),
    view: FLEET_VIEWS.includes(view) ? /** @type {'airborne' | 'special' | 'express'} */ (view) : null,
  };
}
