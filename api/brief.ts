// The ops brief — "Right now" at the top of the Live tab.
// GET /api/brief
//
// → 200 {
//     brief: { headline, tone: 'calm'|'watch'|'disrupted', items: [{ text, fact_ids }],
//              traveler_note: { text, fact_ids } | null, source: 'model'|'template' } | null,
//     facts: [{ id, kind, hub?, statement, values, at, link }]   ← only the facts the brief cites
//     factCount,      how many live facts the brief was written from ("Written from 11 live facts")
//     generatedAt,    when this brief was written
//     checkedAt,      when a cron run last confirmed its facts were unchanged
//     nextUpdateAt,   the next scheduled check (the cron runs every 10 minutes)
//     stale,          true when checkedAt is more than 30 minutes ago (or there is no brief)
//     verified: { itemsIn, itemsKept } | null,
//     note?           present when there is no brief to show
//   }
//
// Public and identical for every visitor → CDN-cached (s-maxage=60 + SWR). It never 5xxes:
// unconfigured Supabase, sql/022 not applied, no brief yet or a failing read all answer 200 with
// `brief: null` and a note, cached for only 30 s.

import type { VercelRequest, VercelResponse } from './_types.js';
import { createRateLimiter } from './_rate-limit.js';
import { loadLatestBrief, type BriefRow } from './_brief-store.js';
import { publicFact } from '../src/lib/brief-facts.js';
import { citedFactIds } from '../src/lib/brief-verify.js';

const isRateLimited = createRateLimiter('brief', 60);

export const BRIEF_STALE_AFTER_MS = 30 * 60 * 1000;
const CRON_INTERVAL_MS = 10 * 60 * 1000;
const MEMO_TTL_MS = 30_000;

export const NO_BRIEF_NOTE = 'No brief yet.';
export const UNAVAILABLE_NOTE = 'The brief is unavailable right now.';

let memo: { at: number; row: BriefRow | null } | null = null;

export function __resetBriefEndpointForTests(): void {
  memo = null;
}

/** The next 10-minute cron boundary strictly after `nowMs`. */
export function nextCronRunMs(nowMs: number): number {
  return (Math.floor(nowMs / CRON_INTERVAL_MS) + 1) * CRON_INTERVAL_MS;
}

/** The public body for a stored brief row (or for none). Pure, exported for tests. */
export function briefResponseBody(row: BriefRow | null, nowMs: number, note?: string) {
  if (!row) {
    return {
      brief: null, facts: [], factCount: 0, generatedAt: null, checkedAt: null,
      nextUpdateAt: new Date(nextCronRunMs(nowMs)).toISOString(), stale: true, verified: null,
      note: note || NO_BRIEF_NOTE,
    };
  }
  const facts = Array.isArray(row.facts) ? row.facts : [];
  const cited = new Set(citedFactIds(row));
  const checkedMs = Date.parse(row.checked_at || row.generated_at);
  const verifier = (row.verifier || {}) as Record<string, unknown>;
  return {
    brief: {
      headline: row.headline,
      tone: row.tone,
      items: row.items,
      traveler_note: row.traveler_note ?? null,
      source: row.source,
    },
    facts: facts.filter((f) => cited.has(f?.id)).map(publicFact),
    factCount: facts.length,
    generatedAt: row.generated_at,
    checkedAt: row.checked_at || row.generated_at,
    nextUpdateAt: new Date(nextCronRunMs(nowMs)).toISOString(),
    stale: !Number.isFinite(checkedMs) || nowMs - checkedMs > BRIEF_STALE_AFTER_MS,
    verified: row.source === 'model'
      ? { itemsIn: Number(verifier.itemsIn ?? row.items.length), itemsKept: row.items.length }
      : null,
  };
}

const COLUMNS = 'id, generated_at, checked_at, source, template_reason, tone, headline, items, traveler_note, headline_fact_ids, facts, verifier';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const origin = req.headers?.origin || '';
  if (origin && origin !== 'https://theblueboard.co' && !/^http:\/\/localhost(:\d+)?$/.test(String(origin))) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(403).json({ error: 'Forbidden' });
  }

  if (isRateLimited(req)) {
    // Never let a 429 into the shared CDN cache.
    res.setHeader('Cache-Control', 'no-store');
    return res.status(429).json({ error: 'Rate limited — try again shortly' });
  }

  const now = Date.now();
  if (memo && now - memo.at < MEMO_TTL_MS) {
    res.setHeader('Cache-Control', memo.row ? 'public, s-maxage=60, stale-while-revalidate=300' : 'public, s-maxage=30');
    return res.status(200).json(briefResponseBody(memo.row, now));
  }

  const latest = await loadLatestBrief<BriefRow>(COLUMNS);
  if (!latest.ok) {
    res.setHeader('Cache-Control', 'public, s-maxage=30');
    return res.status(200).json(briefResponseBody(null, now, UNAVAILABLE_NOTE));
  }
  memo = { at: now, row: latest.value };
  res.setHeader('Cache-Control', latest.value ? 'public, s-maxage=60, stale-while-revalidate=300' : 'public, s-maxage=30');
  return res.status(200).json(briefResponseBody(latest.value, now));
}
