import { describe, it, expect } from 'vitest';
import {
  categorizeFleetStatus,
  FLEET_FAMILIES,
  normalizeWifi,
  applyStarlinkWifiOverlay,
  sortFleetData,
  filterFleetData,
} from '../src/lib/fleet-utils.js';

// ═══════════════════════════════════════════════
// 1. categorizeFleetStatus
// ═══════════════════════════════════════════════
describe('categorizeFleetStatus', () => {
  it('returns "active" for null / undefined / empty string', () => {
    expect(categorizeFleetStatus(null)).toBe('active');
    expect(categorizeFleetStatus(undefined)).toBe('active');
    expect(categorizeFleetStatus('')).toBe('active');
  });

  it('returns "active" for named aircraft (starts with *)', () => {
    expect(categorizeFleetStatus('*Ship 1926*')).toBe('active');
    expect(categorizeFleetStatus('*Our United Journey*')).toBe('active');
  });

  it('returns "active" for 100 Year Sticker livery', () => {
    expect(categorizeFleetStatus('100 Year Sticker')).toBe('active');
    expect(categorizeFleetStatus('100 year sticker')).toBe('active');
  });

  it('returns "active" for Eco Demonstrator', () => {
    expect(categorizeFleetStatus('Eco Demonstrator Explorer')).toBe('active');
    expect(categorizeFleetStatus('eco demonstrator')).toBe('active');
  });

  it('returns "stored" when status contains "stored"', () => {
    expect(categorizeFleetStatus('Stored at VCV')).toBe('stored');
    expect(categorizeFleetStatus('stored')).toBe('stored');
    expect(categorizeFleetStatus('STORED')).toBe('stored');
  });

  it('returns "painting" when status contains "paint" as a word', () => {
    expect(categorizeFleetStatus('In paint shop')).toBe('painting');
    expect(categorizeFleetStatus('Paint')).toBe('painting');
    // "repaint" should NOT match because \bpaint\b requires word boundary —
    // a non-empty status with no other keyword falls through to maintenance.
    expect(categorizeFleetStatus('repaint')).not.toBe('painting');
    expect(categorizeFleetStatus('Repaint scheduled')).toBe('maintenance');
  });

  it('returns "starlink_install" when status contains "starlink"', () => {
    expect(categorizeFleetStatus('Starlink install')).toBe('starlink_install');
    expect(categorizeFleetStatus('Getting STARLINK mod')).toBe('starlink_install');
  });

  it('returns "next_retrofit" for "mod next" statuses', () => {
    expect(categorizeFleetStatus('Mod NEXT retrofit')).toBe('next_retrofit');
    expect(categorizeFleetStatus('MOD NEXT')).toBe('next_retrofit');
    expect(categorizeFleetStatus('mod next')).toBe('next_retrofit');
  });

  it('returns "future_gum" when status contains "future gum"', () => {
    expect(categorizeFleetStatus('Future GUM delivery')).toBe('future_gum');
    expect(categorizeFleetStatus('future gum')).toBe('future_gum');
  });

  it('returns "maintenance" for maint or induction statuses', () => {
    expect(categorizeFleetStatus('Heavy maint at TPA')).toBe('maintenance');
    expect(categorizeFleetStatus('Induction check')).toBe('maintenance');
    expect(categorizeFleetStatus('MAINT')).toBe('maintenance');
  });

  it('returns "active" for NEXT notes that are not "mod next"', () => {
    expect(categorizeFleetStatus('Partial NEXT')).toBe('active');
    expect(categorizeFleetStatus('NEXT???')).toBe('active');
    expect(categorizeFleetStatus('Confirmed w.o NEXT')).toBe('active');
  });

  it('returns "maintenance" for other non-empty strings (MRO locations)', () => {
    expect(categorizeFleetStatus('TPA')).toBe('maintenance');
    expect(categorizeFleetStatus('SAN check')).toBe('maintenance');
    expect(categorizeFleetStatus('HGR')).toBe('maintenance');
  });

  it('returns "active" for whitespace-only strings', () => {
    expect(categorizeFleetStatus('   ')).toBe('active');
  });
});

// ═══════════════════════════════════════════════
// 2. FLEET_FAMILIES — deriving counts from a mock fleet
// ═══════════════════════════════════════════════
describe('FLEET_FAMILIES structure and count derivation', () => {
  const MOCK_FLEET = [
    { r: 'N101UA', t: '737-800', c: '160/Y', w: 'Starlink', s: '' },
    { r: 'N102UA', t: '737-800', c: '160/Y', w: 'Starlink', s: '' },
    { r: 'N103UA', t: '737 MAX 9', c: '179/Y', w: 'Starlink', s: '' },
    { r: 'N201UA', t: 'A321neo', c: '196/Y', w: 'Starlink', s: '' },
    { r: 'N301UA', t: '787-9', c: '257/J+PY+Y', w: 'ViaSatKA', s: '' },
    { r: 'N302UA', t: '787-10', c: '318/J+PY+Y', w: 'ViaSatKA', s: '' },
    { r: 'N401UA', t: '777-300ER', c: '366/J+PY+Y', w: 'Satl Ka', s: '' },
  ];

  it('has 6 families covering all mainline fleet types', () => {
    expect(FLEET_FAMILIES).toHaveLength(6);
    const allTypes = FLEET_FAMILIES.flatMap(f => f.subgroups.flatMap(sg => sg.types));
    // Every type in the mock fleet should exist in FLEET_FAMILIES
    MOCK_FLEET.forEach(a => {
      expect(allTypes).toContain(a.t);
    });
  });

  it('correctly derives family totals from a mock fleet', () => {
    const typeCounts = {};
    MOCK_FLEET.forEach(a => { typeCounts[a.t] = (typeCounts[a.t] || 0) + 1; });

    const familyTotals = FLEET_FAMILIES.map(family => {
      const total = family.subgroups.reduce((sum, sg) =>
        sum + sg.types.reduce((s, t) => s + (typeCounts[t] || 0), 0), 0);
      return { id: family.id, total };
    });

    expect(familyTotals.find(f => f.id === 'boeing-737').total).toBe(3);  // 2x 737-800 + 1x MAX 9
    expect(familyTotals.find(f => f.id === 'airbus-a320').total).toBe(1); // 1x A321neo
    expect(familyTotals.find(f => f.id === 'boeing-787').total).toBe(2);  // 1x 787-9 + 1x 787-10
    expect(familyTotals.find(f => f.id === 'boeing-777').total).toBe(1);  // 1x 777-300ER
    expect(familyTotals.find(f => f.id === 'boeing-757').total).toBe(0);  // none in mock
    expect(familyTotals.find(f => f.id === 'boeing-767').total).toBe(0);  // none in mock
  });

  it('correctly derives subgroup totals', () => {
    const typeCounts = {};
    MOCK_FLEET.forEach(a => { typeCounts[a.t] = (typeCounts[a.t] || 0) + 1; });

    const boeing737 = FLEET_FAMILIES.find(f => f.id === 'boeing-737');
    const ngCount = boeing737.subgroups.find(sg => sg.label === 'NG').types.reduce((s, t) => s + (typeCounts[t] || 0), 0);
    const maxCount = boeing737.subgroups.find(sg => sg.label === 'MAX').types.reduce((s, t) => s + (typeCounts[t] || 0), 0);
    expect(ngCount).toBe(2);  // 2x 737-800
    expect(maxCount).toBe(1); // 1x MAX 9
  });

  it('marks widebody families correctly', () => {
    const widebodies = FLEET_FAMILIES.filter(f => f.widebody);
    const widebodyIds = widebodies.map(f => f.id);
    expect(widebodyIds).toContain('boeing-767');
    expect(widebodyIds).toContain('boeing-777');
    expect(widebodyIds).toContain('boeing-787');
    expect(widebodyIds).not.toContain('boeing-737');
    expect(widebodyIds).not.toContain('airbus-a320');
  });
});

// ═══════════════════════════════════════════════
// 3. sortFleetData
// ═══════════════════════════════════════════════
describe('sortFleetData', () => {
  const MOCK = [
    { r: 'N103UA', t: '737 MAX 9', d: '2023', tot: '150' },
    { r: 'N101UA', t: '737-800',   d: '2015', tot: '320' },
    { r: 'N102UA', t: '737-800',   d: '2019', tot: '210' },
  ];

  it('sorts strings ascending (registration column)', () => {
    const sorted = sortFleetData(MOCK, 'r', true);
    expect(sorted.map(a => a.r)).toEqual(['N101UA', 'N102UA', 'N103UA']);
  });

  it('sorts strings descending (registration column)', () => {
    const sorted = sortFleetData(MOCK, 'r', false);
    expect(sorted.map(a => a.r)).toEqual(['N103UA', 'N102UA', 'N101UA']);
  });

  it('sorts numeric columns ascending (total seats)', () => {
    const sorted = sortFleetData(MOCK, 'tot', true);
    expect(sorted.map(a => a.tot)).toEqual(['150', '210', '320']);
  });

  it('sorts numeric columns descending (total seats)', () => {
    const sorted = sortFleetData(MOCK, 'tot', false);
    expect(sorted.map(a => a.tot)).toEqual(['320', '210', '150']);
  });

  it('sorts delivery year as numeric', () => {
    const sorted = sortFleetData(MOCK, 'd', true);
    expect(sorted.map(a => a.d)).toEqual(['2015', '2019', '2023']);
  });

  it('does not mutate the original array', () => {
    const original = [...MOCK];
    sortFleetData(MOCK, 'r', true);
    expect(MOCK).toEqual(original);
  });

  it('handles missing values gracefully', () => {
    const data = [
      { r: 'N100UA', tot: '' },
      { r: 'N200UA', tot: '120' },
      { r: 'N300UA' },
    ];
    const sorted = sortFleetData(data, 'tot', true);
    // empty/missing parse to 0, then 120
    expect(sorted[0].tot ?? '').toBeFalsy();
    expect(sorted[sorted.length - 1].tot).toBe('120');
  });

  it('keeps tied rows in their input order (comparator returns 0 on equality)', () => {
    // Many aircraft share a delivery year 'd'. A comparator that returns ±1 for
    // equal keys scrambles the tie group; a stable comparator (0 on equality)
    // preserves input order in both directions.
    const tied = [
      { r: 'E', d: '1998' },
      { r: 'C', d: '1998' },
      { r: 'A', d: '1998' },
    ];
    expect(sortFleetData(tied, 'd', true).map(a => a.r)).toEqual(['E', 'C', 'A']);
    expect(sortFleetData(tied, 'd', false).map(a => a.r)).toEqual(['E', 'C', 'A']);
  });
});

// ═══════════════════════════════════════════════
// 4. filterFleetData
// ═══════════════════════════════════════════════
describe('filterFleetData', () => {
  const MOCK_FLEET = [
    { r: 'N101UA', t: '737-800', c: '160/Y', w: 'Starlink', s: '',          i: 'AVOD' },
    { r: 'N102UA', t: '737-800', c: '160/Y', w: 'Sat KA',   s: 'Stored at VCV', i: 'PDE' },
    { r: 'N103UA', t: '737 MAX 9', c: '179/Y', w: 'Starlink', s: '',        i: 'AVOD' },
    { r: 'N201UA', t: 'A321neo', c: '196/Y', w: 'Starlink', s: '',          i: 'AVOD' },
    { r: 'N301UA', t: '787-9',  c: '257/J+PY+Y', w: 'ViaSatKA', s: 'Heavy maint', i: 'AVOD' },
    { r: 'N401UA', t: '777-300ER', c: '366/J+PY+Y', w: 'Satl Ka', s: '', i: 'AVOD' },
  ];

  const starlinkTails = new Set(['N101UA', 'N103UA', 'N201UA']);
  const specialAircraftSet = new Set(['N101UA']);

  it('returns all aircraft when no filters are set', () => {
    const result = filterFleetData(MOCK_FLEET, {});
    expect(result).toHaveLength(6);
  });

  it('filters by type', () => {
    const result = filterFleetData(MOCK_FLEET, { type: '737-800' });
    expect(result).toHaveLength(2);
    expect(result.every(a => a.t === '737-800')).toBe(true);
  });

  it('filters by WiFi (normalized)', () => {
    const result = filterFleetData(MOCK_FLEET, { wifi: 'Starlink' });
    expect(result).toHaveLength(3); // N101UA, N103UA, N201UA
    expect(result.every(a => normalizeWifi(a.w) === 'Starlink')).toBe(true);
  });

  it('filters by WiFi using non-normalized input that matches after normalizing', () => {
    // 'ViaSat Ka' is the normalized form of 'ViaSatKA'
    const result = filterFleetData(MOCK_FLEET, { wifi: 'ViaSat Ka' });
    expect(result).toHaveLength(1);
    expect(result[0].r).toBe('N301UA');
  });

  it('filters by status "active" (only aircraft with empty/null status)', () => {
    const result = filterFleetData(MOCK_FLEET, { status: 'active' });
    // Active = no status string set
    expect(result.every(a => !a.s)).toBe(true);
    expect(result).toHaveLength(4);
  });

  it('filters by status "stored" (only aircraft with non-empty status)', () => {
    const result = filterFleetData(MOCK_FLEET, { status: 'stored' });
    // "stored" filter in the original code means: only show aircraft that HAVE a status
    expect(result.every(a => !!a.s)).toBe(true);
    expect(result).toHaveLength(2); // N102UA (Stored at VCV) and N301UA (Heavy maint)
  });

  it('filters by status "starlink" using provided starlinkTails set', () => {
    const result = filterFleetData(MOCK_FLEET, { status: 'starlink', starlinkTails });
    expect(result).toHaveLength(3);
    expect(result.map(a => a.r).sort()).toEqual(['N101UA', 'N103UA', 'N201UA']);
  });

  it('filters by status "special" using provided specialAircraftSet', () => {
    const result = filterFleetData(MOCK_FLEET, { status: 'special', specialAircraftSet });
    expect(result).toHaveLength(1);
    expect(result[0].r).toBe('N101UA');
  });

  it('filters by search string (case-insensitive, matches reg/config/type)', () => {
    const result = filterFleetData(MOCK_FLEET, { search: 'n101' });
    expect(result).toHaveLength(1);
    expect(result[0].r).toBe('N101UA');
  });

  it('search matches aircraft type', () => {
    const result = filterFleetData(MOCK_FLEET, { search: 'MAX' });
    expect(result).toHaveLength(1);
    expect(result[0].t).toBe('737 MAX 9');
  });

  it('search matches configuration string', () => {
    const result = filterFleetData(MOCK_FLEET, { search: '366' });
    expect(result).toHaveLength(1);
    expect(result[0].r).toBe('N401UA');
  });

  it('combines type + WiFi filters', () => {
    const result = filterFleetData(MOCK_FLEET, { type: '737-800', wifi: 'Starlink' });
    expect(result).toHaveLength(1);
    expect(result[0].r).toBe('N101UA');
  });

  it('combines type + search filters', () => {
    const result = filterFleetData(MOCK_FLEET, { type: '737-800', search: 'N102' });
    expect(result).toHaveLength(1);
    expect(result[0].r).toBe('N102UA');
  });

  it('returns empty array when no aircraft match', () => {
    const result = filterFleetData(MOCK_FLEET, { type: 'A380' });
    expect(result).toHaveLength(0);
  });

  it('returns empty starlink filter results when no starlinkTails provided', () => {
    const result = filterFleetData(MOCK_FLEET, { status: 'starlink' });
    expect(result).toHaveLength(0);
  });

  it('does not throw when a partial row is missing config/type during search', () => {
    // Fleet DB rows occasionally arrive with only a registration; .toUpperCase()
    // on an undefined config/type would throw and blank the whole table.
    const partial = [{ r: 'N1' }];
    expect(() => filterFleetData(partial, { search: 'X' })).not.toThrow();
    expect(filterFleetData(partial, { search: 'X' })).toEqual([]);
  });

  it('matches a partial row on its present registration field', () => {
    const partial = [{ r: 'N1' }];
    const result = filterFleetData(partial, { search: 'N1' });
    expect(result).toHaveLength(1);
    expect(result[0].r).toBe('N1');
  });
});

// ═══════════════════════════════════════════════
// Bonus: normalizeWifi
// ═══════════════════════════════════════════════
describe('normalizeWifi', () => {
  it('normalizes known abbreviations', () => {
    expect(normalizeWifi('Sat KA')).toBe('Satellite Ka');
    expect(normalizeWifi('Satl Ka')).toBe('Satellite Ka');
    expect(normalizeWifi('Satl Ka US')).toBe('Satellite Ka (US)');
    expect(normalizeWifi('Satl KU')).toBe('Satellite Ku');
    expect(normalizeWifi('Satl Ku')).toBe('Satellite Ku');
    expect(normalizeWifi('ViaSatKA')).toBe('ViaSat Ka');
  });

  it('passes through already-normalized values', () => {
    expect(normalizeWifi('Starlink')).toBe('Starlink');
    expect(normalizeWifi('NO')).toBe('NO');
  });

  it('returns the raw value if not in the lookup table', () => {
    expect(normalizeWifi('Unknown Wifi')).toBe('Unknown Wifi');
    expect(normalizeWifi('')).toBe('');
  });
});

describe('applyStarlinkWifiOverlay', () => {
  it('replaces stale ViaSat metadata for a Starlink-confirmed tail', () => {
    const fleet = [
      { r: 'N76265', w: 'ViaSatKA' },
      { r: 'N12345', w: 'ViaSatKA' },
    ];
    const out = applyStarlinkWifiOverlay(fleet, new Set(['N76265']));

    expect(out[0].w).toBe('Starlink');
    expect(out[1].w).toBe('ViaSatKA');
    expect(fleet[0].w).toBe('ViaSatKA');
  });

  it('preserves rows that already agree with the live feed', () => {
    const aircraft = { r: 'N76265', w: 'Starlink' };
    const out = applyStarlinkWifiOverlay([aircraft], new Set(['N76265']));
    expect(out[0]).toBe(aircraft);
  });
});
