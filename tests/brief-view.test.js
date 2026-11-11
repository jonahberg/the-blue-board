// What the dashboard shows for a GET /api/brief body (src/lib/brief-view.js). The bodies are the
// endpoint's own `briefResponseBody()` over briefs built by the real template from the fixtures,
// so the shapes here are the shapes production sends.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { BRIEF_STALE_AFTER_MS as SERVER_STALE_AFTER_MS, briefResponseBody } from '../api/brief';
import { buildBriefFacts } from '../src/lib/brief-facts.js';
import { radioFactsFromStatus } from '../src/lib/brief-radio.js';
import { buildTemplateBrief } from '../src/lib/brief-template.js';
import {
  BRIEF_HOW_STEPS,
  BRIEF_STALE_AFTER_MS,
  BRIEF_TONE_WORD,
  briefFreshnessLine,
  briefSourceLine,
  briefViewState,
  formatBriefClock,
} from '../src/lib/brief-view.js';

const fixture = (name) => JSON.parse(readFileSync(resolve(__dirname, 'fixtures', 'brief', `${name}.json`), 'utf8'));

/** A stored ops_briefs row for a fixture's template brief, written at `generatedMs`. */
function rowFor(name, { generatedMs, checkedMs = generatedMs, source = 'template', brief: override } = {}) {
  const fx = fixture(name);
  const nowMs = Date.parse(fx.nowIso);
  const radio = Object.entries(fx.radio || {}).flatMap(([hub, s]) => radioFactsFromStatus(hub, s, { nowMs }));
  const { facts } = buildBriefFacts({ ...fx.sources, extraFacts: radio }, { nowMs });
  const brief = override ?? buildTemplateBrief(facts);
  return {
    id: 1, generated_at: new Date(generatedMs).toISOString(), checked_at: new Date(checkedMs).toISOString(),
    source, template_reason: source === 'template' ? 'generation_disabled' : null, tone: brief.tone,
    headline: brief.headline, items: brief.items, traveler_note: brief.traveler_note,
    headline_fact_ids: brief.headline_fact_ids ?? [], facts, verifier: { itemsIn: brief.items.length },
  };
}

const NOW = Date.parse('2026-11-10T23:10:00Z');

describe('briefViewState', () => {
  it('a fresh brief is ready, with every cited fact indexed and the full fact count', () => {
    const body = briefResponseBody(rowFor('storm-day', { generatedMs: NOW - 5 * 60_000 }), NOW);
    const view = briefViewState(body, { nowMs: NOW });
    expect(view.status).toBe('ready');
    if (view.status !== 'ready') return;
    expect(view.tone).toBe('disrupted');
    expect(view.headline).toBe('A ground stop is in effect at Newark.');
    expect(view.items).toHaveLength(4);
    for (const item of view.items) for (const id of item.factIds) expect(view.factsById.has(id)).toBe(true);
    expect(view.travelerNote?.text).toMatch(/^If you are flying through Newark/);
    // "Written from N live facts" counts every fact the brief was written from, not the cited ones.
    expect(view.factCount).toBe(34);
    expect(view.facts.length).toBeLessThan(view.factCount);
    expect(view.source).toBe('template');
    expect(view.hasRadio).toBe(false);
  });

  it('no brief, a failed fetch and nothing-yet are each "unavailable", never a stale brief shown as current', () => {
    expect(briefViewState(briefResponseBody(null, NOW), { nowMs: NOW })).toEqual({ status: 'unavailable', reason: 'none' });
    expect(briefViewState(null, { nowMs: NOW })).toEqual({ status: 'unavailable', reason: 'loading' });
    const fresh = briefResponseBody(rowFor('calm-afternoon', { generatedMs: NOW - 60_000 }), NOW);
    expect(briefViewState(fresh, { error: true, nowMs: NOW })).toEqual({ status: 'unavailable', reason: 'error' });
  });

  it('honours the server stale flag', () => {
    const body = briefResponseBody(rowFor('calm-afternoon', { generatedMs: NOW - 45 * 60_000 }), NOW);
    expect(body.stale).toBe(true);
    expect(briefViewState(body, { nowMs: NOW })).toEqual({ status: 'unavailable', reason: 'stale' });
  });

  it('re-checks checkedAt against the visitor clock: a body that was fresh when served goes stale in a background tab', () => {
    const body = briefResponseBody(rowFor('calm-afternoon', { generatedMs: NOW - 20 * 60_000 }), NOW);
    expect(body.stale).toBe(false);
    expect(briefViewState(body, { nowMs: NOW }).status).toBe('ready');
    expect(briefViewState(body, { nowMs: NOW + 11 * 60_000 })).toEqual({ status: 'unavailable', reason: 'stale' });
  });

  it('a brief re-confirmed by the cron stays fresh although it was written an hour ago', () => {
    const body = briefResponseBody(rowFor('calm-afternoon', { generatedMs: NOW - 60 * 60_000, checkedMs: NOW - 4 * 60_000 }), NOW);
    expect(briefViewState(body, { nowMs: NOW }).status).toBe('ready');
  });

  it('a malformed body is invalid rather than half-rendered', () => {
    const good = briefResponseBody(rowFor('calm-afternoon', { generatedMs: NOW - 60_000 }), NOW);
    for (const bad of [
      { ...good, brief: { ...good.brief, headline: '' } },
      { ...good, brief: { ...good.brief, tone: 'panic' } },
      { ...good, brief: { ...good.brief, items: [] } },
      { ...good, brief: { ...good.brief, items: [{ text: 42, fact_ids: [] }] } },
      { ...good, generatedAt: 'not a date' },
      'oops',
    ]) {
      expect(briefViewState(bad, { nowMs: NOW }).status).toBe('unavailable');
    }
  });

  it('drops a traveler note unless the tone is disrupted, and flags a cited radio fact', () => {
    const fx = fixture('ground-stop-with-radio');
    const nowMs = Date.parse(fx.nowIso);
    const radio = radioFactsFromStatus('EWR', fx.radio.EWR, { nowMs });
    const r = radio.find((f) => f.kind === 'radio');
    const row = rowFor('ground-stop-with-radio', {
      generatedMs: NOW - 60_000,
      source: 'model',
      brief: {
        headline: 'A ground stop is in effect at Newark.', tone: 'disrupted', headline_fact_ids: [],
        items: [{ text: `Controllers on Newark frequencies were heard saying "${r.quote}".`, fact_ids: [r.id] }],
        traveler_note: { text: 'If you are flying through Newark, check your flight.', fact_ids: ['faa.active.EWR.gs'] },
      },
    });
    const view = briefViewState(briefResponseBody(row, NOW), { nowMs: NOW });
    expect(view.status).toBe('ready');
    if (view.status !== 'ready') return;
    expect(view.hasRadio).toBe(true);
    expect(view.travelerNote).not.toBeNull();

    const calmRow = rowFor('calm-afternoon', { generatedMs: NOW - 60_000 });
    calmRow.traveler_note = { text: 'Should not show.', fact_ids: [] };
    const calm = briefViewState(briefResponseBody(calmRow, NOW), { nowMs: NOW });
    expect(calm.status === 'ready' && calm.travelerNote).toBeNull();
  });

  it('mirrors the server staleness window', () => {
    expect(BRIEF_STALE_AFTER_MS).toBe(SERVER_STALE_AFTER_MS);
  });
});

describe('copy', () => {
  it('says how the brief was written, and says the truth for a template', () => {
    expect(briefSourceLine('model', 21)).toBe('Written from 21 live facts and checked against them.');
    expect(briefSourceLine('model', 1)).toBe('Written from 1 live fact and checked against them.');
    expect(briefSourceLine('template', 21)).toBe('This brief was listed straight from the data, with no AI text.');
    expect(BRIEF_HOW_STEPS).toHaveLength(3);
    expect(BRIEF_TONE_WORD).toEqual({ calm: 'Calm', watch: 'Watch', disrupted: 'Disrupted' });
  });

  it('formats clock times in the viewer zone with its abbreviation', () => {
    const at = Date.parse('2026-11-10T22:35:00Z');
    expect(formatBriefClock(at, { timeZone: 'America/Chicago' })).toBe('4:35 PM CST');
    expect(formatBriefClock(at, { timeZone: 'America/Los_Angeles' })).toBe('2:35 PM PST');
    expect(formatBriefClock(NaN)).toBe('');
  });

  it('names the re-confirmation only when there was one, then the next check', () => {
    const tz = { timeZone: 'America/New_York' };
    const g = Date.parse('2026-11-10T22:00:00Z');
    expect(briefFreshnessLine({ generatedAtMs: g, checkedAtMs: g, nextUpdateAtMs: g + 10 * 60_000 }, tz))
      .toBe('Next check 5:10 PM EST.');
    expect(briefFreshnessLine({ generatedAtMs: g, checkedAtMs: g + 30 * 60_000, nextUpdateAtMs: g + 40 * 60_000 }, tz))
      .toBe('Facts unchanged as of 5:30 PM EST. Next check 5:40 PM EST.');
    expect(briefFreshnessLine({ generatedAtMs: g, checkedAtMs: g, nextUpdateAtMs: null }, tz)).toBe('');
  });
});
