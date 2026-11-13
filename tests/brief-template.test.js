// The template brief (src/lib/brief-template.js) is what every visitor sees whenever the model is not
// available, so its whole guarantee is pinned here: for every fixture it passes the same verifier
// the model's brief must pass, it leads with the specific problem, and it respects the item limits.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildBriefFacts, isAirborneShortfallFact, travelerNoteAllowed } from '../src/lib/brief-facts.js';
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

describe('no padding when something is wrong', () => {
  for (const name of names) {
    it(`${name}: a watch or disrupted template has no airborne, Starlink or weather-tally line`, () => {
      const t = buildTemplateBrief(factsFor(name));
      if (t.tone === 'calm') return;
      // The in-the-air comparison is the one exception: when it sets the tone it is the story.
      const shortfall = factsFor(name).some(isAirborneShortfallFact);
      for (const id of ['air.total', 'air.starlink', ...(shortfall ? [] : ['air.normal']), 'wx.summary']) expect(t.items.map((i) => i.fact_ids[0])).not.toContain(id);
      expect(t.items.length).toBeGreaterThanOrEqual(1);
    });
  }
});

describe('the unconfirmed "likely canceled" count', () => {
  for (const name of names) {
    it(`${name}: ranks below every program and planned hub program, and never leads the template`, () => {
      const facts = factsFor(name);
      const unconfirmed = facts.find((f) => f.id === 'cxl.unconfirmed');
      if (unconfirmed) {
        // Tomorrow's possible hub programs rank below every fact about now, this one included.
        for (const f of facts.filter((x) => x.kind === 'faa' && /^faa\.active\.[A-Z]{3}\./.test(x.id) || (x.kind === 'faa_planned' && x.hub && !x.later))) {
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
    // The LaGuardia delay program (not a hub) is in the items, so the note names it too, after the hub.
    expect(t.traveler_note).toEqual({ text: "If you are flying to Newark or New York LaGuardia, check your flight's status before you leave for the airport.", fact_ids: ['faa.active.EWR.gs', 'faa.active.LGA.gdp'] });
  });

  it('one hub ground delay program (the morning of Nov 11): watch, the program first, a note for travelers bound there', () => {
    const t = buildTemplateBrief(factsFor('sfo-gdp-morning'));
    expect(t.tone).toBe('watch');
    expect(t.headline).toBe('A ground delay program is holding flights into San Francisco.');
    // The low clouds are already in the program item: no separate San Francisco weather item.
    // No padding on a day something is wrong: no Starlink count, no weather tally.
    expect(t.items.map((i) => i.fact_ids[0])).toEqual(['faa.active.SFO.gdp', 'faa.active.BOS.gdp', 'otp.floor']);
    expect(t.items[0].text).toBe('The FAA has a ground delay program in effect for flights heading to San Francisco (SFO) until 12:59 PM PT, because of low clouds. Those flights are held at their departure airport; delays average 62 minutes, up to 132 minutes.');
    expect(t.items[2].text).toBe('All six United hubs reporting so far today are at 86% on time or better.');
    // Boston is not a hub, but United flies there: the note names it after the hub (Nov 2026).
    expect(t.traveler_note).toEqual({ text: "If you are flying to San Francisco or Boston, check your flight's status before you leave for the airport.", fact_ids: ['faa.active.SFO.gdp', 'faa.active.BOS.gdp'] });
  });

  it('leaves out a hub’s weather item behind its own weather-caused program, and gives the slot to the next specific fact', () => {
    const t = buildTemplateBrief(factsFor('hub-ground-stop'));
    // The thunderstorm ground stop at Newark already says "because of thunderstorms".
    // LaGuardia (not a hub) follows every fact about the hubs (Nov 2026).
    expect(t.items.map((i) => i.fact_ids[0])).toEqual(['faa.active.EWR.gs', 'otp.EWR', 'cxl.EWR', 'faa.active.LGA.gdp']);
    // A program for another cause leaves the hub's weather in.
    const fx = JSON.parse(readFileSync(new URL('sfo-gdp-morning.json', FIXTURE_DIR), 'utf8'));
    const faa = fx.sources.faa.map((a) => (a.airportCode === 'SFO'
      ? { ...a, programs: a.programs.map((p) => ({ ...p, reason: 'VOL:Volume' })) }
      : a));
    const facts = buildBriefFacts({ ...fx.sources, faa }, { nowMs: Date.parse(fx.nowIso) }).facts;
    expect(buildTemplateBrief(facts).items.map((i) => i.fact_ids[0])).toContain('wx.SFO');
  });

  it('delay programs at two hubs: still a watch, both named in the headline and in the traveler note', () => {
    const fx = JSON.parse(readFileSync(new URL('sfo-gdp-morning.json', FIXTURE_DIR), 'utf8'));
    const faa = fx.sources.faa.map((a) => (a.airportCode === 'EWR'
      ? { ...a, groundDelay: true, programs: [{ type: 'ground_delay', reason: 'VOL:Volume', avgDelay: 41, maxDelay: 88, endTime: '2026-11-11T23:59:00Z' }] }
      : a));
    const facts = buildBriefFacts({ ...fx.sources, faa }, { nowMs: Date.parse(fx.nowIso) }).facts;
    const t = buildTemplateBrief(facts);
    expect(t.tone).toBe('watch');
    expect(t.headline).toBe('Ground delay programs are holding flights into Newark and San Francisco.');
    expect(t.headline_fact_ids).toEqual(['faa.active.EWR.gdp', 'faa.active.SFO.gdp']);
    expect(t.items.map((i) => i.fact_ids[0])).not.toContain('faa.active.count');
    // With Boston's program in the items too, that is three airports: "one of those airports", hubs first.
    expect(t.traveler_note).toEqual({
      text: "If you are flying to one of those airports, check your flight's status before you leave for the airport.",
      fact_ids: ['faa.active.EWR.gdp', 'faa.active.SFO.gdp', 'faa.active.BOS.gdp'],
    });
    const out = verifyBrief({ headline: t.headline, tone: t.tone, items: t.items, traveler_note: t.traveler_note }, facts);
    expect(out.report.dropped).toEqual([]);
    expect(out.report.headline.status).toBe('kept');
  });

  it('a stop or delay program at two hubs names both in the note; three or more say "one of those airports"', () => {
    const storm = buildTemplateBrief(factsFor('storm-day'));
    expect(storm.traveler_note).toEqual({
      text: "If you are flying to Newark or Chicago O'Hare, check your flight's status before you leave for the airport.",
      fact_ids: ['faa.active.EWR.gs', 'faa.active.ORD.gdp'],
    });
    const fx = JSON.parse(readFileSync(new URL('sfo-gdp-morning.json', FIXTURE_DIR), 'utf8'));
    const gdp = (a) => ({ ...a, groundDelay: true, programs: [{ type: 'ground_delay', reason: 'VOL:Volume', avgDelay: 30, endTime: '2026-11-11T23:59:00Z' }] });
    const faa = fx.sources.faa.map((a) => (a.airportCode === 'EWR' || a.airportCode === 'ORD' ? gdp(a) : a));
    const facts = buildBriefFacts({ ...fx.sources, faa }, { nowMs: Date.parse(fx.nowIso) }).facts;
    const t = buildTemplateBrief(facts);
    expect(t.tone).toBe('watch');
    expect(t.traveler_note.text).toBe("If you are flying to one of those airports, check your flight's status before you leave for the airport.");
    expect(t.traveler_note.fact_ids).toEqual(['faa.active.EWR.gdp', 'faa.active.ORD.gdp', 'faa.active.SFO.gdp', 'faa.active.BOS.gdp']);
    const out = verifyBrief({ headline: t.headline, tone: t.tone, items: t.items, traveler_note: t.traveler_note }, facts);
    expect(out.report.travelerNote.status).toBe('kept');
    expect(out.report.headline.status).toBe('kept');
  });

  it('planned only: a watch headline that names the hub, items that say "not in effect"', () => {
    const t = buildTemplateBrief(factsFor('planned-only-watch'));
    expect(t.headline).toBe('FAA action is possible at Newark; none is in effect.');
    expect(t.items[0].text).toMatch(/possible for flights into Newark \(EWR\) until 9:00 PM ET\. It is not in effect\.$/);
  });

  it('unconfirmed cancellations: explains the index with the cancellation split, never calls them cancellations', () => {
    const t = buildTemplateBrief(factsFor('unconfirmed-cancellations'));
    expect(t.tone).toBe('watch');
    expect(t.items.map((i) => i.fact_ids[0]).slice(0, 3)).toEqual(['net.index', 'cxl.confirmed', 'cxl.unconfirmed']);
    expect(t.headline).toBe('United is mostly normal right now.');
  });

  it('templateHeadline: a program away from the hubs is calm, and the hubs come first', () => {
    const facts = [{ id: 'faa.active.BOS.gs', kind: 'faa', statement: '', values: ['BOS', 'Boston'], severity: 9, toneFloor: 'calm', link: { tab: 'weather' }, material: '' }];
    expect(templateHeadline(facts)).toEqual({ headline: "United's hubs are running normally; a ground stop is holding Boston arrivals.", fact_ids: ['faa.active.BOS.gs'] });
  });

  it('the 5:00 PM specimen without its possible hub programs: calm, the hubs first, then Seattle, and a note', () => {
    const t = buildTemplateBrief(factsFor('nonhub-gdp-calm'));
    expect(t.tone).toBe('calm');
    expect(t.headline).toBe("United's hubs are running normally; a delay program is slowing Seattle arrivals.");
    expect(t.items.map((i) => i.fact_ids[0])).toEqual(['otp.floor', 'faa.active.SEA.gdp', 'air.starlink']);
    expect(t.items[0].text).toBe('All seven United hubs reporting so far today are at 84% on time or better.');
    expect(t.items.some((i) => i.fact_ids.includes('cxl.confirmed'))).toBe(false);
    expect(t.traveler_note).toEqual({ text: "If you are flying to Seattle, check your flight's status before you leave for the airport.", fact_ids: ['faa.active.SEA.gdp'] });
  });

  it('the 5:00 PM specimen: calm (tomorrow\'s possible hub programs do not set tonight\'s tone), rule D\'s shape', () => {
    const t = buildTemplateBrief(factsFor('nonhub-gdp-specimen'));
    expect(t.tone).toBe('calm');
    expect(t.headline).toBe("United's hubs are running normally; a delay program is slowing Seattle arrivals.");
    // Now first, tomorrow's possibles last.
    expect(t.items.map((i) => i.fact_ids[0])).toEqual(['otp.floor', 'faa.active.SEA.gdp', 'faa.planned.EWR']);
    expect(t.items[2].text).toBe("The FAA's operations plan says a ground stop or ground delay program is possible for flights into Newark (EWR) tomorrow after 10:00 AM ET. It is not in effect.");
    expect(t.traveler_note).toEqual({ text: "If you are flying to Seattle, check your flight's status before you leave for the airport.", fact_ids: ['faa.active.SEA.gdp'] });
  });

  it('a possible hub program later today keeps its watch; its tomorrow twin is calm and comes last', () => {
    const today = buildTemplateBrief(factsFor('planned-only-watch'));
    expect(today.tone).toBe('watch');
    expect(today.headline).toBe('FAA action is possible at Newark; none is in effect.');
    const tomorrow = buildTemplateBrief(factsFor('planned-only-tomorrow'));
    expect(tomorrow.tone).toBe('calm');
    expect(tomorrow.headline).toBe('United is running smoothly right now.');
    expect(tomorrow.items.map((i) => i.fact_ids[0])).toEqual(['otp.floor', 'faa.planned.EWR', 'air.starlink']);
  });

  it('the 5:20 PM specimen: O\'Hare trails the others (an outlier at 80%), then the other hubs, then the index, then Seattle', () => {
    const t = buildTemplateBrief(factsFor('ord-80-specimen'));
    expect(t.tone).toBe('watch'); // the index at 20.3; O'Hare's floor is calm
    expect(t.headline).toBe("Mostly normal, with Chicago O'Hare behind the other hubs.");
    expect(t.items.map((i) => i.text)).toEqual([
      "Chicago O'Hare (ORD) is at 80% on time so far today (460 departed), behind the other hubs, which are at 89% or better.",
      'The other six United hubs reporting so far today are at 89% on time or better.',
      "The network disruption index, which weighs cancellations, long delays and diversions across United's hub departures, is 20.3, in the minor-disruption range (20 to 40).",
      'The FAA has a ground delay program in effect for flights heading to Seattle (SEA) until 9:59 PM PT. Those flights are held at their departure airport; delays average 32 minutes, up to 82 minutes.',
    ]);
    expect(buildTemplateBrief(factsFor('ord-79-variant')).headline).toBe("Mostly normal, with Chicago O'Hare behind the other hubs.");
  });

  it('a long name away from the hubs: the shorter name that stands for it alone, then "elsewhere"', () => {
    expect(buildTemplateBrief(factsFor('nonhub-gs-calm')).headline).toBe("United's hubs are running normally; a ground stop is holding LaGuardia arrivals.");
    const away = (code, sev = 8.6) => ({ id: `faa.active.${code}.gdp`, kind: 'faa', statement: '', values: [code], severity: sev, toneFloor: 'calm', link: { tab: 'weather' }, material: '' });
    expect(templateHeadline([away('SEA'), away('BOS', 8.5)]).headline).toBe("United's hubs are normal; delay programs are slowing Seattle and Boston arrivals.");
    expect(templateHeadline([away('SLC'), away('FLL', 8.5)]).headline).toBe("United's hubs are running normally; FAA programs are slowing flights elsewhere.");
  });

  it('five programs away from the hubs: the template prints at most two of them, after the hubs', () => {
    const t = buildTemplateBrief(factsFor('five-nonhub-storm'));
    const ids = t.items.map((i) => i.fact_ids[0]);
    expect(ids[0]).toBe('wx.EWR');
    expect(ids.filter((id) => /^faa\.active\.[A-Z]{3}\./.test(id)).length).toBeLessThanOrEqual(2);
    // The note names only the airports the items print.
    expect(t.traveler_note?.fact_ids.every((id) => ids.includes(id))).toBe(true);
  });
});

describe('far fewer flights in the air than usual (Nov 13 2026, the nationwide ground stop)', () => {
  const NAME = 'nationwide-stop-2026-11-13';
  const withAir = (airborne, median = 651) => {
    const fx = JSON.parse(readFileSync(new URL(`${NAME}.json`, FIXTURE_DIR), 'utf8'));
    return buildBriefFacts({ ...fx.sources, air: { airborne, starlink: null }, airNormal: { median, days: 7 } }, { nowMs: Date.parse(fx.nowIso) }).facts;
  };

  it('the captured afternoon: disrupted, led by the count against the usual, with a note for every traveler', () => {
    const t = buildTemplateBrief(factsFor(NAME));
    expect(t.tone).toBe('disrupted');
    expect(t.headline).toBe('Far fewer United flights are in the air than usual right now.');
    expect(t.headline_fact_ids).toEqual(['air.normal']);
    expect(t.items[0]).toEqual({
      text: 'The 174 United flights in the air are 73% fewer than usual for this time of day: over the past 7 days, the median at this hour was 651.',
      fact_ids: ['air.normal'],
    });
    // The San Francisco delay program that led the published brief is still there, second.
    expect(t.items[1].fact_ids).toEqual(['faa.active.SFO.gdp']);
    expect(t.traveler_note).toEqual({
      text: "Whichever airport you are flying to, check your flight's status before you leave for the airport.",
      fact_ids: ['air.normal'],
    });
  });

  it('never says why: no word of a nationwide stop, which no fact supports', () => {
    const t = buildTemplateBrief(factsFor(NAME));
    const text = [t.headline, ...t.items.map((i) => i.text), t.traveler_note.text].join(' ');
    expect(text).not.toMatch(/nationwide|national|all airports|every airport is/i);
  });

  it('at 30% to 44% fewer it is a watch: a hub delay program keeps the headline, the shortfall is an item', () => {
    const t = buildTemplateBrief(withAir(420)); // 35% fewer
    expect(t.tone).toBe('watch');
    expect(t.headline).toBe('A ground delay program is holding flights into San Francisco.');
    expect(t.items.map((i) => i.fact_ids[0])).toContain('air.normal');
    expect(t.traveler_note.fact_ids).not.toContain('air.normal');
  });

  it('at 30% to 44% fewer with no hub delay program, the shortfall is the watch headline', () => {
    // Without the San Francisco program, and the hub-program count that goes with it.
    const facts = withAir(420).filter((f) => f.id !== 'faa.active.SFO.gdp' && f.id !== 'faa.active.count');
    const t = templateHeadline(facts);
    expect(t).toEqual({ headline: 'Fewer United flights than usual are in the air right now.', fact_ids: ['air.normal'] });
  });

  it('at 20% fewer nothing changes: the comparison stays background', () => {
    const t = buildTemplateBrief(withAir(521));
    expect(t.tone).toBe('watch');
    expect(t.items.map((i) => i.fact_ids[0])).not.toContain('air.normal');
  });
});
