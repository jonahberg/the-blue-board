// The brief's chips (src/lib/brief-chips.js): one short label per cited fact, and a link only
// where the dashboard really shows that fact. Driven by every fixture in tests/fixtures/brief/
// through the real fact builder (and the radio builder), so a new fact id the server starts
// emitting cannot reach the screen as an empty or misleading chip unnoticed.

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildBriefFacts, publicFact } from '../src/lib/brief-facts.js';
import { radioFactsFromStatus } from '../src/lib/brief-radio.js';
import { chipLabel, chipTarget, chipTone, itemChips } from '../src/lib/brief-chips.js';
import { WEATHER_CARD_HUBS, weatherScrollTarget } from '../src/lib/tab-hash.js';
import { WX_HUBS } from '../src/lib/weather-cards.js';

const DIR = resolve(__dirname, 'fixtures', 'brief');
const FIXTURES = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(resolve(DIR, f), 'utf8')));

/** The public facts a fixture produces, exactly as GET /api/brief would serve them. */
function factsOf(fx) {
  const nowMs = Date.parse(fx.nowIso);
  const radio = Object.entries(fx.radio || {}).flatMap(([hub, status]) => radioFactsFromStatus(hub, status, { nowMs }));
  const { facts } = fx.facts ? { facts: fx.facts } : buildBriefFacts({ ...(fx.sources || {}), extraFacts: radio }, { nowMs });
  return facts.map(publicFact);
}

const ALL = FIXTURES.flatMap((fx) => factsOf(fx).map((f) => ({ fixture: fx.name, fact: f })));
const byId = (facts) => new Map(facts.map((f) => [f.id, f]));
const fixture = (name) => factsOf(FIXTURES.find((fx) => fx.name === name));

describe('chip labels', () => {
  it('every fact in every fixture, radio and flow included, gets a short non-empty label', () => {
    expect(ALL.length).toBeGreaterThan(150);
    for (const { fixture: name, fact } of ALL) {
      const label = chipLabel(fact);
      expect(label, `${name} ${fact.id}`).toMatch(/\S/);
      expect(label.length, `${name} ${fact.id}: ${label}`).toBeLessThanOrEqual(28);
    }
  });

  it('reads the mockup examples off the calm afternoon', () => {
    const f = byId(fixture('calm-afternoon'));
    expect(chipLabel(f.get('otp.LAX'))).toBe('LAX 85%');
    expect(chipLabel(f.get('otp.floor'))).toBe('7 hubs ≥ 85%');
    expect(chipLabel(f.get('faa.planned.BOS'))).toBe('FAA plan · BOS');
    expect(chipLabel(f.get('air.total'))).toBe('630 airborne');
    expect(chipLabel(f.get('air.starlink'))).toBe('280 Starlink');
    expect(chipLabel(f.get('faa.active.count'))).toBe('FAA · no hub programs');
  });

  it('names FAA programs by type and airport, and radio by the AIRPORT clock its sentence uses', () => {
    const f = byId(fixture('ground-stop-with-radio'));
    expect(chipLabel(f.get('faa.active.EWR.gs'))).toBe('FAA ground stop · EWR');
    expect(chipLabel(f.get('flow.EWR.arrivals'))).toBe('EWR arrivals');
    expect(chipLabel(f.get('flow.EWR.runways'))).toBe('EWR runways');
    const radio = [...f.values()].find((x) => x.kind === 'radio');
    expect(radio).toBeTruthy();
    const label = chipLabel(radio);
    expect(label).toMatch(/^ATC radio · \d{1,2}:\d{2} [AP]M ET$/);
    // The clock is one of the fact's own values, i.e. what the sentence was checked against.
    expect(radio.values).toContain(label.replace('ATC radio · ', ''));
  });

  it('labels storm-day and cancellation facts from their values, never their wording', () => {
    const storm = byId(fixture('storm-day'));
    expect(chipLabel(storm.get('faa.active.ORD.gdp'))).toBe('FAA delay program · ORD');
    expect(chipLabel(storm.get('otp.ORD'))).toBe('ORD 48%');
    expect(chipLabel(storm.get('otp.min'))).toBe('Lowest EWR 41%');
    const cx = byId(fixture('unconfirmed-cancellations'));
    expect(chipLabel(cx.get('cxl.confirmed'))).toBe('6 canceled');
    expect(chipLabel(cx.get('cxl.unconfirmed'))).toBe('162 unconfirmed');
    expect(chipLabel(cx.get('net.index'))).toBe('Disruption index 21.4');
    expect(chipLabel(cx.get('net.status'))).toBe('Network status');
  });

  it('handles suffixed planned ids, empty values and unknown kinds', () => {
    expect(chipLabel({ id: 'faa.planned.EWR.2', kind: 'faa_planned', values: [] })).toBe('FAA plan · EWR');
    expect(chipLabel({ id: 'net.status', kind: 'network', values: [] })).toBe('Network status');
    expect(chipLabel({ id: 'something.new', kind: 'mystery', values: ['12'] })).toBe('Source');
    expect(chipLabel({ id: 'otp.XYZ', kind: 'otp', hub: 'ORD', values: [] })).toBe('On-time · ORD');
    expect(chipLabel({ id: 'radio.EWR.9', kind: 'radio', values: ['EWR', 'Newark'] })).toBe('ATC radio · EWR');
    expect(chipLabel(null)).toBe('Source');
  });
});

describe('chip tone', () => {
  it('radio is its own tone; a hub ground stop, delay program or closure is the alert tone; the rest are plain', () => {
    const f = byId(fixture('ground-stop-with-radio'));
    expect(chipTone([...f.values()].find((x) => x.kind === 'radio'))).toBe('radio');
    expect(chipTone(f.get('faa.active.EWR.gs'))).toBe('alert');
    expect(chipTone(f.get('otp.EWR'))).toBe('plain');
    const live = byId(fixture('live-2026-11-10-evening'));
    // A ground stop at Boston is not a United hub: no alarm colour for it.
    expect(chipTone(live.get('faa.active.BOS.gs'))).toBe('plain');
  });
});

describe('chip targets', () => {
  it('links only where the destination shows the fact', () => {
    const calm = byId(fixture('calm-afternoon'));
    expect(chipTarget(calm.get('otp.LAX'))).toEqual({ tab: 'schedule', href: '/?tab=schedule&hub=LAX' });
    // The on-time floor links its lowest hub, whose board shows it (the IROPS bar does not).
    expect(chipTarget(calm.get('otp.floor'))).toEqual({ tab: 'schedule', href: '/?tab=schedule&hub=LAX' });
    const soft = byId(fixture('storm-day')).get('otp.soft');
    expect(chipTarget(soft)).toEqual({ tab: 'schedule', href: `/?tab=schedule&hub=${soft.values.find((v) => /^[A-Z]{3}$/.test(v))}` });
    expect(chipTarget(calm.get('faa.planned.BOS'))).toEqual({ tab: 'weather', href: '/?tab=weather&section=nas' });
    expect(chipTarget(calm.get('faa.active.count'))).toEqual({ tab: 'weather', href: '/#weather' });
    expect(chipTarget(calm.get('air.total'))).toEqual({ tab: 'live', href: '/#live' });
    expect(chipTarget(calm.get('air.starlink'))).toEqual({ tab: 'starlink', href: '/#starlink' });

    const gs = byId(fixture('ground-stop-with-radio'));
    expect(chipTarget(gs.get('faa.active.EWR.gs'))).toEqual({ tab: 'weather', href: '/?tab=weather&hub=EWR' });
    expect(chipTarget(gs.get('flow.EWR.arrivals'))).toBeNull();
    expect(chipTarget([...gs.values()].find((x) => x.kind === 'radio'))).toBeNull();

    // A program at an airport with no card is shown nowhere on the Weather tab.
    const live = byId(fixture('live-2026-11-10-evening'));
    expect(chipTarget(live.get('faa.active.BOS.gs'))).toBeNull();

    // Cancellation totals: the IROPS bar's Canceled figure is the same /api/irops number.
    const cx = byId(fixture('unconfirmed-cancellations'));
    expect(chipTarget(cx.get('cxl.confirmed'))).toEqual({ tab: 'weather', href: '/?tab=irops' });
    expect(chipTarget(cx.get('net.index'))).toEqual({ tab: 'weather', href: '/?tab=irops' });

    const storm = byId(fixture('storm-day'));
    const hubCxl = [...storm.values()].find((x) => /^cxl\.[A-Z]{3}$/.test(x.id));
    expect(chipTarget(hubCxl)).toEqual({ tab: 'schedule', href: `/?tab=schedule&hub=${hubCxl.hub}` });
    expect(chipTarget(storm.get('wx.EWR') ?? { id: 'wx.EWR', kind: 'weather', hub: 'EWR', link: { tab: 'weather', hub: 'EWR' } }))
      .toEqual({ tab: 'weather', href: '/?tab=weather&hub=EWR' });
  });

  it('every href resolves through the same weather-scroll resolver the URL uses on load', () => {
    for (const { fact } of ALL) {
      const t = chipTarget(fact);
      if (!t) continue;
      const url = new URL(t.href, 'https://theblueboard.co');
      if (url.searchParams.get('hub') && url.searchParams.get('tab') === 'weather') {
        expect(weatherScrollTarget(url.searchParams)).toBe(`hub-card-${url.searchParams.get('hub')}`);
      }
      if (url.searchParams.get('section') === 'nas') expect(weatherScrollTarget(url.searchParams)).toBe('nas-section');
      if (url.searchParams.get('tab') === 'irops') expect(weatherScrollTarget(url.searchParams)).toBe('irops-section');
      if (url.searchParams.get('tab') === 'schedule') expect(WEATHER_CARD_HUBS).toContain(url.searchParams.get('hub'));
    }
  });

  it('a fact with no link, or a malformed one, has no target', () => {
    expect(chipTarget({ id: 'otp.ORD', kind: 'otp', link: null })).toBeNull();
    expect(chipTarget({ id: 'x', kind: 'otp', link: { tab: 'nowhere' } })).toBeNull();
  });
});

describe('itemChips', () => {
  it('keeps citation order, skips unknown ids and folds duplicate labels', () => {
    const f = byId(fixture('calm-afternoon'));
    const chips = itemChips(['otp.floor', 'nope', 'otp.LAX', 'otp.LAX', 'air.starlink'], f);
    expect(chips.map((c) => c.label)).toEqual(['7 hubs ≥ 85%', 'LAX 85%', '280 Starlink']);
    expect(chips[0].title).toBe(f.get('otp.floor').statement);
    expect(itemChips(undefined, f)).toEqual([]);
  });
});

describe('the Weather tab card hubs', () => {
  it('match the cards the Weather tab actually renders', () => {
    expect([...WEATHER_CARD_HUBS]).toEqual(WX_HUBS);
  });
});
