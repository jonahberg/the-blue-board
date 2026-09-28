// Vercel deploys every file under api/ whose name does not start with "_" as a function.
// api/types.ts (type declarations only) shipped as /api/types with no handler for months;
// helpers and type modules must be underscored so they are bundled, never deployed.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const API = resolve(__dirname, '..', 'api');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/\.(ts|js|mjs)$/.test(name) && !name.startsWith('_') && !name.endsWith('.d.ts')) yield path;
  }
}

describe('api/ function files', () => {
  it('every deployable file exports a default handler', () => {
    const missing = [...walk(API)]
      .filter((path) => !/^export default\b|^export \{[^}]*\bdefault\b/m.test(readFileSync(path, 'utf8')))
      .map((path) => relative(API, path));
    expect(missing).toEqual([]);
  });
});
