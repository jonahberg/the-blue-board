// ═══ FRAMING A REGION ON A PORTRAIT MAP ═══
// A phone's Live map is about 390 px wide and 500 px tall, and the lower 48 are twice as wide as
// they are tall. Fit by width, the country takes a third of the height whatever the centre, and
// Leaflet's fitBounds centres it, so the first screen spent its top third on southern Canada,
// where United flies little (owner, Nov 2026). This frames the box by width, puts its north edge
// just under the toolbar, and lets the spare height fall south — Mexico, the Gulf and the
// Caribbean, where the traffic is. When the box is height-bound instead (a landscape phone) it is
// simply centred. Spherical Mercator (EPSG:3857, 256 px tiles), as Leaflet draws it. Pure maths:
// no Leaflet, no DOM.

const TILE = 256;

/** Mercator northing of a latitude, in radians of the projected plane. */
function mercN(latDeg) {
  const phi = (latDeg * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + phi / 2));
}

/** Latitude of a Mercator northing. */
function latOf(n) {
  return ((2 * Math.atan(Math.exp(n)) - Math.PI / 2) * 180) / Math.PI;
}

/**
 * The view that frames `box` in a `size` map, north-anchored when the box is width-bound.
 *
 * @param {{south: number, west: number, north: number, east: number}} box  degrees; west < east.
 * @param {{x: number, y: number}} size  the map's size in px.
 * @param {{top?: number, bottom?: number, side?: number, snap?: number}} [opts]
 *   `top`/`bottom`/`side` keep the box clear of overlaid controls (px); `snap` is Leaflet's
 *   `zoomSnap` — the zoom is floored to a multiple of it, so the box never overflows.
 * @returns {{center: [number, number], zoom: number, anchored: boolean} | null}
 *   null for a map with no size yet.
 */
export function northAnchoredView(box, size, { top = 0, bottom = 0, side = 0, snap = 1 } = {}) {
  const availX = size.x - 2 * side;
  const availY = size.y - top - bottom;
  if (!(availX > 0) || !(availY > 0)) return null;

  const spanX = (box.east - box.west) / 360; // fraction of the world's width
  const spanY = (mercN(box.north) - mercN(box.south)) / (2 * Math.PI); // fraction of its height
  const zx = Math.log2(availX / (spanX * TILE));
  const zy = Math.log2(availY / (spanY * TILE));
  const raw = Math.min(zx, zy);
  const zoom = snap > 0 ? Math.floor(raw / snap + 1e-9) * snap : raw;
  // Two decimals: floating-point snaps (0.1 × 31) should read as 3.1, not 3.1000000000000005.
  const z = Math.round(zoom * 100) / 100;

  const scale = TILE * 2 ** z;
  const lon = (box.west + box.east) / 2;
  // Width-bound: the spare is height, and it goes south. Height-bound: nothing to spare, centre.
  const anchored = zx <= zy;
  const yOf = (latDeg) => (0.5 - mercN(latDeg) / (2 * Math.PI)) * scale;
  // Anchored: the north edge sits `top` px below the map's top. Otherwise the box is centred in
  // the space the overlays leave. Either way the map's centre is half a map below its top edge.
  const mapTopY = anchored ? yOf(box.north) - top : (yOf(box.north) + yOf(box.south)) / 2 - (top + availY / 2);
  const centreY = mapTopY + size.y / 2;
  const lat = latOf((0.5 - centreY / scale) * 2 * Math.PI);
  return { center: [lat, lon], zoom: z, anchored };
}
