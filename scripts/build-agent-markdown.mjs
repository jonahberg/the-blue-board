// Writes the Markdown twin of every negotiable route into dist/_agent/.
//
// The root middleware rewrites `Accept: text/markdown` requests to these files rather than
// synthesising a response body, for two reasons: Vercel strips Content-Type from any
// middleware-authored HEAD response (so `curl -sI -H "Accept: text/markdown"` — the check
// acceptmarkdown.com prescribes — would come back without it), and a real asset can be
// cached at the edge per Vary variant.
//
// Source of truth is src/lib/agent-markdown.js, the same module the middleware imports for
// its 404 and 406 bodies, so the served file and the module can never drift.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { agentMarkdown, agentMarkdownAssetPath } from '../src/lib/agent-markdown.js';

const written = [];

for (const [route, body] of Object.entries(agentMarkdown)) {
  const assetPath = agentMarkdownAssetPath(route);
  if (!assetPath) throw new Error(`No asset path for negotiable route ${route}`);

  const target = resolve(`dist${assetPath}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, body, 'utf8');
  written.push(`${route} → ${assetPath} (${Buffer.byteLength(body, 'utf8')} bytes)`);
}

if (written.length === 0) throw new Error('No agent Markdown routes to write');

console.log(`Wrote ${written.length} agent Markdown representations:`);
for (const line of written) console.log(`  ${line}`);
