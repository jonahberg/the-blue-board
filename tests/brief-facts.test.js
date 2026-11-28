// The ops brief's fact builder (src/lib/brief-facts.js): the site's own payloads in, facts out.
// Pins the catalogue ids, the surface forms the verifier will allow, the local-clock conversion, the
// confirmed/unconfirmed cancellation split, the sample and freshness floors, and the material key
// that decides whether a run writes a new brief.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BRIEF_AIRBORNE_DISRUPTED_PCT, BRIEF_AIRBORNE_MIN_USUAL, BRIEF_AIRBORNE_NOTABLE_PCT, BRIEF_AIRBORNE_USUAL_BAND_PCT, BRIEF_AIRBORNE_WATCH_PCT, scheduleReadNeeded,
  BRIEF_HUBS, airborneNormal, airborneShortfallTone, airportDayWord, buildBriefFacts, isAirborneShortfallFact, sameClockDaysBefore, computeTone, countAirborneAndStarlink, impairedHubs,
  faaCausePhrase, formatAirportClock, isNonHubProgramFact, isWholeAirportClosure, materialKey, maxTone,
  parseIsoMs, planDateMs, publicFact, resolvePlanHhmm, resolveZuluHhmm, travelerNoteAllowed,
} from '../src/lib/brief-facts.js';
import { BRIEF_SYSTEM_PROMPT, buildBriefUserMessage } from '../src/lib/brief-prompt.js';
import { lighterSchedulePct, scheduleComparison } from '../src/lib/brief-schedule.js';
import { extractClaims } from '../src/lib/brief-claims.js';
import { THANKSGIVING_2026_ROWS, rowSources } from './fixtures/thanksgiving-2026-rows.js';
import { buildFaaIndex } from '../src/lib/faa-context.js';
import { networkStatus, withoutRoutineClosures } from '../src/lib/ops-health.js';

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
    // Every hub is healthy, so no hub's own on-time fact is sent (the summary covers them), and
    // 0 confirmed cancellations is not news (Nov 2026).
    expect(facts.map((f) => f.id).sort()).toEqual([
      'air.normal', 'air.starlink', 'air.total', 'cxl.unconfirmed', 'faa.active.count',
      'faa.planned.BOS', 'faa.planned.count', 'net.index', 'net.status', 'otp.floor', 'wx.summary',
    ]);
    expect(collection.sources).toEqual({ irops: 'ok', faa: 'ok', nas: 'ok', metar: 'ok', air: 'ok', airNormal: 'ok' });
    // The cron's evidence gate still counts every hub with a figure.
    expect(collection.hubReadings).toBe(7);
    expect(computeTone(facts)).toBe('calm');
    // Every fact has the documented shape.
    for (const f of facts) {
      expect(f).toEqual(expect.objectContaining({ id: expect.any(String), kind: expect.any(String), statement: expect.any(String), values: expect.any(Array), link: expect.objectContaining({ tab: expect.any(String) }) }));
    }
  });

  it('gives each hub its on-time figure, count and every name that may stand for it', () => {
    // Los Angeles at 75%: not every hub is healthy, so every hub's own figure is sent.
    const fx = fixture('calm-afternoon');
    const metrics = { ...fx.sources.irops.hubMetrics, LAX: { ...fx.sources.irops.hubMetrics.LAX, onTime: 59 } };
    const { facts } = build(fx, { irops: { ...fx.sources.irops, hubMetrics: metrics } });
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
    expect(calm['otp.floor'].statement).toBe('All seven United hubs reporting so far today are at 85% on time or better.');
    // The floor's values cannot vouch for naming the lowest hub; its chip still proves it there.
    expect(calm['otp.floor'].values).toEqual(['7', 'seven', '85%']);
    expect(calm['otp.floor'].link).toEqual({ tab: 'schedule', hub: 'LAX' });

    // Los Angeles at 75%: below 80, so the lowest hub is worth naming again.
    const metrics = { ...fx.sources.irops.hubMetrics, LAX: { ...fx.sources.irops.hubMetrics.LAX, onTime: 59 } };
    const low = byId(build(fx, { irops: { ...fx.sources.irops, hubMetrics: metrics } }).facts);
    expect(low['otp.min'].statement).toBe('Of the seven United hubs reporting so far today, Los Angeles (LAX) is lowest at 75% on time.');
    expect(low['otp.min'].values).toEqual(expect.arrayContaining(['75%', 'LAX', 'Los Angeles']));
    expect(low['otp.floor'].statement).toBe('All seven United hubs reporting so far today are at 75% on time or better; Los Angeles is the lowest.');
    expect(low['otp.max']).toBeUndefined();
  });

  it('converts planned FAA windows to the airport’s local clock and says they are not in effect', () => {
    const { facts } = build(fixture('planned-only-watch'));
    const ewr = byId(facts)['faa.planned.EWR'];
    expect(ewr.statement).toBe("The FAA's operations plan says a ground stop or ground delay program is possible for flights into Newark (EWR) until 9:00 PM ET. It is not in effect.");
    expect(ewr.values).toContain('9:00 PM ET');
    expect(byId(facts)['faa.planned.SFO'].values).toContain('4:00 PM PT');
    // Nov 22 2026: a possible program is not in effect, so it never sets the tone.
    expect(ewr.toneFloor).toBe('calm');
    // The en-route CDRS/SWAP line names no airport and is not a stop or delay program.
    expect(facts.some((f) => /FLORIDA/i.test(f.statement))).toBe(false);
    expect(computeTone(facts)).toBe('calm');
  });

  it('ranks possible programs at airports that are not hubs last, below every other fact', () => {
    const { facts } = build(fixture('calm-afternoon'));
    expect(facts.slice(-2).map((f) => f.id)).toEqual(['faa.planned.BOS', 'faa.planned.count']);
    expect(facts.slice(-2).every((f) => f.severity === 0)).toBe(true);
    expect(facts.slice(0, -2).every((f) => f.severity > 0)).toBe(true);
    // A possible program at a hub later today still ranks above the background, and so does the
    // count beside it (it no longer sets the tone, Nov 22 2026).
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
    expect(confirmed.statement).toBe('6 United departures from its hubs are confirmed canceled today.');
    expect(unconfirmed.statement).toBe('162 departures from United\'s hubs are marked "likely canceled" by a flight-data provider but not confirmed. That label is often wrong: 131 flights marked that way today were seen flying.');
    expect(unconfirmed.values).not.toContain('6');
    expect(confirmed.values).not.toContain('162');
    expect(unconfirmed.severity).toBeLessThan(5);
    // The index is in its minor band, which alone is calm since Nov 22 2026 (an ordinary evening).
    expect(computeTone(facts)).toBe('calm');
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

  // Nov 2026: boards are judged by their coverage gap, not their age (src/lib/hub-health.js).
  describe('board coverage gates', () => {
    const withHub = (fx, hub, patch) => ({
      irops: { ...fx.sources.irops, hubMetrics: { ...fx.sources.irops.hubMetrics, [hub]: { ...fx.sources.irops.hubMetrics[hub], ...patch } } },
    });
    const centralMidnight = Date.UTC(2026, 10, 11, 6, 0) / 1000; // 00:00 CST Nov 11

    it('keeps a final yesterday board however old it is (built after local midnight)', () => {
      const fx = fixture('overnight-low-traffic'); // 09:30Z = 03:30 CST, ORD still on yesterday
      const old = withHub(fx, 'ORD', { generatedAt: centralMidnight + 600 }); // 3 h 20 min old
      // Without its day end the payload is judged by age, exactly as before.
      expect(build(fx, old).collection.skipped).toContain('otp.ORD: board 200 min old');
      const final = withHub(fx, 'ORD', { generatedAt: centralMidnight + 600, boardDayOffset: -1, boardDayEndSec: centralMidnight });
      const { facts, collection } = build(fx, final);
      // Every hub is healthy, so ORD's figure is kept for the summary, not sent on its own.
      expect(collection.skipped.filter((r) => r.startsWith('otp.ORD'))).toEqual(['otp.ORD: 88% and every hub is healthy (the on-time summary covers it)']);
      expect(collection.hubReadings).toBe(7);
      expect(byId(facts)['otp.floor'].statement).toBe('All seven United hubs reporting yesterday were at 84% on time or better.');
    });

    it('still drops a yesterday board that missed more than 3 h of its day, and says which part', () => {
      const fx = fixture('overnight-low-traffic');
      const tail = withHub(fx, 'ORD', { generatedAt: centralMidnight - 4 * 3600, boardDayOffset: -1, boardDayEndSec: centralMidnight });
      const { facts, collection } = build(fx, tail);
      expect(byId(facts)['otp.ORD']).toBeUndefined();
      expect(collection.skipped).toContain('otp.ORD: board missing the last 240 min of yesterday');
    });

    it('drops a hub cancellation fact from a board more than 3 h behind', () => {
      const fx = fixture('storm-day');
      expect(byId(build(fx).facts)['cxl.ORD']).toBeDefined();
      const nowSec = Date.parse(fx.nowIso) / 1000;
      const { facts, collection } = build(fx, withHub(fx, 'ORD', { generatedAt: nowSec - 4 * 3600 }));
      expect(byId(facts)['cxl.ORD']).toBeUndefined();
      expect(collection.skipped).toContain('cxl.ORD: board 240 min old');
      expect(byId(facts)['cxl.EWR']).toBeDefined();
    });

    it('drops the index fact when boards more than 3 h behind hold over a quarter of its departures', () => {
      const fx = fixture('storm-day');
      const nowSec = Date.parse(fx.nowIso) / 1000;
      // NRT and GUM (22 of 2,609 departures) never silence it.
      const pacific = { ...withHub(fx, 'NRT', { generatedAt: nowSec - 8 * 3600 }).irops };
      pacific.hubMetrics = { ...pacific.hubMetrics, GUM: { ...pacific.hubMetrics.GUM, generatedAt: nowSec - 8 * 3600 } };
      expect(byId(build(fx, { irops: pacific }).facts)['net.index']).toBeDefined();
      // ORD alone is 24.9%: kept. ORD + EWR is 39.9%: dropped, and the reason names them.
      expect(byId(build(fx, withHub(fx, 'ORD', { generatedAt: nowSec - 4 * 3600 })).facts)['net.index']).toBeDefined();
      const two = withHub(fx, 'ORD', { generatedAt: nowSec - 4 * 3600 });
      two.irops.hubMetrics = { ...two.irops.hubMetrics, EWR: { ...two.irops.hubMetrics.EWR, generatedAt: nowSec - 4 * 3600 } };
      const { facts, collection } = build(fx, two);
      expect(byId(facts)['net.index']).toBeUndefined();
      expect(collection.skipped).toContain('net.index: boards more than 3 h behind hold 40% of its departures (ORD, EWR)');
      // The tone rules did not move: net.status still reads the index.
      expect(byId(facts)['net.status']).toBeDefined();
    });
  });

  it('says "yesterday" for a hub whose board has not rolled over yet, in plain words', () => {
    const fx = fixture('overnight-low-traffic');
    const metrics = { ...fx.sources.irops.hubMetrics, EWR: { ...fx.sources.irops.hubMetrics.EWR, onTime: 270 } };
    const facts = byId(build(fx, { irops: { ...fx.sources.irops, hubMetrics: metrics } }).facts);
    expect(facts['otp.EWR'].statement).toBe("Newark (EWR): 75% of departures yesterday left within 30 minutes of schedule (360 departed); today's figures are not in yet.");
    expect(facts['otp.min'].statement).toBe('Of the seven United hubs reporting yesterday, Newark (EWR) was lowest at 75% on time.');
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

  it('a ground delay program at one hub is calm and impairs that hub, as the header reads "Smooth Ops" (Nov 22 2026)', () => {
    // Until Nov 22 2026 one hub's delay program was a watch ("Some Delays"); it is now named, not a tone.
    const facts = build(fx).facts;
    expect(computeTone(facts)).toBe('calm');
    expect(byId(facts)['faa.active.SFO.gdp']).toMatchObject({ toneFloor: 'calm', impairs: 'SFO' });
    expect(byId(facts)['faa.active.count'].toneFloor).toBe('calm');
    expect(byId(facts)['net.status'].statement).toContain('"Smooth Ops"');
    // Travelers bound there are still held: the note is allowed at any tone.
    expect(travelerNoteAllowed('calm', facts)).toBe(true);
  });

  it('a ground stop or closure at a hub is disrupted; delay programs at two or more hubs are a watch', () => {
    const gs = withFaa((a) => (a.airportCode === 'EWR' ? program('ground_stop')(a) : null));
    expect(computeTone(gs)).toBe('disrupted');
    expect(byId(gs)['faa.active.EWR.gs'].toneFloor).toBe('disrupted');
    const closure = withFaa((a) => (a.airportCode === 'EWR' ? program('closure', { reason: 'snow and ice removal' })(a) : null));
    expect(computeTone(closure)).toBe('disrupted');
    // Two hubs' delay programs read "Some Delays" in the header, and "watch" here.
    const twoGdps = withFaa((a) => (a.airportCode === 'EWR' ? program('ground_delay', { avgDelay: 41 })(a) : null));
    expect(byId(twoGdps)['faa.active.count'].toneFloor).toBe('watch');
    expect(byId(twoGdps)['net.status'].statement).toContain('"Some Delays"');
    expect(computeTone(twoGdps)).toBe('watch');
    // A second program at the SAME hub is still one hub: calm (Nov 22 2026).
    const sameHub = withFaa((a) => (a.airportCode === 'SFO' ? { ...a, programs: [...a.programs, { type: 'ground_delay', reason: 'wind' }] } : null));
    expect(byId(sameHub)['faa.active.count'].toneFloor).toBe('calm');
    expect(computeTone(sameHub)).toBe('calm');
  });

  it('a ground delay program away from the hubs never sets the tone, and allows a traveler note (Nov 2026)', () => {
    // The calm afternoon, plus the morning's Boston delay program and then a ground stop there.
    const calm = fixture('calm-afternoon');
    const bos = (type) => [...calm.sources.faa, { airportCode: 'BOS', programs: [{ type, reason: 'runway construction', avgDelay: 20, maxDelay: 64, endTime: '2026-11-11T03:59:00Z' }], delays: [] }];
    const facts = build(calm, { faa: bos('ground_delay') }).facts;
    expect(byId(facts)['faa.active.BOS.gdp'].toneFloor).toBe('calm');
    expect(computeTone(facts)).toBe('calm');
    expect(byId(facts)['net.status'].statement).toContain('"Smooth Ops"');
    expect(travelerNoteAllowed('calm', facts)).toBe(true);
    const gs = build(calm, { faa: bos('ground_stop') }).facts;
    expect(byId(gs)['faa.active.BOS.gs'].toneFloor).toBe('calm');
    expect(computeTone(gs)).toBe('calm');
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

// Nov 11 2026, 5:00 PM PT: a Seattle delay program set a "Watch" brief beside a "Smooth Ops" header,
// "One departure on United's current hub boards is confirmed canceled.", and "All 7 hubs with an
// on-time reading are at 84% or better, and Newark is at 96%." The rules below are the fix.
describe('Nov 12 2026 rules: programs away from the hubs, plain words, healthy days', () => {
  const names = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  const HEADER_TONE = { normal: 'calm', minor: 'watch', significant: 'disrupted' };
  /** The header's FAA column alone: networkStatus over the same /api/faa input, no on-time, no index. */
  const headerFaaTone = (faa) => HEADER_TONE[networkStatus({ hubOtps: {}, iropsScore: null, faaIndex: buildFaaIndex(faa.map(withoutRoutineClosures)), hubCodes: BRIEF_HUBS }).level];
  // The brief's FAA facts as the header weighs them (Nov 22 2026): their own floors, and two or more
  // hubs they mark impaired make a watch (with no on-time and no index, nothing else counts).
  const briefFaaTone = (facts) => {
    const faa = facts.filter((f) => f.kind === 'faa');
    return maxTone(...faa.map((f) => f.toneFloor), new Set(faa.map((f) => f.impairs).filter(Boolean)).size >= 2 ? 'watch' : 'calm');
  };

  for (const name of names) {
    it(`${name}: the tone floor from FAA programs equals the header's FAA level from the same input`, () => {
      const fx = fixture(name);
      expect(briefFaaTone(build(fx).facts)).toBe(headerFaaTone(fx.sources.faa));
    });
  }

  it('the parity holds for a stop, a delay program and a closure away from the hubs, and at a hub', () => {
    const fx = fixture('calm-afternoon');
    const at = (code, type, extra = {}) => [{ airportCode: code, programs: [{ type, reason: 'WX:Thunderstorms', endTime: '2026-11-11T03:00:00Z', ...extra }], groundStop: type === 'ground_stop', groundDelay: type === 'ground_delay', closure: type === 'closure', delays: [] }];
    const long = { minDelay: 46, maxDelay: 60 };
    for (const faa of [at('SEA', 'ground_stop'), at('SEA', 'ground_delay', { avgDelay: 40 }), at('BOS', 'closure', { reason: 'snow removal' }), at('EWR', 'ground_delay'), at('EWR', 'ground_stop'), at('ORD', 'departure_delay'),
      [...at('EWR', 'ground_delay'), ...at('SFO', 'ground_delay')], [...at('EWR', 'departure_delay', long), ...at('ORD', 'arrival_delay', long)], [...at('EWR', 'arrival_delay'), ...at('ORD', 'arrival_delay')]]) {
      const facts = build(fx, { faa }).facts;
      expect(briefFaaTone(facts), JSON.stringify(faa)).toBe(headerFaaTone(faa));
    }
    // The divergence reported on Nov 12 (the header had no arrival-delay branch) is gone: both read
    // a hub's arrival delays through faaItemImpairsHub (Nov 22 2026).
    expect(headerFaaTone([...at('EWR', 'arrival_delay', long), ...at('ORD', 'arrival_delay', long)])).toBe('watch');
  });

  it('the specimen: Seattle stays a fact, calm, after every fact about the hubs; tomorrow\'s possible hub programs are calm and last', () => {
    const { facts } = build(fixture('nonhub-gdp-specimen'));
    const sea = byId(facts)['faa.active.SEA.gdp'];
    expect(sea).toEqual(expect.objectContaining({ toneFloor: 'calm', hub: undefined }));
    expect(sea.statement).toBe('The FAA has a ground delay program in effect for flights heading to Seattle (SEA) until 9:59 PM PT. Those flights are held at their departure airport; delays average 32 minutes, up to 82 minutes.');
    expect(computeTone(facts)).toBe('calm');
    expect(facts.filter((f) => f.toneFloor !== 'calm')).toEqual([]);
    for (const id of ['faa.planned.EWR', 'faa.planned.SFO']) expect(byId(facts)[id]).toEqual(expect.objectContaining({ toneFloor: 'calm', later: true, material: null, severity: 0.5 }));
    // Every fact about now comes before them.
    const order = facts.map((f) => f.id);
    for (const f of facts.filter((x) => x.kind !== 'faa_planned')) expect(order.indexOf(f.id), f.id).toBeLessThan(order.indexOf('faa.planned.EWR'));
    // Without the plan's hub lines the same evening is calm, and the summary leads the list.
    const calm = build(fixture('nonhub-gdp-calm')).facts;
    expect(computeTone(calm)).toBe('calm');
    expect(calm.slice(0, 2).map((f) => f.id)).toEqual(['otp.floor', 'faa.active.SEA.gdp']);
  });

  it('sends the three most severe programs away from the hubs one by one and folds the rest into one count', () => {
    const { facts, collection } = build(fixture('five-nonhub-storm'));
    expect(facts.filter(isNonHubProgramFact).map((f) => f.id)).toEqual(['faa.active.BOS.gs', 'faa.active.JFK.gdp', 'faa.active.LGA.gdp']);
    const other = byId(facts)['faa.active.other'];
    expect(other.statement).toBe('The FAA also has 2 more programs in effect at other airports: a ground delay program for flights into Philadelphia and a ground delay program for flights into Washington Reagan.');
    expect(other.toneFloor).toBe('calm');
    expect(collection.skipped).toEqual(expect.arrayContaining([
      'faa.active.PHL.gdp: folded into faa.active.other (only the 3 most severe programs away from the hubs are sent one by one)',
      'faa.active.DCA.gdp: folded into faa.active.other (only the 3 most severe programs away from the hubs are sent one by one)',
    ]));
    // Three or fewer: no count fact beside them (it said the same thing twice).
    expect(byId(build(fixture('nonhub-gdp-specimen')).facts)['faa.active.other']).toBeUndefined();
  });

  for (const name of names) {
    it(`${name}: the model reads every fact about the hubs before a program away from them, and calm filler after`, () => {
      const fx = fixture(name);
      const nowMs = Date.parse(fx.nowIso);
      const { facts } = build(fx);
      const order = JSON.parse(buildBriefUserMessage(facts, nowMs).split('FACTS:\n')[1]).map((f) => f.id);
      const firstAway = order.findIndex((id) => isNonHubProgramFact(byId(facts)[id]));
      // A calm day with nothing wrong at a hub opens with the on-time story (the trailing hub, then
      // the others); with one hub impaired (Nov 22 2026) that hub's most severe fact opens it.
      const story = facts.find((f) => f.outlier === true)?.id ?? 'otp.floor';
      const impaired = impairedHubs(facts);
      if (computeTone(facts) === 'calm' && impaired.length === 0 && order.includes('otp.floor')) expect(order[0]).toBe(story);
      if (computeTone(facts) === 'calm' && impaired.length === 1) expect(byId(facts)[order[0]].impairs).toBe(impaired[0]);
      if (firstAway < 0) return;
      for (const f of facts) {
        const i = order.indexOf(f.id);
        // Hub problems (anything at severity 10 or more) come first; calm filler after.
        if (f.severity >= 10) expect(i, f.id).toBeLessThan(firstAway);
        if (f.severity <= 5) expect(i, f.id).toBeGreaterThan(firstAway);
      }
    });
  }

  it('hubs with an FAA program keep their own on-time fact on a healthy day; the others do not', () => {
    const { facts, collection } = build(fixture('hub-and-nonhub-gdp'));
    expect(facts.filter((f) => /^otp\.[A-Z]{3}$/.test(f.id)).map((f) => f.id)).toEqual(['otp.SFO']);
    expect(collection.skipped).toContain('otp.EWR: 96% and every hub is healthy (the on-time summary covers it)');
    expect(collection.hubReadings).toBe(7);
    // A hub under 80% brings every hub's own figure back, as before.
    const soft = build(fixture('ord-79-variant')).facts;
    expect(soft.filter((f) => /^otp\.[A-Z]{3}$/.test(f.id))).toHaveLength(7);
    expect(byId(soft)['otp.min'].statement).toBe("Of the seven United hubs reporting so far today, Chicago O'Hare (ORD) is lowest at 79% on time.");
    // At 80% (healthy) Chicago O'Hare is still named: 9 points behind the next hub and under 85%.
    const eighty = build(fixture('ord-80-specimen'));
    expect(byId(eighty.facts)['otp.ORD']).toEqual(expect.objectContaining({
      statement: "Chicago O'Hare (ORD) is at 80% on time so far today (460 departed), behind the other hubs, which are at 89% or better.",
      toneFloor: 'calm', material: null, outlier: true,
    }));
    expect(byId(eighty.facts)['otp.floor'].statement).toBe('The other six United hubs reporting so far today are at 89% on time or better.');
  });

  it('no statement uses the site’s own vocabulary: boards, readings, feeds, The Blue Board', () => {
    for (const name of names) {
      for (const f of build(fixture(name)).facts) {
        if (f.kind === 'radio' || f.kind === 'flow') continue;
        expect(f.statement, `${name} ${f.id}`).not.toMatch(/\bboards?\b|\breadings?\b|\bfeeds?\b|The Blue Board|schedule provider/i);
      }
    }
  });

  describe('confirmed cancellations', () => {
    const fx = fixture('unconfirmed-cancellations');
    const withConfirmed = (n) => {
      const irops = structuredClone(fx.sources.irops);
      irops.cancellations = irops.cancellationsLikely + n;
      return buildBriefFacts({ ...fx.sources, irops }, { nowMs: Date.parse(fx.nowIso) });
    };
    it('under 5 the fact is not sent, and the report still says so', () => {
      const one = withConfirmed(1);
      expect(byId(one.facts)['cxl.confirmed']).toBeUndefined();
      expect(one.collection.skipped).toContain('cxl.confirmed: 1 confirmed (under 5), not news');
      expect(byId(withConfirmed(5).facts)['cxl.confirmed'].statement).toBe('5 United departures from its hubs are confirmed canceled today.');
      expect(byId(withConfirmed(12).facts)['cxl.confirmed'].statement).toBe('12 United departures from its hubs are confirmed canceled today.');
    });
    it('never moves the change key under 10, sent or not, so the send threshold cannot rewrite the brief', () => {
      const key = (n) => materialKey(withConfirmed(n).facts);
      for (const n of [1, 4, 5, 6, 9]) expect(key(n), String(n)).toBe(key(0));
      expect(key(10)).not.toBe(key(9));
      // From 10 the existing steps: 10 and 12 share a step, 13 does not.
      expect(key(12)).toBe(key(10));
      expect(key(13)).not.toBe(key(12));
    });
  });

  it('a healthy hub’s figure leaving the list is not a change (its material was already null)', () => {
    const fx = fixture('nonhub-gdp-specimen');
    const a = materialKey(build(fx).facts);
    const metrics = { ...fx.sources.irops.hubMetrics, EWR: { ...fx.sources.irops.hubMetrics.EWR, onTime: 260 } };
    expect(materialKey(build(fx, { irops: { ...fx.sources.irops, hubMetrics: metrics } }).facts)).toBe(a);
  });

  describe('plan and program times carry their day (Nov 12 2026: "after 10:00 AM ET" said at 8:20 PM ET)', () => {
    const now = Date.parse('2026-11-12T01:20:00Z'); // 8:20 PM ET Nov 11
    const plan = planDateMs('https://www.fly.faa.gov/adv/adv_otherdis.jsp?advn=3&adv_date=11122026&facId=ATCSCC', now);

    it('reads Zulu plan times forward from the plan’s own date', () => {
      expect(new Date(resolvePlanHhmm('1500', now, plan)).toISOString()).toBe('2026-11-12T15:00:00.000Z');
      expect(new Date(resolvePlanHhmm('0500', now, plan)).toISOString()).toBe('2026-11-12T05:00:00.000Z');
      // The Nov 10 evening plan, read at 23:10Z: "UNTIL 0030" is 00:30Z the next day.
      const nov10 = Date.parse('2026-11-10T23:10:00Z');
      const p10 = planDateMs('https://x/?advn=57&adv_date=11102026&facId=ATCSCC', nov10);
      expect(new Date(resolvePlanHhmm('0030', nov10, p10)).toISOString()).toBe('2026-11-11T00:30:00.000Z');
      expect(new Date(resolvePlanHhmm('1800', nov10, p10)).toISOString()).toBe('2026-11-10T18:00:00.000Z');
      // No date (or one more than a day off): the first occurrence no more than 6 h ago.
      expect(planDateMs('https://x/?adv_date=07012026', now)).toBeNull();
      expect(new Date(resolvePlanHhmm('1500', now, null)).toISOString()).toBe('2026-11-12T15:00:00.000Z');
      expect(new Date(resolveZuluHhmm('1500', now)).toISOString()).toBe('2026-11-11T15:00:00.000Z'); // the old, nearest rule
    });

    it('names the day whenever a time is not later today or tonight on the airport’s clock', () => {
      expect(airportDayWord(Date.parse('2026-11-12T15:00:00Z'), 'EWR', now)).toBe('tomorrow');
      expect(airportDayWord(Date.parse('2026-11-12T05:00:00Z'), 'SFO', now)).toBe(''); // 9:00 PM PT tonight
      expect(airportDayWord(Date.parse('2026-11-12T05:30:00Z'), 'BOS', now)).toBe(''); // 12:30 AM ET, past midnight
      expect(airportDayWord(Date.parse('2026-11-12T19:00:00Z'), 'EWR', now)).toBe('tomorrow'); // 2:00 PM ET
      expect(airportDayWord(Date.parse('2026-11-14T15:00:00Z'), 'EWR', now)).toBe('on Saturday');
    });

    it('plan-times-evening: later today, tomorrow, ended; a program past midnight, and one past its end', () => {
      const { facts, collection } = build(fixture('plan-times-evening'));
      const f = byId(facts);
      expect(f['faa.planned.SFO'].statement).toBe("The FAA's operations plan says a ground delay program is possible for flights into San Francisco (SFO) until 9:00 PM PT. It is not in effect.");
      expect(f['faa.planned.EWR'].statement).toBe("The FAA's operations plan says a ground stop or ground delay program is possible for flights into Newark (EWR) tomorrow after 10:00 AM ET. It is not in effect.");
      expect(f['faa.planned.EWR'].values).toContain('tomorrow 10:00 AM ET');
      expect(f['faa.planned.EWR'].values).not.toContain('10:00 AM ET');
      expect(f['faa.planned.DEN']).toBeUndefined();
      expect(collection.skipped).toContain('faa.planned.DEN: its window ended at 5:30 PM MT');
      expect(f['faa.active.BOS.gdp'].statement).toContain('until 12:30 AM ET, because of heavy traffic');
      expect(f['faa.active.LGA.gdp']).toBeUndefined();
      expect(collection.skipped).toContain('faa.active.LGA.gdp: its listed end, 7:59 PM ET, has passed');
    });

    it('a program at a hub past its listed end stays (the header still counts it) but never prints the time', () => {
      const fx = fixture('plan-times-evening');
      const faa = fx.sources.faa.map((a) => (a.airportCode === 'EWR'
        ? { ...a, groundDelay: true, programs: [{ type: 'ground_delay', reason: 'VOL:Volume', avgDelay: 30, endTime: '2026-11-12T00:59:00Z' }] }
        : a));
      const gdp = byId(build(fx, { faa }).facts)['faa.active.EWR.gdp'];
      expect(gdp.statement).toBe('The FAA has a ground delay program in effect for flights heading to Newark (EWR), because of heavy traffic. Those flights are held at their departure airport; delays average 30 minutes.');
      // The header still counts it, so it still impairs Newark (calm on its own since Nov 22 2026).
      expect(gdp).toMatchObject({ toneFloor: 'calm', impairs: 'EWR' });
    });
  });
});

describe('Nov 12 2026, round 2: tomorrow is not tonight; the lowest hub only when it is an outlier', () => {
  const at = (iso) => Date.parse(iso);

  describe('rule 1: a possible hub program is news only when its window opens today (and never a tone, Nov 22 2026)', () => {
    // 8:20 PM ET Nov 11 (01:20Z Nov 12), the Nov 12 plan.
    const fx = fixture('plan-times-evening');
    const withPlan = (event, airports, url = fx.sources.nas.advisoryUrl) => build(fx, {
      faa: fx.sources.faa.filter((a) => a.airportCode !== 'BOS'),
      nas: { ...fx.sources.nas, advisoryUrl: url, planned: [{ time: '', event, decoded: event, affectedAirports: airports, type: 'terminal' }] },
    }).facts;
    const planned = (facts) => facts.find((f) => f.id === 'faa.planned.EWR');
    it('later today and tonight after midnight: a line and a rewrite; from 6 AM tomorrow: last, and no change', () => {
      // 11:00 PM ET tonight. A possible program never sets the tone (Nov 22 2026); it keeps its
      // severity and its place in the change key.
      expect(planned(withPlan('AFTER 0400\t-EWR GROUND STOP POSSIBLE', ['EWR']))).toEqual(expect.objectContaining({ toneFloor: 'calm', severity: 22 }));
      // 5:59 AM ET tomorrow: the coming night, no day word, still news tonight
      const night = planned(withPlan('AFTER 1059\t-EWR GROUND STOP POSSIBLE', ['EWR']));
      expect(night.statement).toContain('after 5:59 AM ET.');
      expect(night).toEqual(expect.objectContaining({ toneFloor: 'calm', severity: 22 }));
      expect(night.material).toMatch(/^planned:/);
      // 6:00 AM ET tomorrow: "tomorrow", calm, last
      const morning = planned(withPlan('AFTER 1100\t-EWR GROUND STOP POSSIBLE', ['EWR']));
      expect(morning.statement).toContain('tomorrow after 6:00 AM ET.');
      expect(morning).toEqual(expect.objectContaining({ toneFloor: 'calm', later: true, severity: 0.5, material: null }));
      // A window open now that runs into tomorrow is not "later": it is possible now.
      const open = planned(withPlan('UNTIL 1500\t-EWR GROUND STOP POSSIBLE', ['EWR']));
      expect(open.statement).toContain('until 10:00 AM ET tomorrow');
      expect(open).toEqual(expect.objectContaining({ toneFloor: 'calm', severity: 22 }));
    });
    it('planned-only-watch is calm since Nov 22 2026 (it was a watch); its tomorrow twin is calm too, and last', () => {
      const tonight = build(fixture('planned-only-watch')).facts;
      expect(computeTone(tonight)).toBe('calm');
      expect(byId(tonight)['faa.planned.EWR'].material).toMatch(/^planned:/);
      const twin = build(fixture('planned-only-tomorrow')).facts;
      expect(computeTone(twin)).toBe('calm');
      expect(byId(twin)['faa.planned.EWR'].statement).toBe("The FAA's operations plan says a ground stop or ground delay program is possible for flights into Newark (EWR) tomorrow after 10:00 AM ET. It is not in effect.");
      expect(byId(twin)['faa.planned.count'].severity).toBe(0);
    });
  });

  describe('rule 2: on a healthy day the lowest hub is named only when it is an outlier', () => {
    const fx = fixture('calm-afternoon');
    /** ORD at `low`, every other hub at `next` or more. */
    const withOtp = (low, next) => {
      const hubMetrics = Object.fromEntries(Object.entries(fx.sources.irops.hubMetrics).map(([h, m]) => {
        const pct = h === 'ORD' ? low : h === 'DEN' ? next : next + 3;
        return [h, Number(m.operated) >= 25 ? { ...m, onTime: Math.round((pct / 100) * m.operated) } : m];
      }));
      return byId(build(fx, { irops: { ...fx.sources.irops, hubMetrics } }).facts);
    };
    for (const [low, next, sent] of [[80, 89, true], [84, 90, false], [80, 87, false], [86, 95, false], [84, 92, true], [85, 95, false]]) {
      it(`${low}% beside ${next}%: ${sent ? 'sent' : 'not sent'}`, () => {
        const f = withOtp(low, next);
        expect(f['otp.ORD']?.statement ?? null, `${low} vs ${next}`).toBe(sent ? `Chicago O'Hare (ORD) is at ${low}% on time so far today (${f['otp.ORD']?.values[1]} departed), behind the other hubs, which are at ${next}% or better.` : null);
        expect(f['otp.floor'].statement).toBe(sent ? `The other six United hubs reporting so far today are at ${next}% on time or better.` : `All seven United hubs reporting so far today are at ${low}% on time or better.`);
        expect(computeTone(Object.values(f))).toBe('calm');
      });
    }
    it('the outlier never moves the change key, appearing or not', () => {
      const key = (low, next) => materialKey(Object.values(withOtp(low, next)));
      expect(key(80, 89)).toBe(key(84, 90));
    });
  });
});

// Nov 13 2026: the FAA ordered a nationwide ground stop at about 12:54 PM PT. No FAA feed the brief
// reads listed it, so for 90 minutes the brief led with a San Francisco delay program at "watch"
// while its own in-the-air comparison fell from 16% fewer than usual to 72% fewer, with a calm floor.
describe('Nov 13 2026: far fewer flights in the air than usual sets the tone', () => {
  const fx = fixture('nationwide-stop-2026-11-13');
  const air = (airborne, median = 651) => byId(build(fx, { air: { airborne, starlink: null }, airNormal: { median, days: 7 } }).facts)['air.normal'];

  it('the thresholds: watch at 35% fewer, disrupted at 45% fewer, never for more than usual', () => {
    expect([BRIEF_AIRBORNE_WATCH_PCT, BRIEF_AIRBORNE_DISRUPTED_PCT, BRIEF_AIRBORNE_MIN_USUAL]).toEqual([35, 45, 100]);
    expect(airborneShortfallTone(651, 651)).toBe('calm');
    // The largest ordinary shortfall in 40 days of samples was 30% (Tue Oct 20 2026, 10:25 PM PT).
    expect(airborneShortfallTone(456, 651)).toBe('calm'); // 30% fewer
    expect(airborneShortfallTone(430, 651)).toBe('calm'); // 34% fewer
    expect(airborneShortfallTone(423, 651)).toBe('watch'); // 35% fewer
    expect(airborneShortfallTone(365, 651)).toBe('watch'); // 44% fewer
    expect(airborneShortfallTone(358, 651)).toBe('disrupted'); // 45% fewer
    expect(airborneShortfallTone(1200, 651)).toBe('calm');
    expect(airborneShortfallTone(Number.NaN, 651)).toBe('calm');
  });

  it('sets no tone when the usual count is small (overnight)', () => {
    expect(airborneShortfallTone(40, 99)).toBe('calm');
    expect(airborneShortfallTone(40, 100)).toBe('disrupted');
    expect(air(40, 99)).toMatchObject({ toneFloor: 'calm', material: 'airnorm:below' });
  });

  it('the afternoon as stored: 16%, 23% and 31% fewer stay calm, 42% is a watch, 47% and 72% are disrupted', () => {
    // [airborne, 7-day median] from ops_briefs rows 156 to 160 and 164 (12:50 to 2:20 PM PT).
    expect(air(518, 620).toneFloor).toBe('calm');
    expect(air(481, 622).toneFloor).toBe('calm');
    expect(air(432, 630).toneFloor).toBe('calm');
    expect(air(368, 639).toneFloor).toBe('watch');
    expect(air(333, 632).toneFloor).toBe('disrupted');
    expect(air(183, 651).toneFloor).toBe('disrupted');
  });

  it('the captured payloads: the shortfall is the first fact, above the San Francisco delay program', () => {
    const { facts } = build(fx);
    expect(computeTone(facts)).toBe('disrupted');
    expect(facts[0]).toMatchObject({
      id: 'air.normal',
      statement: 'The 174 United flights in the air are 73% fewer than usual for this time of day: over the past 7 days, the median at this hour was 651.',
      severity: 110,
      toneFloor: 'disrupted',
      material: 'airnorm:below:disrupted:70',
    });
    expect(isAirborneShortfallFact(facts[0])).toBe(true);
    // Nothing else in these payloads reaches "disrupted": without the shortfall the tone would be
    // "calm" since Nov 22 2026 (one hub's delay program, San Francisco, is named, not a tone).
    expect(computeTone(facts.filter((f) => f.id !== 'air.normal'))).toBe('calm');
    // No FAA feed carried the nationwide stop, and no fact invents it.
    expect(facts.map((f) => f.statement).join(' ')).not.toMatch(/nationwide|all airports/i);
  });

  it('a watch-level shortfall ranks below a hub delay program, and the change key moves with the band', () => {
    const watch = air(420); // 35% fewer
    expect(watch).toMatchObject({ severity: 50, toneFloor: 'watch', material: 'airnorm:below:watch:30' });
    // The brief quotes the figure, so the key moves every ten points while the shortfall sets the tone.
    expect(air(183).material).toBe('airnorm:below:disrupted:70');
    expect(air(174).material).toBe('airnorm:below:disrupted:70');
    expect(air(250).material).toBe('airnorm:below:disrupted:60');
    expect(isAirborneShortfallFact(watch)).toBe(true);
    const mild = air(521); // 20% fewer
    expect(mild).toMatchObject({ severity: 2, toneFloor: 'calm', material: 'airnorm:below' });
    expect(isAirborneShortfallFact(mild)).toBe(false);
    expect(air(651)).toMatchObject({ toneFloor: 'calm', material: 'airnorm:usual' });
  });

  it('"this time of day" is the US wall clock, so a clock change does not shift the comparison', () => {
    const t = (iso) => Date.parse(iso);
    // An ordinary week: exactly 24 hours a day.
    expect(sameClockDaysBefore(t('2026-11-13T22:20:00Z'), 1)).toBe(t('2026-11-12T22:20:00Z'));
    expect(sameClockDaysBefore(t('2026-11-13T22:20:00Z'), 7)).toBe(t('2026-11-06T22:20:00Z'));
    // Wed Nov 4 2026, 2:40 AM PT (standard time). Three days back is still standard time; four days
    // back is Sat Oct 31, on daylight time, when 2:40 AM PT was 09:40Z, not 10:40Z. Comparing with
    // 10:40Z put the morning ramp-up an hour ahead and read 39% fewer than usual.
    expect(sameClockDaysBefore(t('2026-11-04T10:40:00Z'), 3)).toBe(t('2026-11-01T10:40:00Z'));
    expect(sameClockDaysBefore(t('2026-11-04T10:40:00Z'), 4)).toBe(t('2026-10-31T09:40:00Z'));
    // Spring forward (Mar 14 2027): the day before was on standard time, an hour later against UTC.
    expect(sameClockDaysBefore(t('2027-03-15T15:00:00Z'), 2)).toBe(t('2027-03-13T16:00:00Z'));
  });

  it('the model is told the shortfall leads, and never to explain it beyond the schedule the fact states', () => {
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/far fewer United flights are in the air than usual \(id "air\.normal", 35% or more fewer\), that is the lead/);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/give no reason for the shortfall other than a lighter schedule the fact itself states/);
    expect(BRIEF_SYSTEM_PROMPT).toMatch(/in line with a lighter schedule today, it is not a problem and never the lead or the headline/);
    // Nov 26 2026: on Thanksgiving the model wrote "Far fewer…" on a count the holiday explained.
    expect(BRIEF_SYSTEM_PROMPT).toContain('Write "Far fewer" only when that count is itself the day\'s alarm; a count the fact explains by a lighter schedule or a holiday is not the headline.');
  });
});

// Nov 18 2026: Thanksgiving Day, Christmas and New Year's are scheduled light, so "far fewer flights
// in the air than usual" could read "Disrupted" on a day United simply planned fewer. The usual is
// now scaled by the day's schedule (src/lib/brief-schedule.js), read only when it can matter.
describe('Nov 18 2026: a lighter schedule is not a shortfall', () => {
  const stop = fixture('nationwide-stop-2026-11-13');
  const week = (n) => Array.from({ length: 7 }, () => n);
  const at = (patch, nowIso = stop.nowIso) => buildBriefFacts({ ...stop.sources, ...patch }, { nowMs: Date.parse(nowIso) });
  const normal = (out) => byId(out.facts)['air.normal'];
  const air = (airborne, median, airSchedule, nowIso) => at({ air: { airborne, starlink: null }, airNormal: { median, days: 7 }, airSchedule }, nowIso);

  it('the schedule is read only at 25% or more fewer than usual; below that the fact is exactly as before', () => {
    expect(BRIEF_AIRBORNE_NOTABLE_PCT).toBe(25);
    expect(scheduleReadNeeded(300, 400)).toBe(true); // 25% fewer
    expect(scheduleReadNeeded(301, 400)).toBe(true); // 24.75% rounds to 25
    expect(scheduleReadNeeded(303, 400)).toBe(false); // 24%
    expect(scheduleReadNeeded(500, 400)).toBe(false);
    expect(scheduleReadNeeded(Number.NaN, 400)).toBe(false);
    // 20% fewer with a schedule 30% lighter: nothing changes and nothing is audited.
    const mild = air(521, 651, { today: 490, prior: week(700) });
    expect(normal(mild)).toEqual(normal(air(521, 651, undefined)));
    expect(mild.collection.airSchedule).toBeUndefined();
  });

  it('a light-schedule day at 37% fewer is calm, and the fact says why in plain words', () => {
    const out = build(fixture('light-schedule-calm'));
    const f = normal(out);
    expect(f).toMatchObject({
      statement: "The 405 United flights in the air are 37% fewer than usual for this time of day: over the past 7 days, the median at this hour was 641. That is in line with a lighter schedule today: about 30% fewer departures were scheduled from United's hubs over the past four hours than usual.",
      toneFloor: 'calm',
      severity: 20,
      material: 'airnorm:below:inline',
      lighterSchedule: true,
      inLineWithSchedule: true,
    });
    // Every number in the statement is in the values (the verifier checks them), and so is the cause.
    expect(f.values).toEqual(expect.arrayContaining(['405', '37%', '641', '7', '30%', 'four', 'lighter schedule']));
    expect(computeTone(out.facts)).toBe('calm');
    expect(isAirborneShortfallFact(f)).toBe(false);
    // The audit the cron stores in ops_briefs.collection.
    // A ratio under 0.70 takes none of the 10-point band (v1.34.1): the factor is the ratio.
    expect(out.collection.airSchedule).toEqual({
      status: 'ok', windowMin: 240, today: 490, usual: 705, days: 7, ratio: 0.695, factor: 0.695,
      airborne: 405, usualAirborne: 641, expectedAirborne: 445, vsExpectedPct: -9,
    });
    // Without the schedule (the same count before v1.31.3) it read "watch".
    expect(normal(build(fixture('calm-afternoon'), { air: { airborne: 405, starlink: null } })).toneFloor).toBe('watch');
  });

  it('a day 30% lighter with flights tracking the schedule reads as the schedule (v1.34.1: was 12% short)', () => {
    const out = air(490, 700, { today: 490, prior: week(700) });
    expect(out.collection.airSchedule).toMatchObject({ ratio: 0.7, factor: 0.7, expectedAirborne: 490, vsExpectedPct: 0 });
    expect(normal(out)).toMatchObject({ toneFloor: 'calm', material: 'airnorm:below:inline', inLineWithSchedule: true });
    expect(normal(out).statement).toMatch(/30% fewer than usual for this time of day.*in line with a lighter schedule today: about 30% fewer departures/);
  });

  it('"in line with" only when the schedule accounts for the shortfall, within 10 points', () => {
    const IN_LINE = 'That is in line with a lighter schedule today';
    const NEUTRAL = 'The schedule is lighter today too: about';
    // 34% fewer flying on a schedule 12% lighter: calm (32% short of expected), but not "in line".
    const notInLine = normal(air(462, 700, { today: 616, prior: week(700) }));
    expect(notInLine).toMatchObject({ toneFloor: 'calm', lighterSchedule: true, material: 'airnorm:below:lighter' });
    expect(notInLine.inLineWithSchedule).toBeUndefined();
    expect(notInLine.statement).toContain(`${NEUTRAL} 12% fewer departures`);
    expect(notInLine.statement).not.toContain(IN_LINE);
    // A schedule 30% lighter: 40% fewer flying is in line (10 points), 41% is not.
    expect(normal(air(420, 700, { today: 490, prior: week(700) }))).toMatchObject({ inLineWithSchedule: true, material: 'airnorm:below:inline' });
    const past = normal(air(413, 700, { today: 490, prior: week(700) }));
    expect(past).toMatchObject({ toneFloor: 'calm', material: 'airnorm:below:lighter' });
    expect(past.statement).toContain(NEUTRAL);
    // Never on a fact that sets a tone. Under the flat band, 65% fewer on a schedule 55% lighter was
    // within 10 points yet 36% short of the expected count, a watch. Under the taper (v1.34.1) the
    // expected count is the schedule's own below 0.70, so the same count is 22% short, calm and in
    // line, and no count within 10 points of the schedule reaches the watch line at all (the sweep);
    // the calm condition on "in line" stays as a guard.
    const deep = normal(air(245, 700, { today: 315, prior: week(700) }));
    expect(deep).toMatchObject({ toneFloor: 'calm', lighterSchedule: true, inLineWithSchedule: true });
    const reachable = [];
    for (const usualAir of [651, 700]) {
      for (let today = 280; today <= 700; today++) {
        const c = scheduleComparison({ today, prior: week(700) });
        const lighter = lighterSchedulePct(c);
        if (lighter === null) continue;
        for (let airborne = 100; airborne <= usualAir; airborne++) {
          const pct = Math.round(((airborne - usualAir) / usualAir) * 100);
          if (-pct - lighter > BRIEF_AIRBORNE_USUAL_BAND_PCT) continue;
          if (airborneShortfallTone(airborne, Math.round(usualAir * c.factor)) !== 'calm') reachable.push([usualAir, today, airborne]);
        }
      }
    }
    expect(reachable).toEqual([]);
  });

  it('a halt on a light-schedule day still reads disrupted, and does not call the schedule the reason', () => {
    const out = build(fixture('light-schedule-halt'));
    const f = normal(out);
    expect(f).toMatchObject({ toneFloor: 'disrupted', severity: 110, material: 'airnorm:below:lighter:disrupted:70' });
    expect(f.statement).toMatch(/73% fewer than usual.*The schedule is lighter today too: about 32% fewer departures were scheduled/);
    expect(f.statement).not.toMatch(/in line with/);
    expect(out.collection.airSchedule).toMatchObject({ status: 'ok', factor: 0.684, expectedAirborne: 445, vsExpectedPct: -61 });
    expect(computeTone(out.facts)).toBe('disrupted');
  });

  it('the backtest: the Nov 13 stop and the Saturday morning after it read as before', () => {
    // [airborne, usual, today's scheduled, usual scheduled] from airborne_samples and flight_history.
    const stopAt125 = air(342, 625, { today: 718, prior: week(693) }); // 1:25 PM PT Nov 13: ratio 1.04
    expect(normal(stopAt125)).toMatchObject({ toneFloor: 'disrupted', material: 'airnorm:below:disrupted:40' });
    expect(stopAt125.collection.airSchedule).toMatchObject({ factor: 1 });
    // 5:40 AM PT Sat Nov 14: 47% fewer, a Saturday schedule 8% lighter (inside the band): still disrupted.
    const saturday = air(240, 451, { today: 234, prior: week(255) });
    expect(normal(saturday)).toMatchObject({ toneFloor: 'disrupted', material: 'airnorm:below:disrupted:40' });
    expect(normal(saturday).statement).not.toMatch(/schedule/);
  });

  it('failure 1: the schedule read failed or timed out, so the fact is exactly as before', () => {
    const before = normal(air(174, 651, undefined));
    for (const failed of [{ today: null, prior: week(null), error: 'timeout' }, { today: null, prior: [], error: 'read_failed' }]) {
      const out = air(174, 651, failed);
      expect(normal(out)).toEqual(before);
      expect(out.collection.airSchedule).toMatchObject({ status: 'unavailable', reason: failed.error, factor: 1, expectedAirborne: 651 });
    }
    expect(normal(build(fixture('schedule-read-failed')))).toMatchObject({ toneFloor: 'disrupted', material: 'airnorm:below:disrupted:70' });
  });

  it('failure 2: today\'s rows missing or thin is not believed, so the fact is exactly as before', () => {
    const before = normal(air(174, 651, undefined));
    const out = build(fixture('schedule-rows-missing'));
    expect(normal(out)).toEqual(before);
    expect(out.collection.airSchedule).toMatchObject({ status: 'unavailable', reason: 'today_too_thin', today: 120, usual: 702, ratio: 0.171, factor: 1 });
    // Too few earlier days, or an overnight-sized usual: the same.
    expect(normal(air(174, 651, { today: 500, prior: [0, 0, 0, 0, 0, 700, 700] }))).toEqual(before);
    expect(normal(air(174, 651, { today: 100, prior: week(140) }))).toEqual(before);
  });

  describe('the five light-schedule dates: an unreadable schedule sets no tone', () => {
    const THANKSGIVING = '2026-11-26T20:00:00Z'; // 2 PM CT
    const WEDNESDAY = '2026-11-25T20:00:00Z';

    it('a failed read, or thin overnight counts, on Thanksgiving: calm, and the audit says why', () => {
      const failed = air(404, 651, { today: null, prior: week(null), error: 'timeout' }, THANKSGIVING); // 38% fewer
      expect(normal(failed)).toMatchObject({ toneFloor: 'calm', severity: 20, material: 'airnorm:below:holiday', lightScheduleDay: true });
      expect(failed.collection.airSchedule).toMatchObject({ status: 'unavailable', reason: 'timeout', holiday: 'Thanksgiving Day', holidayCapped: true });
      const overnight = air(80, 160, { today: 50, prior: week(120) }, '2026-11-26T09:00:00Z'); // 50% fewer, 3 AM CT
      expect(normal(overnight).toneFloor).toBe('calm');
      expect(overnight.collection.airSchedule).toMatchObject({ reason: 'usual_too_small', holidayCapped: true });
      // The holiday evening's light red-eyes, after Central midnight: still covered until 6 AM Central.
      const friday = air(80, 160, { today: 50, prior: week(120) }, '2026-11-27T11:30:00Z'); // 3:30 AM PT Fri
      expect(normal(friday).toneFloor).toBe('calm');
      expect(friday.collection.airSchedule).toMatchObject({ holiday: 'the morning after Thanksgiving Day', holidayCapped: true });
      const fridayMorning = air(80, 160, { today: 50, prior: week(120) }, '2026-11-27T12:30:00Z'); // 6:30 AM CT Fri
      expect(normal(fridayMorning).toneFloor).toBe('disrupted');
      // Even a halt, while the schedule cannot be read: that is the trade this fallback makes.
      expect(normal(air(174, 651, { today: null, prior: [], error: 'timeout' }, THANKSGIVING)).toneFloor).toBe('calm');
    });

    it('the day before, the same failed read keeps today\'s behaviour', () => {
      const out = air(404, 651, { today: null, prior: week(null), error: 'timeout' }, WEDNESDAY);
      expect(normal(out).toneFloor).toBe('watch');
      expect(out.collection.airSchedule.holiday).toBeUndefined();
    });

    it('the list is not the mechanism: with the schedule read, a halt on Thanksgiving is disrupted', () => {
      const halt = air(174, 651, { today: 480, prior: week(700) }, THANKSGIVING);
      expect(normal(halt).toneFloor).toBe('disrupted');
      expect(halt.collection.airSchedule.holiday).toBeUndefined();
      // And a light Thanksgiving with flights near the schedule is calm by the schedule, not the list.
      const light = air(404, 651, { today: 480, prior: week(700) }, THANKSGIVING);
      expect(normal(light)).toMatchObject({ toneFloor: 'calm', lighterSchedule: true, inLineWithSchedule: true });
    });
  });
});

// Nov 26 2026, Thanksgiving: a flat 10-point band on a schedule half the usual raised the expected
// count by about 19% and read "watch" from 3:10 to 4:30 PM PT. The band now tapers to nothing at a
// ratio of 0.70 (src/lib/brief-schedule.js). The backtest only shows that it leaves the Nov 13 stop
// alone (no sample of the stop had a ratio under 0.90); that a halt on a light day still trips is
// shown here, on synthetic counts.
describe('Nov 27 2026: the taper does not blunt a halt on a light day', () => {
  const stop = fixture('nationwide-stop-2026-11-13');
  const week = (n) => Array.from({ length: 7 }, () => n);
  const THANKSGIVING_AFTERNOON = '2026-11-26T22:00:00Z'; // 2 PM PT
  const normalAt = (airborne, airSchedule) => {
    const out = buildBriefFacts({ ...stop.sources, air: { airborne, starlink: null }, airNormal: { median: 680, days: 7 }, airSchedule }, { nowMs: Date.parse(THANKSGIVING_AFTERNOON) });
    return { fact: byId(out.facts)['air.normal'], audit: out.collection.airSchedule, tone: computeTone(out.facts) };
  };
  // A readable schedule 45% light (363 of 660, ratio 0.55): the factor is the ratio, 374 expected.
  const LIGHT = { today: 363, prior: week(660) };

  it('150 in the air against 680 usual on that schedule is disrupted, and leads', () => {
    const { fact, audit, tone } = normalAt(150, LIGHT);
    expect(audit).toMatchObject({ status: 'ok', ratio: 0.55, factor: 0.55, expectedAirborne: 374, vsExpectedPct: -60 });
    expect(audit.holiday).toBeUndefined();
    expect(fact).toMatchObject({ toneFloor: 'disrupted', severity: 110, lighterSchedule: true });
    expect(fact.lightScheduleDay).toBeUndefined();
    expect(isAirborneShortfallFact(fact)).toBe(true);
    expect(tone).toBe('disrupted');
  });

  it('230 in the air on the same schedule is a watch', () => {
    const { fact, audit } = normalAt(230, LIGHT);
    expect(audit).toMatchObject({ factor: 0.55, expectedAirborne: 374, vsExpectedPct: -39 });
    expect(fact).toMatchObject({ toneFloor: 'watch', severity: 50, lighterSchedule: true });
  });

  it('flights tracking that schedule are calm', () => {
    const { fact, audit } = normalAt(340, LIGHT);
    expect(audit).toMatchObject({ factor: 0.55, vsExpectedPct: -9 });
    expect(fact).toMatchObject({ toneFloor: 'calm', inLineWithSchedule: true });
  });
});

// Nov 26 2026, Thanksgiving, replayed from production's stored rows (tests/fixtures/thanksgiving-2026-rows.js)
// through the real fact builder: the taper (src/lib/brief-schedule.js) and the holiday sentence.
describe('Nov 27 2026: Thanksgiving replayed', () => {
  const HOLIDAY_SENTENCE = ' United schedules far fewer flights than usual for Thanksgiving Day.';
  const replay = THANKSGIVING_2026_ROWS.map((row) => {
    const out = buildBriefFacts(rowSources(row), { nowMs: Date.parse(row[1]) });
    return { id: row[0], fact: byId(out.facts)['air.normal'], audit: out.collection.airSchedule };
  });

  it('no row reaches watch, and no row with a usable schedule is more than 30% short of the expected count', () => {
    expect(replay.filter((r) => r.fact.toneFloor !== 'calm').map((r) => r.id)).toEqual([]);
    const usable = replay.filter((r) => r.audit.status === 'ok');
    expect(usable.map((r) => r.id)).toEqual(THANKSGIVING_2026_ROWS.filter(([id]) => id <= 879).map(([id]) => id));
    expect(usable.filter((r) => r.audit.vsExpectedPct < -30).map((r) => [r.id, r.audit.vsExpectedPct])).toEqual([]);
  });

  it('row 871, 3:10 PM PT: 23% short of a schedule half the usual (production read 35%, "watch")', () => {
    const { fact, audit } = replay.find((r) => r.id === 871);
    expect(audit).toMatchObject({ status: 'ok', ratio: 0.536, factor: 0.536, expectedAirborne: 364, vsExpectedPct: -23 });
    expect(fact).toMatchObject({ toneFloor: 'calm', lighterSchedule: true, material: 'airnorm:below:lighter' });
    expect(fact.lightScheduleDay).toBeUndefined();
    expect(fact.statement).not.toContain(HOLIDAY_SENTENCE);
  });

  it('from row 880 the schedule is too thin to use: the fact says it is the holiday, at a calm floor', () => {
    const thin = replay.filter((r) => r.id >= 880);
    expect(thin).toHaveLength(12);
    for (const { id, fact, audit } of thin) {
      expect(audit, String(id)).toMatchObject({ status: 'unavailable', reason: 'today_too_thin' });
      expect(fact, String(id)).toMatchObject({ toneFloor: 'calm', lightScheduleDay: true, material: 'airnorm:below:holiday' });
      expect(fact.statement.endsWith(HOLIDAY_SENTENCE), String(id)).toBe(true);
      expect(fact.values, String(id)).toEqual(expect.arrayContaining(['Thanksgiving Day', 'Thanksgiving']));
      expect(isAirborneShortfallFact(fact)).toBe(false);
    }
    // The audit keeps its fields: row 886 capped from 67% short, row 891 past Central midnight and not capped.
    expect(replay.find((r) => r.id === 886).audit).toMatchObject({ holiday: 'Thanksgiving Day', holidayCapped: true, vsExpectedPct: -67 });
    expect(replay.find((r) => r.id === 891).audit).toMatchObject({ holiday: 'the morning after Thanksgiving Day', holidayCapped: false, vsExpectedPct: -34 });
    expect(replay.find((r) => r.id === 886).fact.statement).toBe(`The 160 United flights in the air are 67% fewer than usual for this time of day: over the past 7 days, the median at this hour was 491.${HOLIDAY_SENTENCE}`);
  });

  it('the sentence names the day itself for each of the five dates, and the morning after each', () => {
    const thin = (nowIso) => byId(buildBriefFacts({ air: { airborne: 160, starlink: null }, airNormal: { median: 491, days: 7 }, airSchedule: { today: 100, prior: Array(7).fill(700) } }, { nowMs: Date.parse(nowIso) }).facts)['air.normal'];
    const cases = [
      ['2026-11-26T20:00:00Z', 'Thanksgiving Day', 'Thanksgiving'],
      ['2026-11-27T09:00:00Z', 'Thanksgiving Day', 'Thanksgiving'], // 3 AM CT Friday: the morning after
      ['2026-12-24T20:00:00Z', 'Christmas Eve', 'Christmas'],
      ['2026-12-25T20:00:00Z', 'Christmas Day', 'Christmas'],
      ['2026-12-26T09:00:00Z', 'Christmas Day', 'Christmas'],
      ['2026-12-31T20:00:00Z', "New Year's Eve", "New Year's"],
      ['2027-01-01T20:00:00Z', "New Year's Day", "New Year's"],
      ['2027-01-02T09:00:00Z', "New Year's Day", "New Year's"],
    ];
    for (const [nowIso, name, short] of cases) {
      const f = thin(nowIso);
      const sentence = ` United schedules far fewer flights than usual for ${name}.`;
      expect(f.statement.endsWith(sentence), nowIso).toBe(true);
      expect(f.values, nowIso).toEqual(expect.arrayContaining([name, short]));
      expect(f).toMatchObject({ lightScheduleDay: true, toneFloor: 'calm' });
      // No claim the verifier would have to ground: no airport, number or time in it.
      expect(extractClaims(sentence), nowIso).toEqual([]);
    }
    // Any other day, the same thin schedule: no flag, no sentence, the tone as before.
    const ordinary = thin('2026-11-20T20:00:00Z');
    expect(ordinary.lightScheduleDay).toBeUndefined();
    expect(ordinary.statement).not.toMatch(/schedules far fewer/);
    expect(ordinary.toneFloor).toBe('disrupted');
  });

  it('on the holiday a count near the usual reads nothing and says nothing', () => {
    const f = byId(buildBriefFacts({ air: { airborne: 600, starlink: null }, airNormal: { median: 660, days: 7 }, airSchedule: { today: 100, prior: Array(7).fill(700) } }, { nowMs: Date.parse('2026-11-26T20:00:00Z') }).facts)['air.normal'];
    expect(f.lightScheduleDay).toBeUndefined();
    expect(f.statement).not.toMatch(/Thanksgiving/);
  });
});
