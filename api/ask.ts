// POST /api/ask — "Ask the board". Maps a plain question typed into ⌘K onto the dashboard's own
// filters (src/lib/ask-vocabulary.js). The answer is never prose: it is a view plus a few validated
// filters, and the browser re-validates it before applying anything.
//
// Order of work, cheapest first:
//   1. origin check (the other POST endpoints' rule), per-IP rate limit (6 a minute), body check;
//   2. the rules parser (src/lib/ask-parse.js) — the browser ran it already, but a client that skips
//      it must not be able to spend the model budget on a question the rules can answer;
//   3. a 10-minute in-memory cache of normalised questions, answered or unsupported;
//   4. the kill switch, the key, and ask's own daily spend cap (feature_spend_daily, feature `ask`),
//      which fails CLOSED when the counter cannot be read;
//   5. Claude Haiku 5.5 through the AI Gateway (api/_ask-model.ts), cost booked against the cap.
//
// It never answers 5xx: a capped, switched-off or failed model is a calm 200 the palette words as
// "I can only do simple searches right now".
//
// SWITCHES (off-words: 0 / off / false / no):
//   ASK_MODEL=off          no model calls; the rules still answer.
//   ASK_DAILY_USD_CAP      ask's own daily ceiling in USD (default 0.50; an explicit 0 = no model calls).
//   ASK_MODEL_ID           overrides the gateway model id (default anthropic/claude-haiku-5.5).

import type { VercelRequest, VercelResponse } from './_types.js';
import { createRateLimiter } from './_rate-limit.js';
import { CacheStore } from './_cache.js';
import { getFeatureSpendForDay, readUsdCap, recordFeatureSpend, utcDay } from './_feature-spend.js';
import { askWithModel, type AskModelResult } from './_ask-model.js';
import { askCacheKey, normalizeAskQuery, parseAsk } from '../src/lib/ask-parse.js';
import { askWorstCaseCostUsd, buildAskRequest } from '../src/lib/ask-prompt.js';

export const ASK_FEATURE = 'ask';
export const ASK_DEFAULT_DAILY_CAP_USD = 0.5;
export const ASK_RATE_LIMIT_PER_MINUTE = 6;
export const ASK_CACHE_TTL_MS = 10 * 60 * 1000;

/** What the palette shows when the model cannot be asked. The browser keeps its own copy. */
export const ASK_SIMPLE_ONLY_MESSAGE = 'I can only do simple searches right now.';

const isRateLimited = createRateLimiter('ask', ASK_RATE_LIMIT_PER_MINUTE);

type AskAnswer =
  | { ok: true; source: 'rules' | 'model'; result: { view: string; filters: Record<string, unknown> }; cached?: boolean }
  | { ok: true; source: 'unsupported'; cached?: boolean }
  | { ok: false; reason: string; message: string };

const cache = new CacheStore<AskAnswer>('ask', { maxSize: 500, defaultTTL: ASK_CACHE_TTL_MS });

/** Test seam: the model call. */
let generate: (query: string) => Promise<AskModelResult> = (query) => askWithModel(query);

export function __setAskModelForTests(fn: ((query: string) => Promise<AskModelResult>) | null): void {
  generate = fn ?? ((query) => askWithModel(query));
}

export function __resetAskForTests(): void {
  cache.clear();
  generate = (query) => askWithModel(query);
}

function switchOff(name: string): boolean {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  return v === '0' || v === 'off' || v === 'false' || v === 'no';
}

export function askModelEnabled(): boolean { return !switchOff('ASK_MODEL'); }
export function askDailyCapUsd(): number { return readUsdCap('ASK_DAILY_USD_CAP', ASK_DEFAULT_DAILY_CAP_USD); }

function isAllowedOrigin(origin: string, referer: string): boolean {
  // The rule api/delay-explain.ts applies to its POST: the site, or localhost in development.
  const okOrigin = origin === 'https://theblueboard.co' || /^http:\/\/localhost(:\d+)?$/.test(origin);
  const okReferer = referer.startsWith('https://theblueboard.co/') || /^http:\/\/localhost(:\d+)?\//.test(referer);
  return okOrigin || okReferer;
}

function simpleOnly(reason: string): AskAnswer {
  return { ok: false, reason, message: ASK_SIMPLE_ONLY_MESSAGE };
}

/** Why the model may not be asked right now, or null when it may. */
async function modelBlock(query: string, nowMs: number): Promise<string | null> {
  if (!askModelEnabled()) return 'disabled';
  if (!process.env.AI_GATEWAY_API_KEY) return 'unconfigured';
  const cap = askDailyCapUsd();
  if (cap <= 0) return 'cap';
  const spent = await getFeatureSpendForDay(ASK_FEATURE, utcDay(nowMs));
  // Fail closed: a counter we cannot read is a counter that might be over.
  if (!spent.ok) return 'cap';
  // Leave headroom for this call's worst case, so the cap is a ceiling and not a target.
  if (spent.usd + askWorstCaseCostUsd(buildAskRequest(query)) > cap) return 'cap';
  return null;
}

/** The whole decision for one question, without HTTP. Never throws. */
export async function answerAsk(rawQuery: unknown, nowMs: number = Date.now()): Promise<AskAnswer> {
  const query = normalizeAskQuery(rawQuery);
  if (!query) return simpleOnly('empty');

  const rules = parseAsk(query);
  if (rules.confident) return { ok: true, source: 'rules', result: rules.result };

  const key = askCacheKey(query);
  const hit = cache.get(key);
  if (hit) return { ...hit, cached: true } as AskAnswer;

  const blocked = await modelBlock(query, nowMs);
  if (blocked) return simpleOnly(blocked);

  const out = await generate(query);
  if (out.costUsd > 0) {
    await recordFeatureSpend(ASK_FEATURE, {
      usd: out.costUsd, calls: 1, inputTokens: out.inputTokens ?? 0, outputTokens: out.outputTokens ?? 0,
    }, utcDay(nowMs));
  }
  // A failed call is never cached: the next visitor may get an answer.
  if (out.failure) return simpleOnly('model_failed');
  const answer: AskAnswer = out.result
    ? { ok: true, source: 'model', result: out.result }
    : { ok: true, source: 'unsupported' };
  cache.set(key, answer);
  return answer;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const origin = String(req.headers?.origin || '');
  const referer = String(req.headers?.referer || '');
  if (!isAllowedOrigin(origin, referer)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (isRateLimited(req)) {
    return res.status(429).json(simpleOnly('rate_limited'));
  }
  try {
    let body: any = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    const q = body && typeof body === 'object' ? body.q : undefined;
    if (typeof q !== 'string' || !q.trim()) {
      return res.status(400).json(simpleOnly('empty'));
    }
    const answer = await answerAsk(q);
    return res.status(200).json(answer);
  } catch (e: any) {
    console.error('ask error:', String(e?.message || e).slice(0, 300));
    return res.status(200).json(simpleOnly('error'));
  }
}
