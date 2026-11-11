// Ask the board — the vocabulary and its validator (src/lib/ask-vocabulary.js). Every answer, from
// the rules, from the model and from the network, passes validateAskResult before a view sees it.
// Pins: unknown keys and invalid values are dropped; a filter the target view cannot apply is
// dropped; values are normalised (flight, tail, airport); the result is reconciled for its view;
// chips are labelled from fixed tables only; removing the last chip clears the answer.
import { describe, expect, it } from 'vitest';

import {
  ASK_FILTER_NAMES,
  ASK_HUBS,
  ASK_REGIONS,
  ASK_TYPES,
  ASK_VIEW_FILTERS,
  ASK_VIEWS,
  askChips,
  askSummaryLine,
  normalizeAirport,
  normalizeFlight,
  normalizeTail,
  validateAskResult,
  withoutAskFilter,
} from '../src/lib/ask-vocabulary.js';
import { MAP_REGIONS } from '../src/lib/map-regions.js';
import { HUB_ORDER } from '../src/lib/hub-health.js';

const ok = (raw) => {
  const r = validateAskResult(raw);
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r.result;
};

describe('the vocabulary is built from data the repo already has', () => {
  it('hubs are the nine, regions are the map presets, types are ICAO designators', () => {
    expect(ASK_HUBS).toEqual(HUB_ORDER);
    expect(ASK_REGIONS).toEqual(MAP_REGIONS.map((r) => r.id));
    expect(ASK_TYPES).toContain('B789');
    expect(ASK_TYPES.every((t) => /^[AB][0-9A-Z]{3}$/.test(t))).toBe(true);
  });
  it('every view lists only known filter names', () => {
    for (const view of ASK_VIEWS) for (const name of ASK_VIEW_FILTERS[view]) expect(ASK_FILTER_NAMES).toContain(name);
  });
});

describe('value checks', () => {
  it('flight numbers', () => {
    expect(normalizeFlight('ua 0019')).toBe('UA19');
    expect(normalizeFlight('UAL1432')).toBe('UA1432');
    expect(normalizeFlight(1432)).toBe('UA1432');
    expect(normalizeFlight('AA100')).toBeNull();
    expect(normalizeFlight('UA12345')).toBeNull();
    expect(normalizeFlight('UA0')).toBeNull();
    expect(normalizeFlight('<b>UA1</b>')).toBeNull();
  });
  it('tails', () => {
    expect(normalizeTail('n-12345')).toBe('N12345');
    expect(normalizeTail('N77UA')).toBe('N77UA');
    expect(normalizeTail('N0123')).toBeNull();
    expect(normalizeTail('G-STBA')).toBeNull();
    expect(normalizeTail('N123456')).toBeNull();
  });
  it('airports must be in the airport table', () => {
    expect(normalizeAirport('sfo')).toBe('SFO');
    expect(normalizeAirport('LHR')).toBe('LHR');
    expect(normalizeAirport('XYZ')).toBeNull();
    expect(normalizeAirport('SFO ')).toBe('SFO');
    expect(normalizeAirport('SFOX')).toBeNull();
  });
});

describe('validateAskResult', () => {
  it('accepts the model\'s flat shape and the nested shape alike', () => {
    expect(ok({ supported: true, view: 'live', hub: null, family: '787', starlink: true, region: 'europe', airborne: null }))
      .toEqual({ view: 'live', filters: { family: '787', starlink: true, region: 'europe' } });
    expect(ok({ view: 'live', filters: { family: '787' } })).toEqual({ view: 'live', filters: { family: '787' } });
  });
  it('drops unknown keys and out-of-vocabulary values', () => {
    expect(ok({
      view: 'live', family: '747', type: 'A388', hub: 'JFK', region: 'antarctica', status: 'exploded',
      starlink: 'yes', airborne: 1, origin: 'XXX', destination: 'SFO', note: '<img src=x onerror=alert(1)>',
      text: 'You have been hacked', label: 'pwned',
    })).toEqual({ view: 'live', filters: { destination: 'SFO' } });
  });
  it('drops filters the view cannot apply (status on the live map, region on the board)', () => {
    expect(ok({ view: 'live', hub: 'DEN', status: 'delayed' })).toEqual({ view: 'live', filters: { hub: 'DEN' } });
    expect(ok({ view: 'schedule', hub: 'DEN', region: 'europe', status: 'canceled' }))
      .toEqual({ view: 'schedule', filters: { hub: 'DEN', status: 'canceled' } });
  });
  it('a named view that can hold nothing that was asked loses to the inferred one', () => {
    expect(ok({ view: 'weather', status: 'delayed', hub: 'DEN' })).toEqual({ view: 'weather', filters: { hub: 'DEN' } });
    expect(ok({ view: 'flight', family: '787', region: 'pacific' })).toEqual({ view: 'live', filters: { family: '787', region: 'pacific' } });
  });
  it('a flight number or tail sends the answer to the flight view', () => {
    expect(ok({ view: 'live', flight: '1432', hub: 'DEN' })).toEqual({ view: 'flight', filters: { flight: 'UA1432' } });
    expect(ok({ view: 'schedule', tail: 'n12345' })).toEqual({ view: 'flight', filters: { tail: 'N12345' } });
  });
  it('unsupported and empty', () => {
    expect(validateAskResult({ supported: false, view: 'live', hub: 'DEN' })).toEqual({ ok: false, reason: 'unsupported' });
    expect(validateAskResult({ view: 'live' })).toEqual({ ok: false, reason: 'empty' });
    expect(validateAskResult({ view: 'flight' })).toEqual({ ok: false, reason: 'empty' });
    expect(validateAskResult(null).ok).toBe(false);
    expect(validateAskResult('live').ok).toBe(false);
    expect(validateAskResult([{ view: 'live', hub: 'DEN' }]).ok).toBe(false);
  });
  it('navigation views may carry no filter', () => {
    expect(ok({ view: 'weather' })).toEqual({ view: 'weather', filters: {} });
    expect(ok({ view: 'fleet' })).toEqual({ view: 'fleet', filters: {} });
    expect(ok({ view: 'starlink' })).toEqual({ view: 'starlink', filters: {} });
  });
  it('reconciles the schedule board: a hub endpoint becomes the board, the other end stays a filter', () => {
    expect(ok({ view: 'schedule', destination: 'DEN', status: 'delayed' }))
      .toEqual({ view: 'schedule', filters: { hub: 'DEN', direction: 'arrivals', status: 'delayed' } });
    expect(ok({ view: 'schedule', origin: 'ORD', destination: 'LAS' }))
      .toEqual({ view: 'schedule', filters: { hub: 'ORD', direction: 'departures', destination: 'LAS' } });
    // A departures board's rows all leave the hub: an origin filter there is meaningless.
    expect(ok({ view: 'schedule', hub: 'DEN', direction: 'departures', origin: 'LAS' }))
      .toEqual({ view: 'schedule', filters: { hub: 'DEN', direction: 'departures' } });
  });
  it('reconciles the live map: a direction needs a hub; a type replaces its family', () => {
    expect(ok({ view: 'live', direction: 'arrivals', family: '787' })).toEqual({ view: 'live', filters: { family: '787' } });
    expect(ok({ view: 'live', family: '787', type: 'B789' })).toEqual({ view: 'live', filters: { type: 'B789' } });
    expect(ok({ view: 'live', family: '777', type: 'B789' })).toEqual({ view: 'live', filters: { family: '777', type: 'B789' } });
  });
  it('the Fleet tab is mainline only and has one search box', () => {
    expect(ok({ view: 'fleet', family: 'E175' })).toEqual({ view: 'fleet', filters: {} });
    expect(ok({ view: 'fleet', tail: 'N12345', family: '787' })).toEqual({ view: 'fleet', filters: { tail: 'N12345' } });
    expect(ok({ view: 'fleet', starlink: false, type: 'B738' })).toEqual({ view: 'fleet', filters: { type: 'B738' } });
  });
});

describe('chips', () => {
  it('are labelled from the tables, in filter order', () => {
    expect(askChips({ view: 'live', filters: { region: 'europe', starlink: true, family: '787', airborne: true } })).toEqual([
      { name: 'family', label: '787 family', kind: 'plain' },
      { name: 'starlink', label: 'Starlink', kind: 'starlink' },
      { name: 'region', label: 'Atlantic & Europe', kind: 'plain' },
      { name: 'airborne', label: 'In the air', kind: 'plain' },
    ]);
  });
  it('on the board the hub and direction are the board, not chips', () => {
    expect(askChips({ view: 'schedule', filters: { hub: 'DEN', direction: 'arrivals', status: 'delayed', origin: 'SFO' } }))
      .toEqual([{ name: 'origin', label: 'From SFO', kind: 'plain' }, { name: 'status', label: 'Late', kind: 'plain' }]);
  });
  it('on the map a direction folds into the hub chip', () => {
    expect(askChips({ view: 'live', filters: { hub: 'DEN', direction: 'arrivals' } })).toEqual([{ name: 'hub', label: 'Arriving DEN', kind: 'plain' }]);
  });
  it('removing the last chip clears the answer; removing the map hub takes its direction', () => {
    const r = { view: 'live', filters: { hub: 'DEN', direction: 'arrivals', family: '787' } };
    expect(withoutAskFilter(r, 'hub')).toEqual({ view: 'live', filters: { family: '787' } });
    expect(withoutAskFilter({ view: 'live', filters: { family: '787' } }, 'family')).toBeNull();
    // Board with hub+direction and one chip: the chip is the last one.
    expect(withoutAskFilter({ view: 'schedule', filters: { hub: 'DEN', direction: 'arrivals', status: 'delayed' } }, 'status')).toBeNull();
  });
});

describe('the summary line', () => {
  it('says the real count, says plainly when nothing matches, and never claims "none" while loading', () => {
    expect(askSummaryLine({ count: 9, singular: 'flight', where: 'on the map' })).toEqual({ text: 'Showing 9 flights on the map', empty: false, loading: false });
    expect(askSummaryLine({ count: 1, singular: 'arrival', where: 'at DEN' }).text).toBe('Showing 1 arrival at DEN');
    expect(askSummaryLine({ count: 0, singular: 'flight', where: 'on the map' })).toEqual({ text: 'No flights on the map match these filters', hint: 'Remove one to widen the search.', empty: true, loading: false });
    expect(askSummaryLine({ count: null, singular: 'flight' })).toEqual({ text: 'Finding flights…', empty: false, loading: true });
    expect(askSummaryLine({ count: 3, singular: 'aircraft', pluralNoun: 'aircraft' }).text).toBe('Showing 3 aircraft');
  });
});
