/**
 * Which Stats headline cards link, and where (links everywhere, part 2).
 *
 * A card links only when the destination lists exactly what the card counts. Both addresses are
 * the dashboard's own, so a click is followed in place: `resolveDeepLink` gives each an intent
 * for the tab it names (and the Fleet tab's Airborne sub-view for the utilisation card).
 */

import { describe, expect, it } from 'vitest';

import { resolveDeepLink } from '../src/app/state/deep-links';
import { STATS_METRIC_LINKS, metricLink } from '../src/lib/stats-links.js';

describe('STATS_METRIC_LINKS', () => {
  it('links the two cards whose destination lists what they count, and no other', () => {
    expect(Object.keys(STATS_METRIC_LINKS).sort()).toEqual(['Fleet Utilization', 'Flights Airborne']);
    expect(Object.isFrozen(STATS_METRIC_LINKS)).toBe(true);
  });

  it('"Flights Airborne" goes to the Live tab, followed in place', () => {
    const { href } = STATS_METRIC_LINKS['Flights Airborne'];
    expect(href).toBe('/#live');
    expect(resolveDeepLink(href)).toMatchObject({ tab: 'live', scrollTo: null, scheduleHub: null, aircraft: null, fleet: null });
  });

  it('"Fleet Utilization" goes to the Fleet tab\'s Airborne view, followed in place', () => {
    const { href } = STATS_METRIC_LINKS['Fleet Utilization'];
    expect(href).toBe('/?tab=fleet&view=airborne');
    expect(resolveDeepLink(href)).toMatchObject({ tab: 'fleet', fleet: { filter: null, view: 'airborne' } });
  });

  it('names the destination for a screen reader', () => {
    for (const link of Object.values(STATS_METRIC_LINKS)) expect(link.where.trim()).not.toBe('');
  });
});

describe('metricLink', () => {
  it('returns the link for a linked card that has a figure', () => {
    expect(metricLink('Flights Airborne', '241')).toBe(STATS_METRIC_LINKS['Flights Airborne']);
    expect(metricLink('Flights Airborne', '0')).toBe(STATS_METRIC_LINKS['Flights Airborne']);
    expect(metricLink('Fleet Utilization', '38%')).toBe(STATS_METRIC_LINKS['Fleet Utilization']);
  });

  it('leaves the two cards with no list of exactly their set as text', () => {
    expect(metricLink('Avg Fleet Age', '12.4y')).toBeNull();
    expect(metricLink('Starlink Coverage', '24%')).toBeNull();
  });

  it('does not link a card that has no figure yet', () => {
    expect(metricLink('Fleet Utilization', '—')).toBeNull();
    expect(metricLink('Flights Airborne', '')).toBeNull();
  });

  it('does not link an unknown label', () => {
    expect(metricLink('Something Else', '3')).toBeNull();
    expect(metricLink(undefined, '3')).toBeNull();
  });
});
