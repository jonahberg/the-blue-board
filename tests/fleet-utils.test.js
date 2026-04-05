import { describe, it, expect } from 'vitest';
import {
  categorizeFleetStatus,
  normalizeWifi,
  sortFleetData,
  filterFleetData,
  parseFleetDeepLink,
  FLEET_HEALTH_CATEGORIES,
  FLEET_FAMILIES,
  TAB_MAP,
  VALID_FLEET_VIEWS,
} from '../src/lib/fleet-utils.js';

// ─── categorizeFleetStatus ───

describe('categorizeFleetStatus', () => {
  it('returns "active" for null/undefined/empty', () => {
    expect(categorizeFleetStatus(null)).toBe('active');
    expect(categorizeFleetStatus(undefined)).toBe('active');
    expect(categorizeFleetStatus('')).toBe('active');
  });

  it('returns "active" for statuses starting with *', () => {
    expect(categorizeFleetStatus('*Special livery')).toBe('active');
  });

  it('returns "active" for 100 Year Sticker / Eco Demonstrator', () => {
    expect(categorizeFleetStatus('100 Year Sticker')).toBe('active');
    expect(categorizeFleetStatus('Eco Demonstrator')).toBe('active');
  });

  it('returns "stored" for stored aircraft', () => {
    expect(categorizeFleetStatus('Stored VCV')).toBe('stored');
    expect(categorizeFleetStatus('STORED')).toBe('stored');
  });

  it('returns "painting" for paint statuses (word-boundary match)', () => {
    expect(categorizeFleetStatus('In paint shop')).toBe('painting');
    // "Repaint" doesn't match \bpaint\b — no word boundary inside compound word
    expect(categorizeFleetStatus('Repaint scheduled')).toBe('maintenance');
  });

  it('returns "starlink_install" for starlink statuses', () => {
    expect(categorizeFleetStatus('Starlink install in progress')).toBe('starlink_install');
  });

  it('returns "next_retrofit" for MOD NEXT', () => {
    expect(categorizeFleetStatus('MOD NEXT')).toBe('next_retrofit');
    expect(categorizeFleetStatus('Mod Next conversion')).toBe('next_retrofit');
  });

  it('returns "future_gum" for future GUM statuses', () => {
    expect(categorizeFleetStatus('Future GUM')).toBe('future_gum');
  });

  it('returns "maintenance" for maint/induction', () => {
    expect(categorizeFleetStatus('Heavy Maint @ HAECO')).toBe('maintenance');
    expect(categorizeFleetStatus('Induction check')).toBe('maintenance');
  });

  it('returns "active" for NEXT-related notes (not MOD NEXT)', () => {
    expect(categorizeFleetStatus('Partial NEXT')).toBe('active');
    expect(categorizeFleetStatus('NEXT???')).toBe('active');
    expect(categorizeFleetStatus('Confirmed w.o NEXT')).toBe('active');
  });

  it('returns "maintenance" for remaining non-empty statuses', () => {
    expect(categorizeFleetStatus('HAECO Xiamen')).toBe('maintenance');
  });
});

// ─── normalizeWifi ───

describe('normalizeWifi', () => {
  it('normalizes known abbreviations', () => {
    expect(normalizeWifi('Sat KA')).toBe('Satellite Ka');
    expect(normalizeWifi('Satl Ka')).toBe('Satellite Ka');
    expect(normalizeWifi('Satl Ka US')).toBe('Satellite Ka (US)');
    expect(normalizeWifi('Satl KU')).toBe('Satellite Ku');
    expect(normalizeWifi('ViaSatKA')).toBe('ViaSat Ka');
    expect(normalizeWifi('Starlink')).toBe('Starlink');
    expect(normalizeWifi('NO')).toBe('NO');
  });

  it('returns raw value for unknown wifi types', () => {
    expect(normalizeWifi('SomeNewType')).toBe('SomeNewType');
  });
});

// ─── sortFleetData ───

describe('sortFleetData', () => {
  const data = [
    { r: 'N101', t: '737-800', tot: '5', d: '3' },
    { r: 'N202', t: '787-9', tot: '12', d: '1' },
    { r: 'N050', t: 'A320', tot: '0', d: '7' },
  ];

  it('sorts string columns ascending', () => {
    const sorted = sortFleetData(data, 'r', true);
    expect(sorted.map(a => a.r)).toEqual(['N050', 'N101', 'N202']);
  });

  it('sorts string columns descending', () => {
    const sorted = sortFleetData(data, 'r', false);
    expect(sorted.map(a => a.r)).toEqual(['N202', 'N101', 'N050']);
  });

  it('sorts numeric columns (tot) as integers', () => {
    const sorted = sortFleetData(data, 'tot', true);
    expect(sorted.map(a => a.tot)).toEqual(['0', '5', '12']);
  });

  it('sorts numeric columns descending', () => {
    const sorted = sortFleetData(data, 'tot', false);
    expect(sorted.map(a => a.tot)).toEqual(['12', '5', '0']);
  });

  it('does not mutate the original array', () => {
    const original = [...data];
    sortFleetData(data, 'tot', true);
    expect(data).toEqual(original);
  });
});

// ─── filterFleetData ───

describe('filterFleetData', () => {
  const db = [
    { r: 'N101UA', t: '737-800', w: 'Sat KA', s: '', c: 'UA' },
    { r: 'N202UA', t: '787-9', w: 'Starlink', s: 'Stored VCV', c: 'UA' },
    { r: 'N303UA', t: 'A320', w: 'Satl Ku', s: '', c: 'UA' },
  ];

  it('returns all aircraft with empty filters', () => {
    expect(filterFleetData(db, {})).toHaveLength(3);
  });

  it('filters by type', () => {
    const result = filterFleetData(db, { type: '787-9' });
    expect(result).toHaveLength(1);
    expect(result[0].r).toBe('N202UA');
  });

  it('filters by normalized wifi', () => {
    const result = filterFleetData(db, { wifi: 'Satellite Ka' });
    expect(result).toHaveLength(1);
    expect(result[0].r).toBe('N101UA');
  });

  it('filters active (no status note)', () => {
    const result = filterFleetData(db, { status: 'active' });
    expect(result).toHaveLength(2);
  });

  it('filters stored (has status note)', () => {
    const result = filterFleetData(db, { status: 'stored' });
    expect(result).toHaveLength(1);
    expect(result[0].r).toBe('N202UA');
  });

  it('filters starlink by tail set', () => {
    const starlinkTails = new Set(['N303UA']);
    const result = filterFleetData(db, { status: 'starlink', starlinkTails });
    expect(result).toHaveLength(1);
    expect(result[0].r).toBe('N303UA');
  });

  it('filters special by aircraft set', () => {
    const specialAircraftSet = new Set(['N101UA']);
    const result = filterFleetData(db, { status: 'special', specialAircraftSet });
    expect(result).toHaveLength(1);
  });

  it('filters by search (case-insensitive)', () => {
    const result = filterFleetData(db, { search: '787' });
    expect(result).toHaveLength(1);
    expect(result[0].t).toBe('787-9');
  });

  it('returns empty when search matches nothing', () => {
    expect(filterFleetData(db, { search: 'ZZZZZ' })).toHaveLength(0);
  });
});

// ─── parseFleetDeepLink ───

describe('parseFleetDeepLink', () => {
  it('returns null when no tab param', () => {
    expect(parseFleetDeepLink('')).toBeNull();
    expect(parseFleetDeepLink('?foo=bar')).toBeNull();
  });

  it('maps known tabs to their tab IDs', () => {
    expect(parseFleetDeepLink('?tab=fleet').tabId).toBe('tab-fleet');
    expect(parseFleetDeepLink('?tab=live').tabId).toBe('tab-live');
    expect(parseFleetDeepLink('?tab=irops').tabId).toBe('tab-weather');
  });

  it('returns null tabId for unknown tabs', () => {
    expect(parseFleetDeepLink('?tab=unknown').tabId).toBeNull();
  });

  it('extracts fleet filter from type param', () => {
    const result = parseFleetDeepLink('?tab=fleet&type=737-800');
    expect(result.fleetFilter).toBe('737-800');
  });

  it('extracts fleet filter from filter param', () => {
    const result = parseFleetDeepLink('?tab=fleet&filter=A320');
    expect(result.fleetFilter).toBe('A320');
  });

  it('ignores fleet filter for non-fleet tabs', () => {
    const result = parseFleetDeepLink('?tab=live&type=737-800');
    expect(result.fleetFilter).toBeNull();
  });

  it('extracts valid fleet view', () => {
    const result = parseFleetDeepLink('?tab=fleet&view=starlink');
    expect(result.fleetView).toBe('starlink');
  });

  it('rejects invalid fleet view', () => {
    const result = parseFleetDeepLink('?tab=fleet&view=invalid');
    expect(result.fleetView).toBeNull();
  });

  it('ignores fleet view for non-fleet tabs', () => {
    const result = parseFleetDeepLink('?tab=live&view=starlink');
    expect(result.fleetView).toBeNull();
  });
});
