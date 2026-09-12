// Fails the build if any inline <script> in dist/ is missing from the CSP script-src.
//
// Astro emits a couple of small inline scripts for a React island (the `astro:only` shim and
// the `astro-island` custom-element runtime). Their content is fixed per Astro version, so
// they are allowed by sha256 hash rather than by 'unsafe-inline' — which would re-open the
// hole dropped from script-src in v1.5.6 and silently permit every future inline script.
//
// The failure mode this guards is nasty: an Astro upgrade changes one of those scripts by a
// byte, the hash stops matching, the browser refuses to run the island, and the page ships a
// skeleton with no dashboard. Nothing else in CI would notice — the build is green, the HTML
// is correct, and only a real browser under the production CSP header shows it.
//
// A <script> whose `type` is not a JavaScript MIME type is a DATA BLOCK, not script: the
// browser never executes it and CSP's script-src does not apply. That covers the JSON-LD
// blocks and the trackers' `type="application/json" data-trk-config` payload. Tags with a
// `src=` attribute are external and already covered by 'self'.

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const DIST = resolve('dist');
const VERCEL_JSON = resolve('vercel.json');

/** Every inline, executable <script> body in an HTML document. */
function inlineScripts(html) {
  const bodies = [];
  // Comments first: a source comment that says the words "<script>" is not a script, and
  // matching one swallows everything up to the next real closing tag.
  const source = html.replace(/<!--[\s\S]*?-->/g, '');
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(source)) !== null) {
    const attrs = match[1] ?? '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = attrs.match(/type\s*=\s*["']([^"']+)["']/i)?.[1]?.trim().toLowerCase();
    const executable = !type || type === 'module' || /(java|ecma)script/.test(type);
    if (!executable) continue;
    if (match[2].trim() === '') continue;
    bodies.push(match[2]);
  }
  return bodies;
}

/** CSP hashes the bytes BETWEEN the tags, exactly — no trimming. */
function sha256(body) {
  return `sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`;
}

async function htmlFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await htmlFiles(path)));
    else if (entry.name.endsWith('.html')) found.push(path);
  }
  return found;
}

const vercelJson = JSON.parse(await readFile(VERCEL_JSON, 'utf8'));
const csp = vercelJson.headers
  ?.find((rule) => rule.source === '/(.*)')
  ?.headers?.find((header) => header.key === 'Content-Security-Policy')?.value;

if (!csp) {
  console.error('verify-csp-hashes: no Content-Security-Policy header found in vercel.json');
  process.exit(1);
}

const scriptSrc = csp.match(/script-src\s+([^;]+)/)?.[1] ?? '';
const missing = [];
let checked = 0;

for (const file of await htmlFiles(DIST)) {
  const html = await readFile(file, 'utf8');
  for (const body of inlineScripts(html)) {
    checked += 1;
    const hash = sha256(body);
    if (!scriptSrc.includes(hash)) {
      missing.push({ file: relative(process.cwd(), file), hash, preview: body.slice(0, 80) });
    }
  }
}

if (missing.length > 0) {
  console.error(
    `verify-csp-hashes: ${missing.length} inline script(s) are not allowed by script-src.\n`
      + "Add each 'sha256-…' token below to the Content-Security-Policy in vercel.json.\n",
  );
  for (const entry of missing) {
    console.error(`  ${entry.file}\n    '${entry.hash}'\n    starts: ${entry.preview}…\n`);
  }
  process.exit(1);
}

console.log(`verify-csp-hashes: ${checked} inline script(s) all allowed by script-src.`);
