// How much of the live map the flight detail panel covers, so a "view on map" move can
// centre its target in the part of the map that is still visible (audit F20).
//
// The panel (`features/FlightSheet.tsx`) is a non-modal Sheet pinned to the VIEWPORT:
//   ≥1024px  on the right, `sm:max-w-md` = 28rem = 448px wide
//   <1024px  a bottom sheet that peeks at `max-h-[40dvh]`
// It is measured from the map's own rect against those numbers rather than from the sheet's
// DOM rect, because the move is requested in the same commit that opens the sheet — while it
// is still sliding in, its rect is wherever the enter animation happens to be.

/** FlightSheet's right-side width (`data-[side=right]:sm:max-w-md`). Keep in step. */
export const FLIGHT_PANEL_WIDTH_PX = 448;
/** FlightSheet's bottom-sheet peek height as a fraction of the viewport (`max-h-[40dvh]`). */
export const FLIGHT_PANEL_PEEK = 0.4;

/**
 * @param {{left: number, top: number, right: number, bottom: number}} mapRect  the map
 *   container's client rect.
 * @param {{width: number, height: number}} viewport  window.innerWidth / innerHeight.
 * @param {boolean} wide  the ≥1024px layout (panel on the right) vs the bottom sheet.
 * @returns {{x: number, y: number}} pixels of the map covered on its right (x) and bottom (y)
 *   edge. 0 when the panel misses the map, or covers all of it (nothing left to centre in).
 */
export function flightPanelOcclusion(mapRect, viewport, wide) {
  const width = mapRect.right - mapRect.left;
  const height = mapRect.bottom - mapRect.top;
  if (!(width > 0) || !(height > 0)) return { x: 0, y: 0 };
  if (wide) {
    const panelLeft = viewport.width - FLIGHT_PANEL_WIDTH_PX;
    const x = Math.max(0, mapRect.right - Math.max(panelLeft, mapRect.left));
    return { x: x < width ? x : 0, y: 0 };
  }
  const panelTop = viewport.height * (1 - FLIGHT_PANEL_PEEK);
  const y = Math.max(0, mapRect.bottom - Math.max(panelTop, mapRect.top));
  return { x: 0, y: y < height ? y : 0 };
}

/**
 * Where to put the map's centre so `target` (a container pixel at the map's centre) lands in
 * the middle of the uncovered area: shift the centre by half the covered span, towards it.
 * @param {{x: number, y: number}} targetPx  the target, projected at the destination zoom.
 * @param {{x: number, y: number}} occlusion  flightPanelOcclusion() output.
 * @returns {{x: number, y: number}} the centre, in the same projected pixel space.
 */
export function centreForOcclusion(targetPx, occlusion) {
  return { x: targetPx.x + occlusion.x / 2, y: targetPx.y + occlusion.y / 2 };
}
