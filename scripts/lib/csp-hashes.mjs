// Inline-script extraction + CSP hashing shared by scripts/verify-csp-hashes.mjs and its tests.

import { createHash } from 'node:crypto';

/** Every inline, executable <script> body in an HTML document. */
export function inlineScripts(html) {
  const bodies = [];
  // Comments first: a source comment that says the words "<script>" is not a script, and
  // matching one swallows everything up to the next real closing tag.
  const source = html.replace(/<!--[\s\S]*?-->/g, '');
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(source)) !== null) {
    const attrs = match[1] ?? '';
    // Whole attribute names only: `\bsrc=` also matched `data-src=` and skipped a live script.
    if (/(?:^|\s)src\s*=/i.test(attrs)) continue;
    const type = attrs.match(/(?:^|\s)type\s*=\s*["']?([^"'\s>]+)/i)?.[1]?.trim().toLowerCase();
    const executable = !type || type === 'module' || /(java|ecma)script/.test(type);
    if (!executable) continue;
    if (match[2].trim() === '') continue;
    bodies.push(match[2]);
  }
  return bodies;
}

/** CSP hashes the bytes BETWEEN the tags, exactly — no trimming. */
export function sha256(body) {
  return `sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`;
}
