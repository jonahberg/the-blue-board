// @ts-check
/**
 * Build-time map projection for the tracker pages' inline SVG US map.
 *
 * A composite Albers equal-area projection in the style of d3's albersUsa (same standard
 * parallels and inset placement), implemented locally so the pages take no map dependency.
 * The outline (src/data/trackers/us-outline.json, Natural Earth 110m, public domain) and the
 * airport dots are projected by the SAME functions, so they can never drift apart even if the
 * constants differ slightly from canonical d3.
 *
 * Off-map airports (outside CONUS/AK/HI — e.g. SJU, GUM) return null from projectPoint and are
 * rendered by the page as a "beyond the map" strip instead.
 */

export const VIEW = { w: 960, h: 600 };

const RAD = Math.PI / 180;
const K = 1245; // base scale for the 960x600 viewBox (bounds-checked in tests)
const TX = VIEW.w / 2;
const TY = VIEW.h / 2;

/**
 * Spherical Albers conic equal-area, d3-style parameterization.
 * @param {{parallels: [number, number], rotate: number, center: [number, number], scale: number, translate: [number, number]}} cfg
 */
function conicEqualArea({ parallels: [p1, p2], rotate, center, scale, translate }) {
  const f1 = p1 * RAD;
  const f2 = p2 * RAD;
  const n = (Math.sin(f1) + Math.sin(f2)) / 2;
  const C = Math.cos(f1) ** 2 + 2 * n * Math.sin(f1);
  const rho = (/** @type {number} */ phi) => Math.sqrt(Math.max(0, C - 2 * n * Math.sin(phi))) / n;
  const rho0 = Math.sqrt(C) / n;
  /**
   * raw projection on the rotated sphere, y up
   * @param {number} lambda @param {number} phi @returns {[number, number]}
   */
  const raw = (lambda, phi) => {
    const r = rho(phi);
    const theta = n * lambda;
    return [r * Math.sin(theta), rho0 - r * Math.cos(theta)];
  };
  const [rcx, rcy] = raw(center[0] * RAD, center[1] * RAD);
  /** @param {number} lng @param {number} lat @returns {[number, number]} */
  return (lng, lat) => {
    let lambda = lng + rotate;
    if (lambda > 180) lambda -= 360;
    if (lambda < -180) lambda += 360;
    const [rx, ry] = raw(lambda * RAD, lat * RAD);
    return [translate[0] + scale * (rx - rcx), translate[1] - scale * (ry - rcy)];
  };
}

const lower48 = conicEqualArea({
  parallels: [29.5, 45.5],
  rotate: 96,
  center: [-0.6, 38.7],
  scale: K,
  translate: [TX, TY],
});

const alaska = conicEqualArea({
  parallels: [55, 65],
  rotate: 154,
  center: [-2, 58.5],
  scale: K * 0.35,
  translate: [TX - 0.307 * K, TY + 0.201 * K],
});

const hawaii = conicEqualArea({
  parallels: [8, 18],
  rotate: 157,
  center: [-3, 19.9],
  scale: K,
  translate: [TX - 0.205 * K, TY + 0.212 * K],
});

/** @param {number} lng @param {number} lat @returns {'conus'|'alaska'|'hawaii'|null} */
export function regionFor(lng, lat) {
  if (lat > 50 && (lng < -128 || lng > 170)) return 'alaska';
  if (lat < 25 && lat > 15 && lng < -150) return 'hawaii';
  if (lat >= 24 && lat <= 50 && lng >= -125 && lng <= -66) return 'conus';
  return null;
}

/**
 * Project a lng/lat to viewBox coordinates, or null if outside the mapped regions.
 * @param {number} lng @param {number} lat
 * @returns {{x: number, y: number, region: 'conus'|'alaska'|'hawaii'} | null}
 */
export function projectPoint(lng, lat) {
  const region = regionFor(lng, lat);
  if (!region) return null;
  const proj = region === 'alaska' ? alaska : region === 'hawaii' ? hawaii : lower48;
  const [x, y] = proj(lng, lat);
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, region };
}

/** @param {[number, number][]} ring @param {(lng: number, lat: number) => [number, number]} proj */
function ringToPath(ring, proj) {
  return (
    ring
      .map(([lng, lat], i) => {
        const [x, y] = proj(lng, lat);
        return `${i === 0 ? 'M' : 'L'}${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`;
      })
      .join('') + 'Z'
  );
}

/**
 * Build SVG path strings for the US outline asset.
 * @param {{conus: [number, number][][], alaska: [number, number][][], hawaii: [number, number][][]}} outline
 * @returns {{conus: string, alaska: string, hawaii: string}}
 */
export function outlinePaths(outline) {
  return {
    conus: outline.conus.map((r) => ringToPath(r, lower48)).join(''),
    alaska: outline.alaska.map((r) => ringToPath(r, alaska)).join(''),
    hawaii: outline.hawaii.map((r) => ringToPath(r, hawaii)).join(''),
  };
}
