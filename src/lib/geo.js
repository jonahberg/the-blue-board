// ═══ SPHERICAL GEOMETRY FOR THE LIVE MAP ═══
// Distance/bearing maths shared by route estimation, the hub-radius filter, the
// long-haul toggle and the great-circle route overlay. Pure — no Leaflet, no DOM.
//
// Extracted verbatim from src/dashboard/main.js (:912-927, :1330-1346, :1711-1751).
// main.js carried two byte-identical haversine implementations (`haversine` and
// `haversineNm`); they are one function here.
//
// This module deliberately does NOT import the airport table — airports.js depends
// on haversineNm for nearestAirport(), so the dependency runs one way only. That is
// why isLonghaul() takes its coordinate index as a parameter.

const toRad = (d) => d * Math.PI / 180;
const toDeg = (r) => r * 180 / Math.PI;

/**
 * Great-circle distance in nautical miles.
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @returns {number} distance in nm (0 for identical points).
 */
export function haversineNm(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // Earth radius in nautical miles
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Initial great-circle bearing from point 1 to point 2.
 * @returns {number} compass degrees in [0, 360).
 */
export function bearing(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Smallest angle between two compass headings.
 * @returns {number} degrees in [0, 180].
 */
export function angleDiff(a, b) { let d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }

/**
 * Interpolate a great-circle arc as `n + 1` [lat, lon] points.
 *
 * Used to draw the route line on the live map: the traveled half solid, the
 * remaining half dashed. Degenerate (coincident) endpoints short-circuit to a
 * two-point segment rather than dividing by a zero sine.
 *
 * @param {number} lat1 @param {number} lon1 @param {number} lat2 @param {number} lon2
 * @param {number} n  number of segments (the map uses 60).
 * @returns {Array<[number, number]>} points, raw longitudes (see normalizeLonContinuity).
 */
export function greatCirclePoints(lat1, lon1, lat2, lon2, n) {
  const φ1 = toRad(lat1), λ1 = toRad(lon1), φ2 = toRad(lat2), λ2 = toRad(lon2);
  const d = Math.acos(Math.min(1, Math.max(-1,
    Math.sin(φ1) * Math.sin(φ2) + Math.cos(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1)
  )));
  if (d < 1e-6) return [[lat1, lon1], [lat2, lon2]];
  const sinD = Math.sin(d);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const a = Math.sin((1 - f) * d) / sinD;
    const b = Math.sin(f * d) / sinD;
    const x = a * Math.cos(φ1) * Math.cos(λ1) + b * Math.cos(φ2) * Math.cos(λ2);
    const y = a * Math.cos(φ1) * Math.sin(λ1) + b * Math.cos(φ2) * Math.sin(λ2);
    const z = a * Math.sin(φ1) + b * Math.sin(φ2);
    pts.push([toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))]);
  }
  return pts;
}

/**
 * Normalize a polyline so longitudes are continuous (no >180° jumps).
 *
 * Leaflet handles coordinates outside [-180,180] fine — this lets transpacific
 * routes render correctly across the antimeridian instead of snapping back across
 * the whole map.
 *
 * @param {Array<[number, number]>|null|undefined} pts
 * @returns {Array<[number, number]>}
 */
export function normalizeLonContinuity(pts) {
  if (!pts || pts.length < 2) return pts || [];
  const out = [[pts[0][0], pts[0][1]]];
  for (let i = 1; i < pts.length; i++) {
    let lon = pts[i][1];
    const prevLon = out[i - 1][1];
    // Shift lon to be within ±180 of previous point
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    out.push([pts[i][0], lon]);
  }
  return out;
}

/**
 * Is this a long-haul flight? (>2500 nm between the endpoints.)
 *
 * When either endpoint is unknown, falls back to the old sub-100 flight-number
 * heuristic — United's low numbers are its long-haul trunk routes.
 *
 * @param {string|undefined} origin  origin IATA code.
 * @param {string|undefined} dest  destination IATA code.
 * @param {string|undefined} flightNum  callsign, e.g. "UAL123" (the "UAL" prefix is stripped).
 * @param {Record<string, {lat:number, lon:number}>} coords  IATA → coordinate index.
 * @returns {boolean}
 */
export function isLonghaul(origin, dest, flightNum, coords) {
  // Use airport coords to calculate distance; >2500nm = longhaul
  const orig = coords[origin];
  const dst = coords[dest];
  if (orig && dst) return haversineNm(orig.lat, orig.lon, dst.lat, dst.lon) > 2500;
  // Fallback: old flight number heuristic (sub-100) for flights without matched airports
  const num = parseInt((flightNum || '').replace(/^UAL/, ''));
  return num > 0 && num < 100;
}
