import Anthropic from '@anthropic-ai/sdk';
import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';
import { CacheStore } from './_cache.js';

const isRateLimited = createRateLimiter('delay-explain', 20);

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    // Route through Vercel AI Gateway's Anthropic-compatible endpoint so spend
    // lands in the shared AI Gateway dashboard (unified with Plaincast) at zero
    // markup. The @anthropic-ai/sdk speaks the gateway's /v1/messages contract
    // 1:1, so the call below is unchanged; auth is the gateway key sent as a
    // Bearer token (authToken), not Anthropic's x-api-key. Override the host
    // with AI_GATEWAY_BASE_URL if needed (e.g. to fall back to Anthropic-direct).
    client = new Anthropic({
      baseURL: process.env.AI_GATEWAY_BASE_URL || 'https://ai-gateway.vercel.sh',
      // apiKey: null suppresses @anthropic-ai/sdk's default ANTHROPIC_API_KEY env
      // read. Without it the SDK sends BOTH x-api-key (the old, now-unused
      // Anthropic key still in Vercel env for rollback) AND Authorization: Bearer
      // (the gateway key) on every request. Bearer-only is what the gateway wants.
      apiKey: null,
      authToken: process.env.AI_GATEWAY_API_KEY,
    });
  }
  return client;
}

const cache = new CacheStore<string>('delay-explain', { maxSize: 200, defaultTTL: 5 * 60 * 1000 });

// Calm, non-alarming copy the modal renders as plain text (frontend shows `explanation` verbatim
// in the normal `.delay-explain-text` style on a 200; only non-2xx shows the ⚠️ error styling).
// The risk score + contributing factors stay visible regardless, so this degrades gracefully.
const AI_UNAVAILABLE_MSG =
  'AI delay analysis is temporarily unavailable. The risk score and contributing factors shown above still reflect current conditions.';

// Circuit breaker for billing/credit outages. When Anthropic rejects with a credit/billing 400 it
// bills no tokens, but without this every "Explain Delay Risk" click would re-hit the API and log a
// fresh 5xx — a daily error-feed flood for zero benefit. One billing error opens the circuit for a
// cooldown; while open we short-circuit to the graceful 200 without calling Anthropic. Per-instance
// (matches the rest of this codebase's serverless state model); a cold instance simply tries once.
const AI_UNAVAILABLE_COOLDOWN_MS = 5 * 60 * 1000;
let aiUnavailableUntil = 0;

// One place to open the circuit, so the three ACCOUNT-level failure modes that share it (gateway 402
// budget ceiling, gateway 403 tier/permission loss, Anthropic billing-400) cannot drift apart in
// cooldown length or in what they log. `reason` is the only thing that varies.
function openAiCircuit(reason: string): void {
  aiUnavailableUntil = Date.now() + AI_UNAVAILABLE_COOLDOWN_MS;
  console.warn(`Delay explain: ${reason} — AI-unavailable circuit open ${AI_UNAVAILABLE_COOLDOWN_MS / 1000}s`);
}

/**
 * Test helper: close the AI-unavailable circuit and drop the explanation cache so module state does
 * not leak between tests (repo convention: __resetRateLimitersForTests, __resetFeedStateForTests).
 * Without this seam, tests that trip the circuit had to be ordered last or re-import the module.
 * Production never calls it.
 */
export function __resetDelayExplainForTests(): void {
  aiUnavailableUntil = 0;
  cache.clear();
}

// Per-request input spend cap. Output is already bounded by max_tokens: 400; this bounds input so a
// crafted-but-origin-valid POST can't inflate prompt tokens. Each field is already truncated by
// sanitize(); this is a belt-and-suspenders ceiling on the assembled prompt.
const MAX_PROMPT_CHARS = 2400;

interface DelayContext {
  flight: string;
  route?: string;
  status?: string;
  riskLabel?: string;
  riskScore?: number;
  factors?: string[];
  otp?: string;
  weather?: string;
  destWeather?: string;
  faaStatus?: string;
  inbound?: string;
  hub?: string;
  irops?: string;
  hubTime?: string;
  connection?: string;
}

// Sanitize context fields: truncate to max length, strip instruction-like patterns
function sanitize(val: string | undefined, maxLen: number): string {
  if (!val || typeof val !== 'string') return '';
  return val.slice(0, maxLen).replace(/(\bignore\b.*\binstructions?\b|\bsystem\b.*\bprompt\b|\bforget\b.*\babove\b|\bact as\b|\byou are now\b)/gi, '[filtered]');
}

function getCacheKey(ctx: DelayContext): string {
  // Slice each field to the SAME length the prompt uses below (inbound/faaStatus 300, weather 200),
  // not shorter — a key truncated ahead of the prompt lets two contexts that share the truncated
  // prefix but diverge later collide, serving one flight's cached explanation to another (the F009
  // wrong-explanation class the connection key already guards against).
  const inboundKey = ctx.inbound ? ctx.inbound.slice(0, 300) : '';
  const weatherKey = (ctx.weather || '').slice(0, 200) + '|' + (ctx.destWeather || '').slice(0, 200);
  const faaKey = (ctx.faaStatus || '').slice(0, 300);
  // F009: connection is injected into the prompt (see `Passenger connection:` line below) but
  // was missing from the cache key — two different connections on the same flight/risk profile
  // would collide and serve one passenger's cached explanation to the other. Keep it short;
  // it's already truncated to 100 chars when used in the prompt.
  const connectionKey = (ctx.connection || '').slice(0, 100);
  return `${ctx.flight}:${ctx.route || ''}:${ctx.status || ''}:${ctx.riskScore}:${(ctx.factors || []).join(',')}:${ctx.otp || ''}:${ctx.hub || ''}:${ctx.irops || ''}:${inboundKey}:${weatherKey}:${faaKey}:${connectionKey}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin = req.headers?.origin || '';
  const referer = req.headers?.referer || '';
  // Require a valid origin or referer — blocks direct curl/non-browser abuse
  const isAllowedOrigin = origin === 'https://theblueboard.co' || /^http:\/\/localhost(:\d+)?$/.test(origin);
  const isAllowedReferer = referer.startsWith('https://theblueboard.co/') || /^http:\/\/localhost(:\d+)?\//.test(referer);
  if (!isAllowedOrigin && !isAllowedReferer) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (isRateLimited(req)) {
    return res.status(429).json({ error: 'Rate limited — try again shortly' });
  }

  if (!process.env.AI_GATEWAY_API_KEY) {
    return res.status(503).json({ error: 'AI analysis unavailable — no API key configured' });
  }

  try {
    const ctx: DelayContext = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!ctx || !ctx.flight) {
      return res.status(400).json({ error: 'Missing flight context' });
    }

    // Check cache
    const key = getCacheKey(ctx);
    const cached = cache.get(key);
    if (cached) {
      return res.status(200).json({ explanation: cached, cached: true });
    }

    // Billing circuit open: serve the graceful message without calling Anthropic.
    if (Date.now() < aiUnavailableUntil) {
      return res.status(200).json({ explanation: AI_UNAVAILABLE_MSG, unavailable: true });
    }

    // Build context prompt with aircraft journey chain
    // All fields sanitized to mitigate prompt injection via crafted POST bodies
    const flight = sanitize(ctx.flight, 20);
    const route = sanitize(ctx.route, 20);
    const status = sanitize(ctx.status, 30);
    const riskLabel = sanitize(ctx.riskLabel, 20);
    // F011: defense in depth — coerce a numeric string (e.g. a client that skipped its own
    // Number() conversion) before the typeof gate, instead of silently zeroing a real score.
    const riskScoreNum = typeof ctx.riskScore === 'number' ? ctx.riskScore : Number(ctx.riskScore);
    const riskScore = Number.isFinite(riskScoreNum) ? Math.max(0, Math.min(100, riskScoreNum)) : 0;

    const lines = [
      `Flight: ${flight} (${route || 'unknown route'})`,
      `Status: ${status || 'scheduled'}`,
      `Risk Level: ${riskLabel || 'LOW'} (score ${riskScore}/100)`,
    ];
    if (ctx.factors && Array.isArray(ctx.factors)) {
      lines.push(`Contributing factors: ${ctx.factors.map(f => sanitize(f, 80)).join('; ')}`);
    }
    if (ctx.otp) lines.push(`Hub on-time performance: ${sanitize(ctx.otp, 10)}%`);
    if (ctx.faaStatus) lines.push(`FAA status: ${sanitize(ctx.faaStatus, 300)}`);
    if (ctx.weather) lines.push(`Origin weather: ${sanitize(ctx.weather, 200)}`);
    if (ctx.destWeather) lines.push(`Destination weather: ${sanitize(ctx.destWeather, 200)}`);
    if (ctx.irops) lines.push(`Hub disruption status: ${sanitize(ctx.irops, 200)}`);
    if (ctx.hubTime) lines.push(`Current local time at hub: ${sanitize(ctx.hubTime, 30)}`);
    if (ctx.connection) lines.push(`Passenger connection: ${sanitize(ctx.connection, 100)}`);
    if (ctx.inbound) lines.push(`Aircraft journey: ${sanitize(ctx.inbound, 300)}`);

    // vercel.json caps this function at maxDuration: 15. Without a signal the
    // SDK call would keep running past the Lambda kill, Anthropic keeps
    // billing tokens, and the user sees a generic 5xx. 12s leaves a 3s
    // budget for handler teardown and response formatting.
    // Per-request input ceiling (see MAX_PROMPT_CHARS): sanitize() already truncates each field;
    // this bounds the assembled total so prompt-token spend per call can't be inflated.
    const userPrompt = lines.join('\n').slice(0, MAX_PROMPT_CHARS);

    const anthropicAbort = new AbortController();
    const anthropicTimer = setTimeout(() => anthropicAbort.abort(), 12_000);

    let message;
    try {
      message = await getClient().messages.create(
        {
          model: 'claude-haiku-4-5',
          max_tokens: 400,
      system: `You are a senior flight operations analyst briefing for The Blue Board, a third-party United Airlines flight tracker. You are NOT United Airlines — never say "we" or "our" when referring to the airline.

CRITICAL RULE: You may ONLY discuss data that is explicitly provided in the user message below. Do NOT invent, assume, or speculate about information that is not present. Specifically:
- If no "Aircraft journey" line is provided, do NOT discuss inbound aircraft, turnaround times, rotations, or crew legality.
- If no "FAA status" line is provided, do NOT discuss FAA programs, ATC flow restrictions, or stated causes like weather/thunderstorms.
- If no "Origin weather" or "Destination weather" line is provided, do NOT discuss weather conditions, de-icing, thunderstorms, or visibility.
- If no "Hub disruption status" line is provided, do NOT discuss cancellation rates or IROPS.
- If no "Hub on-time performance" line is provided, do NOT cite OTP percentages.
- If no "Passenger connection" line is provided, do NOT discuss connections.
Never fabricate operational details. If the data is sparse, give a shorter analysis based only on what you can see.

Analysis framework — discuss ONLY topics where data is provided:
1. AIRCRAFT ROUTING (only if "Aircraft journey" data is present): Explain delay propagation across segments. If turnaround time is tight, state the specific math. Note de-icing impact if freezing conditions are mentioned.
2. FAA STATUS (only if "FAA status" data is present): Explain the airport program or delay status and its stated cause. If the FAA status says delays are due to weather or thunderstorms, treat that as authoritative network-level weather constraint.
3. WEATHER (only if weather data is present): Distinguish between departure weather (taxi, de-icing, takeoff) and arrival weather (holds, diversions). If FAA status cites weather but the METAR looks normal, say the operational impact is likely broader airspace/weather flow control rather than field conditions alone. SFO LIFR = single-stream runway ops (~50% capacity). EWR LIFR = crossing runway restrictions.
4. NETWORK HEALTH (only if OTP or disruption data is present): Explain what low OTP or high cancellation rates mean for this flight.
5. TIME-OF-DAY: You may always comment on time-of-day cascade effects if the hub time is provided, since this is general knowledge.
6. DELAY MAGNITUDE: If a large delay is already reported, explain what a delay of that size typically means operationally — but stick to general implications, not invented specifics about this aircraft's history.

For LOW-risk flights with clean conditions, say so positively and briefly.

Deliver 2-4 sentences of direct, specific analysis grounded in the provided data. Write in plain text only — no markdown, no headers, no bold, no bullet points.`,
          messages: [{ role: 'user', content: userPrompt }],
        },
        { signal: anthropicAbort.signal }
      );
    } finally {
      clearTimeout(anthropicTimer);
    }

    const text = message.content[0]?.type === 'text' ? message.content[0].text : 'Unable to generate analysis.';

    // Cache the result
    cache.set(key, text);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ explanation: text, cached: false });
  } catch (e: any) {
    console.error('Delay explain API error:', e);
    if (e.name === 'AbortError' || e.message?.includes('aborted')) {
      return res.status(504).json({ error: 'AI analysis timed out' });
    }
    if (e.status === 401) return res.status(503).json({ error: 'Invalid API key' });
    if (e.status === 429) return res.status(429).json({ error: 'AI rate limited — try again shortly' });
    // Vercel AI Gateway returns 402 (Payment Required) when its budget/credit ceiling is hit — the
    // gateway analog of Anthropic's billing-400 below. Trip the same circuit so we stop hammering it
    // and serve the calm 200 the modal renders as plain text.
    if (e.status === 402) {
      openAiCircuit('AI Gateway budget/credit error (402)');
      return res.status(200).json({ explanation: AI_UNAVAILABLE_MSG, unavailable: true });
    }
    // The gateway rejects with 403 PermissionDenied when the ACCOUNT tier loses access to the
    // model — observed Jul 28–Aug 2 2026 as "Free tier users do not have access to …" after the
    // gateway's credits dipped to free tier. Without special handling that fell to the generic 502
    // and every click re-hit the gateway for the whole outage window. (The handler's own
    // origin-check 403 is a plain return before the try, so a THROWN 403 here is always from the
    // gateway/SDK call.)
    //
    // Every 403 still gets the graceful 200 — it is never retryable for this request — but only an
    // ACCOUNT-level one opens the SHARED circuit, mirroring the billing-400 branch below. A
    // request-specific gateway 403 (a rejected model route, a per-request policy denial) must not
    // disable "Explain Delay Risk" for every visitor for the next five minutes.
    //
    // The matcher is deliberately narrow on WHOLE phrases: bare `tier`/`plan`/`account` are
    // substrings of 'frontier', 'plane'/'flight plan' and 'accounted', all flight-context words that
    // can echo back inside an upstream error message and open a shared five-minute circuit on a
    // request-specific rejection. `permission` stays in with eyes open — an Anthropic-shaped 403 body
    // carries "type":"permission_error", so a per-request policy denial can match it — because in
    // this stack gateway 403s are near-always account-level, the cost of a false positive is one
    // self-healing 5-minute window of the calm 200, and the cost of a false NEGATIVE is missing the
    // real outage signature and re-hitting the gateway on every click for hours (Jul 28–Aug 2).
    if (e.status === 403) {
      const msg = String(e?.error?.error?.message || e?.message || '').toLowerCase();
      const isAccountLevel = /free tier|do not have access|permission/i.test(msg);
      if (isAccountLevel) openAiCircuit('AI Gateway permission error (403)');
      return res.status(200).json({ explanation: AI_UNAVAILABLE_MSG, unavailable: true });
    }
    // Anthropic rejects a credit/billing problem as a 400 (no tokens billed). Don't surface it as a
    // 5xx on every click: trip the circuit so we stop calling the API, and return a calm 200 the
    // modal renders as plain text. Other client 400s (malformed request) are also non-retryable, so
    // serve the same graceful message rather than a 502 error-feed entry — but don't open the
    // circuit for those, since they're request-specific, not an account-wide outage.
    if (e.status === 400) {
      const msg = String(e?.error?.error?.message || e?.message || '').toLowerCase();
      const isBilling = /credit balance|too low|billing|payment|insufficient|quota|upgrade|plan/.test(msg);
      if (isBilling) openAiCircuit('Anthropic billing/credit error');
      return res.status(200).json({ explanation: AI_UNAVAILABLE_MSG, unavailable: true });
    }
    return res.status(502).json({ error: 'AI analysis temporarily unavailable' });
  }
}
