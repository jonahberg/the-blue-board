// ═══ OPS BRIEF: THE VERIFIER ═══
// Deterministic. Nothing the model writes reaches a visitor until this has checked it against the
// facts it was given:
//
//   1. Shape. The JSON must be exactly { headline, tone, items, traveler_note } with the right types.
//      Anything else is not a brief, and the template is published instead.
//   2. Every item cites at least one fact, and every id it cites exists.
//   3. Every claim in an item's text — clock time, percentage, number (digits or words), flight
//      number, runway, airport code or name, cause — must appear in the `values` of the facts THAT
//      ITEM cites (src/lib/brief-claims.js measures both sides with one extractor). An item that
//      fails any check is dropped, and the report says why.
//   4. Items may not speak as United ("we", "our"), and an item citing a PLANNED or POSSIBLE FAA
//      program must say so ("possible", "not in effect", "could"…): prompt rule 2, made checkable.
//   5. The headline is checked against the union of the SURVIVING items' facts. A headline that
//      fails (or runs past 20 words) is replaced with the template headline, never published.
//   6. The traveler note is checked like an item, and only survives when the final tone is
//      "disrupted".
//   7. Tone is computed from the facts (computeTone) and overrides the model's when they differ.
//
// If no item survives, the result is not ok and the caller publishes the template brief.

import { allowanceFromValues, claimFailure, emptyAllowance, extractClaims, normalizeText } from './brief-claims.js';
import { computeTone } from './brief-facts.js';
import { templateHeadline } from './brief-template.js';

export const BRIEF_MAX_ITEMS = 4;
const MAX_TEXT_CHARS = 400;
const MAX_HEADLINE_CHARS = 160;
const MAX_HEADLINE_WORDS = 20;
const SOFT_HEADLINE_WORDS = 12;
const MAX_FACT_IDS = 8;
const TONES = new Set(['calm', 'watch', 'disrupted']);

const JARGON_RE = /\b(GDP|GS|IFR|LIFR|MVFR|VFR|IMC|VMC|TMI|AFP|EDCT|MIT|SWAP|IROPS|OTP|ATCSCC)\b/;
const FIRST_PERSON_RE = /\b(?:[Ww]e|[Ww]e're|[Ww]e've|[Oo]ur|[Oo]urs|us)\b/;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
/** Words that mark an FAA program as not (yet) in effect. */
const HEDGE_RE = /\b(?:possible|possibly|could|may|might|planned|plans?|expects?|expected|watch(?:ing)?|later|if|not\s+(?:yet\s+)?in\s+effect|isn't\s+in\s+effect|neither\s+is\s+in\s+effect|none\s+(?:of\s+them\s+)?(?:is|are)\s+in\s+effect)\b/i;

/**
 * Strict shape check of the model's JSON.
 * @param {unknown} json
 * @returns {{ok: true, value: {headline: string, tone: string, items: Array<{text: string, fact_ids: string[]}>, traveler_note: {text: string, fact_ids: string[]}|null}}
 *   | {ok: false, errors: string[]}}
 */
export function validateBriefShape(json) {
  const errors = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, errors: ['not_an_object'] };
  const obj = /** @type {Record<string, unknown>} */ (json);
  const allowed = new Set(['headline', 'tone', 'items', 'traveler_note']);
  for (const key of Object.keys(obj)) if (!allowed.has(key)) errors.push(`unexpected_key:${key}`);

  if (typeof obj.headline !== 'string' || !obj.headline.trim()) errors.push('headline_missing');
  else if (obj.headline.length > MAX_HEADLINE_CHARS * 2) errors.push('headline_too_long');
  if (typeof obj.tone !== 'string' || !TONES.has(obj.tone)) errors.push('tone_invalid');

  const itemOk = (item, where) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push(`${where}_not_an_object`); return; }
    const keys = Object.keys(item);
    for (const k of keys) if (k !== 'text' && k !== 'fact_ids') errors.push(`${where}_unexpected_key:${k}`);
    if (typeof item.text !== 'string' || !item.text.trim()) errors.push(`${where}_text_missing`);
    else if (item.text.length > MAX_TEXT_CHARS * 2) errors.push(`${where}_text_too_long`);
    if (!Array.isArray(item.fact_ids) || item.fact_ids.some((id) => typeof id !== 'string')) errors.push(`${where}_fact_ids_invalid`);
  };

  if (!Array.isArray(obj.items)) errors.push('items_not_an_array');
  else if (obj.items.length === 0) errors.push('items_empty');
  else obj.items.forEach((item, i) => itemOk(item, `items[${i}]`));

  if (!('traveler_note' in obj)) errors.push('traveler_note_missing');
  else if (obj.traveler_note !== null) itemOk(obj.traveler_note, 'traveler_note');

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: /** @type {any} */ (obj) };
}

/**
 * Check one sentence against the facts it cites.
 * @param {string} text
 * @param {string[]} factIds
 * @param {Map<string, {values: string[], kind?: string}>} factIndex
 * @param {{itemRules?: boolean}} [options]  itemRules (default true): the planned-hedge and radio-
 *   attribution rules, which apply to an item or the traveler note. A headline is checked for its
 *   claims only: it rests on the union of the items' facts and need not repeat their hedges.
 * @returns {string[]} reasons it fails; empty when it passes.
 */
export function checkSentence(text, factIds, factIndex, { itemRules = true } = {}) {
  const reasons = [];
  const ids = Array.isArray(factIds) ? [...new Set(factIds)] : [];
  if (ids.length === 0) reasons.push('no_fact_ids');
  if (ids.length > MAX_FACT_IDS) reasons.push('too_many_fact_ids');
  const allowance = emptyAllowance();
  let citesPlanned = false;
  for (const id of ids) {
    const fact = factIndex.get(id);
    if (!fact) reasons.push(`unknown_fact_id:${id}`);
    else {
      allowanceFromValues(fact.values, allowance);
      if (/** @type {any} */ (fact).kind === 'faa_planned') citesPlanned = true;
    }
  }
  if (itemRules && citesPlanned && !HEDGE_RE.test(normalizeText(text))) reasons.push('planned_not_hedged');
  if (String(text).length > MAX_TEXT_CHARS) reasons.push('text_too_long');
  if (FIRST_PERSON_RE.test(normalizeText(text))) reasons.push('first_person');
  for (const claim of extractClaims(text)) {
    const why = claimFailure(claim, allowance);
    if (why) reasons.push(why);
  }
  return reasons;
}

function styleWarnings(text, where) {
  const t = normalizeText(text);
  const warnings = [];
  const jargon = t.match(JARGON_RE);
  if (jargon) warnings.push(`${where}:jargon:${jargon[1]}`);
  if (t.includes('!')) warnings.push(`${where}:exclamation`);
  if (EMOJI_RE.test(t)) warnings.push(`${where}:emoji`);
  return warnings;
}

const wordCount = (s) => normalizeText(s).trim().split(/\s+/).filter(Boolean).length;

/**
 * @typedef {Object} VerifierReport
 * @property {number} itemsIn
 * @property {number} itemsKept
 * @property {Array<{index: number, text: string, fact_ids: string[], reasons: string[]}>} dropped
 * @property {{status: 'kept'|'replaced', reasons: string[], original?: string}} headline
 * @property {{status: 'none'|'kept'|'dropped', reasons: string[]}} travelerNote
 * @property {{model: string|null, computed: string, final: string, overridden: boolean}} tone
 * @property {string[]} warnings
 * @property {string[]} [shapeErrors]
 */

/**
 * Verify the model's brief against the facts.
 * @param {unknown} candidate  the parsed JSON from the model
 * @param {Array<import('./brief-facts.js').BriefFact>} facts
 * @returns {{ok: boolean, brief: import('./brief-template.js').Brief|null, report: VerifierReport}}
 */
export function verifyBrief(candidate, facts) {
  const factList = Array.isArray(facts) ? facts : [];
  const factIndex = new Map(factList.map((f) => [f.id, f]));
  const computed = computeTone(factList);
  /** @type {VerifierReport} */
  const report = {
    itemsIn: 0,
    itemsKept: 0,
    dropped: [],
    headline: { status: 'kept', reasons: [] },
    travelerNote: { status: 'none', reasons: [] },
    tone: { model: null, computed, final: computed, overridden: false },
    warnings: [],
  };

  const shape = validateBriefShape(candidate);
  if (!shape.ok) {
    report.shapeErrors = shape.errors;
    return { ok: false, brief: null, report };
  }
  const input = shape.value;
  report.itemsIn = input.items.length;
  report.tone.model = input.tone;
  report.tone.overridden = input.tone !== computed;
  const tone = computed;

  const kept = [];
  input.items.forEach((item, index) => {
    const ids = [...new Set(item.fact_ids)];
    const reasons = index >= BRIEF_MAX_ITEMS ? ['over_item_limit'] : checkSentence(item.text, ids, factIndex);
    if (reasons.length) {
      report.dropped.push({ index, text: item.text, fact_ids: ids, reasons });
      return;
    }
    report.warnings.push(...styleWarnings(item.text, `items[${index}]`));
    kept.push({ text: normalizeText(item.text).trim(), fact_ids: ids });
  });
  report.itemsKept = kept.length;

  if (kept.length === 0) return { ok: false, brief: null, report };

  // Headline: grounded in the surviving items' facts, and short.
  const union = [...new Set(kept.flatMap((i) => i.fact_ids))];
  let headline = normalizeText(input.headline).trim();
  let headlineFactIds = [];
  const headlineReasons = checkSentence(headline, union, factIndex, { itemRules: false }).filter((r) => r !== 'too_many_fact_ids');
  if (headline.length > MAX_HEADLINE_CHARS || wordCount(headline) > MAX_HEADLINE_WORDS) headlineReasons.push('headline_too_long');
  if (headlineReasons.length) {
    const replacement = templateHeadline(factList, tone);
    report.headline = { status: 'replaced', reasons: headlineReasons, original: headline };
    headline = replacement.headline;
    headlineFactIds = replacement.fact_ids;
  } else {
    if (wordCount(headline) > SOFT_HEADLINE_WORDS) report.warnings.push(`headline:over_${SOFT_HEADLINE_WORDS}_words`);
    report.warnings.push(...styleWarnings(headline, 'headline'));
  }

  // Traveler note: verified like an item; only when the brief is disrupted.
  let traveler_note = null;
  if (input.traveler_note) {
    const ids = [...new Set(input.traveler_note.fact_ids)];
    const reasons = checkSentence(input.traveler_note.text, ids, factIndex);
    if (tone !== 'disrupted') reasons.push(`tone_is_${tone}`);
    if (reasons.length) report.travelerNote = { status: 'dropped', reasons };
    else {
      report.travelerNote = { status: 'kept', reasons: [] };
      traveler_note = { text: normalizeText(input.traveler_note.text).trim(), fact_ids: ids };
    }
  }

  return {
    ok: true,
    brief: { headline, headline_fact_ids: headlineFactIds, tone, items: kept, traveler_note },
    report,
  };
}

/**
 * The fact ids a published brief cites anywhere: items, headline, traveler note. The read endpoint
 * serves exactly these facts.
 * @param {{items?: Array<{fact_ids: string[]}>, headline_fact_ids?: string[], traveler_note?: {fact_ids: string[]}|null}} brief
 * @returns {string[]}
 */
export function citedFactIds(brief) {
  const ids = [
    ...(brief?.items || []).flatMap((i) => i.fact_ids || []),
    ...(brief?.headline_fact_ids || []),
    ...(brief?.traveler_note?.fact_ids || []),
  ];
  return [...new Set(ids)];
}
