// ═══ LIVE MAP REGION PRESETS ═══
// The "fly to" list on the Live map's toolbar. Until v1.14.0 the only preset was a Pacific
// toggle; a Reddit commenter asked, fairly, about Europe, Africa, East and Southeast Asia,
// Oceania, Central and South America and the Caribbean.
//
// Each preset is a bounding box drawn around where United actually flies in that region
// (airports named per row), not around the continent — Leaflet's fitBounds then picks the
// zoom for whatever size the map is, so one box serves a 360 px phone and a 1440 px desktop.
// Pure data and maths: no Leaflet, no DOM.
//
// Boxes are written with longitudes in [-180, 180]. A box whose east edge is WEST of its west
// edge crosses the antimeridian (Oceania, Pacific); regionBounds() runs the corners through
// normalizeLonContinuity — the same continuity rule the route line uses — so the east edge
// comes back past 180° and Leaflet frames the ocean instead of the whole world. That only
// works for boxes under 180° wide, which the tests pin.

import { normalizeLonContinuity } from './geo.js';

/** The preset the map opens on, and where an unknown or legacy value lands. */
export const DEFAULT_REGION_ID = 'us';

/**
 * @typedef {{id: string, label: string, short: string,
 *   box: {south: number, west: number, north: number, east: number}}} MapRegion
 */

/** @type {ReadonlyArray<MapRegion>} In menu order: home, then east around the globe. */
export const MAP_REGIONS = Object.freeze(
  [
    // The lower 48 — the map's opening view.
    { id: 'us', label: 'United States', short: 'US', box: { south: 24.5, west: -125, north: 49.5, east: -66.5 } },
    // MEX GDL PVR SJD CUN MTY · GUA SAL SAP RTB BZE MGA LIR SJO PTY
    { id: 'central-america', label: 'Mexico & Central America', short: 'Mexico & C. America', box: { south: 6.5, west: -118, north: 32.5, east: -77 } },
    // NAS HAV GCM MBJ PUJ SDQ SJU STT SXM ANU AUA CUR BGI POS
    { id: 'caribbean', label: 'Caribbean', short: 'Caribbean', box: { south: 9.5, west: -86, north: 27.5, east: -58.5 } },
    // BOG MDE CTG UIO GYE LIM SCL EZE GRU GIG
    { id: 'south-america', label: 'South America', short: 'S. America', box: { south: -56, west: -82, north: 13, east: -34 } },
    // The North Atlantic tracks plus Europe: GOH KEF FNC LIS … ATH IST OTP
    { id: 'europe', label: 'Atlantic & Europe', short: 'Europe', box: { south: 32, west: -60, north: 66, east: 32 } },
    // DSS RAK ACC LOS JNB CPT
    { id: 'africa', label: 'Africa', short: 'Africa', box: { south: -35, west: -20, north: 37, east: 52 } },
    // TLV AMM DXB · DEL BOM BLR
    { id: 'middle-east-india', label: 'Middle East & India', short: 'Mideast & India', box: { south: 8, west: 28, north: 42, east: 90 } },
    // NRT HND KIX NGO FUK ICN PVG PEK TPE HKG
    { id: 'east-asia', label: 'East Asia', short: 'East Asia', box: { south: 20, west: 108, north: 46, east: 148 } },
    // MNL CEB SGN BKK SIN DPS
    { id: 'southeast-asia', label: 'Southeast Asia', short: 'SE Asia', box: { south: -10, west: 95, north: 23, east: 130 } },
    // SYD MEL BNE ADL AKL CHC NAN — crosses the antimeridian to reach Fiji.
    { id: 'oceania', label: 'Oceania', short: 'Oceania', box: { south: -48, west: 110, north: -5, east: -170 } },
    // GUM SPN ROR, the Micronesia island hopper, HNL OGG KOA LIH, PPT, and the North Pacific
    // tracks to the US West Coast — crosses the antimeridian.
    { id: 'pacific', label: 'Pacific', short: 'Pacific', box: { south: -20, west: 125, north: 55, east: -115 } },
  ].map((region) => Object.freeze({ ...region, box: Object.freeze(region.box) })),
);

const BY_ID = new Map(MAP_REGIONS.map((region) => [region.id, region]));

/**
 * Old or loose names → a preset id. The Pacific toggle was a map-layer key called 'pacific'
 * (never persisted — LiveView kept it in local state), so 'pacific' maps straight across.
 */
const ALIASES = Object.freeze({
  usa: 'us',
  conus: 'us',
  'united-states': 'us',
  atlantic: 'europe',
  'atlantic-europe': 'europe',
  'middle-east': 'middle-east-india',
  india: 'middle-east-india',
  asia: 'east-asia',
  'se-asia': 'southeast-asia',
  australia: 'oceania',
  'central-america-mexico': 'central-america',
  'mexico-central-america': 'central-america',
  mexico: 'central-america',
  'latin-america': 'south-america',
});

/**
 * A safe preset id from anything: a current id, a legacy or loose name, any casing, or garbage.
 * Never throws; an unknown value is the default region.
 *
 * @param {unknown} value
 * @returns {string}  an id present in MAP_REGIONS.
 */
export function resolveRegionId(value) {
  if (typeof value !== 'string') return DEFAULT_REGION_ID;
  const key = value.trim().toLowerCase().replace(/[\s_&]+/g, '-').replace(/-+/g, '-');
  if (BY_ID.has(key)) return key;
  const alias = Object.prototype.hasOwnProperty.call(ALIASES, key) ? ALIASES[key] : null;
  return alias ?? DEFAULT_REGION_ID;
}

/**
 * The preset for an id (resolved through resolveRegionId, so never undefined).
 * @param {unknown} id
 * @returns {MapRegion}
 */
export function getRegion(id) {
  return /** @type {MapRegion} */ (BY_ID.get(resolveRegionId(id)));
}

/** Does this preset's box cross the antimeridian (east edge west of the west edge)? */
export function crossesAntimeridian(id) {
  const { box } = getRegion(id);
  return box.east < box.west;
}

/**
 * Leaflet-ready corners for a preset: `[[south, west], [north, east]]`, with the east edge
 * made continuous with the west edge, so an antimeridian box's east longitude exceeds 180.
 *
 * @param {unknown} id
 * @returns {[[number, number], [number, number]]}
 */
export function regionBounds(id) {
  const { box } = getRegion(id);
  const [sw, ne] = normalizeLonContinuity([
    [box.south, box.west],
    [box.north, box.east],
  ]);
  return [
    [sw[0], sw[1]],
    [ne[0], ne[1]],
  ];
}
