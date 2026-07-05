// ═══ SCHEDULE STATUS DISPLAY LAYER ═══
// Presentation on top of classifySchedStatus results (src/lib/schedule-status.js).
// Audit Jul 3 2026: 168 rows rendered a literal "Unknown" status (pipeline leak),
// and raw provider strings can leak as concatenations ("Canceleduncertain").
// This module keeps the display honest without touching classification:
//  - key 'unknown' renders as "Scheduled" with an "as of <board time>" sub-stamp
//    (the caller supplies the stamp — we only flag that it is needed).
//  - key 'canceled_uncertain' always gets its proper "Likely Canceled" label,
//    even if the classifier's text field is missing on an old cached payload.
//  - any remaining raw provider string (underscores, camelCase run-ons) is
//    title-cased defensively.

/** True when a status string looks like a raw machine token rather than display text. */
export function looksRawStatusText(text) {
  if (!text || typeof text !== 'string') return true;
  if (/_/.test(text)) return true;
  if (!/\s/.test(text) && /[a-z][A-Z]/.test(text)) return true; // camelCase run-on
  if (!/\s/.test(text) && /^[a-z]/.test(text)) return true; // all-lowercase token ("canceleduncertain")
  return false;
}

/** "canceled_uncertain" → "Canceled Uncertain"; "enRoute" → "En Route". */
export function humanizeStatusText(text) {
  if (!text || typeof text !== 'string') return '';
  const spaced = text
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  if (!spaced) return '';
  return spaced
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Map a classification result to what the board should render.
 * Defensive against old cached payloads: every new contract field (label,
 * presumed, canceled_uncertain key) may be absent — degrades to prior behavior.
 *
 * @param {{text?:string, cls?:string, key?:string, inferred?:boolean, presumed?:boolean, label?:string, live?:boolean}|null} status
 * @returns {{text:string, cls:string, presumed:boolean, asOf:boolean, live?:boolean}}
 *   text     display label (without the presumed asterisk — caller appends "*")
 *   cls      CSS class for .sched-status
 *   presumed row is a time-inferred departure/landing (render "Departed*" + tooltip)
 *   asOf     caller should append an "as of <absolute board time>" sub-stamp
 *   live     status confirmed by a live-feed sighting (Phase 2) — badge as LIVE, not presumed
 */
export function displayScheduleStatus(status) {
  if (!status || typeof status !== 'object') {
    return { text: 'Scheduled', cls: 'scheduled', presumed: false, asOf: true };
  }
  const key = status.key || 'unknown';
  const presumed = !!(status.presumed ?? status.inferred);

  if (key === 'unknown') {
    // A provider gap, not a real state: the flight is on the schedule, we just have
    // no live update. "Scheduled (as of <board time>)" is the honest rendering.
    return { text: 'Scheduled', cls: 'scheduled', presumed: false, asOf: true };
  }

  if (key === 'canceled_uncertain') {
    const label = status.label || (!looksRawStatusText(status.text) && status.text) || 'Likely Canceled';
    return { text: label, cls: status.cls || 'warn', presumed: false, asOf: false };
  }

  // Live-sighting reclassifications (Phase 2) arrive here as departed/enroute keys with
  // live:true — pass the flag through so the board can badge them LIVE, not presumed.
  const live = status.live === true;
  let text = status.label || status.text || '';
  if (!text) return { text: 'Scheduled', cls: status.cls || 'scheduled', presumed, asOf: true, live };
  if (looksRawStatusText(text)) text = humanizeStatusText(text);
  return { text, cls: status.cls || 'unknown', presumed, asOf: false, live };
}
