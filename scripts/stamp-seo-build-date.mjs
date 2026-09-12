// Stamps the deploy-time Starlink figures into the two verbatim-copied text files.
//
// `dist/index.html` used to be stamped here too: it was a static file in `public/` that
// could not import anything, so both the `__HOME_LASTMOD__` date and the Starlink figures
// had to be patched into the built output. `src/pages/index.astro` imports
// `src/data/starlink-live.json` and `getLastModified()` directly, so the HTML needs no
// stamping at all now.
//
// `public/llms.txt` and `public/llms-full.txt` are still plain text copied verbatim into
// `dist/`, so they still do. The committed source keeps the last-good strings (readable in
// dev); `dist/` gets the live values. A missing source string means someone edited the copy
// without updating `starlink-live.json`'s "source" block — fail the build loudly rather than
// ship a half-stamped page.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const starlink = JSON.parse(await readFile(resolve('src/data/starlink-live.json'), 'utf8'));

const replacements = [
  [starlink.source.label, starlink.live.label],
  [starlink.source.asOf, starlink.live.asOf],
];

for (const rel of ['dist/llms.txt', 'dist/llms-full.txt']) {
  const path = resolve(rel);
  let text = await readFile(path, 'utf8');
  for (const [from, to] of replacements) {
    if (!text.includes(from)) {
      throw new Error(`Expected "${from}" in ${rel} — copy drifted from starlink-live.json "source"`);
    }
    text = text.replaceAll(from, to);
  }
  await writeFile(path, text);
  console.log(`Stamped ${rel} with Starlink figures ${starlink.live.label} / ${starlink.live.asOf}`);
}
