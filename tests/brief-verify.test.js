// The ops brief's deterministic verifier (src/lib/brief-verify.js) and the claim extractor behind it
// (src/lib/brief-claims.js). Contract: nothing the model writes reaches a visitor unless every number,
// percentage, clock time, airport and cause in it appears in the values of the facts that sentence
// cites; a failing item is dropped with its reasons; a headline that smuggles an ungrounded claim is
// replaced by the template headline; tone comes from the facts, not the model.
import { describe, expect, it } from 'vitest';

import { allowanceFromValues, claimFailure, extractClaims } from '../src/lib/brief-claims.js';
import { checkSentence, citedFactIds, validateBriefShape, verifyBrief } from '../src/lib/brief-verify.js';

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
    ], { tone: 'watch' }), FACTS.filter((f) => f.id !== 'faa.active.EWR.gs'));
    expect(out.ok).toBe(true);
    expect(out.report.itemsKept).toBe(3);
    expect(out.report.dropped).toEqual([]);
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
    expect(checkSentence('The FAA may stop Newark departures until 9:00 PM ET; nothing is in effect yet.', ['faa.planned.EWR'], index)).toEqual([]);
  });

  it('lets "weather" stand for any weather cause a cited fact carries', () => {
    expect(checkSentence('Weather has stopped Newark departures until 8:30 PM ET.', ['faa.active.EWR.gs'], new Map(FACTS.map((f) => [f.id, f])))).toEqual([]);
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

describe('citedFactIds', () => {
  it('collects items, headline and traveler-note citations once each', () => {
    expect(citedFactIds({ items: [item('a', ['x', 'y']), item('b', ['y'])], headline_fact_ids: ['z'], traveler_note: item('c', ['x']) })).toEqual(['x', 'y', 'z']);
  });
});
