// ═══ NAS STATUS: SEVERITY CLASSIFICATION AND TIERING ═══
// The FAA's National Airspace System feed reports en-route programs and planned
// traffic-management initiatives as free text. This classifies them, tags the United
// hubs each touches, and sorts them into the panel's three-tier priority stack.
//
// Extracted from src/dashboard/main.js (:3629-3785, classifiers + item building).
// Everything comes back RAW; NasPanel.tsx renders it as JSX text, so React does the escaping.
//
// Tiering (Sep 2026): "critical" is reserved for a ground stop that is IN EFFECT (an
// `active` program). A planned TMI is at most "active", and an outlook worded
// POSSIBLE/PROBABLE is "monitoring" — the ATCSCC operations plan lists a dozen such
// outlooks on a normal afternoon, and tiering them as critical put eight red GS badges
// on screen while /api/nas reported nothing active.

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
 * Classify and tier the NAS payload, text left RAW for the React panel.
 *
 * Active en-route programs are critical when they are a ground stop and active otherwise.
 * Planned TMIs are never critical: an outlook worded POSSIBLE/PROBABLE is monitoring, and
 * otherwise a planned GS/GDP/AFP is active and everything else monitoring. A planned item's
 * detail starts with a "planned" tag, then its window — the `time` field, or the leading
 * "AFTER HHMM" the operations plan puts in the event text (moved out of the title).
 * Items keep their source order within a tier (active programs first, then planned).
 *
 * @param {{active?: Array<Object>, planned?: Array<Object>}|null|undefined} nas
 * @param {Iterable<string>|Set<string>} hubCodes  the United hubs worth tagging.
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

    const text = String(tmi.decoded || tmi.event || '');
    const tentative = /\b(POSSIBLE|PROBABLE)\b/i.test(text);
    let tier;
    if (tentative) tier = 'monitoring';
    else if (sevType === 'GS' || sevType === 'GDP' || sevType === 'AFP') tier = 'active';
    else tier = 'monitoring';

    // "AFTER 1500\t-EWR GROUND STOP…" → title "EWR GROUND STOP…", window "after 1500Z". The
    // plan words a closing window the same way ("UNTIL 0000\t-MIA/FLL CDRS/SWAP POSSIBLE"), so
    // that one moves out of the title too, as "until 0000Z".
    const after = text.match(/^\s*(AFTER|UNTIL)\s+(\d{4})Z?\s*-?\s*/i);
    /** @type {NasDetailPart[]} */
    const detailParts = [{ kind: 'text', text: 'planned' }];
    if (tmi.time) detailParts.push({ kind: 'text', text: tmi.time });
    else if (after) detailParts.push({ kind: 'text', text: `${after[1].toLowerCase()} ${after[2]}Z` });

    items.push({
      tier,
      sevType,
      title: after ? text.slice(after[0].length) : text,
      detailParts,
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

/**
 * The plain English words the FAA's programs and outlooks are written in. Only these are ever
 * lowered; every other token (an airport, a facility, an acronym like CDRS, SWAP, AR or TMI, a
 * route like J146) is printed exactly as the FAA sent it.
 */
const NAS_PLAIN_WORDS = new Set([
  'GROUND', 'STOP', 'STOPS', 'DELAY', 'DELAYS', 'PROGRAM', 'PROGRAMS', 'POSSIBLE', 'PROBABLE',
  'LIKELY', 'EXPECTED', 'ROUTE', 'ROUTES', 'CLOSURE', 'CLOSURES', 'CLOSED', 'ARRIVAL', 'ARRIVALS',
  'DEPARTURE', 'DEPARTURES', 'UNTIL', 'AFTER', 'BEFORE', 'CODED', 'SEVERE', 'WEATHER', 'AVOIDANCE',
  'OCEANIC', 'AIRSPACE', 'FLOW', 'MILES', 'MINUTES', 'TRAIL', 'EXPECT', 'CLEARANCE', 'TIME',
  'CONSTRAINED', 'AREA', 'AREAS', 'SPACING', 'METERING', 'REROUTE', 'REROUTES', 'VOLUME',
  'CEILINGS', 'THUNDERSTORMS', 'WIND', 'WINDS', 'EQUIPMENT', 'OUTAGE', 'RUNWAY', 'RUNWAYS',
  'CONSTRUCTION', 'PLAYBOOK', 'ESCAPE', 'CAPPING', 'TUNNELING', 'RESTRICTION', 'RESTRICTIONS',
  'INITIATIVE', 'INITIATIVES', 'TRAFFIC', 'MANAGEMENT', 'OPERATIONS', 'STAFFING', 'VISIBILITY',
  'SNOW', 'RAIN', 'DEICING', 'ENROUTE', 'TERMINAL', 'SPECIAL', 'STRATEGY', 'ADVISORY',
  // Short words: lowered only once the sentence has begun (see below), because a three-letter
  // word in the leading facility list may be an airport (AND, FOR and THE are all codes).
  'AND', 'FOR', 'THE', 'WITH', 'FROM', 'INTO', 'OR', 'TO', 'OF', 'IN', 'ON', 'AT', 'VIA', 'LOW', 'FOG', 'ICE',
]);

/**
 * A NAS item's title in calm sentence case for the panel: "MIA/FLL GROUND STOP POSSIBLE" reads
 * "MIA/FLL ground stop possible", "OCEANIC/AR ROUTE CLOSURES POSSIBLE" reads "Oceanic/AR route
 * closures possible".
 *
 * Display only, and case only: it never adds, drops or reorders a character, so
 * `nasDisplayTitle(t).toUpperCase() === t.toUpperCase()` for every input. A word is lowered only
 * when it is in `NAS_PLAIN_WORDS`; a short word (under four letters) only after the first long
 * plain word, so the facility list that opens a planned item ("SEA/BFI …") is never touched.
 * A first word that is lowered keeps its capital; text that arrived in lower case is left as is.
 *
 * @param {string|null|undefined} title  a `tierNasEventsRaw()` title (RAW).
 * @returns {string}
 */
export function nasDisplayTitle(title) {
  const tokens = String(title ?? '').split(/([A-Za-z]+)/);
  let begun = false;
  let out = '';
  tokens.forEach((token, i) => {
    // Odd indices are the captured letter runs; even ones the text between them.
    if (i % 2 === 0) {
      out += token;
      return;
    }
    const upper = token.toUpperCase();
    const plain = NAS_PLAIN_WORDS.has(upper);
    if (plain && upper.length >= 4) begun = true;
    const lowered = plain && begun;
    // The sentence's first word, when lowered, keeps its capital.
    out += lowered ? (i === 1 ? token[0].toUpperCase() + token.slice(1).toLowerCase() : token.toLowerCase()) : token;
  });
  return out;
}

/** True when the NAS panel has nothing to show and must stay hidden (`main.js:3096-3100`). */
export function nasPanelEmpty(nas) {
  return !nas || ((!nas.active || !nas.active.length) && (!nas.planned || !nas.planned.length));
}
