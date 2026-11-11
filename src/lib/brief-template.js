// ═══ OPS BRIEF: TEMPLATE ═══
// The brief code writes when the model does not: the model call failed, its JSON was invalid, the
// spend cap was hit, generation is switched off, or no item survived verification. Built only from
// fact statements and a handful of fixed headlines, so every word of it is grounded by construction
// (tests run every fixture's template through the verifier). It must read acceptably on its own:
// this is what every visitor sees whenever the model is not available.

import { airportDisplayName } from './brief-claims.js';
import { computeTone, isHubProgramFact, travelerNoteAllowed } from './brief-facts.js';

/**
 * @typedef {import('./brief-facts.js').BriefFact} BriefFact
 * @typedef {{text: string, fact_ids: string[]}} BriefItem
 * @typedef {{headline: string, headline_fact_ids: string[], tone: 'calm'|'watch'|'disrupted',
 *   items: BriefItem[], traveler_note: BriefItem|null}} Brief
 */

/** Facts worth leading with: anything at or above this severity is a problem, not background. */
const LEAD_SEVERITY = 20;

/** Aggregates and meta facts: background for a calm brief, never the lead when a specific fact exists. */
const SUMMARY_IDS = new Set([
  'faa.active.count', 'faa.active.other', 'faa.planned.count', 'net.status', 'net.index', 'wx.summary',
  'otp.floor', 'otp.soft', 'otp.min', 'cxl.confirmed', 'cxl.unconfirmed', 'air.total',
  'air.starlink', 'air.normal',
]);

const byId = (facts) => new Map((facts || []).map((f) => [f.id, f]));
/** A template headline stays within the prompt's own limit (rule 3), so the verifier never warns on it. */
const HEADLINE_WORDS = 12;
const wordCount = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;
const joinNames = (names) => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * The headline for these facts at this tone, and the facts it rests on.
 * @param {BriefFact[]} facts
 * @param {'calm'|'watch'|'disrupted'} [tone]
 * @returns {{headline: string, fact_ids: string[]}}
 */
export function templateHeadline(facts, tone = computeTone(facts)) {
  const sorted = [...(facts || [])].sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));
  const top = sorted[0];
  const name = (f) => airportDisplayName(f.hub || '');
  const find = (re) => sorted.find((f) => re.test(f.id));

  // A ground stop or delay program holds flights INTO the airport, so the headline says "into".
  if (tone === 'disrupted') {
    const gs = find(/^faa\.active\.[A-Z]{3}\.gs$/);
    if (gs?.hub) return { headline: `A ground stop is holding flights into ${name(gs)}.`, fact_ids: [gs.id] };
    const closure = find(/^faa\.active\.[A-Z]{3}\.closure$/);
    if (closure?.hub) return { headline: `The FAA lists ${name(closure)} as closed.`, fact_ids: [closure.id] };
    // Delay programs at two or more hubs at once are what make a day without a stop disrupted.
    const gdps = sorted.filter((f) => f.hub && /^faa\.active\.[A-Z]{3}\.gdp$/.test(f.id));
    if (gdps.length >= 2) {
      const many = `Ground delay programs are holding flights into ${joinNames(gdps.map(name))}.`;
      return {
        headline: wordCount(many) <= HEADLINE_WORDS ? many : 'Ground delay programs are holding flights into several United hubs.',
        fact_ids: gdps.map((f) => f.id),
      };
    }
    if (gdps[0]) return { headline: `A ground delay program is holding flights into ${name(gdps[0])}.`, fact_ids: [gdps[0].id] };
    const otp = sorted.find((f) => /^otp\.[A-Z]{3}$/.test(f.id) && f.toneFloor === 'disrupted');
    if (otp?.hub) return { headline: `Delays are heavy at ${name(otp)}.`, fact_ids: [otp.id] };
    return { headline: "United's operation is disrupted right now.", fact_ids: top ? [top.id] : [] };
  }

  if (tone === 'watch') {
    // One hub's delay program is a watch, and the most concrete thing happening.
    const gdp = find(/^faa\.active\.[A-Z]{3}\.gdp$/);
    if (gdp?.hub) return { headline: `A ground delay program is holding flights into ${name(gdp)}.`, fact_ids: [gdp.id] };
    const lead = sorted.find((f) => f.toneFloor === 'watch');
    const planned = sorted.find((f) => f.kind === 'faa_planned' && f.hub);
    if (lead?.kind === 'faa_planned' && lead.hub) return { headline: `Running normally, with FAA action possible at ${name(lead)}.`, fact_ids: [lead.id] };
    if (lead?.hub && lead.kind === 'otp') return { headline: `Mostly normal, with delays at ${name(lead)}.`, fact_ids: [lead.id] };
    if (lead?.hub && lead.kind === 'weather') return { headline: `Weather is slowing ${name(lead)}.`, fact_ids: [lead.id] };
    if (lead?.hub && lead.kind === 'faa') return { headline: `Mostly normal, with FAA delays at ${name(lead)}.`, fact_ids: [lead.id] };
    if (lead?.hub && lead.kind === 'cancellations') return { headline: `Mostly normal, with cancellations at ${name(lead)}.`, fact_ids: [lead.id] };
    const elsewhere = lead && lead.id.match(/^faa\.active\.([A-Z]{3})\.(gs|gdp)$/);
    if (elsewhere) {
      const what = `${elsewhere[2] === 'gs' ? 'Ground stop' : 'Ground delay program'} for flights into ${airportDisplayName(elsewhere[1])}`;
      const long = `${what}; United's hubs are running normally.`;
      // A long airport name ("New York LaGuardia") would push it past the 12-word headline limit.
      return { headline: wordCount(long) <= HEADLINE_WORDS ? long : `${what}.`, fact_ids: [lead.id] };
    }
    if (planned) return { headline: `Running normally, with FAA action possible at ${name(planned)}.`, fact_ids: [planned.id] };
    return { headline: 'United is mostly running normally right now.', fact_ids: lead ? [lead.id] : [] };
  }

  return { headline: 'United is running smoothly right now.', fact_ids: [] };
}

/**
 * Pick the facts a template brief prints, most important first: every specific problem (severity at
 * or above LEAD_SEVERITY), then — when none of those explains the tone — the fact that sets it, then
 * the background a calm brief is made of: the on-time spread, the FAA picture, what is in the air.
 * @param {BriefFact[]} facts
 * @param {number} limit
 * @param {'calm'|'watch'|'disrupted'} tone
 * @returns {BriefFact[]}
 */
function pickItems(facts, limit, tone) {
  const index = byId(facts);
  const sorted = [...facts].sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));
  const picked = [];
  const add = (f) => { if (f && !picked.includes(f) && picked.length < limit) picked.push(f); };

  // Specific problems first: a ground stop at Newark, not "1 FAA program is in effect".
  for (const f of sorted) if (f.severity >= LEAD_SEVERITY && !SUMMARY_IDS.has(f.id)) add(f);

  // When nothing specific explains the tone, the fact that sets it does (the disruption index on a
  // day of unconfirmed cancellations), with the cancellation split that explains IT.
  if (tone !== 'calm' && !picked.some((f) => f.toneFloor === tone)) {
    const setter = sorted.find((f) => f.toneFloor === tone);
    // Delay programs at two hubs make the day disrupted through the hub-programs count; the
    // programs themselves, already listed, say it better than the count would.
    const explained = setter?.id === 'faa.active.count' && picked.some(isHubProgramFact);
    if (!explained) {
      add(setter);
      if (setter?.kind === 'network') {
        add(index.get('cxl.confirmed'));
        add(index.get('cxl.unconfirmed'));
      }
    }
  }

  // Background, in reading order. A planned program at a hub beats the general FAA count.
  add(index.get('otp.floor') || index.get('otp.soft') || index.get('otp.min'));
  const plannedHub = sorted.find((f) => f.kind === 'faa_planned' && f.hub);
  if (!picked.some((f) => f.kind === 'faa' || f.kind === 'faa_planned')) add(plannedHub || index.get('faa.active.count'));
  add(index.get('air.starlink') || index.get('air.total'));
  add(index.get('wx.summary'));
  return picked;
}

/**
 * Who the traveler note speaks to. A ground stop or delay program holds flights INTO the airport;
 * a closure stops both directions; a hub's on-time figure is about its departures.
 * @param {BriefFact} anchor
 */
function travelerWho(anchor) {
  const name = airportDisplayName(anchor.hub || '');
  if (/^faa\.active\.[A-Z]{3}\.(gs|gdp)$/.test(anchor.id)) return `flying to ${name}`;
  if (/^faa\.active\.[A-Z]{3}\.closure$/.test(anchor.id)) return `flying to or from ${name}`;
  if (anchor.kind === 'otp') return `flying out of ${name}`;
  return `flying through ${name}`;
}

/**
 * The template brief for these facts.
 * @param {BriefFact[]} facts
 * @returns {Brief}
 */
export function buildTemplateBrief(facts) {
  const list = Array.isArray(facts) ? facts : [];
  const tone = computeTone(list);
  const limit = tone === 'calm' ? 3 : 4;
  const items = pickItems(list, limit, tone).map((f) => ({ text: f.statement, fact_ids: [f.id] }));
  const { headline, fact_ids } = templateHeadline(list, tone);

  let traveler_note = null;
  if (travelerNoteAllowed(tone, list)) {
    // Anchored on the program travelers are held by, else the hub fact that makes the day disrupted.
    const bySeverity = [...list].sort((a, b) => b.severity - a.severity);
    const anchor = bySeverity.find((f) => f.hub && /^faa\.active\.[A-Z]{3}\.(gs|gdp|closure)$/.test(f.id))
      || bySeverity.find((f) => f.hub && f.toneFloor === 'disrupted');
    if (anchor) {
      traveler_note = {
        text: `If you are ${travelerWho(anchor)}, check your flight's status before you leave for the airport.`,
        fact_ids: [anchor.id],
      };
    }
  }
  return { headline, headline_fact_ids: fact_ids, tone, items, traveler_note };
}
