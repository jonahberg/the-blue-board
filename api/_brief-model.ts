// The brief's one model call, through the Vercel AI Gateway exactly as api/delay-explain.ts does it:
// the Anthropic SDK pointed at the gateway's Anthropic-compatible endpoint, Bearer-only auth with
// AI_GATEWAY_API_KEY, AI_GATEWAY_BASE_URL as the override host. Only the client construction is
// shared; the request itself (src/lib/brief-prompt.js) is written for Haiku 5.5:
//   - thinking is on by default there, so the JSON is found by block type, not content[0];
//   - stop_reason is checked (refusal, max_tokens) before anything is parsed;
//   - no temperature (non-default sampling is a 400 on Haiku 5.5); effort is set explicitly;
//   - maxRetries: 0 plus our own abort timer, so SDK retries cannot multiply spend or outlive the
//     cron's maxDuration. The next cron run is the retry.
//
// No Supabase import here: scripts/brief-eval.mjs imports this file to send the production request.

import Anthropic from '@anthropic-ai/sdk';
import { BRIEF_DEFAULT_MODEL_ID, briefCostUsd, briefWorstCaseCostUsd, buildBriefRequest, readBriefResponse } from '../src/lib/brief-prompt.js';

/** Long enough for BRIEF_MAX_TOKENS at the speed measured in production (about 165 tokens a second). */
export const BRIEF_MODEL_TIMEOUT_MS = 45_000;

/** The model id actually sent: BRIEF_MODEL_ID, else the gateway catalog id. */
export function briefModelId(): string {
  const configured = String(process.env.BRIEF_MODEL_ID ?? '').trim();
  return configured || BRIEF_DEFAULT_MODEL_ID;
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

export function __resetBriefModelForTests(): void {
  client = null;
}

export type BriefModelResult = {
  /** The parsed JSON, when the call succeeded and returned parseable text. */
  json: unknown | null;
  /** Why there is no JSON (a template reason), or null. */
  failure: string | null;
  detail: string | null;
  modelId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  /** What to book against the spend cap: actual usage, or a worst-case estimate when a call may have been billed without telling us. */
  costUsd: number;
  stopReason: string | null;
  elapsedMs: number;
};

/**
 * Classify a thrown SDK/gateway error into a template reason and whether it may have been billed.
 * A 4xx is a refusal before any work (not billed); a timeout or dropped connection may have been.
 */
export function classifyModelError(e: any): { reason: string; maybeBilled: boolean } {
  const status = Number(e?.status);
  if (e?.name === 'AbortError' || /abort|timed? ?out/i.test(String(e?.message || ''))) return { reason: 'model_timeout', maybeBilled: true };
  if (status === 402) return { reason: 'gateway_budget', maybeBilled: false };
  if (status === 401 || status === 403) return { reason: 'gateway_forbidden', maybeBilled: false };
  if (status === 429) return { reason: 'model_rate_limited', maybeBilled: false };
  if (status >= 400 && status < 500) return { reason: 'model_rejected', maybeBilled: false };
  if (status >= 500) return { reason: 'model_error', maybeBilled: false };
  // No status: a network failure somewhere between us and the provider. It may have run.
  return { reason: 'model_error', maybeBilled: true };
}

/**
 * Ask the model for a brief. Never throws.
 * @param facts  the facts, as built by src/lib/brief-facts.js
 * @param nowMs  the clock the facts were built at
 * @param deps   test seam: a stand-in for the SDK's `messages.create`
 */
export async function generateBriefWithModel(
  facts: any[],
  nowMs: number,
  deps: { create?: (body: any, opts: any) => Promise<any>; timeoutMs?: number } = {},
): Promise<BriefModelResult> {
  const modelId = briefModelId();
  const request = { model: modelId, ...buildBriefRequest(facts, nowMs) };
  const started = Date.now();
  const base = { modelId, inputTokens: null, outputTokens: null, stopReason: null, detail: null } as const;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), deps.timeoutMs ?? BRIEF_MODEL_TIMEOUT_MS);
  try {
    const create = deps.create ?? ((body: any, opts: any) => getClient().messages.create(body, opts));
    const message = await create(request, { signal: abort.signal });
    const usage = message?.usage ?? null;
    const read = readBriefResponse(message);
    return {
      ...base,
      json: read.ok ? read.json : null,
      failure: read.ok ? null : read.reason,
      detail: read.ok ? null : (read.detail ?? null),
      inputTokens: Number.isFinite(Number(usage?.input_tokens)) ? Number(usage.input_tokens) : null,
      outputTokens: Number.isFinite(Number(usage?.output_tokens)) ? Number(usage.output_tokens) : null,
      // A response with no usage was still produced by a model: book the worst case.
      costUsd: usage ? briefCostUsd(usage) : briefWorstCaseCostUsd(request),
      stopReason: message?.stop_reason ?? null,
      elapsedMs: Date.now() - started,
    };
  } catch (e: any) {
    const { reason, maybeBilled } = classifyModelError(e);
    console.warn(`brief model call failed (${reason}):`, String(e?.message || e).slice(0, 300));
    return {
      ...base,
      json: null,
      failure: reason,
      detail: String(e?.message || e).slice(0, 200),
      costUsd: maybeBilled ? briefWorstCaseCostUsd(request) : 0,
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}
