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
//      An item citing a "radio" fact must attribute it to what was heard ("tower", "controllers",
//      "on frequency"…): prompt rule 7, made checkable. A radio observation's own words are
//      untrusted and never in `values`: they may appear only as an EXACT double-quoted copy of the
//      fact's sanitized `quote`, preceded in the same clause by a radio attribution ("tower",
//      "approach", "ATC", "heard on frequency"…). Any other quoted text in a radio item, a partial
//      or altered quote, or an unattributed one drops the item. Markup or a URL drops any item.
//   5. The headline is checked against the union of the SURVIVING items' facts. A headline that
//      fails (or runs past 14 words, or says the operation is calm, smooth, quiet or "running
//      normally" while the computed tone is not calm) is replaced with the template headline,
//      never published. Past 12 words (prompt rule 3) it is kept with a warning.
//   6. The traveler note is checked like an item, and only survives when an FAA ground stop or
//      ground delay program is in effect at a United hub, or the final tone is "disrupted"
//      (travelerNoteAllowed).
//   7. Tone is computed from the facts (computeTone) and overrides the model's when they differ.
//
// If no item survives, the result is not ok and the caller publishes the template brief.

import { BRIEF_HUBS, airportForms, allowanceFromValues, claimFailure, emptyAllowance, extractClaims, normalizeText } from './brief-claims.js';
import { allHubsHealthy, computeTone, isNonHubProgramFact, programAirport, travelerNoteAllowed } from './brief-facts.js';
import { ON_TIME_GRACE_MIN } from './hub-health.js';
import { buildTemplateBrief, templateHeadline } from './brief-template.js';
import { readBriefResponse } from './brief-prompt.js';

export const BRIEF_MAX_ITEMS = 4;
const MAX_TEXT_CHARS = 400;
const MAX_HEADLINE_CHARS = 160;
const MAX_HEADLINE_WORDS = 14;
const SOFT_HEADLINE_WORDS = 12;
const MAX_FACT_IDS = 8;
const TONES = new Set(['calm', 'watch', 'disrupted']);

const JARGON_RE = /\b(GDP|GS|IFR|LIFR|MVFR|VFR|IMC|VMC|TMI|AFP|EDCT|MIT|SWAP|IROPS|OTP|ATCSCC)\b/;
const FIRST_PERSON_RE = /\b(?:[Ww]e|[Ww]e're|[Ww]e've|[Oo]ur|[Oo]urs|us)\b/;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
/** Words that attribute a claim to air traffic control audio rather than to the FAA. */
const RADIO_ATTRIBUTION_RE = /\b(?:heard|radio|frequenc(?:y|ies)|tower|controllers?|pilots?|crews?|approach\s+control|ground\s+control|air\s+traffic\s+control|ATC|Enhanced\s+Radar|transmissions?)\b/i;
/** The stricter attribution a radio QUOTE must follow, in its own clause. */
const QUOTE_ATTRIBUTION_RE = /\b(?:heard|radio|frequenc(?:y|ies)|tower|controllers?|approach(?:\s+control)?|ground\s+control|air\s+traffic\s+control|ATC|transmissions?)\b/i;
/** Markup or a link in model text: never published. */
const MARKUP_RE = /<[^>]{0,200}>|<\/?[a-z]|[a-z][a-z0-9+.-]*:\/\/|\bwww\./i;
/** A headline saying the operation is calm: replaced whenever the computed tone is not calm. */
const CALM_HEADLINE_RE = /\b(?:calm|calmly|smooth|smoothly|quiet|quietly)\b|\brunning\s+normally\b/i;
/** "the other hubs are running normally": the rest of the hubs, after the problem has been named. */
const OTHER_HUBS_NORMAL_RE = /\b(?:the\s+)?(?:other|remaining)\s+(?:United\s+)?hubs\s+(?:are|look|remain|stay)\s+(?:running\s+)?(?:normally|normal|smoothly|calm)\b/gi;
/** Words that say how United's operation is doing, which a headline must lead with (see below). */
const CONDITION_RE = /\b(?:United|United's|hubs?|calm|calmly|smooth|smoothly|quiet|quietly|normal|normally)\b/i;
/** Words naming a ground stop or delay program. On a calm day none is at a hub (computeTone). */
const PROGRAM_WORDS_RE = /\b(?:ground\s+stops?|ground\s+delays?|delay\s+programs?|FAA\s+programs?|programs?|delays?|holding|held)\b/i;

/**
 * Why a headline leads with a stop or delay program at an airport that is not a United hub, or null
 * (Nov 2026: "Ground delays are holding flights into Seattle; hubs look normal." on a day the
 * header read "Smooth Ops"). It leads with one when the program's airport, or on a calm day any
 * program wording (no hub has one then), comes before anything about United's own condition:
 * "United", the hubs, a calm word or a hub's name. The mirror of headline:calm_when_not_calm.
 * @param {string} headline  normalized
 * @param {'calm'|'watch'|'disrupted'} tone
 * @param {Array<import('./brief-facts.js').BriefFact>} facts
 * @returns {string|null}
 */
export function nonHubLeadReason(headline, tone, facts) {
  const away = facts.filter(isNonHubProgramFact);
  if (away.length === 0) return null;
  const firstIndex = (re) => { const m = headline.match(re); return m && m.index !== undefined ? m.index : Infinity; };
  const nameRe = (names) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map((n) => normalizeText(n).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}])`, 'u');
  const awayNames = [...new Set(away.flatMap((f) => airportForms(programAirport(f))))];
  const hubNames = [...new Set(BRIEF_HUBS.flatMap((h) => airportForms(h)))];
  const programAt = Math.min(firstIndex(nameRe(awayNames)), tone === 'calm' ? firstIndex(PROGRAM_WORDS_RE) : Infinity);
  if (programAt === Infinity) return null;
  const conditionAt = Math.min(firstIndex(CONDITION_RE), firstIndex(nameRe(hubNames)));
  return programAt < conditionAt ? 'headline:leads_with_non_hub_program' : null;
}

/**
 * True when an item gives a single hub's on-time percentage on a day every hub is healthy, which the
 * on-time summary covers (Nov 2026: "…at 84% or better, and Newark is at 96%.", citing otp.floor
 * and otp.EWR): it cites an on-time fact (one that was sent, or a hub's on-time id that was not),
 * states a percentage, and names a hub whose own on-time fact was not sent (only a hub with an FAA
 * program in effect keeps one on such a day, brief-facts.js).
 * @param {string} text
 * @param {string[]} ids
 * @param {Map<string, any>} factIndex
 */
function givesHealthyHubOnTime(text, ids, factIndex) {
  const citesOnTime = ids.some((id) => factIndex.get(id)?.kind === 'otp' || (/^otp\.[A-Z]{3}$/.test(id) && !factIndex.has(id)));
  if (!citesOnTime) return false;
  // The percentage and the hub must share a clause: "…84% or better, and Newark is at 96%" gives
  // Newark a figure; "…84% or better. A program is possible at Newark tomorrow." does not.
  const clauses = normalizeText(text).split(/[.;:!?](?:\s+|$)|,\s+(?:and|but|while|with)\s+/);
  return clauses.some((clause) => {
    const claims = extractClaims(clause);
    return claims.some((c) => c.type === 'percent')
      && claims.some((c) => c.type === 'airport' && c.codes.some((code) => BRIEF_HUBS.includes(code) && !factIndex.has(`otp.${code}`)));
  });
}

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
  let citesRadio = false;
  for (const id of ids) {
    const fact = factIndex.get(id);
    if (!fact) reasons.push(`unknown_fact_id:${id}`);
    else {
      allowanceFromValues(fact.values, allowance);
      // Every on-time figure means "within 30 minutes of schedule": an item citing one may say so
      // (prompt rule 4 asks for the definition once, often beside the summary, whose values carry
      // no "30 minutes").
      if (/** @type {any} */ (fact).kind === 'otp') allowanceFromValues([`${ON_TIME_GRACE_MIN} minutes`], allowance);
      if (/** @type {any} */ (fact).kind === 'faa_planned') citesPlanned = true;
      if (/** @type {any} */ (fact).kind === 'radio') citesRadio = true;
    }
  }
  if (itemRules && citesPlanned && !HEDGE_RE.test(normalizeText(text))) reasons.push('planned_not_hedged');
  if (itemRules && citesRadio && !RADIO_ATTRIBUTION_RE.test(normalizeText(text))) reasons.push('radio_not_attributed');
  if (String(text).length > MAX_TEXT_CHARS) reasons.push('text_too_long');
  if (FIRST_PERSON_RE.test(normalizeText(text))) reasons.push('first_person');
  if (MARKUP_RE.test(normalizeText(text))) reasons.push('markup_or_url');

  // Radio quotes: an exact, attributed copy of a cited radio fact's sanitized quote is the ONLY way
  // an observation's words reach a visitor, and the only text exempt from the claim check below.
  let claimText = normalizeText(text);
  if (itemRules && citesRadio) {
    const cited = ids.map((id) => /** @type {any} */ (factIndex.get(id))).filter(Boolean);
    const quotes = new Set(cited.filter((f) => f.kind === 'radio' && f.quote).map((f) => normalizeText(f.quote).trim()));
    const statements = cited.filter((f) => f.kind !== 'radio').map((f) => normalizeText(f.statement || ''));
    for (const m of [...claimText.matchAll(/"([^"]*)"/g)]) {
      const inner = m[1].trim();
      if (quotes.has(inner)) {
        if (!quoteIsAttributed(claimText, m.index ?? 0)) reasons.push('radio_quote_unattributed');
        else claimText = claimText.slice(0, m.index) + ' '.repeat(m[0].length) + claimText.slice((m.index ?? 0) + m[0].length);
      } else if (!statements.some((st) => inner && st.includes(inner))) {
        reasons.push(`radio_quote_mismatch:${inner.slice(0, 40)}`);
      }
    }
    if ((claimText.match(/"/g) || []).length % 2 === 1) reasons.push('radio_quote_unbalanced');
  }

  const claims = extractClaims(claimText);
  for (const claim of claims) {
    const why = claimFailure(claim, allowance);
    if (why) reasons.push(why);
  }
  // A time whose fact gives its day ("tomorrow 10:00 AM ET": not later today on that airport's
  // clock) may only be used with that day: "after 10:00 AM ET" said at 8 PM reads as past.
  for (const { day, minutes, zone, raw } of dayBoundTimes(ids, factIndex)) {
    const used = claims.some((c) => c.type === 'time' && c.minutes === minutes && (!c.zone || !zone || c.zone === zone));
    if (used && !new RegExp(`\\b${day}\\b`, 'i').test(claimText)) reasons.push(`time_without_day:${raw}`);
  }
  return reasons;
}

/** The day-qualified times ("tomorrow 10:00 AM ET", "on Friday 2:00 PM CT") the cited facts carry. */
function dayBoundTimes(ids, factIndex) {
  const out = [];
  for (const id of ids) {
    for (const value of factIndex.get(id)?.values || []) {
      const m = String(value).match(/^(tomorrow|on\s+[A-Z][a-z]+day)\s+(.+)$/);
      if (!m) continue;
      const time = extractClaims(m[2]).find((c) => c.type === 'time');
      if (time && time.type === 'time') out.push({ day: m[1].replace(/^on\s+/, ''), minutes: time.minutes, zone: time.zone, raw: String(value) });
    }
  }
  return out;
}

/** The on-time definition as the facts state it ("within 30 minutes of schedule"). */
const ON_TIME_DEFINITION_RE = new RegExp(`\\bwithin\\s+${ON_TIME_GRACE_MIN}\\s+minutes\\s+of\\s+(?:their\\s+)?schedule(?:d\\s+times?)?\\b`, 'i');

/**
 * Prompt rule 4's "state the on-time definition once", as a trim: in every item after the first that
 * states it, the definition becomes "on time" ("at 89% or better on departures within 30 minutes of
 * schedule" → "at 89% or better on time"). Only those words change, so every claim left was already
 * checked. Null when there is nothing to trim or the result would not read cleanly.
 * @param {string} text
 * @returns {string|null}
 */
export function trimOnTimeDefinition(text) {
  if (!ON_TIME_DEFINITION_RE.test(text)) return null;
  const def = ON_TIME_DEFINITION_RE.source.replace(/^\\b/, '');
  const out = text
    // "on departures within 30 minutes of schedule" → "on time"
    .replace(new RegExp(`\\bon\\s+departures\\s+(?:leaving\\s+|that\\s+left\\s+|left\\s+)?${def}`, 'gi'), 'on time')
    // "of departures leaving within 30 minutes of schedule" → "of departures on time"
    .replace(new RegExp(`\\b(?:leaving|that\\s+left|left|departing|leave)\\s+${def}`, 'gi'), 'on time')
    // anything else: the bare definition
    .replace(new RegExp(`\\b${def}`, 'gi'), 'on time')
    .replace(/\bon time,?\s+on time\b/gi, 'on time')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return out === text || ON_TIME_DEFINITION_RE.test(out) ? null : out;
}

/**
 * True when the clause holding the quote at `index` attributes it to radio before the quote opens.
 * The clause runs back to the last sentence or clause break (". ", "; ", "! ", "? "); the dots of
 * "a.m."/"p.m." are not breaks.
 */
function quoteIsAttributed(text, index) {
  const before = text.slice(0, index).replace(/\b([ap])\.m\./gi, '$1m');
  const breaks = [...before.matchAll(/[.;!?]\s/g)].map((m) => (m.index ?? 0) + 1);
  const clause = before.slice(breaks.length ? breaks[breaks.length - 1] : 0);
  return QUOTE_ATTRIBUTION_RE.test(clause);
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
 * @property {number} healthyHubOnTime  items that gave a single hub's on-time percentage on a day
 *   every hub is healthy (dropped, reason hub_on_time_on_healthy_day)
 * @property {boolean} summaryInserted  the on-time summary took the first such item's place
 * @property {Array<{item: number, from: string, to: string, reason: string}>} trimmed  words taken
 *   out of a kept item (the on-time definition repeated after the first item that states it)
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
    healthyHubOnTime: 0,
    summaryInserted: false,
    trimmed: [],
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
  // On a day every hub is healthy, a single hub's on-time percentage is padding: the item is
  // replaced by the on-time summary when no other item carries it, else dropped (Nov 2026).
  const healthyDay = allHubsHealthy(factList);
  const summary = factIndex.get('otp.floor');
  /** @type {number[]} positions in `kept` where the summary may stand in for a dropped item */
  const summarySlots = [];
  input.items.forEach((item, index) => {
    const ids = [...new Set(item.fact_ids)];
    const reasons = index >= BRIEF_MAX_ITEMS ? ['over_item_limit'] : checkSentence(item.text, ids, factIndex);
    // Only a sentence that otherwise passes, or one whose only trouble is citing a hub's on-time
    // fact that was not sent (the specimen: otp.floor + otp.EWR, "and Newark is at 96%").
    const citesUnsentOnTime = reasons.some((r) => /^unknown_fact_id:otp\.[A-Z]{3}$/.test(r));
    if (index < BRIEF_MAX_ITEMS && healthyDay && (reasons.length === 0 || citesUnsentOnTime) && givesHealthyHubOnTime(item.text, ids, factIndex)) {
      reasons.push('hub_on_time_on_healthy_day');
      report.healthyHubOnTime += 1;
      summarySlots.push(kept.length);
    }
    if (reasons.length) {
      report.dropped.push({ index, text: item.text, fact_ids: ids, reasons });
      return;
    }
    report.warnings.push(...styleWarnings(item.text, `items[${index}]`));
    kept.push({ text: normalizeText(item.text).trim(), fact_ids: ids });
  });
  if (summary && summarySlots.length && !kept.some((i) => i.fact_ids.includes('otp.floor'))) {
    kept.splice(summarySlots[0], 0, { text: summary.statement, fact_ids: ['otp.floor'] });
    report.summaryInserted = true;
  }
  // The on-time definition is stated once, in the first item that states it (prompt rule 4).
  let definitionSeen = false;
  kept.forEach((item, i) => {
    if (!ON_TIME_DEFINITION_RE.test(item.text)) return;
    if (!definitionSeen) { definitionSeen = true; return; }
    const trimmed = trimOnTimeDefinition(item.text);
    if (trimmed) {
      report.trimmed.push({ item: i, from: item.text, to: trimmed, reason: 'on_time_definition_repeated' });
      kept[i] = { ...item, text: trimmed };
    }
  });
  report.itemsKept = kept.length;

  if (kept.length === 0) return { ok: false, brief: null, report };

  // Headline: grounded in the surviving items' facts, and short.
  const union = [...new Set(kept.flatMap((i) => i.fact_ids))];
  let headline = normalizeText(input.headline).trim();
  let headlineFactIds = [];
  const headlineReasons = checkSentence(headline, union, factIndex, { itemRules: false }).filter((r) => r !== 'too_many_fact_ids');
  if (headline.length > MAX_HEADLINE_CHARS || wordCount(headline) > MAX_HEADLINE_WORDS) headlineReasons.push('headline_too_long');
  // "Operations look calm" under a computed "watch" contradicts the tone word beside it. "The other
  // hubs are running normally" after a lead that names the problem does not call the operation calm
  // (Nov 2026: "Chicago O'Hare is running behind; the other hubs are running normally.", the shape
  // the owner liked), so that clause is not read.
  if (tone !== 'calm' && CALM_HEADLINE_RE.test(headline.replace(OTHER_HUBS_NORMAL_RE, (m, offset) => (offset > 0 ? '' : m)))) {
    headlineReasons.push('headline:calm_when_not_calm');
  }
  // Its mirror: United's condition comes first, never a program at an airport that is not a hub.
  const awayLead = nonHubLeadReason(headline, tone, factList);
  if (awayLead) headlineReasons.push(awayLead);
  if (headlineReasons.length) {
    const replacement = templateHeadline(factList, tone);
    report.headline = { status: 'replaced', reasons: headlineReasons, original: headline };
    headline = replacement.headline;
    headlineFactIds = replacement.fact_ids;
  } else {
    if (wordCount(headline) > SOFT_HEADLINE_WORDS) report.warnings.push(`headline:over_${SOFT_HEADLINE_WORDS}_words`);
    report.warnings.push(...styleWarnings(headline, 'headline'));
  }

  // Traveler note: verified like an item; only with a hub program in effect, or a disrupted brief.
  let traveler_note = null;
  if (input.traveler_note) {
    const ids = [...new Set(input.traveler_note.fact_ids)];
    const reasons = checkSentence(input.traveler_note.text, ids, factIndex);
    if (!travelerNoteAllowed(tone, factList)) reasons.push(`tone_is_${tone}`);
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
 * What the cron would publish for one saved model response, offline (the eval harness's --check;
 * the cron itself does not call this). The same steps as production: read the response as
 * api/_brief-model.ts does (readBriefResponse: stop reason, the text block, JSON), verify it, and
 * otherwise publish the template with api/cron/brief.ts's reason.
 * @param {string} raw  a Messages API response body ({ content, stop_reason }), or the brief JSON
 *   itself, which is read as the text of an end_turn response
 * @param {Array<import('./brief-facts.js').BriefFact>} facts
 * @returns {{read: ReturnType<typeof readBriefResponse>, report: VerifierReport|null,
 *   source: 'model'|'template', templateReason: string|null, brief: import('./brief-template.js').Brief}}
 */
export function briefFromSavedResponse(raw, facts) {
  let parsed = null;
  try { parsed = JSON.parse(String(raw)); } catch { /* not JSON: the read reports invalid_json */ }
  const message = parsed && typeof parsed === 'object' && Array.isArray(parsed.content)
    ? parsed
    : { content: [{ type: 'text', text: String(raw) }], stop_reason: 'end_turn' };
  const read = readBriefResponse(message);
  const verified = read.ok ? verifyBrief(read.json, facts) : null;
  const templateReason = !read.ok ? read.reason
    : !verified?.ok ? (verified?.report.shapeErrors ? 'invalid_shape' : 'no_items_survived') : null;
  return {
    read,
    report: verified ? verified.report : null,
    source: templateReason ? 'template' : 'model',
    templateReason,
    brief: templateReason || !verified?.brief ? buildTemplateBrief(facts) : verified.brief,
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
