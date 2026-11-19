// Inline-script extraction + CSP hashing shared by scripts/verify-csp-hashes.mjs and its tests.

import { createHash } from 'node:crypto';

import { JSDOM } from 'jsdom';

/**
 * Every inline, executable <script> body in an HTML document.
 *
 * Read with a real HTML parser (jsdom, already the test suite's DOM), not a regular expression:
 * CodeQL flagged the old `<script…>…</script>` pattern (js/bad-tag-filter: it misses `</script >`)
 * and its comment stripping (js/incomplete-multi-character-sanitization). The parser finds
 * scripts exactly where a browser does — never inside a comment — and `textContent` of a script
 * is its source text verbatim (script content is raw text: no entity decoding, no trimming), which
 * is what CSP hashes.
 */
export function inlineScripts(html) {
  const dom = new JSDOM(html);
  try {
    const bodies = [];
    for (const script of dom.window.document.querySelectorAll('script')) {
      // External scripts are covered by 'self'.
      if (script.hasAttribute('src')) continue;
      // A non-JavaScript type is a data block (JSON-LD, the trackers' config): never executed.
      const type = (script.getAttribute('type') ?? '').trim().toLowerCase();
      const executable = !type || type === 'module' || /(java|ecma)script/.test(type);
      if (!executable) continue;
      const body = script.textContent ?? '';
      if (body.trim() === '') continue;
      bodies.push(body);
    }
    return bodies;
  } finally {
    dom.window.close();
  }
}

/** CSP hashes the bytes BETWEEN the tags, exactly — no trimming. */
export function sha256(body) {
  return `sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`;
}
