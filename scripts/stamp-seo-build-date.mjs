import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { getLastModified, homeLastmodPaths } from '../src/lib/buildMetadata.js';

const distIndexPath = resolve('dist/index.html');
const homeLastModified = getLastModified(homeLastmodPaths);

const html = await readFile(distIndexPath, 'utf8');
if (!html.includes('__HOME_LASTMOD__')) {
  throw new Error('Expected __HOME_LASTMOD__ placeholder in dist/index.html');
}

const updatedHtml = html.replaceAll('__HOME_LASTMOD__', homeLastModified);
await writeFile(distIndexPath, updatedHtml);

console.log(`Stamped dist/index.html with home dateModified ${homeLastModified}`);

// Stamp the deploy-time Starlink figures into the verbatim-copied public/
// files. Source keeps the committed strings (readable in dev); dist gets the
// live values. A missing source string means someone edited the copy without
// updating starlink-live.json's "source" block — fail the build loudly rather
// than ship a half-stamped page.
const starlink = JSON.parse(
  await readFile(resolve('src/data/starlink-live.json'), 'utf8'),
);
const starlinkReplacements = [
  [starlink.source.label, starlink.live.label],
  [starlink.source.asOf, starlink.live.asOf],
];
for (const rel of ['dist/index.html', 'dist/llms.txt', 'dist/llms-full.txt']) {
  const path = resolve(rel);
  let text = await readFile(path, 'utf8');
  for (const [from, to] of starlinkReplacements) {
    if (!text.includes(from)) {
      throw new Error(`Expected "${from}" in ${rel} — copy drifted from starlink-live.json "source"`);
    }
    text = text.replaceAll(from, to);
  }
  await writeFile(path, text);
  console.log(`Stamped ${rel} with Starlink figures ${starlink.live.label} / ${starlink.live.asOf}`);
}
