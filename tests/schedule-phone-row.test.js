// The phone board's row text (audit Oct 3 2026): what the two lines say, read only from the
// row model `buildScheduleRow()` already built.
import { describe, expect, it } from 'vitest';

import {
  phoneAircraftLine,
  phoneStatusLabel,
  phoneSwapText,
  phoneTimeChange,
} from '../src/lib/schedule-phone-row.js';
import { actualDeltaLine, fleetCell } from '../src/lib/schedule-row-model.js';

// Real /data/fleet.json rows (Oct 2026), with the `seats` object the fleet provider adds.
const FLEET = {
  N461UA: { r: 'N461UA', t: 'A320', w: 'Satl Ku', c: '12F/42E+/96Y', d: '2000', i: 'PDE', seats: { F: 12, 'E+': 42, Y: 96 } },
  N77430: { r: 'N77430', t: '737-900ER', w: 'Starlink', c: '20F/45E+/114Y', d: '2009', i: 'AVOD', seats: { F: 20, 'E+': 45, Y: 114 } },
  N882UA: { r: 'N882UA', t: 'A319', w: 'ViaSatKA', c: '', d: '2004', i: 'PDE' },
  N12345: { r: 'N12345', t: 'E175', w: 'NO', c: '12F/16E+/48Y', d: '2015', i: 'Seatback' },
};
const STARLINK = new Set(['N77430']);

const rowFor = (reg, extra = {}) => ({
  reg,
  acCode: 'B738',
  acShort: '737-800',
  fleet: fleetCell(reg, FLEET, STARLINK),
  ...extra,
});

describe('phoneAircraftLine — read back from fleetCell()', () => {
  it('pins the enrich format it parses: seats · wifi · IFE · Del', () => {
    // If this fails, fleetCell() changed its join and phoneAircraftLine must follow it.
    expect(fleetCell('N461UA', FLEET, STARLINK).enrich.split(' · ')).toEqual(['12F/42E+/96Y', 'Satellite Ku', 'PDE', 'Del 2000']);
  });

  it('tail · type · seats · Wi-Fi for a known tail', () => {
    expect(phoneAircraftLine(rowFor('N461UA'))).toEqual({
      tail: 'N461UA',
      type: '737-800',
      seats: '12F/42E+/96Y',
      wifi: 'Satellite Ku',
      starlink: false,
    });
  });

  it('a Starlink tail says Starlink, never the IFE code beside it', () => {
    const line = phoneAircraftLine(rowFor('N77430'));
    expect(line.starlink).toBe(true);
    expect(line.wifi).toBe('Starlink');
    expect(line.seats).toBe('20F/45E+/114Y');
  });

  it('no seat object and no config: Wi-Fi still found, seats left empty', () => {
    const line = phoneAircraftLine(rowFor('N882UA'));
    expect(line.seats).toBe('');
    expect(line.wifi).toBe('ViaSat Ka');
  });

  it('takes the config from the badge when the enrich line has no seats', () => {
    const line = phoneAircraftLine(rowFor('N12345'));
    expect(line.seats).toBe('12F/16E+/48Y');
    expect(line.wifi).toBe('No Wi-Fi');
  });

  it('uses the type code when the short name is a clipped phrase or a bare number', () => {
    expect(phoneAircraftLine({ reg: 'N540GJ', acCode: 'CRJ5', acShort: 'Canadair Regional Je', fleet: null }).type).toBe('CRJ5');
    expect(phoneAircraftLine({ reg: 'N12345', acCode: 'E75L', acShort: '175', fleet: null }).type).toBe('E75L');
    expect(phoneAircraftLine({ reg: 'N17456', acCode: 'B39M', acShort: '737 MAX 9', fleet: null }).type).toBe('737 MAX 9');
  });

  it('an Express tail only the Starlink roster knows reads Starlink, with no invented cabin', () => {
    // fleetCell() answers from the roster for a tail the mainline fleet database lacks (v1.13.0).
    const fleet = fleetCell('N140SY', FLEET, new Set(['N140SY']));
    expect(fleet).toEqual({ badge: 'Starlink', starlink: true, enrich: '⚡ Starlink', source: 'starlink-roster' });
    expect(phoneAircraftLine({ reg: 'N140SY', acCode: 'E75L', acShort: 'E175', fleet })).toEqual({
      tail: 'N140SY',
      type: 'E175',
      seats: '',
      wifi: 'Starlink',
      starlink: true,
    });
  });

  it('a United Express fleet tail: Starlink from the flag, never its type as seats or Wi-Fi', () => {
    const EXPRESS = {
      N140SY: { r: 'N140SY', t: 'E175', o: 'SkyWest Airlines', w: 'Starlink', c: '', x: true },
      N85377: { r: 'N85377', t: 'E175', o: 'SkyWest Airlines', w: '', c: '', x: true },
    };
    const sl = fleetCell('N140SY', FLEET, new Set(), EXPRESS);
    expect(sl.source).toBe('express');
    expect(phoneAircraftLine({ reg: 'N140SY', acCode: 'E75L', acShort: 'E175', fleet: sl })).toEqual({
      tail: 'N140SY',
      type: 'E175',
      seats: '',
      wifi: 'Starlink',
      starlink: true,
    });
    // No Starlink: the Wi-Fi is unknown, so it is left out — never "No Wi-Fi".
    const plain = fleetCell('N85377', FLEET, new Set(), EXPRESS);
    expect(phoneAircraftLine({ reg: 'N85377', acCode: 'E75L', acShort: 'E175', fleet: plain })).toEqual({
      tail: 'N85377',
      type: 'E175',
      seats: '',
      wifi: '',
      starlink: false,
    });
  });

  it('a fleet-database tail says where it came from', () => {
    expect(fleetCell('N461UA', FLEET, STARLINK).source).toBe('fleet');
  });

  it('an unknown or missing tail collapses to the type alone', () => {
    expect(phoneAircraftLine(rowFor('N00000'))).toEqual({ tail: 'N00000', type: '737-800', seats: '', wifi: '', starlink: false });
    expect(phoneAircraftLine({ reg: '', acCode: 'E175', acShort: '', fleet: null })).toEqual({
      tail: '',
      type: 'E175',
      seats: '',
      wifi: '',
      starlink: false,
    });
    expect(phoneAircraftLine({ reg: '', acCode: '—', acShort: '', fleet: null }).type).toBe('');
  });
});

describe('phoneTimeChange', () => {
  it('keeps the new clock time and drops the minutes the delay figure already shows', () => {
    const late = actualDeltaLine({ schedTimeSec: 1_000_000, actualTimeSec: 1_000_000 + 208 * 60, derivedActual: false, timeZone: 'America/Chicago' });
    expect(late.text).toMatch(/\(\+208m\)$/);
    const change = phoneTimeChange(late);
    expect(change).toEqual({ stamp: late.text.match(/\d{1,2}:\d{2}/)[0], early: false });
    expect(change.stamp).not.toMatch(/m/);
  });

  it('marks an early time and answers null when there is nothing to show', () => {
    expect(phoneTimeChange({ text: '→ 06:41 (-12m)', early: true })).toEqual({ stamp: '06:41', early: true });
    expect(phoneTimeChange(null)).toBeNull();
    expect(phoneTimeChange({ text: 'nonsense' })).toBeNull();
  });
});

describe('phoneStatusLabel', () => {
  it('asterisks a presumed status and spells the asterisk out for the title', () => {
    expect(phoneStatusLabel({ text: 'Departed', presumed: true })).toEqual({ label: 'Departed*', note: 'presumed — no live update' });
  });
  it('says seen airborne instead of presumed when the live feed saw it', () => {
    expect(phoneStatusLabel({ text: 'Departed', presumed: true, seen: true }).note).toBe('seen airborne by the live feed');
  });
  it('a landing the live feed proved keeps its asterisk but says seen landing, not presumed', () => {
    expect(phoneStatusLabel({ text: 'Landed', presumed: true, seenLanded: true })).toEqual({
      label: 'Landed*',
      note: 'seen landing on the live feed',
    });
  });
  it('seen landing wins when the Likely-Canceled override also set seen', () => {
    expect(phoneStatusLabel({ text: 'Landed', presumed: true, seen: true, seenLanded: true })).toEqual({
      label: 'Landed*',
      note: 'seen landing on the live feed',
    });
  });
  it('passes a plain status through', () => {
    expect(phoneStatusLabel({ text: 'Canceled' })).toEqual({ label: 'Canceled', note: '' });
    expect(phoneStatusLabel(undefined).label).toBe('Scheduled');
  });
});

describe('phoneSwapText', () => {
  it('names the direction in words, not only colour', () => {
    expect(phoneSwapText({ oldType: 'B739', newType: 'B738', tone: 'downgrade' })).toBe('B739 → B738 · downgrade');
    expect(phoneSwapText({ oldType: 'B738', newType: 'B39M', tone: 'upgrade' })).toBe('B738 → B39M · upgrade');
    expect(phoneSwapText({ oldType: 'A320', newType: 'A319', tone: 'lateral' })).toBe('A320 → A319 · swap');
    expect(phoneSwapText(null)).toBe('');
  });
});
