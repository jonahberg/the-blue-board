import { describe, expect, it } from 'vitest';

import {
  expressSearchChip,
  expressSearchChips,
  isExpressChipPressed,
  nextExpressSearch,
} from '../src/lib/express-fleet-chips.js';
import { summarizeExpressFleet } from '../src/lib/express-fleet.js';
import { filterExpressFleet } from '../src/lib/express-fleet-view.js';

// buildExpressFleet() output, trimmed to the fields the search reads.
const FLEET = [
  { r: 'N103SY', t: 'E175', o: 'SkyWest Airlines', oc: 'SKW', w: 'Starlink', c: '12F/32E+/26Y', lf: 'UA5612' },
  { r: 'N946SW', t: 'CRJ200', o: 'SkyWest Airlines', oc: 'SKW', w: 'None', c: '50Y', lf: 'UA5102' },
  { r: 'N722YX', t: 'E175', o: 'Republic Airways', oc: 'RPA', w: 'Starlink', c: '12F/16E+/48Y', lf: 'UA3540' },
  { r: 'N10156', t: 'ERJ145', o: 'CommutAir', oc: 'UCA', w: 'None', c: '6E+/44Y', lf: 'UA4901' },
  { r: 'N504GJ', t: 'CRJ550', o: 'GoJet Airlines', oc: 'GJS', w: 'Starlink', c: '10F/20E+/20Y', lf: 'G74576' },
  { r: 'N999XX', t: '', o: '', oc: '', w: '', c: '', lf: '' },
];
const SUMMARY = summarizeExpressFleet(FLEET);

describe('expressSearchChips: a count chip is a button when the search lists exactly what it counts', () => {
  it('gives each named operator and type its own label as the search, in the summary\'s order', () => {
    expect(expressSearchChips(SUMMARY.byOperator, FLEET)).toEqual([
      { label: 'SkyWest Airlines', count: 2, search: 'SkyWest Airlines' },
      { label: 'CommutAir', count: 1, search: 'CommutAir' },
      { label: 'GoJet Airlines', count: 1, search: 'GoJet Airlines' },
      { label: 'Republic Airways', count: 1, search: 'Republic Airways' },
      { label: 'Unknown operator', count: 1, search: null },
    ]);
    expect(expressSearchChips(SUMMARY.byType, FLEET).map((chip) => [chip.label, chip.search])).toEqual([
      ['E175', 'E175'],
      ['CRJ200', 'CRJ200'],
      ['CRJ550', 'CRJ550'],
      ['ERJ145', 'ERJ145'],
      ['Unknown type', null],
    ]);
  });

  it('every chip with a search lists exactly its count', () => {
    for (const chip of [
      ...expressSearchChips(SUMMARY.byOperator, FLEET),
      ...expressSearchChips(SUMMARY.byType, FLEET),
      expressSearchChip('Starlink', SUMMARY.starlink, FLEET),
    ]) {
      if (chip.search === null) continue;
      expect(filterExpressFleet(FLEET, chip.search), chip.label).toHaveLength(chip.count);
    }
  });

  it('the "Unknown …" buckets have no search: those rows have an empty field, which no word finds', () => {
    expect(filterExpressFleet(FLEET, 'Unknown operator')).toHaveLength(0);
    expect(expressSearchChip('Unknown type', 1, FLEET).search).toBeNull();
  });

  it('a label whose search would list a different number of rows stays text', () => {
    // "Air" is in three operators' names: a chip counting one of them has no exact search.
    expect(expressSearchChip('Air', 1, FLEET).search).toBeNull();
    // A count the list no longer agrees with (a summary from another load) stays text too.
    expect(expressSearchChip('SkyWest Airlines', 3, FLEET).search).toBeNull();
  });

  it('the Starlink count searches "Starlink", which is exactly the Starlink rows', () => {
    expect(expressSearchChip('Starlink', SUMMARY.starlink, FLEET)).toEqual({ label: 'Starlink', count: 3, search: 'Starlink' });
  });

  it('survives an empty fleet', () => {
    expect(expressSearchChips({}, [])).toEqual([]);
    expect(expressSearchChip('Starlink', 0, []).search).toBeNull();
  });
});

describe('isExpressChipPressed / nextExpressSearch: a chip toggles the Express search', () => {
  const chip = { label: 'SkyWest Airlines', count: 2, search: 'SkyWest Airlines' };

  it('is pressed while the search is its word, whatever the case or surrounding spaces', () => {
    expect(isExpressChipPressed(chip, 'SkyWest Airlines')).toBe(true);
    expect(isExpressChipPressed(chip, '  skywest airlines ')).toBe(true);
    expect(isExpressChipPressed(chip, 'skywest')).toBe(false);
    expect(isExpressChipPressed(chip, '')).toBe(false);
    expect(isExpressChipPressed({ ...chip, search: null }, 'SkyWest Airlines')).toBe(false);
  });

  it('sets the search to its word, replacing what was typed; pressed again it clears the search', () => {
    expect(nextExpressSearch(chip, '')).toBe('SkyWest Airlines');
    expect(nextExpressSearch(chip, 'n10')).toBe('SkyWest Airlines');
    expect(nextExpressSearch(chip, 'SkyWest Airlines')).toBe('');
    expect(nextExpressSearch(chip, 'skywest airlines')).toBe('');
  });
});
