// The brief's model call (api/_brief-model.ts) with the Anthropic SDK mocked. Pins: the same
// gateway client setup as api/delay-explain.ts plus maxRetries: 0; one model-id constant with an env
// override; the request written for Haiku 5.5 (structured output, explicit effort, no temperature);
// the JSON found by block type after a thinking block; stop reasons checked; and what each failure
// books against the spend cap.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreate, MockAnthropic } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  const MockAnthropic = vi.fn(function () { return { messages: { create: mockCreate } }; });
  return { mockCreate, MockAnthropic };
});
vi.mock('@anthropic-ai/sdk', () => ({ default: MockAnthropic }));

import { __resetBriefModelForTests, briefModelId, classifyModelError, generateBriefWithModel } from '../api/_brief-model.js';
import { BRIEF_DEFAULT_MODEL_ID, BRIEF_OUTPUT_SCHEMA, BRIEF_SYSTEM_PROMPT, briefCostUsd, buildBriefUserMessage, readBriefResponse } from '../src/lib/brief-prompt.js';

const FACTS = [{ id: 'air.total', kind: 'airborne', statement: '630 United flights are in the air.', values: ['630'], at: null, link: { tab: 'live' }, severity: 4, toneFloor: 'calm', material: 'x' }];
const NOW = Date.parse('2026-11-10T21:40:00Z');
const BRIEF = { headline: 'Calm.', tone: 'calm', items: [{ text: '630 United flights are in the air.', fact_ids: ['air.total'] }], traveler_note: null };

beforeEach(() => {
  __resetBriefModelForTests();
  mockCreate.mockReset();
  MockAnthropic.mockClear();
  process.env.AI_GATEWAY_API_KEY = 'gw-test';
  delete process.env.AI_GATEWAY_BASE_URL;
  delete process.env.BRIEF_MODEL_ID;
});
afterEach(() => { delete process.env.AI_GATEWAY_API_KEY; });

describe('generateBriefWithModel', () => {
  it('builds the gateway client like delay-explain (Bearer only) with SDK retries off', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(BRIEF) }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 200 } });
    await generateBriefWithModel(FACTS, NOW);
    expect(MockAnthropic).toHaveBeenCalledWith({ baseURL: 'https://ai-gateway.vercel.sh', apiKey: null, authToken: 'gw-test', maxRetries: 0 });
  });

  it('sends the Haiku 5.5 request: catalog model id, structured output, explicit effort, no sampling params', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(BRIEF) }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 200 } });
    await generateBriefWithModel(FACTS, NOW);
    const [body, opts] = mockCreate.mock.calls[0];
    expect(body.model).toBe('anthropic/claude-haiku-5.5');
    expect(BRIEF_DEFAULT_MODEL_ID).toBe('anthropic/claude-haiku-5.5');
    expect(body.system).toBe(BRIEF_SYSTEM_PROMPT);
    expect(body.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema: BRIEF_OUTPUT_SCHEMA } });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body.max_tokens).toBeGreaterThanOrEqual(1500);
    expect(body.messages).toEqual([{ role: 'user', content: buildBriefUserMessage(FACTS, NOW) }]);
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('BRIEF_MODEL_ID overrides the model without a deploy', () => {
    process.env.BRIEF_MODEL_ID = 'claude-haiku-5-5';
    expect(briefModelId()).toBe('claude-haiku-5-5');
  });

  it('finds the JSON by block type after a thinking block, and prices the usage', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: JSON.stringify(BRIEF) }],
      stop_reason: 'end_turn', usage: { input_tokens: 2400, output_tokens: 300 },
    });
    const out = await generateBriefWithModel(FACTS, NOW);
    expect(out).toEqual(expect.objectContaining({ json: BRIEF, failure: null, inputTokens: 2400, outputTokens: 300, costUsd: 0.00039 }));
  });

  it('a refusal or a truncated answer is a failure, still priced from usage', async () => {
    mockCreate.mockResolvedValueOnce({ content: [], stop_reason: 'refusal', usage: { input_tokens: 2000, output_tokens: 10 } });
    expect(await generateBriefWithModel(FACTS, NOW)).toEqual(expect.objectContaining({ json: null, failure: 'model_refusal', costUsd: 0.000205 }));
    mockCreate.mockResolvedValueOnce({ content: [{ type: 'text', text: '{"headline":' }], stop_reason: 'max_tokens', usage: { input_tokens: 2000, output_tokens: 2000 } });
    expect((await generateBriefWithModel(FACTS, NOW)).failure).toBe('model_truncated');
  });

  it('invalid JSON is a failure with a reason', async () => {
    mockCreate.mockResolvedValue({ content: [{ type: 'text', text: 'Here is your brief: {' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } });
    expect((await generateBriefWithModel(FACTS, NOW)).failure).toBe('invalid_json');
  });

  it('a timeout books the worst case; a 4xx books nothing', async () => {
    mockCreate.mockImplementation((_body, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('Request was aborted.'), { name: 'AbortError' })));
    }));
    const timedOut = await generateBriefWithModel(FACTS, NOW, { timeoutMs: 5 });
    expect(timedOut.failure).toBe('model_timeout');
    expect(timedOut.costUsd).toBeGreaterThan(0.0009); // 2000 output tokens at $0.50/M plus the input
    mockCreate.mockReset();
    mockCreate.mockRejectedValue(Object.assign(new Error('bad schema'), { status: 400 }));
    expect(await generateBriefWithModel(FACTS, NOW)).toEqual(expect.objectContaining({ failure: 'model_rejected', costUsd: 0 }));
  });
});

describe('classifyModelError', () => {
  it('maps gateway and SDK errors to template reasons', () => {
    expect(classifyModelError({ status: 402 })).toEqual({ reason: 'gateway_budget', maybeBilled: false });
    expect(classifyModelError({ status: 403 })).toEqual({ reason: 'gateway_forbidden', maybeBilled: false });
    expect(classifyModelError({ status: 429 })).toEqual({ reason: 'model_rate_limited', maybeBilled: false });
    expect(classifyModelError({ status: 503 })).toEqual({ reason: 'model_error', maybeBilled: false });
    expect(classifyModelError(new TypeError('fetch failed'))).toEqual({ reason: 'model_error', maybeBilled: true });
  });
});

describe('prompt helpers', () => {
  it('the user message carries the facts without internals, and the part of day on each coast', () => {
    const msg = buildBriefUserMessage(FACTS, NOW);
    expect(msg.startsWith('It is afternoon on the US East Coast and afternoon on the West Coast.')).toBe(true);
    expect(msg).toContain('"id": "air.total"');
    expect(msg).not.toMatch(/severity|toneFloor|material/);
  });

  it('readBriefResponse refuses empty text', () => {
    expect(readBriefResponse({ content: [{ type: 'thinking' }], stop_reason: 'end_turn' })).toEqual({ ok: false, reason: 'model_empty' });
  });

  it('briefCostUsd uses the Haiku 5.5 rates', () => {
    expect(briefCostUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(0.6);
    expect(briefCostUsd(null)).toBe(0);
  });
});
