// ═══ FLEET UTILITIES ═══
// Pure data functions extracted from src/dashboard/main.js for testability.

// ─── Fleet Health Categorization ───
export const FLEET_HEALTH_CATEGORIES = [
  { key: 'active',          label: 'Active',           color: '#22c55e' },
  { key: 'maintenance',     label: 'Maintenance',      color: '#eab308' },
  { key: 'stored',          label: 'Stored',            color: '#ef4444' },
  { key: 'next_retrofit',   label: 'NEXT Retrofit',     color: '#8b5cf6' },
  { key: 'painting',        label: 'Painting',          color: '#06b6d4' },
  { key: 'starlink_install',label: 'Starlink Install',  color: '#10b981' },
  { key: 'future_gum',      label: 'Future GUM',        color: '#f97316' }
];

export function categorizeFleetStatus(s) {
  if (!s) return 'active';
  if (s.startsWith('*')) return 'active';
  if (/100 Year Sticker|Eco Demonstrator/i.test(s)) return 'active';
  if (/stored/i.test(s)) return 'stored';
  if (/\bpaint\b/i.test(s)) return 'painting';
  if (/starlink/i.test(s)) return 'starlink_install';
  if (/\bmod\s*next\b/i.test(s)) return 'next_retrofit';
  if (/future\s*gum/i.test(s)) return 'future_gum';
  if (/maint|induction/i.test(s)) return 'maintenance';
  // Notes about NEXT status (Partial NEXT, NEXT???, Confirmed w.o NEXT) — aircraft is active
  if (/next/i.test(s)) return 'active';
  // Remaining non-empty statuses are likely maintenance at MRO locations
  if (s.trim()) return 'maintenance';
  return 'active';
}

// ─── Fleet Families ───
export const FLEET_FAMILIES = [
  { id: 'boeing-737', name: 'BOEING 737', role: 'Domestic backbone', subgroups: [
    { label: 'NG', types: ['737-700','737-800','737-900','737-900ER'] },
    { label: 'MAX', types: ['737 MAX 8','737 MAX 9'] }
  ]},
  { id: 'airbus-a320', name: 'A320 FAMILY', role: 'Domestic fleet', subgroups: [
    { label: 'Legacy', types: ['A319','A320'] },
    { label: 'Neo', types: ['A321neo'] }
  ]},
  { id: 'boeing-757', name: 'BOEING 757', role: 'Premium transcon & Hawaii', routeCallout: 'ORD-LAX · EWR-SFO · West Coast-HNL', subgroups: [
    { label: null, types: ['757-200','757-300'] }
  ]},
  { id: 'boeing-767', name: 'BOEING 767', role: 'Transatlantic', routeCallout: 'EWR & IAD to Europe', widebody: true, subgroups: [
    { label: null, types: ['767-300ER','767-400ER'] }
  ]},
  { id: 'boeing-777', name: 'BOEING 777', role: 'Flagship long-haul · Polaris', widebody: true, subgroups: [
    { label: null, types: ['777-200','777-200ER','777-300ER'] }
  ]},
  { id: 'boeing-787', name: '787 DREAMLINER', role: 'Long-haul · newest widebody', widebody: true, subgroups: [
    { label: null, types: ['787-8','787-9','787-10'] }
  ]}
];

// ─── WiFi Normalization ───
export const WIFI_DISPLAY = {
  'Sat KA': 'Satellite Ka', 'Satl Ka': 'Satellite Ka',
  'Satl Ka US': 'Satellite Ka (US)',
  'Satl KU': 'Satellite Ku', 'Satl Ku': 'Satellite Ku',
  'ViaSatKA': 'ViaSat Ka',
  'Starlink': 'Starlink', 'NO': 'NO'
};

export function normalizeWifi(raw) {
  return WIFI_DISPLAY[raw] || raw;
}

// The base fleet registry changes more slowly than the live Starlink feed. Reconcile the WiFi
// label from the stronger live signal so confirmed retrofits do not simultaneously show
// "ViaSat Ka" in the fleet table/modal and "Starlink: Yes" beside it.
export function applyStarlinkWifiOverlay(fleetDb, starlinkTails) {
  if (!Array.isArray(fleetDb) || !starlinkTails) return fleetDb;
  return fleetDb.map((aircraft) => (
    starlinkTails.has(aircraft.r) && aircraft.w !== 'Starlink'
      ? { ...aircraft, w: 'Starlink' }
      : aircraft
  ));
}

// ─── Fleet Sort ───
// Numeric column keys that should be compared as integers
const NUMERIC_SORT_COLS = new Set(['tot', 'd', 'a']);

export function sortFleetData(data, sortCol, sortAsc) {
  return [...data].sort((a, b) => {
    let va = a[sortCol] || '', vb = b[sortCol] || '';
    if (NUMERIC_SORT_COLS.has(sortCol)) {
      va = parseInt(va) || 0;
      vb = parseInt(vb) || 0;
    }
    const d = va < vb ? -1 : va > vb ? 1 : 0;
    return sortAsc ? d : -d;
  });
}

// ─── Fleet Table Filtering ───
export function filterFleetData(fleetDb, { type, wifi, status, search, starlinkTails, specialAircraftSet }) {
  const searchUpper = search ? search.toUpperCase() : '';
  return fleetDb.filter(a => {
    if (type && a.t !== type) return false;
    if (wifi && normalizeWifi(a.w) !== wifi) return false;
    if (status === 'active' && a.s) return false;
    if (status === 'stored' && !a.s) return false;
    if (status === 'starlink' && !(starlinkTails && starlinkTails.has(a.r))) return false;
    if (status === 'special' && !(specialAircraftSet && specialAircraftSet.has(a.r))) return false;
    if (searchUpper) {
      // Records from the fleet DB occasionally arrive with missing fields;
      // .toUpperCase() on undefined throws. Coerce defensively so a partial
      // row is filtered out cleanly instead of crashing the whole list.
      const r = (a.r || '').toUpperCase();
      const c = (a.c || '').toUpperCase();
      const t = (a.t || '').toUpperCase();
      if (!r.includes(searchUpper) && !c.includes(searchUpper) && !t.includes(searchUpper)) return false;
    }
    return true;
  });
}

/** Aircraft of one family subgroup, from a type → count map. */
export function subgroupTotal(subgroup, counts) {
  return (subgroup?.types || []).reduce((n, t) => n + ((counts && counts[t]) || 0), 0);
}

/** Aircraft of one `FLEET_FAMILIES` family, from a type → count map (F112). */
export function familyTotal(family, counts) {
  return (family?.subgroups || []).reduce((sum, sg) => sum + subgroupTotal(sg, counts), 0);
}

// ─── The fleet database's age ───
/**
 * The day `/data/fleet.json` last changed (git: a10369d). It is a hand-maintained snapshot of
 * the United Fleet Site sheet with no refresh job, so every label that describes it says
 * "as of" this date — never "updated daily" (F86).
 */
export const FLEET_DB_AS_OF = '2026-02-12';

/** '2026-02-12' → '12 Feb 2026' (UTC, so the label never shifts a day in a western zone). */
export function formatFleetAsOf(iso = FLEET_DB_AS_OF) {
  const d = new Date(`${iso}T00:00:00Z`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// ─── Fleet utilization — THE definition ───
/**
 * Mainline ICAO type designators as the live feed reports them. An airborne United-callsign
 * flight of one of these types that the fleet database cannot match is a mainline airframe
 * missing from the (stale) database — not a regional/partner flight.
 */
export const MAINLINE_ICAO_TYPES = new Set([
  'A319', 'A320', 'A321', 'A21N',
  'B737', 'B738', 'B739', 'B38M', 'B39M',
  'B752', 'B753', 'B763', 'B764',
  'B772', 'B77L', 'B77W', 'B778', 'B779',
  'B788', 'B789', 'B78X',
]);

/**
 * Fleet utilization, the ONE definition every tab uses (Live stat bar, Stats card, Fleet
 * pulse — F8/F67/F92):
 *
 *   utilization = airborne flights that resolve to an airframe in the fleet database
 *                 ÷ airframes in the fleet database
 *
 * Numerator and denominator are the same population (mainline airframes we can name).
 * United Express/partner flights are excluded from the numerator because they are not in
 * the denominator; counting them was how Live/Stats said 25% while Fleet said 20%.
 *
 * The unmatched remainder is split so the UI can say what it is: `notInDb` are mainline types
 * under a UAL callsign (new deliveries the database has not caught up with), `regional` is
 * everything else.
 *
 * @param {Array<Object>} airborne  flights already known to be off the ground.
 * @param {number} fleetSize  fleet database length; 0 until it loads.
 * @param {(f: any) => Object|null} matchAircraft  flight → fleet row, or null.
 * @returns {{matched: number, notInDb: number, regional: number, total: number, pct: number|null}}
 *   pct is null while the fleet database is empty.
 */
export function fleetUtilization(airborne, fleetSize, matchAircraft) {
  let matched = 0, notInDb = 0, regional = 0;
  for (const f of airborne || []) {
    if (matchAircraft(f)) matched++;
    else if (isMainlineNotInDb(f)) notInDb++;
    else regional++;
  }
  const total = fleetSize || 0;
  return { matched, notInDb, regional, total, pct: total > 0 ? Math.round((matched / total) * 100) : null };
}

function isMainlineNotInDb(f) {
  const cs = String(f?.callsign || '').toUpperCase();
  return /^UAL\d/.test(cs) && MAINLINE_ICAO_TYPES.has(String(f?.acType || '').toUpperCase());
}

// ─── Starlink % — THE definition ───
/**
 * Starlink share of the mainline fleet, the ONE definition the Fleet ring and its "Mainline
 * Fleet" chip both render (F93):
 *
 *   mainline Starlink aircraft ÷ mainline fleet, both from the SAME population.
 *
 * With the tracker's fleet stats that is `mainline / mainlineTotal` (the Starlink tab's own
 * figure). Without them it falls back to the fleet database: airframes in it that are on the
 * Starlink roster ÷ airframes in it. It never mixes the two — the tracker's 247 over the
 * database's 1078 was a numerator counting 16 tails the denominator did not contain.
 *
 * @param {{mainline?: number, mainlineTotal?: number}|null|undefined} stats
 * @param {Array<{r?: string}>} fleetDb
 * @param {{has: (tail: string) => boolean}} tails
 * @returns {{count: number, total: number, pct: number}|null}
 */
export function starlinkMainlineShare(stats, fleetDb, tails) {
  if (stats && Number(stats.mainlineTotal) > 0 && Number.isFinite(Number(stats.mainline))) {
    const count = Number(stats.mainline), total = Number(stats.mainlineTotal);
    return { count, total, pct: Math.round((count / total) * 100) };
  }
  const db = fleetDb || [];
  if (!db.length) return null;
  const count = db.filter((a) => a && a.r && tails && tails.has(a.r)).length;
  return { count, total: db.length, pct: Math.round((count / db.length) * 100) };
}
