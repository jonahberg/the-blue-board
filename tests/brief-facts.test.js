// The ops brief's fact builder (src/lib/brief-facts.js): the site's own payloads in, facts out.
// Pins the catalogue ids, the surface forms the verifier will allow, the local-clock conversion, the
// confirmed/unconfirmed cancellation split, the sample and freshness floors, and the material key
// that decides whether a run writes a new brief.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  airborneNormal, buildBriefFacts, computeTone, countAirborneAndStarlink, faaCausePhrase,
  formatAirportClock, isWholeAirportClosure, materialKey, parseIsoMs, publicFact, resolveZuluHhmm,
  travelerNoteAllowed,
} from '../src/lib/brief-facts.js';

const FIXTURE_DIR = new URL('./fixtures/brief/', import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, FIXTURE_DIR), 'utf8'));
const build = (fx, patch = {}) => buildBriefFacts({ ...fx.sources, ...patch }, { nowMs: Date.parse(fx.nowIso) });
const byId = (facts) => Object.fromEntries(facts.map((f) => [f.id, f]));

describe('clock helpers', () => {
  it('formats an instant on the airport’s own clock with a zone label and plain spaces', () => {
    const ms = Date.parse('2026-11-11T02:00:00Z');
    expect(formatAirportClock(ms, 'EWR')).toBe('9:00 PM ET');
    expect(formatAirportClock(ms, 'ORD')).toBe('8:00 PM CT');
    expect(formatAirportClock(ms, 'SFO')).toBe('6:00 PM PT');
    expect(formatAirportClock(ms, 'EWR')).not.toMatch(/ /);
    expect(formatAirportClock(ms, 'XXX')).toBeNull();
    expect(formatAirportClock(Number.NaN, 'EWR')).toBeNull();
  });

  it('resolves a bare Zulu HHMM to the occurrence nearest now, across midnight', () => {
    const now = Date.parse('2026-11-10T23:10:00Z');
    expect(new Date(resolveZuluHhmm('0030', now)).toISOString()).toBe('2026-11-11T00:30:00.000Z');
    expect(new Date(resolveZuluHhmm('1800', now)).toISOString()).toBe('2026-11-10T18:00:00.000Z');
    expect(resolveZuluHhmm('2460', now)).toBeNull();
  });

  it('parses ISO timestamps with nanosecond fractions and refuses anything else', () => {
    expect(parseIsoMs('2026-11-10T22:29:07.792347607Z')).toBe(Date.parse('2026-11-10T22:29:07.792Z'));
    expect(parseIsoMs('2345')).toBeNull();
    expect(parseIsoMs(undefined)).toBeNull();
  });
});

describe('FAA causes', () => {
  it('maps the FAA reason through an allowlist and never quotes NOTAM text', () => {
    expect(faaCausePhrase('WX:Low Ceilings')).toBe('low clouds');
    expect(faaCausePhrase('WX:Thunderstorms')).toBe('thunderstorms');
    expect(faaCausePhrase('runway construction')).toBe('runway construction');
    expect(faaCausePhrase('VOL:Volume')).toBe('heavy traffic');
    expect(faaCausePhrase('!SNA 11/008 SNA AD AP CLSD DLY 0730-1415 PPR 702-261-7775')).toBeNull();
  });

  it('a hub closure statement carries no NOTAM text', () => {
    const fx = fixture('calm-afternoon');
    const faa = [{ airportCode: 'EWR', programs: [{ type: 'closure', reason: '!EWR 11/001 EWR AD AP CLSD SNOW AND ICE REMOVAL' }], closure: true, delays: [] }];
    const { facts } = build(fx, { faa });
    const closure = byId(facts)['faa.active.EWR.closure'];
    expect(closure.statement).toBe('The FAA lists Newark (EWR) as closed.');
    expect(JSON.stringify(closure.values)).not.toMatch(/CLSD|11\/001/);
    expect(closure.toneFloor).toBe('disrupted');
  });

  it('screens out routine closures: nightly curfews, PPR/GA restrictions, runway-only closures', () => {
    expect(isWholeAirportClosure('!SNA 11/008 SNA AD AP CLSD DLY 0730-1415 2611100730-2611211415')).toBe(false);
    expect(isWholeAirportClosure('TO NON SKED TRANSIENT GA ACFT EXC 24HR PPR 702-261-7775')).toBe(false);
    expect(isWholeAirportClosure('!ORD 11/120 ORD RWY 10L/28R CLSD')).toBe(false);
    expect(isWholeAirportClosure('snow and ice removal')).toBe(true);
    const fx = fixture('calm-afternoon');
    const faa = [{ airportCode: 'EWR', programs: [{ type: 'closure', reason: '!EWR 11/002 EWR AD AP CLSD DLY 0400-0500' }], closure: true, delays: [] }];
    const { facts, collection } = build(fx, { faa });
    expect(byId(facts)['faa.active.EWR.closure']).toBeUndefined();
    expect(computeTone(facts)).toBe('calm');
    expect(collection.skipped).toContain('faa.active.EWR.closure: a scheduled or partial closure, not an outage');
  });

  it('ignores programs at airports we cannot name or put on a clock', () => {
    const fx = fixture('calm-afternoon');
    const faa = [{ airportCode: 'BFI', programs: [{ type: 'ground_stop', reason: 'wind' }], groundStop: true, delays: [] }, ...fx.sources.faa];
    const { facts } = build(fx, { faa });
    expect(facts.some((f) => f.id.startsWith('faa.active.BFI'))).toBe(false);
    expect(computeTone(facts)).toBe('calm');
  });
});

describe('buildBriefFacts: the catalogue', () => {
  it('builds the calm-afternoon facts with stable, readable ids', () => {
    const { facts, collection } = build(fixture('calm-afternoon'));
    expect(facts.map((f) => f.id).sort()).toEqual([
      'air.normal', 'air.starlink', 'air.total', 'cxl.confirmed', 'cxl.unconfirmed', 'faa.active.count',
      'faa.planned.BOS', 'faa.planned.count', 'net.index', 'net.status', 'otp.DEN', 'otp.EWR', 'otp.IAD',
      'otp.IAH', 'otp.LAX', 'otp.ORD', 'otp.SFO', 'otp.floor', 'wx.summary',
    ]);
    expect(collection.sources).toEqual({ irops: 'ok', faa: 'ok', nas: 'ok', metar: 'ok', air: 'ok', airNormal: 'ok' });
    expect(computeTone(facts)).toBe('calm');
    // Every fact has the documented shape.
    for (const f of facts) {
      expect(f).toEqual(expect.objectContaining({ id: expect.any(String), kind: expect.any(String), statement: expect.any(String), values: expect.any(Array), link: expect.objectContaining({ tab: expect.any(String) }) }));
    }
  });

  it('gives each hub its on-time figure, count and every name that may stand for it', () => {
    const { facts } = build(fixture('calm-afternoon'));
    const ord = byId(facts)['otp.ORD'];
    expect(ord.statement).toBe("Chicago O'Hare (ORD): 91% of departures so far today left within 30 minutes of schedule (410 departed).");
    expect(ord.values).toEqual(['91%', '410', '30 minutes', 'ORD', "Chicago O'Hare", "O'Hare", 'Chicago']);
    expect(ord.link).toEqual({ tab: 'schedule', hub: 'ORD' });
  });

  it('does not single out the lowest hub while every hub is at 80% or better, and never the highest', () => {
    const fx = fixture('calm-afternoon');
    const calm = byId(build(fx).facts);
    expect(calm['otp.min']).toBeUndefined();
    expect(calm['otp.max']).toBeUndefined();
    expect(calm['otp.floor'].statement).toBe('All 7 hubs with an on-time reading are at 85% or better.');
    // The floor's values cannot vouch for naming the lowest hub; its chip still proves it there.
    expect(calm['otp.floor'].values).toEqual(['7', 'seven', '85%']);
    expect(calm['otp.floor'].link).toEqual({ tab: 'schedule', hub: 'LAX' });

    // Los Angeles at 75%: below 80, so the lowest hub is worth naming again.
    const metrics = { ...fx.sources.irops.hubMetrics, LAX: { ...fx.sources.irops.hubMetrics.LAX, onTime: 59 } };
    const low = byId(build(fx, { irops: { ...fx.sources.irops, hubMetrics: metrics } }).facts);
    expect(low['otp.min'].statement).toBe('Of the 7 hubs with an on-time reading, Los Angeles (LAX) is lowest at 75%.');
    expect(low['otp.min'].values).toEqual(expect.arrayContaining(['75%', 'LAX', 'Los Angeles']));
    expect(low['otp.floor'].statement).toBe('All 7 hubs with an on-time reading are at 75% or better; Los Angeles is the lowest.');
    expect(low['otp.max']).toBeUndefined();
  });

  it('converts planned FAA windows to the airport’s local clock and says they are not in effect', () => {
    const { facts } = build(fixture('planned-only-watch'));
    const ewr = byId(facts)['faa.planned.EWR'];
    expect(ewr.statement).toBe("The FAA's operations plan says a ground stop or ground delay program is possible for flights into Newark (EWR) until 9:00 PM ET. It is not in effect.");
    expect(ewr.values).toContain('9:00 PM ET');
    expect(byId(facts)['faa.planned.SFO'].values).toContain('4:00 PM PT');
    expect(ewr.toneFloor).toBe('watch');
    // The en-route CDRS/SWAP line names no airport and is not a stop or delay program.
    expect(facts.some((f) => /FLORIDA/i.test(f.statement))).toBe(false);
    expect(computeTone(facts)).toBe('watch');
  });

  it('ranks possible programs at airports that are not hubs last, below every other fact', () => {
    const { facts } = build(fixture('calm-afternoon'));
    expect(facts.slice(-2).map((f) => f.id)).toEqual(['faa.planned.BOS', 'faa.planned.count']);
    expect(facts.slice(-2).every((f) => f.severity === 0)).toBe(true);
    expect(facts.slice(0, -2).every((f) => f.severity > 0)).toBe(true);
    // A possible program at a hub still ranks as a watch, and so does the count beside it.
    const watch = byId(build(fixture('planned-only-watch')).facts);
    expect(watch['faa.planned.EWR'].severity).toBe(22);
    expect(watch['faa.planned.count'].severity).toBe(3);
  });

  it('drops a planned program where one is already in effect, instead of contradicting it', () => {
    const { facts, collection } = build(fixture('hub-ground-stop'));
    expect(byId(facts)['faa.active.EWR.gs']).toBeDefined();
    expect(facts.some((f) => f.id.startsWith('faa.planned.EWR'))).toBe(false);
    expect(collection.skipped).toContain('faa.planned.EWR: a program is already in effect there');
  });

  it('describes an active ground stop with its local end time, cause and extension odds', () => {
    const { facts } = build(fixture('hub-ground-stop'));
    const gs = byId(facts)['faa.active.EWR.gs'];
    expect(gs.statement).toBe('The FAA has a ground stop in effect for flights heading to Newark (EWR) until 8:30 PM ET, because of thunderstorms. Those flights are held at their departure airport. It rates the chance of an extension as high.');
    expect(gs.values).toEqual(expect.arrayContaining(['EWR', 'Newark', '8:30 PM ET', 'thunderstorms']));
    expect(gs).toEqual(expect.objectContaining({ hub: 'EWR', severity: 100, toneFloor: 'disrupted', link: { tab: 'weather', hub: 'EWR' } }));
    expect(byId(facts)['faa.active.count'].statement).toBe('1 FAA program affects a United hub: a ground stop for flights into Newark.');
    expect(byId(facts)['net.status'].statement).toContain('"Disrupted"');
  });

  it('omits an end time that does not parse rather than inventing one', () => {
    const fx = fixture('hub-ground-stop');
    const faa = fx.sources.faa.map((a) => (a.airportCode === 'EWR' ? { ...a, programs: [{ type: 'ground_stop', reason: 'thunderstorms', endTime: '2345' }] } : a));
    const gs = byId(build(fx, { faa }).facts)['faa.active.EWR.gs'];
    expect(gs.statement).toBe('The FAA has a ground stop in effect for flights heading to Newark (EWR), because of thunderstorms. Those flights are held at their departure airport.');
  });

  it('keeps confirmed and unconfirmed cancellations as separate facts', () => {
    const { facts } = build(fixture('unconfirmed-cancellations'));
    const confirmed = byId(facts)['cxl.confirmed'];
    const unconfirmed = byId(facts)['cxl.unconfirmed'];
    expect(confirmed.statement).toBe("6 departures on United's current hub boards are confirmed canceled.");
    expect(unconfirmed.statement).toBe('The schedule provider marks 162 more hub departures as "likely canceled" without confirming them. That label is often wrong: 131 flights it marked that way today were seen flying.');
    expect(unconfirmed.values).not.toContain('6');
    expect(confirmed.values).not.toContain('162');
    expect(unconfirmed.severity).toBeLessThan(5);
    expect(computeTone(facts)).toBe('watch'); // the index is in the minor band
  });

  it('leaves out hubs too thin to read and boards too old to trust, and says so', () => {
    const fx = fixture('overnight-low-traffic');
    const { facts, collection } = build(fx);
    expect(byId(facts)['otp.NRT']).toBeUndefined();
    expect(collection.skipped).toEqual(expect.arrayContaining(['otp.NRT: 6 operated (under 25)', 'otp.GUM: 5 operated (under 25)']));
    const metrics = { ...fx.sources.irops.hubMetrics, ORD: { ...fx.sources.irops.hubMetrics.ORD, generatedAt: Math.floor(Date.parse(fx.nowIso) / 1000) - 4 * 3600 } };
    const stale = build(fx, { irops: { ...fx.sources.irops, hubMetrics: metrics } });
    expect(byId(stale.facts)['otp.ORD']).toBeUndefined();
    expect(stale.collection.skipped).toContain('otp.ORD: board 240 min old');
  });

  it('says "yesterday" for a hub whose board has not rolled over yet', () => {
    const { facts } = build(fixture('overnight-low-traffic'));
    expect(byId(facts)['otp.EWR'].statement).toContain('yesterday (its board has not rolled over to today yet)');
  });

  it('reports hub weather that affects operations in plain words, with gusts as printed', () => {
    const { facts } = build(fixture('hub-ground-stop'));
    const wx = byId(facts)['wx.EWR'];
    expect(wx.statement).toBe('Newark (EWR) weather: low visibility, thunderstorms, heavy rain and wind gusting to 34 knots, enough to slow arrivals and departures.');
    expect(wx.values).toEqual(expect.arrayContaining(['34 knots', 'thunderstorms', 'weather']));
    expect(byId(facts)['wx.summary'].statement).toBe('Weather is affecting operations at 1 of the 9 United hubs with a current report: Newark.');
  });

  it('says what each weather level does to the operation, never the site’s own rating', () => {
    const fx = fixture('overnight-low-traffic');
    const at = (raw) => {
      const metar = fx.sources.metar.map((m) => (m.icaoId === 'KDEN' ? { ...m, rawOb: raw } : m));
      return build(fx, { metar });
    };
    expect(byId(build(fx).facts)['wx.SFO'].statement)
      .toBe('San Francisco (SFO) weather: very low clouds, very low visibility and fog, enough to slow arrivals and departures significantly.');
    // A steady 42-knot wind with no gust group is a warning, and it is named.
    const wind = byId(at('METAR KDEN 110853Z 27042KT 10SM CLR 07/M08 A3021 RMK AO2').facts)['wx.DEN'];
    expect(wind.statement).toBe('Denver (DEN) weather: wind of 42 knots, enough to slow arrivals and departures.');
    expect(wind.values).toContain('42 knots');
    // Light rain is a caution: it can cause delays.
    expect(byId(at('METAR KDEN 110853Z 18006KT 10SM -RA BKN040 07/05 A3021 RMK AO2').facts)['wx.DEN'].statement)
      .toBe('Denver (DEN) weather: rain, which can cause minor delays.');
    // Low scattered cloud over mist is a caution with nothing to name: no fact, and the reason why.
    const mist = at('METAR KDEN 110853Z 18006KT 6SM BR FEW008 07/05 A3021 RMK AO2');
    expect(byId(mist.facts)['wx.DEN']).toBeUndefined();
    expect(mist.collection.skipped).toContain('wx.DEN: caution with no condition to name (low clouds with active weather)');
    expect(mist.facts.every((f) => !/weather that can slow|rates the effect/.test(f.statement))).toBe(true);
  });

  it('compares the airborne count with the median for this time of day', () => {
    const storm = byId(build(fixture('storm-day')).facts)['air.normal'];
    expect(storm.statement).toBe('The 702 United flights in the air are 11% fewer than usual for this time of day: over the past 7 days, the median at this hour was 790.');
    expect(storm.values).toEqual(expect.arrayContaining(['790', '11%', '702']));
    const calm = byId(build(fixture('calm-afternoon')).facts)['air.normal'];
    expect(calm.statement).toContain('about the usual number');
  });

  it('builds nothing from a source that did not answer', () => {
    const { facts, collection } = buildBriefFacts({ faa: [] }, { nowMs: Date.parse('2026-11-10T21:40:00Z') });
    expect(facts.map((f) => f.id)).toEqual(['faa.active.count']);
    expect(collection.sources.irops).toBe('missing');
  });

  it('serves only the public fields', () => {
    const f = build(fixture('calm-afternoon')).facts[0];
    expect(Object.keys(publicFact(f)).sort()).toEqual(['at', 'id', 'kind', 'link', 'statement', 'values', ...(f.hub ? ['hub'] : [])].sort());
  });
});

describe('tone: FAA programs at United hubs', () => {
  const fx = fixture('sfo-gdp-morning');
  const withFaa = (edit) => build(fx, { faa: fx.sources.faa.map((a) => edit(a) ?? a) }).facts;
  const program = (type, extra = {}) => (a) => ({ ...a, programs: [{ type, reason: 'WX:Thunderstorms', endTime: '2026-11-11T23:59:00Z', ...extra }] });

  it('a ground delay program at one hub is a watch, as the header’s "Some Delays" chip says', () => {
    const facts = build(fx).facts;
    expect(computeTone(facts)).toBe('watch');
    expect(byId(facts)['faa.active.SFO.gdp'].toneFloor).toBe('watch');
    expect(byId(facts)['faa.active.count'].toneFloor).toBe('watch');
    expect(byId(facts)['net.status'].statement).toContain('"Some Delays"');
    expect(travelerNoteAllowed('watch', facts)).toBe(true);
  });

  it('a ground stop or closure at a hub, or delay programs at two hubs at once, is disrupted', () => {
    const gs = withFaa((a) => (a.airportCode === 'EWR' ? program('ground_stop')(a) : null));
    expect(computeTone(gs)).toBe('disrupted');
    expect(byId(gs)['faa.active.EWR.gs'].toneFloor).toBe('disrupted');
    const closure = withFaa((a) => (a.airportCode === 'EWR' ? program('closure', { reason: 'snow and ice removal' })(a) : null));
    expect(computeTone(closure)).toBe('disrupted');
    const twoGdps = withFaa((a) => (a.airportCode === 'EWR' ? program('ground_delay', { avgDelay: 41 })(a) : null));
    expect(byId(twoGdps)['faa.active.count'].toneFloor).toBe('disrupted');
    expect(computeTone(twoGdps)).toBe('disrupted');
    // A second program at the SAME hub is still one hub.
    const sameHub = withFaa((a) => (a.airportCode === 'SFO' ? { ...a, programs: [...a.programs, { type: 'ground_delay', reason: 'wind' }] } : null));
    expect(byId(sameHub)['faa.active.count'].toneFloor).toBe('watch');
  });

  it('a ground delay program away from the hubs is a watch, and allows no traveler note on its own', () => {
    const facts = withFaa((a) => (a.airportCode === 'SFO' ? { ...a, programs: [] } : null));
    expect(byId(facts)['faa.active.BOS.gdp'].toneFloor).toBe('watch');
    expect(computeTone(facts)).toBe('watch');
    expect(travelerNoteAllowed('watch', facts)).toBe(false);
  });

  it('the network status at its most severe level is disrupted', () => {
    const facts = build(fx, { irops: { ...fx.sources.irops, score: 45 } }).facts;
    expect(byId(facts)['net.status'].statement).toContain('"Disrupted"');
    expect(byId(facts)['net.status'].toneFloor).toBe('disrupted');
    expect(computeTone(facts)).toBe('disrupted');
  });
});

describe('materialKey (change detection)', () => {
  it('ignores jitter: a few flights more in the air and a point of on-time', () => {
    const fx = fixture('calm-afternoon');
    const a = build(fx).facts;
    const metrics = { ...fx.sources.irops.hubMetrics, ORD: { ...fx.sources.irops.hubMetrics.ORD, onTime: fx.sources.irops.hubMetrics.ORD.onTime + 2 } };
    const b = build(fx, { air: { airborne: 640, starlink: 284 }, irops: { ...fx.sources.irops, hubMetrics: metrics } }).facts;
    expect(materialKey(b)).toBe(materialKey(a));
  });

  it('leaves a fact with material null out entirely, id included', () => {
    const fact = (id, material) => ({ id, material });
    expect(materialKey([fact('otp.SFO', null), fact('net.status', 'status:minor')])).toBe(materialKey([fact('net.status', 'status:minor')]));
    expect(materialKey([fact('x', '')])).not.toBe(materialKey([]));
  });

  // The ten briefs of Nov 11 2026 were all rewritten for noise. Each case below is one of the
  // fact-by-fact differences that triggered a rewrite, replayed against that morning's scenario.
  const MORNING = fixture('sfo-gdp-morning');
  const NOW_S = Date.parse(MORNING.nowIso) / 1000;
  const morning = (edit = () => {}) => {
    const sources = structuredClone(MORNING.sources);
    // A median the noise below stays inside the "usual" band of (700 and 600 in the air).
    sources.airNormal = { median: 650, days: 7 };
    edit(sources);
    return materialKey(buildBriefFacts(sources, { nowMs: Date.parse(MORNING.nowIso) }).facts);
  };
  const hub = (s, code) => s.irops.hubMetrics[code];
  const sfoMetar = (s, raw) => { s.metar = s.metar.map((m) => (m.icaoId === 'KSFO' ? { ...m, rawOb: raw } : m)); };
  const NOISE = {
    'air.total 700 → 600 and air.starlink 300 → 250': [(s) => { s.air = { airborne: 700, starlink: 300 }; }, (s) => { s.air = { airborne: 600, starlink: 250 }; }],
    'net.index 4.0 → 11.0, both in the normal band': [(s) => { s.irops.score = 4; }, (s) => { s.irops.score = 11; }],
    'otp.EWR 100% → 95%': [(s) => { hub(s, 'EWR').onTime = 110; }, (s) => { hub(s, 'EWR').onTime = 104; }],
    'otp.SFO absent → 100% (and the best hub and the hub count with it)': [(s) => { delete s.irops.hubMetrics.SFO; }, () => {}],
    'otp.IAD 95% → aged out': [(s) => { hub(s, 'IAD').generatedAt = NOW_S - 3000; hub(s, 'IAD').onTime = 67; }, () => {}],
    'wx.SFO "very low clouds, very low visibility, fog" → "very low clouds"': [
      (s) => sfoMetar(s, 'METAR KSFO 111556Z 00000KT 1/4SM FG VV002 11/11 A3011 RMK AO2'),
      (s) => sfoMetar(s, 'METAR KSFO 111656Z 00000KT 2SM BR OVC003 12/11 A3012 RMK AO2'),
    ],
  };

  for (const [label, [before, after]] of Object.entries(NOISE)) {
    it(`is unchanged by ${label}`, () => {
      expect(morning(after)).toBe(morning(before));
    });
  }

  it('is unchanged by all of that morning’s noise at once', () => {
    const all = (which) => (s) => { for (const pair of Object.values(NOISE)) pair[which](s); };
    expect(morning(all(1))).toBe(morning(all(0)));
  });

  // Three more sources of rewrites, left after the first pass: possible programs away from the hubs,
  // caution-level hub weather, and the weather summary's list of hubs.
  const iahMetar = (s, raw) => { s.metar = s.metar.map((m) => (m.icaoId === 'KIAH' ? { ...m, rawOb: raw } : m)); };
  const planned = (event, airports) => ({ time: '', event, decoded: event, affectedAirports: airports, type: 'terminal' });
  const MORE_NOISE = {
    'the possible ground stop at Miami dropping off the plan': [() => {}, (s) => { s.nas.planned = s.nas.planned.filter((t) => !t.affectedAirports.includes('MIA')); }],
    'a possible program away from the hubs appearing (Las Vegas)': [() => {}, (s) => { s.nas.planned.push(planned('AFTER 2000\t-LAS GROUND STOP POSSIBLE', ['LAS'])); }],
    "Seattle's possible program moving its window": [() => {}, (s) => {
      s.nas.planned = s.nas.planned.map((t) => (t.affectedAirports.includes('SEA') ? planned('AFTER 2300\t-SEA GROUND STOP/DELAY PROGRAM POSSIBLE', ['SEA']) : t));
    }],
    'light rain coming to Houston (caution)': [() => {}, (s) => iahMetar(s, 'METAR KIAH 111653Z 16007KT 10SM -RA BKN040 23/15 A3008 RMK AO2')],
    'Houston going from light rain to light snow (both caution)': [
      (s) => iahMetar(s, 'METAR KIAH 111653Z 16007KT 10SM -RA BKN040 23/15 A3008 RMK AO2'),
      (s) => iahMetar(s, 'METAR KIAH 111653Z 16007KT 10SM -SN BKN040 01/M01 A3008 RMK AO2'),
    ],
  };
  for (const [label, [before, after]] of Object.entries(MORE_NOISE)) {
    it(`is unchanged by ${label}`, () => {
      expect(morning(after)).toBe(morning(before));
    });
  }

  it('still changes for a possible program at a hub, or hub weather at warning level', () => {
    const base = morning();
    expect(morning((s) => { s.nas.planned.push(planned('UNTIL 0200\t-EWR GROUND STOP POSSIBLE', ['EWR'])); })).not.toBe(base);
    // Thunderstorms at Houston: a warning, in both the hub's weather and the summary.
    const storms = (s) => iahMetar(s, 'METAR KIAH 111653Z 16007KT 10SM TSRA BKN040 23/15 A3008 RMK AO2');
    expect(morning(storms)).not.toBe(base);
    expect(morning(storms)).not.toBe(morning((s) => iahMetar(s, 'METAR KIAH 111653Z 16007KT 10SM -RA BKN040 23/15 A3008 RMK AO2')));
  });

  it('changes when the story does: a new ground stop, a hub under 80%, a weather level or hazard, a band', () => {
    const base = morning();
    const changes = {
      'a ground stop at Newark': (s) => {
        s.faa = s.faa.map((a) => (a.airportCode === 'EWR'
          ? { ...a, groundStop: true, programs: [{ type: 'ground_stop', reason: 'WX:Thunderstorms', endTime: '2026-11-11T19:30:00Z' }] }
          : a));
      },
      'Chicago O’Hare dropping to 75%': (s) => { hub(s, 'ORD').onTime = 120; },
      'San Francisco weather easing from severe to a warning': (s) => sfoMetar(s, 'METAR KSFO 111656Z 00000KT 3SM BR OVC008 12/11 A3012 RMK AO2'),
      'thunderstorms at San Francisco at the same level': (s) => sfoMetar(s, 'METAR KSFO 111656Z 00000KT 2SM TSRA OVC003 12/11 A3012 RMK AO2'),
      'far more flights in the air than usual': (s) => { s.air = { airborne: 760, starlink: 300 }; },
      'the disruption index entering the minor band': (s) => { s.irops.score = 24; },
    };
    for (const [label, edit] of Object.entries(changes)) expect(morning(edit), label).not.toBe(base);
  });
});

describe('live-feed and history helpers', () => {
  it('counts airborne and Starlink flights the way the Live stat bar does', () => {
    const flights = [
      { reg: 'N17421', alt: 10000, spd: 200, vr: 0, onGround: false, callsign: 'UAL1' },
      { reg: 'N37-527', alt: 9000, spd: 200, vr: 0, onGround: false, callsign: 'UAL2' },
      { reg: 'N12345', alt: 9000, spd: 200, vr: 0, onGround: false, callsign: 'SKW3' },
      { reg: 'N17421', alt: 0, spd: 0, vr: 0, onGround: true, callsign: 'UAL4' },
    ];
    expect(countAirborneAndStarlink(flights, new Set(['N17421', 'N37527']), {})).toEqual({ airborne: 3, express: 1, starlink: 2 });
    expect(countAirborneAndStarlink(flights, new Set(), {})).toEqual({ airborne: 3, express: 1, starlink: 0 });
  });

  it('takes the median of each day’s nearest sample and needs three days', () => {
    const t = (iso) => Date.parse(iso);
    const day = (target, values) => ({ targetMs: t(target), samples: values.map(([iso, airborne]) => ({ t: iso, airborne })) });
    expect(airborneNormal([
      day('2026-11-09T21:40:00Z', [['2026-11-09T21:35:00Z', 600], ['2026-11-09T21:40:00Z', 640]]),
      day('2026-11-08T21:40:00Z', [['2026-11-08T21:45:00Z', 620]]),
      day('2026-11-07T21:40:00Z', [['2026-11-07T21:40:00Z', 700]]),
    ])).toEqual({ median: 640, days: 3 });
    expect(airborneNormal([day('2026-11-09T21:40:00Z', [['2026-11-09T21:40:00Z', 600]])])).toBeNull();
  });
});

describe('every fixture', () => {
  const names = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  it('has at least the six required scenarios', () => {
    expect(names).toEqual(expect.arrayContaining(['calm-afternoon', 'planned-only-watch', 'hub-ground-stop', 'storm-day', 'overnight-low-traffic', 'unconfirmed-cancellations']));
  });
  for (const name of names) {
    it(`${name}: builds facts whose computed tone matches the fixture`, () => {
      const fx = fixture(name);
      const { facts } = build(fx);
      expect(facts.length).toBeGreaterThan(5);
      expect(computeTone(facts)).toBe(fx.expect.tone);
      expect(new Set(facts.map((f) => f.id)).size).toBe(facts.length);
    });
  }
});
