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
