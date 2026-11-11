#!/usr/bin/env bun
// Offline evaluation harness for the ops brief (docs/specs/ops-brief.md).
//
//   bun scripts/brief-eval.mjs                      every fixture in tests/fixtures/brief/
//   bun scripts/brief-eval.mjs storm-day calm-afternoon
//   bun scripts/brief-eval.mjs --templates          template briefs only, never calls the model
//   bun scripts/brief-eval.mjs --facts              also print every fact the brief is written from
//   bun scripts/brief-eval.mjs --json               one JSON object per fixture instead of text
//   bun scripts/brief-eval.mjs --requests           one JSON line per fixture, {fixture, system, user,
//                                                   schema}: exactly what production would send, with
//                                                   the JSON schema the reply must match; no model call
//   bun scripts/brief-eval.mjs --check <fixture> <response.json>
//                                                   run a saved model response through production's
//                                                   read + verify path and print the verifier report
//                                                   and the brief that would be published; no model call
//
// A --check file is either a Messages API response body ({ content: [...], stop_reason }) or the
// brief JSON itself ({ headline, tone, items, traveler_note }); the latter is read as the text of an
// end_turn response, so both go through readBriefResponse() exactly as the cron's model call does.
// --requests and --check never call the network, whatever the environment holds.
//
// With AI_GATEWAY_API_KEY set (AI_GATEWAY_BASE_URL and BRIEF_MODEL_ID are honoured as in production),
// each fixture makes ONE model call: the exact request the cron sends (api/_brief-model.ts and
// src/lib/brief-prompt.js), then the production verifier. Without a key it prints the template
// briefs. Run it with Bun: it imports the TypeScript model module directly.
//
// A fixture is { name, description, nowIso, sources | facts, expect? }: `sources` are the raw
// payloads the cron collects (/api/irops, /api/faa, /api/nas, /api/metar, live-feed counts, the
// airborne median) and go through the real fact builder; `facts` skips it. An optional
// `radio: { EWR: <GET /api/v0/airports/status body> }` adds the Enhanced Radar facts exactly as the
// cron would (no Enhanced Radar call is ever made from here).

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildBriefFacts, computeTone } from '../src/lib/brief-facts.js';
import { buildTemplateBrief } from '../src/lib/brief-template.js';
import { briefFromSavedResponse, verifyBrief } from '../src/lib/brief-verify.js';
import { BRIEF_SYSTEM_PROMPT, briefWorstCaseCostUsd, buildBriefRequest } from '../src/lib/brief-prompt.js';
import { radioFactsFromStatus } from '../src/lib/brief-radio.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(here, '..', 'tests', 'fixtures', 'brief');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const checkAt = args.indexOf('--check');
const checkArgs = checkAt >= 0 ? args.slice(checkAt + 1, checkAt + 3) : null;
if (checkArgs && (checkArgs.length < 2 || checkArgs.some((a) => a.startsWith('--')))) {
  console.error('Usage: bun scripts/brief-eval.mjs --check <fixture> <response.json>');
  process.exit(2);
}
const wanted = checkArgs ? [checkArgs[0]] : args.filter((a) => !a.startsWith('--'));
const asJson = flags.has('--json');
const showFacts = flags.has('--facts');
const requestsOnly = flags.has('--requests');
// The offline modes never call the model, even with a key in the environment (Bun loads .env).
const useModel = Boolean(process.env.AI_GATEWAY_API_KEY) && !flags.has('--templates') && !requestsOnly && !checkArgs;

function loadFixtures() {
  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith('.json')).sort();
  const all = files.map((f) => ({ file: f, ...JSON.parse(readFileSync(join(FIXTURE_DIR, f), 'utf8')) }));
  if (!wanted.length) return all;
  const picked = all.filter((fx) => wanted.includes(fx.name) || wanted.includes(fx.file.replace(/\.json$/, '')));
  const missing = wanted.filter((w) => !picked.some((fx) => fx.name === w || fx.file === `${w}.json`));
  if (missing.length) {
    console.error(`No fixture named: ${missing.join(', ')}. Available: ${all.map((fx) => fx.name).join(', ')}`);
    process.exit(2);
  }
  return picked;
}

function printBrief(label, brief) {
  console.log(`  ${label}  [${brief.tone}]`);
  console.log(`    ${brief.headline}`);
  for (const item of brief.items) console.log(`    - ${item.text}  ${item.fact_ids.map((id) => `[${id}]`).join(' ')}`);
  if (brief.traveler_note) console.log(`    > ${brief.traveler_note.text}  ${brief.traveler_note.fact_ids.map((id) => `[${id}]`).join(' ')}`);
}

function printVerifier(report) {
  console.log(`  verifier: ${report.itemsKept}/${report.itemsIn} items kept; headline ${report.headline.status}${report.headline.status === 'replaced' ? ` (${report.headline.reasons.join(', ')}; was "${report.headline.original}")` : ''}; tone model=${report.tone.model} computed=${report.tone.computed}${report.tone.overridden ? ' (OVERRIDDEN)' : ''}; traveler note ${report.travelerNote.status}${report.travelerNote.reasons.length ? ` (${report.travelerNote.reasons.join(', ')})` : ''}`);
  for (const d of report.dropped) console.log(`    DROPPED item ${d.index}: ${d.reasons.join(', ')}\n      "${d.text}"  ${d.fact_ids.map((id) => `[${id}]`).join(' ')}`);
  if (report.warnings.length) console.log(`    warnings: ${report.warnings.join(', ')}`);
}

/** The facts a fixture yields, exactly as the cron would build them. */
function factsFor(fx, nowMs) {
  const radio = Object.entries(fx.radio || {}).flatMap(([hub, status]) => radioFactsFromStatus(hub, status, { nowMs }));
  return fx.facts
    ? { facts: fx.facts, collection: { sources: {}, skipped: [] } }
    : buildBriefFacts({ ...(fx.sources || {}), extraFacts: radio }, { nowMs });
}

const fixtures = loadFixtures();

if (requestsOnly) {
  for (const fx of fixtures) {
    const nowMs = Date.parse(fx.nowIso);
    const request = buildBriefRequest(factsFor(fx, nowMs).facts, nowMs);
    // The output schema too (output_config.format.schema), so an offline run knows the exact shape.
    console.log(JSON.stringify({ fixture: fx.name, system: request.system, user: request.messages[0].content, schema: request.output_config.format.schema }));
  }
  process.exit(0);
}

if (checkArgs) {
  const [fx] = fixtures;
  const nowMs = Date.parse(fx.nowIso);
  const { facts } = factsFor(fx, nowMs);
  // The cron's path: read the response, verify it, else the template with the cron's reason.
  const { read, report, source, templateReason, brief } = briefFromSavedResponse(readFileSync(checkArgs[1], 'utf8'), facts);
  if (asJson) {
    console.log(JSON.stringify({ fixture: fx.name, file: checkArgs[1], read: read.ok ? { ok: true } : read, report, final: { source, templateReason, brief } }));
  } else {
    console.log(`━━ check ${fx.name} ━━ ${checkArgs[1]}  (${facts.length} facts, computed tone ${computeTone(facts)})`);
    if (!read.ok) console.log(`  READ FAILED: ${read.reason}${read.detail ? ` — ${read.detail}` : ''}`);
    else if (report?.shapeErrors) console.log(`  INVALID SHAPE: ${report.shapeErrors.join(', ')}`);
    if (report && !report.shapeErrors) printVerifier(report);
    printBrief(templateReason ? `PUBLISHED: TEMPLATE (${templateReason})` : 'PUBLISHED: MODEL BRIEF (verified)', brief);
  }
  process.exit(0);
}
let generate = null;
let modelId = null;
if (useModel) {
  const mod = await import('../api/_brief-model.ts');
  generate = mod.generateBriefWithModel;
  modelId = mod.briefModelId();
}

if (!asJson) {
  console.log(`Ops brief eval: ${fixtures.length} fixture(s). ${useModel
    ? `Model ${modelId} via ${process.env.AI_GATEWAY_BASE_URL || 'https://ai-gateway.vercel.sh'} (one call per fixture).`
    : 'No model calls (AI_GATEWAY_API_KEY unset or --templates): template briefs only.'}`);
  console.log(`System prompt: ${BRIEF_SYSTEM_PROMPT.length} chars.\n`);
}

const totals = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, itemsIn: 0, itemsKept: 0, templates: 0 };

for (const fx of fixtures) {
  const nowMs = Date.parse(fx.nowIso);
  const { facts, collection } = factsFor(fx, nowMs);
  const template = buildTemplateBrief(facts);
  const templateCheck = verifyBrief({ headline: template.headline, tone: template.tone, items: template.items, traveler_note: template.traveler_note }, facts);
  const result = { name: fx.name, nowIso: fx.nowIso, factCount: facts.length, computedTone: computeTone(facts), expectTone: fx.expect?.tone ?? null, template, templateCheck: templateCheck.report, skipped: collection.skipped };

  if (generate) {
    const request = buildBriefRequest(facts, nowMs);
    const model = await generate(facts, nowMs);
    totals.calls++;
    totals.inputTokens += model.inputTokens || 0;
    totals.outputTokens += model.outputTokens || 0;
    totals.costUsd += model.costUsd || 0;
    result.model = { id: model.modelId, failure: model.failure, detail: model.detail, stopReason: model.stopReason, inputTokens: model.inputTokens, outputTokens: model.outputTokens, costUsd: model.costUsd, worstCaseUsd: briefWorstCaseCostUsd(request), elapsedMs: model.elapsedMs, raw: model.json };
    if (!model.failure) {
      const verified = verifyBrief(model.json, facts);
      result.verified = verified;
      totals.itemsIn += verified.report.itemsIn;
      totals.itemsKept += verified.report.itemsKept;
      if (!verified.ok) totals.templates++;
    } else {
      totals.templates++;
    }
  }

  if (asJson) {
    console.log(JSON.stringify(result));
    continue;
  }

  console.log(`━━ ${fx.name} ━━ ${fx.nowIso}  (${facts.length} facts, computed tone ${result.computedTone}${result.expectTone && result.expectTone !== result.computedTone ? `, FIXTURE EXPECTS ${result.expectTone}` : ''})`);
  if (fx.description) console.log(`  ${fx.description}`);
  if (showFacts) {
    for (const f of facts) console.log(`    · ${String(f.severity).padStart(3)} ${f.toneFloor.padEnd(9)} ${f.id}: ${f.statement}  ${JSON.stringify(f.values)}`);
    if (collection.skipped.length) console.log(`    skipped: ${collection.skipped.join('; ')}`);
  }

  if (result.model) {
    const m = result.model;
    console.log(`  model: ${m.id}  ${m.inputTokens ?? '?'} in / ${m.outputTokens ?? '?'} out  $${(m.costUsd || 0).toFixed(6)} (worst case $${m.worstCaseUsd.toFixed(6)})  ${m.elapsedMs} ms  stop=${m.stopReason}`);
    if (m.failure) {
      console.log(`  MODEL FAILED: ${m.failure}${m.detail ? ` — ${m.detail}` : ''} → the template below would be published.`);
    } else if (result.verified) {
      const { ok, brief, report } = result.verified;
      if (report.shapeErrors) console.log(`  INVALID SHAPE: ${report.shapeErrors.join(', ')} → template.  raw: ${JSON.stringify(m.raw).slice(0, 400)}`);
      if (ok && brief) printBrief('MODEL BRIEF (verified)', brief);
      else if (!report.shapeErrors) console.log('  NO ITEM SURVIVED → template.');
      printVerifier(report);
    }
  }

  printBrief('TEMPLATE', template);
  const tc = templateCheck.report;
  if (tc.dropped.length || tc.headline.status !== 'kept') {
    console.log(`  !! TEMPLATE FAILED ITS OWN VERIFICATION: ${JSON.stringify({ dropped: tc.dropped, headline: tc.headline })}`);
  }
  console.log('');
}

if (!asJson && totals.calls) {
  console.log(`Totals: ${totals.calls} calls, ${totals.inputTokens} input + ${totals.outputTokens} output tokens, $${totals.costUsd.toFixed(6)}; ${totals.itemsKept}/${totals.itemsIn} items kept; ${totals.templates} fixture(s) would publish the template.`);
}
