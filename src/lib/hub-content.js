// ═══ HUB PAGE CONTENT STRINGS — RENDER-TIME ADJUSTMENTS ═══
// The hub pages' prose arrives as raw HTML strings from src/data/hubs/*.js (`contentHtml`), which
// this layer does not edit. Two pieces of that HTML predate the live departures board and are
// adjusted as the page renders, leaving every other byte — headings, copy, links — exactly as
// authored:
//
//  1. The "Dive Deep" section ends in a row of four emoji buttons (🗺️ Live ORD Map, 📋 ORD
//     Schedules, 📡 Starlink Fleet, ⚠️ IROPS Monitor). The board now carries the page's ONE
//     primary button, so the row becomes a line of plain text links: same destinations, no emoji
//     in controls (DESIGN.md Components), no four buttons competing with the board's.
//  2. The two compact pages (NRT, GUM) carry their own one-number "LIVE" bar inside the string.
//     The layout splits the string around it so the board can stand in its place; the bar's
//     `live-meta` line (ICAO, time zone, terminal) is copy and is handed back to be kept.

/** Pictographic emoji (plus any variation selector / joiner sequence) at the start of a label. */
const LEADING_EMOJI = /^\s*(?:\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*️?\s*)+/u;

/** The Dive Deep CTA row: a flex `<div>` holding only `<a class="cta">` links. */
const CTA_ROW = /<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px">\s*((?:<a class="cta"[^>]*>[^<]*<\/a>\s*)+)<\/div>/g;
const CTA_LINK = /<a class="cta" href="([^"]*)"[^>]*>([^<]*)<\/a>/g;

/**
 * "🗺️ Live ORD Map" → "Live ORD Map".
 * @param {string} label
 * @returns {string}
 */
export function stripLeadingEmoji(label) {
  return String(label || '').replace(LEADING_EMOJI, '').trim();
}

/**
 * Replace each Dive Deep emoji-button row with one line of plain links to the same places.
 *
 * @param {string} html  a hub `contentHtml` string.
 * @returns {string} the same string when there is no such row.
 */
export function demoteHubCtaRow(html) {
  const source = String(html ?? '');
  return source.replace(CTA_ROW, (_row, links) => {
    const anchors = [...links.matchAll(CTA_LINK)].map(
      ([, href, label]) => `<a href="${href}">${stripLeadingEmoji(label)}</a>`,
    );
    return `<p class="hub-more-links">More on the dashboard: ${anchors.join(' · ')}</p>`;
  });
}

/**
 * The index just past the `</div>` that closes the `<div` opening at `start`, or -1.
 * Counts nested `<div` / `</div>` tags, which is all the compact live bar contains.
 */
function matchingDivEnd(html, start) {
  const tag = /<div\b|<\/div>/g;
  tag.lastIndex = start;
  let depth = 0;
  for (let m = tag.exec(html); m; m = tag.exec(html)) {
    depth += m[0] === '</div>' ? -1 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return -1;
}

/**
 * Split a compact hub's `contentHtml` around its LIVE bar.
 *
 * @param {string} html
 * @returns {{before: string, after: string, metaHtml: string}|null} null when the string has no
 *   live bar (a full-variant hub) or the bar is malformed — the caller then renders it unchanged.
 *   `metaHtml` is the inner HTML of the bar's `live-meta` line ('' when absent).
 */
export function splitCompactLiveBar(html) {
  const source = String(html ?? '');
  const start = source.indexOf('<div class="live-bar"');
  if (start < 0) return null;
  const end = matchingDivEnd(source, start);
  if (end < 0) return null;
  const bar = source.slice(start, end);
  const meta = /<div class="live-meta">([\s\S]*?)<\/div>/.exec(bar);
  return {
    before: source.slice(0, start),
    after: source.slice(end),
    metaHtml: meta ? meta[1].trim() : '',
  };
}
