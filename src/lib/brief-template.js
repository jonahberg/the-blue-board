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
/** A slot freed by a left-out weather item goes to a specific fact at or above this severity. */
const FREED_SLOT_SEVERITY = 10;

/** Aggregates and meta facts: background for a calm brief, never the lead when a specific fact exists. */
const SUMMARY_IDS = new Set([
  'faa.active.count', 'faa.active.other', 'faa.planned.count', 'net.status', 'net.index', 'wx.summary',
  'otp.floor', 'otp.soft', 'otp.min', 'cxl.confirmed', 'cxl.unconfirmed', 'air.total',
  'air.starlink', 'air.normal',
]);

/** The cause values an FAA program fact carries when its cause is weather (faaCausePhrase). */
const WEATHER_CAUSE_VALUES = new Set(['weather', 'thunderstorms', 'snow', 'ice', 'wind', 'low clouds', 'low visibility', 'rain']);

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
  const gdps = sorted.filter((f) => f.hub && /^faa\.active\.[A-Z]{3}\.gdp$/.test(f.id));

  // A ground stop or delay program holds flights INTO the airport, so the headline says "into".
  if (tone === 'disrupted') {
    const gs = find(/^faa\.active\.[A-Z]{3}\.gs$/);
    if (gs?.hub) return { headline: `A ground stop is holding flights into ${name(gs)}.`, fact_ids: [gs.id] };
    const closure = find(/^faa\.active\.[A-Z]{3}\.closure$/);
    if (closure?.hub) return { headline: `The FAA lists ${name(closure)} as closed.`, fact_ids: [closure.id] };
    if (gdps.length) return delayProgramHeadline(gdps, name);
    const otp = sorted.find((f) => /^otp\.[A-Z]{3}$/.test(f.id) && f.toneFloor === 'disrupted');
    if (otp?.hub) return { headline: `Delays are heavy at ${name(otp)}.`, fact_ids: [otp.id] };
    return { headline: "United's operation is disrupted right now.", fact_ids: top ? [top.id] : [] };
  }

  if (tone === 'watch') {
    // Delay programs at hubs are a watch however many there are, and the most concrete news.
    if (gdps.length) return delayProgramHeadline(gdps, name);
    const lead = sorted.find((f) => f.toneFloor === 'watch');
    const planned = sorted.find((f) => f.kind === 'faa_planned' && f.hub);
    // No "calm", "smooth" or "running normally" in a watch headline: the verifier replaces those
    // when the tone is not calm (headline:calm_when_not_calm), and this is the replacement.
    if (lead?.kind === 'faa_planned' && lead.hub) return { headline: `FAA action is possible at ${name(lead)}; none is in effect.`, fact_ids: [lead.id] };
    if (lead?.hub && lead.kind === 'otp') return { headline: `Mostly normal, with delays at ${name(lead)}.`, fact_ids: [lead.id] };
    if (lead?.hub && lead.kind === 'weather') return { headline: `Weather is slowing ${name(lead)}.`, fact_ids: [lead.id] };
    if (lead?.hub && lead.kind === 'faa') return { headline: `Mostly normal, with FAA delays at ${name(lead)}.`, fact_ids: [lead.id] };
    if (lead?.hub && lead.kind === 'cancellations') return { headline: `Mostly normal, with cancellations at ${name(lead)}.`, fact_ids: [lead.id] };
    const elsewhere = lead && lead.id.match(/^faa\.active\.([A-Z]{3})\.(gs|gdp)$/);
    if (elsewhere) {
      const what = elsewhere[2] === 'gs' ? 'Ground stop' : 'Ground delay program';
      return { headline: `${what} for flights into ${airportDisplayName(elsewhere[1])}.`, fact_ids: [lead.id] };
    }
    if (planned) return { headline: `FAA action is possible at ${name(planned)}; none is in effect.`, fact_ids: [planned.id] };
    return { headline: 'United is mostly normal right now.', fact_ids: lead ? [lead.id] : [] };
  }

  return { headline: 'United is running smoothly right now.', fact_ids: [] };
}

/**
 * The headline for delay programs at hubs: one names its hub, several name theirs (or, past the
 * 12-word limit, say "several United hubs").
 * @param {BriefFact[]} gdps
 * @param {(f: BriefFact) => string} name
 * @returns {{headline: string, fact_ids: string[]}}
 */
function delayProgramHeadline(gdps, name) {
  if (gdps.length === 1) return { headline: `A ground delay program is holding flights into ${name(gdps[0])}.`, fact_ids: [gdps[0].id] };
  const many = `Ground delay programs are holding flights into ${joinNames(gdps.map(name))}.`;
  return {
    headline: wordCount(many) <= HEADLINE_WORDS ? many : 'Ground delay programs are holding flights into several United hubs.',
    fact_ids: gdps.map((f) => f.id),
  };
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

  // Specific problems first: a ground stop at Newark, not "1 FAA program is in effect". The
  // weather behind a hub's ground stop or delay program is already in that program's item
  // ("because of low clouds"), so the hub's own weather item is left out and its slot goes to the
  // next specific fact (prompt rule 4). A program for another cause (traffic, construction)
  // leaves it in.
  const weatherInProgram = new Set(facts
    .filter((f) => isHubProgramFact(f) && (f.values || []).some((v) => WEATHER_CAUSE_VALUES.has(v)))
    .map((f) => `wx.${f.hub}`));
  let freed = 0;
  for (const f of sorted) {
    if (f.severity < LEAD_SEVERITY || SUMMARY_IDS.has(f.id)) continue;
    if (weatherInProgram.has(f.id)) freed++;
    else add(f);
  }
  // A freed slot goes to the next specific fact by severity that is worth a line (a hub's
  // cancellations, caution weather elsewhere), never a healthy hub's reading; with none, the
  // background below fills it.
  for (const f of sorted) {
    if (freed === 0) break;
    if (f.severity < FREED_SLOT_SEVERITY || SUMMARY_IDS.has(f.id) || weatherInProgram.has(f.id) || picked.includes(f)) continue;
    add(f);
    freed--;
  }

  // When nothing specific explains the tone, the fact that sets it does (the disruption index on a
  // day of unconfirmed cancellations), with the cancellation split that explains IT.
  if (tone !== 'calm' && !picked.some((f) => f.toneFloor === tone)) {
    const setter = sorted.find((f) => f.toneFloor === tone);
    add(setter);
    if (setter?.kind === 'network') {
      add(index.get('cxl.confirmed'));
      add(index.get('cxl.unconfirmed'));
    }
  }

  // Background, in reading order. A planned program at a hub beats the general FAA count.
  add(index.get('otp.floor') || index.get('otp.soft') || index.get('otp.min'));
  const plannedHub = sorted.find((f) => f.kind === 'faa_planned' && f.hub);
  if (!picked.some((f) => f.kind === 'faa' || f.kind === 'faa_planned')) add(plannedHub || index.get('faa.active.count'));
  // What is in the air, and the hub-weather tally, are a calm day's background; when something is
  // wrong they are padding (the tally would repeat a program's weather), and a shorter brief is better.
  if (tone === 'calm') {
    add(index.get('air.starlink') || index.get('air.total'));
    add(index.get('wx.summary'));
  }
  return picked;
}

/**
 * Who the traveler note speaks to. A ground stop or delay program holds flights INTO the airport;
 * a closure stops both directions; a hub's on-time figure is about its departures. Two airports
 * are both named; three or more are "those airports" (the items above name them).
 * @param {BriefFact[]} anchors  one per hub, most severe first
 */
function travelerWho(anchors) {
  const [anchor] = anchors;
  const name = (f) => airportDisplayName(f.hub || '');
  const isProgram = (f) => /^faa\.active\.[A-Z]{3}\.(gs|gdp|closure)$/.test(f.id);
  if (anchors.length > 1) {
    const verb = anchors.some((f) => /\.closure$/.test(f.id)) ? 'flying to or from' : 'flying to';
    return anchors.length === 2 ? `${verb} ${name(anchors[0])} or ${name(anchors[1])}` : `${verb} one of those airports`;
  }
  if (isProgram(anchor) && !/\.closure$/.test(anchor.id)) return `flying to ${name(anchor)}`;
  if (/\.closure$/.test(anchor.id)) return `flying to or from ${name(anchor)}`;
  if (anchor.kind === 'otp') return `flying out of ${name(anchor)}`;
  return `flying through ${name(anchor)}`;
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
    // Anchored on every hub's program travelers are held by (one per hub, most severe first, at
    // most 8 citations), else the hub fact that makes the day disrupted.
    const bySeverity = [...list].sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));
    const programs = [];
    for (const f of bySeverity) {
      if (f.hub && /^faa\.active\.[A-Z]{3}\.(gs|gdp|closure)$/.test(f.id) && !programs.some((p) => p.hub === f.hub)) programs.push(f);
    }
    const fallback = bySeverity.find((f) => f.hub && f.toneFloor === 'disrupted');
    const anchors = programs.length ? programs.slice(0, 8) : fallback ? [fallback] : [];
    if (anchors.length) {
      traveler_note = {
        text: `If you are ${travelerWho(anchors)}, check your flight's status before you leave for the airport.`,
        fact_ids: anchors.map((f) => f.id),
      };
    }
  }
  return { headline, headline_fact_ids: fact_ids, tone, items, traveler_note };
}
