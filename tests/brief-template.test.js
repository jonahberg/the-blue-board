// The template brief (src/lib/brief-template.js) is what every visitor sees whenever the model is not
// available, so its whole guarantee is pinned here: for every fixture it passes the same verifier
// the model's brief must pass, it leads with the specific problem, and it respects the item limits.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildBriefFacts, travelerNoteAllowed } from '../src/lib/brief-facts.js';
import { buildTemplateBrief, templateHeadline } from '../src/lib/brief-template.js';
import { verifyBrief } from '../src/lib/brief-verify.js';
import { radioFactsFromStatus } from '../src/lib/brief-radio.js';

const FIXTURE_DIR = new URL('./fixtures/brief/', import.meta.url);
const names = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
const factsFor = (name) => {
  const fx = JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURE_DIR), 'utf8'));
  const nowMs = Date.parse(fx.nowIso);
  const radio = Object.entries(fx.radio || {}).flatMap(([hub, status]) => radioFactsFromStatus(hub, status, { nowMs }));
  return buildBriefFacts({ ...fx.sources, extraFacts: radio }, { nowMs }).facts;
};

describe('every fixture’s template brief passes the verifier', () => {
  for (const name of names) {
    it(name, () => {
      const facts = factsFor(name);
      const t = buildTemplateBrief(facts);
      const out = verifyBrief({ headline: t.headline, tone: t.tone, items: t.items, traveler_note: t.traveler_note }, facts);
      expect(out.report.dropped).toEqual([]);
      expect(out.report.headline.status).toBe('kept');
      expect(out.report.tone.overridden).toBe(false);
      expect(out.report.warnings).toEqual([]);
      expect(t.items.length).toBeGreaterThanOrEqual(1);
      expect(t.items.length).toBeLessThanOrEqual(t.tone === 'calm' ? 3 : 4);
      expect(t.traveler_note === null).toBe(!travelerNoteAllowed(t.tone, facts));
      for (const id of t.headline_fact_ids) expect(facts.some((f) => f.id === id)).toBe(true);
    });
  }
});

describe('possible FAA programs away from the hubs', () => {
  for (const name of names) {
    it(`${name}: the template never leads with one`, () => {
      const facts = factsFor(name);
      const awayFromHubs = new Set(facts.filter((f) => f.kind === 'faa_planned' && !f.hub).map((f) => f.id));
      const t = buildTemplateBrief(facts);
      expect(awayFromHubs.has(t.items[0].fact_ids[0])).toBe(false);
      for (const id of t.headline_fact_ids) expect(awayFromHubs.has(id)).toBe(false);
    });
  }
});

describe('the unconfirmed "likely canceled" count', () => {
  for (const name of names) {
    it(`${name}: ranks below every program and planned hub program, and never leads the template`, () => {
      const facts = factsFor(name);
      const unconfirmed = facts.find((f) => f.id === 'cxl.unconfirmed');
      if (unconfirmed) {
        for (const f of facts.filter((x) => x.kind === 'faa' && /^faa\.active\.[A-Z]{3}\./.test(x.id) || (x.kind === 'faa_planned' && x.hub))) {
          expect(unconfirmed.severity, f.id).toBeLessThan(f.severity);
        }
      }
      const t = buildTemplateBrief(facts);
      expect(t.items[0].fact_ids).not.toContain('cxl.unconfirmed');
      expect(t.headline_fact_ids).not.toContain('cxl.unconfirmed');
    });
  }
});

describe('buildTemplateBrief', () => {
  it('calm: says it is calm and gives the background', () => {
    const t = buildTemplateBrief(factsFor('calm-afternoon'));
    expect(t.headline).toBe('United is running smoothly right now.');
    expect(t.items.map((i) => i.fact_ids[0])).toEqual(['otp.floor', 'faa.active.count', 'air.starlink']);
  });

  it('a hub ground stop: names the airport, leads with the program, adds a traveler note', () => {
    const t = buildTemplateBrief(factsFor('hub-ground-stop'));
    expect(t.tone).toBe('disrupted');
    expect(t.headline).toBe('A ground stop is holding flights into Newark.');
    expect(t.items[0].fact_ids).toEqual(['faa.active.EWR.gs']);
    // Specific facts, not the "1 FAA program is in effect" summary.
    expect(t.items.some((i) => i.fact_ids[0] === 'faa.active.count')).toBe(false);
    expect(t.traveler_note).toEqual({ text: "If you are flying to Newark, check your flight's status before you leave for the airport.", fact_ids: ['faa.active.EWR.gs'] });
  });

  it('one hub ground delay program (the morning of Nov 11): watch, the program first, a note for travelers bound there', () => {
    const t = buildTemplateBrief(factsFor('sfo-gdp-morning'));
    expect(t.tone).toBe('watch');
    expect(t.headline).toBe('A ground delay program is holding flights into San Francisco.');
    expect(t.items.map((i) => i.fact_ids[0])).toEqual(['faa.active.SFO.gdp', 'wx.SFO', 'faa.active.BOS.gdp', 'otp.floor']);
    expect(t.items[0].text).toBe('The FAA has a ground delay program in effect for flights heading to San Francisco (SFO) until 12:59 PM PT, because of low clouds. Those flights are held at their departure airport; delays average 62 minutes, up to 132 minutes.');
    expect(t.items[3].text).toBe('All 6 hubs with an on-time reading are at 86% or better.');
    expect(t.traveler_note).toEqual({ text: "If you are flying to San Francisco, check your flight's status before you leave for the airport.", fact_ids: ['faa.active.SFO.gdp'] });
  });

  it('delay programs at two hubs: disrupted, both named in the headline, no count item beside them', () => {
    const fx = JSON.parse(readFileSync(new URL('sfo-gdp-morning.json', FIXTURE_DIR), 'utf8'));
    const faa = fx.sources.faa.map((a) => (a.airportCode === 'EWR'
      ? { ...a, groundDelay: true, programs: [{ type: 'ground_delay', reason: 'VOL:Volume', avgDelay: 41, maxDelay: 88, endTime: '2026-11-11T23:59:00Z' }] }
      : a));
    const facts = buildBriefFacts({ ...fx.sources, faa }, { nowMs: Date.parse(fx.nowIso) }).facts;
    const t = buildTemplateBrief(facts);
    expect(t.tone).toBe('disrupted');
    expect(t.headline).toBe('Ground delay programs are holding flights into Newark and San Francisco.');
    expect(t.headline_fact_ids).toEqual(['faa.active.EWR.gdp', 'faa.active.SFO.gdp']);
    expect(t.items.map((i) => i.fact_ids[0])).not.toContain('faa.active.count');
    expect(t.traveler_note?.fact_ids).toEqual(['faa.active.EWR.gdp']);
    const out = verifyBrief({ headline: t.headline, tone: t.tone, items: t.items, traveler_note: t.traveler_note }, facts);
    expect(out.report.dropped).toEqual([]);
    expect(out.report.headline.status).toBe('kept');
  });

  it('planned only: a watch headline that names the hub, items that say "not in effect"', () => {
    const t = buildTemplateBrief(factsFor('planned-only-watch'));
    expect(t.headline).toBe('Running normally, with FAA action possible at Newark.');
    expect(t.items[0].text).toMatch(/possible for flights into Newark \(EWR\) until 9:00 PM ET\. It is not in effect\.$/);
  });

  it('unconfirmed cancellations: explains the index with the cancellation split, never calls them cancellations', () => {
    const t = buildTemplateBrief(factsFor('unconfirmed-cancellations'));
    expect(t.tone).toBe('watch');
    expect(t.items.map((i) => i.fact_ids[0]).slice(0, 3)).toEqual(['net.index', 'cxl.confirmed', 'cxl.unconfirmed']);
    expect(t.headline).toBe('United is mostly running normally right now.');
  });

  it('templateHeadline grounds a non-hub program without claiming it is at a hub', () => {
    const facts = [{ id: 'faa.active.BOS.gs', kind: 'faa', statement: '', values: ['BOS', 'Boston'], severity: 45, toneFloor: 'watch', link: { tab: 'weather' }, material: '' }];
    expect(templateHeadline(facts)).toEqual({ headline: "Ground stop for flights into Boston; United's hubs are running normally.", fact_ids: ['faa.active.BOS.gs'] });
  });
});
