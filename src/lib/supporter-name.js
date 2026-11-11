// ═══ SUPPORTER NAMES: MAY THIS ONE BE SHOWN? ═══
// A supporter can type a display name into the Stripe Payment Link's custom field. It is free
// text from a stranger, and the owner's standing rule for the old Supporters Wall was never to
// auto-publish a name. So a name reaches the page ONLY if it passes the strict check below, the
// owner has not hidden its row (`hidden` in sql/023), and names are switched on
// (`SUPPORTER_NAMES` is not `off`). Anything else reads as "a supporter".
//
// The check is about shape, not meaning: letters (any script), spaces, apostrophes, periods and
// hyphens; 2-30 characters after whitespace is collapsed; must start with a letter and hold at
// least two; no digits, no markup, no @, and nothing shaped like a domain ("dana.com"). It
// cannot tell an offensive or impersonating name from a real one. That is what the owner's
// `hidden` flag is for.
//
// Not to be confused with src/lib/supporter-names.js, which keys names for the Buy Me a
// Coffee wall diff.

/** What a covered day says when the name cannot be shown. */
export const SUPPORTER_FALLBACK_LABEL = 'a supporter';

export const SUPPORTER_NAME_MIN = 2;
export const SUPPORTER_NAME_MAX = 30;

/** Letters (and their combining marks), spaces, ' ’ . - — and nothing else. */
const ALLOWED = /^[\p{L}\p{M}][\p{L}\p{M} '’.-]*$/u;
/** "dana.com", "x.co.uk": a period with two or more letters straight after it. */
const DOMAIN_SHAPE = /\p{L}\.\p{L}{2,}/u;
/** "Dana..", "O''Neil", "a--b": punctuation that is not part of a name. */
const PUNCT_RUN = /['’.-]{2,}/u;
const URL_WORD = /(^|\s)(https?|www)(\s|$)/i;

/**
 * Collapse every run of whitespace (including no-break spaces) to one space and trim.
 * @param {unknown} raw
 * @returns {string}
 */
export function collapseWhitespace(raw) {
  if (typeof raw !== 'string') return '';
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/**
 * The name exactly as it may be shown, or null when it must not be.
 * @param {unknown} raw what the supporter typed
 * @returns {string|null}
 */
export function cleanSupporterName(raw) {
  const name = collapseWhitespace(raw);
  const length = [...name].length;
  if (length < SUPPORTER_NAME_MIN || length > SUPPORTER_NAME_MAX) return null;
  if (!ALLOWED.test(name)) return null;
  if ((name.match(/\p{L}/gu) || []).length < 2) return null;
  if (DOMAIN_SHAPE.test(name) || PUNCT_RUN.test(name) || URL_WORD.test(name)) return null;
  // A name ends in a letter or an initial's period ("Dana R."), never a dangling ' or -.
  if (/['’-]$/u.test(name)) return null;
  return name;
}

/**
 * Are names switched on? `SUPPORTER_NAMES=off` (or `0` / `false`) turns every name into
 * "a supporter"; anything else, including unset, leaves the strict check in charge.
 * @param {string|undefined} value
 */
export function supporterNamesEnabled(value) {
  return !/^(off|0|false|no)$/i.test(String(value ?? '').trim());
}

/**
 * The label for one supporter's row.
 * @param {{display_name?: unknown, hidden?: unknown}} row
 * @param {{namesOn?: boolean}} [opts]
 * @returns {string}
 */
export function supporterLabel(row, { namesOn = true } = {}) {
  if (!namesOn || !row || row.hidden === true) return SUPPORTER_FALLBACK_LABEL;
  return cleanSupporterName(row.display_name) ?? SUPPORTER_FALLBACK_LABEL;
}

/**
 * Who a row belongs to, for counting people rather than payments: the same typed name twice
 * is one supporter. Rows with no name have no key and each count as one.
 * @param {{display_name?: unknown}} row
 * @returns {string|null}
 */
export function supporterIdentityKey(row) {
  const name = collapseWhitespace(row?.display_name).toLowerCase();
  const key = name.replace(/[^\p{L}\p{N}]/gu, '');
  return key || null;
}
