// Links everywhere (Nov 12 2026): the tracker pages' links to their own entries and to the hub
// pages (src/lib/tracker-links.js), checked against the real tracker data so every link they build
// has a page (and an anchor) to land on.
import { describe, expect, it } from 'vitest';

import { atcAirports } from '../src/data/trackers/atc.js';
import { unitedHubs, unitedProjects } from '../src/data/trackers/united-hubs.js';
import { atcHubDetailCodes, unitedHubDetailCodes } from '../src/lib/tracker-detail.js';
import { atcEntryHref, mapPlaceLinks, projectEntryHref, unitedHubEntryHref } from '../src/lib/tracker-links.js';

describe('atcEntryHref', () => {
  it('gives each United hub tower its page, and nothing to any other airport', () => {
    expect([...atcHubDetailCodes].sort()).toEqual(['DEN', 'EWR', 'IAD', 'IAH', 'LAX', 'ORD', 'SFO']);
    for (const code of atcHubDetailCodes) expect(atcEntryHref(code, atcHubDetailCodes)).toBe(`/trackers/atc/${code.toLowerCase()}`);
    const others = atcAirports.map((a) => a.code).filter((c) => !atcHubDetailCodes.includes(c));
    expect(others.length).toBeGreaterThan(80);
    for (const code of others) expect(atcEntryHref(code, atcHubDetailCodes)).toBeNull();
    expect(atcEntryHref('ord', atcHubDetailCodes)).toBe('/trackers/atc/ord');
    for (const bad of ['GUM', 'NRT', '', 'ORDX', null, undefined, '../x']) expect(atcEntryHref(bad, atcHubDetailCodes)).toBeNull();
  });
});

describe('unitedHubEntryHref', () => {
  it('gives each of the eight tracked hubs its page, and nothing to NRT or a non-hub', () => {
    expect([...unitedHubDetailCodes].sort()).toEqual(['DEN', 'EWR', 'GUM', 'IAD', 'IAH', 'LAX', 'ORD', 'SFO']);
    for (const code of Object.keys(unitedHubs)) expect(unitedHubEntryHref(code, unitedHubDetailCodes)).toBe(`/trackers/united-hubs/${code.toLowerCase()}`);
    for (const bad of ['NRT', 'LGA', '', null]) expect(unitedHubEntryHref(bad, unitedHubDetailCodes)).toBeNull();
  });
});

describe('projectEntryHref', () => {
  it('points every tracked project at its own card on a hub page that exists', () => {
    expect(unitedProjects.length).toBeGreaterThan(20);
    for (const p of unitedProjects) {
      const href = projectEntryHref(p);
      expect(href).toBe(`/trackers/united-hubs/${p.hub.toLowerCase()}#${p.id}`);
      expect(unitedHubDetailCodes).toContain(p.hub);
    }
    // Ids are unique, so each anchor names one card.
    expect(new Set(unitedProjects.map((p) => p.id)).size).toBe(unitedProjects.length);
  });

  it('is null without a hub code or a plain id', () => {
    expect(projectEntryHref(null)).toBeNull();
    expect(projectEntryHref({ hub: 'IAH' })).toBeNull();
    expect(projectEntryHref({ hub: 'IAH', id: 'a b' })).toBeNull();
    expect(projectEntryHref({ hub: 'Houston', id: 'iah-x' })).toBeNull();
  });
});

describe('mapPlaceLinks', () => {
  it('a hub: its entry on this tracker in link colour, then its hub page, quiet', () => {
    expect(mapPlaceLinks('ORD', '/trackers/atc/ord', 'ORD status →')).toEqual([
      { href: '/trackers/atc/ord', text: 'ORD status →', tone: 'entry' },
      { href: '/hubs/ord', text: 'ORD hub guide', tone: 'quiet' },
    ]);
    expect(mapPlaceLinks('GUM', '/trackers/united-hubs/gum', 'GUM projects →')).toEqual([
      { href: '/trackers/united-hubs/gum', text: 'GUM projects →', tone: 'entry' },
      { href: '/hubs/gum', text: 'GUM hub guide', tone: 'quiet' },
    ]);
  });

  it('a hub this tracker has no page for still gets its hub page; any other airport gets nothing', () => {
    expect(mapPlaceLinks('NRT', null, 'NRT status →')).toEqual([{ href: '/hubs/nrt', text: 'NRT hub guide', tone: 'quiet' }]);
    expect(mapPlaceLinks('SJU', null, 'SJU status →')).toEqual([]);
    expect(mapPlaceLinks('CLE', '/trackers/atc#row-cle', 'x')).toEqual([]);
  });
});
