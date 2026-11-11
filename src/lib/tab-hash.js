// ═══ TAB HASHES WITH A TAIL ═══
// The Oct 6 2026 update email put its UTM tags AFTER the '#' on its tab links
// ('/#schedule?utm_source=email…', '/?view=express#fleet&utm_source=email…'). The dashboard
// matched the whole hash against '#schedule', found nothing, and opened Live — so "See United
// Express →" and the Schedule/Starlink images landed on the wrong tab. The email is already in
// 183 inboxes and gets clicked for days, so the site tolerates the shape: the tab is everything
// before the first '?' or '&', and the trapped params move into the real query string.

/** '#fleet&utm_source=email' → '#fleet'; '#live?utm…' → '#live'; anything else unchanged. */
export function cleanTabHash(hash) {
  const h = String(hash ?? '');
  const i = h.search(/[?&]/);
  return i === -1 ? h : h.slice(0, i);
}

/** The params trapped after the '#' ('utm_source=email&utm_medium=email'), or ''. */
export function hashTailParams(hash) {
  const h = String(hash ?? '');
  const i = h.search(/[?&]/);
  return i === -1 ? '' : h.slice(i + 1);
}

/**
 * The same location with the trapped params moved into the query (existing query keys win),
 * or null when the hash has no tail.
 * @param {{pathname: string, search: string, hash: string}} loc
 */
export function canonicalizeHashParams({ pathname, search, hash }) {
  const tail = hashTailParams(hash);
  if (!tail) return null;
  const params = new URLSearchParams(search);
  for (const [k, v] of new URLSearchParams(tail)) if (!params.has(k)) params.set(k, v);
  const q = params.toString();
  return `${pathname}${q ? `?${q}` : ''}${cleanTabHash(hash)}`;
}

// ═══ WEATHER-TAB SCROLL TARGETS ═══
// The Delays · Weather tab has three places a link can land: the IROPS bar, the NAS status
// panel and one hub's card. One resolver serves both the URL on first load (state/deep-links.ts)
// and the brief's chips (src/lib/brief-chips.js builds the hrefs, BriefPanel follows them), so a
// chip and a pasted link can never disagree about where they go.
//
//   ?tab=irops                     → 'irops-section'   (the hub pages' published alias)
//   ?tab=weather&hub=EWR           → 'hub-card-EWR'    (a hub with a card; anything else is ignored)
//   ?tab=weather&section=nas       → 'nas-section'
//   ?tab=weather&section=irops     → 'irops-section'

/** The hubs with a card on the Weather tab, in card order (`HUB_STATIONS` in weather-cards.js). */
export const WEATHER_CARD_HUBS = Object.freeze(['EWR', 'IAH', 'ORD', 'DEN', 'SFO', 'LAX', 'IAD', 'NRT', 'GUM']);

/**
 * The Weather-tab element a link's query asks to land on, or null.
 * @param {URLSearchParams} params
 * @returns {string|null}
 */
export function weatherScrollTarget(params) {
  const tab = String(params.get('tab') ?? '').trim().toLowerCase();
  if (tab === 'irops') return 'irops-section';
  if (tab !== 'weather') return null;
  const hub = String(params.get('hub') ?? '').trim().toUpperCase();
  if (hub && WEATHER_CARD_HUBS.includes(hub)) return `hub-card-${hub}`;
  const section = String(params.get('section') ?? '').trim().toLowerCase();
  if (section === 'nas') return 'nas-section';
  if (section === 'irops') return 'irops-section';
  return null;
}
