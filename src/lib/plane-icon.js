// ═══ PLANE MARKER ICON ═══
// The SVG and colour rules behind every aircraft marker on the live map.
//
// Extracted verbatim from src/dashboard/main.js (:1348-1373). Pure data out — no
// Leaflet: main.js wraps the returned svg in L.divIcon with the rotation transform
// and keeps the icon cache keyed on `key`.
//
// Starlink marker treatment: distinct violet FILL, no glow halo (owner Jul 4 2026 —
// the stacked drop-shadow "orb" look is gone). Fill priority: watched green →
// Starlink violet → long-haul amber → phase color. Accepted trade-off: phase color
// is not visible on Starlink aircraft — the popup and the Starlink-only filter still
// carry it.

// SVG plane pointing north (0°) — classic top-down aircraft silhouette, cross-platform consistent
const PLANE_PATH = 'M128 16c-4 0-8 3-9 7l-15 72-88 34c-3 1-4 4-4 7s2 5 5 6l87 20 4 52-28 18c-2 1-3 3-3 5v8c0 2 1 4 3 4l20-6h28l20 6c2 0 3-2 3-4v-8c0-2-1-4-3-5l-28-18 4-52 87-20c3-1 5-3 5-6s-1-6-4-7l-88-34-15-72c-1-4-5-7-9-7z';

/**
 * Build the marker spec for one aircraft.
 *
 * @param {number|null|undefined} hdg  track in degrees (missing → 0).
 * @param {{longhaul?: boolean, phase?: string, watched?: boolean, starlink?: boolean}} flags
 * @returns {{size: number, fill: string, svg: string, key: string, hdgRounded: number}}
 *   `hdgRounded` is the heading snapped to 5° — the caller needs it for the rotation
 *   transform, and it is already baked into `key`.
 */
export function planeIconSpec(hdg, { longhaul, phase, watched, starlink } = {}) {
  // Round heading to nearest 5° to maximize cache hits
  const hdgRounded = Math.round((hdg || 0) / 5) * 5;
  const key = `${hdgRounded}|${longhaul ? 1 : 0}|${phase}|${watched ? 1 : 0}|${starlink ? 1 : 0}`;
  const fill = watched ? '#22c55e'
    : starlink ? '#A78BFA'
    : longhaul ? '#fbbf24'
    : (phase === 'Ground' ? '#64748B' : '#6BAAED');
  const size = watched ? 16 : (longhaul ? 14 : 10);
  const filter = `drop-shadow(0 0 2px ${fill})`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256" fill="${fill}" style="filter:${filter}"><path d="${PLANE_PATH}"/></svg>`;
  return { size, fill, svg, key, hdgRounded };
}
