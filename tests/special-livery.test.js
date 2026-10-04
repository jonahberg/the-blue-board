/**
 * Special liveries: the curated list (src/data/special-liveries.js) and its lookups.
 *
 * The list backs a public promise ("you'll be able to see if the plane has a special paint
 * job"), so the data tests are the point here, not decoration: every entry must name its
 * sources and the date they were checked, and every tail must resolve against the fleet
 * database the badge renders from. A wrong livery claim is worse than a missing one.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SPECIAL_LIVERIES } from '../src/data/special-liveries.js';
import { filterFleetData } from '../src/lib/fleet-utils.js';
import { buildSpecialRows } from '../src/lib/fleet-view.js';
import {
  indexLiveries,
  listSpecialLiveries,
  liveryForTail,
  liveryLabel,
  liveryShortName,
  normalizeTail,
  SPECIAL_LIVERY_COUNT,
} from '../src/lib/special-livery.js';

const ROOT = resolve(import.meta.dirname, '..');
const FLEET_DB = JSON.parse(readFileSync(resolve(ROOT, 'public/data/fleet.json'), 'utf8'));
const FLEET_TAILS = new Set(FLEET_DB.map((a) => a.r));

/**
 * Verified liveries on tails the mainline fleet database does not carry (a United Express
 * regional). Empty today; a tail added here must still pass every other check.
 */
const NON_MAINLINE_TAILS = new Set();

/**
 * Checked on 2026-10-04 and deliberately left out (see the header of special-liveries.js).
 * Re-adding one means re-verifying it from a recent photo first, then removing it here.
 */
const KNOWN_NOT_WEARING = {
  N14102: 'Her Art Here NY/NJ — photographed in standard colours, Nov 2025',
  N14106: 'Her Art Here California — photographed in standard colours, Mar 2026',
  N75436: "Continental's 2009 retro jet — repainted; the scheme is on N75435",
  N645SY: 'Mountain Ascent E175 — announced Sep 2026, in service from early 2027',
};

describe('special-liveries data', () => {
  it('has entries', () => {
    expect(SPECIAL_LIVERIES.length).toBeGreaterThan(0);
  });

  it.each(SPECIAL_LIVERIES.map((e) => [e.tail, e]))('%s is a complete, sourced entry', (_tail, e) => {
    // The tail is stored exactly as the feed's `reg` matches it.
    expect(e.tail).toBe(normalizeTail(e.tail));
    expect(e.tail).toMatch(/^N[0-9A-Z]{1,5}$/);
    expect(e.name.trim()).not.toBe('');
    // One plain sentence: ends with a full stop, no line breaks, nothing HTML-ish.
    expect(e.description).toMatch(/^[^\n<>]+\.$/);
    expect(e.description.length).toBeLessThan(220);
    if (e.type) expect(['commemorative', 'heritage', 'sustainability', 'alliance']).toContain(e.type);
    if (e.since) expect(e.since).toMatch(/^\d{4}$/);
    expect(e.verified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(e.verified))).toBe(false);
    // At least two sources that name the tail. A United press release that names the tail
    // could stand alone, but the America 250 one names only the types, so keep the bar at two
    // for everyone rather than let a type-only release count.
    expect(e.sources.length).toBeGreaterThanOrEqual(2);
    expect(new Set(e.sources).size).toBe(e.sources.length);
    for (const url of e.sources) expect(url).toMatch(/^https:\/\/[^\s]+$/);
  });

  it('lists each tail once', () => {
    const tails = SPECIAL_LIVERIES.map((e) => e.tail);
    expect(new Set(tails).size).toBe(tails.length);
    expect(SPECIAL_LIVERY_COUNT).toBe(tails.length);
  });

  // A tripwire, not a flake: when the fleet DB drops a tail (N475UA's A320s and N14120's 757s
  // are retiring), re-verify that entry instead of badging a jet that no longer flies.
  it('every tail is in the fleet database the badge renders from (or is a known regional)', () => {
    const missing = SPECIAL_LIVERIES.map((e) => e.tail).filter(
      (t) => !FLEET_TAILS.has(t) && !NON_MAINLINE_TAILS.has(t),
    );
    expect(missing).toEqual([]);
  });

  it('does not claim a livery that was checked and found painted over or not yet flying', () => {
    const claimed = SPECIAL_LIVERIES.map((e) => e.tail).filter((t) => t in KNOWN_NOT_WEARING);
    expect(claimed).toEqual([]);
  });
});

describe('normalizeTail / liveryForTail', () => {
  it('normalises case, whitespace and dashes', () => {
    expect(normalizeTail(' n75435 ')).toBe('N75435');
    expect(normalizeTail('N-75435')).toBe('N75435');
    expect(normalizeTail('n 754-35')).toBe('N75435');
    expect(normalizeTail(null)).toBe('');
    expect(normalizeTail(undefined)).toBe('');
  });

  it('finds a livery under any spelling of the registration', () => {
    expect(liveryForTail('N75435')?.name).toBe('Continental retro');
    expect(liveryForTail('n75435')?.name).toBe('Continental retro');
    expect(liveryForTail('N-75435 ')?.name).toBe('Continental retro');
    expect(liveryForTail('N91007')?.name).toBe('Stars and Stripes');
    expect(liveryForTail('N475UA')?.name).toBe('Friend Ship');
  });

  it('returns null for a standard-livery tail, an empty reg and junk', () => {
    expect(liveryForTail('N4888U')).toBeNull();
    expect(liveryForTail('')).toBeNull();
    expect(liveryForTail(null)).toBeNull();
    expect(liveryForTail(undefined)).toBeNull();
    expect(liveryForTail('—')).toBeNull();
  });

  it('keeps the first entry when a list repeats a tail', () => {
    const index = indexLiveries([
      { tail: 'N1', name: 'First', description: 'a.', sources: [], verified: '2026-10-04' },
      { tail: 'n1', name: 'Second', description: 'b.', sources: [], verified: '2026-10-04' },
    ]);
    expect(index.size).toBe(1);
    expect(liveryForTail('N1', index)?.name).toBe('First');
  });
});

describe('labels', () => {
  it('reads "Special livery: <name>" for assistive tech and tooltips', () => {
    expect(liveryLabel(liveryForTail('N24988'))).toBe('Special livery: The Future is SAF');
    expect(liveryLabel(null)).toBe('');
  });

  it('uses the short name in tight cells, falling back to the name', () => {
    expect(liveryShortName(liveryForTail('N78285'))).toBe('Stars & Stripes');
    expect(liveryShortName({ name: 'Only a name' })).toBe('Only a name');
    expect(liveryShortName(undefined)).toBe('');
  });
});

describe('listSpecialLiveries', () => {
  it('groups by livery name, tails alphabetical inside a group', () => {
    const list = listSpecialLiveries([
      { tail: 'N9', name: 'Star Alliance' },
      { tail: 'N2', name: 'Friend Ship' },
      { tail: 'N1', name: 'Star Alliance' },
    ]);
    expect(list.map((e) => `${e.name}/${e.tail}`)).toEqual([
      'Friend Ship/N2',
      'Star Alliance/N1',
      'Star Alliance/N9',
    ]);
  });

  it('covers the whole curated list without mutating it', () => {
    const before = SPECIAL_LIVERIES.map((e) => e.tail);
    expect(listSpecialLiveries()).toHaveLength(SPECIAL_LIVERIES.length);
    expect(SPECIAL_LIVERIES.map((e) => e.tail)).toEqual(before);
  });
});

describe('Fleet tab: the "Special livery" status filter', () => {
  const fleet = [
    { r: 'N75435', t: '737-900ER', s: '' },
    { r: 'N76021', t: '777-200ER', s: '*Larry Kellner' },
    { r: 'N4888U', t: 'A319', s: '' },
  ];

  it('keeps only tails wearing a curated livery', () => {
    expect(filterFleetData(fleet, { status: 'livery' }).map((a) => a.r)).toEqual(['N75435', 'N76021']);
  });

  it('combines with the type filter', () => {
    expect(filterFleetData(fleet, { status: 'livery', type: '777-200ER' }).map((a) => a.r)).toEqual(['N76021']);
  });
});

describe('Fleet tab: Special panel rows', () => {
  const fleetByReg = {
    N75435: { r: 'N75435', t: '737-900ER', d: '2009' },
    N76021: { r: 'N76021', t: '777-200ER', d: '2010' },
  };
  const special = new Map([['N76021', { name: 'Larry Kellner', type: 'named' }]]);
  const liveries = [
    { tail: 'N75435', name: 'Continental retro', description: 'Retro.' },
    { tail: 'N76021', name: 'Star Alliance', description: 'Alliance.' },
    { tail: 'N645ZZ', name: 'Regional scheme', description: 'Regional.' },
  ];

  it('leads with the curated liveries and keeps a named tail as its own card', () => {
    const rows = buildSpecialRows(special, fleetByReg, [], liveries);
    expect(rows.map((r) => r.key)).toEqual(['N75435:paint', 'N76021:paint', 'N645ZZ:paint', 'N76021:named']);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    expect(rows[0]).toMatchObject({ kind: 'paint', type: '737-900ER', delivered: '2009', description: 'Retro.' });
  });

  it('keeps a verified livery on a tail the mainline database lacks', () => {
    const row = buildSpecialRows(special, fleetByReg, [], liveries).find((r) => r.reg === 'N645ZZ');
    expect(row).toMatchObject({ type: '', delivered: '?' });
  });

  it('marks an airborne livery jet with its flight', () => {
    const rows = buildSpecialRows(special, fleetByReg, [
      { reg: 'N75435', flightIATA: 'UA1226', origin: 'IAH', dest: 'ORD', onGround: false },
    ], liveries);
    expect(rows.find((r) => r.key === 'N75435:paint')?.airborne).toEqual({ flight: 'UA1226', route: 'IAH > ORD' });
  });

  it('is unchanged without a livery list', () => {
    expect(buildSpecialRows(special, fleetByReg, []).map((r) => r.key)).toEqual(['N76021:named']);
  });
});
