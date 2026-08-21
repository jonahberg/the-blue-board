// ═══ ACCEPT HEADER CONTENT NEGOTIATION ═══
// Used by the root middleware.ts to decide whether a request wants HTML or Markdown.
// Why: the acceptmarkdown.com contract (RFC 9110 §12.5.1) is not satisfiable with a
// substring test. `Accept: text/html,...,*/*;q=0.8` — the real Chrome header — contains
// no "text/markdown" but DOES match it via the wildcard, and `text/markdown;q=0` means
// "anything but Markdown" rather than "Markdown please". Both cases send browsers a wall
// of raw Markdown if you reach for String.includes(). This module implements the full
// ranking: q-values descending, ties broken by range specificity, q=0 honoured as an
// explicit rejection, and "no acceptable representation" reported as null so the caller
// can answer 406 instead of guessing.

/**
 * Split an Accept header into ranked entries.
 * Entries keep their original position — the caller uses it to break q/specificity ties
 * in the client's stated order, so `Accept: text/markdown, text/html` prefers Markdown.
 *
 * @param {string} header raw Accept header value
 * @returns {Array<{type: string, q: number, specificity: number}>}
 */
export function parseAccept(header) {
  if (typeof header !== 'string') return [];
  return header
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => {
      const parts = raw.split(';').map((s) => s.trim());
      const type = parts[0].toLowerCase();
      let q = 1;
      for (const param of parts.slice(1)) {
        const eq = param.indexOf('=');
        if (eq === -1) continue;
        const name = param.slice(0, eq).trim().toLowerCase();
        if (name !== 'q') continue;
        const parsed = Number(param.slice(eq + 1).trim());
        // Malformed q (`q=banana`) keeps the RFC default of 1 rather than poisoning
        // the ranking with NaN, which compares false against everything.
        if (!Number.isNaN(parsed)) q = Math.max(0, Math.min(1, parsed));
      }
      const specificity = type === '*/*' ? 0 : type.endsWith('/*') ? 1 : 2;
      return { type, q, specificity };
    })
    // Drop syntactic garbage (`Accept: nonsense`). An Accept header made up entirely of
    // garbage is treated as no constraint by preferredType(), not as a 406.
    .filter((entry) => entry.type.includes('/'));
}

/** Does this Accept entry cover the given concrete media type? */
function matches(entry, candidate) {
  if (entry.type === '*/*') return true;
  if (entry.type.endsWith('/*')) return candidate.startsWith(entry.type.slice(0, -1));
  return entry.type === candidate;
}

/**
 * Pick the media type to serve.
 *
 * @param {string|null|undefined} header raw Accept header, or null when absent
 * @param {string[]} produces media types this server can emit, most-preferred first —
 *   the first entry is the default for a missing/unconstrained Accept
 * @returns {string|null} chosen media type, or null when nothing is acceptable (→ 406)
 */
export function preferredType(header, produces) {
  // A missing Accept means "no constraint", NOT "nothing works" — serve the default.
  // Same for an all-garbage header. Returning 406 here is the classic over-eager bug.
  if (header === null || header === undefined) return produces[0] ?? null;
  const entries = parseAccept(header);
  if (entries.length === 0) return produces[0] ?? null;

  let best = null;
  let bestQ = -1;
  let bestPosition = Infinity;

  for (const candidate of produces) {
    // RFC 9110 §12.5.1: the MOST SPECIFIC matching range wins regardless of q, which is
    // what makes `text/html;q=0, */*` correctly reject HTML instead of letting the
    // wildcard's q=1 override the explicit rejection.
    let matched = null;
    let matchedPosition = Infinity;
    for (let idx = 0; idx < entries.length; idx++) {
      const entry = entries[idx];
      if (!matches(entry, candidate)) continue;
      if (
        matched === null
        || entry.specificity > matched.specificity
        || (entry.specificity === matched.specificity && idx < matchedPosition)
      ) {
        matched = entry;
        matchedPosition = idx;
      }
    }
    if (matched === null) continue;
    if (matched.q <= 0) continue; // explicit rejection

    // Across candidates: highest q wins, ties break on the client's stated order so
    // `Accept: text/markdown, text/html, */*` lands on Markdown.
    if (matched.q > bestQ || (matched.q === bestQ && matchedPosition < bestPosition)) {
      bestQ = matched.q;
      bestPosition = matchedPosition;
      best = candidate;
    }
  }

  return best;
}

/**
 * Add `Accept` to a Vary header without clobbering what is already there.
 * Without Vary: Accept a CDN will hand the cached Markdown variant to a browser (or the
 * HTML variant to an agent) depending only on who warmed the cache first.
 *
 * @param {Headers} headers response headers, mutated in place
 */
export function appendVaryAccept(headers) {
  const existing = headers.get('Vary');
  if (!existing) {
    headers.set('Vary', 'Accept');
    return;
  }
  const tokens = existing.split(',').map((s) => s.trim().toLowerCase());
  if (!tokens.includes('accept') && !tokens.includes('*')) {
    headers.set('Vary', `${existing}, Accept`);
  }
}
