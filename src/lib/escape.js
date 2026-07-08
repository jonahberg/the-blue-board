// ═══ HTML SANITIZATION ═══
// Shared across client (src/dashboard/main.js) and server (api/*.ts).
// Why: prevents XSS when untrusted upstream data (FlightAware, FR24, news titles)
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
