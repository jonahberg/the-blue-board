// ═══ NAS STATUS: SEVERITY CLASSIFICATION AND TIERING ═══
// The FAA's National Airspace System feed reports en-route programs and planned
// traffic-management initiatives as free text. This classifies them, tags the United
// hubs each touches, and sorts them into the panel's three-tier priority stack.
//
// Extracted verbatim from src/dashboard/main.js (:3629-3785, classifiers + item
// building). Panel creation, insertion and innerHTML stay in main.js.
//
// `title` and `detail` come back pre-escaped: every value that originates upstream
// passes through escapeHtml here, so the caller can concatenate them into innerHTML
// exactly as renderNasPanel always has.

import { escapeHtml } from './escape.js';

/** Traffic-management initiative codes, spelled out. */
/** @type {Record<string, string>} */
export const SEV_LABELS = {
  GS: 'Ground Stop', GDP: 'Ground Delay Program', AFP: 'Airspace Flow Program',
  MIT: 'Miles-in-Trail', MINIT: 'Minutes-in-Trail', CDR: 'Coded Departure Routes',
  SWAP: 'Severe Weather Avoidance', EDCT: 'Expect Departure Clearance Time',
  FCA: 'Flow Constrained Area', DSP: 'Departure Spacing Program',
};

/**
 * Classify a program name or TMI event into a severity code.
 * Order matters: ground stop is tested before ground delay, so an advisory naming
 * both reports the more severe one.
 *
 * @param {string} text
 * @returns {'GS'|'GDP'|'AFP'|'MIT'|'CDR'|'SWAP'|'EDCT'|'FCA'|'DSP'|'OTHER'}
 */
export function detectSevType(text) {
  const t = text.toUpperCase();
  if (t.includes('GROUND STOP') || /\bGS\b/.test(t) || /\bGDS\b/.test(t)) return 'GS';
  if (t.includes('GROUND DELAY') || /\bGDP\b/.test(t)) return 'GDP';
  if (t.includes('AIRSPACE FLOW') || /\bAFP\b/.test(t)) return 'AFP';
  if (t.includes('MILES-IN-TRAIL') || t.includes('MINUTES-IN-TRAIL') || /\bMINIT\b/.test(t) || /\bMIT\b/.test(t)) return 'MIT';
  if (t.includes('CODED DEPARTURE') || /\bCDRS?\b/.test(t)) return 'CDR';
  if (t.includes('SEVERE WEATHER') || /\bSWAP\b/.test(t)) return 'SWAP';
  if (/\bEDCT\b/.test(t)) return 'EDCT';
  if (/\bFCA\b/.test(t)) return 'FCA';
  if (/\bDSP\b/.test(t)) return 'DSP';
  return 'OTHER';
}

/**
 * Map a severity type to its CSS badge class (known-safe string values).
 * @param {string|undefined} sevType
 * @returns {string}
 */
export function sevBadgeClass(sevType) {
  const map = { GS:'gs', GDP:'gdp', AFP:'afp', MIT:'mit', SWAP:'mit', MINIT:'mit', CDR:'cdr', EDCT:'cdr', FCA:'cdr', DSP:'cdr' };
  return 'sev-' + (map[sevType] || 'other');
}

/**
 * @typedef {Object} NasItem
 * @property {'critical'|'active'|'monitoring'} tier
 * @property {string} sevType
 * @property {string} title  pre-escaped
 * @property {string} detail  pre-escaped (may contain a `nas-delay-val` span)
 * @property {string[]} hubs  United hub codes this item affects
 */

/**
 * Classify and tier the NAS payload.
 *
 * Active en-route programs are critical when they are a ground stop and active
 * otherwise. Planned TMIs are critical for a ground stop, active for GDP/AFP, and
 * monitoring for everything else. Items keep their source order within a tier
 * (active programs first, then planned).
 *
 * @param {{active?: Array<Object>, planned?: Array<Object>}|null|undefined} nas
 * @param {Iterable<string>|Set<string>} hubCodes  the United hubs worth tagging.
 * @returns {{critical: NasItem[], active: NasItem[], monitoring: NasItem[]}}
 */
export function tierNasEvents(nas, hubCodes) {
  const tiers = tierNasEventsRaw(nas, hubCodes);
  const escapeItem = (item) => ({
    tier: item.tier,
    sevType: item.sevType,
    title: escapeHtml(item.title),
    detail: item.detailParts
      .map((part) =>
        part.kind === 'delay'
          ? 'avg <span class="nas-delay-val">' + escapeHtml(part.text) + '</span>'
          : escapeHtml(part.text),
      )
      .join(' · '),
    hubs: item.hubs,
  });
  return {
    critical: tiers.critical.map(escapeItem),
    active: tiers.active.map(escapeItem),
    monitoring: tiers.monitoring.map(escapeItem),
  };
}

/**
 * @typedef {Object} NasDetailPart
 * @property {'text'|'delay'} kind  `delay` is the avg-delay figure the panel emphasises.
 * @property {string} text  RAW — never escaped.
 */

/**
 * @typedef {Object} NasItemRaw
 * @property {'critical'|'active'|'monitoring'} tier
 * @property {string} sevType
 * @property {string} title  RAW
 * @property {NasDetailPart[]} detailParts  RAW, in render order (joined with " · ")
 * @property {string[]} hubs
 */

/**
 * The same classification and tiering as `tierNasEvents`, with the text left RAW.
 *
 * `tierNasEvents` exists for the innerHTML caller in `src/dashboard/main.js` and escapes
 * this output at the edge; a React renderer takes the raw items, because passing
 * pre-escaped HTML through JSX would double-escape (`&amp;amp;`) and force the panel to
 * reach for `dangerouslySetInnerHTML` for no reason. One classifier, two presentations.
 *
 * @param {{active?: Array<Object>, planned?: Array<Object>}|null|undefined} nas
 * @param {Iterable<string>|Set<string>} hubCodes
 * @returns {{critical: NasItemRaw[], active: NasItemRaw[], monitoring: NasItemRaw[]}}
 */
export function tierNasEventsRaw(nas, hubCodes) {
  const hubSet = hubCodes instanceof Set ? hubCodes : new Set(hubCodes || []);
  /** @type {NasItemRaw[]} */
  const items = [];
  if (!nas) return { critical: [], active: [], monitoring: [] };

  // Active en-route programs
  for (const prog of (nas.active || [])) {
    const sevType = detectSevType(prog.name);
    const nameParts = prog.name.split('-');
    const typeCode = nameParts[0] || '';
    const facility = nameParts.length > 1 && /^[A-Z]{3}$/.test(nameParts[1]) ? nameParts[1] : '';
    const typeName = SEV_LABELS[sevType] || typeCode;
    const hubs = [...new Set((prog.affectedFacilities || []).filter(a => hubSet.has(a)))];

    const detailParts = [];
    if (prog.reason) detailParts.push({ kind: 'text', text: prog.reason });
    if (prog.avgDelay) detailParts.push({ kind: 'delay', text: String(prog.avgDelay) + 'm' });
    if (prog.endTime) {
      const endZ = prog.endTime.includes('T') ? prog.endTime.split('T')[1].slice(0, 5) + 'Z' : prog.endTime;
      detailParts.push({ kind: 'text', text: 'ends ' + endZ });
    }

    items.push({
      tier: sevType === 'GS' ? 'critical' : 'active',
      sevType,
      title: facility ? facility + ' ' + typeName : prog.name,
      detailParts,
      hubs,
    });
  }

  // Planned TMIs
  for (const tmi of (nas.planned || [])) {
    const sevType = detectSevType(tmi.event);
    const hubs = (tmi.affectedAirports || []).filter(a => hubSet.has(a));

    let tier;
    if (sevType === 'GS') tier = 'critical';
    else if (sevType === 'GDP' || sevType === 'AFP') tier = 'active';
    else tier = 'monitoring';

    items.push({
      tier,
      sevType,
      title: tmi.decoded || tmi.event,
      detailParts: tmi.time ? [{ kind: 'text', text: tmi.time }] : [],
      hubs,
    });
  }

  return {
    critical: items.filter(i => i.tier === 'critical'),
    active: items.filter(i => i.tier === 'active'),
    monitoring: items.filter(i => i.tier === 'monitoring'),
  };
}

/**
 * The panel's header count line: "2 active · 1 planned · 3 hubs".
 *
 * Extracted from `renderNasPanel` (`main.js:3690-3699`) so the React panel and any future
 * caller agree on pluralisation and on which counts are omitted when zero.
 *
 * @param {{active?: Array<Object>, planned?: Array<Object>}|null|undefined} nas
 * @param {{critical: Array<{hubs: string[]}>, active: Array<{hubs: string[]}>, monitoring: Array<{hubs: string[]}>}} tiers
 * @returns {string} '' when every count is zero.
 */
export function nasCountLine(nas, tiers) {
  const activeCount = (nas?.active || []).length;
  const plannedCount = (nas?.planned || []).length;
  const hubCount = new Set(
    [...tiers.critical, ...tiers.active, ...tiers.monitoring].flatMap((i) => i.hubs),
  ).size;
  const parts = [];
  if (activeCount) parts.push(activeCount + ' active');
  if (plannedCount) parts.push(plannedCount + ' planned');
  if (hubCount) parts.push(hubCount + ' hub' + (hubCount !== 1 ? 's' : ''));
  return parts.join(' · ');
}

/** True when the NAS panel has nothing to show and must stay hidden (`main.js:3096-3100`). */
export function nasPanelEmpty(nas) {
  return !nas || ((!nas.active || !nas.active.length) && (!nas.planned || !nas.planned.length));
}
