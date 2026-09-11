import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

// Regression guard for the two production incidents caused by a bare JSON import reachable from
// an api/** function:
//
//   2026-06-01  api/starlink-data.ts imported ../public/data/starlink.json directly
//               → every request FUNCTION_INVOCATION_FAILED (PR #185 → hotfix #187).
//   2026-08-11  PR #242 added `import starlinkLive from './starlink-live.json'` to
//               src/data/facts.js. api/waitlist.ts imports facts.js, so every waitlist POST
//               500'd for a month (0 signups vs 13 the month before) before anyone noticed.
//
// package.json is "type":"module", so Vercel runs api/*.ts as native Node ESM, where
// `import x from './x.json'` throws ERR_IMPORT_ATTRIBUTE_MISSING at module load — before the
// handler runs, so nothing is logged as an application error. Nothing else catches it: vitest
// transforms JSON imports, tsc allows them (resolveJsonModule), and this project has no preview
// deploys (merge to main IS the production deploy).
//
// This test walks the static relative-import graph from every api/** entry point and fails on a
// `.json` import that has no `with { type: 'json' }` attribute. Third-party packages are not
// followed (they ship their own runtime contract). The lazy `createRequire` pattern in
// api/starlink-data.ts is invisible to this walk by design — that is the sanctioned fallback.

const ROOT = resolve(__dirname, '..');
const API_DIR = join(ROOT, 'api');

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]\s*(with\s*\{[^}]*\})?/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"]([^'"]+)['"]\s*(?:,\s*\{\s*with\s*:\s*\{[^}]*\}\s*\})?\s*\)/g;

function listApiEntries(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listApiEntries(full));
    else if (/\.(ts|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

/** Resolve a relative specifier the way Node ESM + @vercel/node's TS compile do: `./x.js` may be `./x.ts` on disk. */
function resolveRelative(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base];
  if (/\.js$/.test(base)) candidates.push(base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.mjs'));
  if (!/\.[a-z]+$/.test(base)) candidates.push(`${base}.ts`, `${base}.js`, `${base}.mjs`, join(base, 'index.ts'), join(base, 'index.js'));
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

function collectImports(file) {
  const src = readFileSync(file, 'utf8');
  const found = [];
  for (const m of src.matchAll(IMPORT_RE)) found.push({ spec: m[1], attributed: Boolean(m[2]) });
  for (const m of src.matchAll(DYNAMIC_IMPORT_RE)) found.push({ spec: m[1], attributed: m[0].includes('with') });
  return found;
}

/** Walk the relative import graph from `entry`; return bare JSON imports as "importer → specifier" strings. */
function findBareJsonImports(entry) {
  const seen = new Set();
  const offenders = [];
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const { spec, attributed } of collectImports(file)) {
      if (!spec.startsWith('.') && !spec.startsWith('/')) continue; // bare package specifier
      if (/\.json$/.test(spec)) {
        if (!attributed) offenders.push(`${file.replace(ROOT + '/', '')} → ${spec}`);
        continue;
      }
      const next = resolveRelative(file, spec);
      if (next && !seen.has(next)) stack.push(next);
    }
  }
  return offenders;
}

describe('api/** never reaches a bare JSON import (Vercel native Node ESM)', () => {
  const entries = listApiEntries(API_DIR);

  it('finds the api entry points', () => {
    expect(entries.length).toBeGreaterThan(20);
    expect(entries.some((f) => f.endsWith('/api/waitlist.ts'))).toBe(true);
  });

  for (const entry of entries) {
    const rel = entry.replace(ROOT + '/', '');
    it(`${rel} has no bare .json import anywhere in its import graph`, () => {
      const offenders = findBareJsonImports(entry);
      expect(
        offenders,
        `Bare JSON import reachable from ${rel} — this throws ERR_IMPORT_ATTRIBUTE_MISSING at module load on ` +
          `Vercel and 500s every request. Use createRequire (see api/starlink-data.ts) or move the JSON-backed ` +
          `export out of the shared module (see src/data/starlink-facts.js).\n  ${offenders.join('\n  ')}`,
      ).toEqual([]);
    });
  }

  it('the walker itself detects the Aug 2026 shape (facts.js → starlink-live.json) when reintroduced', () => {
    // Synthetic check: the walker must flag a bare JSON import two hops away from an api entry.
    const fixtureEntry = join(ROOT, 'src', 'data', 'starlink-facts.js');
    const offenders = findBareJsonImports(fixtureEntry);
    expect(offenders).toEqual(['src/data/starlink-facts.js → ./starlink-live.json']);
  });
});
