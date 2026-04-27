import Anthropic from '@anthropic-ai/sdk';
import type { VercelRequest, VercelResponse } from './types.js';
import { createRateLimiter } from './_rate-limit.js';
import { CacheStore } from './_cache.js';
import { createDailyCounter } from './_daily-counter.js';
import { getProSession } from './_auth.js';

const isRateLimited = createRateLimiter('delay-explain', 20);
const FREE_DAILY_LIMIT = 3;
const dailyCounter = createDailyCounter('delay-explain-daily');

function getClientIp(req: VercelRequest): string {
  const realIp = req.headers?.['x-real-ip'];
  if (realIp) return Array.isArray(realIp) ? realIp[0] : realIp;
  const xff = req.headers?.['x-forwarded-for'];
  const raw = Array.isArray(xff) ? xff[0] : (typeof xff === 'string' ? xff : '');
  return raw.split(',')[0]?.trim() || 'unknown';
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

const cache = new CacheStore<string>('delay-explain', { maxSize: 200, defaultTTL: 5 * 60 * 1000 });

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
  const inboundKey = ctx.inbound ? ctx.inbound.slice(0, 100) : '';
  const weatherKey = (ctx.weather || '').slice(0, 40) + '|' + (ctx.destWeather || '').slice(0, 40);
  const faaKey = (ctx.faaStatus || '').slice(0, 120);
  return `${ctx.flight}:${ctx.route || ''}:${ctx.status || ''}:${ctx.riskScore}:${(ctx.factors || []).join(',')}:${ctx.otp || ''}:${ctx.hub || ''}:${ctx.irops || ''}:${inboundKey}:${weatherKey}:${faaKey}`;
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

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'AI analysis unavailable — no API key configured' });
  }

  // Check Pro status (silently — no auth header is fine, just means free tier).
  // Pro session bypasses the daily cap; cache hits also don't burn quota
  // (handled below — counter only increments on a genuine Anthropic call).
  let isPro = false;
  if (req.headers?.authorization) {
    try {
      const session = await getProSession(req as any);
      if (session?.pro) isPro = true;
    } catch (_) {
      // Silently fall through to free tier
    }
  }

  try {
    const ctx: DelayContext = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!ctx || !ctx.flight) {
      return res.status(400).json({ error: 'Missing flight context' });
    }

    // Check cache (cached responses don't burn the daily quota)
    const key = getCacheKey(ctx);
    const cached = cache.get(key);
    if (cached) {
      return res.status(200).json({ explanation: cached, cached: true });
    }

    // Free-tier daily cap (Pro bypasses entirely).
    if (!isPro) {
      const ip = getClientIp(req);
      if (dailyCounter.isOverLimit(ip, FREE_DAILY_LIMIT)) {
        return res.status(429).json({
          error: `Free tier limited to ${FREE_DAILY_LIMIT} AI explanations per day. Upgrade to Pro for unlimited.`,
          upgrade_url: '/pro',
          limit: FREE_DAILY_LIMIT,
        });
      }
    }

    // Build context prompt with aircraft journey chain
    // All fields sanitized to mitigate prompt injection via crafted POST bodies
    const flight = sanitize(ctx.flight, 20);
    const route = sanitize(ctx.route, 20);
    const status = sanitize(ctx.status, 30);
    const riskLabel = sanitize(ctx.riskLabel, 20);
    const riskScore = typeof ctx.riskScore === 'number' ? Math.max(0, Math.min(100, ctx.riskScore)) : 0;

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
          messages: [{ role: 'user', content: lines.join('\n') }],
        },
        { signal: anthropicAbort.signal }
      );
    } finally {
      clearTimeout(anthropicTimer);
    }

    const text = message.content[0]?.type === 'text' ? message.content[0].text : 'Unable to generate analysis.';

    // Cache the result
    cache.set(key, text);

    // Burn 1 from the daily quota only after a successful Anthropic call.
    // Cached responses (handled above) and errors do not count.
    if (!isPro) {
      const ip = getClientIp(req);
      dailyCounter.increment(ip);
    }

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ explanation: text, cached: false });
  } catch (e: any) {
    console.error('Delay explain API error:', e);
    if (e.name === 'AbortError' || e.message?.includes('aborted')) {
      return res.status(504).json({ error: 'AI analysis timed out' });
    }
    if (e.status === 401) return res.status(503).json({ error: 'Invalid API key' });
    if (e.status === 429) return res.status(429).json({ error: 'AI rate limited — try again shortly' });
    return res.status(502).json({ error: 'AI analysis temporarily unavailable' });
  }
}
