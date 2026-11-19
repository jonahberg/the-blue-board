// ═══ HTML SANITIZATION ═══
// Shared across client (src/dashboard/main.js) and server (api/*.ts).
// Why: prevents XSS when untrusted upstream data (FR24, news titles)
// is interpolated into HTML strings assigned to innerHTML or email bodies.

export function escapeHtml(str) {
  // F051: numeric/boolean fields (e.g. fleet.json's `tot` seat count) used to render
  // blank — escapeHtml returned '' for anything not already a string. Coerce known-safe
  // primitive types to their string form; null/undefined still render as '' (unknown data).
  if (typeof str === 'number' || typeof str === 'boolean') str = String(str);
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Strip control characters (CR/LF/NUL etc.) from a single-line header value.
// Why: email subject lines that interpolate title/category must not contain newlines
// (SMTP injection) or HTML escape sequences (escapeHtml is for HTML bodies, not headers).
export function sanitizeHeaderValue(str) {
  if (typeof str !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\x00-\x1F\x7F]/g, '').trim();
}

// Decode the HTML character references a JSON body picks up when a proxy wraps it in <pre>…</pre>
// (api/_fr24-scraper-transport.ts). ONE pass over the string, so a reference is decoded once:
// "&amp;lt;" is the text "&lt;", never "<". The chained .replace() it replaced decoded &amp; before
// &lt;, which turned "&amp;lt;" into "<" (CodeQL js/double-escaping, Oct 28 2026).
const NAMED_REFERENCES = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" };

export function decodeHtmlEntities(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-z]+));/g, (match, dec, hex, name) => {
    if (name !== undefined) return Object.prototype.hasOwnProperty.call(NAMED_REFERENCES, name) ? NAMED_REFERENCES[name] : match;
    const code = dec !== undefined ? Number.parseInt(dec, 10) : Number.parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}
