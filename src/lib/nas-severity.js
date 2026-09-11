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
  const hubSet = hubCodes instanceof Set ? hubCodes : new Set(hubCodes || []);
  /** @type {NasItem[]} */
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
    if (prog.reason) detailParts.push(escapeHtml(prog.reason));
    if (prog.avgDelay) detailParts.push('avg <span class="nas-delay-val">' + escapeHtml(String(prog.avgDelay)) + 'm</span>');
    if (prog.endTime) {
      const endZ = prog.endTime.includes('T') ? prog.endTime.split('T')[1].slice(0, 5) + 'Z' : prog.endTime;
      detailParts.push('ends ' + escapeHtml(endZ));
    }

    items.push({
      tier: sevType === 'GS' ? 'critical' : 'active',
      sevType,
      title: facility ? escapeHtml(facility) + ' ' + escapeHtml(typeName) : escapeHtml(prog.name),
      detail: detailParts.join(' · '),
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
      title: escapeHtml(tmi.decoded || tmi.event),
      detail: tmi.time ? escapeHtml(tmi.time) : '',
      hubs,
    });
  }

  return {
    critical: items.filter(i => i.tier === 'critical'),
    active: items.filter(i => i.tier === 'active'),
    monitoring: items.filter(i => i.tier === 'monitoring'),
  };
}
