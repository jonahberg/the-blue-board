// "Ask the board": the one model call, through the Vercel AI Gateway with the same client setup as
// api/delay-explain.ts and api/_brief-model.ts (the Anthropic SDK pointed at the gateway's
// Anthropic-compatible endpoint, Bearer-only auth with AI_GATEWAY_API_KEY, AI_GATEWAY_BASE_URL as the
// override host, SDK retries off). The request itself is src/lib/ask-prompt.js.
//
// No Supabase import here: scripts/ask-eval.mjs imports this file to send the production request.

import Anthropic from '@anthropic-ai/sdk';
import { ASK_DEFAULT_MODEL_ID, askCostUsd, askWorstCaseCostUsd, buildAskRequest, readAskResponse } from '../src/lib/ask-prompt.js';
import { validateAskResult } from '../src/lib/ask-vocabulary.js';
import { classifyModelError } from './_brief-model.js';

/** Short: the visitor is watching a "working" line in the search palette. */
export const ASK_MODEL_TIMEOUT_MS = 6_000;

/** The model id actually sent: ASK_MODEL_ID, else the gateway catalog id for Claude Haiku 5.5. */
export function askModelId(): string {
  const configured = String(process.env.ASK_MODEL_ID ?? '').trim();
  return configured || ASK_DEFAULT_MODEL_ID;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      baseURL: process.env.AI_GATEWAY_BASE_URL || 'https://ai-gateway.vercel.sh',
      // apiKey: null stops the SDK reading ANTHROPIC_API_KEY and sending x-api-key beside the
      // gateway's Bearer token (api/delay-explain.ts, F114).
      apiKey: null,
      authToken: process.env.AI_GATEWAY_API_KEY,
      maxRetries: 0,
    });
  }
  return client;
}

export function __resetAskModelForTests(): void {
  client = null;
}

export type AskModelResult = {
  /** The validated result, or null when the call failed or nothing usable came back. */
  result: { view: string; filters: Record<string, unknown> } | null;
  /** 'unsupported' when the model said so (or nothing it said survived validation). */
  unsupported: boolean;
  /** Why the call failed (a model/gateway reason), or null when it answered. */
  failure: string | null;
  /** The raw JSON the model returned, for the eval harness only — never sent to a browser. */
  raw: unknown;
  modelId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number;
  stopReason: string | null;
  elapsedMs: number;
};

/**
 * Ask the model to map one question onto the vocabulary. Never throws.
 * @param query  already normalised (src/lib/ask-parse.js normalizeAskQuery)
 * @param deps   test seam: a stand-in for the SDK's `messages.create`, and the timeout
 */
export async function askWithModel(
  query: string,
  deps: { create?: (body: any, opts: any) => Promise<any>; timeoutMs?: number } = {},
): Promise<AskModelResult> {
  const modelId = askModelId();
  const request = { model: modelId, ...buildAskRequest(query) };
  const started = Date.now();
  const base = { modelId, inputTokens: null, outputTokens: null, stopReason: null, raw: null } as const;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), deps.timeoutMs ?? ASK_MODEL_TIMEOUT_MS);
  try {
    const create = deps.create ?? ((body: any, opts: any) => getClient().messages.create(body, opts));
    const message = await create(request, { signal: abort.signal });
    const usage = message?.usage ?? null;
    const read = readAskResponse(message);
    const priced = {
      inputTokens: Number.isFinite(Number(usage?.input_tokens)) ? Number(usage.input_tokens) : null,
      outputTokens: Number.isFinite(Number(usage?.output_tokens)) ? Number(usage.output_tokens) : null,
      costUsd: usage ? askCostUsd(usage) : askWorstCaseCostUsd(request),
      stopReason: message?.stop_reason ?? null,
      elapsedMs: Date.now() - started,
    };
    if (!read.ok) return { ...base, ...priced, result: null, unsupported: false, failure: read.reason };
    const checked = validateAskResult(read.json);
    return {
      ...base,
      ...priced,
      raw: read.json,
      result: checked.ok ? checked.result : null,
      unsupported: !checked.ok,
      failure: null,
    };
  } catch (e: any) {
    const { reason, maybeBilled } = classifyModelError(e);
    console.warn(`ask model call failed (${reason}):`, String(e?.message || e).slice(0, 300));
    return {
      ...base,
      result: null,
      unsupported: false,
      failure: reason,
      costUsd: maybeBilled ? askWorstCaseCostUsd(request) : 0,
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}
