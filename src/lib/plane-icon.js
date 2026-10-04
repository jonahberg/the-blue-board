// ═══ PLANE MARKER ICON ═══
// The SVG and colour rules behind every aircraft marker on the live map.
//
// Extracted verbatim from src/dashboard/main.js (:1348-1373). Pure data out — no
// Leaflet: main.js wraps the returned svg in L.divIcon with the rotation transform
// and keeps the icon cache keyed on `key`.
//
// Starlink marker treatment: distinct violet FILL, no glow halo (owner Jul 4 2026 —
// the stacked drop-shadow "orb" look is gone). Fill priority: watched green →
// Starlink violet → long-haul amber → United Express (airborne) → phase color.
// Accepted trade-off: phase color is not visible on Starlink aircraft — the popup
// and the Starlink-only filter still carry it.
//
// United Express (v1.14.0): the regional operators fly smaller jets, so an AIRBORNE
// Express flight draws in the dashboard's foreground white — the one DESIGN.md token
// that is not already a status hue (amber, green, violet), not the mainline blue family
// (bb-info sits ~20° from it) and not the alarm red — at 85% size. The size cue applies
// even when Starlink violet wins the fill: on the Oct 4 2026 feed 171 of 225 Express
// flights were Starlink aircraft, so colour alone would have left three in four Express
// jets looking exactly like a mainline Starlink 737. Watched and long-haul keep their
// own sizes. On the ground an Express flight reads as ground like every other
// aircraft: slate, full size.
//
// The map legend (src/app/views/live/MapLegend.tsx) draws its swatches from
// PLANE_LEGEND below, which runs every row through planeIconSpec itself, so the key
// cannot drift from the markers.

// SVG plane pointing north (0°) — classic top-down aircraft silhouette, cross-platform consistent
export const PLANE_PATH = 'M128 16c-4 0-8 3-9 7l-15 72-88 34c-3 1-4 4-4 7s2 5 5 6l87 20 4 52-28 18c-2 1-3 3-3 5v8c0 2 1 4 3 4l20-6h28l20 6c2 0 3-2 3-4v-8c0-2-1-4-3-5l-28-18 4-52 87-20c3-1 5-3 5-6s-1-6-4-7l-88-34-15-72c-1-4-5-7-9-7z';

/** Marker fills, one per state. The only sanctioned hex for the map's aircraft. */
export const PLANE_COLORS = Object.freeze({
  watched: '#22c55e',
  starlink: '#A78BFA',
  longhaul: '#fbbf24',
  /** --foreground (oklch(0.985 0 0)) as hex. */
  express: '#FAFAFA',
  ground: '#64748B',
  airborne: '#6BAAED',
});

/** Marker edge length in CSS px. */
export const PLANE_SIZES = Object.freeze({
  watched: 16,
  longhaul: 14,
  /** 85% of the default — regional jets are the small ones. */
  express: 8.5,
  default: 10,
});

/**
 * Build the marker spec for one aircraft.
 *
 * @param {number|null|undefined} hdg  track in degrees (missing → 0).
 * @param {{longhaul?: boolean, phase?: string, watched?: boolean, starlink?: boolean, express?: boolean}} flags
 * @returns {{size: number, fill: string, svg: string, key: string, hdgRounded: number}}
 *   `hdgRounded` is the heading snapped to 5° — the caller needs it for the rotation
 *   transform, and it is already baked into `key`.
 */
export function planeIconSpec(hdg, { longhaul, phase, watched, starlink, express } = {}) {
  // Round heading to nearest 5° to maximize cache hits
  const hdgRounded = Math.round((hdg || 0) / 5) * 5;
  const key = `${hdgRounded}|${longhaul ? 1 : 0}|${phase}|${watched ? 1 : 0}|${starlink ? 1 : 0}|${express ? 1 : 0}`;
  const ground = phase === 'Ground';
  const expressAirborne = Boolean(express) && !ground;
  // The Express FILL only when nothing ranks above it; the Express SIZE whenever it is airborne
  // and not watched or long-haul — so a Starlink Express jet is a small violet plane.
  const fill = watched ? PLANE_COLORS.watched
    : starlink ? PLANE_COLORS.starlink
    : longhaul ? PLANE_COLORS.longhaul
    : expressAirborne ? PLANE_COLORS.express
    : (ground ? PLANE_COLORS.ground : PLANE_COLORS.airborne);
  const size = watched ? PLANE_SIZES.watched
    : longhaul ? PLANE_SIZES.longhaul
    : expressAirborne ? PLANE_SIZES.express
    : PLANE_SIZES.default;
  const filter = `drop-shadow(0 0 2px ${fill})`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256" fill="${fill}" style="filter:${filter}"><path d="${PLANE_PATH}"/></svg>`;
  return { size, fill, svg, key, hdgRounded };
}

/**
 * The map key: every marker state, in precedence order, with the flags that produce it.
 * `fill` and `size` are computed by planeIconSpec from `flags` — never typed twice.
 *
 * @type {ReadonlyArray<{id: 'watched'|'starlink'|'longhaul'|'express'|'airborne'|'ground',
 *   label: string, flags: object, fill: string, size: number}>}
 */
export const PLANE_LEGEND = Object.freeze(
  [
    { id: 'watched', label: 'Watching', flags: { watched: true } },
    { id: 'starlink', label: 'Starlink Wi-Fi', flags: { starlink: true } },
    { id: 'longhaul', label: 'Long-haul (> 2,500 nm)', flags: { longhaul: true } },
    { id: 'express', label: 'United Express', flags: { express: true } },
    { id: 'airborne', label: 'Mainline, airborne', flags: {} },
    { id: 'ground', label: 'On the ground', flags: { phase: 'Ground' } },
  ].map((row) => {
    const { fill, size } = planeIconSpec(0, row.flags);
    return Object.freeze({ ...row, flags: Object.freeze(row.flags), fill, size });
  }),
);

/**
 * The legend rows that can appear on the map right now. By default the map draws mainline vs
 * United Express (plus ground and anything you watch); Starlink violet and long-haul amber are
 * highlights you switch on, so their rows appear only while that highlight is on — a key row for
 * a colour the map is not drawing would just be a puzzle.
 *
 * @param {{longhaulLayer?: boolean, starlinkLayer?: boolean}} state
 * @returns {Array<(typeof PLANE_LEGEND)[number]>}
 */
export function visibleLegendRows({ longhaulLayer = false, starlinkLayer = false } = {}) {
  return PLANE_LEGEND.filter((row) =>
    row.id === 'longhaul' ? longhaulLayer : row.id === 'starlink' ? starlinkLayer : true,
  );
}
