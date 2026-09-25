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
