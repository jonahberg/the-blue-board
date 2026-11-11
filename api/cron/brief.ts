// Vercel Cron Job: the ops brief ("Right now" at the top of the Live tab).
// Config in vercel.json: { "path": "/api/cron/brief", "schedule": "*/10 * * * *" }, maxDuration 90
// (worst case: /api/irops cold 25 s + two radio calls 16 s + the model 20 s + Supabase).
//
// One generation serves every visitor; nothing is generated per request. Each run:
//   1. Collects the facts from what the site already has (api/_brief-collect.ts: the site's own
//      CDN-cached endpoints plus one airborne_samples read — zero new upstream spend).
//   2. Publishes nothing unless BOTH /api/irops and /api/faa answered and at least three hubs carry
//      an on-time reading: a calm brief written without the FAA picture, or without on-time
//      evidence, would be a lie.
//   3. Hashes the material facts (jitter-rounded). Same hash as the latest brief, and that brief is
//      under 60 minutes old → no new brief; the run only stamps `checked_at` so the read endpoint can
//      tell "re-confirmed" from "stale".
//   4. Otherwise asks the model (api/_brief-model.ts), after the brief's own daily spend cap
//      (feature_spend_daily, BRIEF_DAILY_USD_CAP, default $0.50) says it may.
//   5. Verifies the model's brief against the facts (src/lib/brief-verify.js). Invalid JSON, a failed
//      call, the cap, the switch, or no surviving item → the template brief (src/lib/brief-template.js).
//   6. Stores the brief with its facts, hash, tone, source, model, tokens, cost and the verifier's
//      report (ops_briefs), and once an hour deletes briefs older than 90 days in bounded batches.
//
// SWITCHES (off-words: 0 / off / false / no):
//   BRIEF_CRON=off        the whole cron no-ops (200).
//   BRIEF_GENERATION=off  no model calls; template briefs continue.
//   BRIEF_DAILY_USD_CAP   the brief's own daily ceiling in USD (default 0.50; an explicit 0 = no model calls).
//   ENHANCED_RADAR_ENABLED=1  adds air traffic control radio facts for hubs under a ground stop or
//                         ground delay program (api/_radio-status.ts; paid, capped, OFF by default).

import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '../_types.js';
import { isAuthorizedCronRequest } from '../_cron-auth.js';
import { getSupabaseAdmin } from '../_schedule-snapshots.js';
import { collectBriefSources, type CollectedSources } from '../_brief-collect.js';
import { cleanupOldBriefs, insertBrief, loadLatestBrief, touchBriefChecked, type BriefRow, type LatestBriefMeta } from '../_brief-store.js';
import { getFeatureSpendForDay, readUsdCap, recordFeatureSpend, utcDay } from '../_feature-spend.js';
import { generateBriefWithModel, type BriefModelResult } from '../_brief-model.js';
import { BRIEF_MIN_HUB_READINGS, buildBriefFacts, hubReadingCount, materialKey } from '../../src/lib/brief-facts.js';
import { buildTemplateBrief } from '../../src/lib/brief-template.js';
import { verifyBrief } from '../../src/lib/brief-verify.js';
import { briefWorstCaseCostUsd, buildBriefRequest } from '../../src/lib/brief-prompt.js';

export const BRIEF_FEATURE = 'brief';
export const BRIEF_CRON_INTERVAL_MS = 10 * 60 * 1000;
/** A brief whose material facts are unchanged is reused for up to this long. */
export const BRIEF_REUSE_MAX_AGE_MS = 60 * 60 * 1000;
export const BRIEF_DEFAULT_DAILY_CAP_USD = 0.5;
/** Template reasons worth retrying on the next run even when the facts have not changed. */
const TRANSIENT_FAILURES = new Set(['model_error', 'model_timeout', 'model_rate_limited']);

function switchOff(name: string): boolean {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  return v === '0' || v === 'off' || v === 'false' || v === 'no';
}

export function briefCronEnabled(): boolean { return !switchOff('BRIEF_CRON'); }
export function briefGenerationEnabled(): boolean { return !switchOff('BRIEF_GENERATION'); }
export function briefDailyCapUsd(): number { return readUsdCap('BRIEF_DAILY_USD_CAP', BRIEF_DEFAULT_DAILY_CAP_USD); }

export function factsHash(facts: any[]): string {
  return createHash('sha256').update(materialKey(facts)).digest('hex');
}

export type BriefCronDeps = {
  nowMs?: number;
  collect?: () => Promise<CollectedSources>;
  generate?: (facts: any[], nowMs: number) => Promise<BriefModelResult>;
  /** Extra facts from optional sources; defaults to Enhanced Radar radio when ENHANCED_RADAR_ENABLED=1. */
  extraFacts?: (collected: CollectedSources, facts: any[], nowMs: number) => Promise<{ facts: any[]; report?: unknown }>;
};

/** Enhanced Radar is OFF unless this is exactly "1". Checked here, before the module is even imported. */
export function enhancedRadarSwitchOn(): boolean {
  return process.env.ENHANCED_RADAR_ENABLED === '1';
}

/**
 * Radio facts (api/_radio-status.ts), loaded by dynamic import only when the switch is on: with it
 * off, the paid client's module is never loaded, let alone called.
 */
async function radioExtraFacts(collected: CollectedSources, _facts: any[], nowMs: number): Promise<{ facts: any[]; report?: unknown }> {
  if (!enhancedRadarSwitchOn()) return { facts: [] };
  const { collectRadioFacts } = await import('../_radio-status.js');
  return collectRadioFacts(collected.faa, nowMs);
}

export type BriefCronSummary = Record<string, unknown> & { status: string };

/** Why the model may not be asked this run, or null when it may. */
async function generationBlock(request: ReturnType<typeof buildBriefRequest>, nowMs: number): Promise<string | null> {
  if (!briefGenerationEnabled()) return 'generation_disabled';
  if (!process.env.AI_GATEWAY_API_KEY) return 'no_api_key';
  const cap = briefDailyCapUsd();
  if (cap <= 0) return 'spend_cap';
  const spent = await getFeatureSpendForDay(BRIEF_FEATURE, utcDay(nowMs));
  if (!spent.ok) return 'spend_unreadable';
  // Leave headroom for this call's worst case, so the cap is a ceiling and not a target.
  if (spent.usd + briefWorstCaseCostUsd(request) > cap) return 'spend_cap';
  return null;
}

export async function runBriefCron(deps: BriefCronDeps = {}): Promise<BriefCronSummary> {
  const nowMs = deps.nowMs ?? Date.now();
  if (!briefCronEnabled()) return { status: 'disabled' };

  const supabase = await getSupabaseAdmin();
  if (!supabase) return { status: 'unconfigured', reason: 'supabase not configured' };

  const collected = await (deps.collect ?? (() => collectBriefSources({ nowMs })))();
  if (!collected.irops || !collected.faa) {
    return { status: 'skipped', reason: 'required source missing (irops and faa are both required)', errors: collected.errors };
  }

  let { facts, collection } = buildBriefFacts({ ...collected }, { nowMs });
  // Before anything optional (or paid) runs: no on-time evidence, no brief.
  const readings = hubReadingCount(facts);
  if (readings < BRIEF_MIN_HUB_READINGS) {
    return { status: 'skipped', reason: `${readings} hub on-time reading(s); ${BRIEF_MIN_HUB_READINGS} are needed`, skipped: collection.skipped, errors: collected.errors };
  }
  const extra = await (deps.extraFacts ?? radioExtraFacts)(collected, facts, nowMs).catch((e: any) => {
    console.warn('brief extra facts failed:', e?.message || e);
    return { facts: [] as any[], report: { error: String(e?.message || e).slice(0, 200) } };
  });
  if (extra.facts.length) ({ facts, collection } = buildBriefFacts({ ...collected, extraFacts: extra.facts }, { nowMs }));
  const collectionReport: Record<string, unknown> = { ...collection, errors: collected.errors };
  if (extra.report !== undefined) collectionReport.radio = extra.report;
  const hash = factsHash(facts);

  const latest = await loadLatestBrief<LatestBriefMeta>('id, generated_at, checked_at, facts_hash, source, template_reason');
  if (!latest.ok) return { status: latest.reason === 'table missing' ? 'unconfigured' : 'error', reason: latest.reason };

  const prev = latest.value;
  if (prev && prev.facts_hash === hash) {
    const ageMs = nowMs - Date.parse(prev.generated_at);
    const retryTransient = prev.source === 'template' && TRANSIENT_FAILURES.has(String(prev.template_reason))
      && briefGenerationEnabled() && Boolean(process.env.AI_GATEWAY_API_KEY);
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < BRIEF_REUSE_MAX_AGE_MS && !retryTransient) {
      const touched = typeof prev.id === 'number' ? await touchBriefChecked(prev.id, new Date(nowMs).toISOString()) : false;
      return { status: 'unchanged', briefId: prev.id ?? null, ageMin: Math.round(ageMs / 60000), checkedAtUpdated: touched, factCount: facts.length };
    }
  }

  const request = buildBriefRequest(facts, nowMs);
  let modelResult: BriefModelResult | null = null;
  let verification: ReturnType<typeof verifyBrief> | null = null;
  let templateReason: string | null = await generationBlock(request, nowMs);

  if (!templateReason) {
    modelResult = await (deps.generate ?? generateBriefWithModel)(facts, nowMs);
    if (modelResult.costUsd > 0) {
      await recordFeatureSpend(BRIEF_FEATURE, {
        usd: modelResult.costUsd, calls: 1, inputTokens: modelResult.inputTokens ?? 0, outputTokens: modelResult.outputTokens ?? 0,
      }, utcDay(nowMs));
    }
    if (modelResult.failure) templateReason = modelResult.failure;
    else {
      verification = verifyBrief(modelResult.json, facts);
      if (!verification.ok) templateReason = verification.report.shapeErrors ? 'invalid_shape' : 'no_items_survived';
    }
  }

  const useModel = !templateReason && verification?.ok && verification.brief;
  const brief = useModel ? verification!.brief! : buildTemplateBrief(facts);
  const verifierReport: Record<string, unknown> = verification ? { ...verification.report } : {};
  if (!useModel) {
    verifierReport.fallback = templateReason;
    // The template is grounded by construction; check anyway, so a regression is visible in the row.
    const selfCheck = verifyBrief({ headline: brief.headline, tone: brief.tone, items: brief.items, traveler_note: brief.traveler_note }, facts);
    verifierReport.templateCheck = { itemsKept: selfCheck.report.itemsKept, dropped: selfCheck.report.dropped, headline: selfCheck.report.headline.status };
    if (selfCheck.report.dropped.length || selfCheck.report.headline.status !== 'kept') {
      console.error('brief template failed its own verification:', JSON.stringify(verifierReport.templateCheck).slice(0, 500));
    }
  }
  if (modelResult) {
    verifierReport.model = { stopReason: modelResult.stopReason, elapsedMs: modelResult.elapsedMs, failure: modelResult.failure, detail: modelResult.detail };
  }

  const nowIso = new Date(nowMs).toISOString();
  const row: BriefRow = {
    generated_at: nowIso,
    checked_at: nowIso,
    source: useModel ? 'model' : 'template',
    template_reason: useModel ? null : templateReason,
    tone: brief.tone,
    headline: brief.headline,
    items: brief.items,
    traveler_note: brief.traveler_note,
    headline_fact_ids: brief.headline_fact_ids || [],
    facts,
    facts_hash: hash,
    model: modelResult ? modelResult.modelId : null,
    input_tokens: modelResult?.inputTokens ?? null,
    output_tokens: modelResult?.outputTokens ?? null,
    cost_usd: modelResult ? modelResult.costUsd : null,
    verifier: verifierReport,
    collection: collectionReport,
  };
  const stored = await insertBrief(row);
  if (!stored.ok) return { status: stored.reason === 'table missing' ? 'unconfigured' : 'error', reason: stored.reason };

  // Retention, once an hour (the first run after the top of the hour).
  let cleanup: { deleted: number; capReached: boolean } | null = null;
  let radioCleanup: { deleted: number; capReached: boolean } | null = null;
  if (nowMs % (60 * 60 * 1000) < BRIEF_CRON_INTERVAL_MS) {
    cleanup = await cleanupOldBriefs(nowMs);
    if (enhancedRadarSwitchOn()) radioCleanup = await cleanupOldBriefs(nowMs, 'radio_airport_status', 'requested_at');
  }

  return {
    status: 'published',
    briefId: stored.value,
    source: row.source,
    templateReason: row.template_reason,
    tone: row.tone,
    headline: row.headline,
    factCount: facts.length,
    itemsIn: verification?.report.itemsIn ?? null,
    itemsKept: row.items.length,
    dropped: verification?.report.dropped.map((d) => ({ index: d.index, reasons: d.reasons })) ?? [],
    model: modelResult ? modelResult.modelId : null,
    costUsd: row.cost_usd,
    cleanup,
    ...(radioCleanup ? { radioCleanup } : {}),
    ...(extra.report !== undefined ? { radio: extra.report } : {}),
    errors: collected.errors,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorizedCronRequest(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const summary = await runBriefCron();
    console.log('brief run:', JSON.stringify(summary).slice(0, 2000));
    return res.status(summary.status === 'error' ? 500 : 200).json(summary);
  } catch (e: any) {
    console.error('brief cron error:', e?.message || e);
    return res.status(500).json({ status: 'error', reason: 'internal error' });
  }
}
