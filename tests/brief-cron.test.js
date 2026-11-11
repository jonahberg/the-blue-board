// The ops-brief cron (api/cron/brief.ts) with Supabase mocked at its one seam (getSupabaseAdmin), the
// model mocked through the `generate` dependency, and the sources from the fixtures. Contract:
//   - a verified model brief is stored with its facts, hash, tokens, cost and the verifier report,
//     and its cost is booked against the brief's own daily counter;
//   - invalid JSON, a bad shape, a failed call, no surviving item, the spend cap, an unreadable
//     counter and both kill switches all publish the TEMPLATE (or nothing, for the cron switch);
//   - unchanged facts under 60 minutes write nothing but `checked_at`;
//   - nothing is published without both /api/irops and /api/faa;
//   - cleanup deletes in bounded batches.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeSupabase } from './fixtures/fake-supabase.js';

const supabaseMocks = vi.hoisted(() => ({ getSupabaseAdmin: vi.fn(async () => null) }));
vi.mock('../api/_schedule-snapshots.js', () => supabaseMocks);

import handler, { factsHash, runBriefCron } from '../api/cron/brief.js';
import { BRIEF_RETENTION_MS, __resetBriefStoreForTests, cleanupOldBriefs } from '../api/_brief-store.js';
import { __resetFeatureSpendForTests } from '../api/_feature-spend.js';
import { buildBriefFacts } from '../src/lib/brief-facts.js';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/brief/${name}.json`, import.meta.url), 'utf8'));
const CALM = fixture('calm-afternoon');
const NOW = Date.parse(CALM.nowIso);
const DAY = CALM.nowIso.slice(0, 10);

const collected = (fx = CALM, patch = {}) => async () => ({ ...fx.sources, air: fx.sources.air, airNormal: fx.sources.airNormal, errors: {}, ...patch });
const factsOf = (fx = CALM) => buildBriefFacts(fx.sources, { nowMs: Date.parse(fx.nowIso) }).facts;

const GOOD_JSON = {
  headline: 'United is running smoothly this afternoon.',
  tone: 'calm',
  items: [
    { text: 'Every hub with a reading is at 85% or better; Los Angeles is the low mark.', fact_ids: ['otp.floor'] },
    { text: '630 United flights are in the air, 280 of them with Starlink.', fact_ids: ['air.starlink'] },
  ],
  traveler_note: null,
};
const modelOk = (json = GOOD_JSON, extra = {}) => vi.fn(async () => ({
  json, failure: null, detail: null, modelId: 'anthropic/claude-haiku-5.5', inputTokens: 2400, outputTokens: 300, costUsd: 0.00039, stopReason: 'end_turn', elapsedMs: 900, ...extra,
}));
const modelFail = (failure, costUsd = 0) => vi.fn(async () => ({
  json: null, failure, detail: 'x', modelId: 'anthropic/claude-haiku-5.5', inputTokens: null, outputTokens: null, costUsd, stopReason: null, elapsedMs: 20000,
}));

let db;
function useDb(opts) {
  db = fakeSupabase(opts);
  supabaseMocks.getSupabaseAdmin.mockResolvedValue(db.client);
  return db;
}
const briefRows = () => db.state.ops_briefs || [];
const spendRpcs = () => db.calls.filter((c) => c.rpc === 'increment_feature_spend');

beforeEach(() => {
  __resetBriefStoreForTests();
  __resetFeatureSpendForTests();
  supabaseMocks.getSupabaseAdmin.mockReset();
  process.env.AI_GATEWAY_API_KEY = 'test-key';
  delete process.env.BRIEF_CRON;
  delete process.env.BRIEF_GENERATION;
  delete process.env.BRIEF_DAILY_USD_CAP;
  // No unit test may reach the network.
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => { throw new Error(`unexpected fetch ${url}`); });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.AI_GATEWAY_API_KEY;
});

describe('publishing', () => {
  it('stores a verified model brief with its facts, hash, tokens, cost and verifier report, and books the spend', async () => {
    useDb();
    const generate = modelOk();
    const summary = await runBriefCron({ nowMs: NOW, collect: collected(), generate });
    expect(summary).toEqual(expect.objectContaining({ status: 'published', source: 'model', tone: 'calm', itemsKept: 2 }));
    expect(generate).toHaveBeenCalledTimes(1);
    const [row] = briefRows();
    expect(row).toEqual(expect.objectContaining({
      source: 'model', template_reason: null, tone: 'calm', headline: 'United is running smoothly this afternoon.',
      model: 'anthropic/claude-haiku-5.5', input_tokens: 2400, output_tokens: 300, cost_usd: 0.00039,
      facts_hash: factsHash(factsOf()),
    }));
    expect(row.facts.length).toBe(factsOf().length);
    expect(row.verifier).toEqual(expect.objectContaining({ itemsIn: 2, itemsKept: 2, dropped: [] }));
    expect(row.checked_at).toBe(row.generated_at);
    expect(spendRpcs()).toEqual([{ rpc: 'increment_feature_spend', args: { p_feature: 'brief', p_day: DAY, p_usd: 0.00039, p_calls: 1, p_input_tokens: 2400, p_output_tokens: 300 } }]);
  });

  it('drops a failing item but still publishes the model brief when one survives', async () => {
    useDb();
    const json = { ...GOOD_JSON, items: [...GOOD_JSON.items, { text: 'Denver is at 99%.', fact_ids: ['otp.DEN'] }] };
    await runBriefCron({ nowMs: NOW, collect: collected(), generate: modelOk(json) });
    const [row] = briefRows();
    expect(row.source).toBe('model');
    expect(row.items).toHaveLength(2);
    expect(row.verifier.dropped).toEqual([expect.objectContaining({ index: 2, reasons: ['number_not_in_facts:99%'] })]);
  });
});

describe('template fallbacks', () => {
  const cases = [
    ['invalid JSON', modelFail('invalid_json', 0.0004), 'invalid_json'],
    ['a refusal', modelFail('model_refusal', 0.0001), 'model_refusal'],
    ['a timeout (booked at worst case)', modelFail('model_timeout', 0.0012), 'model_timeout'],
    ['a gateway budget 402', modelFail('gateway_budget'), 'gateway_budget'],
    ['a bad shape', modelOk({ headline: 'x', tone: 'calm', items: 'nope', traveler_note: null }), 'invalid_shape'],
    ['no surviving item', modelOk({ ...GOOD_JSON, items: [{ text: 'Denver is at 12%.', fact_ids: ['otp.DEN'] }] }), 'no_items_survived'],
  ];
  for (const [label, generate, reason] of cases) {
    it(`${label} → template (${reason})`, async () => {
      useDb();
      const summary = await runBriefCron({ nowMs: NOW, collect: collected(), generate });
      expect(summary).toEqual(expect.objectContaining({ status: 'published', source: 'template', templateReason: reason }));
      const [row] = briefRows();
      expect(row).toEqual(expect.objectContaining({ source: 'template', template_reason: reason, headline: 'United is running smoothly right now.' }));
      expect(row.verifier.fallback).toBe(reason);
      expect(row.verifier.templateCheck).toEqual(expect.objectContaining({ dropped: [], headline: 'kept' }));
    });
  }

  it('books whatever a failed call may have cost, and nothing for an unbilled refusal', async () => {
    useDb();
    await runBriefCron({ nowMs: NOW, collect: collected(), generate: modelFail('model_timeout', 0.0012) });
    expect(spendRpcs().map((c) => c.args.p_usd)).toEqual([0.0012]);
    useDb();
    await runBriefCron({ nowMs: NOW, collect: collected(), generate: modelFail('gateway_budget', 0) });
    expect(spendRpcs()).toEqual([]);
  });
});

describe('spend cap and kill switches', () => {
  it('spend cap reached: template, no model call', async () => {
    useDb({ tables: { feature_spend_daily: [{ feature: 'brief', day: DAY, usd: 0.4995 }] } });
    const generate = modelOk();
    const summary = await runBriefCron({ nowMs: NOW, collect: collected(), generate });
    expect(generate).not.toHaveBeenCalled();
    expect(summary).toEqual(expect.objectContaining({ source: 'template', templateReason: 'spend_cap' }));
  });

  it('another feature’s spend does not count against the brief', async () => {
    useDb({ tables: { feature_spend_daily: [{ feature: 'ask', day: DAY, usd: 2.9 }] } });
    const generate = modelOk();
    await runBriefCron({ nowMs: NOW, collect: collected(), generate });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('honours BRIEF_DAILY_USD_CAP, and an explicit 0 is a kill switch', async () => {
    process.env.BRIEF_DAILY_USD_CAP = '2';
    useDb({ tables: { feature_spend_daily: [{ feature: 'brief', day: DAY, usd: 0.9 }] } });
    const generate = modelOk();
    await runBriefCron({ nowMs: NOW, collect: collected(), generate });
    expect(generate).toHaveBeenCalledTimes(1);
    process.env.BRIEF_DAILY_USD_CAP = '0';
    useDb();
    const summary = await runBriefCron({ nowMs: NOW, collect: collected(), generate });
    expect(summary.templateReason).toBe('spend_cap');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the spend counter cannot be read (sql/022 not applied)', async () => {
    useDb({ failures: { 'feature_spend_daily.select': { code: '42P01', message: 'relation "feature_spend_daily" does not exist' } } });
    const generate = modelOk();
    const summary = await runBriefCron({ nowMs: NOW, collect: collected(), generate });
    expect(generate).not.toHaveBeenCalled();
    expect(summary.templateReason).toBe('spend_unreadable');
  });

  it('BRIEF_GENERATION=off: templates continue, the model is never asked', async () => {
    process.env.BRIEF_GENERATION = 'off';
    useDb();
    const generate = modelOk();
    const summary = await runBriefCron({ nowMs: NOW, collect: collected(), generate });
    expect(generate).not.toHaveBeenCalled();
    expect(summary).toEqual(expect.objectContaining({ status: 'published', source: 'template', templateReason: 'generation_disabled' }));
  });

  it('BRIEF_CRON=off: the whole run no-ops before collecting anything', async () => {
    process.env.BRIEF_CRON = '0';
    useDb();
    const collect = vi.fn(collected());
    const generate = modelOk();
    expect(await runBriefCron({ nowMs: NOW, collect, generate })).toEqual({ status: 'disabled' });
    expect(collect).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(db.calls).toEqual([]);
  });

  it('no AI_GATEWAY_API_KEY: template', async () => {
    delete process.env.AI_GATEWAY_API_KEY;
    useDb();
    const generate = modelOk();
    expect((await runBriefCron({ nowMs: NOW, collect: collected(), generate })).templateReason).toBe('no_api_key');
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('change detection', () => {
  const prevRow = (minutesAgo, extra = {}) => ({
    id: 7, generated_at: new Date(NOW - minutesAgo * 60_000).toISOString(), checked_at: new Date(NOW - minutesAgo * 60_000).toISOString(),
    facts_hash: factsHash(factsOf()), source: 'model', template_reason: null, ...extra,
  });

  it('unchanged facts and a brief under 60 minutes old: no new brief, no model call, checked_at stamped', async () => {
    useDb({ tables: { ops_briefs: [prevRow(20)] } });
    const generate = modelOk();
    const summary = await runBriefCron({ nowMs: NOW, collect: collected(), generate });
    expect(summary).toEqual(expect.objectContaining({ status: 'unchanged', briefId: 7, ageMin: 20, checkedAtUpdated: true }));
    expect(generate).not.toHaveBeenCalled();
    expect(briefRows()).toHaveLength(1);
    expect(briefRows()[0].checked_at).toBe(new Date(NOW).toISOString());
  });

  it('jitter does not count as a change', async () => {
    useDb({ tables: { ops_briefs: [prevRow(20)] } });
    const summary = await runBriefCron({ nowMs: NOW, collect: collected(CALM, { air: { airborne: 641, starlink: 284 } }), generate: modelOk() });
    expect(summary.status).toBe('unchanged');
  });

  it('unchanged facts but the brief is 60 minutes old: write a new one', async () => {
    useDb({ tables: { ops_briefs: [prevRow(61)] } });
    const generate = modelOk();
    expect((await runBriefCron({ nowMs: NOW, collect: collected(), generate })).status).toBe('published');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('a material change writes a new brief at once', async () => {
    useDb({ tables: { ops_briefs: [prevRow(5)] } });
    const faa = [{ airportCode: 'SFO', programs: [{ type: 'ground_stop', reason: 'wind', endTime: '2026-11-10T23:30:00Z' }], groundStop: true, delays: [{ type: 'ground_stop' }] }];
    const summary = await runBriefCron({ nowMs: NOW, collect: collected(CALM, { faa }), generate: modelOk({ ...GOOD_JSON }) });
    expect(summary).toEqual(expect.objectContaining({ status: 'published', tone: 'disrupted' }));
  });

  it('retries the model on the next run after a transient failure, even with the same facts', async () => {
    useDb({ tables: { ops_briefs: [prevRow(10, { source: 'template', template_reason: 'model_timeout' })] } });
    const generate = modelOk();
    expect((await runBriefCron({ nowMs: NOW, collect: collected(), generate })).status).toBe('published');
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('does not retry a deterministic failure (no item survived) until the facts change', async () => {
    useDb({ tables: { ops_briefs: [prevRow(10, { source: 'template', template_reason: 'no_items_survived' })] } });
    expect((await runBriefCron({ nowMs: NOW, collect: collected(), generate: modelOk() })).status).toBe('unchanged');
  });
});

describe('honest degradation', () => {
  it('publishes nothing without /api/irops or /api/faa', async () => {
    useDb();
    const generate = modelOk();
    for (const missing of ['irops', 'faa']) {
      const summary = await runBriefCron({ nowMs: NOW, collect: collected(CALM, { [missing]: null, errors: { [missing]: 'HTTP 502' } }), generate });
      expect(summary).toEqual(expect.objectContaining({ status: 'skipped' }));
    }
    expect(generate).not.toHaveBeenCalled();
    expect(briefRows()).toEqual([]);
  });

  it('publishes nothing when fewer than three hubs have an on-time reading (thin boards)', async () => {
    useDb();
    const generate = modelOk();
    const extraFacts = vi.fn(async () => ({ facts: [] }));
    const thin = Object.fromEntries(Object.entries(CALM.sources.irops.hubMetrics).map(([hub, m]) => [hub, { ...m, operated: hub === 'ORD' || hub === 'DEN' ? m.operated : 12, onTime: hub === 'ORD' || hub === 'DEN' ? m.onTime : 11 }]));
    const summary = await runBriefCron({ nowMs: NOW, collect: collected(CALM, { irops: { ...CALM.sources.irops, hubMetrics: thin } }), generate, extraFacts });
    expect(summary).toEqual(expect.objectContaining({ status: 'skipped', reason: '2 hub on-time reading(s); 3 are needed' }));
    expect(generate).not.toHaveBeenCalled();
    expect(extraFacts).not.toHaveBeenCalled(); // nothing optional (or paid) runs either
    expect(briefRows()).toEqual([]);
  });

  it('no Supabase: unconfigured, nothing collected', async () => {
    supabaseMocks.getSupabaseAdmin.mockResolvedValue(null);
    const collect = vi.fn(collected());
    expect(await runBriefCron({ nowMs: NOW, collect, generate: modelOk() })).toEqual({ status: 'unconfigured', reason: 'supabase not configured' });
    expect(collect).not.toHaveBeenCalled();
  });

  it('ops_briefs missing (sql/022 not applied): a 200-shaped "unconfigured", never a throw', async () => {
    useDb({ failures: { 'ops_briefs.select': { code: '42P01', message: 'relation "ops_briefs" does not exist' } } });
    const generate = modelOk();
    expect(await runBriefCron({ nowMs: NOW, collect: collected(), generate })).toEqual({ status: 'unconfigured', reason: 'table missing' });
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('cleanupOldBriefs', () => {
  const oldRows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, generated_at: new Date(NOW - BRIEF_RETENTION_MS - (i + 1) * 60_000).toISOString() }));

  it('deletes rows past 90 days in batches of 300 and keeps recent ones', async () => {
    useDb({ tables: { ops_briefs: [...oldRows(650), { id: 9999, generated_at: new Date(NOW - 1000).toISOString() }] } });
    expect(await cleanupOldBriefs(NOW)).toEqual({ deleted: 650, capReached: false });
    expect(db.calls.filter((c) => c.op === 'delete').map((c) => c.filters[0][2].length)).toEqual([300, 300, 50]);
    expect(briefRows().map((r) => r.id)).toEqual([9999]);
  });

  it('stops at four batches and says a backlog may remain', async () => {
    useDb({ tables: { ops_briefs: oldRows(1300) } });
    expect(await cleanupOldBriefs(NOW)).toEqual({ deleted: 1200, capReached: true });
    expect(briefRows()).toHaveLength(100);
  });

  it('runs from the cron once an hour, on the first run after the top of the hour', async () => {
    const topOfHour = Date.parse('2026-11-10T22:00:00Z');
    useDb({ tables: { ops_briefs: oldRows(3) } });
    const summary = await runBriefCron({ nowMs: topOfHour + 30_000, collect: collected(), generate: modelOk() });
    expect(summary.cleanup).toEqual({ deleted: 3, capReached: false });
    useDb({ tables: { ops_briefs: oldRows(3) } });
    expect((await runBriefCron({ nowMs: topOfHour + 20 * 60_000, collect: collected(), generate: modelOk() })).cleanup).toBeNull();
  });
});

describe('handler', () => {
  function createRes() {
    return { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(p) { this.body = p; return this; }, setHeader() {} };
  }
  it('rejects a request without the cron secret', async () => {
    process.env.CRON_SECRET = 's3cret';
    const res = createRes();
    await handler({ method: 'GET', headers: { authorization: 'Bearer nope' } }, res);
    expect(res.statusCode).toBe(401);
    delete process.env.CRON_SECRET;
  });

  it('answers 200 with the run summary for an authorized request', async () => {
    process.env.CRON_SECRET = 's3cret';
    process.env.BRIEF_CRON = 'off';
    const res = createRes();
    await handler({ method: 'GET', headers: { authorization: 'Bearer s3cret' } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ status: 'disabled' });
    delete process.env.CRON_SECRET;
  });
});
