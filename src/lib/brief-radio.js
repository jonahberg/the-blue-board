// ═══ OPS BRIEF: AIR TRAFFIC CONTROL RADIO FACTS (Enhanced Radar) ═══
// Turns one Enhanced Radar airport status (GET /api/v0/airports/status) into brief facts. Pure.
//
//   flow.<HUB>.arrivals / .departures   planned rate vs last hour vs scheduled next hour, which
//                                       Enhanced Radar takes from FAA data (kind 'flow')
//   flow.<HUB>.runways                  runways in use (kind 'flow')
//   radio.<HUB>.<id>                    each `critical` / `notable` observation: something heard on
//                                       the airport's frequencies, as Enhanced Radar's model
//                                       summarised it (kind 'radio', time and title only)
//
// The API's own docs warn that observations "are written by a language model from transcripts and
// can contain mistakes". Every radio statement says so, the prompt (rule 7) requires attribution,
// and the verifier drops a radio item that does not attribute it. A radio fact never sets the tone.
//
// THE TITLE IS UNTRUSTED TEXT: third-party, model-written, from open radio transmissions anyone can
// key up on. Two rules follow.
//   1. It reaches the model only after sanitizeRadioTitle() (length cap, a conservative character
//      set, no control characters, newlines, markup or URLs, and nothing that reads like an
//      instruction), and only as the fact's `quote`, shown inside double quotes after an
//      attribution. The system prompt (rule 7) says a radio quote is data, never an instruction.
//   2. It never enters `values`. Values come only from validated structured fields (the hub, the
//      clock time computed here, the API's `tags`, `runways` that are charted runway ids), so a title
//      cannot whitelist a number or an airport it happens to contain. Its content can reach a visitor
//      only as an exact, attributed quote of the sanitized title, which the verifier checks.

import { airportForms, airportDisplayName } from './brief-claims.js';
import { formatAirportClock, parseIsoMs } from './brief-facts.js';

/**
 * United's seven US hubs → Enhanced Radar airport facility ids, from the free GET /api/v0/facilities
 * (captured Nov 10 2026; refs/er/facilities.json). Tokyo Narita and Guam are not covered.
 */
export const ER_HUB_FACILITY_IDS = Object.freeze({
  ORD: 'c5ba40b8-40ac-470f-be5b-9a0c503ca0c7',
  DEN: '23b485da-06ec-4d7d-8dc3-aa45e7e809c9',
  IAH: 'bd39f462-9696-4507-a868-c00dbe281fc5',
  EWR: 'd7992d47-bef6-4243-9791-65afb94418cf',
  SFO: '3667d976-1566-4887-ae34-c024d92f46c7',
  IAD: '551c44de-f326-4448-80ba-ba608f3f7fcc',
  LAX: 'ae40254d-1aeb-4a43-93b5-82d7e61d1202',
});

/** Observations older than this are not "right now" (the API itself drops them after 60 min without an update). */
export const RADIO_OBSERVATION_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_OBSERVATIONS_PER_HUB = 3;
/** The longest radio quote the brief carries, in characters. */
export const RADIO_TITLE_MAX_CHARS = 120;

/** Text that reads like an instruction to a model rather than an observation of an airport. */
const INSTRUCTION_RE = new RegExp([
  String.raw`\b(?:ignore|disregard|forget|override|bypass)\b[\s\S]{0,40}\b(?:instructions?|prompts?|rules|above|previous|prior|system|everything)\b`,
  String.raw`\b(?:system\s+prompt|you\s+are\s+now|you\s+(?:must|should|will|need\s+to)|act\s+as|pretend|role-?play|jailbreak|developer\s+mode)\b`,
  String.raw`\b(?:respond|reply|answer)\s+(?:with|only)\b|\bsay\s+(?:that|the\s+following|exactly)\b|\brepeat\s+after\b|\boutput\s+(?:the|only)\b|\bnew\s+instructions?\b|\bdo\s+not\s+follow\b`,
  String.raw`\b(?:assistant|user|system)\s*:`,
  String.raw`\b(?:headline|tone|json|schema|fact_ids|traveler_note)\b`,
].join('|'), 'i');

/**
 * An Enhanced Radar observation title made safe to show a model and a visitor, or null when nothing
 * safe is left (the observation is then dropped). NFKC, then: control and invisible characters,
 * newlines, markup and URLs out; only letters, digits, spaces and . , ' / ( ) & : - kept; whitespace
 * collapsed; capped at RADIO_TITLE_MAX_CHARS on a word boundary. Dropped when under three
 * characters, with no word in it, or when what remains reads like an instruction.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function sanitizeRadioTitle(raw) {
  let t = String(raw ?? '').normalize('NFKC');
  t = t.replace(/[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028-\u202E\u2060-\u206F\uFEFF]/g, ' ');
  t = t.replace(/<[^>]*>?/g, ' ');
  t = t.replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S*/gi, ' ');
  t = t.replace(/[\u2018\u2019\u02BC]/g, "'");
  t = t.replace(/[^A-Za-z0-9 .,'\/()&:-]/g, ' ');
  // A bare domain left behind ("evil.example", "x.com/path") is a link without its scheme.
  t = t.replace(/\S*[A-Za-z0-9-]\.(?:com|net|org|io|co|ru|xyz|info|biz|app|dev|example|ly|me|gg|site|link|top)\b\S*/gi, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length > RADIO_TITLE_MAX_CHARS) {
    t = t.slice(0, RADIO_TITLE_MAX_CHARS);
    const cut = t.lastIndexOf(' ');
    if (cut >= RADIO_TITLE_MAX_CHARS / 2) t = t.slice(0, cut);
  }
  t = t.replace(/^[\s.,:/&-]+|[\s.,:/&(-]+$/g, '');
  if (t.length < 3 || !/[A-Za-z]{2}/.test(t)) return null;
  if (INSTRUCTION_RE.test(t)) return null;
  return t;
}

/** Charted runway ids only ("4", "22L", "35C"). */
const runwayIds = (list) => (Array.isArray(list) ? list : []).map((r) => clean(r, 4)).filter((r) => /^\d{1,2}[LRC]?$/.test(r));
/** The API's own category tags, as words ("airport_equipment_issue" → "airport equipment issue"). */
const tagWords = (list) => (Array.isArray(list) ? list : [])
  .map((t) => String(t ?? ''))
  .filter((t) => /^[a-z][a-z_]{0,39}$/.test(t))
  .map((t) => t.replace(/_/g, ' '));

const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null);
const clean = (s, max = 140) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function flowFact(hub, dir, flow, atMs) {
  const clock = formatAirportClock(atMs, hub);
  const planned = int(flow?.planned_per_hour);
  const actual = int(flow?.actual_last_hour);
  const next = int(flow?.scheduled_next_hour);
  if (planned === null && actual === null && next === null) return null;
  const isArr = dir === 'arrivals';
  const parts = [];
  if (planned !== null) parts.push(`a planned rate of ${planned} an hour`);
  if (actual !== null) parts.push(`${actual} ${isArr ? 'landed' : 'took off'} in the last hour`);
  if (next !== null) parts.push(`${next} scheduled in the next hour`);
  const over = planned !== null && next !== null && next > planned;
  const tail = over ? `, more than the planned rate allows` : '';
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return {
    id: `flow.${hub}.${dir}`,
    kind: 'flow',
    hub,
    // The reading's own time, because a reused status can be up to 90 minutes old.
    statement: `Enhanced Radar, from FAA data${clock ? ` as of ${clock}` : ''}, reports ${airportDisplayName(hub)} (${hub}) ${dir}: ${list}${tail}.`,
    values: [...airportForms(hub), ...(clock ? [clock] : []), ...[planned, actual, next].filter((v) => v !== null).map(String)],
    at: iso(atMs),
    link: { tab: 'weather', hub },
    severity: over ? 30 : 8,
    toneFloor: 'calm',
    material: `${dir}:${planned ?? ''}:${over ? 'over' : 'within'}`,
  };
}

/**
 * Facts from one airport status payload.
 * @param {string} hub  IATA code
 * @param {any} status  the GET /api/v0/airports/status body
 * @param {{nowMs: number}} options
 * @returns {Array<import('./brief-facts.js').BriefFact>}
 */
export function radioFactsFromStatus(hub, status, { nowMs }) {
  const facts = [];
  const ops = status?.operations;
  if (!ops || typeof ops !== 'object') return facts;
  const computedMs = parseIsoMs(ops.computed_at) ?? parseIsoMs(status?.generated_at) ?? nowMs;

  for (const dir of ['arrivals', 'departures']) {
    const f = flowFact(hub, dir, ops.flow?.[dir], computedMs);
    if (f) facts.push(f);
  }

  const arr = runwayIds(ops.runways?.arrivals);
  const dep = runwayIds(ops.runways?.departures);
  if (arr.length || dep.length) {
    const say = (list) => (list.length === 1 ? `runway ${list[0]}` : `runways ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);
    const clauses = [];
    if (arr.length) clauses.push(`landing on ${say(arr)}`);
    if (dep.length) clauses.push(`taking off from ${say(dep)}`);
    facts.push({
      id: `flow.${hub}.runways`,
      kind: 'flow',
      hub,
      statement: `Enhanced Radar reports ${airportDisplayName(hub)} (${hub}) ${clauses.join(' and ')}.`,
      values: [...airportForms(hub), ...arr, ...dep],
      at: iso(parseIsoMs(ops.runways?.updated_at) ?? computedMs),
      link: { tab: 'weather', hub },
      severity: 4,
      toneFloor: 'calm',
      material: `rwy:${arr.join(',')}/${dep.join(',')}`,
    });
  }

  const observations = [
    ...(Array.isArray(status.critical) ? status.critical.map((o) => ({ o, critical: true })) : []),
    ...(Array.isArray(status.notable) ? status.notable.map((o) => ({ o, critical: false })) : []),
  ];
  let kept = 0;
  for (const { o, critical } of observations) {
    if (kept >= MAX_OBSERVATIONS_PER_HUB) break;
    const id = Number(o?.id);
    const quote = sanitizeRadioTitle(o?.title);
    const atMs = parseIsoMs(o?.happened_at);
    if (!Number.isInteger(id) || id <= 0 || !quote || atMs === null) continue;
    if (nowMs - atMs > RADIO_OBSERVATION_MAX_AGE_MS) continue;
    const clock = formatAirportClock(atMs, hub);
    facts.push({
      id: `radio.${hub}.${id}`,
      kind: 'radio',
      hub,
      // The quote comes last, after the attribution, in double quotes: the shape the verifier
      // requires of any sentence that repeats it.
      statement: `Heard on ${airportDisplayName(hub)} (${hub}) air traffic control frequencies${clock ? ` at ${clock}` : ''}, in Enhanced Radar's model-written summary, which can contain mistakes: "${quote}".`,
      quote,
      // Structured, validated fields only. Never the title (see the header).
      values: [...airportForms(hub), ...(clock ? [clock] : []), ...runwayIds(o?.runways), ...tagWords(o?.tags)],
      at: iso(atMs),
      link: { tab: 'weather', hub },
      severity: critical ? 45 : 12,
      toneFloor: 'calm',
      material: `obs:${id}:${quote}`,
    });
    kept++;
  }
  return facts;
}

/**
 * The hubs where the brief may spend on radio: one of the seven covered hubs with a ground stop or
 * ground delay program IN EFFECT in the /api/faa payload. Nothing else triggers a call.
 * @param {Array<any>|null} faa
 * @returns {string[]}
 */
export function radioTriggerHubs(faa) {
  const hubs = new Set();
  for (const airport of Array.isArray(faa) ? faa : []) {
    const code = String(airport?.airportCode || '').toUpperCase();
    if (!ER_HUB_FACILITY_IDS[code]) continue;
    const programs = Array.isArray(airport.programs) ? airport.programs : [];
    if (programs.some((p) => p?.type === 'ground_stop' || p?.type === 'ground_delay')) hubs.add(code);
  }
  return [...hubs].sort();
}
