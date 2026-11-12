// The ops brief's deterministic verifier (src/lib/brief-verify.js) and the claim extractor behind it
// (src/lib/brief-claims.js). Contract: nothing the model writes reaches a visitor unless every number,
// percentage, clock time, airport and cause in it appears in the values of the facts that sentence
// cites; a failing item is dropped with its reasons; a headline that smuggles an ungrounded claim is
// replaced by the template headline; tone comes from the facts, not the model.
import { describe, expect, it } from 'vitest';

import { allowanceFromValues, claimFailure, extractClaims } from '../src/lib/brief-claims.js';
import { readFileSync } from 'node:fs';
import { buildBriefFacts } from '../src/lib/brief-facts.js';
import { briefFromSavedResponse, checkSentence, citedFactIds, nonHubLeadReason, trimOnTimeDefinition, validateBriefShape, verifyBrief } from '../src/lib/brief-verify.js';

const fact = (id, values, extra = {}) => ({
  id, kind: 'otp', statement: `${id} statement`, values, at: null, link: { tab: 'live' }, severity: 5, toneFloor: 'calm', material: id, ...extra,
});

const FACTS = [
  fact('otp.LAX', ['85%', '79', 'LAX', 'Los Angeles'], { hub: 'LAX' }),
  fact('otp.IAH', ['100%', '95', 'IAH', 'Houston', 'Houston Intercontinental'], { hub: 'IAH' }),
  fact('otp.ORD', ['91%', 'ORD', "Chicago O'Hare", "O'Hare", 'Chicago'], { hub: 'ORD' }),
  fact('otp.IAD', ['94%', 'IAD', 'Washington Dulles', 'Dulles', 'Washington'], { hub: 'IAD' }),
  fact('faa.planned.EWR', ['EWR', 'Newark', '9:00 PM ET'], { kind: 'faa_planned', hub: 'EWR', toneFloor: 'watch', severity: 22 }),
  fact('faa.planned.BOS', ['BOS', 'Boston', '7:30 PM ET'], { kind: 'faa_planned' }),
  fact('faa.active.EWR.gs', ['EWR', 'Newark', '8:30 PM ET', 'thunderstorms', 'weather'], { kind: 'faa', hub: 'EWR', toneFloor: 'disrupted', severity: 100 }),
  fact('air.total', ['630'], { kind: 'airborne' }),
  fact('air.starlink', ['280', '630'], { kind: 'airborne' }),
  fact('otp.floor', ['7', 'seven', '85%', 'LAX', 'Los Angeles']),
];

const brief = (items, extra = {}) => ({ headline: 'Calm across the network.', tone: 'calm', items, traveler_note: null, ...extra });
const item = (text, fact_ids) => ({ text, fact_ids });

describe('extractClaims', () => {
  it('reads clock times with and without zones, percentages, numbers and number words', () => {
    const claims = extractClaims('Until 9:00 PM ET, 85% of 1,204 flights; seven hubs; 9 p.m.; noon.');
    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'time', minutes: 21 * 60, zone: 'ET' }),
      expect.objectContaining({ type: 'time', minutes: 21 * 60, zone: null }),
      expect.objectContaining({ type: 'time', minutes: 12 * 60 }),
      expect.objectContaining({ type: 'percent', value: '85' }),
      expect.objectContaining({ type: 'number', value: '1204' }),
      expect.objectContaining({ type: 'number', value: '7' }),
    ]));
    // "9:00" is one time, never also the numbers 9 and 0.
    expect(claims.filter((c) => c.type === 'number').map((c) => c.value).sort()).toEqual(['1204', '7']);
  });

  it('normalises the narrow no-break space Intl puts before PM', () => {
    expect(extractClaims('until 9:00 PM ET')).toEqual([expect.objectContaining({ type: 'time', minutes: 1260, zone: 'ET' })]);
  });

  it('maps airport names, including shared ones, to codes and consumes the longest name first', () => {
    const claims = extractClaims("Chicago O'Hare and Dulles, then Chicago, then New York JFK.");
    const airports = claims.filter((c) => c.type === 'airport');
    expect(airports.map((c) => c.codes)).toEqual([['ORD'], ['IAD'], ['ORD', 'MDW'], ['JFK']]);
  });

  it('treats all-caps three-letter tokens as airports except known acronyms', () => {
    const airports = extractClaims('The FAA says ATC at SEA and BFI.').filter((c) => c.type === 'airport');
    expect(airports.map((c) => c.codes[0])).toEqual(['SEA', 'BFI']);
  });

  it('reads flight numbers, runways and causes', () => {
    const claims = extractClaims('United 2809 landed on runway 22L in thunderstorms and low clouds after de-icing.');
    expect(claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'flight', value: 'UA2809' }),
      expect.objectContaining({ type: 'runway', value: '22L' }),
      expect.objectContaining({ type: 'cause', value: 'thunderstorms' }),
      expect.objectContaining({ type: 'cause', value: 'low_clouds' }),
      expect.objectContaining({ type: 'cause', value: 'deicing' }),
    ]));
    expect(claims.some((c) => c.type === 'cause' && c.value === 'ice')).toBe(false);
  });

  it('flags vague quantities that cannot be grounded', () => {
    expect(extractClaims('Hundreds of flights are late.')).toEqual([expect.objectContaining({ type: 'vague' })]);
  });
});

describe('claimFailure', () => {
  const allowed = allowanceFromValues(['85%', '630', '9:00 PM ET', 'EWR', 'Newark']);
  it('lets a bare number repeat a percentage but never builds a percentage from a count', () => {
    expect(claimFailure({ type: 'number', raw: '85', value: '85' }, allowed)).toBeNull();
    expect(claimFailure({ type: 'percent', raw: '630%', value: '630' }, allowed)).toBe('number_not_in_facts:630%');
  });
  it('accepts a time without a zone, rejects one in the wrong zone', () => {
    expect(claimFailure({ type: 'time', raw: '9 PM', minutes: 1260, zone: null }, allowed)).toBeNull();
    expect(claimFailure({ type: 'time', raw: '9:00 PM CT', minutes: 1260, zone: 'CT' }, allowed)).toBe('time_wrong_zone:9:00 PM CT');
  });
});

describe('verifyBrief: items', () => {
  it('accepts a grounded brief and keeps every item', () => {
    const out = verifyBrief(brief([
      item('Every hub is at 85% on time or better; Los Angeles is the low mark and Houston is at 100%.', ['otp.floor', 'otp.IAH']),
      item('The FAA says a ground stop is possible at Newark until 9:00 PM ET and at Boston until 7:30 PM ET. Neither is in effect.', ['faa.planned.EWR', 'faa.planned.BOS']),
      item('630 United flights are in the air, 280 of them with Starlink.', ['air.starlink']),
    ], { tone: 'watch', headline: 'Ground stops at Newark and Boston.' }), FACTS.filter((f) => f.id !== 'faa.active.EWR.gs'));
    expect(out.ok).toBe(true);
    expect(out.report.itemsKept).toBe(3);
    expect(out.report.dropped).toEqual([]);
    // The headline rests on the items' facts but need not repeat their "possible": item-only rules.
    expect(out.report.headline.status).toBe('kept');
    expect(out.brief.headline).toBe('Ground stops at Newark and Boston.');
  });

  it('drops an item whose number is not in the facts it cites (wrong number)', () => {
    const out = verifyBrief(brief([
      item('Los Angeles is the low mark at 84%.', ['otp.LAX']),
      item('630 United flights are in the air.', ['air.total']),
    ]), FACTS);
    expect(out.report.itemsKept).toBe(1);
    expect(out.report.dropped).toEqual([expect.objectContaining({ index: 0, reasons: ['number_not_in_facts:84%'] })]);
  });

  it('drops an item that names an airport none of its facts carries (uncited airport)', () => {
    const out = verifyBrief(brief([item('Los Angeles is at 85% and Denver is fine.', ['otp.LAX']), item('630 United flights are in the air.', ['air.total'])]), FACTS);
    expect(out.report.dropped[0].reasons).toEqual(['uncited_airport:Denver']);
  });

  it('drops an item that cites the right number from the WRONG fact', () => {
    // 85% exists in the fact set, but not in the fact this item cites.
    const out = verifyBrief(brief([item('Houston is at 85%.', ['otp.IAH']), item('630 United flights are in the air.', ['air.total'])]), FACTS);
    expect(out.report.dropped[0].reasons).toEqual(['number_not_in_facts:85%']);
  });

  it('drops an item with a clock time that is not in the facts', () => {
    const out = verifyBrief(brief([item('A ground stop is possible at Newark until 10:00 PM ET.', ['faa.planned.EWR']), item('630 United flights are in the air.', ['air.total'])]), FACTS);
    expect(out.report.dropped[0].reasons).toEqual(['time_not_in_facts:10:00 PM ET']);
  });

  it('accepts city-name synonyms for a cited airport (Chicago for ORD, Dulles and Washington for IAD)', () => {
    const out = verifyBrief(brief([
      item("Chicago is at 91%; O'Hare is steady.", ['otp.ORD']),
      item('Dulles is at 94%, the best in Washington.', ['otp.IAD']),
    ]), FACTS);
    expect(out.report.itemsKept).toBe(2);
  });

  it('a shared city name in a fact\u2019s values does not vouch for that city\u2019s other airports', () => {
    const index = new Map([
      ['faa.planned.EWR', fact('faa.planned.EWR', ['EWR', 'Newark', 'New York', '9:00 PM ET'], { kind: 'faa_planned' })],
      ['otp.ORD', FACTS.find((f) => f.id === 'otp.ORD')],
    ]);
    expect(checkSentence('A ground stop is possible at New York\u2019s Newark until 9:00 PM ET.', ['faa.planned.EWR'], index)).toEqual([]);
    expect(checkSentence('A ground stop is possible at LGA until 9:00 PM ET.', ['faa.planned.EWR'], index)).toEqual(['uncited_airport:LGA']);
    expect(checkSentence('A ground stop is possible at LaGuardia until 9:00 PM ET.', ['faa.planned.EWR'], index)).toEqual(['uncited_airport:LaGuardia']);
    expect(checkSentence('Midway is at 91%.', ['otp.ORD'], index)).toEqual(['uncited_airport:Midway']);
    expect(checkSentence('Chicago is at 91%.', ['otp.ORD'], index)).toEqual([]);
  });

  it('rejects a synonym that cannot mean any cited airport', () => {
    const out = verifyBrief(brief([item('New York is calm at 91%.', ['otp.ORD']), item('630 United flights are in the air.', ['air.total'])]), FACTS);
    expect(out.report.dropped[0].reasons).toEqual(['uncited_airport:New York']);
  });

  it('rejects unknown fact ids, empty citations, causes not in the facts and first-person voice', () => {
    expect(checkSentence('630 flights are airborne.', ['air.nope'], new Map(FACTS.map((f) => [f.id, f])))).toContain('unknown_fact_id:air.nope');
    expect(checkSentence('630 flights are airborne.', [], new Map())).toContain('no_fact_ids');
    expect(checkSentence('Thunderstorms hit Los Angeles, now at 85%.', ['otp.LAX'], new Map(FACTS.map((f) => [f.id, f])))).toEqual(['cause_not_in_facts:Thunderstorms']);
    expect(checkSentence('Our 630 flights are airborne.', ['air.total'], new Map(FACTS.map((f) => [f.id, f])))).toEqual(['first_person']);
  });

  it('drops an item that states a PLANNED program as if it were happening (prompt rule 2)', () => {
    const index = new Map(FACTS.map((f) => [f.id, f]));
    expect(checkSentence('Newark has a ground stop until 9:00 PM ET.', ['faa.planned.EWR'], index)).toEqual(['planned_not_hedged']);
    expect(checkSentence('A ground stop is possible at Newark until 9:00 PM ET.', ['faa.planned.EWR'], index)).toEqual([]);
    expect(checkSentence('The FAA may stop flights into Newark until 9:00 PM ET; nothing is in effect yet.', ['faa.planned.EWR'], index)).toEqual([]);
  });

  it('lets "weather" stand for any weather cause a cited fact carries', () => {
    expect(checkSentence('Weather has stopped arrivals at Newark until 8:30 PM ET.', ['faa.active.EWR.gs'], new Map(FACTS.map((f) => [f.id, f])))).toEqual([]);
  });

  it('caps items at four and drops the rest', () => {
    const items = Array.from({ length: 5 }, () => item('630 United flights are in the air.', ['air.total']));
    const out = verifyBrief(brief(items), FACTS);
    expect(out.report.itemsKept).toBe(4);
    expect(out.report.dropped).toEqual([expect.objectContaining({ index: 4, reasons: ['over_item_limit'] })]);
  });

  it('is not ok when no item survives, so the caller publishes the template', () => {
    const out = verifyBrief(brief([item('Los Angeles is at 12%.', ['otp.LAX'])]), FACTS);
    expect(out.ok).toBe(false);
    expect(out.brief).toBeNull();
    expect(out.report.itemsKept).toBe(0);
  });
});

describe('verifyBrief: headline, tone, traveler note', () => {
  const items = [item('630 United flights are in the air, 280 of them with Starlink.', ['air.starlink'])];

  it('replaces a headline that smuggles a number not in the surviving items’ facts', () => {
    const out = verifyBrief(brief(items, { headline: '630 flights up, 85% on time.' }), FACTS.filter((f) => f.toneFloor === 'calm'));
    expect(out.ok).toBe(true);
    expect(out.report.headline.status).toBe('replaced');
    expect(out.report.headline.reasons).toEqual(['number_not_in_facts:85%']);
    expect(out.brief.headline).toBe('United is running smoothly right now.');
  });

  it('checks the headline against SURVIVING items only: a dropped item cannot ground it', () => {
    const out = verifyBrief(brief([
      item('Los Angeles is at 84%.', ['otp.LAX']), // dropped
      ...items,
    ], { headline: 'Los Angeles lags.' }), FACTS.filter((f) => f.toneFloor === 'calm'));
    expect(out.report.itemsKept).toBe(1);
    expect(out.report.headline).toEqual(expect.objectContaining({ status: 'replaced', reasons: ['uncited_airport:Los Angeles'] }));
  });

  it('keeps a grounded headline and warns past twelve words', () => {
    const out = verifyBrief(brief(items, { headline: 'United is calm right now, with lots of Starlink flights in the air tonight.' }), FACTS.filter((f) => f.toneFloor === 'calm'));
    expect(out.report.headline.status).toBe('kept');
    expect(out.report.warnings).toContain('headline:over_12_words');
  });

  it('replaces a headline that calls a non-calm operation calm, smooth, quiet or "running normally"', () => {
    const watchFacts = FACTS.filter((f) => f.id !== 'faa.active.EWR.gs'); // computed tone: watch
    for (const headline of ['United operations look calm.', 'Flights are running smoothly.', 'A smooth day so far.', 'A quiet afternoon at the hubs.', 'Hubs are running normally.', 'Calmly through the evening.']) {
      const out = verifyBrief(brief(items, { headline }), watchFacts);
      expect(out.brief.tone, headline).toBe('watch');
      expect(out.report.headline, headline).toEqual({ status: 'replaced', reasons: ['headline:calm_when_not_calm'], original: headline });
      expect(out.brief.headline).toBe('FAA action is possible at Newark; none is in effect.');
    }
    // Calm words in a calm brief, and words that merely contain them, are fine.
    expect(verifyBrief(brief(items, { headline: 'United operations look calm.' }), FACTS.filter((f) => f.toneFloor === 'calm')).report.headline.status).toBe('kept');
    expect(verifyBrief(brief(items, { headline: 'Smoother than yesterday at the hubs.' }), watchFacts).report.headline.status).toBe('kept');
  });

  it('replaces a headline past fourteen words with the template headline', () => {
    // 16 words, the length of a real Nov 11 headline that shipped with only a warning.
    const long = 'United is calm right now, with lots of Starlink flights in the air across the country.';
    const out = verifyBrief(brief(items, { headline: long }), FACTS.filter((f) => f.toneFloor === 'calm'));
    expect(out.report.headline).toEqual({ status: 'replaced', reasons: ['headline_too_long'], original: long });
    expect(out.brief.headline).toBe('United is running smoothly right now.');
    const fourteen = 'United is calm right now, with lots of Starlink flights in the air today.';
    expect(verifyBrief(brief(items, { headline: fourteen }), FACTS.filter((f) => f.toneFloor === 'calm')).report.headline.status).toBe('kept');
  });

  it('computes the tone from the facts and overrides the model', () => {
    const out = verifyBrief(brief(items, { tone: 'calm' }), FACTS);
    expect(out.report.tone).toEqual({ model: 'calm', computed: 'disrupted', final: 'disrupted', overridden: true });
    expect(out.brief.tone).toBe('disrupted');
  });

  it('drops a traveler note unless the final tone is disrupted', () => {
    const note = item('A ground stop is possible at Newark, so check your flight before leaving.', ['faa.planned.EWR']);
    const calm = verifyBrief(brief(items, { traveler_note: note }), FACTS.filter((f) => f.id !== 'faa.active.EWR.gs'));
    expect(calm.report.travelerNote).toEqual({ status: 'dropped', reasons: ['tone_is_watch'] });
    expect(calm.brief.traveler_note).toBeNull();
    const disrupted = verifyBrief(brief(items, { traveler_note: item('Flying through Newark? Check your flight before 8:30 PM ET.', ['faa.active.EWR.gs']) }), FACTS);
    expect(disrupted.report.travelerNote.status).toBe('kept');
    expect(disrupted.brief.traveler_note.fact_ids).toEqual(['faa.active.EWR.gs']);
  });

  it('keeps a traveler note on a "watch" brief while a ground delay program is in effect at a hub', () => {
    const gdp = fact('faa.active.SFO.gdp', ['SFO', 'San Francisco', '12:59 PM PT', 'low clouds', 'weather', '62 minutes', '132 minutes'], { kind: 'faa', hub: 'SFO', toneFloor: 'watch', severity: 85 });
    const facts = [...FACTS.filter((f) => f.toneFloor !== 'disrupted'), gdp];
    const note = item('Flying into San Francisco? Check your flight before you leave.', ['faa.active.SFO.gdp']);
    const out = verifyBrief(brief([item('A ground delay program is holding flights into San Francisco until 12:59 PM PT.', ['faa.active.SFO.gdp'])], { tone: 'watch', traveler_note: note }), facts);
    expect(out.brief.tone).toBe('watch');
    expect(out.report.travelerNote.status).toBe('kept');
    // The same program away from the hubs (no `hub`) allows one too since Nov 2026: United flies there.
    const away = [...FACTS.filter((f) => f.toneFloor !== 'disrupted'), { ...gdp, id: 'faa.active.BOS.gdp', hub: undefined, values: ['BOS', 'Boston'], toneFloor: 'calm' }];
    const out2 = verifyBrief(brief([item('630 United flights are in the air.', ['air.total'])], { traveler_note: item('Flying into Boston? Check your flight.', ['faa.active.BOS.gdp']) }), away);
    expect(out2.report.travelerNote).toEqual({ status: 'kept', reasons: [] });
    // A possible program is not one in effect: no note.
    const out3 = verifyBrief(brief([item('630 United flights are in the air.', ['air.total'])], { traveler_note: item('Flying into Boston? Check your flight.', ['faa.planned.BOS']) }), FACTS.filter((f) => f.toneFloor === 'calm'));
    expect(out3.report.travelerNote).toEqual({ status: 'dropped', reasons: ['planned_not_hedged', 'tone_is_calm'] });
  });

  it('records style warnings (jargon, exclamation) without dropping', () => {
    const out = verifyBrief(brief([item('No GDP anywhere! 630 United flights are in the air.', ['air.total'])]), FACTS);
    expect(out.report.itemsKept).toBe(1);
    expect(out.report.warnings).toEqual(expect.arrayContaining(['items[0]:jargon:GDP', 'items[0]:exclamation']));
  });
});

describe('validateBriefShape', () => {
  it('accepts the schema and rejects everything else', () => {
    expect(validateBriefShape(brief([item('x', ['a'])])).ok).toBe(true);
    expect(validateBriefShape(null)).toEqual({ ok: false, errors: ['not_an_object'] });
    expect(validateBriefShape({ ...brief([item('x', ['a'])]), extra: 1 }).errors).toContain('unexpected_key:extra');
    expect(validateBriefShape(brief([])).errors).toContain('items_empty');
    expect(validateBriefShape(brief([item('x', ['a'])], { tone: 'fine' })).errors).toContain('tone_invalid');
    expect(validateBriefShape(brief([{ text: 'x', fact_ids: 'a' }])).errors).toContain('items[0]_fact_ids_invalid');
    const { traveler_note, ...noNote } = brief([item('x', ['a'])]);
    expect(validateBriefShape(noNote).errors).toContain('traveler_note_missing');
  });

  it('an invalid shape is not ok and says why', () => {
    const out = verifyBrief({ headline: 'x' }, FACTS);
    expect(out.ok).toBe(false);
    expect(out.report.shapeErrors).toEqual(expect.arrayContaining(['tone_invalid', 'items_not_an_array']));
  });
});

describe('briefFromSavedResponse (the eval harness --check)', () => {
  const good = brief([item('630 United flights are in the air, 280 of them with Starlink.', ['air.starlink'])]);
  const calmFacts = FACTS.filter((f) => f.toneFloor === 'calm');

  it('reads a bare brief and a Messages API body the same way, and publishes the verified brief', () => {
    const bare = briefFromSavedResponse(JSON.stringify(good), calmFacts);
    const message = briefFromSavedResponse(JSON.stringify({
      content: [{ type: 'thinking', thinking: '…' }, { type: 'text', text: JSON.stringify(good) }], stop_reason: 'end_turn',
    }), calmFacts);
    for (const out of [bare, message]) {
      expect(out).toEqual(expect.objectContaining({ source: 'model', templateReason: null }));
      expect(out.report.itemsKept).toBe(1);
      expect(out.brief.items[0].fact_ids).toEqual(['air.starlink']);
    }
  });

  it('falls back to the template with the cron’s reasons', () => {
    expect(briefFromSavedResponse('not json {', calmFacts)).toEqual(expect.objectContaining({ source: 'template', templateReason: 'invalid_json', report: null }));
    expect(briefFromSavedResponse(JSON.stringify({ content: [], stop_reason: 'max_tokens' }), calmFacts).templateReason).toBe('model_truncated');
    expect(briefFromSavedResponse(JSON.stringify({ headline: 'x' }), calmFacts).templateReason).toBe('invalid_shape');
    const none = briefFromSavedResponse(JSON.stringify(brief([item('Los Angeles is at 12%.', ['otp.LAX'])])), calmFacts);
    expect(none.templateReason).toBe('no_items_survived');
    expect(none.brief.headline).toBe('United is running smoothly right now.');
  });
});

describe('citedFactIds', () => {
  it('collects items, headline and traveler-note citations once each', () => {
    expect(citedFactIds({ items: [item('a', ['x', 'y']), item('b', ['y'])], headline_fact_ids: ['z'], traveler_note: item('c', ['x']) })).toEqual(['x', 'y', 'z']);
  });
});

// Nov 12 2026: the rules the 5:00 PM and 5:20 PM PT specimens of Nov 11 asked for.
describe('verifyBrief: Nov 12 2026 rules', () => {
  const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/brief/${name}.json`, import.meta.url), 'utf8'));
  const factsOf = (name) => { const fx = fixture(name); return buildBriefFacts(fx.sources, { nowMs: Date.parse(fx.nowIso) }).facts; };

  describe('a headline never leads with a program at an airport that is not a hub', () => {
    const calm = factsOf('nonhub-gdp-calm');
    const watch = factsOf('nonhub-gdp-specimen');
    const sea = item('A ground delay program is holding flights into Seattle until 9:59 PM PT.', ['faa.active.SEA.gdp']);
    it('replaces the real headlines of Nov 11 that did, in either tone', () => {
      // Rows 21-25 of ops_briefs (Boston for Seattle in row 21: the same shape).
      for (const [headline, facts] of [
        ['Ground delays are holding flights into Seattle; hubs look normal.', calm],
        ['A ground delay program is holding flights into Seattle.', calm],
        ['Ground delay program for flights into Seattle.', calm],
        ['Seattle has a ground delay program; no United hub is under one.', calm],
        ['Ground delays are holding flights into Seattle; hubs look normal.', watch],
        ['Seattle has a ground delay program; no United hub is under one.', watch],
      ]) {
        const out = verifyBrief(brief([sea], { headline }), facts);
        expect(out.report.headline, headline).toEqual({ status: 'replaced', reasons: ['headline:leads_with_non_hub_program'], original: headline });
      }
      expect(verifyBrief(brief([sea], { headline: 'A ground delay program is holding flights into Seattle.' }), calm).brief.headline)
        .toBe("United's hubs are running normally; a delay program is slowing Seattle arrivals.");
    });
    it('keeps the hubs-first shape, a calm headline that leaves the program to the items, and a hub story', () => {
      for (const headline of [
        "United's hubs are running normally; a delay program is slowing Seattle arrivals.",
        "United's hubs are running normally; a delay program is slowing flights into Seattle.",
        'United is running smoothly; Seattle arrivals are slowed by a delay program.',
        'United is running smoothly right now.',
      ]) expect(verifyBrief(brief([sea], { headline }), calm).report.headline.status, headline).toBe('kept');
      // The 5:20 PM shape the owner liked: the hub story leads, Seattle rides in an item.
      const ord = factsOf('ord-79-variant');
      expect(nonHubLeadReason("Chicago O'Hare is running behind other hubs; no ground stops are active.", 'watch', ord)).toBeNull();
      // No program away from the hubs: the rule does not apply.
      expect(nonHubLeadReason('Delays are light everywhere.', 'calm', factsOf('calm-afternoon'))).toBeNull();
    });
  });

  describe('a single hub’s on-time percentage on a day every hub is healthy', () => {
    const facts = factsOf('nonhub-gdp-specimen');
    it('the specimen’s item 4 (otp.floor + otp.EWR) is replaced by the summary, and counted', () => {
      const out = verifyBrief(brief([
        item('A ground delay program is holding flights into Seattle (SEA) until 9:59 PM PT, with delays averaging 32 minutes and up to 82 minutes.', ['faa.active.SEA.gdp']),
        item('All 7 hubs with an on-time reading are at 84% or better, and Newark is at 96%.', ['otp.floor', 'otp.EWR']),
      ], { tone: 'watch', headline: 'FAA action is possible at Newark tomorrow; none is in effect.' }), facts);
      expect(out.report.healthyHubOnTime).toBe(1);
      expect(out.report.summaryInserted).toBe(true);
      expect(out.report.dropped[0].reasons).toEqual(['unknown_fact_id:otp.EWR', 'uncited_airport:Newark', 'number_not_in_facts:96%', 'hub_on_time_on_healthy_day']);
      expect(out.brief.items.map((i) => i.text)).toEqual([
        'A ground delay program is holding flights into Seattle (SEA) until 9:59 PM PT, with delays averaging 32 minutes and up to 82 minutes.',
        'All seven United hubs reporting so far today are at 84% on time or better.',
      ]);
    });
    it('a grounded sentence that pins the summary’s floor on one hub is dropped too; the summary itself is kept', () => {
      const out = verifyBrief(brief([
        item('All seven United hubs reporting so far today are at 84% on time or better.', ['otp.floor']),
        item('Newark is at 84% or better, and a ground stop or delay program is possible there tomorrow after 10:00 AM ET.', ['otp.floor', 'faa.planned.EWR']),
      ], { tone: 'watch', headline: 'FAA action is possible at Newark tomorrow; none is in effect.' }), facts);
      expect(out.report.dropped).toEqual([expect.objectContaining({ index: 1, reasons: ['hub_on_time_on_healthy_day'] })]);
      expect(out.report.summaryInserted).toBe(false); // the summary is already there
      expect(out.brief.items).toHaveLength(1);
    });
    it('not on a day a hub is below 80%: naming the lowest hub is the news then', () => {
      const ord = factsOf('ord-79-variant');
      const out = verifyBrief(brief([item("Chicago O'Hare is the soft spot, with 79% of departures leaving within 30 minutes of schedule so far today (460 departed).", ['otp.ORD'])], { tone: 'watch' }), ord);
      expect(out.report.dropped).toEqual([]);
      expect(out.report.healthyHubOnTime).toBe(0);
    });
  });

  describe('a time whose fact carries its day keeps it', () => {
    const facts = factsOf('nonhub-gdp-specimen');
    it('drops "after 10:00 AM ET" for a program tomorrow, keeps "tomorrow after 10:00 AM ET"', () => {
      const bare = 'The FAA says a ground stop or delay program is possible for flights into Newark after 10:00 AM ET; none is in effect.';
      const index = new Map(facts.map((f) => [f.id, f]));
      expect(checkSentence(bare, ['faa.planned.EWR'], index)).toEqual(['time_without_day:tomorrow 10:00 AM ET']);
      expect(checkSentence(bare.replace('after 10:00', 'tomorrow after 10:00'), ['faa.planned.EWR'], index)).toEqual([]);
      // The 5:20 PM specimen's item 4, verbatim.
      const item4 = "The FAA's operations plan says a ground stop or ground delay program is possible for Newark (EWR) after 10:00 AM ET and San Francisco (SFO) after 7:00 AM PT. Neither is in effect.";
      expect(checkSentence(item4, ['faa.planned.EWR', 'faa.planned.SFO'], index)).toEqual(['time_without_day:tomorrow 10:00 AM ET', 'time_without_day:tomorrow 7:00 AM PT']);
      // A time later today needs no day word.
      const evening = new Map(factsOf('plan-times-evening').map((f) => [f.id, f]));
      expect(checkSentence('A ground delay program is possible for flights into San Francisco until 9:00 PM PT; it is not in effect.', ['faa.planned.SFO'], evening)).toEqual([]);
    });
  });

  describe('the on-time definition is stated once', () => {
    it('trims the repeat after the first item that states it (the 5:20 PM specimen, items 1 and 2)', () => {
      const facts = factsOf('ord-79-variant');
      const first = "Chicago O'Hare is the soft spot, with 79% of departures leaving within 30 minutes of schedule so far today (460 departed).";
      const second = 'The other United hubs are running normally, at 89% or better on departures within 30 minutes of schedule.';
      const out = verifyBrief(brief([
        item(first, ['otp.ORD']),
        item(second, ['otp.LAX']),
      ], { tone: 'watch', headline: "Chicago O'Hare is running behind the other hubs." }), facts);
      expect(out.report.dropped).toEqual([]);
      expect(out.brief.items.map((i) => i.text)).toEqual([first, 'The other United hubs are running normally, at 89% or better on time.']);
      expect(out.report.trimmed).toEqual([{ item: 1, from: second, to: 'The other United hubs are running normally, at 89% or better on time.', reason: 'on_time_definition_repeated' }]);
    });
    it('trims only the definition, in its usual shapes, and leaves a sentence without one alone', () => {
      expect(trimOnTimeDefinition('Denver has 91% of departures leaving within 30 minutes of schedule.')).toBe('Denver has 91% of departures on time.');
      expect(trimOnTimeDefinition('Denver is at 91% on time, within 30 minutes of schedule.')).toBe('Denver is at 91% on time.');
      expect(trimOnTimeDefinition('Delays average 30 minutes at Seattle.')).toBeNull();
    });
  });
});
