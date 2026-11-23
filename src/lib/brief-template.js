// ═══ OPS BRIEF: TEMPLATE ═══
// The brief code writes when the model does not: the model call failed, its JSON was invalid, the
// spend cap was hit, generation is switched off, or no item survived verification. Built only from
// fact statements and a handful of fixed headlines, so every word of it is grounded by construction
// (tests run every fixture's template through the verifier). It must read acceptably on its own:
// this is what every visitor sees whenever the model is not available.

import { airportDisplayName, airportOwnNames } from './brief-claims.js';
import {
  computeTone, hubsWithProblems, impairedHubs, isAirborneShortfallFact, isHubProgramFact, isNonHubProgramFact, programAirport,
  travelerNoteAllowed,
} from './brief-facts.js';
import { NETWORK_WATCH_INDEX_WITH_ONE_HUB } from './ops-health.js';

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
/** Programs away from the hubs a template prints, at most (the rest stay in the facts). */
const NON_HUB_TEMPLATE_ITEMS = 2;

/** Aggregates and meta facts: background for a calm brief, never the lead when a specific fact exists. */
const SUMMARY_IDS = new Set([
  'faa.active.count', 'faa.active.other', 'faa.planned.count', 'net.status', 'net.index', 'wx.summary',
  'otp.floor', 'otp.soft', 'otp.min', 'cxl.confirmed', 'cxl.unconfirmed', 'air.total',
  'air.starlink', 'air.normal',
]);
/**
 * Background, except the in-the-air comparison on a day it sets the tone: far fewer flights flying
 * than usual is the story then, not filler (Nov 13 2026, the nationwide ground stop).
 */
const isSummary = (f) => SUMMARY_IDS.has(f.id) && !isAirborneShortfallFact(f);

/** The headline when far fewer United flights are in the air than usual. It says what is seen, not why. */
const SHORTFALL_HEADLINE = Object.freeze({
  disrupted: 'Far fewer United flights are in the air than usual right now.',
  watch: 'Fewer United flights than usual are in the air right now.',
});

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

  // Far fewer flights flying than usual is the whole network, so it leads over any one airport.
  const shortfall = sorted.find(isAirborneShortfallFact);
  if (shortfall?.toneFloor === 'disrupted') return { headline: SHORTFALL_HEADLINE.disrupted, fact_ids: [shortfall.id] };

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

  // The impaired hubs (brief-facts.js `impairs`), each with its most severe fact.
  const impaired = impairedHubs(sorted);
  const leadFor = (hub) => /** @type {BriefFact} */ (sorted.find((f) => f.impairs === hub));

  if (tone === 'watch') {
    // "Watch" is network-wide (Nov 22 2026), so no "normal" in it, mostly or otherwise. No "calm",
    // "smooth" or "running normally" either: the verifier replaces those when the tone is not calm
    // (headline:calm_when_not_calm), and this is the replacement.
    // Delay programs at hubs are the most concrete news.
    if (gdps.length) return delayProgramHeadline(gdps, name);
    if (shortfall?.toneFloor === 'watch') return { headline: SHORTFALL_HEADLINE.watch, fact_ids: [shortfall.id] };
    if (impaired.length >= 2) {
      const leads = impaired.map(leadFor);
      const many = `Delays are building at ${joinNames(leads.map(name))}.`;
      return {
        headline: wordCount(many) <= HEADLINE_WORDS ? many : 'Delays are building at several United hubs.',
        fact_ids: leads.map((f) => f.id),
      };
    }
    // One impaired hub and the disruption index at 30 or more (or the hubs' average under 70%).
    const network = factById(sorted, 'net.index') || factById(sorted, 'net.status');
    if (impaired.length === 1) {
      const lead = leadFor(impaired[0]);
      const ids = [lead.id, ...(network ? [network.id] : [])];
      return { headline: `${capitalize(oneHubTrouble(lead, name))}; delays are up across the network.`, fact_ids: ids };
    }
    return { headline: "Delays are up across United's network right now.", fact_ids: network ? [network.id] : top ? [top.id] : [] };
  }

  // Calm, with one hub impaired (Nov 22 2026): that hub leads, then the rest when nothing else at a
  // hub needs naming ("Newark is running behind; the other hubs are running normally.").
  if (impaired.length) return calmImpairedHubHeadline(leadFor(impaired[0]), sorted, name);

  // Calm, with a healthy hub trailing the others: that hub, then the rest (Nov 2026).
  const trailing = sorted.find((f) => f.outlier === true);
  if (trailing) return { headline: `${name(trailing)} trails the other hubs, which are running normally.`, fact_ids: [trailing.id] };
  // Calm, with the lowest hub under 80% but not soft (the lowest-hub fact, below its soft severity):
  // named as the watch headline named it before Nov 22 2026, when such a day was usually a watch.
  const min = sorted.find((f) => f.id === 'otp.min' && f.severity < 40);
  const behind = min ? sorted.find((f) => f.id === `otp.${min.hub}`) : undefined;
  if (behind?.hub) {
    const othersFine = hubsWithProblems(sorted).every((h) => h === behind.hub);
    return {
      headline: othersFine ? `${name(behind)} trails the other hubs, which are running normally.` : `${name(behind)} is running behind the other hubs.`,
      fact_ids: [behind.id],
    };
  }
  // Calm, with FAA delays under 45 minutes or weather at a hub: neither sets the tone (Nov 22 2026),
  // but the headline names the hubs rather than calling the whole operation smooth.
  const hubDelays = firstPerHub(sorted.filter((f) => f.hub && /^faa\.active\.[A-Z]{3}\.(dep|arr)$/.test(f.id)));
  if (hubDelays.length) return namedHubsHeadline('FAA delays are slowing', hubDelays, sorted, name);
  const hubWeather = firstPerHub(sorted.filter((f) => f.hub && /^wx\.[A-Z]{3}$/.test(f.id) && f.material !== null));
  if (hubWeather.length) return namedHubsHeadline('Weather is slowing', hubWeather, sorted, name);
  // Calm, with a stop or delay program away from the hubs: the hubs first, then the program
  // (Nov 2026), never the program alone (brief-verify.js headline:leads_with_non_hub_program).
  const away = sorted.filter(isNonHubProgramFact);
  if (away.length) return nonHubProgramHeadline(away);
  return { headline: 'United is running smoothly right now.', fact_ids: [] };
}

/**
 * Something wrong at a hub on a calm day (Nov 22 2026): one impaired hub, or a hub a headline would
 * have to name (hubsWithProblems: under 80%, FAA delays, weather at warning level), other than a
 * healthy hub that only trails the others.
 * @param {BriefFact[]} facts
 */
function troubleAtHub(facts) {
  return impairedHubs(facts).length > 0 || hubsWithProblems(facts.filter((f) => f.outlier !== true)).length > 0;
}

/** The fact with this id, or undefined. */
const factById = (facts, id) => facts.find((f) => f.id === id);
/** The first fact for each hub, in the order given. */
const firstPerHub = (facts) => facts.filter((f, i) => facts.findIndex((g) => g.hub === f.hub) === i);

/**
 * "<lead> Newark and Chicago O'Hare; the other hubs are running normally." for the hubs these facts
 * are about (most severe first), the tail only when no other hub has something to name
 * (hubsWithProblems) and it fits the prompt's 12 words; otherwise the clause alone.
 * @param {string} lead
 * @param {BriefFact[]} named  one fact per hub
 * @param {BriefFact[]} facts
 * @param {(f: BriefFact) => string} name
 * @returns {{headline: string, fact_ids: string[]}}
 */
function namedHubsHeadline(lead, named, facts, name) {
  const hubs = named.map((f) => f.hub);
  const clause = `${lead} ${joinNames(named.map(name))}`;
  const othersFine = hubsWithProblems(facts).every((h) => hubs.includes(h));
  const candidates = [
    ...(othersFine ? [`${clause}; the other hubs are running normally.`, `${clause}; the other hubs are normal.`] : []),
    `${clause}.`,
  ];
  const fits = candidates.find((h) => wordCount(h) <= HEADLINE_WORDS) ?? candidates[candidates.length - 1];
  return { headline: fits, fact_ids: named.map((f) => f.id) };
}
const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * One impaired hub's trouble as a clause, from its most severe fact: "Newark is running behind",
 * "FAA delays are slowing Newark", "Newark has unusual cancellations", "Newark has a ground delay
 * program". Every name in it is in the fact's own values.
 * @param {BriefFact} lead
 * @param {(f: BriefFact) => string} name
 */
function oneHubTrouble(lead, name) {
  if (/\.gdp$/.test(lead.id)) return `${name(lead)} has a ground delay program`;
  if (lead.kind === 'faa') return `FAA delays are slowing ${name(lead)}`;
  if (lead.kind === 'cancellations') return `${name(lead)} has unusual cancellations`;
  return `${name(lead)} is running behind`;
}

/**
 * The calm headline with one hub impaired (Nov 22 2026): that hub and its trouble first, then "the
 * other hubs are running normally" when no other hub has something a headline would have to name
 * first (hubsWithProblems), within the prompt's 12 words. A delay program reads "Newark has a ground
 * delay program; the other hubs are running normally." (or "… are normal." for a two-word name).
 * @param {BriefFact} lead  the impaired hub's most severe fact
 * @param {BriefFact[]} facts
 * @param {(f: BriefFact) => string} name
 * @returns {{headline: string, fact_ids: string[]}}
 */
function calmImpairedHubHeadline(lead, facts, name) {
  const othersFine = hubsWithProblems(facts).every((h) => h === lead.impairs);
  const clause = capitalize(oneHubTrouble(lead, name));
  if (!othersFine) {
    const alone = /\.gdp$/.test(lead.id) ? `A ground delay program is holding flights into ${name(lead)}.` : `${clause}.`;
    return { headline: alone, fact_ids: [lead.id] };
  }
  const candidates = [`${clause}; the other hubs are running normally.`, `${clause}; the other hubs are normal.`];
  const fits = candidates.find((h) => wordCount(h) <= HEADLINE_WORDS) ?? candidates[candidates.length - 1];
  return { headline: fits, fact_ids: [lead.id] };
}

/**
 * The calm headline when stop or delay programs are in effect only away from the hubs: the hubs'
 * condition first, then the program, within the prompt's 12 words (rule 3). One program is named
 * ("United's hubs are running normally; a delay program is slowing Seattle arrivals."), two are
 * named when they fit, otherwise "elsewhere".
 * @param {BriefFact[]} away  most severe first
 * @returns {{headline: string, fact_ids: string[]}}
 */
function nonHubProgramHeadline(away) {
  // The display name first, then any shorter name that stands for that airport alone
  // ("New York LaGuardia", then "LaGuardia").
  const nameSets = away.map((f) => {
    const own = airportOwnNames(programAirport(f));
    return own.length ? own : [airportDisplayName(programAirport(f))];
  });
  const stops = away.filter((f) => /\.gs$/.test(f.id)).length;
  const phrases = [];
  if (away.length === 1) {
    for (const n of nameSets[0]) phrases.push(stops ? `a ground stop is holding ${n} arrivals` : `a delay program is slowing ${n} arrivals`);
  } else if (away.length === 2) {
    const what = stops === 2 ? 'ground stops are holding' : stops === 0 ? 'delay programs are slowing' : 'FAA programs are slowing';
    for (const a of nameSets[0]) for (const b of nameSets[1]) phrases.push(`${what} ${a} and ${b} arrivals`);
  }
  const candidates = [
    ...phrases.flatMap((p) => [`United's hubs are running normally; ${p}.`, `United's hubs are normal; ${p}.`]),
    `United's hubs are running normally; ${away.length === 1 ? 'an FAA program is' : 'FAA programs are'} slowing flights elsewhere.`,
  ];
  const fits = candidates.find((h) => wordCount(h) <= HEADLINE_WORDS) ?? candidates[candidates.length - 1];
  return { headline: fits, fact_ids: away.map((f) => f.id) };
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

  // With nothing wrong at the hubs, the brief opens by saying so (Nov 2026): the hub that trails
  // the others when one does, then the summary of the rest. With one hub impaired on a calm day,
  // that hub's facts open it instead (Nov 22 2026), as the specific problems below.
  const outlier = sorted.find((f) => f.outlier === true);
  const impaired = impairedHubs(facts);
  if (tone === 'calm' && impaired.length === 0) { add(outlier); add(index.get('otp.floor')); }

  // Specific problems first: a ground stop at Newark, not "1 FAA program is in effect". The
  // weather behind a hub's ground stop or delay program is already in that program's item
  // ("because of low clouds"), so the hub's own weather item is left out and its slot goes to the
  // next specific fact (prompt rule 4). A program for another cause (traffic, construction)
  // leaves it in.
  const weatherInProgram = new Set(facts
    .filter((f) => isHubProgramFact(f) && (f.values || []).some((v) => WEATHER_CAUSE_VALUES.has(v)))
    .map((f) => `wx.${f.hub}`));
  let freed = 0;
  // On a calm day the summary already opens the brief; when it names the lowest hub ("…at 78% on
  // time or better; Newark is the lowest.") that hub's own on-time line only repeats it.
  const floor = index.get('otp.floor');
  const repeatsFloor = (f) => tone === 'calm' && picked.includes(floor) && /^otp\.[A-Z]{3}$/.test(f.id) && f.outlier !== true
    && (floor?.values || []).includes(f.hub);
  for (const f of sorted) {
    if (f.severity < LEAD_SEVERITY || isSummary(f) || repeatsFloor(f)) continue;
    if (weatherInProgram.has(f.id)) freed++;
    else add(f);
  }
  // A freed slot goes to the next specific fact by severity that is worth a line (a hub's
  // cancellations, caution weather elsewhere), never a healthy hub's reading; with none, the
  // background below fills it.
  for (const f of sorted) {
    if (freed === 0) break;
    if (f.severity < FREED_SLOT_SEVERITY || isSummary(f) || weatherInProgram.has(f.id) || picked.includes(f)) continue;
    add(f);
    freed--;
  }

  // The hub story: a healthy hub trailing the others, with the summary of the rest beside it.
  if (outlier) { add(outlier); add(index.get('otp.floor')); }

  // One impaired hub at watch: the disruption index at 30 or more is the other half of the reason
  // (Nov 22 2026), so it is said.
  const netIndex = index.get('net.index');
  if (tone === 'watch' && impaired.length === 1 && netIndex && Number(netIndex.score) >= NETWORK_WATCH_INDEX_WITH_ONE_HUB) add(netIndex);

  // When nothing specific explains the tone, the fact that sets it does (the disruption index on a
  // day of unconfirmed cancellations), with the cancellation split that explains IT (only when
  // the confirmed count is there to split: under 5 it is not sent). At watch, the impaired hubs'
  // own facts explain it: watch is how many there are (computeTone).
  const explains = (f) => f.toneFloor === tone || (tone === 'watch' && Boolean(f.impairs));
  if (tone !== 'calm' && !picked.some(explains)) {
    const setter = sorted.find((f) => f.toneFloor === tone);
    add(setter);
    if (setter?.kind === 'network' && index.get('cxl.confirmed')) {
      add(index.get('cxl.confirmed'));
      add(index.get('cxl.unconfirmed'));
    }
  }

  // A stop or delay program away from the hubs: after everything about the hubs, before the
  // background (United flies there, so it is worth a line; it never sets the tone), at most
  // NON_HUB_TEMPLATE_ITEMS of them.
  const summary = index.get('otp.floor') || index.get('otp.soft') || index.get('otp.min');
  for (const f of sorted.filter(isNonHubProgramFact).slice(0, NON_HUB_TEMPLATE_ITEMS)) add(f);

  // Background, in reading order. A planned program at a hub beats the general FAA count.
  add(summary);
  const plannedHub = sorted.find((f) => f.kind === 'faa_planned' && f.hub);
  // On a calm night tomorrow's possible hub program closes the brief (Nov 2026).
  if (tone === 'calm' && plannedHub) add(plannedHub);
  else if (!picked.some((f) => f.kind === 'faa' || f.kind === 'faa_planned')) add(plannedHub || index.get('faa.active.count'));
  // What is in the air, and the hub-weather tally, are a calm day's background; when something is
  // wrong they are padding (the tally would repeat a program's weather), and a shorter brief is better.
  // Since Nov 22 2026 a calm day can have something wrong at a hub: then they are padding too.
  if (tone === 'calm' && !troubleAtHub(facts)) {
    // On a light-schedule day the in-the-air line is the comparison that says so: fewer flights are
    // flying, in line with the schedule (src/lib/brief-schedule.js).
    const normal = index.get('air.normal');
    add(normal?.inLineWithSchedule ? normal : index.get('air.starlink') || index.get('air.total'));
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
  const name = (f) => airportDisplayName(f.kind === 'faa' ? programAirport(f) : f.hub || '');
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
  // Up to 4 items when something is wrong (prompt rule 4): any tone but calm, and since Nov 22 2026
  // a calm day with something wrong at a hub (one impaired hub, a hub under 80%, hub weather).
  const limit = tone === 'calm' && !troubleAtHub(list) ? 3 : 4;
  const picked = pickItems(list, limit, tone);
  const items = picked.map((f) => ({ text: f.statement, fact_ids: [f.id] }));
  const { headline, fact_ids } = templateHeadline(list, tone);

  let traveler_note = null;
  if (travelerNoteAllowed(tone, list)) {
    // Anchored on every program travelers are held by (one per airport, hubs first and most severe
    // first, at most 8 citations; Nov 2026: airports that are not hubs too), else the hub fact that
    // makes the day disrupted.
    const bySeverity = [...list].sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id));
    const programs = [];
    for (const f of bySeverity) {
      if (f.hub && /^faa\.active\.[A-Z]{3}\.(gs|gdp|closure)$/.test(f.id) && !programs.some((p) => p.hub === f.hub)) programs.push(f);
    }
    // Away from the hubs, only the programs the items print: the note never names an airport the
    // brief above it does not.
    for (const f of bySeverity) {
      if (isNonHubProgramFact(f) && picked.includes(f) && !programs.some((p) => programAirport(p) === programAirport(f))) programs.push(f);
    }
    const fallback = bySeverity.find((f) => f.hub && f.toneFloor === 'disrupted');
    const anchors = programs.length ? programs.slice(0, 8) : fallback ? [fallback] : [];
    // Far fewer flights flying than usual touches every traveler, not only those bound for the
    // airports with a program: the note speaks to all of them.
    const networkWide = list.find((f) => isAirborneShortfallFact(f) && f.toneFloor === 'disrupted');
    if (networkWide) {
      traveler_note = {
        text: "Whichever airport you are flying to, check your flight's status before you leave for the airport.",
        fact_ids: [networkWide.id],
      };
    } else if (anchors.length) {
      traveler_note = {
        text: `If you are ${travelerWho(anchors)}, check your flight's status before you leave for the airport.`,
        fact_ids: anchors.map((f) => f.id),
      };
    }
  }
  return { headline, headline_fact_ids: fact_ids, tone, items, traveler_note };
}
