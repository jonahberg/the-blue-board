/**
 * A Sources card's name links to the dashboard view that shows that source's data (links
 * everywhere, part 2). Every address is the dashboard's own and is followed in place
 * (`resolveDeepLink`); a source no view shows keeps a plain name.
 */

import { describe, expect, it } from 'vitest';

import { resolveDeepLink } from '../src/app/state/deep-links';
import { SOURCE_VIEW_LINKS, sourceViewLink } from '../src/lib/sources-links.js';

describe('SOURCE_VIEW_LINKS', () => {
  it('maps each source a view shows to that view, and nothing else', () => {
    expect(Object.fromEntries(Object.entries(SOURCE_VIEW_LINKS).map(([name, link]) => [name, link.href]))).toEqual({
      'Live Flight Positions — Flightradar24': '/#live',
      'Flight Schedule — AeroDataBox': '/#schedule',
      'Fleet Database — United Fleet Site': '/#fleet',
      'Starlink Tracker — @martinamps': '/#starlink',
      'Aviation Weather — AWC': '/#weather',
      'NEXRAD Radar — Iowa State / NWS': '/#weather',
      'NAS Status — FAA': '/?tab=weather&section=nas',
    });
    expect(Object.isFrozen(SOURCE_VIEW_LINKS)).toBe(true);
  });

  it('every address is followed in place, to the tab it names', () => {
    const tabOf: Record<string, string> = {
      'Live Flight Positions — Flightradar24': 'live',
      'Flight Schedule — AeroDataBox': 'schedule',
      'Fleet Database — United Fleet Site': 'fleet',
      'Starlink Tracker — @martinamps': 'starlink',
      'Aviation Weather — AWC': 'weather',
      'NEXRAD Radar — Iowa State / NWS': 'weather',
      'NAS Status — FAA': 'weather',
    };
    for (const [name, { href }] of Object.entries(SOURCE_VIEW_LINKS)) {
      const intent = resolveDeepLink(href);
      expect(intent, name).not.toBeNull();
      expect(intent!.tab, name).toBe(tabOf[name]);
      // A bare tab: no hub board, no aircraft, no Fleet filter.
      expect(intent, name).toMatchObject({ scheduleHub: null, aircraft: null, fleet: null });
    }
  });

  it('the FAA NAS card lands on the NAS status panel', () => {
    expect(resolveDeepLink(SOURCE_VIEW_LINKS['NAS Status — FAA'].href)?.scrollTo).toBe('nas-section');
  });

  it('names each destination for a screen reader', () => {
    for (const link of Object.values(SOURCE_VIEW_LINKS)) expect(link.where.trim()).not.toBe('');
  });
});

describe('sourceViewLink', () => {
  it('returns the link for a source a view shows', () => {
    expect(sourceViewLink('Aviation Weather — AWC')).toBe(SOURCE_VIEW_LINKS['Aviation Weather — AWC']);
  });

  it('leaves the sources no view shows, and unknown names, unlinked', () => {
    for (const name of ['Basemap — CARTO / OpenStreetMap', 'Route Estimation — Algorithmic', 'r/UnitedAirlines', 'toString', '', undefined]) {
      expect(sourceViewLink(name), String(name)).toBeNull();
    }
  });
});
