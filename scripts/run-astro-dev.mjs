import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { getLastModified, homeLastmodPaths } from '../src/lib/buildMetadata.js';

const indexPath = resolve('public/index.html');
const placeholder = '__HOME_LASTMOD__';
const originalHtml = readFileSync(indexPath, 'utf8');

if (!originalHtml.includes(placeholder)) {
  throw new Error(`Expected ${placeholder} placeholder in public/index.html`);
}

const stampedHtml = originalHtml.replaceAll(placeholder, getLastModified(homeLastmodPaths));
writeFileSync(indexPath, stampedHtml);

let restored = false;

function restoreSource() {
  if (restored) {
    return;
  }
  restored = true;
  writeFileSync(indexPath, originalHtml);
}

const child = spawn('bunx', ['astro', 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  restoreSource();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    restoreSource();
    child.kill(signal);
  });
}
