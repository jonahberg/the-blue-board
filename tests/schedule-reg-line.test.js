// The desktop Reg cell's detail line says Starlink once (Nov 2026 polish).
import { describe, expect, it } from 'vitest';

import { regDetailParts, regDetailText } from '../src/lib/schedule-reg-line.js';
import { fleetCell } from '../src/lib/schedule-row-model.js';

// Real /data/fleet.json-shaped rows (as in schedule-phone-row.test.js).
const FLEET = {
  N77430: { r: 'N77430', t: '737-900ER', w: 'Starlink', c: '20F/45E+/114Y', d: '2009', i: 'AVOD', seats: { F: 20, 'E+': 45, Y: 114 } },
  N461UA: { r: 'N461UA', t: 'A320', w: 'Satl Ku', c: '12F/42E+/96Y', d: '2000', i: 'PDE', seats: { F: 12, 'E+': 42, Y: 96 } },
  N12000: { r: 'N12000', t: '737-800', w: 'Starlink', c: '16F/54E+/96Y', d: '2001', i: 'AVOD', seats: { F: 16, 'E+': 54, Y: 96 } },
};

describe('regDetailParts', () => {
  it('drops the duplicate when the Wi-Fi field and the roster both say Starlink', () => {
    const enrich = fleetCell('N77430', FLEET, new Set(['N77430'])).enrich;
    // The join this fixes: the fact twice.
    expect(enrich).toBe('20F/45E+/114Y · Starlink · ⚡ Starlink · AVOD · Del 2009');
    const parts = regDetailParts(enrich);
    expect(parts).toEqual([
      { text: '20F/45E+/114Y', starlink: false },
      { text: 'Starlink', starlink: true },
      { text: 'AVOD', starlink: false },
      { text: 'Del 2009', starlink: false },
    ]);
    expect(regDetailText(parts)).toBe('20F/45E+/114Y · Starlink · AVOD · Del 2009');
  });

  it('leaves a non-Starlink line exactly as fleetCell wrote it', () => {
    const enrich = fleetCell('N461UA', FLEET, new Set()).enrich;
    expect(regDetailText(regDetailParts(enrich))).toBe(enrich);
    expect(regDetailParts(enrich).some((part) => part.starlink)).toBe(false);
  });

  it('keeps a Wi-Fi-only "Starlink" plain when the roster does not confirm the tail', () => {
    const parts = regDetailParts(fleetCell('N12000', FLEET, new Set()).enrich);
    expect(parts.filter((part) => part.text === 'Starlink')).toEqual([{ text: 'Starlink', starlink: false }]);
  });

  it('marks the roster-only and Express answers', () => {
    expect(regDetailParts('⚡ Starlink')).toEqual([{ text: 'Starlink', starlink: true }]);
    expect(regDetailParts('CRJ-550 · GoJet Airlines · ⚡ Starlink')).toEqual([
      { text: 'CRJ-550', starlink: false },
      { text: 'GoJet Airlines', starlink: false },
      { text: 'Starlink', starlink: true },
    ]);
  });

  it('returns nothing for an empty line', () => {
    expect(regDetailParts('')).toEqual([]);
    expect(regDetailParts(undefined)).toEqual([]);
  });
});
