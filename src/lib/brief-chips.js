// ═══ OPS BRIEF: CHIPS ═══
// The proof under every sentence of the brief: one chip per fact the sentence cites, with a short
// label and, when the dashboard has a place that shows that fact, a link there. DOM-free; the
// server never sends display labels (docs/specs/ops-brief.md, "Deep links the chips need").
//
// Labels come from a fact's `id`, `kind`, `hub` and `values` only, never by parsing its
// `statement` (statement wording is the server's to change). Clock times come from the fact's
// own `values`, which are on the AIRPORT's clock, so a radio chip reads "5:29 PM ET" exactly as
// its sentence does. Anything unrecognised still gets a label, from its kind.
//
// Targets are deliberately stricter than the server's `link`: a chip links only where the
// destination actually shows the fact (see `chipTarget`). The hrefs are real deep links that
// resolve on a cold load (src/app/state/deep-links.ts), so a middle-click opens the same place.

import { WEATHER_CARD_HUBS } from './tab-hash.js';

/**
 * @typedef {{id: string, kind: string, hub?: string, statement: string, values: string[],
 *   quote?: string, at: string|null, link?: {tab: string, hub?: string, section?: string}|null}} PublicFact
 * @typedef {{href: string, tab: string}} ChipTarget
 * @typedef {'radio'|'alert'|'warn'|'plain'} ChipTone
 * @typedef {{id: string, label: string, tone: ChipTone, target: ChipTarget|null, title: string}} Chip
 */

const CODE_RE = /^[A-Z]{3}$/;
const PCT_RE = /^\d+(?:\.\d+)?%$/;
const COUNT_RE = /^\d[\d,]*(?:\.\d+)?$/;
/** A clock value as brief-facts.js formats it: "9:00 PM ET", "4:00 PM PT", "10:15 AM JST". */
const CLOCK_RE = /^\d{1,2}:\d{2}\s?[AP]M(?:\s[A-Z]{1,5})?$/;

const valuesOf = (fact) => (Array.isArray(fact?.values) ? fact.values.map((v) => String(v)) : []);
const first = (fact, re) => valuesOf(fact).find((v) => re.test(v.trim()))?.trim() ?? null;
const codes = (fact) => [...new Set(valuesOf(fact).filter((v) => CODE_RE.test(v)))];

/** The airport an id names: 'faa.active.EWR.gs' → EWR, 'radio.EWR.123' → EWR. */
function idCode(id, index) {
  const part = String(id ?? '').split('.')[index];
  return part && CODE_RE.test(part) ? part : null;
}

function hubOf(fact, index = 1) {
  const hub = String(fact?.hub ?? '').toUpperCase();
  return CODE_RE.test(hub) ? hub : idCode(fact?.id, index);
}

const FAA_ACTIVE_WORDS = {
  gs: 'ground stop',
  gdp: 'delay program',
  closure: 'closure',
  dep: 'departure delays',
  arr: 'arrival delays',
};

/** What a fact of an unrecognised id is called, by its kind. */
const KIND_FALLBACK = {
  otp: 'On-time',
  network: 'Network status',
  cancellations: 'Cancellations',
  faa: 'FAA',
  faa_planned: 'FAA plan',
  weather: 'Weather',
  airborne: 'In the air',
  flow: 'Airport flow',
  radio: 'ATC radio',
};

/**
 * The chip's text: short, mono-friendly, compared character by character.
 * @param {PublicFact} fact
 * @returns {string}
 */
export function chipLabel(fact) {
  const id = String(fact?.id ?? '');
  const parts = id.split('.');
  const [head, second, third] = parts;
  const pct = first(fact, PCT_RE);
  const count = first(fact, COUNT_RE);

  if (head === 'otp') {
    const hub = hubOf(fact);
    if (second === 'min' && hub && pct) return `Lowest ${hub} ${pct}`;
    if (second === 'floor' && count && pct) return `${count} hubs ≥ ${pct}`;
    if (second === 'soft') {
      const soft = codes(fact);
      if (soft.length >= 1 && soft.length <= 3) return `${soft.join(' ')} under 70%`;
      if (count) return `${count} hubs under 70%`;
    }
    if (second && CODE_RE.test(second) && pct) return `${second} ${pct}`;
  }

  if (head === 'net') {
    if (second === 'index' && count) return `Disruption index ${count}`;
    if (second === 'status') return 'Network status';
  }

  if (head === 'cxl') {
    if (second === 'confirmed' && count) return `${count} canceled`;
    if (second === 'unconfirmed' && count) return `${count} unconfirmed`;
    if (second && CODE_RE.test(second) && count) return `${second} ${count} canceled`;
  }

  if (head === 'faa' && second === 'active') {
    if (third === 'count' && count) return count === '0' ? 'FAA · no hub programs' : `FAA · ${count} at hubs`;
    if (third === 'other' && count) return `FAA · ${count} elsewhere`;
    const code = idCode(id, 2);
    const word = FAA_ACTIVE_WORDS[parts[3]];
    if (code && word) return `FAA ${word} · ${code}`;
  }

  if (head === 'faa' && second === 'planned') {
    if (third === 'count' && count) return `FAA plan · ${count} possible`;
    const code = idCode(id, 2);
    if (code) return `FAA plan · ${code}`;
  }

  if (head === 'wx') {
    if (second === 'summary') return 'Hub weather';
    if (second && CODE_RE.test(second)) return `${second} weather`;
  }

  if (head === 'air') {
    if (second === 'total' && count) return `${count} airborne`;
    if (second === 'starlink' && count) return `${count} Starlink`;
    if (second === 'normal') {
      const median = count;
      const days = valuesOf(fact).find((v, i) => i > 0 && COUNT_RE.test(v) && Number(v) <= 31) ?? null;
      if (median && days) return `${days}-day median ${median}`;
      if (median) return `Usual ${median}`;
    }
  }

  if (head === 'flow') {
    const hub = hubOf(fact);
    const what = third === 'arrivals' ? 'arrivals' : third === 'departures' ? 'departures' : third === 'runways' ? 'runways' : null;
    if (hub && what) return `${hub} ${what}`;
  }

  if (head === 'radio' || fact?.kind === 'radio') {
    const clock = first(fact, CLOCK_RE);
    if (clock) return `ATC radio · ${clock}`;
    const hub = hubOf(fact);
    return hub ? `ATC radio · ${hub}` : 'ATC radio';
  }

  const hub = hubOf(fact);
  const base = KIND_FALLBACK[fact?.kind] ?? 'Source';
  return hub ? `${base} · ${hub}` : base;
}

/**
 * How the chip is coloured. Radio is info-blue with an antenna icon (never Starlink violet: that
 * token means Starlink). A ground stop or closure at a hub is red ('alert'); a ground delay
 * program at a hub is amber ('warn'), as the hub strip marks it and as the brief's own tone reads
 * ("Watch") when it is the only one. The label already says which program, so colour is never the
 * only signal. Everything else is plain.
 * @param {PublicFact} fact
 * @returns {ChipTone}
 */
export function chipTone(fact) {
  if (fact?.kind === 'radio') return 'radio';
  const m = String(fact?.id ?? '').match(/^faa\.active\.([A-Z]{3})\.(gs|gdp|closure)$/);
  if (m && WEATHER_CARD_HUBS.includes(m[1])) return m[2] === 'gdp' ? 'warn' : 'alert';
  return 'plain';
}

const SCHEDULE_HUBS = WEATHER_CARD_HUBS;

/**
 * Where the chip goes, or null when nothing in the dashboard shows the fact. Starts from the
 * server's `link` and keeps it only where the destination really is the proof:
 *
 *   on-time / cancellations at a hub,
 *     and the on-time floor            → that hub's Schedule board (for the floor, the
 *                                        server links the lowest hub)          /?tab=schedule&hub=ORD
 *   soft hubs                          → the first soft hub's board
 *   index, network status,
 *     cancellation totals              → the IROPS bar (its Canceled figure is the same
 *                                        /api/irops number; the server's unfiltered
 *                                        Schedule link shows one hub)           /?tab=irops
 *   FAA program, hub weather at a hub → that hub's card on the Weather tab   /?tab=weather&hub=EWR
 *   FAA plan (possible programs)      → the NAS status panel, which lists them /?tab=weather&section=nas
 *   hub programs count, weather summary → the Weather tab                     /#weather
 *   airborne counts                   → Live, Starlink                         /#live, /#starlink
 *
 * No target: a program at an airport without a card (BOS, LGA: /api/faa programs elsewhere are
 * not shown anywhere), and radio and flow facts (no radio or airport-flow view exists yet).
 * @param {PublicFact} fact
 * @returns {ChipTarget|null}
 */
export function chipTarget(fact) {
  const id = String(fact?.id ?? '');
  const kind = String(fact?.kind ?? '');
  const link = fact?.link && typeof fact.link === 'object' ? fact.link : null;
  if (!link || kind === 'radio' || kind === 'flow') return null;
  const linkHub = String(link.hub ?? '').toUpperCase();

  if (link.tab === 'schedule') {
    if (SCHEDULE_HUBS.includes(linkHub)) return { tab: 'schedule', href: `/?tab=schedule&hub=${linkHub}` };
    if (kind === 'cancellations') return { tab: 'weather', href: '/?tab=irops' };
    return null;
  }

  if (link.tab === 'weather') {
    if (link.section === 'irops') {
      // Soft hubs are not on the IROPS bar; the first one named (the lowest) has a board that
      // shows it. The index and the network status are the bar.
      const low = kind === 'otp' ? codes(fact).find((c) => SCHEDULE_HUBS.includes(c)) : null;
      if (low) return { tab: 'schedule', href: `/?tab=schedule&hub=${low}` };
      return { tab: 'weather', href: '/?tab=irops' };
    }
    if (kind === 'faa_planned') return { tab: 'weather', href: '/?tab=weather&section=nas' };
    if (linkHub) {
      return WEATHER_CARD_HUBS.includes(linkHub) ? { tab: 'weather', href: `/?tab=weather&hub=${linkHub}` } : null;
    }
    // No hub: the hub-programs count and the weather summary are the cards themselves. A count of
    // programs at OTHER airports is not shown anywhere on the tab.
    if (id === 'faa.active.other') return null;
    return { tab: 'weather', href: '/#weather' };
  }

  if (link.tab === 'live') return { tab: 'live', href: '/#live' };
  if (link.tab === 'starlink') return { tab: 'starlink', href: '/#starlink' };
  return null;
}

/**
 * The chips for one sentence: one per cited fact the response carries, in citation order, with
 * duplicate labels folded (otp.min and otp.LAX both read "LAX 85%"-ish only once). Unknown ids are
 * skipped rather than shown as an empty chip.
 * @param {string[]} factIds
 * @param {Map<string, PublicFact>} factsById
 * @returns {Chip[]}
 */
export function itemChips(factIds, factsById) {
  const out = [];
  const seen = new Set();
  for (const id of Array.isArray(factIds) ? factIds : []) {
    const fact = factsById.get(id);
    if (!fact) continue;
    const label = chipLabel(fact);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ id: fact.id, label, tone: chipTone(fact), target: chipTarget(fact), title: String(fact.statement ?? '') });
  }
  return out;
}
