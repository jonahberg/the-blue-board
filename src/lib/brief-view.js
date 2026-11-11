// ═══ OPS BRIEF: WHAT THE DASHBOARD SHOWS ═══
// `GET /api/brief` in, a decision out: is there a brief to show RIGHT NOW, and with what words
// around it. DOM-free (the components in src/app/features/Brief*.tsx only render this).
//
// The truthfulness rules live here, not in the components:
//   - a successful response with no brief, a malformed body or a brief the server calls `stale`
//     → nothing to show, and the header row falls back to the rotating ticker;
//   - a brief whose `checkedAt` is more than 30 minutes old BY THE VISITOR'S CLOCK is stale too,
//     whatever the response said: a body can sit in the CDN for minutes and in a backgrounded tab
//     for hours, and it must not come back to the screen as "right now";
//   - a FAILED fetch changes nothing by itself: the last good response is judged by the same
//     clock rule, so a brief that is still current stays up through a blip and ages out on time.
//     A first load that fails has no response, and shows the ticker.
// Brief text is only ever rendered as React text children (never as HTML).

/** Mirrors BRIEF_STALE_AFTER_MS in api/brief.ts (pinned by tests/brief-view.test.js). */
export const BRIEF_STALE_AFTER_MS = 30 * 60 * 1000;
/** How often the dashboard re-reads /api/brief while the tab is visible. */
export const BRIEF_REFRESH_MS = 2 * 60 * 1000;

/** @typedef {'calm'|'watch'|'disrupted'} BriefTone */
/** @typedef {{text: string, factIds: string[]}} BriefViewItem */
/**
 * @typedef {{status: 'ready', headline: string, tone: BriefTone, source: 'model'|'template',
 *   items: BriefViewItem[], travelerNote: BriefViewItem|null, facts: any[], factsById: Map<string, any>,
 *   factCount: number, generatedAtMs: number, checkedAtMs: number, nextUpdateAtMs: number|null,
 *   hasRadio: boolean}} BriefReady
 * @typedef {{status: 'unavailable', reason: 'loading'|'error'|'none'|'stale'|'invalid'}} BriefUnavailable
 */

const TONES = new Set(['calm', 'watch', 'disrupted']);

/**
 * Mirrors travelerNoteAllowed in src/lib/brief-facts.js (pinned by tests/brief-view.test.js), kept
 * here so the header row's chunk does not import the fact builder: a traveler note shows on a
 * disrupted brief, or when the brief cites an FAA ground stop or ground delay program at a hub.
 * Only cited facts are served, and the template's note cites the program itself.
 */
function travelerNoteShown(tone, facts) {
  return tone === 'disrupted'
    || facts.some((f) => /^faa\.active\.[A-Z]{3}\.(gs|gdp)$/.test(f.id) && typeof f.hub === 'string' && f.hub !== '');
}

const ms = (iso) => {
  if (typeof iso !== 'string' || !iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** One item as the server sends it ({ text, fact_ids }), or null when it is not one. */
function readItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = typeof raw.text === 'string' ? raw.text.trim() : '';
  if (!text) return null;
  const factIds = Array.isArray(raw.fact_ids) ? raw.fact_ids.filter((id) => typeof id === 'string') : [];
  return { text, factIds };
}

/**
 * What to show for this response at this moment.
 * @param {any} payload  the last SUCCESSFUL /api/brief body, or null before the first one
 * @param {{error?: boolean, nowMs: number}} options  `error`: the latest fetch failed. It matters
 *   only while there is no successful body yet; after that the body is judged on its own clock.
 * @returns {BriefReady|BriefUnavailable}
 */
export function briefViewState(payload, { error = false, nowMs }) {
  if (payload == null) return { status: 'unavailable', reason: error ? 'error' : 'loading' };
  if (typeof payload !== 'object') return { status: 'unavailable', reason: 'invalid' };
  const brief = payload.brief;
  if (brief == null) return { status: 'unavailable', reason: 'none' };
  if (typeof brief !== 'object') return { status: 'unavailable', reason: 'invalid' };

  const headline = typeof brief.headline === 'string' ? brief.headline.trim() : '';
  const tone = TONES.has(brief.tone) ? brief.tone : null;
  const items = (Array.isArray(brief.items) ? brief.items : []).map(readItem).filter(Boolean);
  const generatedAtMs = ms(payload.generatedAt);
  const checkedAtMs = ms(payload.checkedAt) ?? generatedAtMs;
  if (!headline || !tone || items.length === 0 || generatedAtMs === null || checkedAtMs === null) {
    return { status: 'unavailable', reason: 'invalid' };
  }
  if (payload.stale === true || nowMs - checkedAtMs > BRIEF_STALE_AFTER_MS) {
    return { status: 'unavailable', reason: 'stale' };
  }

  const facts = (Array.isArray(payload.facts) ? payload.facts : []).filter((f) => f && typeof f.id === 'string');
  const travelerNote = travelerNoteShown(tone, facts) ? readItem(brief.traveler_note) : null;
  const cited = new Set([...items, ...(travelerNote ? [travelerNote] : [])].flatMap((i) => i.factIds));
  const factCount = Number.isFinite(payload.factCount) && payload.factCount > 0 ? payload.factCount : facts.length;
  return {
    status: 'ready',
    headline,
    tone,
    source: brief.source === 'model' ? 'model' : 'template',
    items,
    travelerNote,
    facts,
    factsById: new Map(facts.map((f) => [f.id, f])),
    factCount,
    generatedAtMs,
    checkedAtMs,
    // A body can sit in the CDN and between polls: a "next check" already past is not shown.
    nextUpdateAtMs: (() => { const t = ms(payload.nextUpdateAt); return t !== null && t > nowMs ? t : null; })(),
    hasRadio: facts.some((f) => f.kind === 'radio' && cited.has(f.id)),
  };
}

/** The tone's word. Calm is plain; watch and disrupted also carry an icon and a status colour. */
export const BRIEF_TONE_WORD = Object.freeze({ calm: 'Calm', watch: 'Watch', disrupted: 'Disrupted' });

/**
 * A clock time in the VIEWER's zone (or `timeZone`), with its abbreviation: "4:35 PM CST".
 * @param {number|null} atMs
 * @param {{timeZone?: string}} [options]
 * @returns {string}
 */
export function formatBriefClock(atMs, { timeZone } = {}) {
  if (!Number.isFinite(atMs)) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(/** @type {number} */ (atMs))).replace(/ /g, ' ');
  } catch {
    return '';
  }
}

const plural = (n, one, many) => (n === 1 ? one : many);

/**
 * The footer's first line: what wrote this brief. A template brief says so plainly.
 * @param {'model'|'template'} source
 * @param {number} factCount  how many live facts the brief was written from (`factCount`)
 */
export function briefSourceLine(source, factCount) {
  if (source === 'template') return 'This brief was listed straight from the data, with no AI text.';
  const n = Math.max(0, Math.round(Number(factCount) || 0));
  return `Written from ${n} live ${plural(n, 'fact', 'facts')} and checked against them.`;
}

/**
 * The footer's freshness line. A brief the cron re-confirmed after writing it says when; the next
 * scheduled check follows. Times in the viewer's zone.
 * @param {{generatedAtMs: number, checkedAtMs: number, nextUpdateAtMs: number|null}} view
 * @param {{timeZone?: string}} [options]
 */
export function briefFreshnessLine({ generatedAtMs, checkedAtMs, nextUpdateAtMs }, options = {}) {
  const parts = [];
  if (Number.isFinite(checkedAtMs) && checkedAtMs - generatedAtMs >= 60_000) {
    parts.push(`Facts unchanged as of ${formatBriefClock(checkedAtMs, options)}.`);
  }
  if (Number.isFinite(nextUpdateAtMs)) parts.push(`Next check ${formatBriefClock(/** @type {number} */ (nextUpdateAtMs), options)}.`);
  return parts.join(' ');
}

/**
 * The ticker's emergency-squawk lines, which a brief must never hide. `buildTickerItems()`
 * (src/lib/ticker.js) marks exactly those as `critical` (from `decodeSquawk`'s `squawk-alert`);
 * several are joined for the one row. Null when there is none.
 * @param {Array<{text: string, cls: string}>} tickerItems
 * @returns {string|null}
 */
export function briefAlertLine(tickerItems) {
  const lines = (Array.isArray(tickerItems) ? tickerItems : [])
    .filter((item) => item && item.cls === 'critical' && typeof item.text === 'string')
    .map((item) => item.text.trim())
    .filter(Boolean);
  return lines.length ? lines.join(' · ') : null;
}

const PICTOGRAPH_RE = /[\p{Extended_Pictographic}\uFE0F]/gu;

/**
 * The header row's words, in the order the row prints them. The row is a button named by its own
 * content (WCAG 2.5.3: an aria-label over the visible tone and headline announced different words
 * from the ones on screen, axe label-content-name-mismatch, Nov 2026), so the words a sighted
 * visitor reads are visible and the rest is `sr-only`:
 *
 *   [word][lead, sr-only] [shown, visible; any emoji in it aria-hidden][end, sr-only] [rest, sr-only]
 *
 * with the two spaces as plain text between them (a space inside an sr-only span is trimmed out of
 * the computed name). It reads "Watch: Running normally. Open the full brief." The visible "Full
 * brief ›" hint is decorative (aria-hidden): `rest` already says what pressing the row does. While
 * an emergency squawk takes the row's text, the row shows the squawk and `rest` carries the
 * brief's headline.
 *
 * @param {BriefTone} tone
 * @param {string} headline
 * @param {'open'|'reveal'} action  'reveal' when the full brief is already open in the sidebar
 * @param {string|null} [alert]  the squawk line from `briefAlertLine`
 * @returns {{word: string, lead: string, shown: string, end: string, rest: string}}
 */
export function briefRowParts(tone, headline, action, alert = null) {
  const word = BRIEF_TONE_WORD[tone] ?? 'Brief';
  const text = String(headline ?? '').trim();
  const stop = (value) => (/[.!?]$/.test(value) ? '' : '.');
  const act = action === 'reveal' ? 'Go to the full brief.' : 'Open the full brief.';
  const raw = alert ? String(alert).trim() : '';
  const spoken = raw ? raw.replace(PICTOGRAPH_RE, '').replace(/\s+/g, ' ').trim() : '';
  if (spoken) return { word, lead: '.', shown: raw, end: stop(spoken), rest: `Brief: ${text}${stop(text)} ${act}` };
  return { word, lead: ':', shown: text, end: stop(text), rest: act };
}

/**
 * The row's accessible name: what its content adds up to (`briefRowParts`, with any emoji left
 * out, since the row hides them from assistive tech).
 * @param {BriefTone} tone
 * @param {string} headline
 * @param {'open'|'reveal'} action
 * @param {string|null} [alert]
 */
export function briefRowLabel(tone, headline, action, alert = null) {
  const { word, lead, shown, end, rest } = briefRowParts(tone, headline, action, alert);
  return `${word}${lead} ${shown.replace(PICTOGRAPH_RE, '').replace(/\s+/g, ' ').trim()}${end} ${rest}`;
}

/**
 * Split printed text into runs, marking the emoji runs so the row can hide them from assistive tech
 * ("⚠️ EMERGENCY" reads "EMERGENCY", not "warning sign EMERGENCY").
 * @param {string} text
 * @returns {{text: string, glyph: boolean}[]}
 */
export function pictographRuns(text) {
  return String(text ?? '')
    .split(/([\p{Extended_Pictographic}\uFE0F]+\s*)/u)
    .filter(Boolean)
    .map((run) => ({ text: run, glyph: /^[\p{Extended_Pictographic}\uFE0F]/u.test(run) }));
}

/** Shown under a brief that cites anything heard on ATC frequencies. */
export const BRIEF_RADIO_CAVEAT =
  "ATC radio items come from Enhanced Radar's model-written summaries of controller audio, which can contain mistakes.";

/** "How this was written": three plain steps. */
export const BRIEF_HOW_STEPS = Object.freeze([
  'Every 10 minutes the server gathers the facts it already has: hub on-time, FAA programs, weather and flight counts.',
  'Claude writes the brief and must attach a fact to every sentence.',
  'The server checks every number and airport in the text against those facts and drops any sentence that fails. If the whole brief fails, you get a plain list of the facts with no AI text.',
]);
