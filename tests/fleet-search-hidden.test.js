// A reader emailed (Oct 5 2026) "N666UA is missing" — the 767-300ER was in the fleet database,
// but the Wi-Fi filter was still on Starlink, and the empty state did not say which filter hid it.
import { describe, expect, it } from 'vitest';

import { filterFleetData, searchHiddenByFilters, searchHiddenMessage } from '../src/lib/fleet-utils.js';

const FLEET = [
  { r: 'N666UA', t: '767-300ER', w: 'Satl Ku', c: '46J/22PE/43E+/56Y', s: '' },
  { r: 'N667UA', t: '767-300ER', w: 'Satl Ku', c: '46J/22PE/43E+/56Y', s: '' },
  { r: 'N27270', t: '737 MAX 8', w: 'ViaSatKA', c: '16F/54E+/96Y', s: '' },
  { r: 'N37522', t: '737 MAX 8', w: 'Starlink', c: '16F/54E+/96Y', s: '' },
];
const base = { type: '', wifi: '', status: '', search: '', starlinkTails: new Set(['N37522']), specialAircraftSet: new Set() };

describe('searchHiddenByFilters', () => {
  it('names the filter hiding an aircraft the search finds (the N666UA email)', () => {
    const opts = { ...base, search: 'N666UA', wifi: 'Starlink' };
    expect(filterFleetData(FLEET, opts)).toEqual([]);
    const hint = searchHiddenByFilters(FLEET, opts);
    expect(hint).toMatchObject({ count: 1, first: { r: 'N666UA' }, blocking: [{ key: 'wifi', value: 'Starlink' }] });
    expect(searchHiddenMessage(hint, opts.search)).toBe(
      'N666UA (767-300ER) is in the fleet, but your Wi-Fi: Starlink filter is hiding it.',
    );
  });

  it('counts several matches and only blames the filter that actually empties the list', () => {
    const opts = { ...base, search: 'N66', wifi: 'Starlink', type: '767-300ER' };
    const hint = searchHiddenByFilters(FLEET, opts);
    expect(hint.count).toBe(2);
    expect(hint.blocking).toEqual([{ key: 'wifi', value: 'Starlink' }]); // the type filter alone still shows both
    expect(searchHiddenMessage(hint, opts.search)).toBe('2 aircraft match “N66”, but your Wi-Fi: Starlink filter is hiding them.');
  });

  it('blames every active filter when only their combination empties the list', () => {
    const opts = { ...base, search: 'N', type: '767-300ER', status: 'starlink' };
    const hint = searchHiddenByFilters(FLEET, opts);
    expect(hint.blocking.map((b) => b.key).sort()).toEqual(['status', 'type']);
    expect(searchHiddenMessage(hint, 'N')).toContain('filters are hiding them');
  });

  it('stays out of the way when nothing is hidden or the search finds nothing at all', () => {
    expect(searchHiddenByFilters(FLEET, { ...base, search: 'N666UA' })).toBeNull(); // no filter
    expect(searchHiddenByFilters(FLEET, { ...base, search: '', wifi: 'Starlink' })).toBeNull(); // no search
    expect(searchHiddenByFilters(FLEET, { ...base, search: 'N37522', wifi: 'Starlink' })).toBeNull(); // shown
    expect(searchHiddenByFilters(FLEET, { ...base, search: 'N999ZZ', wifi: 'Starlink' })).toBeNull(); // not in the DB
    expect(searchHiddenMessage(null, 'x')).toBe('');
  });
});

import { isTailPending } from '../src/lib/schedule-row-model.js';

describe('isTailPending (board says "Not assigned yet", not a dash)', () => {
  it('is true for a flight that has not operated and has no tail', () => {
    expect(isTailPending({ reg: '', statusKey: 'scheduled' })).toBe(true);
    expect(isTailPending({ reg: '', statusKey: undefined })).toBe(true);
  });
  it('is false once there is a tail, the flight has operated or is canceled, or its time has passed', () => {
    expect(isTailPending({ reg: 'N666UA', statusKey: 'scheduled' })).toBe(false);
    for (const k of ['departed', 'enroute', 'landed', 'canceled', 'canceled_uncertain', 'diverted']) {
      expect(isTailPending({ reg: '', statusKey: k })).toBe(false);
    }
    expect(isTailPending({ reg: '', statusKey: 'scheduled', pastDue: true })).toBe(false);
  });
});
